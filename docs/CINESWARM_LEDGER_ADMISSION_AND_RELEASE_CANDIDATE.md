# CineSwarm C1.14 — Ledger Admission Ceremony + Release Candidate Package

Status: governed pre-release layer. C1.14 may admit a fully verified C1.13 Canon evidence packet into Parallax Ledger and assemble a Release Candidate Package. It cannot publish to Parallax Network.

## Authority chain

```text
C1.13 Ledger Admission Packet
        ↓
C1.14 independent Ledger Verification Report
        ↓
real human Ed25519 Ledger Admission Ceremony
        ↓
immutable Ledger Admission Receipt
        ↓
append-only Ledger Admission Register
        ↓
Release Candidate Package
        ↓
append-only Release Candidate Register
        ↓
C1.15 Network Release Ceremony required
```

## Independent verification vs. admission

C1.14 deliberately separates machine-verifiable evidence from human authority.

The Ledger Verification Report rebuilds and validates the exact C1.13 packet, verifies that it is present in the append-only C1.13 packet register, and binds the exact evidence root, Canon record, Master Candidate, and final media SHA-256. The report still says `ledgerAdmitted:false`.

The later Ledger Admission Ceremony is signed in the dedicated domain `PARALLAX-CINESWARM-C1.14-LEDGER-ADMISSION`. Its private key remains external and human-controlled. Only the signed ceremony can produce a Ledger Admission Receipt with `ledgerAdmitted:true`.

## Release Candidate boundary

A Release Candidate Package may be assembled only from a cryptographically valid Ledger Admission Receipt that is already present in the append-only Ledger Admission Register. Assembly re-verifies the signed admission lineage instead of trusting the register alone.

The package contains a nine-link release inventory binding:

1. exact Master output bytes hash;
2. Master Candidate hash;
3. Canon Record hash;
4. C1.13 Ledger Admission Packet hash;
5. C1.13 evidence-root hash;
6. C1.14 Ledger Verification Report hash;
7. C1.14 Ledger Admission Ceremony hash;
8. C1.14 Ledger Admission Receipt hash;
9. C1.14 Ledger Admission Register hash.

The ordered inventory receives its own deterministic `releaseEvidenceRootHash`.

Even a valid package remains:

- `releaseCeremonyEligible:true`
- `networkReleaseAuthorized:false`
- `networkReleased:false`
- `publicRelease:false`
- `relayDependency:false`

C1.15 must perform the separate human Network Release Ceremony.

## Canonical PN-0001 state

The canonical C1.14 admission and release-candidate registers remain revision 0 until a real C1.13 Ledger Admission Packet exists and a real human Ledger admission decision is signed. Proof-only fixtures and disposable keys do not alter canonical state.
