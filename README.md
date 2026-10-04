# Parallax Native CineSwarm Engine v0.2.0

> **Public source status:** CineSwarm v0.2.0 is publicly released under the MIT License. The original private-candidate decision record is preserved under `provenance/`; see `PUBLIC_RELEASE_DECISION.md` for the explicit promotion decision.

CineSwarm is a local-first, backend-neutral media orchestration candidate. It provides a coordinator, heterogeneous Node Agent, honest VRAM scheduler, official Wan 2.2 TI2V 5B command adapter, content-addressed asset registry, ffprobe QC, exact-hash human review, training-signal capture, and a hash-chained receipt ledger.

This candidate does **not** contain Wan source or model weights, does not auto-download them, and does not claim that Pocket Spark has rendered. v0.2 preserves the higher-quality Wan 2.2 TI2V 5B lane at its declared 24 GB-class profile and adds an honest consumer-GPU bootstrap fallback using official Wan 2.1 T2V 1.3B. Upstream documents that model at about 8.19 GB VRAM for 480P; CineSwarm schedules it conservatively at 9 GiB free VRAM on one GPU. Its 1280×720 delivery file is explicitly an upscaled/pillarboxed master, not native 720p.

## Parallax creative stack

CineSwarm is the downstream orchestration/runtime candidate in the public creative chain:

```text
Domistika
→ Auralith369
→ ParaCut RenderPlan
→ WaveForgeStudio
→ CineSwarm
```

The WaveForge → CineSwarm receiver contract is intentionally **not yet declared ratified** by this source import. Public release and interop ratification are separate decisions so the receiver can be tested and reviewed on its own evidence.

## Quick local orchestration proof

Python 3.11 or newer is required. The engine itself has no runtime package dependencies.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
cine coordinator --data-root ./demo-data
```

In a second terminal:

```bash
cine submit examples/orchestration_test.production-plan.json
cine node --node-id CINESWARM-TEST-01 --data-root ./demo-node --enable-test-backend --once
cine status
cine verify-receipts
```

The deterministic test backend emits a JSON test fixture. It is explicitly `acceptanceEligible: false` and cannot satisfy the native-video milestone.

## Pocket Spark path

1. Read `docs/stage-36/` before field setup.
2. For a 12 GB-class bootstrap node, deliberately install and pin official Wan 2.1 source and T2V 1.3B checkpoint. For a 24 GB+ node, Wan 2.2 TI2V 5B remains preferred.
3. Run `cine model-hash <checkpoint-directory>` and record the result in an approved ModelManifest.
4. Set the matching `CINESWARM_WAN21_*` or `CINESWARM_WAN_*` variables on the qualifying node.
5. Start the coordinator and node, then submit `examples/pocket_spark.production-plan.json`.
6. Inspect `cine status`, including the exact artifact hash and ffprobe metadata.
7. Record the human decision with `cine review`. Acceptance does not authorize public release.

The Wan 2.2 adapter invokes local `generate.py` with `--task ti2v-5B`, disables external prompt extension, generates native 1280×704, preserves that artifact, and creates a separately hashed 1280×720 local ffmpeg master. The Wan 2.1 bootstrap adapter invokes `--task t2v-1.3B` at native 832×480/16 fps, preserves those bytes, then creates a separately hashed 1280×720/24 fps delivery master whose metadata explicitly records that the source was 480P and the FPS conversion is not motion interpolation.

## LAN boundary

The coordinator binds to `127.0.0.1` by default. Any non-loopback bind requires `CINESWARM_SHARED_SECRET`; requests use timestamped HMAC-SHA256 signatures and body hashes. v0.1 does not provide TLS, so it is not approved for Internet exposure.

## Governance

- Local data stays local by default.
- External generation providers are rejected by the native path.
- Every media artifact is hashed and probed before review eligibility.
- Human decisions bind the exact SHA-256.
- ACCEPT/REJECT is not public-release authorization.
- Test fixtures, missing models, weak hardware, corrupt outputs, and offline nodes remain explicit.

The public core contains the v0.2 build notes and Stage 36 field packet under `docs/`. The larger historical governance archive is intentionally being imported separately as provenance, so this release qualification remains reviewable.

