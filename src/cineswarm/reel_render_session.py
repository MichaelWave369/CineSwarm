"""One-shot REEL P001 operator console, local-first and explicit approval.

Default is INSPECTION ONLY: the 74-second pilot packet is validated and a
source-bound 8-second Wan2.1 native plan hash is printed. No network or job.

Only --render with *three distinct explicit human flags* starts an isolated
loopback coordinator, submits one native job and runs one native node task.
A successful REAL render produces a content-addressed native/master MP4 and
fresh exact-byte CineSwarm evidence JSON, all in a persistent new folder.

python -m cineswarm.reel_render_session reel-p001-preproduction.json
python -m cineswarm.reel_render_session reel-p001-preproduction.json --check-local
python -m cineswarm.reel_render_session reel-p001-preproduction.json \
  --render --model-license-reviewed --approve-local-gpu \
  --confirm-plan-sha <EXACT_64_HEX> --session-dir <NEW_DIRECTORY>

This module neither downloads Wan weights nor bypasses licensing, installs
packages, reaches the Internet, or authorizes RCTV publication.
"""
from __future__ import annotations

import argparse
import json
import secrets
import shutil
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Sequence

from .api import CineRequestHandler
from .auth import RequestAuthenticator
from .canonical import sha256_json
from .client import CoordinatorClient
from .config import Settings
from .errors import CineSwarmError
from .node import NodeAgent
from .paths import StorageLayout
from .reel_media_evidence import build_media_evidence
from .reel_shot_one import (
    create_first_shot_candidate, inspect_local_readiness, read_pilot_file,
)
from .store import CineStore

DEFAULT_TIMEOUT_SECONDS = 4 * 60 * 60
EXACT_HASH = frozenset("0123456789abcdef")


class LocalSessionDenied(ValueError):
    pass


def _ensure(condition: bool, message: str) -> None:
    if not condition:
        raise LocalSessionDenied(message)


def _new_path(path: Path, *, input_path: Path) -> Path:
    final = path.expanduser().resolve()
    source = input_path.expanduser().resolve(strict=True)
    _ensure(final != source, "Session directory must not replace the input packet")
    _ensure(not final.exists(), "Session directory already exists; choose a new folder (never overwrite a render)")
    _ensure(final != final.parent, "Root directory cannot be used as a session")
    return final


def _safe_binaries(which=shutil.which) -> None:
    for binary in ("ffmpeg", "ffprobe"):
        _ensure(which(binary) is not None, f"Required local executable missing from PATH: {binary}")


def describe_session(pilot: dict[str, Any], readiness: dict[str, Any] | None = None) -> dict[str, Any]:
    """No side effects. A plan hash is a confirmation target, not an approval."""
    candidate = create_first_shot_candidate(pilot)
    return {
        "schema": "REEL_P001_LOCAL_RENDER_SESSION_V1",
        "mode": "INSPECT_ONLY",
        "sourceHash": candidate["sourceHash"],
        "planHash": candidate["nativePlanHash"],
        "shotId": "reel-p001-s01",
        "modelBackend": candidate["modelBackend"],
        "native": {"width": 832, "height": 480, "fps": 16},
        "delivery": {"width": 1280, "height": 720, "fps": 24, "native720p": False},
        "readiness": readiness if readiness is not None else {
            "status": "NOT_CHECKED", "reason": "Use --check-local for real local resources and pinned checkpoint inspection",
            "modelHashVerified": False, "schedulerViable": False,
        },
        "gpuModelExecuted": False,
        "modelDownloaded": False,
        "publicReleaseAuthorized": False,
        "nextStep": (
            "Only run --render after personally reviewing the model license, approving "
            "this exact creative shot and GPU usage, and confirming the printed full "
            "planHash with --confirm-plan-sha. The render will require a new session directory."
        ),
    }


def approve_render(
    candidate: dict[str, Any], *,
    model_license_reviewed: bool, approve_local_gpu: bool, confirm_plan_sha: str | None,
    readiness: dict[str, Any],
) -> dict[str, Any]:
    """Gates are checked before any service/job/worker is started."""
    _ensure(model_license_reviewed, "Explicit --model-license-reviewed is required")
    _ensure(approve_local_gpu, "Explicit --approve-local-gpu is required")
    digest = candidate["nativePlanHash"]
    _ensure(isinstance(confirm_plan_sha, str)
            and len(confirm_plan_sha) == 64
            and set(confirm_plan_sha) <= EXACT_HASH
            and secrets.compare_digest(confirm_plan_sha, digest),
            "Full --confirm-plan-sha does not match the current source-derived native plan")
    _ensure(readiness.get("status") == "OPERATOR_REVIEW_REQUIRED"
            and readiness.get("modelHashVerified") is True
            and readiness.get("schedulerViable") is True,
            "Local Wan2.1 checkpoint hash or declared GPU/RAM/disk is blocked; no job submitted")
    plan = candidate["nativeCandidatePlan"]
    _ensure(sha256_json(plan) == digest,
            "Current native candidate bytes no longer match the inspected hash")
    _ensure(plan["shots"][0]["backendPreference"] == ["wan21-t2v-1.3b"]
            and plan["shots"][0]["shotId"] == "reel-p001-s01"
            and plan["shots"][0]["publicReleaseAuthorized"] is False,
            "Candidate is not the bounded, unpublished first-shot Wan 2.1 render")
    return plan


def _loopback_server(settings: Settings, store: CineStore) -> ThreadingHTTPServer:
    """Ephemeral IPv4 loopback port and per-run HMAC; no public LAN listener."""
    handler = type("REELP001PrivateHandler", (CineRequestHandler,), {
        "store": store,
        "settings": settings,
        "authenticator": RequestAuthenticator(settings.shared_secret),
    })
    return ThreadingHTTPServer(("127.0.0.1", 0), handler)


def run_one_local_job(plan: dict[str, Any], session_dir: Path,
                      *, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    """Exactly one preapproved first-shot job, no retry loop or automatic release.

    The session directory is intentionally durable: SQLite, receipts, native
    and master media MUST survive so the human can review and relink them.
    """
    _ensure(60 <= timeout_seconds <= 8 * 60 * 60, "Render timeout must be 60 seconds to 8 hours")
    _ensure(not session_dir.exists(), "This session directory already exists")
    session_dir.mkdir(parents=True, exist_ok=False)
    data_root = session_dir / "coordinator"
    node_root = session_dir / "node"
    secret = secrets.token_urlsafe(32)
    settings = Settings(
        data_root=data_root, host="127.0.0.1", port=0,
        shared_secret=secret, lease_seconds=timeout_seconds + 600,
        process_timeout_seconds=timeout_seconds,
    )
    layout = StorageLayout(data_root)
    store = CineStore(layout, lease_seconds=settings.lease_seconds)
    server = _loopback_server(settings, store)
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.1},
        name="reel-p001-local-coordinator", daemon=True,
    )
    thread.start()
    try:
        port = server.server_address[1]
        client = CoordinatorClient(f"http://127.0.0.1:{port}", secret, timeout=120)
        agent = NodeAgent(
            node_id="REEL-P001-LOCAL", coordinator=client,
            data_root=node_root, timeout_seconds=timeout_seconds,
            enable_test_backend=False,
        )
        # Register BEFORE submitting: no other unknown queued task can be
        # imported because this session has its own brand-new database.
        agent.register()
        submission = client.request_json("POST", "/v1/jobs", plan)
        _ensure(submission.get("idempotentReplay") is False
                and submission.get("planHash") == sha256_json(plan)
                and submission.get("state") == "QUEUED",
                "Native job registration did not confirm a new first-shot task")
        worked = agent.run_once()
        _ensure(worked, "Native job was not claimed; inspect local coordinator records for scheduler failure")
        state = client.request_json("GET", "/v1/status")
        _ensure(state.get("receiptChain", {}).get("valid") is True,
                "CineSwarm receipt-chain verification failed after render")
        master = [
            item for item in state.get("reviewQueue", [])
            if item.get("jobId") == submission["jobId"]
            and item.get("shotId") == "reel-p001-s01"
            and item.get("role") == "master"
        ]
        _ensure(len(master) == 1,
                "Exactly one genuine, locally stored master is required for evidence export")
        evidence = build_media_evidence(data_root, master[0]["artifactId"])
        _ensure(evidence["review"]["decision"] == "PENDING_REVIEW"
                and evidence["authority"]["publishingAuthorized"] is False,
                "The local render must remain awaiting independent human QC and publisher authorization")
        evidence_file = session_dir / "reel-p001-s01-evidence.json"
        with evidence_file.open("x", encoding="utf-8") as output:
            json.dump(evidence, output, indent=2, ensure_ascii=False, sort_keys=True)
            output.write("\n")
        master_path = layout.resolve_relative(master[0]["relativePath"])
        _ensure(master_path.is_file(), "Master media missing after evidence export")
        return {
            "schema": "REEL_P001_LOCAL_RENDER_RESULT_V1",
            "status": "REAL_MEDIA_RECORDED_AWAITING_HUMAN_QC",
            "jobId": submission["jobId"],
            "artifactId": master[0]["artifactId"],
            "sha256": evidence["master"]["sha256"],
            "masterMp4Path": str(master_path),
            "evidenceJsonPath": str(evidence_file),
            "sessionDir": str(session_dir),
            "nativeResolution": [832, 480],
            "scaledDeliveryResolution": [1280, 720],
            "modelBackend": "wan21-t2v-1.3b",
            "publicReleaseAuthorized": False,
            "nextStep": (
                "Human review the actual MP4 and exact hash. Import the master "
                "MP4 and unsigned evidence JSON into REEL or ParaCut; neither "
                "QC ACCEPT nor an MP4 hash grants release rights."
            ),
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m cineswarm.reel_render_session",
        description="REEL P001 local Wan 2.1: default inspection; one authorized GPU render only with explicit approvals",
    )
    parser.add_argument("pilot", help="Exact preproduction JSON exported by REEL")
    parser.add_argument("--check-local", action="store_true", help="Inspect local pinned checkpoint and available hardware; no execution")
    parser.add_argument("--render", action="store_true", help="EXPLICIT: schedule exactly one real local Wan2.1 shot")
    parser.add_argument("--model-license-reviewed", action="store_true",
                        help="You personally reviewed official upstream model/source license and intended use")
    parser.add_argument("--approve-local-gpu", action="store_true",
                        help="Authorize GPU workload and expected local compute resource usage")
    parser.add_argument("--confirm-plan-sha", help="Copy complete 64-character planHash from inspect output")
    parser.add_argument("--session-dir", help="NEW persistent local directory; never overwritten")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)
    try:
        _ensure(not args.model_license_reviewed and not args.approve_local_gpu
                and args.confirm_plan_sha is None and args.session_dir is None
                if not args.render else True,
                "Render approval flags and session directory are valid only together with --render")
        source = read_pilot_file(args.pilot)
        candidate = create_first_shot_candidate(source)
        if not args.render:
            readiness = inspect_local_readiness(
                candidate["nativeCandidatePlan"], data_root=Path.cwd()
            ) if args.check_local else None
            print(json.dumps(describe_session(source, readiness), ensure_ascii=False, sort_keys=True, indent=2))
            return 0
        _ensure(args.session_dir is not None and args.session_dir.strip(),
                "A new --session-dir directory is required for durable master and evidence files")
        _ensure(60 <= args.timeout_seconds <= 8 * 60 * 60,
                "Requested GPU timeout is outside permitted bounds")
        folder = _new_path(Path(args.session_dir), input_path=Path(args.pilot))
        # Require full operator approvals before hashing gigabytes or probing
        # local files; render permission is never inferred from a JSON packet.
        _ensure(args.model_license_reviewed and args.approve_local_gpu
                and isinstance(args.confirm_plan_sha, str)
                and len(args.confirm_plan_sha) == 64
                and set(args.confirm_plan_sha) <= EXACT_HASH
                and secrets.compare_digest(args.confirm_plan_sha, candidate["nativePlanHash"]),
                "Render denied: review license, approve GPU and confirm exact current plan hash")
        _safe_binaries()
        readiness = inspect_local_readiness(
            candidate["nativeCandidatePlan"], data_root=folder.parent,
        )
        plan = approve_render(
            candidate,
            model_license_reviewed=args.model_license_reviewed,
            approve_local_gpu=args.approve_local_gpu,
            confirm_plan_sha=args.confirm_plan_sha,
            readiness=readiness,
        )
        print(json.dumps({
            "status": "STARTING_SINGLE_AUTHORIZED_LOCAL_GPU_JOB",
            "shotId": "reel-p001-s01", "backend": "wan21-t2v-1.3b",
            "sessionDir": str(folder), "planHash": candidate["nativePlanHash"],
            "publicReleaseAuthorized": False,
        }, sort_keys=True), flush=True)
        result = run_one_local_job(plan, folder, timeout_seconds=args.timeout_seconds)
        print(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2), flush=True)
        return 0
    except (LocalSessionDenied, CineSwarmError, ValueError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({
            "error": {
                "code": "REEL_LOCAL_RENDER_DENIED_OR_FAILED",
                "message": str(exc),
                "renderSuccessConfirmed": False,
                "publicationAuthorized": False,
            }
        }, ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
