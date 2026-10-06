#!/usr/bin/env node
// Scans every git-tracked and staged file for secret patterns. CI also runs
// gitleaks over full history; this is the fast local gate (brief §1.5).
// Test fixtures that need fake secrets must build them at runtime (string
// concatenation) so the literal never sits in the repo.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { findSecrets } from "../packages/core/src/secrets.ts";

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const MAX_BYTES = 2 * 1024 * 1024;
let hits = 0;
for (const f of files) {
  let st;
  try {
    st = statSync(f);
  } catch {
    continue; // deleted in working tree
  }
  if (!st.isFile() || st.size > MAX_BYTES) continue;
  const text = readFileSync(f, "utf8");
  if (text.includes("\u0000")) continue; // binary
  const found = findSecrets(text);
  if (found.length > 0) {
    hits++;
    console.error(`secret-scan: ${f}: ${found.join(", ")}`);
  }
}
if (hits > 0) {
  console.error(`secret-scan: FAILED (${hits} file(s))`);
  process.exit(1);
}
console.log(`secret-scan: ok (${files.length} files)`);
