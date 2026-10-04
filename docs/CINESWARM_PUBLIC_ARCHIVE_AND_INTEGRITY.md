# CineSwarm C1.17 — Public Archive, Correction Notice, and Integrity Revalidation

Status: additive post-release preservation layer. C1.17 does not grant release, republish, Canon, Ledger, or Relay authority.

## Purpose

C1.15 proves that an exact release reached Parallax Network. C1.16 preserves signed withdrawal, correction, and supersession history. C1.17 makes that history durable and audience-legible without rewriting earlier receipts.

The archive answers three separate questions:

1. **What was historically public?** — immutable Public Archive Record.
2. **What is its current lifecycle state?** — ACTIVE, WITHDRAWN, or SUPERSEDED, derived from valid C1.15/C1.16 registers.
3. **Do the archived bytes and receipts still match their historical hashes?** — Integrity Revalidation Report.

## Public Archive Record

A C1.17 Archive Record is built only from a cryptographically/structurally valid C1.15 Public Release Receipt and valid C1.15/C1.16 source registers. It freezes:

- exact Public Release Receipt hash;
- exact Release Candidate Package hash;
- release-receipt evidence root;
- original public route hash/path;
- exact published Master SHA-256;
- historical source entry hash;
- withdrawal/supersession links when present;
- source C1.15 Public Release Register hash;
- source C1.16 Release Lifecycle Register hash;
- governed `/archive/` path.

`publicReleaseWasTrue:true` is historical evidence. The Archive Record itself always carries `publicRelease:false` and `archiveCanAuthorizeRelease:false`.

## Correction / tombstone notice

A public correction notice may exist only for a WITHDRAWN or SUPERSEDED Archive Record. It is bound to the exact Archive Record and exact C1.16 withdrawal/supersession receipt hashes. It preserves the old receipt and may point to a replacement receipt when one exists.

The notice is informational. It cannot authorize re-release, delete history, or substitute for C1.15.

## Integrity revalidation

C1.17 revalidates six governed evidence observations for each Archive Record:

1. Public Release Receipt hash;
2. release-receipt evidence-root hash;
3. exact published Master output hash;
4. source C1.15 Public Release Register hash;
5. source C1.16 Release Lifecycle Register hash;
6. C1.17 Public Archive Record hash.

Possible results:

- **PASS** — all six are available and match.
- **DEGRADED** — one or more governed evidence items are unavailable, but no observed mismatch exists.
- **FAIL** — at least one available item hashes differently from the historical expectation.

A missing item is never silently treated as a match. A mismatch is never downgraded to missing.

The canonical C1.17 policy uses a 90-day maximum revalidation age. This is an internal Parallax operational freshness rule, not an external archival or preservation standard.

## Append-only Public Archive Register

The C1.17 register supports three event types:

- `ARCHIVED_PUBLIC_RELEASE`
- `CORRECTION_NOTICE`
- `INTEGRITY_REVALIDATED`

Every entry is SHA-256 self-hashed and chained to the previous entry. The register itself is also self-hashed and bound to the exact C1.15 and C1.16 source-register hashes.

No archive event can set `publicRelease:true`.

## Operational commands

Canonical status:

```bash
node scripts/cineswarm-public-archive-status.mjs
```

Create an Archive Record from a validated context bundle:

```bash
node scripts/cineswarm-create-public-archive-record.mjs \
  context.json \
  /archive/pn-0001/welcome-to-parallax-network/v1 \
  archive-record.json \
  2026-08-13T20:20:00.000Z
```

Create a correction notice:

```bash
node scripts/cineswarm-create-public-correction-notice.mjs \
  fixtures/cineswarm/pn-0001-c1-17-public-archive-policy.json \
  archive-record.json \
  /archive/pn-0001/notices/welcome-v1 \
  "This historical version was withdrawn for correction. Its original release receipt remains preserved." \
  correction-notice.json
```

Run integrity revalidation:

```bash
node scripts/cineswarm-revalidate-public-archive.mjs \
  fixtures/cineswarm/pn-0001-c1-17-public-archive-policy.json \
  archive-record.json \
  observations.json \
  parallax-archive-verifier \
  revalidation-report.json
```

Register archive events:

```bash
node scripts/cineswarm-public-archive-register.mjs ...
```

## Authority boundary

C1.17 may preserve, describe, and revalidate history. It may not:

- republish withdrawn content;
- authorize Network release;
- alter a C1.15 Public Release Receipt;
- alter C1.16 withdrawal/supersession history;
- delete historical releases;
- promote Canon or Ledger state;
- make Parallax Relay a dependency.
