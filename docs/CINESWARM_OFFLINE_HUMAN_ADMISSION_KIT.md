# CineSwarm C1.24D — Offline Human Key Enrollment + Admission Signing Kit

## Purpose

C1.24B earned a real independent FFmpeg 7.1.5 source-rebuild proof. C1.24C defined the human canonical-admission ceremony. C1.24D makes that human ceremony usable **without ever importing the human private key into CineSwarm, GitHub, the sidecar, Parallax Relay, or this evidence package**.

C1.24D is a transfer protocol between two trust zones:

1. **CineSwarm/public-evidence zone** — creates challenges, review packets, transition previews, and exact signing requests.
2. **Human private-key zone** — generates and retains the Ed25519 private key and signs only the frozen challenge/request bytes.

Only public material crosses back into CineSwarm.

## Non-negotiable boundaries

- Human private-key custody is external and direct.
- The key generator refuses a private-key output path inside the repository/sidecar tree.
- CineSwarm receives only the public key, SHA-256 public-key fingerprint, proof-of-possession signature, and later the admission signature.
- Human enrollment requires an exact full-fingerprint acknowledgement.
- A signing request is valid for at most **15 minutes** and expires before the planned canonical transition begins.
- The request binds the exact C1.24C review, transition plan, canonical-before hash, expected canonical-after hash, Build Input Archive hash, Independent Rebuild Receipt hash, key ID, and public-key fingerprint.
- C1.24D does not mutate canonical C1.24 or C1.24C registers merely because a kit/request exists.
- C1.24D cannot authorize publication, release, provider spend, deletion, or Parallax Relay.

## Human workflow

### 1. Create a fresh enrollment challenge

```bash
node scripts/cineswarm-c1-24d-create-enrollment-challenge.mjs \
  --out /path/to/public/C1_24D_KEY_ENROLLMENT_CHALLENGE.json
```

The challenge is public evidence and expires within 24 hours.

### 2. Generate the key in an external directory

Run from a human-controlled machine/session. The `--private-dir` path **must be outside the repository/sidecar**.

```bash
node scripts/cineswarm-c1-24d-generate-external-key-response.mjs \
  --challenge /path/to/public/C1_24D_KEY_ENROLLMENT_CHALLENGE.json \
  --private-dir /absolute/private/human/key/location
```

This creates:

- `<keyId>.private.pem` — **never return this to CineSwarm**
- `<keyId>.public.pem` — public
- `<keyId>.enrollment-response.json` — public proof-of-possession response

### 3. Human compares the full fingerprint

Read the full 64-character SHA-256 fingerprint shown by the offline generator and compare it to the public response. Do not abbreviate the value for acknowledgement.

### 4. Stage public-key enrollment

```bash
node scripts/cineswarm-c1-24d-stage-key-enrollment.mjs \
  --challenge /path/to/C1_24D_KEY_ENROLLMENT_CHALLENGE.json \
  --response /path/to/<keyId>.enrollment-response.json \
  --ack-fingerprint <FULL_64_HEX_SHA256> \
  --out-dir /path/to/public/key-enrollment-stage
```

This validates C1.7 proof-of-possession and produces a **staged public-only registry**. It does not mutate the canonical registry.

### 5. Perform the C1.24C human evidence review

Start from:

`fixtures/cineswarm/pn-0001-c1-24d-human-admission-review-worksheet.json`

The worksheet defaults to `HOLD` with all acknowledgements false. A real human must decide whether to change it. `ADMIT_TO_CANONICAL` is accepted only when all six C1.24C checks are explicitly true, including acknowledgement that `fullOsIsolationProven` remains false and that admission grants no release authority.

### 6. Prepare a short-lived exact signing request

After the human public key is enrolled/staged and the human worksheet is complete:

```bash
node scripts/cineswarm-c1-24d-prepare-signing-request.mjs \
  --worksheet /path/to/review-worksheet.json \
  --key-registry /path/to/STAGED_SIGNING_KEY_REGISTRY.json \
  --key-id <keyId> \
  --out-dir /path/to/public/admission-signing-stage
```

The request expires after at most 15 minutes.

### 7. Sign offline with the external private key

```bash
node scripts/cineswarm-c1-24d-sign-offline.mjs \
  --request /path/to/OFFLINE_SIGNING_REQUEST.json \
  --private-key /absolute/private/human/key/location/<keyId>.private.pem \
  --out /path/to/public/C1_24D_SIGNED_ADMISSION_RESPONSE.json
```

The signer derives the public key from the private key and refuses to sign if its fingerprint does not exactly equal the request fingerprint. It also refuses private-key paths inside the repository/sidecar.

### 8. Verify the returned public signed response

```bash
node scripts/cineswarm-c1-24d-verify-signed-response.mjs \
  --request /path/to/OFFLINE_SIGNING_REQUEST.json \
  --response /path/to/C1_24D_SIGNED_ADMISSION_RESPONSE.json \
  --key-registry /path/to/STAGED_SIGNING_KEY_REGISTRY.json \
  --review /path/to/HUMAN_ADMISSION_REVIEW.json \
  --plan /path/to/CANONICAL_ADMISSION_PLAN.json \
  --out /path/to/VERIFIED_C1_24C_CEREMONY.json
```

A valid result proves the human private key authorized **that exact C1.24C ceremony**. Canonical application is still a separate step; the kit does not silently mutate canonical evidence.

## Current real PN-0001 state

- C1.24B technical independent-rebuild proof: **earned**
- C1.24D offline kit: **ready**
- Real human signing public key enrolled: **no**
- Real C1.24C admission signature: **no**
- Canonical C1.24 revision: **0**
- Canonical `fullIndependentSourceRebuildProven`: **false**
- Public release: **false**
- Relay dependency: **false**

Current status: `OFFLINE_KIT_READY_FOR_EXTERNAL_KEY_CEREMONY`.

## Proof-only validation

The packaged synthetic proof uses a disposable Ed25519 identity to exercise challenge → proof of possession → staged public registry → review → signing request → offline signature → valid C1.24C ceremony → proposed cloned canonical admission. The private key is discarded and never written into the proof directory. The real human key registry and canonical registers remain unchanged.
