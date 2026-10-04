# CineSwarm C1.6 — Signed Human Authorizations + Receipt Sealing

Status: local additive candidate. This layer does not create a real human signature, make a provider call, spend money, accept generated assets, or grant public release.

## Purpose

C1.5 proved that each provider request can require an exact request-specific human authorization. C1.6 adds cryptographic custody and freshness around those decisions:

1. founder GO receipt can be sealed;
2. each request `AUTHORIZE` receipt can be sealed;
3. seals bind the exact canonical payload digest;
4. seals have short validity windows and can be revoked;
5. the final runner-facing execution envelope is short-lived and single-use by contract;
6. the envelope verifier reconstructs all digests and verifies every human receipt immediately before a live provider call is allowed.

## Signing algorithm

C1.6 uses **Ed25519**.

Private signing material is explicitly out of repository scope. The canonical key registry contains only public keys. The signer CLI rejects a private-key path inside the repository tree.

Current canonical state deliberately has **no real signing public key registered yet**.

## Time law

- maximum human receipt-seal TTL: **24 hours**
- maximum runner execution-envelope TTL: **10 minutes**
- execution envelopes must be `singleUse: true`
- an execution envelope may not outlive any receipt seal it depends on
- request authorization seals may not outlive the request authorization's own `expiresAt`

## Revocation

`fixtures/cineswarm/pn-0001-c1-6-revocations.json` is the append-oriented revocation registry for receipt seals.

A revoked seal fails verification even if its signature is otherwise valid.

Signing keys also carry status: `active`, `retired`, or `revoked`. Only an `active` key may verify an executable receipt.

## Final execution envelope

A valid execution envelope requires all of the following at the same time:

- provider preflight ready;
- founder GO valid;
- all three exact request authorizations are `AUTHORIZE`;
- founder GO receipt seal verifies;
- all three authorization receipt seals verify;
- no seal is expired or revoked;
- signing key is active and in its validity window;
- request payload digests still match;
- packet/founder/batch digests still match;
- execution envelope itself is unexpired and no longer than ten minutes;
- `publicRelease=false`;
- `relayDependency=false`;
- generated assets still require human acceptance.

## Private-key boundary

Example future signing command:

```bash
node scripts/cineswarm-sign-authorization-receipt.mjs path/to/human-decision.json \
  --payload-type request-execution-authorization \
  --payload-id pn0001_seq01_shot01_gptimage2_r01_authorization \
  --key-id michael-cineswarm-ed25519-001 \
  --authority-id michael-hughes \
  --private-key /outside/repo/cineswarm-human-signing-key.pem \
  --signed-at 2026-08-13T00:00:00-07:00 \
  --expires-at 2026-08-13T01:00:00-07:00 \
  --out /outside/repo/seals/shot01.seal.json
```

The path shown is illustrative only. No key has been created by this candidate.

## Current status command

```bash
node scripts/cineswarm-execution-envelope-status.mjs
```

The canonical current state is expected to fail closed because:

- founder GO is not recorded;
- three request authorization records remain pending;
- no real human signing public key is registered;
- no receipt seals exist.

## Still outside C1.6

- private-key generation/custody ceremony for Michael
- actual founder GO
- actual request `AUTHORIZE` decisions
- actual provider execution
- provider asset acceptance
- public release
- Parallax Relay changes
