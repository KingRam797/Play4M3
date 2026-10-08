// Analysis worker runner (S13, brief §5). Runs a static analyzer as a separate
// process on a private, read-only copy of the input, with:
//   - a minimal environment (no inherited variables, so no keys or tokens),
//   - no network (Linux: a new network namespace via `unshare`),
//   - a memory cap (Linux: RLIMIT_AS via `prlimit`),
//   - a wall-clock timeout that kills the whole process tree,
//   - an output size cap (RLIMIT_FSIZE on Linux, plus a host-side check on every OS).
// Everything the worker writes is untrusted. This module returns raw bytes;
// callers parse them with a strict schema (see schema.ts) before use.
//
// `enforcement` reports what is actually enforced on this OS. A limit listed in
// `require` that cannot be enforced makes the run fail closed before spawning.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SandboxLimits {
  /** Wall-clock limit. The whole process tree is killed when it runs out. */
  timeoutMs: number;
  /** Address-space cap (RLIMIT_AS) for the worker and its children. */
  memoryBytes: number;
  /** Largest file the worker may write, and the largest total size of its output directory. */
  maxOutputBytes: number;
  /** stdout + stderr kept for diagnostics; the rest is dropped. */
  maxLogBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: 5 * 60_000,
  memoryBytes: 3 * 1024 ** 3,
  maxOutputBytes: 16 * 1024 ** 2,
  maxLogBytes: 256 * 1024,
};

/** Paths inside the private work directory, handed to the argument builder. */
export interface WorkPaths {
  /** The read-only copy of the input file. Its name is fixed, never the user's file name. */
  input: string;
  /** The only directory the worker is meant to write results to. */
  outDir: string;
  /** Scratch space (project files, caches). Also the worker's HOME and TMPDIR. */
  scratch: string;
  /** Private files the caller staged (e.g. verified scripts), read-only. */
  staged: string;
}

export type Enforceable = "network" | "memory";

export interface SandboxRequest {
  /** Absolute path of the program to run. Never resolved through PATH. */
  command: string;
  args(paths: WorkPaths): string[];
  /** Host path of the file to analyze. Copied; the worker never gets this path. */
  input: string;
  /** Output file name, relative to outDir. */
  outputFile: string;
  /** Extra environment variables. Only names in EXTRA_ENV_ALLOWLIST are accepted. */
  env?: Record<string, string>;
  /** Files to stage read-only next to the input: name -> contents. */
  stage?: Record<string, Buffer>;
  limits?: Partial<SandboxLimits>;
  /** Limits that must be enforced, or the run is refused. Default: both. */
  require?: readonly Enforceable[];
}

export interface Enforcement {
  platform: NodeJS.Platform;
  network: "namespace" | "none";
  memory: "rlimit_as" | "none";
  fileSize: "rlimit_fsize" | "none";
  timeout: "kill_process_tree";
  output: "host_size_check";
  environment: "allowlist";
  input: "private_copy_readonly_mode";
  /** Writes elsewhere on disk are not blocked (no mount namespace or Landlock yet). */
  filesystem: "not_confined";
}

export type SandboxFailure =
  | "isolation_unavailable"
  | "spawn_failed"
  | "timeout"
  | "exit_code"
  | "no_output"
  | "output_too_large"
  | "output_not_regular_file"
  | "input_modified";

export type SandboxResult =
  | { ok: true; output: Buffer; log: string; enforcement: Enforcement; inputSha256: string; durationMs: number }
  | { ok: false; reason: SandboxFailure; detail: string; log: string; enforcement: Enforcement; exitCode: number | null; durationMs: number };

/** Environment variables a caller may pass through. Anything else is rejected. */
export const EXTRA_ENV_ALLOWLIST = ["JAVA_HOME", "MALLOC_ARENA_MAX"] as const;

const INPUT_NAME = "input.bin";

let cachedLinuxProbe: { unshare: string; prlimit: string } | null | undefined;

/** Finds `unshare` and `prlimit` and checks that an unprivileged network namespace can be created. */
function probeLinux(): { unshare: string; prlimit: string } | null {
  if (cachedLinuxProbe !== undefined) return cachedLinuxProbe;
  const find = (name: string): string | null => {
    for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      const p = path.join(dir, name);
      try {
        if (lstatSync(p).isFile() || lstatSync(p).isSymbolicLink()) return p;
      } catch {
        // not here
      }
    }
    return null;
  };
  const unshare = find("unshare");
  const prlimit = find("prlimit");
  if (!unshare || !prlimit) return (cachedLinuxProbe = null);
  const r = spawnSync(unshare, [...UNSHARE_FLAGS, "--", "/bin/true"], { env: {}, timeout: 10_000, stdio: "ignore" });
  cachedLinuxProbe = r.status === 0 ? { unshare, prlimit } : null;
  return cachedLinuxProbe;
}

// New user + network + PID namespaces. The worker keeps its own uid (no fake root).
// --kill-child: if the runner kills `unshare`, everything inside the PID namespace dies with it.
const UNSHARE_FLAGS = ["--map-current-user", "--net", "--pid", "--fork", "--kill-child"];

/** What this machine enforces. Pure probe; spawns `unshare` once on Linux and caches the answer. */
export function sandboxEnforcement(): Enforcement {
  const linux = process.platform === "linux" ? probeLinux() : null;
  return {
    platform: process.platform,
    network: linux ? "namespace" : "none",
    memory: linux ? "rlimit_as" : "none",
    fileSize: linux ? "rlimit_fsize" : "none",
    timeout: "kill_process_tree",
    output: "host_size_check",
    environment: "allowlist",
    input: "private_copy_readonly_mode",
    filesystem: "not_confined",
  };
}

function minimalEnv(scratch: string, extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> =
    process.platform === "win32"
      ? {
          SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
          PATH: `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32`,
          TEMP: path.join(scratch, "tmp"),
          TMP: path.join(scratch, "tmp"),
          USERPROFILE: path.join(scratch, "home"),
        }
      : { PATH: "/usr/bin:/bin", HOME: path.join(scratch, "home"), TMPDIR: path.join(scratch, "tmp"), LANG: "C.UTF-8" };
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (!(EXTRA_ENV_ALLOWLIST as readonly string[]).includes(k)) throw new Error(`environment variable not allowed: ${k}`);
    if (v.includes("\0") || v.length > 4096) throw new Error(`bad value for ${k}`);
    env[k] = v;
  }
  return env;
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : lstatSync(p).size;
  }
  return total;
}

/** Reads a regular file without following a symlink, up to `max` bytes. */
function readCapped(file: string, max: number): { data: Buffer } | { error: "missing" | "not_regular" | "too_large" } {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { error: "missing" };
    return { error: "not_regular" }; // ELOOP: a symlink planted by the worker
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { error: "not_regular" };
    if (st.size > max) return { error: "too_large" };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { data: buf.subarray(0, off) };
  } finally {
    closeSync(fd);
  }
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync(path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // the worker leads its own process group
  } catch {
    // already gone
  }
}

export async function runSandboxed(req: SandboxRequest): Promise<SandboxResult> {
  const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...req.limits };
  const enforcement = sandboxEnforcement();
  const started = Date.now();
  const fail = (reason: SandboxFailure, detail: string, log = "", exitCode: number | null = null): SandboxResult => ({
    ok: false,
    reason,
    detail,
    log,
    enforcement,
    exitCode,
    durationMs: Date.now() - started,
  });

  const required = req.require ?? (["network", "memory"] as const);
  if (required.includes("network") && enforcement.network === "none") return fail("isolation_unavailable", "network isolation is not available on this system");
  if (required.includes("memory") && enforcement.memory === "none") return fail("isolation_unavailable", "a memory cap is not available on this system");
  if (!path.isAbsolute(req.command)) return fail("spawn_failed", "command must be an absolute path");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(req.outputFile)) return fail("spawn_failed", "bad output file name");

  const work = mkdtempSync(path.join(os.tmpdir(), "p4m3-analysis-"));
  try {
    chmodSync(work, 0o700);
    const paths: WorkPaths = {
      input: path.join(work, "in", INPUT_NAME),
      outDir: path.join(work, "out"),
      scratch: path.join(work, "scratch"),
      staged: path.join(work, "staged"),
    };
    for (const d of [path.dirname(paths.input), paths.outDir, paths.staged, path.join(paths.scratch, "home"), path.join(paths.scratch, "tmp")]) mkdirSync(d, { recursive: true });

    copyFileSync(req.input, paths.input);
    const inputSha256 = sha256File(paths.input);
    for (const [name, data] of Object.entries(req.stage ?? {})) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return fail("spawn_failed", "bad staged file name");
      const p = path.join(paths.staged, name);
      mkdirSync(path.dirname(p), { recursive: true });
      // Written fresh into the private directory, then made read-only.
      writeFileSync(p, data, { flag: "wx", mode: 0o600 });
      chmodSync(p, 0o444);
    }
    chmodSync(paths.input, 0o444);
    chmodSync(path.dirname(paths.input), 0o555);
    chmodSync(paths.staged, 0o555);

    let env: Record<string, string>;
    try {
      env = minimalEnv(paths.scratch, req.env);
    } catch (err) {
      return fail("spawn_failed", (err as Error).message);
    }

    const args = req.args(paths);
    let command = req.command;
    let argv = args;
    const linux = process.platform === "linux" ? probeLinux() : null;
    if (linux) {
      argv = [
        `--as=${Math.floor(limits.memoryBytes)}`,
        `--fsize=${Math.floor(limits.maxOutputBytes)}`,
        "--core=0",
        "--",
        linux.unshare,
        ...UNSHARE_FLAGS,
        "--",
        req.command,
        ...args,
      ];
      command = linux.prlimit;
    }

    const run = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; log: string; spawnError: string | null }>((resolve) => {
      let log = "";
      let logBytes = 0;
      let timedOut = false;
      let settled = false;
      const child = spawn(command, argv, {
        cwd: paths.scratch,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        shell: false,
      });
      const onData = (chunk: Buffer): void => {
        if (logBytes >= limits.maxLogBytes) return;
        const keep = chunk.subarray(0, limits.maxLogBytes - logBytes);
        logBytes += keep.length;
        log += keep.toString("utf8");
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) killTree(child.pid);
      }, limits.timeoutMs);
      const done = (code: number | null, signal: NodeJS.Signals | null, spawnError: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, signal, timedOut, log, spawnError });
      };
      child.on("error", (err) => done(null, null, err.message));
      child.on("close", (code, signal) => done(code, signal, null));
    });
    const log = run.log;

    if (run.spawnError) return fail("spawn_failed", run.spawnError.slice(0, 200), log);
    if (run.timedOut) return fail("timeout", `killed after ${limits.timeoutMs} ms`, log, run.code);
    if (sha256File(paths.input) !== inputSha256) return fail("input_modified", "the worker changed its input copy", log, run.code);
    if (run.code !== 0) return fail("exit_code", `exit ${run.code ?? run.signal ?? "?"}`, log, run.code);
    if (dirSize(paths.outDir) > limits.maxOutputBytes) return fail("output_too_large", "output directory is over the cap", log, 0);

    const read = readCapped(path.join(paths.outDir, req.outputFile), limits.maxOutputBytes);
    if ("error" in read) {
      const reason = read.error === "missing" ? "no_output" : read.error === "too_large" ? "output_too_large" : "output_not_regular_file";
      return fail(reason, read.error, log, 0);
    }
    return { ok: true, output: read.data, log, enforcement, inputSha256, durationMs: Date.now() - started };
  } finally {
    // The worker can leave read-only directories behind; make them removable first.
    makeWritable(work);
    rmSync(work, { recursive: true, force: true });
  }
}

function makeWritable(dir: string): void {
  try {
    chmodSync(dir, 0o700);
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) makeWritable(p);
      else if (!e.isSymbolicLink()) chmodSync(p, 0o600);
    }
  } catch {
    // best effort; rmSync with force still runs
  }
}
