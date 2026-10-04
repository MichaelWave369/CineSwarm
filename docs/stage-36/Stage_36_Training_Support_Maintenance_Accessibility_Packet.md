# Stage 36 — Training, Support, Maintenance, and Accessibility Packet

## Operator quick path

1. Read the charter and readiness ledger.
2. Keep `CINESWARM_HOST=127.0.0.1` and set `CINESWARM_ENABLE_TEST_BACKEND=1` for the first run.
3. Run the platform installer, then preserve `cine doctor` output.
4. Start coordinator, submit `examples/orchestration_test.production-plan.json`, then start one node.
5. Run `cine status` and `cine verify-receipts`; stop both processes with Ctrl+C.
6. Create and verify a backup before any LAN or model change.

## Windows setup

- Install 64-bit Python 3.11+ and select “Add Python to PATH,” or install the Python launcher.
- Install ffmpeg/ffprobe from a source the operator trusts; verify both commands resolve.
- Install the NVIDIA driver appropriate to the actual GPU; do not change drivers solely because the package says “CUDA.” The approved model runtime determines the compatibility matrix.
- Run PowerShell: `Set-ExecutionPolicy -Scope Process Bypass`, then `scripts\windows\install.ps1`.
- Edit `config\cineswarm.env`. Use absolute Windows paths for durable field operation.
- Start with `scripts\windows\start-coordinator.ps1`; start the node in a second PowerShell with `scripts\windows\start-node.ps1`.

## Linux setup

- Install Python 3.11+, venv support, ffmpeg/ffprobe, and a vendor driver that makes `nvidia-smi` succeed.
- Run `chmod +x scripts/linux/*.sh`, then `scripts/linux/install.sh`.
- Edit `config/cineswarm.env`; run the coordinator and node scripts in separate terminals.
- A Linux node may join a Windows coordinator over the same trusted private subnet and secret.

## LAN registration and discovery

v0.1 intentionally has no broadcast/mDNS discovery. On the coordinator PC, determine its private LAN IP deliberately, set `CINESWARM_HOST=0.0.0.0`, create a long random `CINESWARM_SHARED_SECRET`, and allow only TCP 8765 from the exact trusted private subnet in the host firewall. On every node set `CINESWARM_COORDINATOR_URL=http://<coordinator-private-ip>:8765` and the same secret. The node registers itself when it starts. Never expose port 8765 through router forwarding, public DNS, VPN ingress, or the Internet; v0.1 lacks TLS.

## Model installation

The package never downloads Wan or weights. If a qualifying ≥24 GB node is available, the operator must deliberately acquire the official Wan 2.2 source and TI2V 5B checkpoint, record source/revision/license, run `cine model-hash <checkpoint-directory>`, fill a ModelManifest, and register it. Set `CINESWARM_WAN_REPO`, `CINESWARM_WAN_CHECKPOINT`, and `CINESWARM_WAN_MODEL_HASH` only on that node. A 12 GB card must be refused for the official profile.

## Storage layout

- Coordinator: database, content-addressed assets, receipts, quarantine, and logs under `CINESWARM_DATA_ROOT`.
- Node: transient jobs and attempts under `CINESWARM_NODE_DATA_ROOT`.
- Models: separate deliberate path; never inside backups unless rights and capacity permit.
- Backups: separate physical disk where practical; hash and verify every bundle.

## Backup, recovery, and migration

Stop the coordinator before a consistent backup. Run:

```text
python scripts/cineswarm_backup.py create <data-root> <backup.zip>
python scripts/cineswarm_backup.py verify <backup.zip>
python scripts/cineswarm_backup.py restore <backup.zip> <new-empty-root>
```

For migration, install the same wheel on the destination, verify the backup, restore to a new empty root, start on loopback, run receipt verification/status, then update LAN bindings. Never overwrite a live data root. Keep the source root until the destination receipt is accepted.

## Troubleshooting

| Symptom | Check | Safe response |
|---|---|---|
| `CINESWARM_SHARED_SECRET` error | Non-loopback bind without secret | Return to loopback or set a random shared secret on coordinator and node |
| Node not visible | URL, secret, firewall, private IP, clock | Test TCP locally; narrow firewall; correct clocks; restart node |
| No GPU | `nvidia-smi`; driver; VM/container visibility | Do not infer CUDA; repair driver/runtime outside CineSwarm |
| `MODEL_UNAVAILABLE` | Wan env paths/hash/capability | Keep job pending/failed; approve exact manifest before retry |
| Insufficient VRAM | Doctor receipt vs manifest | Use a qualifying GPU or create a new backend spec; never sum cards |
| QC/quarantine | ffprobe, dimensions, duration, wire hash | Preserve quarantined bytes/logs; do not review or release |
| Stale lease | Node interruption | Allow expiry/recovery; do not reuse old lease token |
| Low disk | Doctor storage fields | Stop new jobs; archive/backup; free space deliberately |
| Receipt verification fails | DB/receipt head/backups | Freeze operation; preserve files; restore only after investigation |

## Accessibility and burden

Provide copyable commands, high-contrast terminal output, keyboard-only operation, clear stop points, and a quiet one-step-at-a-time mode. The field receipt asks about readability, physical/cognitive burden, noise/heat, and support needs. Do not collect health information unless the operator volunteers it and approves its use.
