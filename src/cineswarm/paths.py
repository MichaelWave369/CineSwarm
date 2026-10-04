from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from .errors import CineSwarmError


class StorageLayout:
    DIRECTORIES = (
        "models/video", "models/image", "models/audio", "models/loras",
        "projects", "jobs/queued", "jobs/active", "jobs/completed", "jobs/failed",
        "assets/references", "assets/conditioning", "assets/generated/sha256",
        "assets/accepted", "assets/rejected", "assets/quarantine", "assets/incoming",
        "training-signals", "receipts", "logs", "cache", "state",
    )

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        for relative in self.DIRECTORIES:
            (self.root / relative).mkdir(parents=True, exist_ok=True)

    def contained(self, candidate: Path) -> Path:
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise CineSwarmError("MALICIOUS_PATH", "Path escapes the CineSwarm data root", 400) from exc
        return resolved

    def resolve_relative(self, relative: str) -> Path:
        value = Path(relative)
        if value.is_absolute() or ".." in value.parts:
            raise CineSwarmError("MALICIOUS_PATH", "Only root-contained relative paths are allowed", 400)
        return self.contained(self.root / value)

    def incoming_path(self, suffix: str = ".part") -> Path:
        safe_suffix = suffix if suffix.startswith(".") and len(suffix) <= 12 else ".part"
        return self.root / "assets" / "incoming" / f"{uuid.uuid4()}{safe_suffix}"

    def quarantine(self, path: Path, reason: str) -> Path:
        self.contained(path)
        target = self.root / "assets" / "quarantine" / f"{path.stem}-{reason}{path.suffix}"
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(path, target)
        return target

    def promote_content_addressed(self, source: Path, sha256: str, extension: str) -> Path:
        self.contained(source)
        safe_extension = extension.lower() if extension.startswith(".") and extension[1:].isalnum() else ".bin"
        target = self.root / "assets" / "generated" / "sha256" / sha256[:2] / f"{sha256}{safe_extension}"
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            source.unlink(missing_ok=True)
        else:
            try:
                os.replace(source, target)
            except OSError:
                shutil.copy2(source, target)
                source.unlink(missing_ok=True)
        return target

    @property
    def database_path(self) -> Path:
        return self.root / "state" / "cineswarm.sqlite3"

