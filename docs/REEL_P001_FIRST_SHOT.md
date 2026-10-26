# REEL Originals P001 Shot 001 · Real Video Candidate Preflight

**Status: offline native real-model production-plan candidate, not an approved or executed render.**

REEL Pilot 001's first storyboard beat, **“The Unlit Screen,”** is a proposed eight-second original abstract shot. CineSwarm's existing native Wan 2.1 T2V 1.3B adapter can, once the local model is installed, verified and reviewed by the operator, render the clip. This PR prepares a **real backend** candidate rather than the v3.4 `deterministic-test` rehearsal. It does **not** execute any jobs or qualify licenses automatically.

## Preparation (after merging CineSwarm PR #5 and ReelCommons PR #36)

1. In REEL Network's Pilot 001 director's desk, download `reel-p001-preproduction.json`.
2. In an environment with this CineSwarm Python package installed, run the offline command:

```bash
python -m cineswarm.reel_shot_one reel-p001-preproduction.json --out reel-p001-shot-one-preflight.json
```

This validates the exact eight-shot P001 story structure, rejects forged approval/release or missing review gates, computes canonical SHA-256 of the entire preproduction packet and builds an actual native `production-plan/v1` **candidate** for a single eight-second shot. It prints the envelope or writes a **new** output file with `--out` and will never overwrite the source or another output. The candidate's backend is specifically `wan21-t2v-1.3b`, `acceptanceEligible: true` (eligible for *later human QC of genuine footage*, not automatically accepted), and `publicReleaseAuthorized: false`.

**Critically:** A native plan candidate is not authorization to call `cine submit`, and there is no *Go Live*, model invocation, rights clearance, or automatic downloader in this code. The candidate lives inside a separately labeled `REEL_P001_WAN21_PRODUCTION_PREFLIGHT_V1` JSON envelope with all reported execution/rights flags **false**.

## Optional local machine probe

On a user-controlled workstation, explicitly opt into a local capability check:

```bash
python -m cineswarm.reel_shot_one reel-p001-preproduction.json --check-local --out reel-p001-checked.json
```

Local checks use the existing native `Wan21T2V13BBackend`, `discover_hardware`, `Scheduler` and `sha256_directory`. Only with `--check-local` are the GPU/free-VRAM, RAM/disk and pinned local checkpoint examined.

To reach `OPERATOR_REVIEW_REQUIRED`, the operator must **separately** supply the local Wan 2.1 source `generate.py`, a local T2V 1.3B checkpoint directory and its true pinned directory digest using `CINESWARM_WAN21_REPO`, `CINESWARM_WAN21_CHECKPOINT`, and `CINESWARM_WAN21_MODEL_HASH`. The native backend requires at least **9216 MiB free VRAM on one GPU**, **16384 MiB free RAM**, and **20480 MiB free disk**. The probe checks these requirements and exact checkpoint hash without starting inference or opening external connections.

Results are one of:

- `NOT_CHECKED`: default; local hardware/model state was not observed
- `BLOCKED_MODEL_NOT_CONFIGURED`, `BLOCKED_MODEL_FILES_OR_CONFIGURATION`, `BLOCKED_CHECKPOINT_UNREADABLE`, `BLOCKED_MODEL_HASH_MISMATCH`: missing/unverified bytes
- `BLOCKED_HARDWARE_OR_MODEL_PROFILE`: configured model but insufficient available local resource profile
- `OPERATOR_REVIEW_REQUIRED`: source and checkpoint are present, hash matches and scheduler currently fits. **Still not an execution approval or a proven successful render.** Model license, creative IP rights, human production approval, real QC and publication are still pending

When the workstation lacks the checkpoint or more than 9216 MiB **free** VRAM, the honest answer is **blocked**. Do not sum GPU VRAM, bypass hash checks, silently download models or claim the proposed 720p delivery as native 720p. Wan 2.1's real native output is **832×480 at 16 fps**, with an ffmpeg postprocessed **1280×720 at 24 fps**. The adaptation scales and duplicates/drops frames; there is no motion interpolation.

## Production ceremony (future human-run task)

Before any physical inference, check the official model license and allowed uses; review the original image prompt/shot concept; pin and audit actual model bytes; inspect available RAM, disk and VRAM; approve a bounded production budget; and ensure the coordinator/node is deliberately configured. Only an authorized operator can extract the `nativeCandidatePlan` and submit it via the existing native `cine submit` flow. A passing preflight does not grant this permission.

After a genuine render, CineSwarm must probe and hash the native MP4 plus delivery master, then a human evaluates the **exact artifact hash**. ParaCut editing, narrating, composing original music in PhiBox, credits/disclosure/rights receipts and REEL channel publication are **separate later steps**, not inferred from the model generating a clip.

The public REEL static website never contacts a CineSwarm coordinator, and imported preflight JSON is never trusted as proof of AI execution or copyright ownership.

## Tests

`tests/test_reel_shot_one.py` covers the native WAN 2.1 candidate and 8-second scene, denied authority/review flags, timestamp and storyboard tampering, bounded local JSON and duplicate keys, offline CLI non-overwrite, missing local model, real pinned SHA and 12 GB-vs-8 GB resource thresholds using injected fake hardware; no GPU or network service is invoked in CI. Existing CineSwarm Python, FFmpeg and source manifest checks remain unchanged.
