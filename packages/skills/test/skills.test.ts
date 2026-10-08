// S12 (partial): bundled skill files are pinned by sha256 and a mismatch is refused.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GHIDRA_HEADLESS, SKILLS, SkillIntegrityError, defaultSkillsRoot, readVerifiedSkillFile } from "../src/index.js";

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("skill pins", () => {
  it("every bundled file matches its pin", () => {
    for (const skill of SKILLS) for (const f of skill.files) expect(readVerifiedSkillFile(skill, f.path).length).toBeGreaterThan(0);
  });

  it("refuses a tampered file", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "p4m3-skills-"));
    cpSync(path.join(defaultSkillsRoot(), "ghidra-headless"), path.join(tmp, "ghidra-headless"), { recursive: true });
    const file = GHIDRA_HEADLESS.files[0]?.path ?? "";
    writeFileSync(path.join(tmp, file), "// tampered\n", { flag: "a" });
    expect(() => readVerifiedSkillFile(GHIDRA_HEADLESS, file, tmp ?? "")).toThrow(SkillIntegrityError);
  });

  it("refuses files that are not in the manifest, and missing files", () => {
    expect(() => readVerifiedSkillFile(GHIDRA_HEADLESS, "ghidra-headless/Other.java")).toThrow(SkillIntegrityError);
    tmp = mkdtempSync(path.join(os.tmpdir(), "p4m3-skills-"));
    expect(() => readVerifiedSkillFile(GHIDRA_HEADLESS, GHIDRA_HEADLESS.files[0]?.path ?? "", tmp ?? "")).toThrow(SkillIntegrityError);
  });

  it("the Ghidra skill never bundles Ghidra and pins the verified version", () => {
    expect(GHIDRA_HEADLESS.requires).toEqual({ tool: "ghidra", version: "12.1.4", license: "Apache-2.0" });
    expect(GHIDRA_HEADLESS.files.every((f) => f.path.endsWith(".java"))).toBe(true);
  });
});
