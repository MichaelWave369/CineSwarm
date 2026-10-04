# CineSwarm C1.24G — Resumable Human Ceremony Orchestrator

C1.24G is an operational continuity layer over C1.24D/E/F. It does not create a human key, infer fingerprint acknowledgement, sign admission, confirm the commit, apply canonical state automatically, or authorize release.

## State machine

1. `CHALLENGE_BOUND` → `AWAITING_PUBLIC_ENROLLMENT_RESPONSE`
2. `ENROLLMENT_RESPONSE_VERIFIED` → `AWAITING_FINGERPRINT_ACKNOWLEDGEMENT`
3. `FINGERPRINT_ACKNOWLEDGED` → `AWAITING_PUBLIC_KEY_STAGE`
4. `PUBLIC_KEY_STAGE_VERIFIED` → `AWAITING_ADMISSION_SIGNING_REQUEST`
5. `ADMISSION_SIGNING_REQUEST_ISSUED` → `AWAITING_OFFLINE_ADMISSION_SIGNATURE`
6. `ADMISSION_SIGNATURE_VERIFIED` → `AWAITING_CANONICAL_ADMISSION_STAGE`
7. `CANONICAL_ADMISSION_STAGE_VERIFIED` → `AWAITING_COMMIT_DIGEST_CONFIRMATION`
8. `COMMIT_DIGEST_CONFIRMED` → `AWAITING_C1_24F_CANONICAL_COMMIT_RECEIPT`
9. `CANONICAL_COMMIT_RECEIPT_VERIFIED` → `COMPLETE`

Human-only gates are fingerprint acknowledgement, offline private-key signing, and commit-digest confirmation. Generic conversation text is never a substitute.

## Transcript semantics

The transcript is SHA-256 self-hashed and event-hash-chained. It is an evidence transcript, **not an independent human witness**. Every event references a public artifact path, artifact SHA-256, validator ID, actor kind, timestamp, and previous-event hash.

## Recovery pack

The recovery pack binds the session, transcript, current resume state, starting canonical hashes, and public artifacts required to continue. Private-key paths are rejected. A recovery pack cannot authorize admission or apply canonical state.

## Resume

```bash
node scripts/cineswarm-c1-24g-resume.mjs --dir live/c1-24g
```

If the public enrollment challenge has expired before the response is created, the state becomes `CHALLENGE_EXPIRED_REISSUE_REQUIRED`; the expired challenge is never silently reused.
