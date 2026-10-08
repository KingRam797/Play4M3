# Security

{{BRAND}} / The Creation Station is built with **defense-in-depth with enforced capability limits**. This page states what is enforced, what is tested, and what is not yet done. Numbers here come from test runs; where a test has not run, it says `NOT RUN`.

## Design in one paragraph

Language models in the kit never get to act on their own. The planning model only sees what you typed or what you said and confirmed. Text that comes from game files, mods, READMEs, or imported audio is read by a separate local model with no tools, which can only return small typed values. Every action goes through a plain-code policy check (default deny), and anything that writes, runs, uses the network, or changes skills needs your click on the exact request. Everything is recorded in a tamper-evident log.

## Enforced controls and their tests

Status as of 2026-10-08. "Passes" means the test ran and passed, both locally and in CI run https://github.com/KingRam797/Play4M3/actions/runs/37469750650 (Linux + Windows) unless noted.

| ID | Control | Status |
|---|---|---|
| S1 | Planner input is built only from user-labeled text and handle descriptors; untrusted text, including attacker-chosen filenames, never enters it | Canary tests pass |
| S2 | Default-deny policy engine; hostile path forms rejected (traversal, absolute, drive, UNC, device namespace, ADS, 8.3 short names, reserved names, trailing dot/space, control/invisible chars, non-NFC, symlinks, junctions, hard-link writes) | Tests pass on Linux and Windows; NTFS junction tests pass on `windows-latest` |
| S3 | Sensitive and untrusted-derived calls wait for a user approval bound to the exact request (single use, expiring), confirmed in a native dialog the page cannot click for you | Guard-level tests pass; Electron walkthrough passes (cancel keeps it waiting, approve writes the patch, dialog shows no game text) |
| S4 | Obedient-attacker planner, 106 attempts across 9 categories | **0 executions, 0 unauthorized**; 100 denied, 6 left waiting for a human (4 of them unflagged, see Red-team results); positive control passes |
| S8 | Electron hardening (see checklist below) | Config audit test passes; runtime smoke passes on Linux (sandboxed, renderer has no `require`/`process`) and on Windows (unpacked packaged app, exit 0). WACK: overall PASS, 2 optional tests FAIL (D-029) |
| S10 | Secret patterns redacted from audit log | Redaction test passes; Credential Manager storage NOT BUILT |
| S11 | Pinned lockfile, install scripts allowlisted, 3-day minimum release age, license allowlist, secret scan, `pnpm audit` | Local + CI pass: license gate, secret scan, gitleaks (full history), `pnpm audit`, OSV (CI only; 2 build-only advisories ignored with review date, D-009), CycloneDX SBOM generated in CI |
| S14 | Hash-chained, redacted audit log; edits, deletions, reorders and insertions detected; truncation detected with an external anchor | Tests pass |
| S9 | Web headers: strict CSP (no `unsafe-inline`), HSTS, nosniff, `frame-ancestors 'none'`, no-referrer, camera/mic denied | Config test passes; served locally with these headers, the page shows no CSP violations. Check against the live deployment NOT RUN |
| S13 | Analysis worker: separate process, scratch environment (no inherited variables or keys), private read-only input copy under a fixed name, wall-clock timeout that kills the whole process tree, output size caps, symlinked output refused. **Linux:** no network (new network namespace) and a memory cap (RLIMIT_AS, which caps address space, not resident memory). **Windows:** network isolation and memory cap **NOT ENFORCED**, so analysis is refused there by default (Q-012). **Filesystem access is NOT confined on any OS** (D-041) | Limit tests pass locally (Linux): env allowlist, tree-kill timeout, memory cap with control, loopback unreachable with control, input copy protected, output file/dir/log caps, symlink refused, fail-closed. Same suite passes on Linux CI (non-root) and Windows CI, where the measured enforcement is timeout/env/output/read-only attribute only. Real Ghidra 12.1.4 inside the sandbox on our own test program passes locally and in CI job `ghidra-analysis` (run 37780642515) |
| S12 | Bundled skill files pinned by sha256; a mismatch refuses the run; only verified bytes are staged | Tests pass. Manifest signing NOT BUILT |
| S5, S6, S7, S15 | Not built yet | See `docs/PROGRESS.md` |

## S8 Electron checklist

Automated (apps/desktop/test/s8-config-audit.test.ts):

- [x] `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (also in workers and subframes), `webSecurity: true`, `webviewTag: false`, `allowRunningInsecureContent: false`; `app.enableSandbox()`
- [x] Strict CSP, with no `unsafe-inline`, `unsafe-eval`, wildcards or remote origins, sent as a header and as a meta tag; no inline script, style or handlers in HTML
- [x] Content only from `app://station` (no `file://`, no remote URLs); every other request is cancelled
- [x] `will-navigate`, `will-redirect` and `will-frame-navigate` locked to the app origin; `window.open` always denied; `<webview>` attach blocked
- [x] Permission handlers deny everything except audio-only microphone, for the app main frame, while push-to-talk is held
- [x] Device, display-media and HID/serial/USB permissions denied
- [x] IPC: closed channel list, Zod-validated payloads, sender must be the app main frame
- [x] Preload exposes a frozen API with one method per declared channel, never `ipcRenderer`; main handles exactly those channels
- [x] Fuses: runAsNode off, NODE_OPTIONS off, inspect args off, asar integrity on, only load from asar
- [x] MSIX capabilities limited to `runFullTrust` + `microphone`

Manual (before each Store submission):

- [ ] DevTools cannot be opened in the packaged build
- [ ] Dragging a file or URL onto the window does not navigate
- [ ] No outbound connections on first launch (check with a network monitor)
- [ ] Mic indicator only lights while F9 is held

## Red-team results

**S4 (mock obedient attacker, corpus v1 seed, 2026-10-06):** 106 attempts; 0 executed; 100 denied by schema or policy; 6 stopped at the approval prompt. 2 of those carry an untrusted-data flag (handle references). The other 4 are unflagged: two in-scope writes, one patch export, and one fetch to the allowlisted host. They are unflagged because a fully compromised planner copied the payload's values literally (THREAT_MODEL T-OBED-1). There, the approval prompt showing the exact path and content is the last control. Per-category numbers are in the CI artifact `s4-obedient-attacker-report`.

**S5 (real providers): NOT RUN.** Needs provider adapters (F9) and API keys (BLOCKED-HUMAN). Results will be published here per category, including failures.

## Reporting a vulnerability

Until a security contact address on the product domain exists (BLOCKED-HUMAN: domain registration), report privately via GitHub Security Advisories on this repository. Please do not open public issues for vulnerabilities.
