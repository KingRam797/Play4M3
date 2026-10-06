#!/usr/bin/env node
// S11: fail the build on GPL/AGPL/LGPL (or any license not on the allowlist)
// in any installed dependency, dev included. Exceptions need an entry in
// scripts/license-exceptions.json AND a DECISIONS.md line.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Python-2.0",
  "MPL-2.0", // file-level copyleft; we never modify MPL files. Flag in DECISIONS if one is vendored.
]);
const COPYLEFT = /(^|[^A-Z])(A?GPL|LGPL|SSPL|EUPL|OSL|CPAL|RPL|CC-BY-NC|CC-BY-SA)/i;

const exceptions = JSON.parse(readFileSync(new URL("./license-exceptions.json", import.meta.url), "utf8"));

function allowed(expr) {
  const clean = expr.replace(/[()]/g, " ").trim();
  return clean.split(/\s+OR\s+/i).some((branch) => branch.split(/\s+AND\s+/i).every((id) => ALLOWED.has(id.trim().replace(/\+$/, ""))));
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const raw = execFileSync(pnpm, ["licenses", "list", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
const byLicense = JSON.parse(raw);

const failures = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const pkg of pkgs) {
    count++;
    if (pkg.name.startsWith("@play4m3/")) continue;
    const key = `${pkg.name}@${pkg.versions.join(",")}`;
    if (exceptions[pkg.name]) continue;
    if (COPYLEFT.test(license) && !allowed(license)) failures.push(`${key}: copyleft license ${license}`);
    else if (!allowed(license)) failures.push(`${key}: license not on allowlist: ${license}`);
  }
}

if (failures.length > 0) {
  console.error("license-scan: FAILED");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`license-scan: ok (${count} packages)`);
