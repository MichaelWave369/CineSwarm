# REEL Originals Pilot 001: local single-shot GPU render

**An executable opt-in local Wan 2.1 production path, NOT a generated video.** REEL's public GitHub Pages cannot run your GPU. A real model, Python dependencies, driver and local installation are required before actual rendering.

## Set up on your PC

1. Use Python 3.11+ and a local CineSwarm checkout. Install the package intentionally with `python -m pip install -e .`, plus system `ffmpeg` and `ffprobe` on PATH.
2. Independently obtain authentic Wan2.1 source with `generate.py` and official **Wan 2.1 T2V 1.3B weights**. Install the upstream Python/Torch/CUDA requirements appropriate to your driver, and read the upstream model/source licenses for your intended use. CineSwarm does not bundle, approve, or download weights. Ollama language models are not replacements for video model checkpoints.
3. You need at least **9216 MiB currently free VRAM on ONE GPU**, **16384 MiB free RAM**, and **20480 MiB free disk**. A 12 GB card does not necessarily have 9 GiB *free*; a passed scheduler check cannot guarantee CUDA compatibility.
4. From **REEL Network → Pilot 001**, download `reel-p001-preproduction.json`, which specifies the eight-second first shot "The Unlit Screen" and keeps release rights unapproved.

Example PowerShell environment, **replace with real installed paths and the real computed hash**:

```powershell
$env:CINESWARM_WAN21_REPO       = "D:\AI\Wan2.1"
$env:CINESWARM_WAN21_CHECKPOINT = "D:\AI\models\Wan2.1-T2V-1.3B"
python -m cineswarm.cli model-hash "$env:CINESWARM_WAN21_CHECKPOINT"
$env:CINESWARM_WAN21_MODEL_HASH = "<EXACT_REAL_LOWERCASE_64_HEX_CHECKPOINT_DIGEST>"
```

## Step 1: Inspect, nothing is rendered

```powershell
python -m cineswarm.reel_render_session "$HOME\Downloads\reel-p001-preproduction.json"
```

This validates the original full storyboard, produces the single shot Wan2.1 plan and prints `planHash` (64 hex characters), with **no local coordinator, job, GPU work or model installation**.

Optional hardware and pinned model-byte inspection, still **no job**:

```powershell
python -m cineswarm.reel_render_session "$HOME\Downloads\reel-p001-preproduction.json" --check-local
```

`OPERATOR_REVIEW_REQUIRED` means installed model and reported resources are technically plausible; it is **not** render approval or verified license. Missing weights, low VRAM, wrong hash etc. remain `BLOCKED_*`.

## Step 2: Execute one authorized local GPU job

After individually reviewing the creative prompt, actual model license, expected GPU use and plan hash, invoke this **one PowerShell command** (no invocation is made by REEL):

```powershell
python -m cineswarm.reel_render_session "$HOME\Downloads\reel-p001-preproduction.json" --render --model-license-reviewed --approve-local-gpu --confirm-plan-sha "<EXACT_PLAN_HASH_FROM_INSPECT>" --session-dir "$HOME\Videos\REEL-P001-S01-Run01"
```

All three human authorizations are required: **model license review**, **GPU usage approval**, and the **full exact inspected plan hash**. The new session directory must **not exist**, avoiding overwrites and hidden retries. CineSwarm then starts an isolated ephemeral 127.0.0.1-only coordinator with a secret per session, registers a real Wan2.1 native worker, submits one plan and invokes the node *once*. It never exposes a LAN listener, installs model weights, uses commercial providers or automatically starts a second job.

On a genuine successful render, the content-addressed store contains **native 832×480 / 16fps** and distinct **scaled 1280×720 / 24fps master**, both rehashed and ffprobe-verified. The session retains its SQLite ledger and receipts. It emits a separate evidence sidecar only when local execution, media files and receipt verification succeeded.

On failure, the output is `REEL_LOCAL_RENDER_DENIED_OR_FAILED`; no successful-video sidecar is invented. If a session directory was created before failure, its contents remain for operator diagnosis.

## Step 3: Postproduction

On actual success `REAL_MEDIA_RECORDED_AWAITING_HUMAN_QC`, the console prints `masterMp4Path`, `artifactId`, actual master `sha256` and `evidenceJsonPath` (the unsigned `REEL_P001_REAL_MEDIA_EVIDENCE_V1` file).

Bring those **two real files** into **REEL Pilot 001 → Evidence & Preview Desk**, or **ParaCut Studio R8.9 → Project Media → REEL Originals**. They independently hash the user-selected MP4 against the JSON, then ParaCut's native V1 timeline can edit it with safe muted synthesized source sound. The scaled 720p delivery is **not native 720p** and uses frame duplication/drop, not motion interpolation.

Human QC/`ACCEPT` is distinct from rights to reproduce music, voices or real persons and **does not** authorize public REEL or RCTV publication. Rendering, reviewing, final mastering and releasing are separate steps.

## What CI can prove

`tests/test_reel_render_session.py` checks inspection, exact hash/manual approval refusals, model-blocked cases, no-overwrite, ffmpeg precondition and a real isolated loopback coordinator that never claims an unsupported test run as finished footage. It does **not** install Wan weights or execute actual GPU inference. A green PR is software verification, not a fabricated first movie.
