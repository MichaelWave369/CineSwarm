"""REEL Pilot 001 local readiness dashboard. Inspects only, NEVER renders.

This does not install models, start any coordinator, import torch by default,
make network requests or authorize a license / public release.

python -m cineswarm.reel_launchpad
python -m cineswarm.reel_launchpad --pilot <local-exported-pilot.json>
python -m cineswarm.reel_launchpad --pilot <pilot> --check-model-hash --probe-torch
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

from .canonical import sha256_directory
from .hardware import _memory_mib, _nvidia_gpus
from .reel_shot_one import create_first_shot_candidate, read_pilot_file

SCHEMA = "REEL_P001_LOCAL_LAUNCHPAD_DIAGNOSTIC_V1"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
MIN_VRAM_MIB = 9216
MIN_RAM_MIB = 16384
MIN_DISK_MIB = 20480
TORCH_TEST_CODE = """import json
import torch
data={"version":str(torch.__version__),"torchCuda":str(torch.version.cuda),
      "cudaAvailable":bool(torch.cuda.is_available()),"deviceCount":0,
      "devices":[]}
if data["cudaAvailable"]:
    data["deviceCount"]=torch.cuda.device_count()
    for i in range(min(data["deviceCount"],8)):
        d=torch.cuda.get_device_properties(i)
        data["devices"].append({"name":d.name,"totalMiB":int(d.total_memory//1048576),
                               "computeCapability":f"{d.major}.{d.minor}"})
print(json.dumps(data))
"""


def _tool(name: str, which=shutil.which) -> dict[str, Any]:
    location = which(name)
    return {"status": "FOUND" if location else "MISSING", "executable": location}


def probe_torch_cuda(timeout_seconds: int = 30) -> dict[str, Any]:
    """Explicit opt-in. Imports torch in an isolated subprocess, not a model."""
    try:
        result = subprocess.run(
            [sys.executable, "-c", TORCH_TEST_CODE],
            capture_output=True, text=True, timeout=timeout_seconds, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"status": "BLOCKED", "reason": type(error).__name__}
    if result.returncode != 0:
        return {
            "status": "BLOCKED",
            "reason": "Torch CUDA probe exited with code " + str(result.returncode),
            "messageTail": result.stderr[-800:],
        }
    try:
        data = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return {"status": "BLOCKED", "reason": "Torch CUDA probe did not return JSON"}
    if (not isinstance(data, dict) or
            type(data.get("cudaAvailable")) is not bool or
            not isinstance(data.get("devices"), list)):
        return {"status": "BLOCKED", "reason": "Torch CUDA probe returned invalid diagnostics"}
    return {
        "status": "AVAILABLE" if data["cudaAvailable"] else "BLOCKED",
        "torchVersion": str(data.get("version", ""))[:64],
        "torchCuda": str(data.get("torchCuda", ""))[:32],
        "cudaAvailable": data["cudaAvailable"],
        "deviceCount": data.get("deviceCount", 0),
        "devices": data["devices"][:8],
        "note": "Torch device check is not Wan 2.1 inference and cannot prove model dependencies work.",
    }


def launchpad_report(
    pilot: Path | None = None, *,
    check_model_hash: bool = False,
    probe_torch: bool = False,
    disk_path: Path | None = None,
) -> dict[str, Any]:
    """Read-only observation. Optional probes are disclosed, never scheduled."""
    python_ok = sys.version_info >= (3, 11)
    ffmpeg = _tool("ffmpeg")
    ffprobe = _tool("ffprobe")
    nvidia_smi = _tool("nvidia-smi")
    try:
        gpus, driver = _nvidia_gpus() if nvidia_smi["status"] == "FOUND" else ([], None)
    except (OSError, ValueError):
        gpus, driver = [], None

    total_ram, free_ram = _memory_mib()
    target_disk = (disk_path or Path.cwd()).resolve()
    disk = shutil.disk_usage(target_disk)
    free_disk = int(disk.free // 1048576)
    best_gpu = max((int(g["vramFreeMiB"]) for g in gpus), default=0)
    resource_ok = (
        best_gpu >= MIN_VRAM_MIB
        and free_ram >= MIN_RAM_MIB
        and free_disk >= MIN_DISK_MIB
    )

    source_path = os.getenv("CINESWARM_WAN21_REPO")
    checkpoint_path = os.getenv("CINESWARM_WAN21_CHECKPOINT")
    expected_hash = (os.getenv("CINESWARM_WAN21_MODEL_HASH") or "").lower()
    source = Path(source_path).expanduser() if source_path else None
    checkpoint = Path(checkpoint_path).expanduser() if checkpoint_path else None
    source_found = bool(source and (source / "generate.py").is_file())
    checkpoint_found = bool(checkpoint and checkpoint.is_dir())
    checkpoint_nonempty = bool(checkpoint_found and any(checkpoint.iterdir()))

    hash_status: dict[str, Any] = {
        "status": "NOT_CHECKED",
        "reason": "Checkpoint bytes are only hashed with the explicit --check-model-hash flag.",
    }
    if check_model_hash:
        if not checkpoint_found or not checkpoint_nonempty or not SHA_RE.fullmatch(expected_hash):
            hash_status = {
                "status": "BLOCKED",
                "reason": "Missing checkpoint directory, empty weights or invalid 64-hex pinned model digest",
            }
        else:
            try:
                observed = sha256_directory(checkpoint)
                hash_status = {
                    "status": "MATCH" if observed == expected_hash else "MISMATCH",
                    "observedSha256": observed,
                    "pinnedSha256": expected_hash,
                }
            except (OSError, ValueError) as error:
                hash_status = {"status": "BLOCKED", "reason": "Could not hash model checkpoint: " + str(error)[:300]}

    torch_data: dict[str, Any] = (
        probe_torch_cuda() if probe_torch else {
            "status": "NOT_CHECKED",
            "reason": "Use --probe-torch to check CUDA runtime in this exact Python environment.",
        }
    )

    source_data: dict[str, Any] = {
        "status": "NOT_PROVIDED", "sourceHash": None, "nativePlanHash": None,
        "shotId": "reel-p001-s01",
    }
    if pilot is not None:
        source_data = {"status": "INVALID", "sourceHash": None, "nativePlanHash": None,
                       "shotId": "reel-p001-s01"}
        try:
            candidate = create_first_shot_candidate(read_pilot_file(pilot))
            source_data.update(
                status="VALID_UNREVIEWED_PREPRODUCTION",
                sourceHash=candidate["sourceHash"],
                nativePlanHash=candidate["nativePlanHash"],
            )
        except (OSError, ValueError) as error:
            source_data["reason"] = str(error)[:350]

    checks = {
        "python": {
            "status": "FOUND" if python_ok else "BLOCKED",
            "executable": sys.executable, "version": platform.python_version(),
            "minimum": "3.11",
        },
        "ffmpeg": ffmpeg, "ffprobe": ffprobe, "nvidiaSmi": nvidia_smi,
        "gpus": gpus, "nvidiaDriver": driver,
        "availableResources": {
            "status": "POSSIBLE" if resource_ok else "BLOCKED",
            "bestSingleGpuFreeMiB": best_gpu, "freeRamMiB": free_ram,
            "totalRamMiB": total_ram, "freeDiskMiB": free_disk,
            "required": {
                "singleGpuFreeMiB": MIN_VRAM_MIB, "ramFreeMiB": MIN_RAM_MIB,
                "diskFreeMiB": MIN_DISK_MIB,
            },
        },
        "wanSource": {
            "status": "FOUND" if source_found else "MISSING",
            "configured": bool(source_path),
            "path": str(source) if source else None,
            "generatePyPresent": source_found,
        },
        "wanCheckpoint": {
            "status": "FOUND_UNVERIFIED" if checkpoint_nonempty else "MISSING_OR_EMPTY",
            "configured": bool(checkpoint_path), "path": str(checkpoint) if checkpoint else None,
            "directoryHasFiles": checkpoint_nonempty,
            "pinnedDigestConfigured": bool(SHA_RE.fullmatch(expected_hash)),
        },
        "checkpointHash": hash_status,
        "torchCuda": torch_data,
    }
    verified = bool(
        python_ok and ffmpeg["status"] == "FOUND" and ffprobe["status"] == "FOUND"
        and resource_ok and source_found and checkpoint_nonempty
        and hash_status["status"] == "MATCH"
        and torch_data["status"] == "AVAILABLE"
        and source_data["status"] == "VALID_UNREVIEWED_PREPRODUCTION"
    )
    notes = []
    if not python_ok:
        notes.append("Install Python 3.11+ and use this same Python for CineSwarm and Wan dependencies.")
    if ffmpeg["status"] != "FOUND" or ffprobe["status"] != "FOUND":
        notes.append("Make both ffmpeg and ffprobe available on PATH.")
    if not gpus:
        notes.append("NVIDIA GPU/driver not observed. Check nvidia-smi and device driver.")
    elif best_gpu < MIN_VRAM_MIB:
        notes.append("Free at least 9216 MiB VRAM on ONE GPU, without combining cards.")
    if free_ram < MIN_RAM_MIB or free_disk < MIN_DISK_MIB:
        notes.append("Free sufficient local RAM/disk capacity before attempting native generation.")
    if not source_found:
        notes.append("Set CINESWARM_WAN21_REPO to a reviewed, actually installed official Wan2.1 source folder containing generate.py.")
    if not checkpoint_nonempty:
        notes.append("Obtain and license-review the authentic Wan2.1 T2V 1.3B checkpoint separately; set CINESWARM_WAN21_CHECKPOINT.")
    if hash_status["status"] != "MATCH":
        notes.append("Compute and pin the true checkpoint directory hash, then explicitly run --check-model-hash.")
    if torch_data["status"] != "AVAILABLE":
        notes.append("Install a CUDA-compatible PyTorch and Wan2.1 dependencies in this Python environment; use --probe-torch to verify visibility.")
    if source_data["status"] != "VALID_UNREVIEWED_PREPRODUCTION":
        notes.append("Export the current REEL Pilot 001 preproduction JSON and pass --pilot to verify its original source-bound plan.")
    return {
        "schema": SCHEMA, "mode": "READ_ONLY_LOCAL_DIAGNOSTIC_NO_RENDER",
        "platform": {"system": platform.system(), "release": platform.release()},
        "prerequisites": checks,
        "pilot": source_data,
        "readiness": {
            "status": "TECHNICAL_PROBES_PASSED_NEEDS_HUMAN_REVIEW" if verified else "NOT_CONFIRMED",
            "allRequiredChecksObserved": verified,
            "modelLicenseReviewed": False, "creativeApprovalGranted": False,
            "gpuExecutionAuthorized": False,
            "actualModelInferenceCompleted": False,
            "publicReleaseAuthorized": False,
        },
        "nextActions": notes if notes else [
            "Use python -m cineswarm.reel_render_session <pilot> --check-local to independently confirm scheduler readiness.",
            "Inspect source/rights/model terms and the exact plan hash before deciding whether to explicitly authorize a single render.",
        ],
        "authoredFor": "REEL Originals Pilot 001 / The First Transmission / first eight-second shot",
        "networkUsed": False, "modelDownloaded": False, "gpuInferenceStarted": False,
    }


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m cineswarm.reel_launchpad",
        description="Read-only REEL P001 Windows/Linux setup and CUDA/weights diagnostics. NEVER renders.",
    )
    parser.add_argument("--pilot", type=Path, help="REEL P001 preproduction JSON file, if exported")
    parser.add_argument("--check-model-hash", action="store_true",
                        help="Opt in to checking all checkpoint bytes, which can take time")
    parser.add_argument("--probe-torch", action="store_true",
                        help="Opt in to torch CUDA device inspection, no inference")
    parser.add_argument("--out", type=Path, help="Write a new diagnostic JSON file; never overwrite")
    args = parser.parse_args(argv)
    try:
        report = launchpad_report(args.pilot, check_model_hash=args.check_model_hash,
                                  probe_torch=args.probe_torch)
        data = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.out:
            target = args.out.expanduser().resolve()
            if args.pilot is not None and args.pilot.expanduser().resolve() == target:
                raise ValueError("Cannot overwrite the source pilot file")
            with target.open("x", encoding="utf-8") as handle:
                handle.write(data)
            print(json.dumps({"result": report["readiness"]["status"],
                              "output": str(target), "rendered": False}, sort_keys=True))
        else:
            print(data, end="")
        return 0
    except (OSError, ValueError) as error:
        print(json.dumps({"error": {
            "code": "REEL_LAUNCHPAD_DIAGNOSTIC_ERROR", "message": str(error),
            "gpuInferenceStarted": False,
        }}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
