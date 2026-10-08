// The ghidra-headless runner checks the install and the pinned skill script
// before it starts anything.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSkillsRoot } from "@play4m3/skills";
import { analyzeWithGhidra, checkGhidraInstall } from "../src/index.js";
import type { GhidraInstall } from "../src/index.js";

let tmp: string;
let install: GhidraInstall;

/** A fake install with the files the runner looks at. Nothing in it can run. */
function fakeInstall(version = "12.1.4", vmArgs = "VMARGS=-Dfile.encoding=UTF8\nVMARGS_LINUX=-Dsun.java2d.xrender=true\n"): GhidraInstall {
  const ghidraDir = path.join(tmp, `ghidra-${version}`);
  mkdirSync(path.join(ghidraDir, "Ghidra", "Framework", "Utility", "lib"), { recursive: true });
  mkdirSync(path.join(ghidraDir, "support"), { recursive: true });
  writeFileSync(path.join(ghidraDir, "Ghidra", "application.properties"), `application.name=Ghidra\napplication.version=${version}\n`);
  writeFileSync(path.join(ghidraDir, "Ghidra", "Framework", "Utility", "lib", "Utility.jar"), "");
  writeFileSync(path.join(ghidraDir, "support", "launch.properties"), `# comment\n${vmArgs}`);
  const javaHome = path.join(tmp, "jdk");
  mkdirSync(path.join(javaHome, "bin"), { recursive: true });
  writeFileSync(path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"), "");
  return { ghidraDir, javaHome };
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "p4m3-ghidra-"));
  install = fakeInstall();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("checkGhidraInstall", () => {
  it("accepts the pinned version and reads the VM arguments for this OS", () => {
    const c = checkGhidraInstall(install);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.vmArgs).toContain("-Dfile.encoding=UTF8");
      expect(c.vmArgs.includes("-Dsun.java2d.xrender=true")).toBe(process.platform === "linux");
    }
  });

  it("refuses another Ghidra version", () => {
    expect(checkGhidraInstall(fakeInstall("11.0"))).toMatchObject({ ok: false });
  });

  it("refuses launch.properties values that are not plain JVM options", () => {
    expect(checkGhidraInstall(fakeInstall("12.1.4", "VMARGS=-Dx=1 ; rm -rf /\n"))).toMatchObject({ ok: false });
    expect(checkGhidraInstall(fakeInstall("12.1.4", "VMARGS=$(id)\n"))).toMatchObject({ ok: false });
  });

  it("refuses a missing java or launcher", () => {
    expect(checkGhidraInstall({ ...install, javaHome: path.join(tmp, "nope") })).toMatchObject({ ok: false });
    expect(checkGhidraInstall({ ...install, ghidraDir: path.join(tmp, "nope") })).toMatchObject({ ok: false });
  });
});

describe("analyzeWithGhidra", () => {
  it("refuses to run when the skill script does not match its pin", async () => {
    const skills = path.join(tmp, "skills");
    cpSync(path.join(defaultSkillsRoot(), "ghidra-headless"), path.join(skills, "ghidra-headless"), { recursive: true });
    writeFileSync(path.join(skills, "ghidra-headless", "P4m3ExportFunctions.java"), "// replaced\n");
    const input = path.join(tmp, "game.bin");
    writeFileSync(input, "x");
    const r = await analyzeWithGhidra({ install, input, skillsRoot: skills, require: [] });
    expect(r).toMatchObject({ ok: false, reason: "skill_integrity" });
  });

  it("refuses to run on a bad install before touching the input", async () => {
    const r = await analyzeWithGhidra({ install: { ...install, ghidraDir: path.join(tmp, "nope") }, input: path.join(tmp, "missing.bin") });
    expect(r).toMatchObject({ ok: false, reason: "install" });
  });
});
