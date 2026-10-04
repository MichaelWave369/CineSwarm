from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from ..canonical import sha256_directory, sha256_file
from ..errors import CineSwarmError
from ..media import normalize_832x480_to_1280x720, probe_media
from .base import BackendResult, GeneratedArtifact, VideoBackend


class Wan21T2V13BBackend(VideoBackend):
    """Official Wan 2.1 T2V 1.3B consumer-GPU bootstrap backend.

    Upstream documents 832x480 generation and ~8.19 GB VRAM. CineSwarm uses a
    conservative 9 GiB free-VRAM scheduler floor and preserves the native 480p
    artifact before producing a separately hashed 1280x720 delivery master.
    """

    backend_id = "wan21-t2v-1.3b"

    def __init__(self, *, repo: Path, checkpoint: Path, expected_model_hash: str, timeout_seconds: int = 4 * 60 * 60) -> None:
        self.repo = repo.resolve()
        self.checkpoint = checkpoint.resolve()
        self.expected_model_hash = expected_model_hash.lower()
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_env(cls, *, timeout_seconds: int) -> "Wan21T2V13BBackend | None":
        repo = os.getenv("CINESWARM_WAN21_REPO")
        checkpoint = os.getenv("CINESWARM_WAN21_CHECKPOINT")
        expected_hash = os.getenv("CINESWARM_WAN21_MODEL_HASH")
        if not (repo and checkpoint and expected_hash):
            return None
        return cls(repo=Path(repo), checkpoint=Path(checkpoint), expected_model_hash=expected_hash, timeout_seconds=timeout_seconds)

    def _installation_state(self) -> tuple[str, str]:
        if len(self.expected_model_hash) != 64 or any(char not in "0123456789abcdef" for char in self.expected_model_hash):
            return "BLOCKED", "CINESWARM_WAN21_MODEL_HASH must be an exact lowercase SHA-256 directory digest"
        if not (self.repo / "generate.py").is_file():
            return "BLOCKED", "Official Wan 2.1 generate.py was not found at CINESWARM_WAN21_REPO"
        if not self.checkpoint.is_dir():
            return "BLOCKED", "Wan 2.1 T2V 1.3B checkpoint directory was not found"
        return "APPROVED", "Operator supplied source, checkpoint, and expected hash; bytes are rechecked before execution"

    def capability(self) -> dict[str, Any]:
        status, reason = self._installation_state()
        return {
            "backendId": self.backend_id,
            "protocolVersion": "video-backend/v1",
            "modelId": "Wan-AI/Wan2.1-T2V-1.3B",
            "modelRevision": "operator-pinned",
            "modelHash": self.expected_model_hash,
            "modelStatus": status,
            "statusReason": reason,
            "externalProvider": False,
            "testOnly": False,
            "qualityClass": "CONSUMER_BOOTSTRAP_480P",
            "nativeResolutions": [[832, 480]],
            "nativeFps": [16],
            "supportedConditioning": [],
            "postprocess": [{
                "input": [832, 480], "output": [1280, 720], "localOnly": True,
                "method": "ffmpeg-lanczos-scale-plus-pillarbox", "native720p": False,
            }],
            "vramProfiles": [{
                "strategy": "CPU_OFFLOAD",
                "minimumVramMiB": 9216,
                "minimumRamMiB": 16384,
                "minimumDiskMiB": 20480,
                "profileBasis": "Upstream documents ~8.19 GB VRAM; CineSwarm adds conservative scheduling headroom",
            }],
        }

    @staticmethod
    def _frame_count(duration_seconds: float) -> int:
        frames = max(5, int(round(duration_seconds * 16)))
        # Wan requires 4n+1 frames.
        remainder = (frames - 1) % 4
        if remainder:
            frames += 4 - remainder
        return frames

    def build_command(self, shot: dict[str, Any], native_output: Path) -> list[str]:
        return [
            sys.executable, str(self.repo / "generate.py"),
            "--task", "t2v-1.3B",
            "--size", "832*480",
            "--ckpt_dir", str(self.checkpoint),
            "--offload_model", "True",
            "--t5_cpu",
            "--sample_shift", "8",
            "--sample_guide_scale", "6",
            "--frame_num", str(self._frame_count(float(shot["durationSeconds"]))),
            "--base_seed", str(shot["seed"]),
            "--prompt", shot["prompt"],
            "--save_file", str(native_output),
        ]

    def execute(self, shot: dict[str, Any], strategy: str, output_dir: Path) -> BackendResult:
        status, reason = self._installation_state()
        if status != "APPROVED":
            raise CineSwarmError("MODEL_UNAVAILABLE", reason, 500)
        observed_hash = sha256_directory(self.checkpoint)
        if observed_hash != self.expected_model_hash:
            raise CineSwarmError("MODEL_HASH_MISMATCH", "Wan 2.1 checkpoint directory hash does not match the approved manifest", 500, {"expected": self.expected_model_hash, "observed": observed_hash})
        output_dir.mkdir(parents=True, exist_ok=True)
        native = output_dir / "wan21-native-832x480.mp4"
        master = output_dir / "pocket-spark-master-1280x720.mp4"
        command = self.build_command(shot, native)
        started = time.monotonic()
        completed = subprocess.run(command, cwd=self.repo, capture_output=True, text=True, timeout=self.timeout_seconds)
        elapsed = time.monotonic() - started
        if completed.returncode != 0 or not native.is_file() or native.stat().st_size == 0:
            raise CineSwarmError("MODEL_EXECUTION_FAILED", "Wan 2.1 generation failed", 500, {"returnCode": completed.returncode, "stderr": completed.stderr[-4000:]})
        native_probe = probe_media(native)
        videos = [stream for stream in native_probe.get("streams", []) if stream.get("codec_type") == "video"]
        if native_probe.get("probeStatus") != "PASSED" or not videos or videos[0].get("width") != 832 or videos[0].get("height") != 480:
            raise CineSwarmError("QC_FAILED", "Wan 2.1 native artifact did not probe as 832×480", 500, {"probe": native_probe})
        native_hash = sha256_file(native)
        normalize_832x480_to_1280x720(native, master, timeout_seconds=self.timeout_seconds)
        return BackendResult(
            artifacts=[
                GeneratedArtifact(native, "video/mp4", "native", False, {"nativeResolution": [832, 480], "nativeFps": 16, "qualityClass": "CONSUMER_BOOTSTRAP_480P"}),
                GeneratedArtifact(master, "video/mp4", "master", True, {
                    "sourceArtifactHash": native_hash,
                    "transformation": "ffmpeg scale=1248:720:lanczos + pad=1280:720:16:0:black + fps=24",
                    "nativeResolution": [832, 480], "deliveryResolution": [1280, 720], "native720p": False, "nativeFps": 16, "deliveryFps": 24, "temporalConversion": "frame duplication/drop only; no motion interpolation",
                    "qualityClass": "CONSUMER_BOOTSTRAP_480P",
                }),
            ],
            parameters={
                "seed": shot["seed"],
                "frameNum": int(command[command.index("--frame_num") + 1]),
                "nativeResolution": [832, 480],
                "nativeFps": 16,
                "deliveryResolution": [1280, 720],
                "deliveryFps": 24,
                "temporalConversion": "frame duplication/drop only; no motion interpolation",
                "strategy": strategy,
                "promptExtension": False,
                "sampleShift": 8,
                "sampleGuideScale": 6,
                "qualityClass": "CONSUMER_BOOTSTRAP_480P",
            },
            generation_seconds=elapsed,
            logs={"stdout": completed.stdout[-8000:], "stderr": completed.stderr[-8000:]},
        )
