# Parallax CineSwarm C1.9 — Candidate Asset Registry + Picture Plan Assembly

Status: additive post-quarantine planning layer. C1.9 does **not** grant Picture Lock, Canon, Ledger promotion, or public release authority.

## Governing rule

> Human acceptance makes an artifact a candidate. A complete candidate set may form a Picture Plan. Neither act locks picture.

C1.9 consumes only C1.8 artifacts that have a real, non-simulated human `ACCEPT` decision bound to the exact artifact SHA-256.

## Candidate Asset Registry

Every accepted artifact receives a self-hashed registry entry bound to:

- candidate asset ID;
- episode / sequence / shot identity;
- exact provider request ID and request SHA-256;
- exact production sequence-job SHA-256;
- C1.8 quarantine ID and provider receipt hash;
- exact artifact SHA-256, media type, byte size and quarantine path;
- human acceptance decision ID and authority;
- a metadata continuity version;
- the shot prompt digest and duration contract.

Candidate entries always preserve:

- `pictureLockEligible:false`
- `canonEligible:false`
- `ledgerPromotionEligible:false`
- `publicRelease:false`
- `relayDependency:false`

The registry is itself immutable-by-version: each revision is self-hashed and points to `previousRegistryHash`. Multiple candidates may exist for a shot, but the same artifact hash may not be registered twice.

## Picture Plan Candidate

A Picture Plan Candidate may be assembled only when:

1. exactly one candidate is selected for every governed shot;
2. every selected candidate exists in the exact registry revision/hash;
3. every selected artifact SHA-256 is distinct;
4. every candidate still matches the current provider-request digest;
5. every candidate still matches the current production sequence-job digest;
6. all selected candidates share one metadata continuity version.

For PN-0001 Sequence 01 this means exactly three ordered shot selections totaling 20 seconds.

The resulting plan is self-hashed and remains `PICTURE_PLAN_CANDIDATE`.

## Continuity model

C1.9 separates two forms of continuity:

### Machine-verifiable continuity/version integrity

The bridge can prove that:

- the same declared continuity version is used across the plan;
- request payloads have not drifted;
- the production job has not drifted;
- candidate hashes and artifact hashes still match the registry;
- shot order and duration still match the frozen contract.

### Perceptual / editorial continuity

Whether the images actually look coherent is not inferred from metadata. That remains a real human review.

A C1.9 human review may record only:

- `APPROVE_FOR_LOCK_CEREMONY`
- `REVISE`
- `HOLD`

Even approval means only that the exact plan hash is eligible to enter a **separate future Picture Lock ceremony**. C1.9 itself always keeps `pictureLocked:false`.

## Canonical current state

The canonical PN-0001 Sequence 01 registry remains empty because no real provider attempt has occurred and no C1.8 asset has been human accepted.

Therefore:

- accepted candidates: 0
- Picture Plan candidates: 0
- human-reviewed plans: 0
- Picture Lock ceremony eligible plans: 0
- Picture Locked plans: 0
- Canon eligible: 0
- public release: false

## Utilities

Inspect the canonical registry:

```bash
node scripts/cineswarm-candidate-registry-status.mjs
```

Register an already-human-accepted C1.8 artifact:

```bash
node scripts/cineswarm-register-candidate-asset.mjs \
  <registry.json> <policy.json> <quarantine-manifest.json> <human-review.json> \
  <provider-request.json> <sequence-jobs.json> <continuity-version> [output-registry.json]
```

Build a Picture Plan Candidate from a selection list:

```bash
node scripts/cineswarm-build-picture-plan.mjs \
  <policy.json> <registry.json> <sequence-jobs.json> <requests.json> <selections.json> [output-plan.json]
```

Inspect a plan and optional human review:

```bash
node scripts/cineswarm-picture-plan-status.mjs <picture-plan.json> [human-review.json]
```
