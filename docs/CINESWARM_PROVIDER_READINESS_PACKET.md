# CineSwarm Provider Readiness Packet + Founder Go/No-Go Instrument v0.1

Status: additive governance layer after the Candidate C0 integration boundary. This phase does not grant live generation, spend, or public release authority.

## Purpose

Turn the remaining first-provider-run blockers into a concrete, inspectable packet that can be reviewed by a real human before any OpenAI-backed Cold Open image generation is attempted.

The packet is intentionally fail-closed:

- if readiness checks remain unresolved, the packet must list blockers;
- if blockers remain, a `GO` decision is invalid;
- a `NO_GO` or `DEFER` decision cannot accidentally authorize live generation or spend;
- even a future `GO` applies only to the bounded first three-image run, not to public release.

## Canonical packet

- readiness packet: `fixtures/cineswarm/pn-0001-seq01-provider-readiness-packet.json`
- founder decision draft: `fixtures/cineswarm/pn-0001-seq01-provider-go-no-go-draft.json`

## Current blocked state

The current packet intentionally preserves the red gates:

1. retention / ZDR posture not confirmed;
2. current exact provider pricing not rechecked;
3. external credential not provisioned;
4. founder live-run decision not yet recorded;
5. three request-specific execution authorizations not yet recorded.

Everything else for the first governed three-image run is already represented as ready:

- model snapshot pinned;
- request manifests frozen;
- runner built;
- output path constrained;
- human asset acceptance required;
- founder ceremony layer exists.

## Scripted inspection

```bash
node scripts/cineswarm-provider-go-no-go.mjs \
  fixtures/cineswarm/pn-0001-seq01-provider-readiness-packet.json \
  fixtures/cineswarm/pn-0001-seq01-provider-go-no-go-draft.json
```

The command prints a readiness summary and the effective go/no-go classification.

## Law of this instrument

This layer may:

- validate the provider readiness packet;
- summarize unresolved blockers;
- validate a real human founder go/no-go record;
- reject a `GO` decision while blockers remain;
- preserve the bounded $0.06 request / $0.18 batch ceilings as governance limits.

This layer may not:

- create provider request authorization records on behalf of a human;
- claim current pricing is settled without refreshed evidence;
- claim retention posture is settled without authoritative confirmation;
- inject `OPENAI_API_KEY` into repository storage;
- publish content to the Parallax Network;
- modify or depend on Parallax Relay.

## Intended next steps after this packet

1. verify current provider retention / ZDR posture from authoritative documentation or approved account configuration;
2. recheck the exact current cost posture for the three request batch;
3. provision the external credential in the real governed runtime;
4. record the founder `GO` or `NO_GO` decision;
5. if and only if `GO`, create three request-specific execution authorizations.
