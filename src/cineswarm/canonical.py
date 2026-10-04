from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, BinaryIO


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def sha256_stream(stream: BinaryIO, *, chunk_size: int = 1024 * 1024) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = stream.read(chunk_size)
        if not chunk:
            break
        digest.update(chunk)
        total += len(chunk)
    return digest.hexdigest(), total


def sha256_file(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    with path.open("rb") as handle:
        return sha256_stream(handle, chunk_size=chunk_size)[0]


def sha256_directory(path: Path) -> str:
    """Hash file names, sizes, and content hashes in stable relative-path order."""
    digest = hashlib.sha256()
    root = path.resolve(strict=True)
    for item in sorted((p for p in root.rglob("*") if p.is_file()), key=lambda p: p.as_posix()):
        relative = item.relative_to(root).as_posix()
        stat = item.stat()
        record = f"{relative}\0{stat.st_size}\0{sha256_file(item)}\n"
        digest.update(record.encode("utf-8"))
    return digest.hexdigest()

