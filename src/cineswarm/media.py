from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .errors import CineSwarmError


def probe_media(path: Path) -> dict[str, Any]:
    executable = shutil.which("ffprobe")
    if not executable:
        return {"probeStatus": "UNAVAILABLE", "reason": "ffprobe not found"}
    command = [
        executable, "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,avg_frame_rate",
        "-of", "json", str(path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=60)
    if completed.returncode != 0:
        return {"probeStatus": "FAILED", "reason": completed.stderr.strip()[:2000]}
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {"probeStatus": "FAILED", "reason": "ffprobe returned invalid JSON"}
    payload["probeStatus"] = "PASSED"
    return payload


def normalize_1280x704_to_1280x720(source: Path, destination: Path, *, timeout_seconds: int) -> None:
    executable = shutil.which("ffmpeg")
    if not executable:
        raise CineSwarmError("MODEL_RUNTIME_UNAVAILABLE", "ffmpeg is required for 1280×720 normalization", 500)
    command = [
        executable, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-vf", "pad=1280:720:0:8:black", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(destination),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout_seconds)
    if completed.returncode != 0 or not destination.is_file() or destination.stat().st_size == 0:
        raise CineSwarmError("POSTPROCESS_FAILED", "ffmpeg normalization failed", 500, {"stderr": completed.stderr[-4000:]})
    probe = probe_media(destination)
    videos = [stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"]
    if probe.get("probeStatus") != "PASSED" or not videos or videos[0].get("width") != 1280 or videos[0].get("height") != 720:
        raise CineSwarmError("QC_FAILED", "Normalized master did not probe as 1280×720", 500, {"probe": probe})



def normalize_832x480_to_1280x720(source: Path, destination: Path, *, timeout_seconds: int) -> None:
    """Scale a Wan 2.1 832x480 native render to 1248x720 and pillarbox to 1280x720.

    The native artifact is preserved separately. This function never claims native 720p.
    """
    executable = shutil.which("ffmpeg")
    if not executable:
        raise CineSwarmError("MODEL_RUNTIME_UNAVAILABLE", "ffmpeg is required for 832×480 → 1280×720 delivery normalization", 500)
    command = [
        executable, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-vf", "scale=1248:720:flags=lanczos,pad=1280:720:16:0:black,fps=24",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(destination),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout_seconds)
    if completed.returncode != 0 or not destination.is_file() or destination.stat().st_size == 0:
        raise CineSwarmError("POSTPROCESS_FAILED", "ffmpeg Wan 2.1 delivery normalization failed", 500, {"stderr": completed.stderr[-4000:]})
    probe = probe_media(destination)
    videos = [stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"]
    if probe.get("probeStatus") != "PASSED" or not videos or videos[0].get("width") != 1280 or videos[0].get("height") != 720:
        raise CineSwarmError("QC_FAILED", "Wan 2.1 delivery master did not probe as 1280×720", 500, {"probe": probe})
