// First-party skill manifests (S12). Skills are bundled with the app and pinned
// by sha256; nothing is fetched at runtime. A skill file whose bytes do not
// match its pin is refused. Signing the manifest itself is not built yet
// (docs/PROGRESS.md, S12).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillFile {
  /** Path relative to the skills root. */
  path: string;
  sha256: string;
}

export interface SkillManifest {
  id: string;
  version: string;
  description: string;
  /** External tool the skill drives. User- or CI-installed, never bundled. */
  requires: { tool: string; version: string; license: string };
  files: readonly SkillFile[];
}

export const GHIDRA_HEADLESS: SkillManifest = {
  id: "ghidra-headless",
  version: "0.1.0",
  description: "Static analysis with Ghidra in headless mode. Exports function names, addresses, sizes, referenced strings and referenced globals.",
  requires: { tool: "ghidra", version: "12.1.4", license: "Apache-2.0" },
  files: [{ path: "ghidra-headless/P4m3ExportFunctions.java", sha256: "ec6bdd0bea0fec200e947c6317d681639ab1add09bc10ce6ba4b76f00d1c6514" }],
};

export const SKILLS: readonly SkillManifest[] = [GHIDRA_HEADLESS];

export class SkillIntegrityError extends Error {
  override name = "SkillIntegrityError";
}

/** Directory holding the bundled skill files (the package root in development). */
export function defaultSkillsRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** Reads a skill file and checks it against its pin. Throws SkillIntegrityError on any mismatch. */
export function readVerifiedSkillFile(skill: SkillManifest, file: string, root: string = defaultSkillsRoot()): Buffer {
  const entry = skill.files.find((f) => f.path === file);
  if (!entry) throw new SkillIntegrityError(`${skill.id}: ${file} is not part of the skill`);
  let data: Buffer;
  try {
    data = readFileSync(path.join(root, entry.path));
  } catch {
    throw new SkillIntegrityError(`${skill.id}: ${file} is missing`);
  }
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== entry.sha256) throw new SkillIntegrityError(`${skill.id}: ${file} does not match its pinned sha256`);
  return data;
}
