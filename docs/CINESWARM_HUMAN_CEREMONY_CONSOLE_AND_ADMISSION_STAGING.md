# CineSwarm C1.24E — Human Ceremony Console + Canonical Admission Staging

C1.24E is the public-evidence operator layer above C1.24D. It exists so the human private key never needs to enter CineSwarm while the public ceremony can still be verified and prepared safely.

## Authority law

C1.24E cannot generate a human private key, infer fingerprint acknowledgement from conversation, sign the admission, apply canonical state, authorize release, or create a Relay dependency.

The real canonical state remains unchanged until a separate human-controlled commit act occurs.

## State machine

1. `AWAITING_PUBLIC_ENROLLMENT_RESPONSE`
2. Verify the C1.24D enrollment response and Ed25519 proof-of-possession.
3. Display the full 64-hex public-key SHA-256 fingerprint.
4. Human re-enters that exact full fingerprint.
5. Build an immutable fingerprint acknowledgement receipt.
6. Stage the public key into a cloned signing-key registry only.
7. Prepare the short-lived C1.24D/C1.24C signing request.
8. Human signs offline with the externally held private key.
9. Verify the returned public signed response.
10. Build a proposed canonical admission bundle.
11. Stop at `CANONICAL_COMMIT_READY_REQUIRES_SEPARATE_HUMAN_ACT`.

## Commands

Verify a returned public enrollment response:

```bash
node scripts/cineswarm-c1-24e-verify-enrollment-response.mjs \
  --challenge /path/to/C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json \
  --response /path/to/michael-hughes-c1-24-admission-001.enrollment-response.json \
  --now 2026-08-13T23:00:00Z \
  --out /path/to/C1_24E_ENROLLMENT_RESPONSE_VERIFICATION.json
```

After independently comparing the fingerprint, create the human acknowledgement by re-entering all 64 hexadecimal characters:

```bash
node scripts/cineswarm-c1-24e-acknowledge-fingerprint.mjs \
  --challenge /path/to/challenge.json \
  --response /path/to/enrollment-response.json \
  --ack-fingerprint <FULL_64_HEX_SHA256_FINGERPRINT> \
  --acknowledged-at <ISO_8601_TIME> \
  --out /path/to/C1_24E_FINGERPRINT_ACKNOWLEDGEMENT.json
```

Stage public-key enrollment without mutating the canonical registry:

```bash
node scripts/cineswarm-c1-24e-stage-key-enrollment.mjs \
  --challenge /path/to/challenge.json \
  --response /path/to/enrollment-response.json \
  --acknowledgement /path/to/C1_24E_FINGERPRINT_ACKNOWLEDGEMENT.json \
  --recorded-at <ISO_8601_TIME> \
  --out-dir /path/to/public-key-stage
```

A later valid offline admission signature may be converted into a proposed canonical bundle with `cineswarm-c1-24e-stage-canonical-admission.mjs`. That command still writes only stage/proposal files; it does not overwrite canonical fixtures.

## Current real state

- Real C1.24B technical proof: earned.
- Real public C1.24D enrollment response received by CineSwarm: no.
- Real fingerprint acknowledgement: no.
- Real human public key staged/enrolled: no.
- Real admission signature: no.
- Real canonical C1.24 revision: 0.
- Public release: false.
- Relay dependency: false.
