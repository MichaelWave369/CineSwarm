from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class Settings:
    data_root: Path
    host: str = "127.0.0.1"
    port: int = 8765
    shared_secret: str | None = None
    lease_seconds: int = 900
    node_stale_seconds: int = 90
    max_json_bytes: int = 20 * 1024 * 1024
    max_artifact_bytes: int = 2 * 1024 * 1024 * 1024
    process_timeout_seconds: int = 4 * 60 * 60

    @property
    def require_auth(self) -> bool:
        return self.host not in {"127.0.0.1", "localhost", "::1"}

    @classmethod
    def from_env(cls, *, host: str | None = None, port: int | None = None, data_root: str | None = None) -> "Settings":
        resolved_host = host or os.getenv("CINESWARM_HOST", "127.0.0.1")
        resolved_port = port or int(os.getenv("CINESWARM_PORT", "8765"))
        root_value = data_root or os.getenv("CINESWARM_DATA_ROOT", "./parallax-cineswarm-data")
        secret = os.getenv("CINESWARM_SHARED_SECRET") or None
        if resolved_host not in {"127.0.0.1", "localhost", "::1"} and not secret:
            raise ValueError("CINESWARM_SHARED_SECRET is required when binding beyond loopback")
        return cls(
            data_root=Path(root_value).expanduser().resolve(),
            host=resolved_host,
            port=resolved_port,
            shared_secret=secret,
            lease_seconds=int(os.getenv("CINESWARM_LEASE_SECONDS", "900")),
            node_stale_seconds=int(os.getenv("CINESWARM_NODE_STALE_SECONDS", "90")),
            process_timeout_seconds=int(os.getenv("CINESWARM_PROCESS_TIMEOUT_SECONDS", str(4 * 60 * 60))),
        )

