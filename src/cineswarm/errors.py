from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class CineSwarmError(Exception):
    code: str
    message: str
    http_status: int = 400
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return f"{self.code}: {self.message}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


def require(condition: bool, code: str, message: str, *, status: int = 400, **details: Any) -> None:
    if not condition:
        raise CineSwarmError(code, message, status, details)

