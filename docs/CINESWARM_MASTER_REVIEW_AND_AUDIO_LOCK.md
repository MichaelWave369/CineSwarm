# CineSwarm C1.12 — Master Review + Audio Lock + Master Candidate Acceptance

## Status

C1.12 is a fail-closed human authority layer after C1.11 Render Candidate creation.

It adds three deliberately separate decisions:

1. **Audio Lock** — a human Ed25519 signature freezes the exact C1.11 Audio Conform manifest and exact mix bytes.
2. **Master Review** — a self-hashed human creative + technical review binds the exact Render Candidate, output MP4, measured QC, Picture Lock lineage, and active Audio Lock.
3. **Master Acceptance Ceremony** — a separate human Ed25519 signature accepts that exact reviewed render as a **Master Candidate**.

No one record is allowed to stand in for another.

## Audio Lock

The Audio Lock signature domain is:

`PARALLAX-CINESWARM-C1.12-AUDIO-LOCK`

It binds:

- Audio Conform manifest ID + SHA-256;
- Locked Picture Manifest SHA-256;
- exact mix SHA-256 + byte size + media type;
- mix duration, 48 kHz sample rate, stereo channel count;
- timeline duration;
- human authority, signing key, and timestamp.

Private-key custody remains `external-human-controlled`.

A Locked Audio Manifest is immutable. Audio changes require signed `UNLOCK_FOR_REMIX`; replacement audio receives a new signed Audio Lock; signed `SUPERSEDE` records the relationship without mutating the old manifest.

## Master Review

A Master Review binds the exact C1.11 Render Candidate hash and requires separate booleans for:

- `creativeApproved`
- `technicalApproved`

`ACCEPT_MASTER_CANDIDATE` is invalid unless both are true.

The review itself does **not** grant Master acceptance. It sets `masterAcceptanceCeremonyRequired:true` and preserves `masterAccepted:false`.

## Master Acceptance Ceremony

The acceptance signature domain is:

`PARALLAX-CINESWARM-C1.12-MASTER-CANDIDATE-ACCEPTANCE`

It binds:

- exact Render Candidate SHA-256;
- exact rendered MP4 SHA-256;
- Render QC SHA-256;
- Render Contract SHA-256;
- Locked Picture Manifest SHA-256;
- Audio Conform SHA-256;
- Locked Audio Manifest SHA-256;
- Master Review SHA-256.

Only after this ceremony may C1.12 create a `MASTER_CANDIDATE` object.

## Downstream authority boundary

A valid Master Candidate has:

- `pictureLocked:true`
- `audioLocked:true`
- `measuredQcPassed:true`
- `masterAccepted:true`
- `masterCandidateAccepted:true`

while still preserving:

- `canonEligible:false`
- `ledgerPromotionEligible:false`
- `publicRelease:false`
- `relayDependency:false`

Master Candidate acceptance is therefore not Canon promotion, Ledger admission, or Network release.

## Canonical PN-0001 state

The canonical C1.12 Audio Lock Register and Master Candidate Register are both revision 0. No real Audio Lock, Master Review, Master Acceptance Ceremony, or Master Candidate is claimed.
