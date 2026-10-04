# Stage 36 — Lived-Use Field Protocol

**Receipt state:** Protocol prepared; field execution not performed in this environment.

## Session header

- Date/time and operator: ___
- Machine role and sanitized ID: ___
- OS/Python/cine/ffmpeg/ffprobe versions: ___
- Package/source SHA-256: ___
- Private/loopback scope: ___
- Consent to run this bounded session: YES / NO

## Gate sequence

### Gate 0 — Preserve

Record current state, create/verify backup, confirm exit path and no public-release/training authority. Result: PASS / FAIL / PAUSE. Evidence: ___

### Gate 1 — Install and doctor

Run platform installer and `cine doctor`. Record per-GPU VRAM rather than combined capacity. Result: PASS / FAIL / PAUSE. Evidence: ___

### Gate 2 — Loopback orchestration

Keep `127.0.0.1`, enable test backend, start coordinator, submit the orchestration example, start one node, record status and receipt verification. Result: PASS / FAIL / PAUSE. Evidence: ___

### Gate 3 — Recovery drill

Interrupt a synthetic task/node, observe lease expiry/recovery, restart, create/verify backup, restore to a new empty root, and verify receipts. Result: PASS / FAIL / PAUSE. Evidence: ___

### Gate 4 — Private LAN

Set a fresh shared secret, bind coordinator, add the narrow private-subnet firewall rule, register the second node, test signed status/heartbeat, and confirm no router/public exposure. Result: PASS / FAIL / PAUSE. Evidence: ___

### Gate 5 — Model decision

If and only if a qualifying ≥24 GB node and approved exact Wan source/checkpoint/runtime/use exist, register the ModelManifest. Otherwise mark the official profile BLOCKED and choose: wait / new Stage 3 backend specification / stop. Evidence: ___

### Gate 6 — Pocket Spark

Submit the unmodified production plan. Preserve native 1280×704 and separate 1280×720 master, ffprobe/QC, exact hashes, parameters, generation time, GPU, and local-only/provider-fee receipt. Record review against exact hash. Result: ACCEPT / REJECT / REVISION_REQUESTED / NOT RUN. Public release: NOT AUTHORIZED unless separately recorded.

## Lived-use observations

- Setup time and unclear steps: ___
- Readability/keyboard access/support needs: ___
- Noise, heat, interruptions, physical/cognitive burden: ___
- Unexpected behavior or privacy concern: ___
- Failure and recovery experience: ___

## Field decision

Choose one: continue bounded pilot / repair and re-qualify / return to Stage 3 / pause / exit. Decision owner, date, scope, rationale, exact receipt head: ___
