# CineSwarm C1.22 — Decode Environment Snapshot + Compatibility Matrix + Preservation Access Derivatives

Status: additive preservation-access layer after C1.21. This layer does not replace the historical original, does not replace the C1.21 preservation derivative, and does not grant public-release authority.

## Purpose

C1.21 preserves media representation by keeping the original immutable and allowing a decoded-equivalent preservation derivative. C1.22 addresses the next failure mode: the bytes still exist, but the decoder environment, codec support, or everyday playback tooling has aged away.

C1.22 therefore records three different truths separately:

1. **Decoder environment identity** — exact FFmpeg/FFprobe executable hashes, version-output hashes, and decoder/encoder/container capability hashes.
2. **Authoritative-media compatibility** — whether the registered C1.21 original and preservation derivative are available, hash-correct, probeable, and fully decodable in that exact environment.
3. **Playback access media** — a convenience derivative that may be easier for ordinary future players to open, but can never become preservation authority or release authority.

## Frozen internal policy

The initial Parallax access profile is deliberately labeled an internal operational profile, not an archival standard:

- container: MP4
- video: H.264
- audio: AAC
- pixel format: yuv420p
- audio: 48 kHz stereo
- video CRF: 20
- fast-start metadata enabled

Freshness policy:

- decoder-environment snapshot: maximum 30 days for creating a new access plan
- compatibility matrix: maximum 30 days for creating a new access plan
- access duration delta: maximum 0.05 seconds

These are internal Parallax policy choices, not external preservation-industry claims.

## Authority law

The access derivative always carries:

```text
originalStillRequired                 = true
preservationDerivativeStillRequired  = true
accessDerivativeCanReplaceOriginal   = false
accessDerivativeCanReplacePreservationDerivative = false
accessDerivativeCanAuthorizeRelease  = false
publicRelease                         = false
relayDependency                       = false
```

C1.22 does not auto-download decoders, auto-transcode for release, delete authoritative media, or make Parallax Relay a dependency.

## Environment snapshot

`cineswarm-capture-decode-environment.mjs` captures:

- OS platform and CPU architecture
- Node runtime version
- exact `/usr/bin/ffmpeg` SHA-256
- exact `/usr/bin/ffprobe` SHA-256
- FFmpeg/ffprobe version-output SHA-256 values
- FFmpeg decoder-list SHA-256
- FFmpeg encoder-list SHA-256
- FFmpeg format-list SHA-256
- combined capability hash

It stores no credentials.

## Compatibility matrix

The matrix contains exactly two authoritative roles:

- `ORIGINAL_MASTER`
- `PRESERVATION_DERIVATIVE`

Each role is evaluated against the exact C1.21 hash lineage.

Possible overall states:

- `PASS` — both original and preservation derivative are available, hash-correct, probeable, and fully decodable.
- `DEGRADED` — the original is unavailable, but the registered preservation derivative remains exact and fully decodable.
- `FAIL` — the preservation derivative fails, or an available authoritative item disagrees with its expected hash/decoder result.

`DEGRADED` never means the original was verified. Missing evidence is not converted into success.

## Access derivative gate

An access plan can be built only from a registered and fully revalidated C1.21 preservation derivative. The plan binds:

- C1.21 Preservation Derivative Record hash
- exact preservation-derivative SHA-256
- exact historical-original SHA-256
- C1.22 Decode Environment Snapshot hash
- C1.22 Compatibility Matrix hash
- frozen access profile

The resulting access file must pass:

- full decode
- MP4 container
- H.264 video
- AAC audio
- yuv420p
- 48 kHz stereo
- duration tolerance
- geometry parity
- frame-rate parity

This is a **playback-access QC gate**, not preservation-equivalence. A lossy H.264/AAC access derivative is not expected to decode to the same raw hashes as the FFV1 preservation derivative.

## Human review

A governed Access Derivative Record requires a real human review with decision:

- `APPROVE_ACCESS_DERIVATIVE`
- `REVISE`
- `HOLD`

The approval scope is explicitly:

`ACCESS_ONLY_NOT_PRESERVATION_NOT_RELEASE`

The operational proof in this package intentionally does **not** create that human review. It stops after technical QC and therefore does not create a governed Access Derivative Record.

## Append-only Decode/Access Register

The C1.22 register can record:

- `DECODE_ENVIRONMENT_SNAPSHOT_RECORDED`
- `COMPATIBILITY_MATRIX_RECORDED`
- `ACCESS_DERIVATIVE_RECORDED`

Every register entry is individually SHA-256 self-hashed and linked to the previous entry hash.

## Operational proof

The proof uses the synthetic C1.21 media already created during the previous phase.

Actual captured environment:

- Node v22.16.0
- FFmpeg 7.1.5-0+deb13u1
- ffprobe 7.1.5-0+deb13u1
- environment snapshot: `3fc6d78435e45dc56a125967be9b8030352a495bc136bf2f6e6e78efedc323aa`
- capability hash: `1cc0a123132cd5d3103c0efe808cc106dde9a7f8a7a8a057f8b53befeeb4ceb5`

Authoritative proof media:

- synthetic original SHA-256: `259afcbc9a18f058db3cf028ea1ea6e71205708592156eabd2220e7a07b8edd1`
- synthetic C1.21 preservation derivative SHA-256: `75119a3052bbe86cfaea2efc67b39003a714f889f7854d5e07487cd21c4848ee`
- compatibility matrix status: `PASS`
- compatibility matrix hash: `c6bb6ae4c4a8a6bb8a148da9abfbd94111bac2dbc379815d821b1d5da4a142e1`

Actual playback-access derivative:

- MP4 / H.264 / AAC
- 320 × 180
- 24 fps
- 48 kHz stereo
- 2.000 seconds
- SHA-256: `340043dec543b89bad917e97ae2feeb771e84aa2caa8f9e0b9b5b57c6ace1518`
- QC status: `PASS`
- QC hash: `b2a89b36e81465781dd823f1611577a175ff026aef6dc60200d8371e8f23b846`

The proof register records only the environment snapshot and compatibility matrix, reaching revision 2. It intentionally does not record the access derivative because no real human C1.22 access review occurred.

## Canonical PN-0001 state

Canonical C1.22 remains revision 0 because PN-0001 has no real C1.21 preservation derivative:

```text
environment snapshots    0
compatibility matrices   0
access derivatives       0
publicRelease            false
relayDependency          false
```

Canonical register hash:

`6d08096913aaa03d1fdc49dbda195fd85eefccd4ed945be9bd1ddb3115a9ad22`
