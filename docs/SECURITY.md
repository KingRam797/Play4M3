# Security

{{BRAND}} / The Creation Station is built with **defense-in-depth with enforced capability limits**. This page states what is enforced, what is tested, and what is not yet done. Numbers here come from test runs; where a test has not run, it says `NOT RUN`.

## Design in one paragraph

Language models in the kit never get to act on their own. The planning model only sees what you typed or what you said and confirmed. Text that comes from game files, mods, READMEs, or imported audio is read by a separate local model with no tools, which can only return small typed values. Every action goes through a plain-code policy check (default deny), and anything that writes, runs, uses the network, or changes skills needs your click on the exact request. Everything is recorded in a tamper-evident log.

## Enforced controls and their tests

| ID | Control | Status |
|---|---|---|
| S2 | Default-deny policy engine; hostile path forms rejected (traversal, absolute, drive, UNC, device namespace, ADS, 8.3 short names, reserved names, trailing dot/space, control/invisible chars, symlinks, junctions, hard-link writes) | Tests pass on Linux; junction tests run on Windows CI only |
| S3 | Approval bound to the exact request | Policy-level tests pass; UI integration test NOT RUN (UI not built) |
| S11 | Pinned lockfile, install scripts allowlisted, 3-day minimum release age, license allowlist, secret scan | Local scans pass; CI OSV/SBOM/gitleaks jobs defined, results pending first CI run |

Other S-items are tracked in `docs/PROGRESS.md`.

## Red-team results (S5)

NOT RUN. Corpus and runner arrive in Phase 1 (F3). Results will be published here per category, including failures.

## Reporting a vulnerability

Until a security contact address on the product domain exists (BLOCKED-HUMAN: domain registration), report privately via GitHub Security Advisories on this repository. Please do not open public issues for vulnerabilities.
