# Threat Model: Creation Station

Status: v0.1, 2026-10-06 (Phase 0). Living document; update when a boundary or control changes.

## 1. Assets

| ID | Asset | Why it matters |
|---|---|---|
| A1 | User's host machine (files, processes, credentials) | Full compromise if a game file or mod can drive tool execution |
| A2 | Provider API keys (OpenAI, Anthropic) | Financial loss, account abuse |
| A3 | User's workspace (projects, patches, approvals) | Integrity of what the user ships; silent patch tampering |
| A4 | User binaries (owned games) | Privacy, licensing; must never leave the machine |
| A5 | Audit log | Evidence of what the agent did; must be tamper-evident |
| A6 | Our signing keys (MSIX, skill manifests) | Supply-chain compromise of every install |
| A7 | play4m3.com web origin | Phishing, XSS, brand trust |
| A8 | Microphone stream | Privacy; command channel |

## 2. Trust boundaries

```
 [User: keyboard / push-to-talk]  --(trusted: user_typed, user_voice_confirmed)--> [Planner LLM]
                                                                                      |  tool calls (with $v handles)
                                                                                      v
 [Game binary / README / mod / asset / imported audio] --untrusted--> [Analysis worker] --untrusted--> [Quarantined reader (Gemma 4, no tools)]
                                                                                      |  schema-validated values behind handles
                                                                                      v
                                                    [Guard: handle resolver -> Policy engine (code) -> Approval gate (UI click) -> Executor]
                                                                                      |
                                                                                      v
                                                                       [Audit log (hash-chained)]
```

- **B1 Renderer ↔ main process** (Electron): renderer is untrusted UI. Sandboxed, context-isolated, IPC messages Zod-validated, no Node.
- **B2 Planner ↔ untrusted data**: planner never sees untrusted text, only handles (S1).
- **B3 Reader ↔ tools**: reader has no tools; output is a typed value, never instructions (CaMeL-style, arXiv 2503.18813).
- **B4 Any model ↔ execution**: every tool call passes the deterministic policy engine (S2) and, if sensitive or tainted, a human approval bound to the exact request (S3).
- **B5 Host ↔ analysis worker**: separate process with a scratch environment, no network, a private read-only input copy, resource caps (S13). Static analysis only. Enforced per OS as reported by `sandboxEnforcement()` (D-040); filesystem access is **not** confined yet (D-041).
- **B6 App ↔ network**: default deny; providers only via explicit allowlisted hosts, user opt-in.
- **B7 Build ↔ dependencies**: pinned lockfile, install scripts allowlisted, 3-day minimum release age, license and OSV scans, SBOM (S11).
- **B8 Web ↔ browser**: strict CSP and headers, no binary analysis, no serving uploads as active content (S9).

## 3. Attacker model

| ID | Attacker | Capability | Goal |
|---|---|---|---|
| T1 | Malicious game file | Controls every byte of a binary the user imports: strings, symbols, section names, embedded resources | Prompt-inject the planner/reader into running tools, writing outside the workspace, exfiltrating keys |
| T2 | Malicious mod / README / manifest | Controls text the user opens in the kit, filenames, JSON fields, comments | Same as T1; also social-engineer approvals ("click approve to continue") |
| T3 | Hostile audio | Controls imported audio (game assets, videos, mod files) or ambient audio near the mic; adversarial perturbations (AudioHijack arXiv 2604.14604; concurrent injection arXiv 2607.28165) | Inject commands through the voice channel |
| T4 | Poisoned dependency | Publishes or hijacks an npm package, GitHub Action, or model file | Code execution at install/build/run time |
| T5 | Hostile web content | Any page the app or the web build loads; cross-origin attacker | XSS, navigation hijack, window.open to phishing, permission abuse |
| T6 | Compromised or jailbroken planner | Model follows any instruction in its input (assumed in S4) | Unauthorized tool execution |
| T7 | Local unprivileged process | Races the filesystem | TOCTOU swap of a checked path for a link |

Out of scope for the prototype: an attacker with admin on the host, kernel exploits, physical access, malicious Microsoft Store infrastructure.

## 4. Controls mapped to threats

| Threat | Primary control | Secondary | Test |
|---|---|---|---|
| T1, T2 prompt injection | Planner/reader split; planner sees handles only | Reader output schemas (enums, bounded strings); taint ⇒ approval; tainted data cannot pick network targets | S1, S4, S5 |
| T1, T2 path abuse | Lexical canonicalizer rejects `..`, absolute, drive, UNC, device namespace, ADS, 8.3, reserved names, trailing dot/space, control/format chars, non-NFC | fs probe: no symlink/junction components, realpath containment, no multi-link write targets | S2 |
| T2 approval phishing | Approval UI shows the exact request (tool, canonical paths, hosts, diff), untrusted text rendered as quoted data | Approval token bound to request digest, single use, short expiry | S3, S7 |
| T3 hostile audio | Imported audio is transcribed to *data* only (untrusted label), never reaches the command channel | Command audio only from live push-to-talk; transcript shown and confirmed; destructive actions need click/typed confirm; voice is never authentication | S6, S7 |
| T4 supply chain | Lockfile, exact pins, install scripts off except allowlist, min release age, license + OSV scan, SBOM | Skills first-party, signed, sha256-pinned, bundled; no runtime fetch | S11, S12 |
| T5 web content | Electron: contextIsolation, sandbox, no nodeIntegration, CSP, no remote content, navigation/window.open locked, permissions denied except mic on gesture | Web: CSP without unsafe-inline, HSTS, nosniff, frame-ancestors none, strict referrer | S8, S9 |
| T6 compromised planner | Policy engine is code, default deny; capability manifest validated at load | Audit log of every call/decision | S4, S14 |
| T7 TOCTOU | Check immediately before use; refuse links | **Gap**: no-follow opens not enforced yet (see T-FS-1) | — |
| A2 key theft | Keys in Windows Credential Manager, main process only | Redaction in logs; secret patterns in tests | S10 |
| A5 log tampering | SHA-256 hash chain over canonical JSON entries | Periodic anchor hash shown to user (planned) | S14 |

## 5. Known gaps and residual risk (be honest here)

- **T-FS-1 TOCTOU on paths.** `checkWorkspacePath` is check-then-use. Planned: executor opens files with no-follow semantics and re-verifies the handle's final path. Not enforced in Phase 0.
- **T-LLM-1 Reader manipulation.** The quarantined reader can still be steered to return wrong-but-valid values (e.g. a misleading enum). This can mislead the user but cannot execute tools; every effect still needs policy + approval.
- **T-UI-1 Approval fatigue.** Users may approve without reading. Mitigation: show minimal, specific diffs; rate-limit approval prompts; no "approve all".
- **T-AUD-1 Audio adversarial examples** are an open research problem. Our control is architectural (imported audio never commands), not detection.
- **T-WIN-1 Sandbox enforcement on Windows** (S13). Measured on `windows-latest` (CI job summary): timeout tree-kill, environment allowlist, output caps, read-only input attribute. **Not enforced:** network isolation, memory cap. The runner therefore refuses analysis on Windows by default (Q-012).
- **T-AN-1 Malicious binary exploits the analyzer (Ghidra parser bug ⇒ code execution in the worker).** Contained by no network (Linux), the address-space and file-size caps, the timeout, a scratch environment without keys, and a fresh temp dir per run. **Residual:** the worker runs as the user with no filesystem confinement (D-041). It can read user files, but cannot send them anywhere except into its bounded report. That report is untrusted, shown as quoted data, and never sent to the planner. It **can write** user files (persistence, e.g. shell startup files). Planned fix: Landlock or a mount namespace.
- **T-AN-2 Worker output tricks the host.** A symlinked output file is refused (`O_NOFOLLOW`). Oversized files and directories are rejected. The JSON is parsed with a strict schema (unknown keys and `__proto__` rejected, every field bounded), and parse errors never echo input. The report's sha256 must match the input we gave it. Names and strings stay behind handles (S1).
- **T-AN-3 Resource exhaustion.** Wall clock, address space, single-file size, output-directory size and log size are capped. **Not capped:** total disk writes outside the output directory (no filesystem confinement), process count, CPU time beyond the wall clock.
- **T-AN-4 Tampered skill script or hostile Ghidra install.** The skill script is sha256-pinned and only the verified bytes are staged (D-043). Ghidra itself is trusted as user-installed: the version is pinned, and `launch.properties` values must be plain JVM options. A malicious Ghidra install on the user's own machine is out of scope (host-level attacker).
- **T-AN-5 Input tampering.** The worker sees a private copy under a fixed name, never the user's file or path. Any change to the copy voids the run (hash check). File mode bits are the only write barrier on the copy, and they do not bind root; the hash check is what makes this hold.
- **T-LBL-1 Label forgery inside our own code.** Trust labels are plain strings; a bug that labels file content `user_typed` would bypass S1. Mitigation planned (Q-010): only UI input handlers can mint planner-visible labels.
- **T-MSIX-1 MSIX is not a sandbox for us.** Electron requires `runFullTrust`, which runs outside AppContainer at medium integrity (D-020). OS-level isolation must come from the analysis worker design (S13), not from packaging.
- **T-OBED-1 Literal copying defeats taint.** A compromised planner that copies untrusted text *by value* into arguments (instead of using a handle) produces untainted requests. S1 means the planner should never see that text; if it does, the remaining controls are the policy engine and the human approval gate. The S4 run shows these attempts end in `pending_approval` (6 of 106), never `executed`.
- Jev (if enabled) is one signal among several and never the boundary: public results show 59% injection success against it.
