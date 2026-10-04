from __future__ import annotations

import hashlib
import hmac
import time

from .errors import CineSwarmError


class RequestAuthenticator:
    def __init__(self, secret: str | None, *, allowed_skew_seconds: int = 120) -> None:
        self._secret = secret.encode("utf-8") if secret else None
        self.allowed_skew_seconds = allowed_skew_seconds

    @staticmethod
    def signing_payload(timestamp: str, method: str, path: str, body_sha256: str) -> bytes:
        return f"{timestamp}\n{method.upper()}\n{path}\n{body_sha256.lower()}".encode("utf-8")

    def sign(self, timestamp: str, method: str, path: str, body_sha256: str) -> str:
        if not self._secret:
            return ""
        return hmac.new(self._secret, self.signing_payload(timestamp, method, path, body_sha256), hashlib.sha256).hexdigest()

    def verify(self, timestamp: str | None, signature: str | None, method: str, path: str, body_sha256: str) -> None:
        if not self._secret:
            return
        if not timestamp or not signature:
            raise CineSwarmError("AUTH_REQUIRED", "Signed request headers are required", 401)
        try:
            request_time = int(timestamp)
        except ValueError as exc:
            raise CineSwarmError("AUTH_INVALID", "Request timestamp is invalid", 401) from exc
        if abs(int(time.time()) - request_time) > self.allowed_skew_seconds:
            raise CineSwarmError("AUTH_STALE", "Request timestamp is outside the allowed window", 401)
        expected = self.sign(timestamp, method, path, body_sha256)
        if not hmac.compare_digest(expected, signature.lower()):
            raise CineSwarmError("AUTH_INVALID", "Request signature does not match", 401)

