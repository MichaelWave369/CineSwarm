# CineSwarm C1.24H Public Source Promotion

**Source lineage:** Parallax CineSwarm C1.24H / `@parallax-network/cineswarm-bridge` v0.26.0  
**Public repository:** `MichaelWave369/CineSwarm`  
**Public source license:** MIT  
**Promotion date:** 2026-10-04

## Decision

The project owner explicitly authorized this CineSwarm lineage for public release. The sealed C1.24H snapshot recorded the bridge package as `UNLICENSED`; that original package metadata is preserved verbatim in `package.original.json`.

The current source package changes the source license to MIT and adds repository metadata. `"private": true` remains intentionally enabled as an npm publication guard. It does not describe GitHub repository visibility.

## Sealed-source provenance

Original uploaded sidecar:

- file: `Parallax_CineSwarm_C1_24H_Challenge_Health_Handoff_Sidecar (1).zip`
- byte size: `84621739`
- SHA-256: `86890558973ae190c7222501d93ff89d9708505c879c5f882707b320d8cc7c1b`
- sealed package manifest verification: **524 / 524 entries matched**
- full sealed bridge qualification: **358 / 358 PASS**

The original C1.24H package manifest is preserved as `SEALED_PACKAGE_MANIFEST.sha256`. It intentionally references files that are not all committed to Git.

## Public Git cut

Included:

- `packages/cineswarm-bridge/` source and tests
- `scripts/` bridge/governance tooling
- `fixtures/cineswarm/` deterministic policy/register fixtures
- `docs/` C1 governance documentation
- compact deterministic proof fixtures required by the public test suite
- compact C1.24H handoff and historical Studio integration snapshot under this provenance directory
- seal, health, handoff, operational-proof and verification records

Excluded from Git history:

- the four heavyweight C1.24 acquisition archives:
  - `ffmpeg-7.1.5.tar.xz`
  - `sysroot.tar.xz`
  - `buildtools.tar`
  - `toolchain.tar.xz`

Those sealed binaries remain bound to the original sidecar by its archive SHA-256 and package manifest.

When those four archives are absent, the one byte-for-byte seven-class acquisition test reports an explicit skip. All other bridge tests remain executable.

## Historical challenge status

The C1.24H report described the enrollment challenge as healthy when sealed. That challenge expired at:

`2026-08-15T00:36:55.070Z`

The preserved health/session state is therefore historical evidence, not a claim that the challenge is currently active.

## Authority boundary

Public source availability does not enroll a human key, grant canonical mutation authority, authorize release/publication, infer human acknowledgement, provide Relay authority, or redistribute third-party model weights/licenses.
