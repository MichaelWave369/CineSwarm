# Release Status — v0.2.0 Public Source Candidate

CineSwarm v0.2.0 is authorized for public source release under the MIT License. The original private-candidate status and manifest are preserved under `provenance/`.

## What is ready

- Public source release is authorized by the project owner.
- MIT licensing is explicit in `LICENSE` and package metadata.
- v0.1 trust/orchestration substrate remains intact.
- A real consumer-GPU bootstrap backend targets official Wan 2.1 T2V 1.3B at native 832×480.
- A 12 GB-class node can qualify for the conservative 9216 MiB free-VRAM bootstrap profile; Wan 2.2 TI2V 5B remains a separate 24 GB+ declared lane.
- Native and delivery artifacts remain separately hashed; the 720 delivery master is explicitly non-native.
- Master ingest enforces ProductionPlan width/height/FPS.
- SQLite read connections close deterministically.
- The deterministic local test suite qualifies the source path without model weights.

## What remains unverified

- No physical Windows/LAN/NVIDIA/CUDA field run was performed in the preserved v0.2.0 candidate build environment.
- Wan 2.1 or Wan 2.2 source/checkpoints are not bundled, installed, or auto-downloaded.
- Pocket Spark has not been claimed as physically rendered or human-reviewed by this public-source promotion.
- 480P bootstrap output is not claimed to equal the quality of the 24 GB+ Wan 2.2 lane.
- The WaveForge → CineSwarm receiver contract is not yet ratified in this repository; that interop change should land independently and remain hash/authority bounded.
- The larger pre-v0.2 historical governance archive is being preserved in a separate provenance import rather than mixed into this core release qualification.

## Safe next use

Verify `SOURCE_MANIFEST.sha256`, read `docs/v0.2/Consumer_GPU_Bootstrap_Lane.md` and `docs/stage-36/`, create a Python 3.11+ virtual environment, install the project from source, and run `cine doctor` on each intended machine.

For real generation, deliberately acquire and verify the applicable upstream Wan source/model under its own terms, hash/register the checkpoint locally, and keep network/publication authority separate from generation acceptance.
