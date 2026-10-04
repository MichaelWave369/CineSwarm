# CineSwarm C1.16 — Public Release Withdrawal, Correction, and Supersession

Status: additive post-release governance layer above the immutable C1.15 Public Release Register.

## Purpose

C1.16 governs what happens after a release has reached the audience. It never edits C1.15 history. Instead it creates a second append-only lifecycle register that can prove:

1. what was originally published;
2. why and when it was withdrawn;
3. that the old output stopped being served;
4. that the historical receipt and withdrawal notice remained reachable;
5. what correction was approved;
6. what replacement release actually reached the Network;
7. which signed supersession linked the old and new releases.

## State machine

```text
C1.15 PUBLIC_RELEASED
        ↓
independent Withdrawal Review
        ↓
signed WITHDRAWAL ceremony
        ↓
withdrawal confirmation
        ↓
WITHDRAWAL RECEIPT
        ↓
NO_ACTIVE_RELEASE_HISTORY_PRESERVED
        ↓
Correction Review
        ↓
new C1.15 release ceremony + Public Release Receipt
        ↓
signed SUPERSESSION ceremony
        ↓
SUPERSESSION RECEIPT
        ↓
replacement active / old history preserved
```

## Historical law

The C1.15 Public Release Register remains immutable. C1.16 binds its exact register hash and revision as historical baseline. A withdrawal never changes an old `publicRelease:true` receipt into false; it records that the receipt is historically true while the release is no longer currently served.

## Withdrawal requirements

An approved withdrawal requires:

- a C1.15 Public Release Receipt already present in the C1.15 register;
- real human review;
- history preservation acknowledgement;
- prepared withdrawal/correction notice;
- approved route withdrawal;
- an Ed25519 withdrawal signature in the dedicated C1.16 signature domain;
- confirmation that the withdrawn output is no longer served;
- a reachable withdrawal notice;
- a reachable historical release receipt.

## Correction types

C1.16 distinguishes:

- `CONTENT_OR_MASTER` — requires a different Master output SHA-256;
- `METADATA_OR_ROUTE` — may intentionally retain identical Master bytes;
- `PROVENANCE_OR_RECEIPT` — may retain media while correcting evidence/receipt presentation.

A Correction Review never publishes anything. It only declares a replacement Release Candidate eligible to pass through a fresh C1.15 release ceremony.

## Same-route replacement

The same public `/watch/...` route may be reused only after the old release has a valid C1.16 Withdrawal Receipt. The replacement receives its own new C1.15 Public Release Receipt and is then linked to the old release with a signed C1.16 Supersession Ceremony and Supersession Receipt.

## Canonical status

```bash
node scripts/cineswarm-release-lifecycle-status.mjs
```

The canonical PN-0001 state remains empty: there is no real Public Release Receipt, withdrawal, correction, supersession, or current public release.

## Boundaries

C1.16 does not:

- delete or rewrite C1.15 history;
- automatically withdraw content;
- automatically approve a correction;
- automatically supersede a release;
- create a replacement Master;
- bypass C1.14 Ledger admission;
- bypass a fresh C1.15 public release ceremony;
- require or modify Parallax Relay.
