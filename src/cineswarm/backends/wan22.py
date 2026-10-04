from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from ..canonical import sha256_directory, sha256_file
from ..errors import CineSwarmError
from ..media import normalize_1280x704_to_1280x720, probe_media
from .base import BackendResult, GeneratedArtifact, VideoBackend


class Wan22TI2VBackend(VideoBackend):
    backend_id = "wan22-ti2v-5b"

    def __init__(self, *, repo: Path, checkpoint: Path, expected_model_hash: str, timeout_seconds: int = 4 * 60 * 60) -> None:
        self.repo = repo.resolve()
        self.checkpoint = checkpoint.resolve()
        self.expected_model_hash = expected_model_hash.lower()
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_env(cls, *, timeout_seconds: int) -> "Wan22TI2VBackend | None":
        repo = os.getenv("CINESWARM_WAN_REPO")
        checkpoint = os.getenv("CINESWARM_WAN_CHECKPOINT")
        expected_hash = os.getenv("CINESWARM_WAN_MODEL_HASH")
        if not (repo and checkpoint and expected_hash):
            return None
        return cls(repo=Path(repo), checkpoint=Path(checkpoint), expected_model_hash=expected_hash, timeout_seconds=timeout_seconds)

    def _installation_state(self) -> tuple[str, str]:
        if len(self.expected_model_hash) != 64 or any(char not in "0123456789abcdef" for char in self.expected_model_hash):
            return "BLOCKED", "CINESWARM_WAN_MODEL_HASH must be an exact lowercase SHA-256 directory digest"
        if not (self.repo / "generate.py").is_file():
            return "BLOCKED", "Official Wan generate.py was not found at CINESWARM_WAN_REPO"
        if not self.checkpoint.is_dir():
            return "BLOCKED", "Wan checkpoint directory was not found"
        return "APPROVED", "Operator supplied source, checkpoint, and expected hash; bytes are rechecked before execution"

    def capability(self) -> dict[str, Any]:
        status, reason = self._installation_state()
        return {
            "backendId": self.backend_id,
            "protocolVersion": "video-backend/v1",
            "modelId": "Wan-AI/Wan2.2-TI2V-5B",
            "modelRevision": "operator-pinned",
            "modelHash": self.expected_model_hash,
            "modelStatus": status,
            "statusReason": reason,
            "externalProvider": False,
            "testOnly": False,
            "nativeResolutions": [[1280, 704]],
            "nativeFps": [24],
            "supportedConditioning": [],
            "postprocess": [{"input": [1280, 704], "output": [1280, 720], "localOnly": True, "method": "ffmpeg-pad"}],
            "vramProfiles": [
                {"strategy": "CPU_OFFLOAD", "minimumVramMiB": 24576, "minimumRamMiB": 32768, "minimumDiskMiB": 32768},
                {"strategy": "FULL_GPU", "minimumVramMiB": 81920, "minimumRamMiB": 16384, "minimumDiskMiB": 32768},
            ],
        }

    def build_command(self, shot: dict[str, Any], native_output: Path) -> list[str]:
        frame_count = max(5, int(round(float(shot["durationSeconds"]) * 24)))
        if (frame_count - 1) % 4 != 0:
            frame_count += (4 - ((frame_count - 1) % 4))
        command = [
            sys.executable, str(self.repo / "generate.py"),
            "--task", "ti2v-5B",
            "--size", "1280*704",
            "--ckpt_dir", str(self.checkpoint),
            "--offload_model", "True",
            "--convert_model_dtype",
            "--t5_cpu",
            "--frame_num", str(frame_count),
            "--base_seed", str(shot["seed"]),
            "--prompt", shot["prompt"],
            "--save_file", str(native_output),
        ]
        return command

    def execute(self, shot: dict[str, Any], strategy: str, output_dir: Path) -> BackendResult:
        status, reason = self._installation_state()
        if status != "APPROVED":
            raise CineSwarmError("MODEL_UNAVAILABLE", reason, 500)
        observed_hash = sha256_directory(self.checkpoint)
        if observed_hash != self.expected_model_hash:
            raise CineSwarmError("MODEL_HASH_MISMATCH", "Wan checkpoint directory hash does not match the approved manifest", 500, {"expected": self.expected_model_hash, "observed": observed_hash})
        output_dir.mkdir(parents=True, exist_ok=True)
        native = output_dir / "wan22-native-1280x704.mp4"
        master = output_dir / "pocket-spark-master-1280x720.mp4"
        command = self.build_command(shot, native)
        started = time.monotonic()
        completed = subprocess.run(command, cwd=self.repo, capture_output=True, text=True, timeout=self.timeout_seconds)
        elapsed = time.monotonic() - started
        if completed.returncode != 0:
            raise CineSwarmError("MODEL_EXECUTION_FAILED", "Wan process returned a nonzero exit code", 500, {"exitCode": completed.returncode, "stderr": completed.stderr[-8000:]})
        if not native.is_file() or native.stat().st_size == 0:
            raise CineSwarmError("OUTPUT_MISSING", "Wan process completed without the declared MP4", 500)
        native_probe = probe_media(native)
        videos = [stream for stream in native_probe.get("streams", []) if stream.get("codec_type") == "video"]
        if native_probe.get("probeStatus") != "PASSED" or not videos or videos[0].get("width") != 1280 or videos[0].get("height") != 704:
            raise CineSwarmError("OUTPUT_CORRUPT", "Wan native MP4 did not probe as 1280×704", 500, {"probe": native_probe})
        normalize_1280x704_to_1280x720(native, master, timeout_seconds=self.timeout_seconds)
        native_hash = sha256_file(native)
        return BackendResult(
            artifacts=[
                GeneratedArtifact(native, "video/mp4", "native", False, {"nativeResolution": [1280, 704]}),
                GeneratedArtifact(master, "video/mp4", "master", True, {"sourceArtifactHash": native_hash, "transformation": "ffmpeg pad=1280:720:0:8:black"}),
            ],
            parameters={
                "seed": shot["seed"],
                "frameNum": int(command[command.index("--frame_num") + 1]),
                "nativeResolution": [1280, 704],
                "deliveryResolution": [1280, 720],
                "strategy": strategy,
                "promptExtension": False,
            },
            generation_seconds=elapsed,
            logs={"stdout": completed.stdout[-8000:], "stderr": completed.stderr[-8000:]},
        )
