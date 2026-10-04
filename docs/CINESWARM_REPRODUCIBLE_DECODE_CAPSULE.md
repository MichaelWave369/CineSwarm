# CineSwarm C1.23 — Reproducible Decode Capsule + SBOM + Reconstruction Proof

Status: governed preservation layer after C1.22. C1.23 preserves enough decoder-environment evidence to reconstruct and test a known-good runtime without allowing that evidence to replace the media, authorize release, or imply a stronger rebuild proof than was actually performed.

## Purpose

C1.22 answers: **Which exact decoder environment successfully decoded this media?**

C1.23 answers: **What exact binaries, linked libraries, package identities, recipe, and media lineage do we need to reconstruct and retest that decoder environment?**

## Evidence objects

1. **Decoder SBOM** — exact ffmpeg/ffprobe executable hashes, direct dynamic-library hashes, Debian package/version inventory, OS identity, source C1.22 snapshot hash.
2. **Rebuild Recipe** — deterministic offline reconstruction instructions and exact executable/library requirements.
3. **Decode Capsule** — binds the C1.22 PASS compatibility matrix, SBOM, recipe, original Master hash, and preservation-derivative hash.
4. **Reconstruction Report** — verifies copied exact decoder executables in a fresh isolated working directory, recomputes capability fingerprints, and fully decodes both authoritative media items.
5. **Append-only Repro Decode Register** — records the evidence hashes without gaining release authority.

## Proof scope

The local proof is deliberately named:

`isolated-runtime-reconstruction-not-full-os-source-rebuild`

It proves that the captured ffmpeg/ffprobe bytes can be copied into a fresh runtime root, executed with an isolated PATH/HOME/TMPDIR, and reproduce the same C1.22 capability fingerprint while fully decoding the same authoritative media.

It **does not** prove:

- an independent rebuild from upstream source code;
- an offline reinstallation of every Debian package from archived package blobs;
- a fully isolated kernel/OS/container environment;
- independence from the host dynamic linker and host shared libraries.

Those facts remain explicit in the Reconstruction Report:

- `hostDynamicLibrariesShared: true`
- `fullOsIsolation: false`
- `fullIndependentSourceRebuildProven: false`

## Authority boundary

C1.23 never permits:

- deleting the historical original;
- deleting the C1.21 preservation derivative;
- replacing either authoritative media object with a decoder capsule;
- publishing or republishing anything;
- using Parallax Relay as a hidden dependency.

## Canonical PN-0001 state

The canonical C1.23 register remains revision 0 because PN-0001 has no real governed C1.22 decode history. Operational reconstruction evidence is proof-only and remains separate.
