// S3: writes, exec, network and skill changes need explicit user approval.
// "Integration" here = planner call -> guard -> policy -> approval queue -> executor.
// The UI-click half of S3 is covered when the Station UI exists (F5).
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CapabilityManifest, ToolRequest } from "@play4m3/core";
import { AuditLog, Guard, HandleStore, HmacApprovalAuthority, requestDigest, verifyChain } from "../src/index.js";
import type { ToolSpec } from "../src/index.js";

const manifest: CapabilityManifest = [
  { tool: "fs.read", pathScope: ["project", "mods"], net: "deny", approval: "none" },
  { tool: "fs.write", pathScope: ["mods"], net: "deny", approval: "user" },
];

function setup(now = () => 1_000_000) {
  const writes: unknown[] = [];
  const tools: ToolSpec[] = [
    { name: "fs.read", description: "read", args: z.object({ path: z.string() }).strict(), pathArgs: ["path"], run: () => "contents" },
    {
      name: "fs.write",
      description: "write",
      args: z.object({ path: z.string(), content: z.string() }).strict(),
      pathArgs: ["path"],
      run: (a) => {
        writes.push(a);
        return "ok";
      },
    },
  ];
  const handles = new HandleStore();
  const approvals = new HmacApprovalAuthority({ now });
  const audit = new AuditLog();
  const guard = new Guard(manifest, tools, handles, approvals, audit);
  return { guard, handles, approvals, audit, writes };
}

const baseReq: ToolRequest = { id: "req_1", tool: "fs.write", args: { path: "mods/a.json", content: "{}" }, paths: ["mods/a.json"], net: [], taintedBy: [] };

describe("S3 approval gate", () => {
  it("a write without approval is queued, not executed", async () => {
    const { guard, writes } = setup();
    const r = await guard.propose({ tool: "fs.write", args: { path: "mods/a.json", content: "{}" } });
    expect(r.status).toBe("pending_approval");
    expect(writes).toHaveLength(0);
  });

  it("the write runs only after approve() for that request", async () => {
    const { guard, writes, audit } = setup();
    const r = await guard.propose({ tool: "fs.write", args: { path: "mods/a.json", content: "{}" } });
    const done = await guard.approve(r.requestId as string);
    expect(done.status).toBe("executed");
    expect(writes).toEqual([{ path: "mods/a.json", content: "{}" }]);
    expect(verifyChain(audit.all()).ok).toBe(true);
    expect(audit.all().map((e) => e.kind)).toEqual(["tool_call", "decision", "approval", "decision", "execution"]);
  });

  it("a call carrying a planner-forged approvalToken is rejected as malformed", async () => {
    const { guard, writes } = setup();
    const r = await guard.propose({ tool: "fs.write", args: { path: "mods/a.json", content: "{}" }, approvalToken: "x.y.z" });
    expect(r).toMatchObject({ status: "denied", rule: "planner.malformed" });
    expect(writes).toHaveLength(0);
  });

  it("approve() of an unknown or already-used request id does nothing", async () => {
    const { guard, writes } = setup();
    expect((await guard.approve("req_999")).status).toBe("denied");
    const r = await guard.propose({ tool: "fs.write", args: { path: "mods/a.json", content: "{}" } });
    await guard.approve(r.requestId as string);
    expect((await guard.approve(r.requestId as string)).status).toBe("denied");
    expect(writes).toHaveLength(1);
  });

  it("rejected requests never run", async () => {
    const { guard, writes } = setup();
    const r = await guard.propose({ tool: "fs.write", args: { path: "mods/a.json", content: "{}" } });
    guard.reject(r.requestId as string);
    expect((await guard.approve(r.requestId as string)).status).toBe("denied");
    expect(writes).toHaveLength(0);
  });

  it("reads inside scope need no approval", async () => {
    const { guard } = setup();
    expect((await guard.propose({ tool: "fs.read", args: { path: "project/main.c" } })).status).toBe("executed");
  });

  it("reads that reference an untrusted handle need approval", async () => {
    const { guard, handles } = setup();
    const id = handles.put({ value: "project/main.c", trust: "untrusted", source: "file:README.md" }, "raw_text");
    expect((await guard.propose({ tool: "fs.read", args: { path: id } })).status).toBe("pending_approval");
  });
});

describe("S3 approval tokens", () => {
  it("bind to the exact request", () => {
    const { approvals } = setup();
    const token = approvals.issue(baseReq);
    const variants: ToolRequest[] = [
      { ...baseReq, id: "req_2" },
      { ...baseReq, args: { ...baseReq.args, content: "evil" } },
      { ...baseReq, paths: ["mods/b.json"] },
      { ...baseReq, tool: "fs.read" },
      { ...baseReq, taintedBy: ["$v1"] },
      { ...baseReq, net: ["a.example.com"] },
    ];
    for (const v of variants) expect(approvals.verify(token, v)).toBe(false);
    expect(approvals.verify(token, baseReq)).toBe(true);
  });

  it("are single use", () => {
    const { approvals } = setup();
    const token = approvals.issue(baseReq);
    expect(approvals.verify(token, baseReq)).toBe(true);
    expect(approvals.verify(token, baseReq)).toBe(false);
  });

  it("expire", () => {
    let t = 0;
    const { approvals } = setup(() => t);
    const token = approvals.issue(baseReq);
    t = 3 * 60 * 1000;
    expect(approvals.verify(token, baseReq)).toBe(false);
  });

  it("from another authority (another key) are rejected", () => {
    const a = setup().approvals;
    const b = setup().approvals;
    expect(b.verify(a.issue(baseReq), baseReq)).toBe(false);
  });

  it("reject garbage without throwing", () => {
    const { approvals } = setup();
    for (const g of ["", "...", "a.b.c", "x".repeat(2000), `${"A".repeat(22)}.9999999999999.${"B".repeat(43)}`]) {
      expect(approvals.verify(g, baseReq)).toBe(false);
    }
  });

  it("digest ignores the token field and key order", () => {
    const reordered = JSON.parse(JSON.stringify({ taintedBy: [], net: [], paths: baseReq.paths, args: { content: "{}", path: "mods/a.json" }, tool: baseReq.tool, id: baseReq.id })) as ToolRequest;
    expect(requestDigest({ ...baseReq, approvalToken: "zzz" })).toBe(requestDigest(reordered));
  });

  it("tool implementations are never called on deny", async () => {
    const run = vi.fn(() => "x");
    const g = new Guard(manifest, [{ name: "fs.write", description: "", args: z.object({ path: z.string() }).strict(), pathArgs: ["path"], run }], new HandleStore(), new HmacApprovalAuthority(), new AuditLog());
    await g.propose({ tool: "fs.write", args: { path: "../x" } });
    expect(run).not.toHaveBeenCalled();
  });
});
