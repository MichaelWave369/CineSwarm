# CineSwarm C1.19 — Replica Placement + Sync/Repair Journal + Cold-Storage Adapter Contracts

Status: governed preservation-maintenance layer above C1.18. C1.19 never authorizes publication and does not make Parallax Relay a dependency.

## Purpose

C1.18 defined what a provenance-bound archive replica and disaster-recovery proof mean. C1.19 adds the long-running maintenance machinery needed to keep those replicas healthy over time:

1. storage-adapter contracts;
2. governed replica placement;
3. periodic sync verification;
4. corruption/incompleteness repair from a healthy peer;
5. storage migration without changing historical identity;
6. append-only maintenance history.

## Internal Parallax policy

The first C1.19 policy freezes these internal operational values:

- minimum managed replicas: **3**;
- minimum distinct failure domains: **3**;
- at least one cold-storage or offline replica;
- maximum sync-verification age: **30 days**;
- maximum open repair window: **24 hours**;
- SHA-256 verification after every write;
- no automatic source deletion after migration.

These are **Parallax internal policy choices**, not claims that an external preservation standard requires those exact numbers.

## Storage Adapter Contract

A C1.19 Storage Adapter Contract describes how a storage location is expected to behave. Supported contract kinds are:

- `filesystem`
- `object-store`
- `cold-storage`
- `removable-media`

Every adapter contract must expose read, write, inventory, and SHA-256 verification capability and must forbid deletion without separate human approval.

The contract stores **no credentials**.

A contract may be marked:

- `CONTRACT_ONLY`
- `LOCAL_PROOF_IMPLEMENTATION`
- `OPERATOR_CONFIGURED`

`CONTRACT_ONLY` means exactly that: software understands the interface, but no real bucket, disk, vault, tape, or removable device is being claimed.

### Physical independence

C1.19 can enforce distinct `locationId` and `failureDomain` labels. It cannot prove that two labels represent genuinely independent physical infrastructure.

Therefore every adapter records:

`physicalIndependenceIsOperatorAttestedNotMachineProven: true`

Real deployment must make that attestation truthful. Two folders on the same disk are not two independent failure domains merely because their labels differ.

## Replica Placement Plan

A Placement Plan binds:

- one exact C1.18 Recovery Bundle;
- one exact C1.18 Replica Set;
- one exact adapter-registry snapshot;
- each replica manifest to exactly one adapter contract.

The current policy requires three governed placements across three failure domains and at least one cold/offline placement.

The placement validator rejects:

- unknown replicas;
- unknown adapters;
- adapter reuse for multiple replicas;
- replica reuse;
- adapter/replica location mismatch;
- adapter/replica failure-domain mismatch;
- missing cold/offline replica;
- insufficient failure-domain diversity.

## Sync Verification

C1.19 defines four sync modes:

- `INITIAL_SYNC`
- `VERIFY_SYNC`
- `REPAIR_SYNC`
- `MIGRATION_SYNC`

A governed Sync Receipt requires a healthy source and a healthy destination after the write. `VERIFY_SYNC` cannot claim changed objects. All receipts bind the exact Recovery Bundle and Placement Plan.

The receipt computes `nextSyncDueAt` from the internal 30-day freshness policy.

No sync receipt can authorize release.

## Repair

A Replica Repair Receipt requires:

1. healthy source replica;
2. target verification showing `DEGRADED` or `FAIL`;
3. explicit list of damaged/missing object kinds;
4. post-repair verification showing `HEALTHY`;
5. completion inside the internal 24-hour repair window.

The repair cannot claim an object that was already healthy.

Repair never mutates historical content identity. It restores the bytes already named by the C1.18 bundle.

## Migration

Migration supports moving a governed replica between storage media/classes while retaining the same historical identity.

A Migration Receipt binds:

- original archive-record hash;
- original historical Master SHA-256;
- healthy source replica;
- healthy destination replica;
- exact source adapter pairing;
- exact destination adapter pairing.

The destination must be in a different failure domain.

Even when source retirement is separately authorized:

`sourceAutoDeleted: false`

C1.19 never silently destroys the old copy.

## Append-only maintenance journal

The C1.19 Replica Maintenance Register supports:

- `SYNC_VERIFIED`
- `REPAIR_COMPLETED`
- `MIGRATION_COMPLETED`

Every event is SHA-256 self-hashed and chained through `previousEntryHash`.

Maintenance history cannot grant:

- Canon authority;
- Ledger authority;
- release authority;
- public publication authority;
- Relay authority.

## Local filesystem adapter runner

C1.19 includes a storage-mechanics runner:

```bash
node scripts/cineswarm-filesystem-replica-sync.mjs \
  <verify|sync|repair> \
  /source/replica \
  /target/replica \
  recovery-bundle-or-inventory.json
```

This command copies only inventory-listed relative paths, checks SHA-256 + byte size, rejects traversal, performs no deletes, and reports `HEALTHY`, `DEGRADED`, or `FAIL`.

It deliberately labels itself:

`STORAGE_MECHANICS_ONLY_NOT_A_GOVERNED_MAINTENANCE_RECEIPT`

A successful copy command is not sufficient to create a C1.19 governance receipt. The C1.18 provenance context and C1.19 placement/verification contracts must also validate.

## Canonical PN-0001 state

The canonical C1.19 state remains empty because PN-0001 has never been publicly released or archived:

- real configured storage adapters: 0
- real managed archive replicas: 0
- sync receipts: 0
- repair receipts: 0
- migration receipts: 0
- public release: false
- Relay dependency: false

The prior C1.18 operational proof also established a real blocker for the old synthetic proof lineage: the expected historical Master hash remains known, but those old proof media bytes are no longer retained in the current workspace. C1.19 does not invent those bytes or issue a real placement/maintenance receipt for them.
