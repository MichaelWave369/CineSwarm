# REEL Originals · Windows Local Render Launchpad (diagnostic release)

**Status: real-machine preparation only. No footage rendered or published.**

The REEL Pilot 001 story, the approved first-shot plan builder, the explicit single-shot Wan2.1 GPU runner, CineSwarm real MP4 evidence exporter and ParaCut R8.9 source editor already live as separate source-controlled tools. This release tackles the remaining *setup friction*, especially for Windows creators who have model tools but do not know which requirements they already satisfy.

## 1. Diagnose first, without downloading models

Download or clone the [CineSwarm repository](https://github.com/MichaelWave369/CineSwarm) to **your own Windows PC** and open PowerShell in that extracted folder. Python 3.11+ is the only Python prerequisite for this initial diagnostic; CineSwarm has no runtime Python dependencies, and this script uses the source tree directly through a temporary PYTHONPATH.

Run:

```powershell
.\tools\REEL-Launchpad.ps1
```

If PowerShell restricts unsigned local scripts, review your local execution policy and inspect this source rather than overriding system protections. Alternatively, from the checkout with Python 3.11+ and the source module importable:

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) "src")
python -m cineswarm.reel_launchpad
```

These inspection modes are **read-only** apart from Python's normal interpreter behavior. The script does not clone anything, run pip, download a model, start a GPU task, open an HTTP listener, create a render or grant publishing rights.

The output separately reports:

- Python version and interpreter actually selected for CineSwarm and upstream Wan
- FFmpeg and FFprobe executables on PATH
- NVIDIA driver and each GPU's **currently available individual VRAM** as seen by nvidia-smi
- free system RAM and disk
- actual Wan source folder containing generate.py if the corresponding environment variable is set
- whether your configured checkpoint directory contains files, clearly **unverified by default**
- whether an original user-exported Pilot 001 storyboard file was found and its **source-bound native plan SHA-256**

**Status labels are observations, not editorial approval.** Nominal GPU 12 GB does not mean there is currently 9 GiB free.

## 2. Provide the real REEL storyboard

Visit REEL → Pilot 001, and use **Download preproduction JSON**. The PowerShell launcher automatically checks the default filename at the conventional user's Downloads directory:

```powershell
.\tools\REEL-Launchpad.ps1 -PilotPath "$HOME\Downloads\reel-p001-preproduction.json"
```

This validates the eight canonical scenes and the source-derived first-shot plan. It refuses invented publication/rights approvals and **never submits the plan**.

## 3. Configure your independently installed official Wan model

Official upstream references:

- [Wan-Video/Wan2.1 source](https://github.com/Wan-Video/Wan2.1) · inspect source, requirements, license and actual checked-out revision
- [Wan-AI/Wan2.1-T2V-1.3B official weights](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B) · inspect model card, license, provenance and expected files
- [Official PyTorch installation selector](https://pytorch.org/get-started/locally/) · use a build compatible with your installed NVIDIA driver and GPU, especially on recent cards

Upstream documents using a compatible Python/Torch runtime and installing its own requirements, and recommends 480P for the 1.3B model. CineSwarm's existing Wan backend explicitly uses CPU offload and T5 CPU. **Nothing in this PR installs either the video weights or their dependencies for you.**

When source and weights are already installed, set PowerShell variables with **actual local paths**:

```powershell
$env:CINESWARM_WAN21_REPO = "D:\AI\Wan2.1"
$env:CINESWARM_WAN21_CHECKPOINT = "D:\AI\models\Wan2.1-T2V-1.3B"
python -m cineswarm.cli model-hash "$env:CINESWARM_WAN21_CHECKPOINT"
$env:CINESWARM_WAN21_MODEL_HASH = "<REPLACE_WITH_YOUR_ACTUAL_PINNED_SHA256>"
```

The script will **not** clone those paths or infer that a placeholder hash is real. Source license acceptance, model license and distribution rights need independent human review.

## 4. Opt into deeper checks, still no rendering

```powershell
.\tools\REEL-Launchpad.ps1 -CheckModelHash -ProbeTorch -SaveReport
```

This deliberately reads every configured checkpoint file to compare its canonical SHA-256 with your pinned hash, and imports PyTorch **in a separate subprocess** to report whether that exact local Python environment sees CUDA and its GPUs. PyTorch probing checks device visibility, **not** video-model inference. Model hashing may perform significant disk I/O.

The optional SaveReport writes a **new, timestamped** REEL-P001-Local-Diagnostic JSON in Downloads, and refuses to overwrite another file. The report contains local tool and model folder paths, GPU details and technical readiness; inspect it before sharing publicly.

A green technical result, marked TECHNICAL_PROBES_PASSED_NEEDS_HUMAN_REVIEW, **does not approve creative rights, prove genuine installed weights, complete a generated video, or authorize GPU use**. Exact CUDA dependencies and model runtime behavior remain subject to a real separate field test.

## 5. Start the actual render only when intentionally ready

Read the [existing one-shot local render instructions](REEL_FIRST_SHOT_LOCAL_RENDER_SESSION.md). The explicit runner remains separate:

```powershell
python -m cineswarm.reel_render_session "$HOME\Downloads\reel-p001-preproduction.json" --check-local
```

If technically qualified and after reviewing official model/source terms, choose the explicitly approved **single-job** GPU command in that guide. It requires its own source-bound SHA-256 plan confirmation, model-license acknowledgment, GPU authorization and brand-new durable session path.

Only a genuinely completed native model render produces the actual master MP4 and evidence JSON for REEL / ParaCut. The launcher **never** initiates that command automatically.

## Why no one-click cloud shortcut?

The REEL site is a static public GitHub Pages application. It cannot lawfully or safely open your Windows process environment, run a locally installed video model or obtain model checkpoints without a user-installed and separately authorized local/remote runtime. This utility is a practical first step toward a creator-controlled local workflow, **not** a pretend direct browser-to-GPU execution link.

## Automated evidence

The test suite in tests/test_reel_launchpad.py exercises no-render inspection, malformed source rejection, full hash match/mismatch, realistic single-GPU thresholds, opt-in CUDA subprocess, missing model paths, CLI non-overwrite, and verifies that the Windows wrapper does not contain network/download or hidden-render commands. CI does not contact your PC or render a video.
