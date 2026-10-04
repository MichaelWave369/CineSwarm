# CineSwarm C1.13 — Canon Promotion + Ledger Admission Packet

Status: additive governance layer after C1.12 Master Candidate acceptance. C1.13 can promote one exact registered Master Candidate into Canon and assemble a complete Ledger Admission evidence packet. It does **not** admit evidence into Parallax Ledger and does **not** authorize Parallax Network publication.

## Production law

```text
C1.12 registered Master Candidate
        ↓
independent human Canon Review
        ↓
dedicated Ed25519 Canon Promotion signature
        ↓
immutable Canon Record
        ↓
append-only Canon Register
        ↓
14-link Ledger Admission evidence inventory
        ↓
Ledger Admission Packet
        ↓
Ledger human/admission decision still required
        ↓
Network release ceremony still required
```

## Independent Canon Review

Canon review is intentionally a separate human record from C1.12 Master Review and Master Acceptance. Approval requires all three explicit acknowledgements:

- the exact Master Candidate lineage is approved;
- provenance is complete enough for Canon promotion;
- the reviewer understands that Canon promotion is **not** Ledger admission or public release.

The review is self-hashed and binds the exact Master Candidate hash, exact output MP4 SHA-256, and exact C1.12 Master Candidate Register hash/revision.

## Canon Promotion Ceremony

A Canon Promotion uses the dedicated signature domain:

`PARALLAX-CINESWARM-C1.13-CANON-PROMOTION`

It binds the exact:

- Master Candidate hash;
- output MP4 hash;
- measured QC hash;
- Locked Picture Manifest hash;
- Locked Audio Manifest hash;
- C1.12 Master Review hash;
- C1.12 Master Acceptance Ceremony hash;
- Master Candidate Register hash/revision;
- C1.13 Canon Review hash.

A successful signature authorizes only `PROMOTE_EXACT_MASTER_CANDIDATE_TO_CANON`.

It explicitly carries:

- `ledgerAdmissionAuthorized: false`
- `networkReleaseAuthorized: false`
- `publicRelease: false`
- `relayDependency: false`

## Canon Record + register

The immutable Canon Record sets `canonPromoted:true`, but still sets:

- `ledgerAdmitted:false`
- `networkReleaseEligible:false`
- `publicRelease:false`

The Canon Register is append-only and hash-chained. C1.13 refuses a second Canon record while one exists rather than silently replacing Canon. A later replacement requires an explicit signed supersession design/ceremony.

## Ledger Admission Packet

The Ledger Admission Packet contains a deterministic 14-item evidence inventory:

1. exact output asset SHA-256
2. measured render QC hash
3. Render Contract hash
4. Locked Picture Manifest hash
5. Audio Conform hash
6. Locked Audio Manifest hash
7. C1.12 Master Review hash
8. C1.12 Master Acceptance Ceremony hash
9. Master Candidate hash
10. Master Candidate Register hash
11. C1.13 Canon Review hash
12. Canon Promotion Ceremony hash
13. Canon Record hash
14. Canon Register hash

The ordered inventory receives its own SHA-256 evidence root, and the full Ledger Admission Packet is independently self-hashed.

A valid packet can state:

- `ledgerAdmissionEligible:true`

but must still state:

- `ledgerAdmitted:false`
- `networkReleaseEligible:false`
- `publicRelease:false`

## CLI

Create the independent human Canon Review:

```bash
node scripts/cineswarm-create-canon-review.mjs \
  canon-policy.json master-policy.json master-candidate.json master-register.json \
  michael-hughes 2026-08-13T19:30:00Z canon-review.json \
  "Human review notes"
```

Sign Canon promotion with an **external** private key and append its Canon Record:

```bash
node scripts/cineswarm-create-canon-promotion.mjs \
  canon-policy.json master-policy.json master-candidate.json master-register.json \
  canon-review.json key-registry.json /external/path/human-private-key.pem \
  canon-register.json michael-hughes key-id 2026-08-13T19:31:00Z out/
```

The script reads the private key but never writes it into output.

Build the Ledger Admission Packet:

```bash
node scripts/cineswarm-create-ledger-admission-packet.mjs \
  canon-policy.json master-policy.json master-candidate.json master-register.json \
  canon-review.json canon-promotion-ceremony.json canon-record.json canon-register.json \
  key-registry.json ledger-packet-register.json 2026-08-13T19:32:00Z out/
```

Inspect canonical readiness:

```bash
node scripts/cineswarm-canon-ledger-status.mjs
```

## Current canonical state

The PN-0001 canonical fixtures remain empty:

- Master Candidates: 0
- Canon Reviews: 0
- Canon Promotions: 0
- Canon Records: 0
- Ledger Admission Packets: 0
- Ledger admissions: 0
- Network releases: 0

No proof-only synthetic state is promoted into these fixtures.
