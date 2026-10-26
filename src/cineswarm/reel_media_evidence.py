"""Read-only evidence export for an ACTUAL CineSwarm REEL-P001-S01 master MP4.

No coordinator requests, generation, media copies, model loading or publishing.
Reads the existing CineSwarm SQLite database in mode=ro, verifies its entire
hash-chained receipt sequence, then re-hashes and ffprobes the existing
native and delivery MP4s. Output is an *unsigned local evidence sidecar*.

python -m cineswarm.reel_media_evidence --data-root ./parallax-cineswarm-data \
  --artifact-id <real-master-artifact-uuid> --out p001-shot-one-evidence.json
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import quote

from .canonical import sha256_bytes, sha256_file, sha256_json
from .media import probe_media
from .paths import StorageLayout
from .schemas import validate_production_plan

SCHEMA = "REEL_P001_REAL_MEDIA_EVIDENCE_V1"
HEX = re.compile(r"^[0-9a-f]{64}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
EXPECTED_BACKEND = "wan21-t2v-1.3b"
EXPECTED_MODEL = "Wan-AI/Wan2.1-T2V-1.3B"


class MediaEvidenceDenied(ValueError):
    """A real artifact could not be independently verified."""


def _need(test: bool, reason: str) -> None:
    if not test:
        raise MediaEvidenceDenied(reason)


def _video(probe: dict[str, Any], width: int, height: int, fps: float, label: str) -> dict[str, Any]:
    _need(probe.get("probeStatus") == "PASSED", f"{label}: ffprobe was not successful")
    streams = [s for s in probe.get("streams", [])
               if isinstance(s, dict) and s.get("codec_type") == "video"]
    _need(len(streams) > 0, f"{label}: no decoded video stream metadata")
    stream = streams[0]
    _need(stream.get("width") == width and stream.get("height") == height,
          f"{label}: unexpected video dimensions")
    value = stream.get("avg_frame_rate", "")
    try:
        numerator, _, denominator = value.partition("/")
        observed = float(numerator) / float(denominator) if denominator else float(numerator)
    except (ValueError, TypeError, ZeroDivisionError) as error:
        raise MediaEvidenceDenied(f"{label}: invalid frame-rate metadata") from error
    _need(abs(observed-fps) < 0.2, f"{label}: unexpected video frame rate")
    try:
        duration = float(probe.get("format", {}).get("duration", 0))
    except (ValueError, TypeError) as error:
        raise MediaEvidenceDenied(f"{label}: invalid duration") from error
    _need(0 < duration <= 30, f"{label}: empty or implausibly long first-shot artifact")
    return {"width": width, "height": height, "fps": fps, "durationSeconds": round(duration, 3)}


def _verify_receipt_chain(connection: sqlite3.Connection) -> tuple[list[dict[str, Any]], str]:
    rows = connection.execute("SELECT * FROM receipts ORDER BY sequence").fetchall()
    previous = "GENESIS"
    checked: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 1):
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError as error:
            raise MediaEvidenceDenied("Corrupt receipt JSON; chain not trustworthy") from error
        core = {
            "sequence": int(row["sequence"]), "receiptId": row["receipt_id"],
            "eventType": row["event_type"], "subjectType": row["subject_type"],
            "subjectId": row["subject_id"], "payloadHash": row["payload_hash"],
            "previousHash": row["previous_hash"], "createdAt": row["created_at"],
        }
        _need(int(row["sequence"]) == index and row["previous_hash"] == previous
              and sha256_bytes(row["payload_json"].encode("utf-8")) == row["payload_hash"]
              and sha256_json(core) == row["event_hash"],
              f"Receipt chain verification failed at sequence {index}")
        checked.append({**core, "payload": payload, "eventHash": row["event_hash"]})
        previous = row["event_hash"]
    _need(len(rows) > 0, "No CineSwarm receipts exist")
    return checked, previous


def _verified_media(layout: StorageLayout, artifact: sqlite3.Row,
                    width: int, height: int, fps: float) -> dict[str, Any]:
    _need(artifact["media_type"] == "video/mp4", "Artifact is not a real MP4 video")
    relative_path = artifact["relative_path"]
    _need(isinstance(relative_path, str) and relative_path.startswith("assets/generated/sha256/"),
          "Only locally stored content-addressed generated media is eligible")
    path = layout.resolve_relative(relative_path)
    _need(path.is_file() and path.stat().st_size > 0, "Artifact MP4 missing from local disk")
    _need(path.stat().st_size == artifact["size_bytes"], "Local MP4 size disagrees with database")
    _need(sha256_file(path) == artifact["sha256"], "MP4 bytes disagree with recorded SHA-256")
    info = _video(probe_media(path), width, height, fps, artifact["artifact_role"])
    return {
        "artifactId": artifact["id"],
        "sha256": artifact["sha256"],
        "sizeBytes": int(artifact["size_bytes"]),
        "role": artifact["artifact_role"],
        **info,
    }


def build_media_evidence(data_root: Path, artifact_id: str) -> dict[str, Any]:
    _need(bool(UUID.fullmatch(artifact_id)), "A real CineSwarm artifact UUID is required")
    layout = StorageLayout(data_root)
    db_path = layout.database_path
    _need(db_path.is_file(), "CineSwarm database not found; no render is recorded")
    uri = "file:" + quote(str(db_path), safe="/:") + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        receipts, receipt_head = _verify_receipt_chain(connection)
        artifact = connection.execute(
            "SELECT * FROM artifacts WHERE id=?", (artifact_id,)
        ).fetchone()
        _need(artifact is not None, "Artifact not found in local CineSwarm database")
        _need(artifact["artifact_role"] == "master", "Select the master MP4 artifact, not a native/test fixture")
        _need(artifact["backend_id"] == EXPECTED_BACKEND
              and artifact["model_id"] == EXPECTED_MODEL
              and isinstance(artifact["model_hash"], str)
              and bool(HEX.fullmatch(artifact["model_hash"])),
              "Only the real pinned Wan 2.1 T2V 1.3B model backend is eligible")
        _need(artifact["external_provider_called"] == 0
              and float(artifact["provider_fee_usd"]) == 0.0
              and artifact["public_release_authorized"] == 0,
              "External provider or release claims are incompatible with this evidence gate")
        _need(artifact["shot_id"] == "reel-p001-s01", "This is not REEL Pilot 001 Shot 001")
        _need(artifact["review_status"] in {"PENDING_REVIEW", "ACCEPT", "REJECT", "REVISION_REQUESTED"},
              "Master must have a real human-review state")

        task = connection.execute("SELECT * FROM tasks WHERE id=?", (artifact["task_id"],)).fetchone()
        job = connection.execute("SELECT * FROM jobs WHERE id=?", (artifact["job_id"],)).fetchone()
        _need(task is not None and job is not None, "Missing native job or task lineage")
        plan = validate_production_plan(json.loads(job["plan_json"]))
        _need(sha256_json(plan) == job["plan_hash"], "Production plan hash mismatch")
        lineage = plan["lineage"]
        _need(lineage["sourceSystem"] == "REEL_P001"
              and isinstance(lineage["sourceHash"], str)
              and bool(HEX.fullmatch(lineage["sourceHash"]))
              and plan["projectId"] == "reel-p001-"+lineage["sourceHash"][:12]
              and plan["idempotencyKey"] == "p001-s01-wan21-"+lineage["sourceHash"][:32],
              "This job is not linked to the exact REEL P001 storyboard export")
        _need(len(plan["shots"]) == 1
              and plan["shots"][0]["shotId"] == artifact["shot_id"]
              and plan["shots"][0]["durationSeconds"] == 8
              and plan["shots"][0]["backendPreference"] == [EXPECTED_BACKEND]
              and plan["shots"][0]["publicReleaseAuthorized"] is False,
              "Wrong native job shot, backend, length or release permissions")
        _need(task["job_id"] == job["id"] and task["shot_id"] == artifact["shot_id"]
              and task["state"] == "COMPLETED"
              and job["state"] == "COMPLETED",
              "Native render task/job is not completed")
        _need(artifact["backend_id"] == task["backend_id"],
              "Real scheduled backend differs from MP4 record")

        native = connection.execute(
            "SELECT * FROM artifacts WHERE task_id=? AND artifact_role='native' AND media_type='video/mp4'",
            (task["id"],)
        ).fetchall()
        _need(len(native) == 1, "Expected exactly one separately preserved real native MP4")
        native_row = native[0]
        _need(artifact["source_artifact_hash"] == native_row["sha256"],
              "Scaled master does not reference this native video's exact SHA-256")
        _need(native_row["backend_id"] == EXPECTED_BACKEND and native_row["shot_id"] == artifact["shot_id"]
              and native_row["public_release_authorized"] == 0,
              "Native artifact role/identity or release state mismatch")
        master_info = _verified_media(layout, artifact, 1280, 720, 24)
        native_info = _verified_media(layout, native_row, 832, 480, 16)

        def has_event(event_type: str, subject_type: str, subject_id: str, **values: Any) -> bool:
            return any(
                entry["eventType"] == event_type
                and entry["subjectType"] == subject_type
                and entry["subjectId"] == subject_id
                and isinstance(entry["payload"], dict)
                and all(entry["payload"].get(key) == value for key, value in values.items())
                for entry in receipts
            )
        _need(has_event("JOB_ACCEPTED", "job", job["id"], planHash=job["plan_hash"])
              and has_event("SHOT_COMPILED", "task", task["id"], shotId=artifact["shot_id"])
              and has_event("MEDIA_HASHED", "artifact", artifact["id"], sha256=artifact["sha256"])
              and has_event("MEDIA_HASHED", "artifact", native_row["id"], sha256=native_row["sha256"])
              and has_event("QC_COMPLETED", "artifact", artifact["id"], probeStatus="PASSED")
              and has_event("RENDER_COMPLETED", "task", task["id"], artifactHash=artifact["sha256"]),
              "Required hash-chained native execution/asset/QC receipts are absent")

        review = None
        if artifact["review_status"] != "PENDING_REVIEW":
            reviews = connection.execute(
                "SELECT * FROM reviews WHERE artifact_id=? ORDER BY created_at DESC",
                (artifact["id"],)
            ).fetchall()
            _need(len(reviews) == 1 and reviews[0]["decision"] == artifact["review_status"]
                  and reviews[0]["artifact_hash"] == artifact["sha256"],
                  "Human review status lacks matching exact-hash decision")
            event_type = {
                "ACCEPT": "HUMAN_ACCEPTED", "REJECT": "HUMAN_REJECTED",
                "REVISION_REQUESTED": "REVISION_REQUESTED",
            }[artifact["review_status"]]
            _need(has_event(event_type, "artifact", artifact["id"], artifactHash=artifact["sha256"],
                            reviewId=reviews[0]["id"], publicReleaseAuthorized=False),
                  "Exact-hash human review receipt is missing")
            review = {"decision": reviews[0]["decision"], "exactHashDecisionRecorded": True}
        else:
            review = {"decision": "PENDING_REVIEW", "exactHashDecisionRecorded": False}

        return {
            "schema": SCHEMA,
            "classification": "LOCAL_UNSIGNED_MEDIA_EVIDENCE_NOT_PUBLIC_RELEASE",
            "shotId": "reel-p001-s01",
            "lineage": {
                "sourceHash": lineage["sourceHash"], "planHash": job["plan_hash"],
                "jobId": job["id"], "taskId": task["id"],
            },
            "model": {
                "backendId": EXPECTED_BACKEND, "modelId": EXPECTED_MODEL,
                "recordedCheckpointHash": artifact["model_hash"],
                "runtimeCheckpointRecheckedOnExport": False,
            },
            "master": master_info,
            "native": native_info,
            "review": review,
            "integrity": {
                "localReceiptChainVerified": True,
                "receiptCount": len(receipts),
                "receiptHeadHash": receipt_head,
                "masterMediaBytesRehashed": True,
                "nativeMediaBytesRehashed": True,
                "bothMediaProbesPassed": True,
                "signaturePresent": False,
            },
            "authority": {
                "sourceRightsVerified": False, "musicRightsVerified": False,
                "voiceConsentVerified": False, "publishingAuthorized": False,
                "rctvChannelAssigned": False,
            },
            "notice": (
                "Read-only export from a local CineSwarm database and freshly rehashed MP4s. "
                "This editable unsigned JSON does NOT by itself authenticate the device, "
                "licenses, creator rights, consent, editorial truth or public publication. "
                "Human ACCEPT confirms only exact-hash QC and never grants release."
            ),
        }
    finally:
        connection.close()


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m cineswarm.reel_media_evidence",
        description="READ-ONLY: export genuine REEL P001 S01 local media evidence; never render or publish",
    )
    parser.add_argument("--data-root", required=True, help="Existing CineSwarm node/coordinator data root")
    parser.add_argument("--artifact-id", required=True, help="Actual master MP4 artifact UUID from cine status")
    parser.add_argument("--out", help="Write to NEW evidence sidecar path, without overwrite")
    args = parser.parse_args(argv)
    try:
        evidence = build_media_evidence(Path(args.data_root).expanduser().resolve(), args.artifact_id)
        payload = json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False)+"\n"
        if args.out:
            target = Path(args.out)
            with target.open("x", encoding="utf-8") as handle:
                handle.write(payload)
            print(json.dumps({"state": "VERIFIED_LOCAL_MEDIA_BYTES_UNPUBLISHED",
                              "evidenceFile": str(target), "sha256": evidence["master"]["sha256"],
                              "publicReleaseAuthorized": False}, sort_keys=True))
        else:
            print(payload, end="")
        return 0
    except (MediaEvidenceDenied, sqlite3.Error, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": {"code": "REEL_MEDIA_EVIDENCE_DENIED", "message": str(error)}}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
