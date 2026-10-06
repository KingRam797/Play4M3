// Lexical path canonicalization (S2). Pure: no filesystem access, runs in the
// browser and in Node. Filesystem checks (symlinks, junctions, hard links) live
// in ./node/fsProbe.ts and run after this succeeds.
//
// Stance: reject anything ambiguous instead of trying to normalize it. A path
// that needs interpretation is a path an attacker can make mean two things.

export type PathResult = { ok: true; path: string; segments: string[] } | { ok: false; rule: string; reason: string };

const MAX_PATH_CHARS = 1024;
const MAX_SEGMENTS = 64;
const MAX_SEGMENT_CHARS = 255;

// Windows reserved device names, with or without an extension, any case.
// Includes the superscript digit variants Windows also treats as devices.
const RESERVED_DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|(com|lpt)[0-9\u00b9\u00b2\u00b3])(\..*)?$/i;
// 8.3 short-name aliases like PROGRA~1 or ABCDEF~12.TXT can alias a different long name.
const SHORT_NAME = /~[0-9]+(\.|$)/;
// Characters Windows forbids in names, plus ':' which also selects alternate data streams.
const WINDOWS_FORBIDDEN = /[<>:"|?*]/;
// ASCII control characters (NUL included).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// Unicode format characters (bidi overrides, zero-width joiners, tag characters).
const FORMAT_CHARS = /\p{Cf}/u;

function fail(rule: string, reason: string): PathResult {
  return { ok: false, rule, reason };
}

/**
 * Canonicalizes a workspace-relative path. Accepts '/' or '\' separators and
 * returns '/'-joined segments. Rejects absolute, UNC, device, drive-relative,
 * traversal, ADS, 8.3 short names, reserved names, trailing dot/space, control
 * and format characters, and non-NFC Unicode.
 */
export function canonicalizeRelative(input: string): PathResult {
  if (typeof input !== "string") return fail("path.type", "path must be a string");
  if (input.length === 0) return fail("path.empty", "empty path");
  if (input.length > MAX_PATH_CHARS) return fail("path.length", "path too long");
  if (CONTROL.test(input)) return fail("path.control", "control character in path");
  if (FORMAT_CHARS.test(input)) return fail("path.format-char", "invisible Unicode format character in path");
  if (input.normalize("NFC") !== input) return fail("path.unicode-normalization", "path is not NFC-normalized");

  // UNC (\\server\share), device namespaces (\\?\ \\.\ \??\), and //server forms.
  if (/^[\\/]{2}/.test(input) || input.startsWith("\\??\\")) return fail("path.unc", "UNC or device-namespace path");
  // Drive-absolute (C:\x), drive-relative (C:x) and any other drive-letter prefix.
  if (/^[A-Za-z]:/.test(input)) return fail("path.drive", "drive-letter path");
  // POSIX absolute or Windows root-relative (\x).
  if (input.startsWith("/") || input.startsWith("\\")) return fail("path.absolute", "absolute path");
  if (input.startsWith("~")) return fail("path.home", "home-directory shorthand");

  const raw = input.split(/[\\/]/);
  const segments: string[] = [];
  for (const seg of raw) {
    if (seg === "" || seg === ".") continue; // collapse a//b and ./a
    if (seg === "..") return fail("path.traversal", "'..' segment");
    if (seg.length > MAX_SEGMENT_CHARS) return fail("path.segment-length", "segment too long");
    if (/^\.{3,}$/.test(seg)) return fail("path.dots", "dot-only segment");
    if (WINDOWS_FORBIDDEN.test(seg)) {
      return seg.includes(":") ? fail("path.ads", "':' in segment (alternate data stream or drive)") : fail("path.forbidden-char", "character forbidden on Windows");
    }
    if (/[. ]$/.test(seg)) return fail("path.trailing-dot-space", "segment ends in dot or space (Windows strips these)");
    if (/^ /.test(seg)) return fail("path.leading-space", "segment starts with space");
    if (RESERVED_DEVICE.test(seg) || RESERVED_DEVICE.test(seg.replace(/[ .]+$/, ""))) return fail("path.reserved-name", "Windows reserved device name");
    if (SHORT_NAME.test(seg)) return fail("path.short-name", "8.3 short-name alias");
    segments.push(seg);
  }
  if (segments.length === 0) return fail("path.empty", "path resolves to the workspace root");
  if (segments.length > MAX_SEGMENTS) return fail("path.depth", "too many segments");
  return { ok: true, path: segments.join("/"), segments };
}

/**
 * True if `path` (canonical) equals or is inside `scope` (canonical).
 * Comparison is case-insensitive because the Windows filesystem is.
 */
export function isWithinScope(path: string, scope: string): boolean {
  const p = path.toLowerCase();
  const s = scope.toLowerCase();
  return p === s || p.startsWith(`${s}/`);
}
