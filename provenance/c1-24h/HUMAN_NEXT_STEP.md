# C1.24H — Human Next Step

Current machine-side health: **PASS**. The public enrollment challenge is active and the canonical baseline has not drifted.

Use the compact handoff bundle. On the human-controlled machine, create an absolute private directory outside the extracted handoff folder and run:

```bash
node C1_24H_EXTERNAL_KEY_CEREMONY.mjs \
  --challenge C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json \
  --private-dir "/absolute/private/location/c1-24d-key"
```

Keep the generated `*.private.pem` private and external. Return only the generated `*.enrollment-response.json` to CineSwarm. The next gate will require exact re-entry of the full 64-hex public-key fingerprint.

If the handoff verifier reports that the challenge expired, do not reuse it. C1.24H permits a replacement only through the expired-only reissue path with explicit predecessor lineage.
