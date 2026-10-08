// Builds the Sky Hopper test program (testprog/sky_hopper.c) for tests and CI.
// The binary goes to a caller-chosen temp directory and is never committed.
// It is only ever analyzed, never run.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_PROGRAM_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "testprog", "sky_hopper.c");

/** Compiles with debug info and no optimization so names and globals are stable. Returns the binary path. */
export function buildTestProgram(outDir: string, cc = process.env["CC"] ?? "cc"): string {
  const out = path.join(outDir, process.platform === "win32" ? "sky_hopper.exe" : "sky_hopper");
  const r = spawnSync(cc, ["-std=c11", "-Wall", "-Wextra", "-Werror", "-g", "-O0", "-fno-pie", "-no-pie", "-o", out, TEST_PROGRAM_SOURCE], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compiling the test program failed: ${r.error?.message ?? r.stderr}`);
  return out;
}
