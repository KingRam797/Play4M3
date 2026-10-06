# Decisions

Format: **ID · date · decision** — reason — source.

## Architecture and process

- **D-001 · 2026-10-06 · Architecture per brief §4 adopted unchanged** (TypeScript, pnpm workspace, React + Vite, Zod, Vitest, Electron → MSIX via electron-builder AppX target). — Brief is authoritative; changes only via this file. — Brief v1 §4.
- **D-002 · 2026-10-06 · Development host is Linux; all Windows/MSIX/WACK work runs in GitHub Actions `windows-latest`** (`.github/workflows/windows-msix-spike.yml`). — Brief §1.8. This session's container is Linux 6.18, Node 22.22.0, pnpm 10.28.0, JDK present, Python 3.13.16.
- **D-003 · 2026-10-06 · Toolchain pins**: TypeScript 6.0.3 (not 7.x: typescript-eslint 8.71 supports `<6.1.0`), ESLint 10.11.0, typescript-eslint 8.71.0, Vitest 5.0.3, Vite 8.3.2, Zod 4.6.5, @types/node 22.20.5. — Peer ranges checked with `npm view` this session.
- **D-004 · 2026-10-06 · Supply-chain install settings** (S11): `save-exact`, `onlyBuiltDependencies` allowlist (`electron` to fetch its runtime binary, `esbuild` for its platform binary), `strictDepBuilds: true` (any other package with an install script fails the install), `minimumReleaseAge: 4320` (3 days). — The age gate fired this session on typescript-eslint 8.71.1 (19 h old); pinned 8.71.0 instead. — pnpm docs: https://pnpm.io/settings#minimumreleaseage
- **D-005 · 2026-10-06 · Workspace packages export TypeScript source** (`"exports": "./src/index.ts"`); typecheck is one root `tsc --noEmit`; Electron main/preload are bundled with esbuild. — Fewer build steps for a 24-day schedule; Electron cannot load `.ts` so it gets a bundle.
- **D-006 · 2026-10-06 · License gate is an allowlist, not a denylist.** Any license not in `scripts/license-scan.mjs` ALLOWED fails, copyleft (GPL/AGPL/LGPL/SSPL/EUPL/OSL/CC-BY-SA/NC) fails explicitly. Applies to dev deps too. MPL-2.0 allowed (file-level copyleft, unmodified use). — Brief S11; unknown licenses are as risky as known-bad ones.
- **D-007 · 2026-10-06 · Secret scan = local pattern scan (`scripts/secret-scan.mjs`, shared patterns in `packages/core/src/secrets.ts`) + gitleaks over full history in CI.** Test fixtures build fake secrets at runtime. — Same patterns feed log redaction and S10 tests.

## Policy engine (S2/S3)

- **D-010 · 2026-10-06 · Reject, don't normalize.** The canonicalizer rejects `..`, absolute, drive-letter (incl. drive-relative `C:x`), UNC, `\\?\`/`\\.\`/`\??\`, ADS (any `:`), 8.3 short names (`~N`), reserved device names (incl. superscript COM¹²³, CONIN$), trailing dot/space, Windows-forbidden chars, control chars, Unicode format chars (bidi, ZWJ, tag chars), non-NFC strings. `.` and empty segments collapse. — Ambiguous paths are attack surface.
- **D-011 · 2026-10-06 · Any symlink or junction component is rejected**, even one pointing inside the workspace; also realpath containment, and writes to multi-hard-link files rejected. — Simpler than reasoning about link targets. Node's `lstat` reports NTFS junctions as symlinks; the win32 junction tests confirm this in CI.
- **D-012 · 2026-10-06 · Scope match is case-insensitive** (`toLowerCase`), because NTFS is.
- **D-013 · 2026-10-06 · Taint rules.** `taintedBy` is computed by the guard from handles referenced in planner arguments, never taken from the planner. Any tainted request needs approval, even on `approval:"none"` tools. Tainted requests may never carry network targets (`net.tainted`), approval or not. — Brief §4.2 "extra check"; untrusted data choosing an exfiltration host is the classic injection payoff.
- **D-014 · 2026-10-06 · Sensitive tool families** (`fs.write`, `fs.delete`, `fs.move`, `exec.*`, `analysis.run`, `net.*`, `skill.*`, `patch.export`) and any `net:"allowlist"` capability must be `approval:"user"`; the manifest is rejected at load otherwise. Hosts must be plain lowercase ASCII (no IDN, no wildcard, no IP, no trailing dot).
- **D-015 · 2026-10-06 · Approval tokens** are verified by an `ApprovalVerifier` interface in core; the HMAC implementation (single use, expiry, bound to a digest of the exact request) lives in `@play4m3/guard` on the Node side. Web build uses `DENY_ALL_APPROVALS`.

## VERIFY-FIRST log

| Item | Result | Source | Checked |
|---|---|---|---|
| Ghidra license in pinned release | **Verified Apache-2.0** in tag `Ghidra_12.1.4_build` (`LICENSE` sha256 `c71d239d…0ab4`). Note: the Ghidra distribution also contains third-party components under their own licenses (`Ghidra/licenses`); Ghidra is never bundled, it is a user-installed subprocess, so this does not affect our license gate. | https://raw.githubusercontent.com/NationalSecurityAgency/ghidra/Ghidra_12.1.4_build/LICENSE | 2026-10-06 |
| Ghidra 12.1.4 requirements | `application.java.min=21`; `application.python.supported=3.14, 3.13, 3.12, 3.11, 3.10, 3.9` (brief said 3.9–3.13; actual range includes 3.14) | https://raw.githubusercontent.com/NationalSecurityAgency/ghidra/Ghidra_12.1.4_build/Ghidra/application.properties | 2026-10-06 |
| Ghidra 12.1.4 is the latest release, Sep 21 | GitHub releases page lists 12.1.4 as latest, dated Sep 21 (the fetch tool's year rendering was unreliable; tag existence confirmed via raw files above) | https://github.com/NationalSecurityAgency/ghidra/releases | 2026-10-06 |
| Local runtime supports Gemma 4 | **Verified for llama.cpp** (MIT): `docs/multimodal.md` lists `gemma-4-E2B-it`, `gemma-4-E4B-it`, `gemma-4-26B-A4B-it`, `gemma-4-31B-it`; E2B/E4B listed under "Capabilities: audio input, vision input". Ollama/ONNX not checked. Gemma 4 Apache-2.0 license **not re-verified** (Hugging Face blocked by egress proxy); see OPEN_QUESTIONS Q-004. | https://raw.githubusercontent.com/ggml-org/llama.cpp/master/docs/multimodal.md | 2026-10-06 |
| Store Policies v7.20 text | **NOT VERIFIED.** learn.microsoft.com and devdocs.xbox.com are blocked by this environment's egress proxy; a web search on 2026-10-06 surfaced only v7.18/v7.19 references. See OPEN_QUESTIONS Q-001. | — | 2026-10-06 |
| Store package size limits | **NOT VERIFIED.** Third-party sources mention 25 GB per bundle; official page unreachable. Our package will be far below any plausible limit (<300 MB), so this does not block Phase 0. Q-002. | — | 2026-10-06 |
| Certification turnaround, Partner Center verification time, AppContainer constraints | **NOT VERIFIED.** Q-003. | — | 2026-10-06 |
