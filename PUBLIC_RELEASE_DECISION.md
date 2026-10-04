# Public Release Decision — CineSwarm v0.2.0

**Decision date:** 2026-10-03  
**Decision owner:** Michael Hughes / MichaelWave369  
**Repository:** `MichaelWave369/CineSwarm`  
**License:** MIT

The project owner explicitly authorizes the CineSwarm v0.2.0 source candidate for public release under the MIT License.

This decision supersedes the earlier private-candidate release restriction recorded in the original v0.2.0 handoff. The historical private status and source manifest are retained under `provenance/` so the transition remains auditable rather than rewritten.

## Scope of the public release

Included:

- Python source under `src/`;
- tests;
- examples;
- configuration templates;
- core Python package source, tests, examples, and configuration templates;
- v0.2 build documentation and the Stage 36 field packet needed to understand operational boundaries;
- preserved private-candidate release provenance.

The larger historical Stage 3/6/9/12/18/24/27/45 governance archive will follow in a separate provenance-only import so release qualification and archival history remain reviewable as distinct changes.

Not included:

- Wan source code;
- model weights or checkpoints;
- secrets or machine-local credentials;
- the prebuilt private-candidate wheel from `dist-final/`.

Release artifacts may be rebuilt from public source after CI qualification.

## Claims deliberately not changed by this decision

Public source release does not imply that:

- Pocket Spark has been physically rendered or accepted;
- Windows/LAN/NVIDIA/CUDA field qualification has been completed;
- Internet exposure is authorized;
- third-party model licenses or model weights are redistributed by this repository;
- an upstream ACCEPT/REJECT media review grants publication authority for generated media.

The engine remains local-first, receipt-driven, and explicit about authority boundaries.
