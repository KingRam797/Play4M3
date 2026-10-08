# Session handoff (2026-10-08)

Notes for the next session. Read `CLAUDE.md` first, then this file, then `docs/PROGRESS.md`. Delete or rewrite this file when it goes stale.

## Where things stand

- Branch `claude/creation-station-kit-lkqr9k`, head `1f69fc1`. Draft PR https://github.com/KingRam797/Play4M3/pull/1 targets `main` (the default branch, confirmed). All CI was green on `1f69fc1`: `ci` (check, test-windows, electron-smoke-linux, station-walkthrough, gitleaks, osv, sbom), `windows-msix-spike` and Vercel.
- Done: Phase 0, the destructible loading screen (D-032), and **F5** Station screens (D-034..D-038). `pnpm check` gives 274 tests passing and 2 skipped (Windows-only junction tests).
- Last IDs used: **D-038** in DECISIONS, **Q-011** in OPEN_QUESTIONS.
- Plan agreed with King: step one = F5 (done), **step two = F4 (start now)**, step three = F8 (full mod flow + export).

## Step two: F4 analysis sandbox + `ghidra-headless` skill (S13)

Nothing has been written yet. `packages/analysis` and `packages/skills` are placeholders (`export const PACKAGE = ...`).

Goal: a real function list from a binary we compile ourselves feeds the explain panel, in place of the `DEMO_FUNCTIONS` fixture.

1. **Test program.** Write a small C "Sky Hopper" program that mirrors `packages/station-service/src/demo/sample.ts`.
   - Functions: `main`, `game_tick`, `read_input`, `player_jump`, `apply_gravity`, `move_player`, `render_frame`, `load_level` (holds the planted injection string), `play_sound`.
   - Globals: `jump_velocity` 12.0, `gravity` 9.8, `run_speed` 4.5. The fixture's addresses are 0x404010/14/18; real addresses will differ, so take them from the analysis.
   - Compile it in tests and CI. **Never commit the binary** (add the output dir to `.gitignore`).
2. **Worker runner** in `packages/analysis`.
   - Spawn the analyzer as a separate process, with a minimal environment, and pass no secrets.
   - Network: none. On Linux use `unshare -n` or equivalent; on Windows, measure what's possible.
   - Input: read-only. Copy the input into a temp dir and mark it read-only.
   - Caps: wall-clock timeout with kill, memory cap (`prlimit` on Linux, a job object on Windows), and an output size cap.
   - Output is `untrusted`. Parse it with Zod into bounded fields only, then store it as handles; never let it reach the planner (S1).
   - Write one test per enforced limit, and document in `SECURITY.md` what is *actually* enforced on each OS (the brief requires honest reporting).
3. **ghidra-headless skill.**
   - Ghidra 12.1.4: Apache-2.0, JDK 21+, Python 3.9–3.14 (VERIFY-FIRST already logged).
   - It is user-installed or CI-installed, **never bundled**.
   - Run `analyzeHeadless` with `-import <bin> -scriptPath <ours> -postScript <ours> -deleteProject` and a throwaway project dir.
   - The post-script emits normalized JSON: functions with entry address, size, name, referenced strings, and data refs. Validate it with Zod.
4. **Wire into the Station.**
   - `StationService` gets an analysis source: the demo fixture or real analysis output.
   - The reader still classifies functions and flags instruction-like strings.
   - Keep the "Demo data" badge only for the fixture.
5. **CI job.** Install JDK 21 + Ghidra 12.1.4 (zip pinned by sha256), compile the test program, run the skill, and assert the expected functions and globals appear. Add a Windows variant for the S13 measurements.
6. **Docs.** New D-039+ entries, update PROGRESS (F4, S13), SECURITY (S13 row), THREAT_MODEL (worker threats).

## Environment facts (this container)

- Available: gcc, clang, Java 21 (OpenJDK 21.0.12), python3, `unshare`, `prlimit`. Ghidra is **not** installed.
- Network goes through a proxy. `raw.githubusercontent.com` works (200). `github.com` release pages return **403**, so the Ghidra release zip likely can't be downloaded here; run Ghidra in GitHub Actions and build the runner and limits locally with a stub analyzer.
- Running Electron as root fails. Use a non-root user (`useradd smoke; su smoke`) with a `mktemp -d` dir that user owns, under `xvfb-run`. The smoke user can't write to the scratchpad, so copy results out afterwards.
- Enable the pre-commit hook once per clone with `git config core.hooksPath .githooks`. It runs `pnpm check` and blocks a failing commit. Never commit around it.
- Dependency pins: the 3-day minimum release age rejects very new versions (pick an older patch). The license gate fails on GPL/AGPL; any exception needs a pinned entry in `scripts/license-exceptions.json` plus a DECISIONS entry.

## Rules that must keep holding

- Static analysis only; never execute a user binary on the host. No uploads, no binary analysis on the web build.
- Never ship game code/assets or decompiled output; no DRM/anti-tamper circumvention.
- No GPL/AGPL bundling or linking (AssetRipper, Il2CppInspector, Blender).
- Untrusted text never reaches the planner. Tainted requests need approval and never choose a network host.
- No "injection-proof", "unhackable" or "guaranteed safe" in copy. Write `NOT RUN` for anything not run this session.

## Open items carried over

- 2 optional WACK failures ("App resources", "Blocked executables"), root cause unknown.
- Store policy v7.20 text unverified (Q-001); learn.microsoft.com is blocked here.
- Live Vercel header check NOT RUN (vercel.app blocked here).
- Physical Xbox controller test NOT RUN.
- Station projects are not persisted across restarts (only the attestation is).
- King may send a "remake everything" GitHub repo for cloning/mod logic. Before using any of it, check its license (no GPL/AGPL linking) and approach (no shipping game code/assets, no DRM circumvention).
- BLOCKED-HUMAN list is in `PROGRESS.md`; the Partner Center account is the most time-critical.

## PR duties

Keep PR #1 green and mergeable: subscribe to its activity in the new session, fix CI failures, and answer review comments. End the session with the §10 report in `PROGRESS.md`.
