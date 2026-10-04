# CineSwarm C1.24H — Challenge Health, Expiry/Reissue, and Compact Human Handoff

C1.24H is an operational safety/portability layer over C1.24G. It does not generate the real human private key, infer fingerprint acknowledgement, sign C1.24C admission, confirm C1.24F commit intent, apply canonical state, authorize release, or require Parallax Relay.

## Health audit

The live audit revalidates the C1.24G session/transcript/resume/recovery objects, compares all four canonical baseline hashes, verifies the public recovery-pack artifact bytes, checks challenge freshness, and scans for private-key leakage.

Results are deliberately distinct:

- `PASS` — canonical baseline and public artifacts match; challenge is active.
- `DEGRADED` — public continuity is intact but the challenge expired or the public handoff is incomplete.
- `FAIL` — canonical drift, artifact-hash mismatch, or private-key detection. Stop for manual review.

## Expired challenge reissue

Reissue is allowed only after expiration, only while the predecessor transcript contains no verified enrollment response, and only with the same human authority, key identity, and canonical C1.24 baseline. The replacement receives a fresh nonce/hash and an explicit lineage receipt. No enrollment or admission authority is carried forward.

## Compact handoff

`handoff/c1-24h/` contains only public ceremony state and standalone Node.js tooling for generating/verifying the external public enrollment response. It intentionally excludes the FFmpeg preservation/build closure and all canonical-write machinery.

The private-key destination must be an absolute directory outside the handoff bundle. Only the public `*.enrollment-response.json` returns to CineSwarm.
