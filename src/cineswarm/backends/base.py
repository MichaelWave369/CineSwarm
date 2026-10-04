from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class GeneratedArtifact:
    path: Path
    media_type: str
    role: str
    finalize_task: bool
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BackendResult:
    artifacts: list[GeneratedArtifact]
    parameters: dict[str, Any]
    generation_seconds: float
    logs: dict[str, str] = field(default_factory=dict)


class VideoBackend(ABC):
    backend_id: str

    @abstractmethod
    def capability(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def execute(self, shot: dict[str, Any], strategy: str, output_dir: Path) -> BackendResult:
        raise NotImplementedError

