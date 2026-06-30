<!-- version: 1.0.0 -->
# Durable Architectural Truth Cache

This cache stores durable project truths that should persist beyond a
single task. Update it only when a stable fact, decision, invariant, or
unresolved question should carry forward.

## Project purpose

SpecRecon is a security research suite with two components:

- **SpeQL** — a static API Spec Query Analyser that uses CodeQL and a
  built-in Python analyzer to scan Azure REST API specifications for
  vulnerability classes including SilentReaper (SAS URI exposure),
  Key Vault misconfigurations, missing access control, and hardcoded
  credentials.
- **APISpy** — a Chrome/Edge DevTools browser extension that provides
  real-time observation of live Azure/Microsoft API requests, classifying
  each one against the SpecRecon API inventory.

SilentReaper is the primary vulnerability class: an API that emits a
SAS URI in its response becomes dangerous when combined with improper
RBAC or inadequate control/data-plane isolation.

## Non-goals

- Not a general API testing framework.
- Not a network proxy or traffic interceptor.
- Not an Azure SDK or client library wrapper.
- Does not produce deployment artefacts or modify Azure resources.

## Architecture summary

```
SpeQL (static analysis)
  analyze.py               Python-based scanner — no CodeQL required
  SpeQL.py                 Interactive CLI menu
  queries/azure-security/  CodeQL query suite (SasUriInResponse.ql)
  refresh-database.sh / refresh_database.py  Build CodeQL DB from azure-rest-api-specs
  scripts/sarif-analysis/  SARIF deduplication, parsing, and threat prioritisation

APISpy (dynamic observation)
  apispy/extension/        Unpacked Chrome/Edge DevTools extension
  apispy/scripts/          portal_sweep.py (Playwright automation), prepare_data.py
  apispy/tests/            Node.js unit tests for extension modules
```

The two components share an API inventory produced by
`scripts/export/export_api_inventory.py`, which outputs sharded JSON
files consumed by the APISpy extension's `data/` directory.

## Core invariants

- **CodeQL CLI version**: Must use 2.20.1 or 2.20.2. Version 2.23.x and
  newer have compatibility issues with JSON-only database creation.
- **CodeQL javascript-all version**: Must be 0.9.4 (0.9.x); constrained by `JAVASCRIPT_ALL_VERSION="0.9.4"` in `setup.sh` (install-time) and `codeql/javascript-all: "~0.9.0"` in `qlpack.yml` (runtime dependency). Newer 2.x libraries contain syntax that CodeQL 2.20.2 cannot parse.
- **Python requirement**: Python 3.6 or higher. No mandatory third-party
  runtime dependencies for the core analyzer (`analyze.py`).
- **CodeQL database path**: `database/azure-api-db/` — do not change
  without updating all scripts that reference it.
- **qlpack.yml dependency**: `queries/azure-security/qlpack.yml` pins `codeql/javascript-all: "~0.9.0"` — do not widen or replace with `*`. This enforces the 0.9.x constraint required by CodeQL 2.20.x.

## Trust boundaries

- Azure REST API specs from `azure-rest-api-specs` are external,
  untrusted input processed read-only by the analyzers.
- CodeQL SARIF output is treated as findings to review, not ground truth.
- The APISpy extension observes browser traffic but never modifies
  requests or exfiltrates data.

## Known sharp edges

- CodeQL 2.23+ breaks JSON-only DB creation — pin to 2.20.x.
- `codeql pack install` must be run inside `queries/azure-security/`
  against a network-accessible CodeQL registry.
- SSL certificate errors during `codeql pack install` require fixing
  the system CA store — manual library download is strongly discouraged
  due to version mismatch risk.
- The `pyfiglet` package is optional (`SpeQL.py` has a fallback ASCII
  logo) but is listed in `requirements.txt`.

## Canonical validation commands

```bash
# Verify Python analyzer works
python3 analyze.py

# Verify CodeQL queries run (requires CodeQL 2.20.x and built database)
./run-queries.sh

# Verify cARL governance layer is healthy (requires carl CLI)
carl doctor
```

## Current operating assumptions

- Azure REST API specs are sourced from
  `github.com/Azure/azure-rest-api-specs` via the refresh scripts.
- The default CodeQL database scope is `specification/logic` (Logic
  Apps). Use `--path` or `--all` to widen scope.
- APISpy ships with 302 provider shards pre-bundled in
  `apispy/extension/data/`.
- cARL governance artefacts are stored in `.github/carl/` and
  `.github/instructions/`.

## Governance migration status

**This file is a transitional memory bridge, not a completed cARL runtime.**

`.github/aadlc/` artefacts remain present alongside `.github/carl/`
artefacts. Formal migration has not yet been completed. Until `carl
convert aadlc` has been run and the migration verified:

- Agents must read **both** `.github/aadlc/` artefacts **and** this
  file when orienting for a task.
- Do not treat `.github/carl/memory.md` alone as the complete runtime
  authority — the AADLC artefacts may contain additional durable
  knowledge not yet migrated here.
- Once `carl convert aadlc --apply` has been run and reviewed, remove
  this notice and update the **Last updated** timestamp.

## Open questions

- Migration from `.github/aadlc/` to `.github/carl/` is not yet
  complete. Use `carl convert aadlc` when the CLI is available to
  migrate durable knowledge formally.

## Last updated

2026-06-30 by copilot/hydrate-carl-docs
