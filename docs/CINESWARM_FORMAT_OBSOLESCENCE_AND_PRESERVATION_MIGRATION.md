# CineSwarm C1.21 — Format Obsolescence Monitor + Preservation Format Migration

Status: governed preservation derivative layer. It does not replace, delete, republish, or alter the historical Master.

## Core law

The original historical Master remains immutable forever. C1.21 may create a preservation derivative only after an evidence-backed format assessment, a migration recommendation, measured decoded audiovisual equivalence, human review, and a signed migration ceremony.

## Assessment states

- `SUPPORTED`
- `WATCH`
- `MIGRATION_RECOMMENDED`

C1.21 never automatically declares a format obsolete. Operator/evidence review is mandatory.

## Internal derivative profile

The first internal Parallax preservation derivative profile is:

- Matroska container
- FFV1 video
- 24-bit PCM audio

This is an internal Parallax engineering profile, not a claim of universal archival standard status.

## Equivalence gate

Source and derivative must match on:

- duration within 20 ms
- width/height
- frame rate
- audio sample rate
- channel count
- SHA-256 of canonical decoded video bytes
- SHA-256 of canonical decoded audio bytes

The decoded checks compare canonicalized output, not container bytes. The derivative file is expected to have a different file hash from the immutable original.

## Authority boundaries

A preservation derivative:

- cannot replace the historical original
- cannot authorize deletion of the original
- cannot authorize public release
- cannot authorize Ledger or Canon changes
- cannot make Parallax Relay a dependency

## Operational inspection

```bash
node scripts/cineswarm-format-obsolescence-status.mjs
node scripts/cineswarm-measure-format-equivalence.mjs source.avi derivative.mkv
```
