// ghidra-headless skill runner (F4). Runs Ghidra's HeadlessAnalyzer inside the
// analysis worker sandbox and returns a schema-checked report.
//
// Ghidra is user- or CI-installed, never bundled (D-039). We start Java
// directly with the VM arguments from Ghidra's own support/launch.properties
// instead of the analyzeHeadless shell/batch launchers: no shell is involved,
// the same code runs on Linux and Windows, and we set the heap and the JVM's
// home/temp directories ourselves.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { GHIDRA_HEADLESS, readVerifiedSkillFile } from "@play4m3/skills";
import { runSandboxed } from "./sandbox.js";
import type { Enforceable, Enforcement, SandboxFailure, SandboxLimits } from "./sandbox.js";
import { parseAnalysisReport } from "./schema.js";
import type { AnalysisReport } from "./schema.js";

export interface GhidraInstall {
  /** Ghidra install directory (the one holding `support/` and `Ghidra/`). */
  ghidraDir: string;
  /** JDK 21+ home. */
  javaHome: string;
}

const SCRIPT_PATH = "ghidra-headless/P4m3ExportFunctions.java";
const SCRIPT_NAME = "P4m3ExportFunctions.java";
const OUTPUT = "analysis.json";

export type InstallCheck = { ok: true; version: string; java: string; classpath: string; vmArgs: string[] } | { ok: false; problem: string };

/** Checks a Ghidra install without running it: version pin, launcher jar, java binary, VM arguments. */
export function checkGhidraInstall(install: GhidraInstall): InstallCheck {
  const props = readProps(path.join(install.ghidraDir, "Ghidra", "application.properties"));
  if (!props) return { ok: false, problem: "Ghidra/application.properties not found" };
  const version = props.get("application.version")?.[0] ?? "";
  if (version !== GHIDRA_HEADLESS.requires.version) return { ok: false, problem: `Ghidra ${version || "(unknown)"} found; this skill is pinned to ${GHIDRA_HEADLESS.requires.version}` };
  const classpath = path.join(install.ghidraDir, "Ghidra", "Framework", "Utility", "lib", "Utility.jar");
  if (!existsSync(classpath)) return { ok: false, problem: "Ghidra launcher jar not found" };
  const java = path.join(install.javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(java)) return { ok: false, problem: "java not found under javaHome" };
  const launch = readProps(path.join(install.ghidraDir, "support", "launch.properties"));
  if (!launch) return { ok: false, problem: "support/launch.properties not found" };
  const osKey = process.platform === "win32" ? "VMARGS_WINDOWS" : process.platform === "darwin" ? "VMARGS_MACOS" : "VMARGS_LINUX";
  const vmArgs = [...(launch.get("VMARGS") ?? []), ...(launch.get(osKey) ?? [])];
  // These come from the user's Ghidra install; accept only plain JVM options.
  if (!vmArgs.every((a) => /^-[A-Za-z0-9_.:=,+/-]*$/.test(a))) return { ok: false, problem: "unexpected value in support/launch.properties" };
  return { ok: true, version, java, classpath, vmArgs };
}

function readProps(file: string): Map<string, string[]> | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const map = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (value === "") continue;
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}

export interface GhidraOptions {
  install: GhidraInstall;
  /** Host path of the binary to analyze. It is copied; Ghidra never sees this path. */
  input: string;
  limits?: Partial<SandboxLimits>;
  require?: readonly Enforceable[];
  /** Java heap; must fit well inside limits.memoryBytes. */
  heapMb?: number;
  /** Override for tests; defaults to the bundled skills directory. */
  skillsRoot?: string;
}

export type GhidraResult =
  | { ok: true; report: AnalysisReport; inputSha256: string; enforcement: Enforcement; durationMs: number }
  | { ok: false; reason: SandboxFailure | "install" | "skill_integrity" | "bad_output"; detail: string; log: string };

export async function analyzeWithGhidra(opts: GhidraOptions): Promise<GhidraResult> {
  const check = checkGhidraInstall(opts.install);
  if (!check.ok) return { ok: false, reason: "install", detail: check.problem, log: "" };
  let script: Buffer;
  try {
    script = readVerifiedSkillFile(GHIDRA_HEADLESS, SCRIPT_PATH, opts.skillsRoot);
  } catch (err) {
    return { ok: false, reason: "skill_integrity", detail: (err as Error).message, log: "" };
  }
  const heapMb = Math.floor(opts.heapMb ?? 1024);

  const run = await runSandboxed({
    command: check.java,
    input: opts.input,
    outputFile: OUTPUT,
    // The verified bytes are staged into the private work dir; Ghidra runs exactly those.
    stage: { [SCRIPT_NAME]: script },
    // Fewer malloc arenas keep glibc's per-thread reservations inside the address-space cap.
    env: { JAVA_HOME: opts.install.javaHome, MALLOC_ARENA_MAX: "2" },
    limits: opts.limits,
    require: opts.require,
    args: (p) => [
      ...check.vmArgs,
      `-Xmx${heapMb}m`,
      "-Xss1m",
      "-XX:ActiveProcessorCount=2",
      "-XX:CompressedClassSpaceSize=256m",
      "-XX:ReservedCodeCacheSize=128m",
      "-XX:-UsePerfData",
      "-Djava.awt.headless=true",
      `-Duser.home=${path.join(p.scratch, "home")}`,
      `-Djava.io.tmpdir=${path.join(p.scratch, "tmp")}`,
      "-cp",
      check.classpath,
      "ghidra.Ghidra",
      "ghidra.app.util.headless.AnalyzeHeadless",
      p.scratch, // project location; Ghidra creates p4m3.gpr and p4m3.rep inside
      "p4m3",
      "-import",
      p.input,
      "-scriptPath",
      p.staged,
      "-postScript",
      SCRIPT_NAME,
      path.join(p.outDir, OUTPUT),
      "-deleteProject",
      "-max-cpu",
      "2",
      "-analysisTimeoutPerFile",
      String(Math.max(30, Math.floor((opts.limits?.timeoutMs ?? 300_000) / 1000) - 30)),
    ],
  });
  if (!run.ok) return { ok: false, reason: run.reason, detail: run.detail, log: run.log };

  const parsed = parseAnalysisReport(run.output);
  if (!parsed.ok) return { ok: false, reason: "bad_output", detail: parsed.problem, log: run.log };
  if (parsed.report.program.sha256 !== run.inputSha256) return { ok: false, reason: "bad_output", detail: "the report is for a different file", log: run.log };
  return { ok: true, report: parsed.report, inputSha256: run.inputSha256, enforcement: run.enforcement, durationMs: run.durationMs };
}
