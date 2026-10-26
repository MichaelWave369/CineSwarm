"""REEL P001 first *real* Wan 2.1 shot preflight: offline, never submits.

Receives REEL_ORIGINAL_PILOT_PREPRODUCTION_V1 with all review/authority
flags denied. Builds a separately REVIEWABLE production-plan/v1 candidate,
not an authorized job or rights receipt. Optional local hardware/model
inspection never downloads checkpoints, starts workers or opens a network.

Usage:
 python -m cineswarm.reel_shot_one reel-p001-preproduction.json --out p001-shot-one-preflight.json
 python -m cineswarm.reel_shot_one reel-p001-preproduction.json --check-local --out ...
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Sequence

from .backends.wan21 import Wan21T2V13BBackend
from .canonical import sha256_directory, sha256_json
from .hardware import discover_hardware
from .scheduler import Scheduler
from .schemas import validate_production_plan
from .reel_intake import ReelIntakeError, _duplicate_key_guard

PREPRODUCTION_SCHEMA = "REEL_ORIGINAL_PILOT_PREPRODUCTION_V1"
OUTPUT_SCHEMA = "REEL_P001_WAN21_PRODUCTION_PREFLIGHT_V1"
MAX_SOURCE_BYTES = 128 * 1024
SHOT_IDS = tuple(f"P001-S{index:02}" for index in range(1, 9))
STARTS = (0, 8, 17, 27, 36, 47, 57, 66)
DURATIONS = (8, 9, 10, 9, 11, 10, 9, 8)
REVIEW_GATES = (
    "creative", "sources", "voices", "music", "claims",
    "models", "editorial", "release",
)
AUTHORITY_KEYS = (
    "aiAgentsExecuted", "assetsRendered", "visualQCCompleted",
    "provenanceReceiptIssued", "rightsVerified", "humanReleaseAuthorized",
    "published", "rctvChannelAssigned", "cineSwarmPlanSubmitted",
)
SAFE_TEXT = re.compile(r"^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$")
DATE_RE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


def _strict_obj(value: Any, label: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ReelIntakeError(f"{label}: unexpected or missing JSON fields")
    return value


def _bounded(value: Any, label: str, limit: int, *, nonempty: bool = True) -> str:
    if not isinstance(value, str) or len(value) > limit or not SAFE_TEXT.fullmatch(value) or (
        nonempty and not value.strip()
    ):
        raise ReelIntakeError(f"{label}: invalid text")
    return value


def _denied(value: Any, label: str) -> None:
    if value is not False:
        raise ReelIntakeError(f"{label}: unauthorized production or publishing flag")


def validate_pilot_packet(source: Any) -> dict[str, Any]:
    root = _strict_obj(source, "pilot", {
        "schema", "id", "title", "show", "contentClass",
        "legacyInspiration", "status", "createdUtc", "pilotDurationSeconds",
        "disclosure", "concept", "localProductionNotes",
        "credits", "shots", "reviewGates", "authority", "handoff",
    })
    for key, expected in {
        "schema": PREPRODUCTION_SCHEMA,
        "id": "REEL-P001",
        "title": "The First Transmission",
        "show": "REEL Originals",
        "contentClass": "fiction",
        "status": "PREPRODUCTION_DRAFT_NOT_RENDERED",
        "pilotDurationSeconds": 74,
    }.items():
        if type(root[key]) is not type(expected) or root[key] != expected:
            raise ReelIntakeError(f"pilot.{key}: not REEL P001 preproduction")
    for key, length in [
        ("legacyInspiration", 500), ("disclosure", 500),
        ("concept", 1500), ("localProductionNotes", 2000),
    ]:
        _bounded(root[key], key, length, nonempty=key != "localProductionNotes")
    if not isinstance(root["createdUtc"], str) or not DATE_RE.fullmatch(root["createdUtc"]):
        raise ReelIntakeError("createdUtc: invalid UTC timestamp")
    from datetime import datetime
    try:
        datetime.fromisoformat(root["createdUtc"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReelIntakeError("createdUtc: invalid calendar time") from exc

    credits = _strict_obj(root["credits"], "credits", {
        "creativeDirection", "narrationArtist", "musicAuthor", "visualAssets",
    })
    for key, expected in {
        "creativeDirection": "human review pending",
        "narrationArtist": "unassigned", "musicAuthor": "unassigned",
        "visualAssets": "uncreated",
    }.items():
        if credits[key] != expected:
            raise ReelIntakeError(f"credits.{key}: unsupported approval claim")
    authority = _strict_obj(root["authority"], "authority", set(AUTHORITY_KEYS))
    for key in AUTHORITY_KEYS:
        _denied(authority[key], f"authority.{key}")
    handoff = _strict_obj(root["handoff"], "handoff", {
        "existingPitchSchema", "thisPackageIsNativeCineSwarmPlan",
        "recommendedTools", "nextStep",
    })
    if handoff["existingPitchSchema"] != "REEL_NETWORK_PITCH_PACKET_V1":
        raise ReelIntakeError("handoff: invalid source plan reference")
    _denied(handoff["thisPackageIsNativeCineSwarmPlan"], "handoff.thisPackageIsNativeCineSwarmPlan")
    if not isinstance(handoff["recommendedTools"], list) or not handoff["recommendedTools"] or not all(
        isinstance(item, str) and len(item) <= 64 for item in handoff["recommendedTools"]
    ):
        raise ReelIntakeError("handoff: invalid recommendedTools")
    _bounded(handoff["nextStep"], "handoff.nextStep", 1500)

    gates = root["reviewGates"]
    if not isinstance(gates, list) or len(gates) != len(REVIEW_GATES):
        raise ReelIntakeError("reviewGates: expected all eight pending gates")
    for idx, gate in enumerate(gates):
        _strict_obj(gate, f"reviewGates[{idx}]", {
            "id", "label", "status", "releaseAuthority",
        })
        if gate["id"] != REVIEW_GATES[idx] or gate["status"] != "not_reviewed":
            raise ReelIntakeError(f"reviewGates[{idx}]: cannot assert review completion")
        _denied(gate["releaseAuthority"], f"reviewGates[{idx}].releaseAuthority")
        _bounded(gate["label"], f"reviewGates[{idx}].label", 90)

    shots = root["shots"]
    if not isinstance(shots, list) or len(shots) != 8:
        raise ReelIntakeError("shots: expected all eight original scenes")
    for idx, shot in enumerate(shots):
        _strict_obj(shot, f"shots[{idx}]", {
            "id", "startSeconds", "durationSeconds", "name", "purpose",
            "camera", "imagePrompt", "voiceover", "musicAndSound",
            "transition", "rightsNote",
        })
        if (
            shot["id"] != SHOT_IDS[idx]
            or type(shot["startSeconds"]) is not int or shot["startSeconds"] != STARTS[idx]
            or type(shot["durationSeconds"]) is not int or shot["durationSeconds"] != DURATIONS[idx]
        ):
            raise ReelIntakeError(f"shots[{idx}]: unrecognized shot or time range")
        for key, size in [
            ("name", 120), ("purpose", 800), ("camera", 1000),
            ("imagePrompt", 20_000), ("voiceover", 2_000),
            ("musicAndSound", 1500), ("transition", 1000),
            ("rightsNote", 1200),
        ]:
            _bounded(shot[key], f"shots[{idx}].{key}", size)
    return root


def create_first_shot_candidate(source: Any) -> dict[str, Any]:
    """Produce a full real-video candidate without approval, registration or I/O."""
    packet = validate_pilot_packet(source)
    digest = sha256_json(packet)
    first = packet["shots"][0]
    plan = validate_production_plan({
        "schemaVersion": "production-plan/v1",
        "projectId": "reel-p001-" + digest[:12],
        "idempotencyKey": "p001-s01-wan21-" + digest[:32],
        "lineage": {"sourceSystem": "REEL_P001", "sourceHash": digest},
        "shots": [{
            "shotId": "reel-p001-s01",
            "prompt": first["imagePrompt"],
            "durationSeconds": first["durationSeconds"],
            "delivery": {
                "width": 1280, "height": 720,
                "fps": 24, "container": "mp4",
            },
            "backendPreference": ["wan21-t2v-1.3b"],
            "conditioning": [], "seed": 369,
            "acceptanceEligible": True,
            "publicReleaseAuthorized": False,
        }],
    })
    return {
        "schema": OUTPUT_SCHEMA,
        "mode": "OFFLINE_REAL_SHOT_CANDIDATE_NOT_SUBMITTED",
        "status": "AWAITING_MANUAL_PRODUCTION_APPROVAL",
        "sourceHash": digest,
        "nativePlanHash": sha256_json(plan),
        "shotSourceId": first["id"],
        "scriptedDurationSeconds": first["durationSeconds"],
        "modelBackend": "wan21-t2v-1.3b",
        "nativeResolution": [832, 480],
        "nativeFps": 16,
        "deliveryResolution": [1280, 720],
        "deliveryFps": 24,
        "native720p": False,
        "gpuModelExecuted": False,
        "mediaRendered": False,
        "assetHashVerified": False,
        "rightsVerified": False,
        "humanProductionApprovalGranted": False,
        "publicReleaseAuthorized": False,
        "coordinatorContacted": False,
        "modelDownloaded": False,
        "nativeCandidatePlan": plan,
    }


def inspect_local_readiness(plan: dict[str, Any], *, data_root: Path) -> dict[str, Any]:
    """Explicit opt-in local hardware and model *presence*, no model loading."""
    hardware = discover_hardware("REEL-P001-PREFLIGHT", data_root=data_root)
    backend = Wan21T2V13BBackend.from_env(timeout_seconds=4 * 60 * 60)
    if backend is None:
        return {
            "status": "BLOCKED_MODEL_NOT_CONFIGURED",
            "localHardwareObserved": True,
            "modelHashVerified": False,
            "schedulerViable": False,
            "reason": "No local pinned Wan2.1 source/checkpoint/hash environment variables. No model downloaded.",
        }
    capability = backend.capability()
    if capability.get("modelStatus") != "APPROVED":
        return {
            "status": "BLOCKED_MODEL_FILES_OR_CONFIGURATION",
            "localHardwareObserved": True,
            "modelHashVerified": False,
            "schedulerViable": False,
            "reason": capability.get("statusReason", "Model files not installed"),
        }
    try:
        observed = sha256_directory(backend.checkpoint)
    except (OSError, ValueError) as exc:
        return {
            "status": "BLOCKED_CHECKPOINT_UNREADABLE",
            "localHardwareObserved": True,
            "modelHashVerified": False,
            "schedulerViable": False,
            "reason": str(exc),
        }
    if observed != backend.expected_model_hash:
        return {
            "status": "BLOCKED_MODEL_HASH_MISMATCH",
            "localHardwareObserved": True,
            "modelHashVerified": False,
            "schedulerViable": False,
            "reason": "Checkpoint bytes do not match the operator-pinned SHA-256 hash.",
        }
    decision = Scheduler().choose_for_node(plan["shots"][0], hardware, [capability])
    return {
        "status": "OPERATOR_REVIEW_REQUIRED" if decision.viable else "BLOCKED_HARDWARE_OR_MODEL_PROFILE",
        "localHardwareObserved": True,
        "modelHashVerified": True,
        "schedulerViable": decision.viable,
        "schedulerDecision": decision.as_dict(),
        "reason": (
            "Pinned checkpoint and observed node profile satisfy declared scheduler limits; "
            "model license, project rights, human authorization and actual execution remain separate."
        ) if decision.viable else decision.reason,
        "modelLicenseReviewed": False,
        "humanProductionApprovalGranted": False,
    }


def read_pilot_file(path: str | Path) -> dict[str, Any]:
    target = Path(path)
    if not target.is_file() or target.stat().st_size > MAX_SOURCE_BYTES:
        raise ReelIntakeError("Pilot file missing or exceeds 128 KiB")
    try:
        with target.open("r", encoding="utf-8-sig") as handle:
            value = json.load(handle, object_pairs_hook=_duplicate_key_guard)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ReelIntakeError("Invalid UTF-8 pilot JSON") from exc
    if not isinstance(value, dict):
        raise ReelIntakeError("Pilot must be an object")
    return value


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m cineswarm.reel_shot_one",
        description="OFFLINE REEL pilot Shot 001 Wan2.1 candidate + optional local readiness. NEVER submits.",
    )
    parser.add_argument("pilot", help="Local REEL preproduction JSON exported in the browser")
    parser.add_argument("--check-local", action="store_true", help="Opt in to local GPU / pinned checkpoint inspection")
    parser.add_argument("--out", help="Write only a new candidate envelope JSON; existing files never overwritten")
    args = parser.parse_args(argv)
    try:
        candidate = create_first_shot_candidate(read_pilot_file(args.pilot))
        candidate["readiness"] = (
            inspect_local_readiness(candidate["nativeCandidatePlan"], data_root=Path.cwd())
            if args.check_local else {
                "status": "NOT_CHECKED",
                "localHardwareObserved": False,
                "modelHashVerified": False,
                "schedulerViable": False,
                "reason": "Run --check-local on an authorized local workstation for observed readiness.",
            }
        )
        output = json.dumps(candidate, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
        if args.out:
            dest = Path(args.out)
            if dest.resolve() == Path(args.pilot).resolve():
                raise ReelIntakeError("Output must never overwrite pilot source")
            with dest.open("x", encoding="utf-8") as handle:
                handle.write(output)
            print(json.dumps({
                "status": candidate["status"], "readiness": candidate["readiness"]["status"],
                "output": str(dest), "sourceHash": candidate["sourceHash"],
                "executionTriggered": False,
            }, sort_keys=True))
        else:
            print(output, end="")
        return 0
    except (ReelIntakeError, ValueError, OSError) as exc:
        print(json.dumps({"error": {
            "code": "REEL_P001_PREFLIGHT_DENIED", "message": str(exc),
        }}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
