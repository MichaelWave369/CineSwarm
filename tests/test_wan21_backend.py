from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from cineswarm.backends.wan21 import Wan21T2V13BBackend
from cineswarm.canonical import sha256_directory
from cineswarm.errors import CineSwarmError
from cineswarm.media import normalize_832x480_to_1280x720, probe_media
from cineswarm.scheduler import Scheduler


class Wan21BackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "Wan2.1"
        self.checkpoint = self.root / "Wan2.1-T2V-1.3B"
        self.repo.mkdir()
        self.checkpoint.mkdir()
        (self.repo / "generate.py").write_text("raise SystemExit('must not execute in hash test')\n", encoding="utf-8")
        (self.checkpoint / "weights.bin").write_bytes(b"fixture")
        self.shot = {
            "shotId": "pocket-spark-001",
            "prompt": "A glowing cartridge; $(must-not-expand)",
            "durationSeconds": 5,
            "delivery": {"width": 1280, "height": 720, "fps": 24, "container": "mp4"},
            "backendPreference": ["wan21-t2v-1.3b"],
            "conditioning": [],
            "seed": 369,
            "acceptanceEligible": True,
            "publicReleaseAuthorized": False,
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_capability_fits_12gb_single_gpu_without_summing(self) -> None:
        backend = Wan21T2V13BBackend(repo=self.repo, checkpoint=self.checkpoint, expected_model_hash=sha256_directory(self.checkpoint))
        hardware = {
            "gpus": [{"index": 0, "name": "12GB", "vramFreeMiB": 12288}],
            "ramFreeMiB": 32768,
            "diskFreeMiB": 50000,
        }
        decision = Scheduler().choose_for_node(self.shot, hardware, [backend.capability()])
        self.assertTrue(decision.viable)
        self.assertEqual(decision.backend_id, "wan21-t2v-1.3b")
        self.assertEqual(decision.strategy, "CPU_OFFLOAD")
        self.assertEqual(decision.gpu_index, 0)

    def test_command_matches_official_1_3b_bootstrap_shape(self) -> None:
        backend = Wan21T2V13BBackend(repo=self.repo, checkpoint=self.checkpoint, expected_model_hash="0" * 64)
        command = backend.build_command(self.shot, self.root / "native.mp4")
        self.assertIn("t2v-1.3B", command)
        self.assertIn("832*480", command)
        self.assertIn("--offload_model", command)
        self.assertIn("--t5_cpu", command)
        self.assertIn("--sample_shift", command)
        self.assertIn("8", command)
        self.assertIn("--sample_guide_scale", command)
        self.assertIn("6", command)
        self.assertIn("81", command)  # 5 sec * 16 fps adjusted to 4n+1
        self.assertNotIn("--use_prompt_extend", command)
        self.assertTrue(any("$(must-not-expand)" in argument for argument in command))

    def test_model_hash_mismatch_stops_before_inference(self) -> None:
        backend = Wan21T2V13BBackend(repo=self.repo, checkpoint=self.checkpoint, expected_model_hash="0" * 64)
        with self.assertRaises(CineSwarmError) as context:
            backend.execute(self.shot, "CPU_OFFLOAD", self.root / "output")
        self.assertEqual(context.exception.code, "MODEL_HASH_MISMATCH")
        self.assertFalse((self.root / "output" / "wan21-native-832x480.mp4").exists())

    def test_480p_normalization_preserves_honest_delivery_boundary(self) -> None:
        native = self.root / "native.mp4"
        master = self.root / "master.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=832x480:r=16", "-t", "0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(native),
        ], check=True, timeout=60)
        normalize_832x480_to_1280x720(native, master, timeout_seconds=60)
        native_probe = probe_media(native)
        master_probe = probe_media(master)
        native_video = [s for s in native_probe["streams"] if s.get("codec_type") == "video"][0]
        master_video = [s for s in master_probe["streams"] if s.get("codec_type") == "video"][0]
        self.assertEqual((native_video["width"], native_video["height"]), (832, 480))
        self.assertEqual((master_video["width"], master_video["height"]), (1280, 720))


if __name__ == "__main__":
    unittest.main()
