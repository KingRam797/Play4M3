// S2 filesystem half: symlinks, junctions, hard links, escapes.
// Junction cases only run on Windows (the windows-latest CI job).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkWorkspacePath } from "../src/node/fsProbe.js";

const isWin = process.platform === "win32";
let tmp: string;
let root: string;
let outside: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p4m3-fs-"));
  root = path.join(tmp, "workspace");
  outside = path.join(tmp, "outside");
  fs.mkdirSync(path.join(root, "mods"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "s3cret");
  fs.writeFileSync(path.join(root, "mods", "ok.json"), "{}");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function trySymlink(target: string, link: string, type: "file" | "dir" | "junction"): boolean {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false; // unprivileged Windows cannot create symlinks; junction tests cover that case
  }
}

describe("S2 checkWorkspacePath", () => {
  it("accepts an existing file inside the workspace", () => {
    const r = checkWorkspacePath(root, "mods/ok.json", { forWrite: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absolute).toBe(path.join(fs.realpathSync.native(root), "mods", "ok.json"));
  });

  it("accepts a not-yet-existing file inside the workspace", () => {
    expect(checkWorkspacePath(root, "mods/new/deep/file.json", { forWrite: true }).ok).toBe(true);
  });

  it("rejects lexical attacks before touching the filesystem", () => {
    expect(checkWorkspacePath(root, "../outside/secret.txt", { forWrite: false })).toMatchObject({ ok: false, rule: "path.traversal" });
  });

  it.skipIf(isWin)("rejects a file symlink pointing outside", () => {
    expect(trySymlink(path.join(outside, "secret.txt"), path.join(root, "mods", "link.txt"), "file")).toBe(true);
    expect(checkWorkspacePath(root, "mods/link.txt", { forWrite: false })).toMatchObject({ ok: false, rule: "fs.symlink" });
  });

  it.skipIf(isWin)("rejects a directory symlink in the middle of the path", () => {
    expect(trySymlink(outside, path.join(root, "mods", "escape"), "dir")).toBe(true);
    expect(checkWorkspacePath(root, "mods/escape/secret.txt", { forWrite: false })).toMatchObject({ ok: false, rule: "fs.symlink" });
  });

  it.skipIf(isWin)("rejects a symlink even when it points inside the workspace", () => {
    expect(trySymlink(path.join(root, "mods", "ok.json"), path.join(root, "alias.json"), "file")).toBe(true);
    expect(checkWorkspacePath(root, "alias.json", { forWrite: false })).toMatchObject({ ok: false, rule: "fs.symlink" });
  });

  it("rejects a workspace root that is itself a link", () => {
    const linkRoot = path.join(tmp, "root-link");
    if (!trySymlink(root, linkRoot, isWin ? "junction" : "dir")) return;
    expect(checkWorkspacePath(linkRoot, "mods/ok.json", { forWrite: false })).toMatchObject({ ok: false, rule: "fs.root" });
  });

  it("rejects writes to a file with multiple hard links", () => {
    const target = path.join(outside, "secret.txt");
    fs.linkSync(target, path.join(root, "mods", "hard.txt"));
    expect(checkWorkspacePath(root, "mods/hard.txt", { forWrite: true })).toMatchObject({ ok: false, rule: "fs.hardlink" });
    // Reads of hard-linked files are allowed; the content is untrusted either way.
    expect(checkWorkspacePath(root, "mods/hard.txt", { forWrite: false }).ok).toBe(true);
  });

  it("rejects a path that goes through a file", () => {
    expect(checkWorkspacePath(root, "mods/ok.json/x", { forWrite: true })).toMatchObject({ ok: false, rule: "fs.not-dir" });
  });

  it.runIf(isWin)("rejects an NTFS junction pointing outside", () => {
    fs.symlinkSync(outside, path.join(root, "mods", "junction"), "junction");
    expect(checkWorkspacePath(root, "mods/junction/secret.txt", { forWrite: false })).toMatchObject({ ok: false, rule: "fs.symlink" });
  });

  it.runIf(isWin)("rejects an NTFS junction as the final component", () => {
    fs.symlinkSync(outside, path.join(root, "mods", "junction2"), "junction");
    expect(checkWorkspacePath(root, "mods/junction2", { forWrite: true })).toMatchObject({ ok: false, rule: "fs.symlink" });
  });
});
