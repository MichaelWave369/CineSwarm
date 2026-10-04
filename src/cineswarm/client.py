from __future__ import annotations

import base64
import http.client
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .auth import RequestAuthenticator
from .canonical import canonical_json, sha256_bytes, sha256_file
from .errors import CineSwarmError


class CoordinatorClient:
    def __init__(self, base_url: str, shared_secret: str | None = None, *, timeout: int = 120) -> None:
        self.base_url = base_url.rstrip("/")
        self.parsed = urllib.parse.urlparse(self.base_url)
        if self.parsed.scheme not in {"http", "https"} or not self.parsed.hostname:
            raise ValueError("Coordinator URL must be http:// or https:// with a hostname")
        self.auth = RequestAuthenticator(shared_secret)
        self.timeout = timeout

    def _headers(self, method: str, path: str, body_hash: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        headers = {"X-Body-SHA256": body_hash}
        signature = self.auth.sign(timestamp, method, path, body_hash)
        if signature:
            headers["X-Cine-Timestamp"] = timestamp
            headers["X-Cine-Signature"] = signature
        return headers

    def request_json(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        body = canonical_json(payload or {}).encode("utf-8") if method.upper() != "GET" else b""
        body_hash = sha256_bytes(body)
        headers = self._headers(method, path, body_hash)
        if method.upper() != "GET":
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=body if method.upper() != "GET" else None, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                payload_error = json.loads(exc.read().decode("utf-8"))
                error = payload_error.get("error", {})
                raise CineSwarmError(error.get("code", "HTTP_ERROR"), error.get("message", str(exc)), exc.code, error.get("details", {})) from exc
            except json.JSONDecodeError:
                raise CineSwarmError("HTTP_ERROR", str(exc), exc.code) from exc
        except urllib.error.URLError as exc:
            raise CineSwarmError("COORDINATOR_UNAVAILABLE", str(exc.reason), 503) from exc

    def upload_artifact(self, path: str, file_path: Path, *, node_id: str, lease_token: str, metadata: dict[str, Any]) -> Any:
        size = file_path.stat().st_size
        body_hash = sha256_file(file_path)
        headers = self._headers("POST", path, body_hash)
        metadata_bytes = canonical_json(metadata).encode("utf-8")
        headers.update({
            "Content-Type": "application/octet-stream",
            "Content-Length": str(size),
            "X-Cine-Node-ID": node_id,
            "X-Cine-Lease-Token": lease_token,
            "X-Cine-Artifact-Metadata": base64.urlsafe_b64encode(metadata_bytes).decode("ascii").rstrip("="),
        })
        port = self.parsed.port or (443 if self.parsed.scheme == "https" else 80)
        connection_type = http.client.HTTPSConnection if self.parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self.parsed.hostname, port, timeout=self.timeout)
        request_path = (self.parsed.path.rstrip("/") + path) or "/"
        try:
            connection.putrequest("POST", request_path)
            for key, value in headers.items():
                connection.putheader(key, value)
            connection.endheaders()
            with file_path.open("rb") as handle:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    connection.send(chunk)
            response = connection.getresponse()
            data = response.read()
            payload = json.loads(data.decode("utf-8")) if data else {}
            if response.status >= 400:
                error = payload.get("error", {})
                raise CineSwarmError(error.get("code", "HTTP_ERROR"), error.get("message", response.reason), response.status, error.get("details", {}))
            return payload
        finally:
            connection.close()

