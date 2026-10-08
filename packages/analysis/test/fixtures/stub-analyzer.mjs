// A misbehaving stand-in for an analyzer, used by the S13 limit tests.
// Usage: node stub-analyzer.mjs <outDir> <mode> [arg] [inputPath]
// Each mode tries to break one limit and records what happened in
// <outDir>/analysis.json, so the test can tell "blocked" from "never tried".
import { spawn } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const [outDir, mode, arg, input] = process.argv.slice(2);
const out = path.join(outDir, "analysis.json");
const record = (value) => writeFileSync(out, JSON.stringify(value));

switch (mode) {
  case "ok":
    writeFileSync(out, arg ?? "{}");
    break;
  case "env":
    record({ keys: Object.keys(process.env).sort(), cwd: process.cwd() });
    break;
  case "sleep":
    setTimeout(() => record({ woke: true }), 60_000);
    break;
  case "fork-sleep": {
    // A grandchild that outlives its parent unless the whole tree is killed.
    // If it survives, it writes `arg` (a host path) after 2.5 s.
    const code = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(arg)}, "survived"), 2500); setInterval(() => {}, 1000);`;
    spawn(process.execPath, ["-e", code], { stdio: "ignore" });
    setInterval(() => {}, 1000);
    break;
  }
  case "alloc": {
    const want = Number(arg);
    const chunks = [];
    try {
      for (let got = 0; got < want; got += 64 * 1024 * 1024) chunks.push(Buffer.alloc(64 * 1024 * 1024, 1));
      record({ alloc: "ok" });
    } catch (err) {
      record({ alloc: "failed", error: err.name });
    }
    break;
  }
  case "net": {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      record(value);
      sock.destroy();
    };
    const sock = net.connect({ host: "127.0.0.1", port: Number(arg) });
    const timer = setTimeout(() => settle({ net: "failed", error: "timeout" }), 3000);
    sock.on("connect", () => settle({ net: "connected" }));
    sock.on("error", (err) => settle({ net: "failed", error: err.code }));
    break;
  }
  case "write-input": {
    const results = {};
    try {
      writeFileSync(input, "patched by the worker");
      results.file = "written";
    } catch (err) {
      results.file = err.code;
    }
    try {
      writeFileSync(path.join(path.dirname(input), "extra.bin"), "x");
      results.dir = "written";
    } catch (err) {
      results.dir = err.code;
    }
    record(results);
    break;
  }
  case "big-file":
    writeFileSync(out, Buffer.alloc(Number(arg), 0x61));
    break;
  case "many-files":
    for (let i = 0; i < 3; i++) writeFileSync(path.join(outDir, `part${i}.bin`), Buffer.alloc(Number(arg), 0x61));
    record({ parts: 3 });
    break;
  case "noisy":
    process.stdout.write("x".repeat(Number(arg)));
    record({ noisy: true });
    break;
  case "symlink":
    symlinkSync(arg, out);
    break;
  case "exit":
    process.exit(Number(arg));
    break;
  case "mkdir-ro":
    mkdirSync(path.join(outDir, "sub"), { mode: 0o500 });
    record({ ok: true });
    break;
  default:
    process.exit(2);
}
