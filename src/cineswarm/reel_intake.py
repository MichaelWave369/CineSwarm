"""Fail-closed, offline REEL pitch receiver for native CineSwarm TEST fixtures.

The REEL browser pitch is an untrusted creative proposal. This module validates
its exact v1 authority-denied shape and emits a deterministic, *test-only*
ProductionPlan preview. It never posts to the coordinator, checks model
availability, performs inference, renders media, or grants release permission.

Usage: python -m cineswarm.reel_intake pitch.json --out rehearsal.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from .canonical import sha256_json
from .schemas import validate_production_plan

INPUT_LIMIT_BYTES = 64 * 1024
PITCH_SCHEMA = "REEL_NETWORK_PITCH_PACKET_V1"
PREVIEW_SCHEMA = "REEL_CINESWARM_DRYRUN_PREVIEW_V1"
OFFICE_IDS = (
    "intake", "rights", "development", "writers", "research", "direction",
    "production", "editing", "quality", "programming", "release",
)
OFFICE_NAMES = (
    "Intake & World Packets", "Rights & Provenance",
    "Development & Showrunner", "Writers’ Room", "Research & Claim Audit",
    "Visual & Audio Direction", "CineSwarm Production",
    "ParaCut & WaveForge Post", "Quality & Continuity",
    "REEL Programming Desk", "Human Release Gate",
)
OFFICE_OUTPUTS = (
    "Format brief, audience and source-world notes",
    "Human-reviewed licenses, consent and attribution plan",
    "Season arc, continuity bible and episode outline",
    "Script, scene beats, dialogue and revision notes",
    "Citations, uncertainty, claim posture and correction notes",
    "Shot board, visual language, voice and music direction",
    "Proposed shot plan for a separately approved CineSwarm runtime",
    "Edit package, native verified RenderPlan and optional release-reference chain",
    "Media QC, provenance checks and human acceptance record",
    "Proposed show slot, attribution and audience labeling",
    "Human publisher authorization, public content receipt and approved distribution",
)
FORMAT_IDS = frozenset({
    "series", "film", "game-review", "music", "podcast",
    "documentary", "comedy", "experimental",
})
CLAIM_CLASSES = frozenset({"fiction", "opinion", "documentary", "educational", "symbolic"})
TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


class ReelIntakeError(ValueError):
    """An untrusted REEL pitch is rejected before any native plan creation."""


def _object(value: Any, name: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ReelIntakeError(f"{name}: expected exact v1 object keys")
    return value


def _text(value: Any, name: str, maximum: int, *, optional: bool = False) -> str:
    if not isinstance(value, str) or len(value) > maximum or value != value.strip() \
            or any(ord(c) < 32 or ord(c) == 127 for c in value) \
            or (not optional and not value):
        raise ReelIntakeError(f"{name}: invalid or unbounded text")
    return value


def _equal(value: Any, expected: Any, name: str) -> None:
    # Prevent bool and int from comparing equal and stop embellished object fields.
    if type(value) is not type(expected) or value != expected:
        raise ReelIntakeError(f"{name}: untrusted authority/state value")


def _duplicate_key_guard(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ReelIntakeError("Duplicate JSON key is not allowed")
        result[key] = value
    return result


def read_pitch_file(path: str | Path) -> dict[str, Any]:
    target = Path(path)
    # Never contact the REEL website, arbitrary hosts or a CineSwarm coordinator.
    if not target.is_file() or target.stat().st_size > INPUT_LIMIT_BYTES:
        raise ReelIntakeError("REEL pitch file not found or exceeds 64 KiB")
    try:
        data = json.loads(
            target.read_text(encoding="utf-8-sig"),
            object_pairs_hook=_duplicate_key_guard,
        )
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ReelIntakeError("Invalid UTF-8 JSON pitch") from error
    if not isinstance(data, dict):
        raise ReelIntakeError("REEL pitch root must be an object")
    return data


def validate_reel_pitch(source: Any) -> dict[str, Any]:
    root = _object(source, "root", {
        "schema", "provenance", "network", "hostProject", "originPipeline",
        "createdUtc", "pitch", "workOrders", "review", "authority", "nextStep",
    })
    for field, expected in {
        "schema": PITCH_SCHEMA,
        "provenance": "CREATOR_AUTHORED_UNREVIEWED_DRAFT",
        "network": "REEL",
        "hostProject": "ReelCommons",
        "originPipeline": "Parallax Creative Stack / CineSwarm",
    }.items():
        _equal(root[field], expected, field)
    date = _text(root["createdUtc"], "createdUtc", 24)
    if not TIMESTAMP.fullmatch(date):
        raise ReelIntakeError("createdUtc: expected explicit UTC millisecond timestamp")
    try:
        datetime.fromisoformat(date.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReelIntakeError("createdUtc: invalid calendar time") from error

    pitch = _object(root["pitch"], "pitch", {
        "title", "concept", "show", "creatorCredit", "format",
        "claimClass", "sourceWorld",
    })
    for key, limit in (
        ("title", 120), ("concept", 1200), ("show", 100),
        ("creatorCredit", 100), ("sourceWorld", 160),
    ):
        _text(pitch[key], f"pitch.{key}", limit, optional=(key == "sourceWorld"))
    if not isinstance(pitch["format"], str) or not isinstance(pitch["claimClass"], str) \
            or pitch["format"] not in FORMAT_IDS or pitch["claimClass"] not in CLAIM_CLASSES:
        raise ReelIntakeError("pitch: unsupported format or claim classification")

    work_orders = root["workOrders"]
    if not isinstance(work_orders, list) or len(work_orders) != len(OFFICE_IDS):
        raise ReelIntakeError("workOrders: expected the frozen eleven-office roster")
    for index, (order, office_id, name, output) in enumerate(
        zip(work_orders, OFFICE_IDS, OFFICE_NAMES, OFFICE_OUTPUTS)
    ):
        _object(order, f"workOrders[{index}]", {
            "officeId", "office", "proposedOutput", "state", "executionAuthorized",
        })
        for field, expected in {
            "officeId": office_id, "office": name, "proposedOutput": output,
            "state": "not_started", "executionAuthorized": False,
        }.items():
            _equal(order[field], expected, f"workOrders[{index}].{field}")

    review = _object(root["review"], "review", {
        "creatorRights", "sourceLicense", "likenessConsent", "claims",
        "humanAccepted", "humanReleaseAuthorized", "publicationStatus",
    })
    for field, expected in {
        "creatorRights": "unverified", "sourceLicense": "unverified",
        "likenessConsent": "unverified", "claims": "not_audited",
        "humanAccepted": False, "humanReleaseAuthorized": False,
        "publicationStatus": "not_published",
    }.items():
        _equal(review[field], expected, f"review.{field}")

    authority = _object(root["authority"], "authority", {
        "localPlanningOnly", "cinemaProductionTriggered", "videoRendered",
        "autoImport", "broadcastAuthorized", "networkPublishingAuthorized",
        "knownChannelNumber",
    })
    for field, expected in {
        "localPlanningOnly": True, "cinemaProductionTriggered": False,
        "videoRendered": False, "autoImport": False,
        "broadcastAuthorized": False, "networkPublishingAuthorized": False,
        "knownChannelNumber": None,
    }.items():
        _equal(authority[field], expected, f"authority.{field}")

    _text(root["nextStep"], "nextStep", 1200)
    return root


def preview_reel_pitch(source: Any) -> dict[str, Any]:
    """Independently validate a browser pitch; emit ONE synthetic test shot.

    The preview plan uses only the test backend and acceptanceEligible=False.
    Deliberately NOT a production-ready storyboard or render authorization.
    """
    packet = validate_reel_pitch(source)
    digest = sha256_json(packet)
    pitch = packet["pitch"]
    plan = validate_production_plan({
        "schemaVersion": "production-plan/v1",
        "projectId": "reel-dryrun-" + digest[:12],
        "idempotencyKey": "reel-dryrun-" + digest[:32],
        "lineage": {"sourceSystem": "REEL_DRAFT", "sourceHash": digest},
        "shots": [{
            "shotId": "reel-rehearsal-001",
            "prompt": (
                "TEST FIXTURE ONLY; no produced or licensed media. "
                "Original REEL creator concept, pending human rights and editorial review: "
                + pitch["concept"]
            ),
            "durationSeconds": 1,
            "delivery": {
                "width": 1280, "height": 720, "fps": 24, "container": "mp4",
            },
            "backendPreference": ["deterministic-test"],
            "conditioning": [],
            "seed": 369,
            "acceptanceEligible": False,
            "publicReleaseAuthorized": False,
        }],
    })
    return {
        "schema": PREVIEW_SCHEMA,
        "sourceSchema": PITCH_SCHEMA,
        "inputHash": digest,
        "outputPlanHash": sha256_json(plan),
        "mode": "LOCAL_DRYRUN_ONLY",
        "status": "VALIDATED_NOT_SUBMITTED",
        "executionTriggered": False,
        "mediaRendered": False,
        "rightsVerified": False,
        "humanReleaseAuthorized": False,
        "publicationAuthorized": False,
        "nativeTestPlan": plan,
        "nextStep": (
            "Rehearsal only. To submit even the deterministic fixture, a human must "
            "separately extract nativeTestPlan and use the CineSwarm CLI with a "
            "local coordinator and explicitly enabled test backend. Real video "
            "requires a separately authored and approved native production plan, "
            "qualified node/model, media QC, rights and human release."
        ),
    }


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m cineswarm.reel_intake",
        description="Validate a REEL pitch and export a native test-only plan preview. NEVER submits jobs.",
    )
    parser.add_argument("pitch", help="Local exported REEL_NETWORK_PITCH_PACKET_V1 JSON path")
    parser.add_argument("--out", help="Explicit new output JSON path, never overwritten")
    args = parser.parse_args(argv)
    try:
        preview = preview_reel_pitch(read_pitch_file(args.pitch))
        output = json.dumps(preview, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.out:
            destination = Path(args.out)
            if destination.resolve() == Path(args.pitch).resolve():
                raise ReelIntakeError("Output must not replace the source pitch")
            with destination.open("x", encoding="utf-8") as handle:
                handle.write(output)
            print(json.dumps({
                "status": preview["status"], "output": str(destination),
                "inputHash": preview["inputHash"], "outputPlanHash": preview["outputPlanHash"],
                "executionTriggered": False,
            }, sort_keys=True))
        else:
            print(output, end="")
        return 0
    except (ReelIntakeError, ValueError, OSError) as error:
        print(json.dumps({"error": {"code": "REEL_INTAKE_DENIED", "message": str(error)}}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
