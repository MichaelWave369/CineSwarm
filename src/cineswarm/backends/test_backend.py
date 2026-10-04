from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .base import BackendResult, GeneratedArtifact, VideoBackend


class DeterministicTestBackend(VideoBackend):
    backend_id = "deterministic-test"

    def capability(self) -> dict[str, Any]:
        return {
            "backendId": self.backend_id,
            "protocolVersion": "video-backend/v1",
            "modelId": "none",
            "modelRevision": "test-fixture-v1",
            "modelHash": "0" * 64,
            "modelStatus": "APPROVED",
            "externalProvider": False,
            "testOnly": True,
            "nativeResolutions": [[1280, 720]],
            "nativeFps": [24],
            "supportedConditioning": [],
            "postprocess": [],
            "vramProfiles": [{
                "strategy": "DISTRIBUTED_PREPOST",
                "minimumVramMiB": 0,
                "minimumRamMiB": 64,
                "minimumDiskMiB": 1,
            }],
        }

    def execute(self, shot: dict[str, Any], strategy: str, output_dir: Path) -> BackendResult:
        start = time.monotonic()
        output_dir.mkdir(parents=True, exist_ok=True)
        output = output_dir / "deterministic-test-artifact.json"
        payload = {
            "notice": "TEST FIXTURE — NOT GENERATED MEDIA — NOT ACCEPTANCE ELIGIBLE",
            "backendId": self.backend_id,
            "shotId": shot["shotId"],
            "prompt": shot["prompt"],
            "seed": shot["seed"],
            "strategy": strategy,
        }
        output.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return BackendResult(
            artifacts=[GeneratedArtifact(output, "application/vnd.parallax.test+json", "test-fixture", True, {"acceptanceEligible": False})],
            parameters={"seed": shot["seed"], "strategy": strategy},
            generation_seconds=time.monotonic() - start,
        )
