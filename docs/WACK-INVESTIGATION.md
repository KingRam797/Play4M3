# Focused WACK investigation — 2026-10-10

## Evidence and scope

PR #1 inspected at `226579e9fadf551d4dbb41d13fb2022c4d4f8128`.
Existing run: https://github.com/KingRam797/Play4M3/actions/runs/37781569137
Artifact ID: `11552267585`, `msix-spike`.
Downloaded ZIP SHA-256: `0917b2ca7ad612947bd4464ca8ecd2d6fa99e3beaa49b42560f8447318a30ef1`, matching GitHub metadata.
`evidence/wack-original-failures.xml` preserves all 30 messages: two resource errors and 28 blocked-executable diagnostics. These are historical results, not checks rerun in this session.

No full tests, CI, smoke suite, or overall WACK were rerun. No Windows process trace has run yet. Publishing the dedicated verification branch was rejected by automatic approval review pending explicit authorization for the push and workflow execution.

## Verified resource defect and correction

The original AppX contains unqualified `assets/Square150x150Logo.png` at 300x300 and `assets/Wide310x150Logo.png` at 620x300. Its manifest references those exact unqualified filenames. WACK expects 150x150 and 310x150. StoreLogo (50x50) and Square44x44Logo (44x44) were not flagged.

Added `apps/desktop/build/appx/Square150x150Logo.png` (150x150) and `Wide310x150Logo.png` (310x150), rendered from the repository's existing `apps/web/public/favicon.svg`. Wide artwork is centered on the icon's existing #070914 background. No generated brand redesign or packaging identity changes. Existing `directories.buildResources: build` discovers these overrides.

Source PNG metadata verified locally. Rebuilt-package dimensions and focused WACK result: NOT RUN.

## Blocked-executable classification

| Reported file | Reported references | Classification |
| --- | --- | --- |
| Creation Station.exe | CreateProcessW; CMd, Cdb, ReG, cSi, DNx, cmd.exe, bash | Native Electron process-launch capability and name matches. Specific reachable launch of a banned external program remains unverified. |
| chrome_200_percent.pak | ReG, Cmd | Chromium resource name matches; no runtime launch established. |
| d3dcompiler_47.dll | reg, cmd | Native dependency matches; no runtime launch established. |
| dxcompiler.dll | CDb, BasH, Dnx, reg | Native dependency matches; no runtime launch established. |
| icudtl.dat | Reg | Data-file match; no runtime launch established. |
| resources.pak | CDB, reG, dnX, CSi, cmd, BASh | Chromium resource matches; no runtime launch established. |
| vk_swiftshader.dll | reg | Native dependency match; no runtime launch established. |
| af.pak, sv.pak | reg in each | Locale resource matches; no runtime launch established. |
| zh-CN.pak | Cmd | Locale resource match; no runtime launch established. |
| app.asar | reg | Zod's bundled `register(reg, meta3) { reg.add(this, meta3); }` provides an innocent candidate. The report lacks offsets, so this exact attribution is not proven. |

The original AppX contains only one .exe, `app/Creation%20Station.exe` (ZIP-encoded filename). It does not bundle cmd.exe, reg.exe, bash.exe, or the other named executables.

Inspected the actual ASAR main bundle, not only repository text. Its external require targets are `electron`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:path`. No occurrences of `child_process`, `cmd.exe`, `powershell`, `taskkill`, `runSandboxed`, or `analyzeWithGhidra` were found in that bundle. The desktop IPC handlers construct StationService and operate on the demo; they do not expose the standalone analyzer runner. `packages/analysis/src/sandbox.ts` has real process creation, including taskkill for Windows cleanup, but this runner is not in the inspected main bundle. This finding is bounded to this build and does not prove all Electron native paths harmless.

No runtime binary stripping, string patching, dependency upgrades, or fuse changes are justified by this evidence. Retain native launch capabilities required by Electron; investigate actual prohibited external launches if a trace finds them.

## Focused verification implementation

1. The dedicated `wack-focused` workflow is restricted to `codex/wack-focused-fixes`. Existing CI and full WACK push filters do not match it. Opening a PR or pushing to PR #1's `claude/**` branch would trigger broad validation, so neither is part of this verification step.
2. Build the corrected AppX once, extract its manifest, assert the two actual packaged PNG dimensions, and record its hash. Read installed `appcert /?` and `querytestids`; do not infer command selectors from XML INDEX attributes.
3. Review those installed-kit outputs and pass the two verified IDs to `scripts/run-wack-selected.ps1`. This script has no full-suite fallback, preserves every diagnostic, requires both named results, flags unexpected extra results, and requires App resources PASS. A remaining Blocked executables FAIL is reported, not suppressed.
4. `scripts/trace-packaged-launch.ps1` uses Windows process-start events and a separate positive control. It observes the unpacked packaged executable's fresh launch, Enter input attempt, and close, recording the root and descendant process names/PIDs. No remote debugging or security fuse changes. This initial trace does not claim installed-package activation or subsequent Station operations were exercised. Expanded interaction/installed-package traces remain necessary if reachable launch paths or unexpected descendants warrant them.
5. Original workflow diagnostic output now prints every full MESSAGE XML entry instead of limiting to 15 entries and 400 characters. The existing full report artifact remains intact.

## Independent outstanding evidence

Physical Xbox-controller run and the four manual S8 checklist items remain NOT RUN. Historical WACK ran static Centennial checks without application deployment. No Store-readiness claim follows from this investigation.

## Official references checked

- https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests — unqualified resources default to scale 100; distinguish external executable launches from app-owned references. The inspected XML marks both findings optional; documentation classifies resource validation among required tests, so optional status is not generalized to Store submission.
- https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit — inspect installed `appcert.exe /?` for command capabilities.

## Next three

1. Obtain approval to push this reviewable branch and start its dedicated Windows workflow.
2. Review packaged dimensions, installed selectors, and process-tree artifacts; execute only the selected WACK checks using the reviewed IDs.
3. Record the resulting evidence here and integrate the corrections into PR #1 when broad CI execution is permitted.
