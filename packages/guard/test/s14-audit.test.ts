// S14: hash-chained audit log; altering any entry breaks the chain.
import { describe, expect, it } from "vitest";
import type { Json } from "@play4m3/core";
import { AuditLog, verifyChain } from "../src/index.js";
import type { AuditEntry } from "../src/index.js";

function sampleLog(): AuditLog {
  let t = Date.UTC(2026, 9, 6, 12, 0, 0);
  const log = new AuditLog(undefined, () => new Date(t++));
  log.append("session", { started: true });
  log.append("tool_call", { requestId: "req_1", tool: "fs.read", args: { path: "mods/a.json" } });
  log.append("decision", { requestId: "req_1", allow: true, reason: "allowed by capability" });
  log.append("execution", { requestId: "req_1", tool: "fs.read" });
  return log;
}

const clone = (entries: readonly AuditEntry[]): AuditEntry[] => entries.map((e) => JSON.parse(JSON.stringify(e)) as AuditEntry);

describe("S14 audit log", () => {
  it("verifies an untouched log", () => {
    const log = sampleLog();
    expect(verifyChain(log.all())).toEqual({ ok: true, head: log.head() });
  });

  it("detects an altered data field", () => {
    const e = clone(sampleLog().all());
    (e[2] as { data: Json }).data = { requestId: "req_1", allow: false };
    expect(verifyChain(e)).toMatchObject({ ok: false, at: 2 });
  });

  it("detects an altered entry even if its own hash is recomputed (breaks the next link)", () => {
    const log = sampleLog();
    const e = clone(log.all());
    // Attacker rewrites entry 1 and fixes its hash, but cannot fix entry 2's prev without rewriting everything after.
    const forged = new AuditLog(undefined, () => new Date(e[1]?.ts ?? 0));
    forged.append("session", (e[0] as AuditEntry).data);
    const f = forged.append("tool_call", { requestId: "req_1", tool: "fs.write" });
    e[1] = { ...f, seq: 1, prev: (e[0] as AuditEntry).hash };
    expect(verifyChain(e).ok).toBe(false);
  });

  it("detects deletion, reorder and insertion", () => {
    const base = sampleLog().all();
    const deleted = clone(base).filter((_, i) => i !== 1);
    expect(verifyChain(deleted).ok).toBe(false);
    const reordered = clone(base);
    [reordered[1], reordered[2]] = [reordered[2] as AuditEntry, reordered[1] as AuditEntry];
    expect(verifyChain(reordered).ok).toBe(false);
    const inserted = clone(base);
    inserted.splice(2, 0, { ...(inserted[1] as AuditEntry) });
    expect(verifyChain(inserted).ok).toBe(false);
  });

  it("detects tail truncation only with an external head anchor", () => {
    const log = sampleLog();
    const truncated = clone(log.all()).slice(0, 2);
    expect(verifyChain(truncated).ok).toBe(true); // chain alone cannot see it
    expect(verifyChain(truncated, log.head())).toMatchObject({ ok: false, reason: expect.stringContaining("anchor") });
  });

  it("redacts secrets before hashing (S10 overlap)", () => {
    const key = ["sk", "ant", "api03", "Z".repeat(40)].join("-");
    const log = new AuditLog();
    log.append("model_call", { provider: "claude-agent-sdk", header: `x-api-key: ${key}`, nested: [{ k: key }] });
    const text = JSON.stringify(log.all());
    expect(text).not.toContain(key);
    expect(verifyChain(log.all()).ok).toBe(true);
  });

  it("entries are frozen in memory", () => {
    const log = sampleLog();
    expect(() => {
      (log.all()[0] as { kind: string }).kind = "decision";
    }).toThrow();
  });
});
