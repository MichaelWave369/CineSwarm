# CineSwarm C1.10 — Picture Lock Ceremony + Locked Picture Manifest

Status: additive editorial-freeze layer after C1.9 Candidate Asset Registry + Picture Plan Assembly.

## Governing rule

> A human-approved Picture Plan is eligible to be locked. It is not locked until a real human signs the exact C1.10 Picture Lock ceremony.

C1.10 creates an explicit editorial boundary between planning and a frozen picture edit.

## Input requirements

A Picture Lock ceremony requires all of the following:

1. a valid C1.9 Picture Plan Candidate;
2. the exact C1.9 Candidate Asset Registry revision/hash referenced by that plan;
3. a real non-simulated human C1.9 review whose decision is `APPROVE_FOR_LOCK_CEREMONY`;
4. an active Ed25519 human signing public key in the existing CineSwarm signing-key registry;
5. the corresponding private key held outside the repository under `external-human-controlled` custody.

The signed ceremony binds:

- Picture Plan ID + SHA-256;
- C1.9 review ID + SHA-256;
- Candidate Asset Registry ID / revision / SHA-256;
- production sequence-job SHA-256;
- continuity-version ID;
- exact ordered shot-selection SHA-256;
- shot count + total duration;
- human authority ID;
- signing key ID + public-key fingerprint;
- lock timestamp.

The signature domain is deliberately distinct from provider execution authorization:

```text
PARALLAX-CINESWARM-C1.10-PICTURE-LOCK
```

A valid execution-authorization signature therefore cannot be reinterpreted as a Picture Lock signature.

## Locked Picture Manifest

After a valid ceremony, C1.10 creates an immutable self-hashed Locked Picture Manifest containing the exact selected candidate/artifact/request hashes for every governed shot.

A new manifest asserts:

- `state: PICTURE_LOCKED`
- `pictureLocked: true`
- `immutableManifest: true`
- `changesRequireExplicitUnlock: true`

It still asserts:

- `canonEligible: false`
- `ledgerPromotionEligible: false`
- `publicRelease: false`
- `relayDependency: false`

Picture Lock is therefore an editorial freeze, not Canon, release, or publication authority.

## No silent edits

The Locked Picture Manifest itself is never mutated to represent later changes.

C1.10 uses an append-only hash-chained Picture Lock Register with three event types:

1. `LOCK`
2. `UNLOCK_FOR_REVISION`
3. `SUPERSEDE`

The required replacement path is:

```text
LOCK old manifest
  ↓
Signed UNLOCK_FOR_REVISION
  ↓
Separately sign + LOCK replacement manifest
  ↓
Signed SUPERSEDE old → replacement
```

This preserves the old lock as immutable history and prevents a newer file from silently masquerading as the originally approved edit.

## Key lifecycle semantics

New Picture Lock and transition signatures require an `active` human Ed25519 key.

Historical signatures may continue to verify after normal key retirement when they were signed inside the key-validity interval. A `revoked` key invalidates Picture Lock transition verification.

Private keys are never included in CineSwarm package state.

## Canonical PN-0001 state

The real PN-0001 Sequence 01 Picture Lock register is deliberately empty:

- revision `0`
- lock events `0`
- active Locked Picture Manifest `null`
- `pictureLocked:false`
- `publicRelease:false`
- `relayDependency:false`

This reflects the actual production state: no real provider assets, accepted candidates, human-approved Picture Plan, or real Picture Lock ceremony exist yet.

## Local status

```bash
node scripts/cineswarm-picture-lock-status.mjs
```

## Creating a real Picture Lock later

The signing private key must remain outside the repository:

```bash
node scripts/cineswarm-create-picture-lock.mjs \
  fixtures/cineswarm/pn-0001-c1-10-picture-lock-policy.json \
  /governed/path/picture-plan.json \
  /governed/path/picture-plan-review.json \
  /governed/path/candidate-registry.json \
  /governed/path/signing-key-registry.json \
  /external/private/key.pem \
  /governed/output/picture-lock \
  michael-hughes
```

The command writes only the signed ceremony and Locked Picture Manifest. It never copies the private key into output.

## Editorial transition command

C1.10 also provides `scripts/cineswarm-picture-lock-transition.mjs` to create signed `UNLOCK_FOR_REVISION` or `SUPERSEDE` records. A `SUPERSEDE` record requires a separately locked replacement manifest.

## Authority boundary

C1.10 may lock exact picture selections after real human approval and signature.

C1.10 may not:

- fabricate the C1.9 human Picture Plan review;
- fabricate a signing identity;
- keep private signing keys in the repository;
- silently rewrite a Locked Picture Manifest;
- grant Canon;
- grant Ledger promotion;
- grant public release;
- modify or depend on Parallax Relay.
