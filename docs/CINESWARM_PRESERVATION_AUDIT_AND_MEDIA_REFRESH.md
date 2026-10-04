# CineSwarm C1.20 — Preservation Audit Scheduler + Media Refresh / Migration Ceremony

Status: additive post-archive preservation layer. C1.20 does not grant release, republish, deletion, or Relay authority.

## Purpose

C1.19 can place, verify, repair, and migrate archive replicas. C1.20 adds the long-horizon operator discipline around those mechanics:

1. bind every governed placement to an explicit physical/logical media identity;
2. schedule recurring integrity audits;
3. record an operator-defined media refresh date without pretending a universal device lifespan exists;
4. require human review and a dedicated Ed25519 refresh authorization before migration;
5. keep the old and replacement media governed simultaneously during the transition;
6. require a healthy post-write C1.19 migration receipt;
7. require a separate signed retirement ceremony before the old placement may be marked retired;
8. preserve the old bytes unless some future, separately governed destruction policy explicitly authorizes deletion.

## Internal policy

The initial Parallax C1.20 policy uses:

- maximum audit age: 30 days;
- refresh-warning lead time: 90 days;
- signed refresh authorization lifetime: 24 hours.

These are internal Parallax operational choices, not vendor lifespan claims or archival-industry standards. Each physical medium receives an operator-defined `refreshDueAt` date based on the actual device, storage service, warranty/risk posture, and operating context.

## Refresh state machine

```text
C1.19 governed placement
        ↓
C1.20 audit schedule
        ↓
zero-change C1.19 VERIFY_SYNC
        ↓
Preservation Audit Receipt
        ↓
Human Media Refresh Review
        ↓
Signed Media Refresh Ceremony
        ↓
C1.19 migration while source + destination are both governed
        ↓
healthy destination verification
        ↓
Media Refresh Receipt
        ↓
post-refresh placement plan still satisfies redundancy
        ↓
separate signed Media Retirement Ceremony
        ↓
Media Retirement Receipt
```

The refresh signature uses the dedicated domain `PARALLAX-CINESWARM-C1.20-MEDIA-REFRESH`. Retirement uses a separate `PARALLAX-CINESWARM-C1.20-MEDIA-RETIREMENT` domain.

## Deletion boundary

A successful refresh never means deletion. The refresh and retirement receipts both preserve:

- `sourceDeletionAuthorized:false`
- `sourceBytesDeleted:false`
- `publicRelease:false`
- `relayDependency:false`

C1.20 performs logical media retirement only. Secure destruction, if ever desired, requires a later explicitly governed policy and evidence path.

## Canonical PN-0001 state

PN-0001 has no real public archive replicas, so the canonical C1.20 Preservation Register remains revision 0 with zero audit, refresh, or retirement events. This is intentional evidence, not unfinished-state laundering.

Use:

```bash
node scripts/cineswarm-preservation-audit-status.mjs
```
