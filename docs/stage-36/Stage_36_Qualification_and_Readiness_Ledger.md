# Stage 36 — Qualification and Readiness Ledger

| ID | Gate | Evidence required | Current state | Next evidence |
|---|---|---|---|---|
| Q-01 | Source integrity | Final manifest and package hash | Pending final package | Generate after Stage 45 |
| Q-02 | Python | Python ≥3.11 on each PC | Unable to Verify | `python --version`; installer receipt |
| Q-03 | ffmpeg/ffprobe | Executables on PATH; test probe | Unable to Verify | Version output and test-backend/known-good probe |
| Q-04 | NVIDIA driver | `nvidia-smi` succeeds | Unable to Verify | Preserve full doctor JSON |
| Q-05 | CUDA/runtime | Driver/runtime compatible with approved backend | Unable to Verify | Backend-specific version receipt; no generic CUDA claim |
| Q-06 | Storage | Writable roots; free capacity recorded | Build environment passed only | Doctor receipt per real root |
| Q-07 | Loopback | Coordinator + node + test job | Software tests passed | Actual PC field receipt |
| Q-08 | LAN | Private subnet, HMAC secret, narrow rule | Unable to Verify | Two-machine signed request and exposure check |
| Q-09 | Recovery | Backup verify; restart/stale lease; restore drill | Stale lease tested; scripts prepared | Empty-target restore on actual PC |
| Q-10 | Wan source | Official source/revision deliberately acquired | Not installed by package | Record repository revision/hash |
| Q-11 | Wan checkpoint | Exact directory hash and license finding | Not installed | Approved ModelManifest |
| Q-12 | Wan hardware | ≥24 GB GPU for official published TI2V 5B path | Blocked on stated 12 GB RTX 5070 | Qualifying node or new Stage 3 backend |
| Q-13 | Pocket Spark | Native 1280×704 + separate 1280×720 master, QC, exact-hash review | Unable to Verify | Actual qualifying render receipt |
| Q-14 | Privacy | No unexpected outbound/provider traffic | Architecture/tests only | Field network observation |
| Q-15 | Human readiness | Burden, instructions, accessibility acceptable | Unable to Verify | Operator questionnaire and decision |

## Readiness verdict

- Package/runbook preparation: **Prepared**.
- Loopback and private-LAN field qualification: **Unable to Verify** until executed by the operator.
- Official Wan on the stated primary GPU: **Blocked**.
- Pocket Spark, production, training, marketplace, or public release: **Not Ready**.
