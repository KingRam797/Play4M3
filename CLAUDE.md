# CLAUDE.md: Creation Station (working brand `{{BRAND}}`)

One-page operating card. Source of truth is the build brief (v1, 2026-10-06), distilled from §1, §3 and §5. Keep this file current.

## Mission
A local, voice-first kit to analyze a game the user owns (or an open-licensed one), explain it in plain language, and propose mods as **patches + manifest** (original hash, no assets) that the user approves one by one. Ship by **2026-10-30**: Microsoft Store (MSIX) + web at play4m3.com. **Security is priority #1.**

## How to work (§1)
1. **Verify before you claim.** Write "done/works/passes" only for commands run *this session* with output seen. Otherwise write `NOT RUN`.
2. `VERIFY-FIRST` facts: check the official source, log link + date in `docs/DECISIONS.md` before depending on them. Cannot verify → stop that thread, log in `docs/OPEN_QUESTIONS.md`.
3. Living docs in `docs/`: `PROGRESS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`, `THREAT_MODEL.md`, plus `SECURITY.md`.
4. User-facing copy never says "injection-proof", "unhackable", "guaranteed safe". Say "defense-in-depth with enforced capability limits".
5. Small commits. Before every commit: `pnpm check` (lint, typecheck, tests, license scan, secret scan). Never commit secrets, user binaries or third-party game assets.
6. Ask only when blocked on something irreversible or King-only → mark `BLOCKED-HUMAN` in `PROGRESS.md`, keep going.
7. End every session with the §10 report (DONE with evidence / NOT RUN / BLOCKED-HUMAN / VERIFY-FIRST resolved / NEXT 3 / RISKS).
8. Not on Windows → Windows/MSIX work runs in GitHub Actions `windows-latest`.

## Never (§2.2)
Ship game code/assets or decompiled output. DRM/anti-tamper circumvention. Emulators or platform runtimes in the Store build. Runtime download of code that changes functionality. Execute a user binary on the host (analysis is static only). Upload user binaries. Binary analysis on the web build. Bundle/link GPL/AGPL (AssetRipper, Il2CppInspector, Blender, N64ModernRuntime). Bake the brand name into legal docs before it is cleared.

## Commands
```
pnpm install          # dependency install scripts are off except the allowlist in pnpm-workspace.yaml
pnpm check            # lint + typecheck + test + license scan + secret scan
git config core.hooksPath .githooks   # once per clone: runs pnpm check before every commit
pnpm test             # vitest
```

## Architecture rules (§4)
- TypeScript, pnpm workspace, Zod at every boundary, Vitest.
- **Planner** sees only `user_typed` / `user_voice_confirmed` text plus opaque handles (`$v12`). **Quarantined reader** (local Gemma 4) reads untrusted data, has no tools, returns only schema-validated enums / bounded numbers / bounded charset strings.
- **Policy engine** (`packages/core/src/policy.ts`) is plain code, default deny: tool allowlisted → paths canonical and in scope → network denied unless allowlisted exact host → approval token bound to the exact request. Untrusted-derived args always need approval and never choose a network target.
- Brand strings come only from `packages/core/src/brand.ts`.

## Security spec (§5), each with a CI test
S1 no untrusted text in planner context · S2 default-deny policy incl. `..`, symlinks, UNC, ADS, 8.3, drive tricks, junctions · S3 writes/exec/net/skill changes need UI approval · S4 obedient-attacker planner ⇒ zero unauthorized tool executions · S5 red-team corpus, gate = zero capability escalations, honest numbers in `SECURITY.md` · S6 imported audio is data only · S7 push-to-talk, transcript confirm, voice ≠ auth · S8 Electron hardening · S9 web headers · S10 keys in Credential Manager, never in context/logs/renderer · S11 pinned lockfile, install scripts allowlisted, OSV, SBOM, GPL/AGPL fails build · S12 signed pinned bundled skills only · S13 analysis worker: low-priv, no net, RO input, caps; report what is *actually* enforced · S14 hash-chained audit log · S15 Jev optional, fail-closed, never the boundary.

## Where things are
`packages/core` types, brand, paths, policy, secret patterns · `packages/guard` handles, prompt builder, approvals, audit log · `apps/desktop` hardened Electron + MSIX · `scripts/` scans · `docs/` living docs.
