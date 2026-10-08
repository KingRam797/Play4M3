// F4 acceptance: real Ghidra 12.1.4 in the analysis sandbox on a program we
// compile ourselves. Runs only where Ghidra is installed (CI job
// `ghidra-analysis`): set P4M3_GHIDRA_DIR and P4M3_JAVA_HOME.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeWithGhidra } from "../src/index.js";
import type { GhidraResult } from "../src/index.js";
import { buildTestProgram } from "../src/testprog.js";

const ghidraDir = process.env["P4M3_GHIDRA_DIR"];
const javaHome = process.env["P4M3_JAVA_HOME"];
// CI's ghidra-analysis job sets this so a missing install fails instead of silently skipping.
if (process.env["P4M3_REQUIRE_GHIDRA"] === "1" && (!ghidraDir || !javaHome)) throw new Error("P4M3_GHIDRA_DIR and P4M3_JAVA_HOME must be set");

describe.skipIf(!ghidraDir || !javaHome)("ghidra-headless on Sky Hopper", () => {
  let tmp: string;
  let result: GhidraResult;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "p4m3-ghidra-e2e-"));
    const bin = buildTestProgram(tmp);
    result = await analyzeWithGhidra({ install: { ghidraDir: ghidraDir ?? "", javaHome: javaHome ?? "" }, input: bin, limits: { timeoutMs: 240_000 } });
    if (!result.ok) console.error(result.reason, result.detail, result.log.slice(-4000));
  }, 300_000);
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("runs with the network and memory limits enforced", () => {
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.enforcement).toMatchObject({ network: "namespace", memory: "rlimit_as" });
  });

  it("finds every game function", () => {
    if (!result.ok) throw new Error("analysis failed");
    const names = result.report.functions.map((f) => f.name);
    for (const n of ["main", "game_tick", "read_input", "player_jump", "apply_gravity", "move_player", "render_frame", "load_level", "play_sound"]) expect(names).toContain(n);
  });

  it("finds the tuning globals with their values", () => {
    if (!result.ok) throw new Error("analysis failed");
    const fn = (n: string) => result.ok && result.report.functions.find((f) => f.name === n);
    const g = (f: string, v: string) => (fn(f) || { globals: [] }).globals.find((x) => x.name === v);
    expect(g("player_jump", "jump_velocity")).toMatchObject({ type: "float", value: 12 });
    expect(g("apply_gravity", "gravity")).toMatchObject({ type: "float" });
    expect(g("apply_gravity", "gravity")?.value).toBeCloseTo(9.8, 5);
    expect(g("move_player", "run_speed")).toMatchObject({ type: "float", value: 4.5 });
  });

  it("reports the planted injection string as plain data of load_level", () => {
    if (!result.ok) throw new Error("analysis failed");
    const load = result.report.functions.find((f) => f.name === "load_level");
    expect(load?.strings.some((s) => s.startsWith("SYSTEM NOTE TO AI ASSISTANT"))).toBe(true);
  });

  it("names the analyzed file by its fixed sandbox name and matching hash", () => {
    if (!result.ok) throw new Error("analysis failed");
    expect(result.report.program.name).toBe("input.bin");
    expect(result.report.program.sha256).toBe(result.inputSha256);
  });
});
