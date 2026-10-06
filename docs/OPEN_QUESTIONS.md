# Open Questions

Each item: what is unknown, why it matters, who can close it, what is blocked.

- **Q-001 · Store Policies v7.20 (effective 2026-10-22).** Could not fetch learn.microsoft.com (egress proxy blocks it in the build environment). Search found v7.18/v7.19 only. Need the live text of 10.13.10 (emulators), 10.2.2 (dynamic code), 11.16 (generative AI disclosure + report content), 10.5.1 (privacy policy URL), 10.1.1 (web apps / domain owner). **Blocks:** F12 metadata sign-off. **Closable by:** King (open the page and paste the sections into this file), or allowlist `learn.microsoft.com` in the environment's network policy.
- **Q-002 · Store package size limits.** Same blocker as Q-001. Low risk: expected package size well under 300 MB.
- **Q-003 · Certification turnaround and Partner Center verification time.** Drives whether Oct 16 submission leaves room for two resubmits before Oct 23. **Closable by:** King once the Partner Center account exists (dashboard shows status).
- **Q-004 · Gemma 4 license text.** Brief says Apache-2.0 (verified by advisor). Hugging Face blocked here; re-check the model card license and any use policy before F7 bundles or downloads weights. **Also open:** where the weights come from at install time without violating policy 10.2.2 (weights are data, not code, but must be pinned by sha256 and user-initiated).
- **Q-005 · WACK on GitHub-hosted runners.** Unknown whether `appcert.exe` (Windows App Certification Kit) is present on `windows-latest`. The spike workflow probes for it and reports. If absent, King runs WACK locally on a Windows machine, or we install the Windows SDK in CI.
- **Q-006 · MSIX signing for Store.** Store submissions are re-signed by Microsoft; a local test cert is needed only for sideload install tests. Confirm with Partner Center docs (Q-001 blocker).
- **Q-007 · Showcase title (F10).** Need verified open/permissive candidates. Will propose in Phase 2; King decides (BLOCKED-HUMAN).
- **Q-008 · Electron vs. emulator/runtime policy interpretation.** Electron is a browser runtime, not a game-platform runtime; we read 10.13.10 as not applying. Confirm against v7.20 text (Q-001).
