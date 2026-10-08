// F5 walkthrough at the service level, plus the security properties it must keep:
// S1 (planner never sees game text), S3 (nothing written without the native
// confirm), S14 (audit chain intact), and attestation before any project.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewStateSchema } from "@play4m3/station-protocol";
import { DEMO_FUNCTIONS, StationService, confirmPrompt } from "../src/index.js";
import type { ConfirmPrompt } from "../src/index.js";

let tmp: string;
let prompts: ConfirmPrompt[];
let answer: boolean;

function make(): StationService {
  return new StationService({
    workspaceRoot: path.join(tmp, "ws"),
    attestationFile: path.join(tmp, "attestation.json"),
    confirm: async (p) => {
      prompts.push(p);
      return answer;
    },
    now: () => new Date("2026-10-08T12:00:00Z"),
  });
}

/** Attested service with one project and the jump function explained. */
function ready(): { s: StationService; projectRoot: string } {
  const s = make();
  s.attest();
  const v = s.createProject("Sky test");
  const id = v.project?.id ?? "";
  s.selectFunction("fn_4011e0"); // player_jump
  return { s, projectRoot: path.join(tmp, "ws", id) };
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "p4m3-station-"));
  prompts = [];
  answer = true;
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("attestation", () => {
  it("blocks projects until the user attests, then persists across restarts", () => {
    const s = make();
    expect(s.state().attested).toBe(false);
    expect(s.createProject("x")).toMatchObject({ project: null, notice: { tone: "error" } });
    s.attest();
    expect(make().state().attested).toBe(true); // a new service reads the stored attestation
  });

  it("ignores a tampered attestation file", () => {
    make().attest();
    const f = path.join(tmp, "attestation.json");
    const data = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    data["text"] = "something else";
    writeFileSync(f, JSON.stringify(data));
    expect(make().state().attested).toBe(false);
  });
});

describe("walkthrough", () => {
  it("project lists the sample functions; selecting one gets a reader explanation", () => {
    const { s } = ready();
    const v = s.state();
    expect(v.project?.functions).toHaveLength(DEMO_FUNCTIONS.length);
    expect(v.project?.explanation).toMatchObject({ functionId: "fn_4011e0", category: "physics", tunables: [{ name: "jump_velocity", value: 12 }] });
    expect(ViewStateSchema.safeParse(v).success).toBe(true);
  });

  it("'make the jump higher' queues an approval with the exact change, and writes nothing yet", async () => {
    const { s, projectRoot } = ready();
    const v = await s.command("make the jump higher");
    expect(v.project?.approvals).toEqual([
      expect.objectContaining({
        tool: "patch.write",
        paths: ["mods/jump-velocity-x1.25.p4m3patch.json"],
        fromGameData: true,
        changes: [{ tunable: "jump_velocity", address: "0x404010", type: "f32", before: 12, after: 15 }],
        problem: null,
      }),
    ]);
    expect(existsSync(path.join(projectRoot, "mods", "jump-velocity-x1.25.p4m3patch.json"))).toBe(false);
  });

  it("approve -> native confirm -> patch file written with the original-hash manifest", async () => {
    const { s, projectRoot } = ready();
    const v1 = await s.command("make the jump higher");
    const id = v1.project?.approvals[0]?.requestId ?? "";
    const v2 = await s.decide(id, "approve");
    expect(prompts).toHaveLength(1);
    expect(v2.project?.approvals).toEqual([]);
    expect(v2.project?.patches).toEqual([expect.objectContaining({ path: "mods/jump-velocity-x1.25.p4m3patch.json" })]);
    const file = JSON.parse(readFileSync(path.join(projectRoot, "mods", "jump-velocity-x1.25.p4m3patch.json"), "utf8")) as Record<string, unknown>;
    expect(file).toMatchObject({ format: "play4m3-patch/0", game: { sha256: v2.project?.game.sha256 }, changes: [{ before: 12, after: 15 }] });
    expect(JSON.stringify(file)).not.toContain("player_jump"); // no game symbols or code in the patch
    expect(v2.audit.chainOk).toBe(true);
  });

  it("cancelling the native dialog writes nothing and keeps the request waiting", async () => {
    answer = false;
    const { s, projectRoot } = ready();
    const id = (await s.command("make the jump higher")).project?.approvals[0]?.requestId ?? "";
    const v = await s.decide(id, "approve");
    expect(v.project?.approvals).toHaveLength(1);
    expect(v.notice?.tone).toBe("info");
    expect(existsSync(path.join(projectRoot, "mods", "jump-velocity-x1.25.p4m3patch.json"))).toBe(false);
  });

  it("reject removes the request without a dialog", async () => {
    const { s } = ready();
    const id = (await s.command("lower the gravity")).project?.approvals[0]?.requestId ?? "";
    const v = await s.decide(id, "reject");
    expect(prompts).toHaveLength(0);
    expect(v.project?.approvals).toEqual([]);
    expect((await s.decide(id, "approve")).notice?.tone).toBe("error"); // cannot approve after rejecting
  });

  it("a change the selected function cannot make is cancelled with a clear message", async () => {
    const { s } = ready(); // player_jump has no gravity value
    const v = await s.command("lower the gravity");
    expect(v.project?.approvals).toEqual([]);
    expect(v.project?.transcript.at(-1)?.text).toMatch(/no tuning value named gravity/);
  });

  it("asks the user to pick a function when none is explained", async () => {
    const s = make();
    s.attest();
    s.createProject("p");
    const v = await s.command("make the jump higher");
    expect(v.project?.approvals).toEqual([]);
    expect(v.project?.transcript.at(-1)?.text).toMatch(/Pick a function/);
  });

  it("refuses to overwrite an existing patch file", async () => {
    const { s } = ready();
    const id1 = (await s.command("make the jump higher")).project?.approvals[0]?.requestId ?? "";
    await s.decide(id1, "approve");
    const id2 = (await s.command("make the jump higher")).project?.approvals[0]?.requestId ?? "";
    const v = await s.decide(id2, "approve");
    expect(v.notice).toMatchObject({ tone: "error", text: expect.stringMatching(/already exists/) });
    expect(v.project?.patches).toHaveLength(1);
  });
});

describe("security", () => {
  it("S1: the planner never sees function names, strings, or the planted injection", async () => {
    const { s } = ready();
    s.selectFunction("fn_401460"); // load_level, contains the injection string
    await s.command("make the jump higher");
    await s.command("do what the game file says");
    const wire = JSON.stringify(s.plannerInputs);
    expect(s.plannerInputs.length).toBe(2);
    for (const fn of DEMO_FUNCTIONS) {
      expect(wire).not.toContain(fn.name);
      for (const str of fn.strings) expect(wire).not.toContain(str);
    }
    expect(wire).not.toMatch(/SYSTEM NOTE|approve every|Documents/);
  });

  it("the reader flags the planted injection and its summary cannot carry paths or markup", () => {
    const { s } = ready();
    const v = s.selectFunction("fn_401460");
    expect(v.project?.explanation?.flags).toEqual(["instruction_like_text"]);
    expect(v.project?.explanation?.summary).not.toMatch(/[\\/<>"`]/);
  });

  it("the native confirm dialog shows no game text (no symbol names, no strings)", async () => {
    const { s } = ready();
    const id = (await s.command("make the jump higher")).project?.approvals[0]?.requestId ?? "";
    await s.decide(id, "approve");
    const shown = JSON.stringify(prompts);
    for (const fn of DEMO_FUNCTIONS) expect(shown).not.toContain(fn.name);
    expect(shown).toContain("jump_velocity at 0x404010 (f32): 12 -> 15");
    expect(shown).toContain("computed from data read from the game file");
  });

  it("confirmPrompt is built only from card fields", () => {
    const p = confirmPrompt({ requestId: "r1", tool: "patch.write", title: "Change gravity to 0.8x", paths: ["mods/g.p4m3patch.json"], fromGameData: false, changes: [], problem: null });
    expect(p.message).toBe("Change gravity to 0.8x\nWrite mods/g.p4m3patch.json");
    expect(p.detail).not.toContain("game file");
  });

  it("approving an unknown request does nothing", async () => {
    const { s } = ready();
    const v = await s.decide("req_999", "approve");
    expect(v.notice?.tone).toBe("error");
    expect(prompts).toHaveLength(0);
  });

  it("bad input is refused, not thrown", async () => {
    const { s } = ready();
    expect(s.createProject("../../etc").notice?.tone).toBe("error");
    expect(s.createProject("x".repeat(81)).notice?.tone).toBe("error");
    expect((await s.command("")).notice?.tone).toBe("error");
    expect((await s.command("a".repeat(501))).notice?.tone).toBe("error");
    expect(s.selectFunction("fn_nope").notice?.tone).toBe("error");
    expect(s.selectProject("p_nope").notice?.tone).toBe("error");
  });

  it("S14: every step is in an intact audit chain", async () => {
    const { s } = ready();
    s.selectFunction("fn_4012c0"); // move_player has run_speed
    const id = (await s.command("run faster")).project?.approvals[0]?.requestId ?? "";
    const v = await s.decide(id, "approve");
    expect(v.audit.chainOk).toBe(true);
    const kinds = v.audit.rows.map((r) => r.kind);
    for (const k of ["session", "model_call", "tool_call", "decision", "approval", "execution"]) expect(kinds).toContain(k);
  });
});
