# CineSwarm C1.15 — Parallax Network Release Ceremony + Public Release Receipt

Status: final governed publication gate after C1.14 Release Candidate assembly. This layer is additive and does not modify the frozen C0 baseline or make Parallax Relay a dependency.

## Purpose

C1.15 separates the final public transition into three different truths:

1. **Human release review** — the exact C1.14 Release Candidate Package, public route, rights posture, trust-disclosure surface, and withdrawal responsibility are reviewed by a real human.
2. **Human release authorization** — an Ed25519 signature authorizes publication of one exact package to one exact route.
3. **Publication confirmation** — a publisher/verifier confirms that the authorized package actually became reachable at that route with the public provenance receipt exposed.

Only after all three succeed may CineSwarm create a **Public Release Receipt** that sets `publicRelease:true`.

## Final authority chain

```text
C1.14 Release Candidate Package
        ↓
C1.15 Network Release Review
        ↓
Signed Network Release Ceremony
        ↓
Publication attempt outside the bridge
        ↓
Publication Confirmation
        ↓
Public Release Receipt
        ↓
Append-only Public Release Register
```

Review does not authorize release. Authorization does not claim success. Publication confirmation is not itself the immutable release receipt.

## Dedicated signature domain

Network release signatures use the Ed25519 domain:

```text
PARALLAX-CINESWARM-C1.15-NETWORK-RELEASE
```

The signature binds the exact:

- C1.14 Release Candidate Package hash;
- C1.14 release evidence root;
- Ledger Admission Receipt hash;
- Canon Record hash;
- Master Candidate hash;
- published Master SHA-256;
- approved Network route hash;
- independent C1.15 release review hash;
- release authority identity, signing key, and timestamp.

The private key remains external and human-controlled.

## Public route contract

The first policy is scoped to `parallax-network` and requires routes under `/watch/`.

A route includes:

- `networkId`
- `publicPath`
- `contentSlug`
- `channelSlug`
- `visibility: public`

Traversal, query-string, fragment, and route/slug drift fail closed.

## Publication confirmation

A Public Release Receipt cannot be issued from a signed ceremony alone. Publication evidence must independently establish:

- a successful 2xx public response;
- public reachability;
- the public content/provenance receipt surface;
- the Ledger Admission receipt surface;
- exact package/output/route lineage;
- a publisher evidence SHA-256;
- chronology after the signed release authorization.

The confirmation is self-hashed and bound to the exact ceremony.

## Public Release Receipt

The Public Release Receipt is the first C1 object permitted to assert:

```text
ledgerAdmitted          = true
canonPromoted           = true
networkReleaseAuthorized= true
networkReleased         = true
publicRelease           = true
```

It carries a six-item final evidence inventory:

1. C1.14 Release Candidate Package
2. C1.14 release evidence root
3. C1.15 Network Release Review
4. C1.15 signed Network Release Ceremony
5. C1.15 Publication Confirmation
6. exact published Master output SHA-256

The inventory receives a deterministic release-receipt evidence root and the receipt itself is self-hashed.

## Append-only public release register

Public releases are registered once by Release Candidate Package and public route. Duplicate publication registration is rejected. Register entries are SHA-256 hash-chained.

C1.15 intentionally requires an explicit future withdrawal/unpublish ceremony rather than allowing silent deletion or mutation. A public receipt therefore records:

```text
withdrawalRequiredForUnpublish = true
```

## Canonical PN-0001 state

The canonical C1.15 Public Release Register remains revision 0 because no real PN-0001 Release Candidate Package exists and no real public release has occurred.

Proof-only synthetic releases used by tests or validation must never be promoted into canonical state.

## Operational commands

### 1. Create human release review

```bash
node scripts/cineswarm-create-network-release-review.mjs \
  fixtures/cineswarm/pn-0001-c1-15-network-release-policy.json \
  fixtures/cineswarm/pn-0001-c1-14-ledger-release-policy.json \
  /path/to/release-context \
  /path/to/combined-key-registry.json \
  /path/to/route.json \
  michael-hughes \
  2026-08-13T20:00:00.000Z \
  /path/to/network-release-review.json
```

### 2. Sign one exact release authorization

```bash
node scripts/cineswarm-authorize-network-release.mjs \
  fixtures/cineswarm/pn-0001-c1-15-network-release-policy.json \
  fixtures/cineswarm/pn-0001-c1-14-ledger-release-policy.json \
  /path/to/release-context \
  /path/to/combined-key-registry.json \
  /path/to/network-release-review.json \
  /external/path/human-private-key.pem \
  michael-hughes \
  2026-08-13T20:01:00.000Z \
  /path/to/network-release-ceremony.json
```

### 3. Confirm publication and issue receipt

The publication evidence file must come from the real publishing/verifier path. The bridge does not fabricate it.

```bash
node scripts/cineswarm-confirm-publication.mjs \
  fixtures/cineswarm/pn-0001-c1-15-network-release-policy.json \
  fixtures/cineswarm/pn-0001-c1-14-ledger-release-policy.json \
  /path/to/release-context \
  /path/to/combined-key-registry.json \
  /path/to/network-release-review.json \
  /path/to/network-release-ceremony.json \
  /path/to/publication-evidence.json \
  fixtures/cineswarm/pn-0001-c1-15-public-release-register.json \
  2026-08-13T20:03:00.000Z \
  /path/to/public-release-output
```

## Boundaries preserved

C1.15 does not:

- auto-publish a Release Candidate;
- infer publication from a human signature;
- issue a Public Release Receipt without publisher confirmation;
- silently overwrite an existing route release;
- silently unpublish a released object;
- store a human private key;
- make Parallax Relay part of the release path.
