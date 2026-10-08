// Filesystem half of S2. Runs after canonicalizeRelative() succeeds.
//
// Rules:
//  - The workspace root itself must be a real directory (not a link).
//  - No existing component of the path may be a symlink. On Windows, Node's
//    lstat reports junctions and directory symlinks as symbolic links, so this
//    rule covers junctions too (verified by the win32 test in CI).
//  - realpath of the deepest existing component must stay inside realpath(root)
//    (defense in depth if a link is created between checks).
//  - For writes, an existing target file with more than one hard link is
//    rejected: the other link may live outside the workspace.
//
// Known gap (THREAT_MODEL.md T-FS-1): this is a check-then-use pattern. A local
// attacker who can race the filesystem can still swap a component for a link
// after the check. The executor must open with no-follow semantics where the
// platform offers them; documented, not yet enforced.
import fs from "node:fs";
import path from "node:path";
import { canonicalizeRelative } from "../paths.js";

export type FsCheck = { ok: true; absolute: string } | { ok: false; rule: string; reason: string };

export interface FsCheckOptions {
  forWrite: boolean;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function checkWorkspacePath(workspaceRoot: string, relative: string, opts: FsCheckOptions): FsCheck {
  const canon = canonicalizeRelative(relative);
  if (!canon.ok) return canon;

  const rootStat = lstatOrNull(workspaceRoot);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { ok: false, rule: "fs.root", reason: "workspace root missing or is a link" };
  }
  const realRoot = fs.realpathSync.native(workspaceRoot);

  let current = realRoot;
  let deepestExisting = realRoot;
  for (let i = 0; i < canon.segments.length; i++) {
    current = path.join(current, canon.segments[i] as string);
    const st = lstatOrNull(current);
    if (!st) break; // rest of the path does not exist yet; nothing to follow
    if (st.isSymbolicLink()) return { ok: false, rule: "fs.symlink", reason: "path component is a symlink or junction" };
    const isLast = i === canon.segments.length - 1;
    if (!isLast && !st.isDirectory()) return { ok: false, rule: "fs.not-dir", reason: "intermediate component is not a directory" };
    if (isLast && opts.forWrite && st.isFile() && st.nlink > 1) {
      return { ok: false, rule: "fs.hardlink", reason: "target file has multiple hard links" };
    }
    if (isLast && !st.isFile() && !st.isDirectory()) {
      return { ok: false, rule: "fs.special", reason: "target is a device, socket or FIFO" };
    }
    deepestExisting = current;
  }

  const realDeepest = fs.realpathSync.native(deepestExisting);
  if (!isInside(realDeepest, realRoot)) return { ok: false, rule: "fs.escape", reason: "resolved path leaves the workspace" };

  return { ok: true, absolute: path.join(realRoot, ...canon.segments) };
}
