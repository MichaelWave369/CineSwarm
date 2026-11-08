"""PhiContinuity: deterministic, offline, hash-bound animation planning.

No frames are rendered, no model attention is modified, and no assets are opened.
This module builds a reviewable checkpoint proposal for a future qualified backend.
"""

from __future__ import annotations

import math
from typing import Any

from .canonical import sha256_json
from .errors import require
from .schemas import SAFE_ID, SHA256

REFERENCE_ROLES = {"identity", "style", "environment", "pose"}
_ALLOWED_REFERENCE_KEYS = {"artifactHash", "role", "tag"}
_ALLOWED_BEAT_KEYS = {"atSeconds", "intensity", "cameraCut", "label"}


def _integer(value: Any, field: str, low: int, high: int) -> int:
    require(type(value) is int and low <= value <= high, "CONTINUITY_INVALID",
            f"{field} must be an integer from {low} to {high}", field=field)
    return value


def _number(value: Any, field: str, low: float, high: float) -> float:
    require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high,
            "CONTINUITY_INVALID", f"{field} must be a finite number from {low} to {high}", field=field)
    return float(value)


def _id(value: Any, field: str) -> str:
    require(isinstance(value, str) and SAFE_ID.fullmatch(value) is not None,
            "CONTINUITY_INVALID", f"{field} must be a safe identifier", field=field)
    return value


def _frame(at_seconds: float, fps: int, total_frames: int) -> int:
    return min(total_frames - 1, int(math.floor(at_seconds * fps + 0.5)))


def compile_continuity_preview(source: dict[str, Any]) -> dict[str, Any]:
    """Compile a reproducible, non-executable scene checkpoint preview.

    Reference assets must already have content-addressed hashes. High-motion
    beats get priority after mandatory boundaries and camera cuts. This is a
    planning heuristic, NOT video-token sparse attention or a speed benchmark.
    """
    require(isinstance(source, dict), "CONTINUITY_INVALID", "Preview input must be an object")
    require(source.get("schemaVersion") == "phi-continuity/v1", "CONTINUITY_INVALID",
            "Unsupported continuity input version")
    shot_id = _id(source.get("shotId"), "shotId")
    fps = _integer(source.get("fps"), "fps", 1, 120)
    duration = _number(source.get("durationSeconds"), "durationSeconds", 0.25, 60)
    total_frames = max(1, int(math.floor(duration * fps + 0.5)))
    require(total_frames <= 7200, "CONTINUITY_INVALID", "Frame limit exceeded")

    assets = source.get("referenceAssets")
    require(isinstance(assets, list) and 1 <= len(assets) <= 12,
            "CONTINUITY_INVALID", "referenceAssets must contain 1–12 hash-bound assets")
    normalized_assets: list[dict[str, str]] = []
    seen_assets: set[tuple[str, str, str]] = set()
    for index, item in enumerate(assets):
        require(isinstance(item, dict) and set(item) <= _ALLOWED_REFERENCE_KEYS,
                "CONTINUITY_INVALID", "Unexpected reference asset fields", index=index)
        digest = item.get("artifactHash")
        require(isinstance(digest, str) and SHA256.fullmatch(digest) is not None,
                "CONTINUITY_INVALID", "Reference requires a lowercase SHA-256", index=index)
        role = item.get("role")
        require(role in REFERENCE_ROLES, "CONTINUITY_INVALID", "Unknown reference role", index=index)
        tag = _id(item.get("tag", "reference"), f"referenceAssets[{index}].tag")
        identity = (digest, role, tag)
        require(identity not in seen_assets, "CONTINUITY_INVALID", "Duplicate reference asset", index=index)
        seen_assets.add(identity)
        normalized_assets.append({"artifactHash": digest, "role": role, "tag": tag})

    budget = source.get("checkpointBudget", {})
    require(isinstance(budget, dict) and set(budget) <= {"targetIntervalFrames", "maxCheckpoints"},
            "CONTINUITY_INVALID", "Invalid checkpointBudget")
    interval = _integer(budget.get("targetIntervalFrames", 16), "targetIntervalFrames", 2, 240)
    limit = _integer(budget.get("maxCheckpoints", 16), "maxCheckpoints", 2, 256)

    beats = source.get("motionBeats", [])
    require(isinstance(beats, list) and len(beats) <= 512, "CONTINUITY_INVALID",
            "motionBeats must be an array with at most 512 entries")
    normalized_beats: list[dict[str, Any]] = []
    cut_frames: set[int] = set()
    motion_by_frame: dict[int, float] = {}
    for index, beat in enumerate(beats):
        require(isinstance(beat, dict) and set(beat) <= _ALLOWED_BEAT_KEYS,
                "CONTINUITY_INVALID", "Unexpected motion beat fields", index=index)
        seconds = _number(beat.get("atSeconds"), f"motionBeats[{index}].atSeconds", 0, duration)
        intensity = _number(beat.get("intensity"), f"motionBeats[{index}].intensity", 0, 1)
        cut = beat.get("cameraCut", False)
        require(type(cut) is bool, "CONTINUITY_INVALID", "cameraCut must be boolean", index=index)
        label = _id(beat.get("label", f"beat-{index}"), f"motionBeats[{index}].label")
        frame = _frame(seconds, fps, total_frames)
        normalized_beats.append({"atSeconds": seconds, "frame": frame, "intensity": intensity,
                                 "cameraCut": cut, "label": label})
        motion_by_frame[frame] = max(intensity, motion_by_frame.get(frame, 0.0))
        if cut:
            cut_frames.add(frame)

    mandatory = {0, total_frames - 1} | cut_frames
    require(len(mandatory) <= limit, "CONTINUITY_BUDGET_EXCEEDED",
            "Camera cuts and boundaries exceed maxCheckpoints",
            required=len(mandatory), available=limit)
    selected = set(mandatory)

    # Prioritize motion and camera continuity, then regularly spaced anchors.
    for frame, _ in sorted(motion_by_frame.items(), key=lambda item: (-item[1], item[0])):
        if len(selected) >= limit:
            break
        selected.add(frame)
    for frame in range(0, total_frames, interval):
        if len(selected) >= limit:
            break
        selected.add(frame)

    checkpoints = []
    for frame in sorted(selected):
        if frame == 0 or frame == total_frames - 1:
            reason = "boundary"
        elif frame in cut_frames:
            reason = "camera-cut"
        elif frame in motion_by_frame:
            reason = "motion-beat"
        else:
            reason = "interval"
        checkpoints.append({"frame": frame, "atSeconds": round(frame / fps, 6), "reason": reason})

    result: dict[str, Any] = {
        "schemaVersion": "phi-continuity-preview/v1",
        "shotId": shot_id,
        "sourceHash": sha256_json(source),
        "frameCount": total_frames,
        "fps": fps,
        "referenceAssets": normalized_assets,
        "motionBeats": normalized_beats,
        "checkpoints": checkpoints,
        "checkpointBudget": {"targetIntervalFrames": interval, "maxCheckpoints": limit},
        "executionStatus": "PREVIEW_ONLY",
        "backendAuthorized": False,
        "publicReleaseAuthorized": False,
        "warnings": [
            "No image files have been loaded or verified against the registry.",
            "Checkpoint locations are heuristic planning metadata, not sparse model attention.",
            "No VRAM, visual-quality, runtime, or speedup guarantee is implied.",
        ],
    }
    result["previewHash"] = sha256_json(result)
    return result
