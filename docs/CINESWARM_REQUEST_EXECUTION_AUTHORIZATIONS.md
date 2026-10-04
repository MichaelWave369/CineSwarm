# CineSwarm C1.5 — Request-Specific Execution Authorization Records

Status: additive, fail-closed authorization layer for the first bounded provider-backed Cold Open run.

## Why this phase exists

A provider-level founder GO should not become blanket permission to execute every request. C1.5 adds one human decision record per provider request so authority remains narrow, inspectable, and revocable at request granularity.

The gate order is now intentionally one-way:

```text
provider preflight readiness
        ↓
founder GO / NO_GO
        ↓
request authorization 1
request authorization 2
request authorization 3
        ↓
execution eligibility
        ↓
provider output
        ↓
human asset acceptance
```

There is no circular dependency between founder GO and request authorization records.

## Canonical first-run request catalog

`fixtures/cineswarm/pn-0001-seq01-provider-requests.json`

The first Cold Open run binds exactly these request IDs:

1. `pn0001_seq01_shot01_gptimage2_r01`
2. `pn0001_seq01_shot02_gptimage2_r01`
3. `pn0001_seq01_shot03_gptimage2_r01`

Each request remains capped at `$0.06`. The batch remains capped at `$0.18`. Those are governance ceilings, not price claims.

## Payload-digest binding

Every request authorization contains `requestDigest`, a SHA-256 over a deterministic canonical JSON representation of the exact provider request.

If any bound request field changes after the draft was created—including prompt, model snapshot, terms-review ID, transfer scope, or spend ceiling—the authorization no longer validates against the request.

## Draft semantics

`fixtures/cineswarm/pn-0001-seq01-request-authorization-drafts.json` contains three `PENDING` records.

A pending record:

- grants no live generation authority;
- grants no spend authority;
- claims no human authority;
- has no decision timestamp;
- preserves `publicRelease=false`;
- preserves human asset acceptance as a later gate.

The draft generator cannot create an authorized record.

## Human decisions

A request may eventually be set to:

- `AUTHORIZE`
- `DENY`

An `AUTHORIZE` record is valid only when:

- provider preflight is ready for founder decision;
- a valid real-human founder `GO` exists;
- the request digest still matches the exact request payload;
- the authorizer is a real, non-simulated human;
- live generation and spend are both explicitly true for this exact request;
- the request spend cap does not exceed the request ceiling.

A `DENY` record cannot grant generation or spend.

## Batch execution eligibility

All three request records must independently validate as `AUTHORIZE`, and the total authorization envelope must stay at or below the `$0.18` batch ceiling.

Execution eligibility still does **not** grant:

- automatic generated-asset acceptance;
- picture lock;
- Ledger promotion;
- public Network release;
- Parallax Relay authority or dependency.

## CLI

Create the canonical pending drafts:

```bash
node scripts/cineswarm-create-request-authorization-drafts.mjs \
  fixtures/cineswarm/pn-0001-seq01-provider-readiness-packet.json \
  fixtures/cineswarm/pn-0001-seq01-provider-requests.json \
  fixtures/cineswarm/pn-0001-seq01-request-authorization-drafts.json
```

Inspect the current authorization state:

```bash
node scripts/cineswarm-request-authorization-status.mjs \
  fixtures/cineswarm/pn-0001-seq01-provider-readiness-packet.json \
  fixtures/cineswarm/pn-0001-seq01-provider-requests.json \
  fixtures/cineswarm/pn-0001-seq01-request-authorization-drafts.json \
  fixtures/cineswarm/pn-0001-seq01-provider-go-no-go-draft.json
```

The current canonical state is expected to be non-executable.
