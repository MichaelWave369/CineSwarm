from __future__ import annotations

import base64
import hashlib
import json
import re
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .auth import RequestAuthenticator
from .canonical import sha256_bytes
from .config import Settings
from .errors import CineSwarmError
from .store import CineStore


TASK_ROUTE = re.compile(r"^/v1/tasks/([0-9a-f-]{36})/(start|artifact|fail)$")
NODE_ROUTE = re.compile(r"^/v1/nodes/([A-Za-z0-9._-]{1,64})/(heartbeat|claim)$")
REVIEW_ROUTE = re.compile(r"^/v1/assets/([0-9a-f-]{36})/reviews$")


class CineRequestHandler(BaseHTTPRequestHandler):
    store: CineStore
    settings: Settings
    authenticator: RequestAuthenticator
    server_version = "ParallaxCineSwarm/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid request headers and credentials; preserve basic access evidence.
        super().log_message(fmt, *args)

    def _send(self, status: int, payload: dict[str, Any] | list[Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _auth(self, body_sha256: str) -> None:
        self.authenticator.verify(
            self.headers.get("X-Cine-Timestamp"),
            self.headers.get("X-Cine-Signature"),
            self.command,
            self.path,
            body_sha256,
        )

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise CineSwarmError("REQUEST_INVALID", "Content-Length is invalid", 400) from exc
        if length < 0 or length > self.settings.max_json_bytes:
            raise CineSwarmError("REQUEST_TOO_LARGE", "JSON request exceeds configured limit", 413)
        body = self.rfile.read(length)
        if len(body) != length:
            raise CineSwarmError("REQUEST_INCOMPLETE", "Request body ended early", 400)
        body_hash = sha256_bytes(body)
        declared = self.headers.get("X-Body-SHA256")
        if declared and declared.lower() != body_hash:
            raise CineSwarmError("REQUEST_HASH_MISMATCH", "Request body hash does not match header", 409)
        self._auth(body_hash)
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CineSwarmError("JSON_INVALID", "Request body is not valid UTF-8 JSON", 400) from exc
        if not isinstance(payload, dict):
            raise CineSwarmError("JSON_INVALID", "Request body must be a JSON object", 400)
        return payload

    def _stream_artifact(self, task_id: str) -> dict[str, Any]:
        node_id = self.headers.get("X-Cine-Node-ID") or ""
        lease_token = self.headers.get("X-Cine-Lease-Token") or ""
        expected_hash = (self.headers.get("X-Body-SHA256") or "").lower()
        if len(expected_hash) != 64 or any(char not in "0123456789abcdef" for char in expected_hash):
            raise CineSwarmError("REQUEST_INVALID", "Artifact upload requires lowercase X-Body-SHA256", 400)
        self._auth(expected_hash)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise CineSwarmError("REQUEST_INVALID", "Content-Length is invalid", 400) from exc
        if length <= 0 or length > self.settings.max_artifact_bytes:
            raise CineSwarmError("REQUEST_TOO_LARGE", "Artifact size is outside configured bounds", 413)
        encoded_metadata = self.headers.get("X-Cine-Artifact-Metadata") or ""
        try:
            padding = "=" * (-len(encoded_metadata) % 4)
            metadata = json.loads(base64.urlsafe_b64decode(encoded_metadata + padding).decode("utf-8"))
        except Exception as exc:
            raise CineSwarmError("SCHEMA_INVALID", "Artifact metadata header is invalid", 400) from exc
        suffix = ".mp4.part" if metadata.get("mediaType") == "video/mp4" else ".part"
        incoming = self.store.storage.incoming_path(suffix)
        digest = hashlib.sha256()
        remaining = length
        try:
            with incoming.open("wb") as handle:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise CineSwarmError("REQUEST_INCOMPLETE", "Artifact upload ended early", 400)
                    handle.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
        except Exception:
            incoming.unlink(missing_ok=True)
            raise
        observed = digest.hexdigest()
        if observed != expected_hash:
            quarantined = self.store.storage.quarantine(incoming, "wire-hash-mismatch")
            raise CineSwarmError("REQUEST_HASH_MISMATCH", "Streamed artifact does not match declared hash", 409, {"quarantine": quarantined.name})
        return self.store.ingest_artifact(task_id, node_id, lease_token, incoming, expected_hash, metadata)

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._auth(sha256_bytes(b""))
            if self.path == "/healthz":
                self._send(200, {"status": "ok", "provider": "PARALLAX_NATIVE"})
            elif self.path == "/v1/status":
                self._send(200, self.store.status())
            elif self.path == "/v1/receipts/verify":
                result = self.store.verify_receipt_chain()
                self._send(200 if result["valid"] else 409, result)
            elif self.path == "/v1/receipts/export":
                self._send(200, self.store.export_receipts())
            else:
                raise CineSwarmError("NOT_FOUND", "Endpoint was not found", 404)
        except CineSwarmError as exc:
            self._send(exc.http_status, exc.as_dict())
        except Exception:
            self._send(500, {"error": {"code": "INTERNAL_ERROR", "message": "Unhandled coordinator error", "details": {}}})

    def do_POST(self) -> None:  # noqa: N802
        try:
            if self.path == "/v1/jobs":
                result = self.store.submit_plan(self._read_json())
                self._send(200 if result["idempotentReplay"] else 201, result)
                return
            if self.path == "/v1/nodes/register":
                body = self._read_json()
                self._send(200, self.store.register_node(body.get("hardware"), body.get("capabilities"), body.get("workload")))
                return
            if self.path == "/v1/models":
                self._send(200, self.store.register_model_manifest(self._read_json()))
                return
            node_match = NODE_ROUTE.fullmatch(self.path)
            if node_match:
                body = self._read_json()
                node_id, action = node_match.groups()
                if action == "heartbeat":
                    self._send(200, self.store.heartbeat(node_id, body.get("hardware"), body.get("workload")))
                else:
                    result = self.store.claim_task(node_id)
                    self._send(200, {"task": result})
                return
            task_match = TASK_ROUTE.fullmatch(self.path)
            if task_match:
                task_id, action = task_match.groups()
                if action == "artifact":
                    self._send(201, self._stream_artifact(task_id))
                    return
                body = self._read_json()
                if action == "start":
                    self._send(200, self.store.start_task(task_id, body.get("nodeId", ""), body.get("leaseToken", "")))
                else:
                    self._send(200, self.store.fail_task(task_id, body.get("nodeId", ""), body.get("leaseToken", ""), str(body.get("code", "NODE_EXECUTION_ERROR")), str(body.get("detail", ""))))
                return
            review_match = REVIEW_ROUTE.fullmatch(self.path)
            if review_match:
                self._send(201, self.store.review_artifact(review_match.group(1), self._read_json()))
                return
            raise CineSwarmError("NOT_FOUND", "Endpoint was not found", 404)
        except CineSwarmError as exc:
            self._send(exc.http_status, exc.as_dict())
        except Exception as exc:
            traceback.print_exc()
            self._send(500, {"error": {"code": "INTERNAL_ERROR", "message": "Unhandled coordinator error", "details": {"type": type(exc).__name__}}})


def serve(settings: Settings, store: CineStore) -> None:
    handler = type("ConfiguredCineRequestHandler", (CineRequestHandler,), {
        "store": store,
        "settings": settings,
        "authenticator": RequestAuthenticator(settings.shared_secret),
    })
    server = ThreadingHTTPServer((settings.host, settings.port), handler)
    print(json.dumps({"event": "COORDINATOR_STARTED", "host": settings.host, "port": settings.port, "dataRoot": str(settings.data_root), "authRequired": settings.require_auth}, sort_keys=True), flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()

