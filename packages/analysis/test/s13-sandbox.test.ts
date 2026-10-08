// S13: one test per limit the analysis worker runner enforces, run against a
// stub analyzer that tries to break each one. Limits this OS cannot enforce
// are asserted as "none" in the enforcement report, so the report stays honest.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSandboxed, sandboxEnforcement } from "../src/index.js";
import type { SandboxRequest, SandboxResult } from "../src/index.js";

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "stub-analyzer.mjs");
const linux = process.platform === "linux";
const win = process.platform === "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

let tmp: string;
let input: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "p4m3-s13-"));
  input = path.join(tmp, "game.bin");
  writeFileSync(input, Buffer.from("not really a game, just bytes"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** Runs the stub. Off Linux the network/memory limits cannot be enforced, so tests opt out of requiring them. */
function stub(mode: string, arg = "", extra: Partial<SandboxRequest> = {}): Promise<SandboxResult> {
  return runSandboxed({
    command: process.execPath,
    args: (p) => [STUB, p.outDir, mode, arg, p.input],
    input,
    outputFile: "analysis.json",
    require: linux ? ["network", "memory"] : [],
    limits: { timeoutMs: 20_000, memoryBytes: 1024 ** 3 },
    ...extra,
  });
}

function json(r: SandboxResult): Record<string, unknown> {
  if (!r.ok) throw new Error(`run failed: ${r.reason} ${r.detail}\n${r.log}`);
  return JSON.parse(r.output.toString("utf8")) as Record<string, unknown>;
}

describe("enforcement report", () => {
  it("states what this OS enforces, and never claims filesystem confinement", () => {
    const e = sandboxEnforcement();
    expect(e.filesystem).toBe("not_confined");
    expect(e.timeout).toBe("kill_process_tree");
    if (linux) expect(e).toMatchObject({ network: "namespace", memory: "rlimit_as", fileSize: "rlimit_fsize" });
    else expect(e).toMatchObject({ network: "none", memory: "none", fileSize: "none" });
  });

  it.skipIf(linux)("fails closed when network isolation or a memory cap is required but unavailable", async () => {
    const r = await stub("ok", "{}", { require: undefined });
    expect(r).toMatchObject({ ok: false, reason: "isolation_unavailable" });
  });
});

describe("environment", () => {
  it("passes only the minimal environment: no inherited keys or tokens", async () => {
    process.env["P4M3_FAKE_SECRET"] = "s3cr3t-value";
    try {
      const out = json(await stub("env"));
      const keys = out["keys"] as string[];
      expect(keys).not.toContain("P4M3_FAKE_SECRET");
      const ours = win ? ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE"] : ["HOME", "LANG", "PATH", "TMPDIR"];
      // On Windows, libuv copies these from the parent when the child's env lacks them
      // (required for many Windows programs). Measured on windows-latest; none are secrets.
      const libuvWindows = ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"];
      const allowed = win ? [...ours, ...libuvWindows] : ours;
      // Windows also adds per-drive variables of its own (e.g. =C:); ignore those.
      const unexpected = keys.filter((k) => !k.startsWith("=") && !allowed.some((a) => a.toLowerCase() === k.toLowerCase()));
      expect(unexpected).toEqual([]);
    } finally {
      delete process.env["P4M3_FAKE_SECRET"];
    }
  });

  it("refuses extra variables outside the allowlist", async () => {
    const r = await stub("env", "", { env: { OPENAI_API_KEY: "x" } });
    expect(r).toMatchObject({ ok: false, reason: "spawn_failed" });
  });

  it("removes its private work directory afterwards", async () => {
    const out = json(await stub("env"));
    expect(typeof out["cwd"]).toBe("string");
    expect(existsSync(out["cwd"] as string)).toBe(false);
  });
});

describe("timeout", () => {
  it("kills the whole process tree when the wall clock runs out", async () => {
    const marker = path.join(tmp, "grandchild-survived");
    const started = Date.now();
    const r = await stub("fork-sleep", marker, { limits: { timeoutMs: 1000, memoryBytes: 1024 ** 3 } });
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(10_000);
    await new Promise((res) => setTimeout(res, 3500)); // the grandchild would have written by now
    expect(existsSync(marker)).toBe(false);
  });
});

describe.skipIf(!linux)("memory cap (Linux: RLIMIT_AS)", () => {
  it("lets the worker allocate below the cap (control)", async () => {
    expect(json(await stub("alloc", String(64 * 1024 ** 2)))).toMatchObject({ alloc: "ok" });
  });

  it("blocks allocations above the cap", async () => {
    expect(json(await stub("alloc", String(2 * 1024 ** 3)))).toMatchObject({ alloc: "failed" });
  });
});

describe.skipIf(!linux)("network (Linux: new network namespace)", () => {
  it("the worker cannot reach a server on the host's loopback", async () => {
    let connections = 0;
    const server = net.createServer((s) => {
      connections++;
      s.destroy();
    });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as net.AddressInfo).port;
    try {
      // Control: the same stub, run without the sandbox, does connect.
      // (Async spawn: a sync one would block this process's event loop and the server with it.)
      await new Promise<void>((res, rej) => execFile(process.execPath, [STUB, tmp, "net", String(port)], (err) => (err ? rej(err) : res())));
      expect(JSON.parse(readFileSync(path.join(tmp, "analysis.json"), "utf8"))).toMatchObject({ net: "connected" });
      await new Promise((res) => setTimeout(res, 100));
      const before = connections;
      expect(before).toBeGreaterThan(0);

      const out = json(await stub("net", String(port)));
      expect(out["net"]).toBe("failed");
      expect(connections).toBe(before);
    } finally {
      server.close();
    }
  });
});

describe("input", () => {
  it("never exposes or changes the user's file; changes to the private copy void the run", async () => {
    const original = readFileSync(input);
    const r = await stub("write-input");
    expect(readFileSync(input).equals(original)).toBe(true);
    if (isRoot) {
      // Root ignores permission bits, so the write lands on the private copy and the hash check catches it.
      expect(r).toMatchObject({ ok: false, reason: "input_modified" });
    } else {
      const out = json(r);
      expect(out["file"]).not.toBe("written");
      if (!win) expect(out["dir"]).not.toBe("written"); // directory mode bits are not enforced on Windows
    }
  });

  it("copies the input under a fixed name, never the user's file name", async () => {
    let seen = "";
    await runSandboxed({
      command: process.execPath,
      args: (p) => {
        seen = p.input;
        return [STUB, p.outDir, "ok", "{}"];
      },
      input,
      outputFile: "analysis.json",
      require: [],
    });
    expect(path.basename(seen)).toBe("input.bin");
    expect(seen.startsWith(tmp)).toBe(false);
  });
});

describe("output caps", () => {
  it("rejects an output file over the cap", async () => {
    const r = await stub("big-file", String(2 * 1024 ** 2), { limits: { maxOutputBytes: 1024 ** 2 } });
    expect(r.ok).toBe(false);
    // Linux: RLIMIT_FSIZE stops the write (the worker dies or fails); elsewhere the host-side check rejects it.
    if (!r.ok) expect(["exit_code", "output_too_large"]).toContain(r.reason);
  });

  it("rejects an output directory over the cap even when each file is small", async () => {
    const r = await stub("many-files", String(600 * 1024), { limits: { maxOutputBytes: 1024 ** 2 } });
    expect(r).toMatchObject({ ok: false, reason: "output_too_large" });
  });

  it("keeps at most maxLogBytes of stdout/stderr", async () => {
    const r = await stub("noisy", String(512 * 1024), { limits: { maxLogBytes: 4096 } });
    expect(r.ok).toBe(true);
    expect(Buffer.byteLength(r.log)).toBeLessThanOrEqual(4096);
  });

  it.skipIf(win)("refuses an output file that is a symlink (no reading host files through the worker)", async () => {
    const hostFile = path.join(tmp, "host-secret.json");
    writeFileSync(hostFile, '{"secret":true}');
    const r = await stub("symlink", hostFile);
    expect(r).toMatchObject({ ok: false, reason: "output_not_regular_file" });
  });

  it("reports a missing output and a non-zero exit", async () => {
    expect(await stub("exit", "0")).toMatchObject({ ok: false, reason: "no_output" });
    expect(await stub("exit", "3")).toMatchObject({ ok: false, reason: "exit_code", exitCode: 3 });
  });

  it("cleans up even when the worker leaves read-only directories behind", async () => {
    expect((await stub("mkdir-ro")).ok).toBe(true);
  });
});

describe("request validation", () => {
  it("requires an absolute command and a plain output name", async () => {
    expect(await stub("ok", "{}", { command: "node" })).toMatchObject({ ok: false, reason: "spawn_failed" });
    expect(await stub("ok", "{}", { outputFile: "../x.json" })).toMatchObject({ ok: false, reason: "spawn_failed" });
  });
});
