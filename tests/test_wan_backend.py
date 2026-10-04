from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cineswarm.backends.wan22 import Wan22TI2VBackend
from cineswarm.errors import CineSwarmError


class WanBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "Wan2.2"
        self.checkpoint = self.root / "Wan2.2-TI2V-5B"
        self.repo.mkdir()
        self.checkpoint.mkdir()
        (self.repo / "generate.py").write_text("raise SystemExit('must not execute in hash test')\n", encoding="utf-8")
        (self.checkpoint / "weights.bin").write_bytes(b"fixture")
        self.shot = {
            "shotId": "pocket-spark-001",
            "prompt": "Safe argv prompt; $(must-not-expand)",
            "durationSeconds": 5,
            "delivery": {"width": 1280, "height": 720, "fps": 24, "container": "mp4"},
            "conditioning": [],
            "seed": 369,
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_command_uses_official_ti2v_shape_and_no_external_extension(self) -> None:
        backend = Wan22TI2VBackend(repo=self.repo, checkpoint=self.checkpoint, expected_model_hash="0" * 64)
        command = backend.build_command(self.shot, self.root / "native.mp4")
        self.assertIn("ti2v-5B", command)
        self.assertIn("1280*704", command)
        self.assertIn("121", command)
        self.assertIn("--save_file", command)
        self.assertNotIn("--use_prompt_extend", command)
        self.assertTrue(any("$(must-not-expand)" in argument for argument in command))

    def test_model_hash_mismatch_stops_before_inference(self) -> None:
        backend = Wan22TI2VBackend(repo=self.repo, checkpoint=self.checkpoint, expected_model_hash="0" * 64)
        with self.assertRaises(CineSwarmError) as context:
            backend.execute(self.shot, "CPU_OFFLOAD", self.root / "output")
        self.assertEqual(context.exception.code, "MODEL_HASH_MISMATCH")
        self.assertFalse((self.root / "output" / "wan22-native-1280x704.mp4").exists())


if __name__ == "__main__":
    unittest.main()
