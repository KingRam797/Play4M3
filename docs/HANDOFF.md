# Session handoff (2026-10-08, after F4)

Notes for the next session. Read `CLAUDE.md` first, then this file, then `docs/PROGRESS.md` (the newest session report is at the top of the reports). Delete or rewrite this file when it goes stale.

## Where things stand

- Branch `claude/creation-station-kit-lkqr9k`. Draft PR https://github.com/KingRam797/Play4M3/pull/1 targets `main`. CI status for the latest head is in the session report in `PROGRESS.md`.
- Done: Phase 0, loading screen (D-032), F5 Station screens (D-034..D-038), and most of **F4** (D-039..D-044): analysis worker sandbox, `ghidra-headless` skill, Sky Hopper test program, and Station projects on real analysis output.
- Last IDs used: **D-044** in DECISIONS, **Q-012** in OPEN_QUESTIONS, **T-AN-5** in THREAT_MODEL.
- Plan agreed with King: step one = F5 (done), step two = F4 (mostly done, gaps below), **step three = F8** (full mod flow + export).

## F4: what exists

- `packages/analysis/src/sandbox.ts`: `runSandboxed()` and `sandboxEnforcement()`. Linux: `prlimit` (AS, FSIZE, core 0), then `unshare --map-current-user --net --pid --fork --kill-child`. On every OS: process-group or `taskkill` tree kill, a scratch environment, a private `0700` work dir, the input copied as `input.bin` (read-only, hash re-checked), output read with `O_NOFOLLOW`, and size caps. By default it **fails closed** unless network isolation and a memory cap are both enforced.
- `packages/analysis/src/ghidra.ts`: `checkGhidraInstall()` (version must be 12.1.4) and `analyzeWithGhidra()`. It starts `java` directly with Ghidra's `launch.properties` VM arguments and JVM flags that fit under RLIMIT_AS (D-042).
- `packages/skills`: the `GHIDRA_HEADLESS` manifest; `ghidra-headless/P4m3ExportFunctions.java` is pinned by sha256. **If you edit the Java script, update the pin** (`sha256sum packages/skills/ghidra-headless/P4m3ExportFunctions.java`).
- `packages/analysis/src/schema.ts`: the strict `p4m3-analysis/0` schema.
- `packages/analysis/testprog/sky_hopper.c` and `src/testprog.ts` (`buildTestProgram`, gcc `-g -O0 -no-pie`). Binaries go only to temp dirs.
- `packages/station-service/src/analysis.ts`: `analysisFromReport()` and `demoAnalysis()`. `StationService.createProject(name, analysis?)` takes either; the "Demo data" badge appears only for the fixture.
- CI: the `ghidra-analysis` job downloads the pinned zip, relaxes the userns sysctl, and runs `ghidra.e2e.test.ts` and `real-analysis.test.ts` with `P4M3_REQUIRE_GHIDRA=1`. The `check` job also relaxes the sysctl (the S13 tests need user namespaces). The Windows job writes the measured enforcement to its job summary.

## F4 gaps (do these before or alongside F8)

1. **Windows S13 (Q-012).** Today analysis is refused on Windows. That needs a Job Object (memory, kill-on-close, process limit) and network isolation (AppContainer or WFP). Decide native helper vs. PowerShell/C# P/Invoke; measure in CI.
2. **Filesystem confinement (D-041).** Landlock or a mount namespace, so the worker can write only its output and scratch dirs. A mount-namespace remount experiment was refused by this container's permission policy, so try Landlock or test it in CI.
3. **Desktop wiring.** No UI yet to choose a game file or point at a Ghidra install. Add a main-process "Open game file" flow (native file dialog, path never from the renderer), a Ghidra/JDK location setting, and progress/cancel for a run of up to 5 minutes. Then `createProject(name, analysisFromReport(...))`.
4. Real games are usually stripped. Without DWARF, globals come back as `undefined4` with no value, so there are no tunables. The F7 reader (or a typed-data heuristic) has to handle that.

## Environment facts (this container)

- gcc, clang, Java 21 (`/usr/lib/jvm/java-21-openjdk-amd64`), python3, `unshare`, `prlimit` are available. **Ghidra downloads work now** (the github.com release asset returned 200 through the proxy on 2026-10-08). Download it into the scratchpad and run the gated tests with `P4M3_GHIDRA_DIR=<dir>/ghidra_12.1.4_PUBLIC P4M3_JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`.
- The container runs as root, so the read-only input test exercises the hash-check path (root ignores mode bits). CI runs as a normal user and exercises the permission path.
- The container's `JAVA_TOOL_OPTIONS` (proxy settings) is not passed to the worker; that is the environment allowlist working.
- Running Electron as root fails. Use a non-root user (`useradd smoke; su smoke`) under `xvfb-run`.
- Enable the pre-commit hook once per clone: `git config core.hooksPath .githooks`.
- Dependency pins: the 3-day minimum release age rejects very new versions. The license gate fails on GPL/AGPL.

## Rules that must keep holding

- Static analysis only. Never execute a user binary on the host (the test program is compiled, never run). No uploads, and no binary analysis on the web build.
- Never ship game code or assets, or decompiled output. The analysis report carries names, addresses, strings and globals only. No DRM circumvention.
- No GPL/AGPL bundling. Ghidra is Apache-2.0 and is user-installed, never bundled.
- Untrusted text never reaches the planner. Analyzer output goes behind handles.
- No "injection-proof", "unhackable" or "guaranteed safe" in copy. Write `NOT RUN` for anything not run this session, and report sandbox limits as they are actually enforced.

## Open items carried over

- 2 optional WACK failures ("App resources", "Blocked executables"); root cause unknown.
- Store policy v7.20 text unverified (Q-001). Live Vercel header check NOT RUN. Physical Xbox controller test NOT RUN.
- Station projects are not persisted across restarts.
- King may send a "remake everything" GitHub repo. Check its license and approach before using any of it.
- BLOCKED-HUMAN list is in `PROGRESS.md`; the Partner Center account is the most time-critical.

## PR duties

Keep PR #1 green and mergeable: subscribe to its activity, fix CI failures, answer review comments. End the session with the §10 report in `PROGRESS.md`.
