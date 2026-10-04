from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Sequence

from .api import serve
from .canonical import sha256_directory, sha256_file
from .client import CoordinatorClient
from .config import Settings
from .errors import CineSwarmError
from .hardware import discover_hardware
from .node import NodeAgent
from .paths import StorageLayout
from .store import CineStore


def _print(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2))


def _load_json(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _client(args: argparse.Namespace) -> CoordinatorClient:
    return CoordinatorClient(args.coordinator_url, os.getenv("CINESWARM_SHARED_SECRET"), timeout=args.timeout)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cine", description="Parallax Native CineSwarm Engine")
    sub = parser.add_subparsers(dest="command", required=True)

    coordinator = sub.add_parser("coordinator", help="Run the coordinator service")
    coordinator.add_argument("--host", default=None)
    coordinator.add_argument("--port", type=int, default=None)
    coordinator.add_argument("--data-root", default=None)

    node = sub.add_parser("node", help="Run a CineSwarm Node Agent")
    node.add_argument("--node-id", required=True)
    node.add_argument("--coordinator-url", default="http://127.0.0.1:8765")
    node.add_argument("--data-root", default="./parallax-cineswarm-node")
    node.add_argument("--timeout", type=int, default=4 * 60 * 60)
    node.add_argument("--poll-seconds", type=float, default=5.0)
    node.add_argument("--once", action="store_true")
    node.add_argument("--enable-test-backend", action="store_true", help="Enable non-media orchestration fixture backend")

    doctor = sub.add_parser("doctor", help="Inspect local node hardware without registering")
    doctor.add_argument("--node-id", default="CINESWARM-DOCTOR")
    doctor.add_argument("--data-root", default=".")

    for name in ("submit", "status", "verify-receipts", "register-model"):
        item = sub.add_parser(name)
        item.add_argument("--coordinator-url", default="http://127.0.0.1:8765")
        item.add_argument("--timeout", type=int, default=120)
        if name == "submit":
            item.add_argument("plan")
        elif name == "register-model":
            item.add_argument("manifest")

    review = sub.add_parser("review")
    review.add_argument("artifact_id")
    review.add_argument("decision", choices=["ACCEPT", "REJECT", "REVISION_REQUESTED"])
    review.add_argument("--hash", required=True, dest="artifact_hash")
    review.add_argument("--reviewer", required=True)
    review.add_argument("--reason", action="append", default=[])
    review.add_argument("--notes", default="")
    review.add_argument("--coordinator-url", default="http://127.0.0.1:8765")
    review.add_argument("--timeout", type=int, default=120)

    model_hash = sub.add_parser("model-hash", help="Compute a file or stable directory digest")
    model_hash.add_argument("path")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "coordinator":
            settings = Settings.from_env(host=args.host, port=args.port, data_root=args.data_root)
            store = CineStore(StorageLayout(settings.data_root), lease_seconds=settings.lease_seconds, node_stale_seconds=settings.node_stale_seconds)
            serve(settings, store)
            return 0
        if args.command == "node":
            agent = NodeAgent(
                node_id=args.node_id,
                coordinator=_client(args),
                data_root=Path(args.data_root),
                timeout_seconds=args.timeout,
                enable_test_backend=args.enable_test_backend,
            )
            if args.once:
                _print({"worked": agent.run_once(), "nodeId": args.node_id})
            else:
                agent.run_forever(poll_seconds=args.poll_seconds)
            return 0
        if args.command == "doctor":
            _print(discover_hardware(args.node_id, data_root=Path(args.data_root).resolve()))
            return 0
        if args.command == "submit":
            _print(_client(args).request_json("POST", "/v1/jobs", _load_json(args.plan)))
            return 0
        if args.command == "status":
            _print(_client(args).request_json("GET", "/v1/status"))
            return 0
        if args.command == "verify-receipts":
            result = _client(args).request_json("GET", "/v1/receipts/verify")
            _print(result)
            return 0 if result.get("valid") else 2
        if args.command == "register-model":
            _print(_client(args).request_json("POST", "/v1/models", _load_json(args.manifest)))
            return 0
        if args.command == "review":
            _print(_client(args).request_json("POST", f"/v1/assets/{args.artifact_id}/reviews", {
                "decision": args.decision,
                "artifactHash": args.artifact_hash,
                "reviewerId": args.reviewer,
                "reasonCodes": args.reason,
                "notes": args.notes,
            }))
            return 0
        if args.command == "model-hash":
            target = Path(args.path).resolve(strict=True)
            _print({"path": str(target), "sha256": sha256_directory(target) if target.is_dir() else sha256_file(target), "kind": "directory" if target.is_dir() else "file"})
            return 0
    except (CineSwarmError, ValueError, OSError, json.JSONDecodeError) as exc:
        if isinstance(exc, CineSwarmError):
            _print(exc.as_dict())
        else:
            _print({"error": {"code": "CLI_ERROR", "message": str(exc), "details": {}}})
        return 1
    return 1


def main() -> None:
    raise SystemExit(run())


def node_main() -> None:
    raise SystemExit(run(["node", *sys.argv[1:]]))

