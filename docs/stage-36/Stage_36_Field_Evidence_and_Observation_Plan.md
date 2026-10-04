# Stage 36 — Field Evidence and Observation Plan

## Evidence principles

Collect the minimum needed to decide the next gate. Prefer structured receipts over screenshots; redact usernames, device serials, IPs beyond private-subnet necessity, secrets, creative prompts, and private media. Never capture `CINESWARM_SHARED_SECRET`.

| Moment | Evidence | Measure | Classification |
|---|---|---|---|
| Install | OS edition, Python/cine/ffmpeg/ffprobe versions, package hash | Pass/fail and elapsed minutes | Machine fact |
| Doctor | Sanitized JSON: GPU name/count/per-device VRAM, RAM, storage | Requirement fit | Machine fact |
| Loopback | Job/task/receipt IDs; test artifact hash | Completion/recovery/receipt validity | Orchestration evidence, not media evidence |
| Backup | Backup hash, file count, verify result | Integrity | Recovery evidence |
| LAN | Node IDs, signed request success, firewall scope | Reachability/auth; no public exposure | Field evidence |
| Restart | Stop/restart times, stale lease result | Recovery time/data integrity | Reliability evidence |
| Model gate | Source revision, checkpoint hash, license finding, manifest | Exact approval state | Governance evidence |
| Native render | Native/master hashes, ffprobe, parameters, generation time, GPU used | Acceptance criteria | Media provenance evidence |
| Human review | Exact artifact hash, decision, reason codes, burden notes | Quality/usability | Human judgment, not release/training consent |

## Observation limits

No background surveillance, keystroke capture, screen recording, biometrics, network payload capture, or telemetry export. Manual timing and self-reported burden are sufficient. All evidence remains local unless the decision owner explicitly exports a redacted receipt.

## Decision questions

1. Did local-only operation and role separation hold?
2. Did the system complete and recover without corrupting receipts/assets?
3. Was operator burden acceptable and were instructions accessible?
4. Did each hardware/model claim match direct evidence?
5. Should the relationship continue unchanged, be repaired, return to Stage 3, pause, or exit?
