# Parallax CineSwarm C1.24H — Compact Human Handoff

This bundle contains public ceremony state plus a standalone Node.js Ed25519 key-generation/response tool. It contains **no human private key**, no FFmpeg preservation/build closure, and no canonical write/apply capability.

1. Read `C1_24H_HEALTH_AUDIT.json`; it must say `PASS` and the challenge must still be unexpired.
2. Create an absolute private directory **outside this handoff folder**.
3. Run:

```bash
node C1_24H_EXTERNAL_KEY_CEREMONY.mjs --challenge C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json --private-dir "/absolute/private/location/c1-24d-key"
```

4. Keep `*.private.pem` private. Return only `*.enrollment-response.json` to CineSwarm.
5. Optionally verify the public response locally:

```bash
node C1_24H_VERIFY_ENROLLMENT_RESPONSE.mjs --challenge C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json --response "/absolute/private/location/c1-24d-key/<key-id>.enrollment-response.json"
```

The next human gate is full 64-hex fingerprint acknowledgement. This bundle cannot infer or perform that acknowledgement.
