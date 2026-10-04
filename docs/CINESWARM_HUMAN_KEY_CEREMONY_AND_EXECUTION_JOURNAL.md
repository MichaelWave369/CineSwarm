# CineSwarm C1.7 — Human Key Ceremony + Replay-Proof Execution Journal

Status: additive governance/runtime boundary. C1.7 does not create a real human signing identity, authorize a provider run, spend money, accept generated assets, or grant public release.

## Purpose

C1.6 made founder/request approvals cryptographically sealable. C1.7 adds the lifecycle around those keys and the single-use execution state around short-lived runner envelopes.

The governing path becomes:

```text
External human-controlled Ed25519 key
  ↓ public key + proof of possession only
Human key ceremony
  ↓
C1.6 signed founder/request receipts
  ↓
C1.6 verified short-lived execution envelope
  ↓
C1.7 atomic CLAIMED journal event
  ↓
provider attempt
  ↓
C1.7 SUCCEEDED / FAILED / ABORTED journal event
```

Once an envelope is `CLAIMED`, it remains consumed even if the provider attempt fails or aborts. A retry requires a fresh execution envelope with a new nonce.

## Human key ceremony

C1.7 supports four explicit actions:

- `ENROLL` — first active public key for a human authority;
- `ROTATE` — retire an active key and activate a new key;
- `RECOVER` — revoke the previous key and activate a replacement, with multiple recovery evidence references and explicit risk acknowledgement;
- `REVOKE` — revoke a key without inventing a replacement.

Enrollment, rotation, and recovery require Ed25519 proof-of-possession: the new private key signs a ceremony challenge containing the ceremony ID, human authority ID, key ID, SHA-256 public-key fingerprint, and challenge nonce.

Only the public key, fingerprint, and proof signature enter the ceremony record. The private key remains external and human-controlled.

Canonical current-state fixtures:

- `fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json`
- `fixtures/cineswarm/pn-0001-c1-7-key-ceremony-plan.json`
- `fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json`

The current plan intentionally remains `PENDING_KEY_GENERATION`; no real human key has been fabricated.

## Execution journal

Canonical empty journal:

- `fixtures/cineswarm/pn-0001-c1-7-execution-journal.json`

Every journal entry is SHA-256 hash-chained to the previous entry. Validation recomputes the complete chain and rejects retroactive changes.

Replay is rejected if a previous `CLAIMED` event matches any of:

- execution envelope ID;
- canonical execution envelope SHA-256 digest;
- execution envelope nonce;
- execution ID.

The first write is an atomic filesystem-locked `CLAIMED` event. The terminal event is exactly one of:

- `SUCCEEDED`
- `FAILED`
- `ABORTED`

A failed or aborted envelope remains consumed.

## Commands

Inspect current key-ceremony state:

```bash
node scripts/cineswarm-key-ceremony-status.mjs
```

Validate a completed ceremony without mutating the canonical registry:

```bash
node scripts/cineswarm-verify-key-ceremony.mjs ceremony.json
```

Inspect the execution journal:

```bash
node scripts/cineswarm-execution-journal-status.mjs
```

Claim a fully verified C1.6 execution envelope into a journal:

```bash
node scripts/cineswarm-claim-execution-envelope.mjs \
  envelope.json packet.json requests.json authorization-batch.json \
  founder-decision.json founder-seal.json authorization-seals.json \
  key-registry.json revocations.json journal.json execution-id now
```

Finalize a claimed execution:

```bash
node scripts/cineswarm-finalize-execution-journal.mjs \
  journal.json envelope-id execution-id SUCCEEDED
```

## Authority boundaries

C1.7 may manage public-key lifecycle receipts and single-use execution state. It may not:

- generate or store a real human private key inside the repository or package;
- infer a human enrollment/rotation/recovery decision;
- authorize provider generation without C1.5/C1.6 gates;
- reuse a consumed execution envelope;
- accept provider output on behalf of a human;
- publish to Parallax Network;
- modify or depend on Parallax Relay.
