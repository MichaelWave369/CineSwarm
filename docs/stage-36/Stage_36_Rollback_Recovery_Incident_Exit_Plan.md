# Stage 36 — Rollback, Recovery, Incident, and Exit Plan

## Rollback ladder

1. Stop node processes with Ctrl+C.
2. Stop coordinator with Ctrl+C and preserve terminal output.
3. Disable/delete the narrowly scoped inbound firewall rule if one was created.
4. Remove `CINESWARM_WAN_*` settings to disable the model backend; do not delete model bytes during incident triage.
5. Return `CINESWARM_HOST` and coordinator URL to loopback.
6. Copy the data root and logs read-only where practical; compute hashes.
7. Verify the most recent backup. Restore only to a new empty target and compare receipt status before switching roots.
8. If exiting permanently, archive user-owned data, revoke secrets, remove the venv, and deliberately decide model/source retention based on rights. Do not delete evidence automatically.

## Incident classes

| Class | Examples | Immediate response | Restart authority |
|---|---|---|---|
| Security | Public exposure, secret leak, unexpected outbound/provider call | Stop all processes; close network rule; rotate secret; preserve logs | Decision owner after scope is understood |
| Integrity | Hash/receipt failure, DB corruption, mismatched artifact | Freeze reviews/releases; quarantine bytes; verify backups | Decision owner after valid recovery proof |
| Safety/resource | Overheat, noise burden, disk exhaustion, instability | Stop workload; cool/free resources; do not auto-retry | Machine owner |
| Governance | Unclear model license, unauthorized data/training/release | Stop affected path; preserve exact identifiers | Relevant human authority only |
| Reliability | Node loss, stale lease, restart loop | Stop affected node; allow lease expiry; inspect receipts | Operator within accepted field scope |

## Recovery checks

After any recovery: run `cine doctor`, start loopback only, run `cine status`, run `cine verify-receipts`, confirm quarantine/asset counts, and execute a synthetic test-backend job. Do not resume a native job until the model and hardware gates remain valid.

## Exit rights

The operator may stop without explanation. No participant is obligated to continue, supply hardware, accept media, release artifacts, share evidence, train a model, or act as steward. Exiting a pilot does not surrender ownership or custody.
