# Progress

Updated 2026-10-06 (session 1). `[x]` = done and verified this session with command output seen. `[~]` = partly done. `[ ]` = not started. CI results are filled in once the first run on the PR completes.

## Phase 0 (Oct 6–8): gate = spike result recorded, Partner Center started

- [x] Repo + workspace layout (§4), `CLAUDE.md`, the four living docs + `SECURITY.md`
- [~] CI: lint, typecheck, tests, license scan, secret scan (gitleaks), OSV, SBOM, Windows tests, Linux Electron smoke. Workflows written and actionlint-clean; **first CI run NOT RUN yet**
- [x] `THREAT_MODEL.md` v0.1
- [x] `packages/core` §4.1 types + policy engine + S2 path tests
- [~] Hardened Electron shell (S8): built, audit test passes, runtime smoke passes on Linux. **MSIX hello-world + WACK: workflow written, NOT RUN** (runs on `windows-latest` on push)
- [~] VERIFY-FIRST: Ghidra license/requirements verified; llama.cpp Gemma 4 support verified; **Store policy v7.20, package size limits, certification times NOT VERIFIED** (network blocked here; Q-001..Q-003)
- [x] `PROGRESS.md` with F1–F13 and first session report

## Features

- [~] **F1** Repo, CI, license/secret/SBOM scans, SECURITY.md, THREAT_MODEL.md. Acceptance "CI green on a clean clone": NOT RUN
- [~] **F2** Guard core: Labeled types, policy engine, audit log, handles. S1, S2, S3 (guard level), S4, S14 tests pass locally. Remaining: trusted-label minting (Q-010), TOCTOU-safe executor (T-FS-1), audit sink to disk + anchor storage
- [~] **F3** Red-team harness + corpus v1. Seed corpus (16 payloads, 8 carriers, 6 encodings) + obedient attacker run in tests. Remaining: grow corpus (Unicode smuggling variants, multi-turn sequences), metrics report in CI summary
- [ ] **F4** Analysis sandbox + `ghidra-headless` skill on a test binary we compile ourselves (S13)
- [ ] **F5** Station UI shell: workspace, explain panel, approval queue, audit view
- [ ] **F6** Voice: push-to-talk, local STT, transcript confirm (S6, S7)
- [ ] **F7** Explain-in-plain-language via quarantined reader
- [ ] **F8** Propose-a-mod: patch diff, review, approve, export with original-hash manifest
- [ ] **F9** Provider adapters: codex-sdk, claude-agent-sdk (BYO key), gemma-local
- [ ] **F10** Showcase project (open/permissive title; King picks)
- [ ] **F11** *Stretch:* Unity IL2CPP via Cpp2IL
- [ ] **F12** Store build: metadata, privacy URL, gen-AI disclosure, report-content action, age rating, signed MSIX, WACK, submitted
- [ ] **F13** Web build on play4m3.com (S9)

## Security items

| ID | State |
|---|---|
| S1 | [x] tests pass (local) |
| S2 | [x] tests pass on Linux; junction tests: Windows CI NOT RUN |
| S3 | [~] guard-level tests pass; UI click path pending F5 |
| S4 | [x] 106 attempts, 0 unauthorized executions, with positive control (local) |
| S5 | [ ] needs F9 + keys |
| S6 | [ ] F6 |
| S7 | [~] mic permission gated on held PTT key (S8 tests); transcript confirm pending F6 |
| S8 | [x] audit test + Linux runtime smoke pass; Windows smoke NOT RUN |
| S9 | [ ] F13 |
| S10 | [~] redaction + patterns; Credential Manager not built |
| S11 | [~] local: lockfile, pins, install-script allowlist, min release age, license gate, secret scan, gitleaks, pnpm audit pass. CI OSV + SBOM NOT RUN |
| S12 | [ ] |
| S13 | [ ] F4 spike |
| S14 | [x] tests pass (local) |
| S15 | [ ] optional |

## BLOCKED-HUMAN (King)

- [ ] Register **play4m3.com** and **play4m3.si**; point DNS
- [ ] Microsoft Partner Center **company account** (free; LLC docs; work email on the domain). **Start today.** Unblocks Q-003, F12 identity values
- [ ] Brand-name clearance (trademark search/attorney) before Store listing and privacy policy
- [ ] Provider API keys (OpenAI, Anthropic) in the OS credential store, never in the repo
- [ ] Privacy policy + terms text, reviewed by counsel
- [ ] Pick the Oct 30 showcase title once candidates are proposed (F10)
- [ ] Michigan IP attorney consult (trademark, copyright posture, patent strategy)
- [ ] **New:** paste the live Store Policies v7.20 sections (10.13.10, 10.2.2, 11.16, 10.5.1, 10.1.1) into `OPEN_QUESTIONS.md` Q-001, or allowlist `learn.microsoft.com` in the build environment's network policy

---

## Session report: 2026-10-06 (session 1)

```
DONE (with evidence):
- pnpm check (lint, typecheck, vitest, license scan, secret scan): exit 0; 191 tests passed, 2 skipped (Windows-only junction tests)
- S2: 51 path-attack table rows (+7 hostile paths through the policy engine) + fs probe (symlink, dir symlink, inside-pointing symlink, root link, hard link, through-file) pass
- S1/S3/S14 guard tests pass; S4 obedient attacker: 106 attempts, 0 executions, 0 unauthorized, positive control executes
- S8: config audit test passes; Electron 44.5.1 shell launched under Xvfb as a non-root user with the Chromium sandbox on:
  "SMOKE ping=ok (v0.0.1) require=undefined process=undefined bridge=function", exit 0
- License gate caught truncate-utf8-bytes (WTFPL) → pinned, documented exception (D-008)
- Min-release-age gate rejected typescript-eslint 8.71.1 (19 h old) → pinned 8.71.0 (D-004)
- pnpm audit: 2 build-only advisories, no patches → documented ignores with review date (D-009); exit 0 at --audit-level high
- gitleaks 8.30.1 (sha256 verified) over git history and working tree: no leaks
- actionlint 1.7.12: both workflows clean
NOT RUN / NOT DONE:
- Any CI run (first run starts on push); NTFS junction tests; Windows smoke; MSIX build; sideload install; WACK
- OSV scan (api.osv.dev blocked here; the tool's "0 vulnerabilities" output is not a result)
- SBOM generation (CI only)
- F4–F13
BLOCKED-HUMAN: see list above (Partner Center account is the most time-critical)
VERIFY-FIRST resolved:
- Ghidra 12.1.4 LICENSE = Apache-2.0; java.min=21; python 3.9–3.14: raw.githubusercontent.com/NationalSecurityAgency/ghidra/Ghidra_12.1.4_build/{LICENSE,Ghidra/application.properties}, 2026-10-06
- llama.cpp supports Gemma 4 E2B/E4B/26B-A4B/31B, with audio input for E2B/E4B: raw.githubusercontent.com/ggml-org/llama.cpp/master/docs/multimodal.md, 2026-10-06
- NOT resolved: Store Policies v7.20, package size limits, certification times (Q-001..Q-003)
NEXT 3 ACTIONS:
1. Read the first CI + windows-msix-spike results; fix anything red; record the MSIX/WACK outcome in DECISIONS (switch shells only if the spike fails)
2. F4: S13 analysis-worker spike on Windows (job object limits, no-network, read-only input) with a self-compiled test binary + ghidra-headless skill
3. F5 approval queue UI on the guard (closes the S3 UI half) + trusted-label minting (Q-010)
RISKS TO 10/30:
- Partner Center verification time unknown (Q-003); Oct 16 submission depends on it
- WACK may be absent on GitHub runners (Q-005); then a Windows machine is needed
- Store policy v7.20 text unverified (Q-001); Electron-as-runtime interpretation (Q-008)
- S13 isolation on Windows for a full-trust app may be weaker than hoped (T-MSIX-1)
- Schedule: F4–F8 in 8 working days is tight; cut order per brief §7 (F11, F10, extra F9 adapters)
```
