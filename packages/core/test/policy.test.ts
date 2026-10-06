// S2 (default deny for tool, path, network) and the manifest rules behind S3.
import { describe, expect, it } from "vitest";
import { CapabilityManifestSchema, DENY_ALL_APPROVALS, PolicyEngine } from "../src/index.js";
import type { ApprovalVerifier, CapabilityManifest, ToolRequest } from "../src/index.js";

const manifest: CapabilityManifest = [
  { tool: "fs.read", pathScope: ["project", "mods"], net: "deny", approval: "none" },
  { tool: "fs.write", pathScope: ["mods"], net: "deny", approval: "user" },
  { tool: "net.fetch", net: "allowlist", netAllow: ["api.example.com"], approval: "user" },
  { tool: "explain.function", net: "deny", approval: "none" },
];

/** Accepts exactly the token "ok:<request id>". */
const testApprovals: ApprovalVerifier = { verify: (token, req) => token === `ok:${req.id}` };

function req(over: Partial<ToolRequest>): ToolRequest {
  return { id: "r1", tool: "fs.read", args: {}, paths: [], net: [], taintedBy: [], ...over };
}

const engine = new PolicyEngine(manifest, testApprovals);

describe("S2 policy engine default deny", () => {
  it("denies an unknown tool", () => {
    expect(engine.evaluate(req({ tool: "exec.shell" }))).toMatchObject({ allow: false, rule: "tool.not-allowlisted" });
  });

  it("denies malformed requests", () => {
    for (const bad of [null, "fs.read", { tool: "fs.read" }, { ...req({}), extra: 1 }, { ...req({}), tool: "FS.READ" }, { ...req({}), taintedBy: ["v1"] }]) {
      expect(engine.evaluate(bad)).toMatchObject({ allow: false, rule: "request.malformed" });
    }
  });

  it("allows a plain read inside scope", () => {
    expect(engine.evaluate(req({ paths: ["project/main.c"] }))).toMatchObject({ allow: true, canonicalPaths: ["project/main.c"] });
  });

  it("denies a read outside scope", () => {
    expect(engine.evaluate(req({ paths: ["secrets/key.txt"] }))).toMatchObject({ allow: false, rule: "path.out-of-scope" });
  });

  it("denies scope-prefix confusion", () => {
    expect(engine.evaluate(req({ paths: ["modsevil/x"] }))).toMatchObject({ allow: false, rule: "path.out-of-scope" });
  });

  it("denies paths on a tool with no path scope", () => {
    expect(engine.evaluate(req({ tool: "explain.function", paths: ["mods/a"] }))).toMatchObject({ allow: false, rule: "path.no-scope" });
  });

  it.each(["../x", "C:\\x", "\\\\srv\\s", "mods/a:ads", "mods/PROGRA~1", "mods/CON", "mods/a."])("denies hostile path %j", (p) => {
    const d = engine.evaluate(req({ paths: [p] }));
    expect(d.allow).toBe(false);
  });

  it("denies one bad path among good ones", () => {
    expect(engine.evaluate(req({ paths: ["mods/a", "../b"] })).allow).toBe(false);
  });

  it("denies network on a net:deny tool", () => {
    expect(engine.evaluate(req({ net: ["api.example.com"] }))).toMatchObject({ allow: false, rule: "net.denied" });
  });

  it("denies non-allowlisted, uppercase, IDN and IP hosts", () => {
    for (const host of ["evil.com", "API.EXAMPLE.COM", "api.examp1e.com", "аpi.example.com", "127.0.0.1", "api.example.com.", "localhost"]) {
      const d = engine.evaluate(req({ id: "n1", tool: "net.fetch", net: [host], approvalToken: "ok:n1" }));
      expect(d.allow, host).toBe(false);
    }
  });

  it("allows an allowlisted host with approval", () => {
    expect(engine.evaluate(req({ id: "n2", tool: "net.fetch", net: ["api.example.com"], approvalToken: "ok:n2" })).allow).toBe(true);
  });

  it("denies a network target derived from untrusted data even with approval", () => {
    const d = engine.evaluate(req({ id: "n3", tool: "net.fetch", net: ["api.example.com"], taintedBy: ["$v1"], approvalToken: "ok:n3" }));
    expect(d).toMatchObject({ allow: false, rule: "net.tainted" });
  });
});

describe("S3 approvals in the policy engine", () => {
  it("denies a write without an approval token", () => {
    expect(engine.evaluate(req({ tool: "fs.write", paths: ["mods/a.json"] }))).toMatchObject({ allow: false, rule: "approval.missing" });
  });

  it("denies a write with a token for a different request", () => {
    expect(engine.evaluate(req({ id: "w1", tool: "fs.write", paths: ["mods/a.json"], approvalToken: "ok:other" }))).toMatchObject({ allow: false, rule: "approval.invalid" });
  });

  it("allows a write with a valid token", () => {
    expect(engine.evaluate(req({ id: "w2", tool: "fs.write", paths: ["mods/a.json"], approvalToken: "ok:w2" })).allow).toBe(true);
  });

  it("requires approval for any untrusted-derived argument, even on approval:none tools", () => {
    expect(engine.evaluate(req({ tool: "explain.function", taintedBy: ["$v3"] }))).toMatchObject({ allow: false, rule: "approval.missing" });
  });

  it("DENY_ALL_APPROVALS denies every approval-gated call", () => {
    const web = new PolicyEngine(manifest, DENY_ALL_APPROVALS);
    expect(web.evaluate(req({ id: "w3", tool: "fs.write", paths: ["mods/a.json"], approvalToken: "ok:w3" })).allow).toBe(false);
  });
});

describe("capability manifest validation", () => {
  const bad: Array<[string, unknown]> = [
    ["sensitive tool without approval", [{ tool: "fs.write", pathScope: ["mods"], net: "deny", approval: "none" }]],
    ["exec without approval", [{ tool: "exec.run", net: "deny", approval: "none" }]],
    ["skill change without approval", [{ tool: "skill.install", net: "deny", approval: "none" }]],
    ["network without approval", [{ tool: "data.lookup", net: "allowlist", netAllow: ["a.example.com"], approval: "none" }]],
    ["empty allowlist", [{ tool: "net.fetch", net: "allowlist", netAllow: [], approval: "user" }]],
    ["netAllow with deny", [{ tool: "fs.read", net: "deny", netAllow: ["a.example.com"], approval: "none" }]],
    ["non-canonical scope", [{ tool: "fs.read", pathScope: ["../"], net: "deny", approval: "none" }]],
    ["backslash scope", [{ tool: "fs.read", pathScope: ["a\\b"], net: "deny", approval: "none" }]],
    ["duplicate tool", [manifest[0], manifest[0]]],
    ["unknown field", [{ tool: "fs.read", net: "deny", approval: "none", sudo: true }]],
    ["wildcard host", [{ tool: "net.fetch", net: "allowlist", netAllow: ["*.example.com"], approval: "user" }]],
  ];
  it.each(bad)("rejects %s", (_n, m) => {
    expect(CapabilityManifestSchema.safeParse(m).success).toBe(false);
  });

  it("the engine refuses to construct from a bad manifest", () => {
    expect(() => new PolicyEngine(bad[0]?.[1] as CapabilityManifest, testApprovals)).toThrow();
  });
});
