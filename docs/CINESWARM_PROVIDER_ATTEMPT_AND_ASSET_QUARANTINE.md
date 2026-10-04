# CineSwarm C1.8 — Provider Attempt Receipt + Asset Intake Quarantine

Status: additive receiving-side governance layer. C1.8 does not perform a provider call and does not create a human asset decision.

## Purpose

Close the trust gap between "a provider call was authorized" and "a generated artifact is allowed into CineSwarm production." A provider response is evidence, not an accepted asset.

## Receiving chain

```text
C1.7 CLAIMED execution
  -> provider attempt
  -> self-hashed Provider Attempt Receipt
  -> C1.7 terminal journal event with exact receipt hash
  -> byte-for-byte artifact verification
  -> provider quarantine
  -> human ACCEPT / REJECT / HOLD
  -> ACCEPT can enter candidate pool only
  -> separate Picture Lock / Canon / Ledger / release gates
```

## Provider Attempt Receipt

A C1.8 attempt receipt records:

- execution / envelope identity
- exact request digest
- provider + exact model
- provider job ID when supplied
- start / completion timestamps
- HTTP status and bounded cost when supplied
- artifact SHA-256, byte size, media type and image dimensions for successful image attempts
- explicit `responseBodyStored:false`
- explicit `secretsStored:false`
- explicit `publicRelease:false`
- explicit `relayDependency:false`

The receipt carries a SHA-256 self-hash over its canonical content. Any metadata mutation invalidates the receipt.

## Journal binding

An artifact cannot enter quarantine merely because a receipt says `SUCCEEDED`. The C1.7 execution journal must contain a matching terminal `SUCCEEDED` event whose `providerReceiptHash` equals the exact C1.8 receipt hash.

This creates a one-way evidence chain from authorization and execution claim into provider outcome.

## Quarantine

Quarantined media must:

- stay under `production/provider-quarantine/<sequenceId>/`
- match the attempt receipt SHA-256 and byte count
- pass media-signature/header inspection
- remain `PENDING_HUMAN_REVIEW`
- remain `candidatePoolEligible:false` until real human review
- never auto-accept

The first-run policy accepts PNG/JPEG/WebP and caps a single artifact at 50 MiB.

## Human review law

A real, non-simulated human may record `ACCEPT`, `REJECT`, or `HOLD` against the exact quarantine ID and artifact hash.

`ACCEPT` means only:

> eligible for the governed candidate pool.

It does **not** grant Picture Lock, Canon, Ledger promotion, or public release.

## Current canonical state

The canonical C1.8 quarantine register is empty. No provider attempt, provider receipt, or generated artifact is claimed to exist yet.

## Relay boundary

Parallax Relay remains independent and unchanged.
