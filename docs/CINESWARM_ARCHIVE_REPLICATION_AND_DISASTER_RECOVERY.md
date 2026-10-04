# CineSwarm C1.18 — Archive Replication, Restore Drill, and Disaster-Recovery Receipt

Status: additive post-archive disaster-recovery layer. C1.18 never grants release, republish, Canon, Ledger, or Relay authority.

## Purpose

C1.17 proves that historical public-release evidence still matches its original hashes. C1.18 answers a different question:

> If the primary archive disappears, can Parallax reconstruct the exact archived bundle — including the published Master — from an independent replica and prove the restored bytes are identical?

Storage redundancy is not allowed to substitute for provenance. A C1.18 Recovery Bundle can be created only after:

1. the exact C1.17 Archive Record is fully revalidated against its original C1.15/C1.16 release context;
2. that Archive Record is present in the supplied C1.17 Archive Register;
3. an exact C1.17 Integrity Revalidation Report is registered;
4. the C1.17 result is `PASS`.

## Internal recovery policy

The canonical first policy requires:

- minimum replicas: **2**;
- minimum distinct failure domains: **2**;
- exact inventory parity across replicas;
- distinct replica location IDs;
- verbatim published-Master storage;
- healthy source-replica verification before restore;
- byte-for-byte restore verification;
- append-only Disaster Recovery Register;
- restore drill freshness: **180 days**.

The 180-day interval is an internal Parallax operational policy, not an external preservation standard.

`locationId` and `failureDomain` are operator-attested facts. Software can reject duplicated labels, but it cannot prove that two labels actually correspond to physically independent storage. A production deployment must make those attestations true.

## Recovery Bundle

A full C1.18 Recovery Bundle contains exactly eight governed objects:

1. Public Release Receipt JSON;
2. release evidence-root record;
3. **verbatim published Master media**;
4. C1.15 Public Release Register JSON;
5. C1.16 Release Lifecycle Register JSON;
6. C1.17 Public Archive Record JSON;
7. C1.17 Integrity Revalidation Report JSON;
8. C1.17 Public Archive Register JSON.

Each object carries both:

- a semantic SHA-256 anchor from the production/archive lineage; and
- a blob SHA-256 + byte size for storage verification.

For the published Master, semantic and blob SHA-256 must be identical. A pointer, transcoded copy, placeholder, or metadata-only representation cannot satisfy full disaster recovery.

## Replica Manifests and Replica Set

Every replica gets a self-hashed Replica Manifest containing the exact Recovery Bundle inventory. The Replica Set requires the configured minimum replica count, unique replica IDs, unique location IDs, and the configured minimum number of distinct failure domains.

Replica-location independence remains operator-attested; Parallax Relay is not required and is not treated as an automatic replica.

## Replica verification

Filesystem or storage observations classify a replica as:

- **HEALTHY** — every object is present and exact;
- **DEGRADED** — one or more objects are missing, with no observed mismatch;
- **FAIL** — at least one available object has the wrong SHA-256 or byte size.

Corruption is never softened into “missing.” A DEGRADED or FAIL replica cannot be used as a governed Restore Drill source.

## Restore Drill

A governed Restore Drill must:

1. revalidate the Recovery Bundle against the original C1.17 provenance context;
2. use a `HEALTHY` replica that belongs to the exact Replica Set;
3. assume the primary archive is unavailable;
4. restore all eight objects;
5. independently re-hash every restored object;
6. verify the exact published Master bytes;
7. produce `PASS` only when every object matches.

A failed or partial copy never becomes a Disaster Recovery Receipt.

## Disaster Recovery Receipt

A Disaster Recovery Receipt exists only after a full `PASS` restore drill and freezes:

- Archive Record hash;
- Recovery Bundle hash;
- Replica Set hash;
- Restore Drill hash;
- source replica ID;
- restored published-Master SHA-256;
- next internal restore-drill due date.

Even a successful receipt always carries:

```text
historicalArchiveMutated = false
autoRepublish            = false
recoveryCanAuthorizeRelease = false
publicRelease             = false
relayDependency           = false
```

Recovery proof is availability evidence, not publication authority.

## Append-only Recovery Register

Successful Disaster Recovery Receipts are written to a SHA-256 hash-chained Archive Recovery Register. The register is bound to the exact C1.17 Public Archive Register hash and refuses duplicate receipts or silent history edits.

## Operational commands

Canonical state:

```bash
node scripts/cineswarm-archive-recovery-status.mjs
```

Verify a replica directory:

```bash
node scripts/cineswarm-verify-archive-replica.mjs \
  policy.json \
  recovery-bundle.json \
  replica-manifest.json \
  /path/to/replica \
  parallax-replica-verifier \
  replica-verification.json
```

Run the full governed restore path once a real complete Recovery Bundle exists:

```bash
node scripts/cineswarm-run-governed-restore-drill.mjs \
  governed-context.json \
  /path/to/healthy-replica \
  /path/to/restore-target \
  /path/to/output-receipts
```

The governed context must contain the exact C1.17 provenance-validation context. The command copies the governed inventory, re-hashes the restored bytes, builds the Restore Drill Report, and issues the Disaster Recovery Receipt only after full validation.

## Current proof limitation

The current workspace no longer contains the actual proof Master media bytes that underlie the historical synthetic C1.13-C1.17 proof lineage. C1.18 therefore correctly reports the provenance-bound filesystem replica as **DEGRADED** with one missing object (`published-master-media`) and does **not** issue a governed Disaster Recovery Receipt for that lineage.

A separate storage-engine-only drill used fresh synthetic bytes to exercise real filesystem corruption detection and restore copying. It proved:

- replica A: `HEALTHY`;
- deliberately corrupted replica B: `FAIL`;
- restored copy from replica A: `HEALTHY`.

That synthetic storage bundle intentionally lacks valid C1.17 provenance context, so C1.18 rejects it before a governed Restore Drill/Receipt can be created. This is expected and demonstrates that storage mechanics cannot launder synthetic evidence into archive authority.

## Authority boundary

C1.18 may prove storage redundancy and recoverability. It may not:

- republish recovered media;
- mutate C1.15-C1.17 historical records;
- treat a recovered copy as a new Master or Canon object;
- grant Ledger admission;
- delete old history;
- silently treat Parallax Relay as a mandatory replica or recovery dependency.
