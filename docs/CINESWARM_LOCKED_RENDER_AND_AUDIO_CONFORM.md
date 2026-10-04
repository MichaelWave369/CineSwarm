# CineSwarm C1.11 — Locked Picture Render Contract + Audio Conform Gate

Status: additive post-production governance layer after C1.10 Picture Lock. C1.11 can create a governed **Render Candidate** only. It cannot grant Audio Lock, Master acceptance, Canon, Ledger promotion, or public release.

## Core law

```text
C1.10 active Locked Picture Manifest
        ↓
exact picture file/hash verification
        ↓
C1.11 Audio Conform Manifest
        ↓
real human APPROVE_FOR_RENDER review
        ↓
Locked Render Contract
        ↓
FFmpeg render
        ↓
independent ffprobe + loudnorm measurement
        ↓
PASSED Render QC Report
        ↓
Render Candidate
```

A successful renderer exit code is not sufficient. Picture lineage, audio lineage, human audio-conform review, output hashes, and measured QC are independently validated.

## Picture input rules

The render contract may use only the exact artifact SHA-256 values frozen inside the **currently active** C1.10 Locked Picture Manifest. Before FFmpeg is invoked, every local input path is confined to its governed root and its file bytes are re-hashed.

Any silent file replacement after Picture Lock causes the render input verifier to fail.

## Audio conform rules

C1.11 records narration/music/SFX lineage separately from the rendered picture. The audio conform manifest binds:

- the exact Locked Picture Manifest hash;
- the exact locked timeline duration;
- source SHA-256 and lineage per track;
- rights posture per track;
- narration voice-consent posture;
- an exact mixed-audio file hash and byte count;
- 48 kHz stereo format.

A real non-simulated human must record one of:

- `APPROVE_FOR_RENDER`
- `REVISE`
- `HOLD`

Even `APPROVE_FOR_RENDER` does **not** create Audio Lock or Master acceptance.

## Internal audio QC target

The frozen C1.11 internal Parallax target is:

- integrated loudness: **-16 LUFS**
- tolerance: **±1 LU**
- maximum true peak: **-1.5 dBTP**
- sample rate: **48,000 Hz**
- channels: **2**

This is explicitly labeled `internal-parallax-target-not-external-broadcast-compliance`. It is not represented as an external broadcast, streaming-platform, or legal compliance standard.

## Render output profile

The first bounded profile is:

- 1280 × 720
- 24 fps
- H.264 video
- AAC audio
- 48 kHz stereo

The profile is part of the self-hashed render policy and render contract.

## Independent measured QC

`scripts/cineswarm-measure-render-qc.mjs` uses:

1. `ffprobe` for duration, stream count, dimensions, sample rate, and channel count;
2. FFmpeg `loudnorm` measurement for integrated loudness and true peak.

A Render Candidate requires all checks to pass.

## Render Candidate boundaries

A C1.11 Render Candidate always records:

```text
pictureLockedAtRender          = true
measuredQcPassed               = true
humanMasterAcceptanceRequired  = true
masterAccepted                 = false
audioLocked                    = false
canonEligible                  = false
ledgerPromotionEligible        = false
publicRelease                  = false
relayDependency                = false
```

## Append-only Render Candidate Register

QC-passed Render Candidates can be appended to the C1.11 Render Candidate Register. Registering a render does not select it as the Master. Multiple render candidates may exist while every one remains outside Canon and release authority.

## Canonical PN-0001 state

The real canonical state remains empty because PN-0001 has no real provider-backed accepted assets and therefore no active C1.10 Picture Lock:

- Picture Lock register revision: `0`
- active Locked Picture Manifest: `null`
- Audio Conform Manifests: `0`
- Render Contracts: `0`
- measured QC passes: `0`
- Render Candidate register revision: `0`
- Render Candidates: `0`
- Master acceptances: `0`
- public release: `false`

## Operational commands

Inspect canonical readiness:

```bash
node scripts/cineswarm-locked-render-status.mjs
```

Render an already-governed contract:

```bash
node scripts/cineswarm-render-locked-picture.mjs \
  policy.json \
  locked-picture-manifest.json \
  picture-lock-register.json \
  render-contract.json \
  /governed/picture/root \
  /governed/audio/root \
  /output/render-candidate.mp4
```

Measure QC independently:

```bash
node scripts/cineswarm-measure-render-qc.mjs \
  policy.json \
  render-contract.json \
  render-candidate.mp4 \
  renders/render-candidate.mp4 \
  render-qc.json
```

Create the governed Render Candidate only after QC passes:

```bash
node scripts/cineswarm-create-render-candidate.mjs \
  policy.json \
  render-contract.json \
  render-qc.json \
  render-candidate.json
```

## Preserved architecture boundaries

CineSwarm produces. Studio decides. Ledger proves. Network publishes.

Parallax Relay remains independent and is neither modified nor required by C1.11.
