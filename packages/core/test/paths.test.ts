// S2: path canonicalization. Table-driven; every row is an attack the policy
// engine must reject (or a benign path it must accept unchanged).
import { describe, expect, it } from "vitest";
import { canonicalizeRelative, isWithinScope } from "../src/paths.js";

const accept: Array<[string, string]> = [
  ["src/main.c", "src/main.c"],
  ["src\\main.c", "src/main.c"],
  ["./src//main.c", "src/main.c"],
  ["mods/my mod/patch.json", "mods/my mod/patch.json"],
  ["a/.hidden", "a/.hidden"],
  ["café/notes.txt", "café/notes.txt"],
  ["consolation.txt", "consolation.txt"],
  ["tilde~in~name.txt", "tilde~in~name.txt"],
];

const reject: Array<[string, string, string]> = [
  // traversal
  ["dotdot", "../secrets", "path.traversal"],
  ["dotdot mid", "a/../../b", "path.traversal"],
  ["dotdot backslash", "a\\..\\..\\b", "path.traversal"],
  ["dotdot trailing", "a/..", "path.traversal"],
  ["triple dot", "a/.../b", "path.dots"],
  // absolute
  ["posix absolute", "/etc/passwd", "path.absolute"],
  ["windows root-relative", "\\Windows\\System32", "path.absolute"],
  ["home", "~/.ssh/id_rsa", "path.home"],
  // drive letters
  ["drive absolute", "C:\\Windows\\win.ini", "path.drive"],
  ["drive forward", "c:/Windows/win.ini", "path.drive"],
  ["drive relative", "C:secrets.txt", "path.drive"],
  // UNC and device namespaces
  ["unc", "\\\\attacker\\share\\x", "path.unc"],
  ["unc forward", "//attacker/share/x", "path.unc"],
  ["unc mixed", "\\/attacker/share", "path.unc"],
  ["win32 file namespace", "\\\\?\\C:\\Windows", "path.unc"],
  ["win32 device namespace", "\\\\.\\PhysicalDrive0", "path.unc"],
  ["nt object namespace", "\\??\\C:\\x", "path.unc"],
  ["unc long", "\\\\?\\UNC\\server\\share", "path.unc"],
  // alternate data streams
  ["ads named", "notes.txt:hidden", "path.ads"],
  ["ads $DATA", "notes.txt::$DATA", "path.ads"],
  ["ads in dir", "dir:stream/file", "path.ads"],
  ["ads index alloc", "dir::$INDEX_ALLOCATION/x", "path.ads"],
  // 8.3 short names
  ["short name dir", "PROGRA~1/app.exe", "path.short-name"],
  ["short name file", "LONGFI~1.TXT", "path.short-name"],
  ["short name two digits", "a/ABCDEF~12", "path.short-name"],
  // reserved device names
  ["con", "CON", "path.reserved-name"],
  ["nul ext", "nul.txt", "path.reserved-name"],
  ["com1 nested", "a/COM1.log", "path.reserved-name"],
  ["lpt9", "lpt9", "path.reserved-name"],
  ["com superscript", "COM\u00b9", "path.reserved-name"],
  ["conin", "CONIN$", "path.reserved-name"],
  // trailing dot/space (Windows strips them, so "a." aliases "a")
  ["trailing dot", "secret.", "path.trailing-dot-space"],
  ["trailing space", "secret ", "path.trailing-dot-space"],
  ["trailing dot dir", "dir./x", "path.trailing-dot-space"],
  ["leading space", " a/b", "path.leading-space"],
  // forbidden characters
  ["wildcard", "a/*.txt", "path.forbidden-char"],
  ["question", "a?b", "path.forbidden-char"],
  ["pipe", "a|b", "path.forbidden-char"],
  ["angle", "a<b", "path.forbidden-char"],
  ["quote", 'a"b', "path.forbidden-char"],
  // control and invisible characters
  ["nul byte", "a\u0000b", "path.control"],
  ["newline", "a\nb", "path.control"],
  ["rtl override", "evil\u202etxt.exe", "path.format-char"],
  ["zero width joiner", "a\u200db", "path.format-char"],
  ["unicode tag chars", "a\u{E0041}b", "path.format-char"],
  ["non-NFC", "cafe\u0301", "path.unicode-normalization"],
  // empties
  ["empty", "", "path.empty"],
  ["root only", ".", "path.empty"],
  ["slashes only", "./", "path.empty"],
  // size
  ["too long", "a/".repeat(600), "path.length"],
  ["too deep", "a/".repeat(80), "path.depth"],
];

describe("S2 canonicalizeRelative", () => {
  it.each(accept)("accepts %j", (input, expected) => {
    const r = canonicalizeRelative(input);
    expect(r).toMatchObject({ ok: true, path: expected });
  });

  it.each(reject)("rejects %s", (_name, input, rule) => {
    const r = canonicalizeRelative(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe(rule);
  });

  it("rejects non-string input", () => {
    expect(canonicalizeRelative(42 as unknown as string).ok).toBe(false);
  });
});

describe("S2 isWithinScope", () => {
  it.each([
    ["mods/a.json", "mods", true],
    ["mods", "mods", true],
    ["MODS/a.json", "mods", true],
    ["mods2/a.json", "mods", false],
    ["modsx", "mods", false],
    ["other/mods/a.json", "mods", false],
  ] as const)("%s in %s => %s", (p, scope, expected) => {
    expect(isWithinScope(p, scope)).toBe(expected);
  });
});
