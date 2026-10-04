# Release Status — v0.2.0 Private Candidate

## What is ready

- v0.1 trust/orchestration substrate remains intact.
- A real consumer-GPU bootstrap backend now targets official Wan 2.1 T2V 1.3B at native 832×480.
- A 12 GB-class node can qualify for the conservative 9216 MiB free-VRAM bootstrap profile; Wan 2.2 TI2V 5B remains a separate 24 GB+ declared lane.
- Native and delivery artifacts remain separately hashed; the 720 delivery master is explicitly non-native.
- Master ingest now enforces ProductionPlan width/height/FPS.
- SQLite read connections close deterministically.

## What is not ready

- No public/open-source release is authorized; project license remains undecided.
- No physical Windows/LAN/NVIDIA/CUDA field run was performed in this build environment.
- Wan 2.1 or Wan 2.2 source/checkpoints are not bundled, installed, or auto-downloaded.
- Pocket Spark has not been rendered or human-reviewed on Mikey's physical machines.
- 480P bootstrap output is not claimed to equal the quality of the 24 GB+ Wan 2.2 lane.

## Safe next use

Verify `SOURCE_MANIFEST.sha256`, read `docs/v0.2/Consumer_GPU_Bootstrap_Lane.md` and `docs/stage-36/`, install the included wheel privately, run `cine doctor` on each machine, then deliberately acquire/hash/register Wan 2.1 T2V 1.3B on the first qualifying 12 GB-class node. Generate Pocket Spark and record ACCEPT/REJECT against the exact output hash.
