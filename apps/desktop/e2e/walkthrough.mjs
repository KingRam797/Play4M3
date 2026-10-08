// F5 acceptance walkthrough against the real desktop app (Electron + StationService).
//   node e2e/walkthrough.mjs [screenshot-dir]
// Run under a display (xvfb-run on Linux CI) and as a non-root user (Chromium sandbox).
// The native approval dialog is stubbed ONLY here, through Playwright's handle on the
// main process; the shipped app has no way to skip it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const shots = path.resolve(process.argv[2] ?? path.join(appDir, "out", "e2e"));
mkdirSync(shots, { recursive: true });
const userData = mkdtempSync(path.join(os.tmpdir(), "p4m3-e2e-"));
const electronPath = createRequire(import.meta.url)("electron");

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
};

const app = await electron.launch({ executablePath: electronPath, args: [appDir], env: { ...process.env, P4M3_USER_DATA_DIR: userData } });
const errors = [];
try {
  const win = await app.firstWindow();
  win.on("pageerror", (e) => errors.push(String(e)));
  await win.setViewportSize({ width: 1280, height: 800 }).catch(() => {});

  // Loading screen waits for the continue button.
  await win.waitForFunction(() => document.body.dataset.loading === "ready", null, { timeout: 30000 });
  await win.waitForTimeout(1500);
  check("loading screen still up after loading finishes", (await win.evaluate(() => document.body.dataset.loading)) === "ready");
  await win.keyboard.press("Enter");

  // First run: ownership attestation.
  await win.waitForSelector('[data-station-root="attest"]', { timeout: 10000 });
  await win.screenshot({ path: path.join(shots, "1-attest.png") });
  check("Continue is disabled until the box is ticked", await win.locator("button.primary", { hasText: "Continue" }).isDisabled());
  await win.locator(".check input").check();
  await win.locator("button.primary", { hasText: "Continue" }).click();
  await win.waitForSelector('[data-station-root="workspace"]');
  check("attestation stored", existsSync(path.join(userData, "attestation.json")));

  // Open the sample project and explain a function.
  await win.locator("button", { hasText: "Open sample game" }).click();
  await win.waitForSelector('[data-fn="fn_4011e0"]');
  await win.locator('[data-fn="fn_4011e0"]').click();
  await win.waitForSelector(".explain .tunables");
  check("explain panel shows the tuning value", (await win.locator(".tunables").innerText()).includes("jump_velocity"));
  await win.screenshot({ path: path.join(shots, "2-explain.png") });

  // The planted injection is flagged, not obeyed.
  await win.locator('[data-fn="fn_401460"]').click();
  await win.waitForSelector(".explain .warn");
  check("injection in load_level is flagged as data", (await win.locator(".explain .warn").innerText()).includes("treats it as data"));
  await win.screenshot({ path: path.join(shots, "3-injection-flagged.png") });

  // Ask for a change by typing (back on player_jump).
  await win.locator('[data-fn="fn_4011e0"]').click();
  await win.locator("#command-text").fill("make the jump higher");
  await win.locator("button.primary", { hasText: "Send" }).click();
  await win.waitForSelector(".approvals .card");
  const card = await win.locator(".approvals .card").innerText();
  check("approval card shows the exact change", card.includes("jump_velocity") && card.includes("12") && card.includes("15") && card.includes("+25%"), card.replace(/\s+/g, " ").slice(0, 120));
  check("card marks data from the game file", card.includes("Uses data read from the game file"));
  await win.screenshot({ path: path.join(shots, "4-approval.png") });

  // Cancel in the native dialog: nothing written, still waiting.
  await app.evaluate(({ dialog }) => {
    globalThis.__prompts = [];
    dialog.showMessageBox = async (_w, o) => {
      globalThis.__prompts.push(o);
      return { response: 0, checkboxChecked: false };
    };
  });
  await win.locator(".approvals .card button.primary").click();
  await win.waitForSelector(".notice.info");
  check("cancel keeps the request waiting", (await win.locator(".approvals .card").count()) === 1);

  // Approve in the native dialog.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_w, o) => {
      globalThis.__prompts.push(o);
      return { response: 1, checkboxChecked: false };
    };
  });
  await win.locator(".approvals .card button.primary").click();
  await win.waitForSelector(".patches li");
  const prompts = await app.evaluate(() => globalThis.__prompts);
  const shown = JSON.stringify(prompts);
  check("native dialog shown twice (cancel, then approve)", prompts.length === 2);
  check("native dialog shows the change and no game symbol names", shown.includes("jump_velocity at 0x404010 (f32): 12 -> 15") && !shown.includes("player_jump") && !shown.includes("load_level"));

  const ws = path.join(userData, "workspaces");
  const project = readdirSync(ws)[0];
  const patchPath = path.join(ws, project, "mods", "jump-velocity-x1.25.p4m3patch.json");
  const patch = existsSync(patchPath) ? JSON.parse(readFileSync(patchPath, "utf8")) : null;
  check("patch file written in the project's mods folder", patch?.format === "play4m3-patch/0" && patch?.changes?.[0]?.after === 15);
  check("patch holds no game symbols", patch !== null && !JSON.stringify(patch).includes("player_jump"));

  // Activity log.
  await win.locator(".audit-toggle").click();
  await win.waitForSelector(".audit-rows li");
  check("activity log tamper check passes", (await win.locator(".chain").innerText()).includes("passed"));
  await win.screenshot({ path: path.join(shots, "5-after-approve-audit.png") });

  // Narrow window still usable.
  await win.setViewportSize({ width: 900, height: 700 }).catch(() => {});
  await win.screenshot({ path: path.join(shots, "6-narrow.png") });
} catch (err) {
  check(`walkthrough threw: ${String(err).slice(0, 300)}`, false);
} finally {
  check(`no renderer errors (${errors.length})`, errors.length === 0, errors.join(" | ").slice(0, 300));
  await app.close();
}
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
