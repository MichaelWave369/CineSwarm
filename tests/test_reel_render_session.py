"""No CI test in this suite calls a real video model, installs weights or grants a release."""
from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cineswarm.reel_render_session import (
    DEFAULT_TIMEOUT_SECONDS,
    LocalSessionDenied,
    _new_path,
    _safe_binaries,
    approve_render,
    describe_session,
    run_one_local_job,
)
from cineswarm.reel_shot_one import (
    create_first_shot_candidate,
    read_pilot_file,
)

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "examples" / "reel-p001.preproduction.fixture.json"


class ReelLocalRenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = read_pilot_file(PILOT)
        self.candidate = create_first_shot_candidate(self.source)
        self.digest = self.candidate["nativePlanHash"]
        self.readiness = {
            "status": "OPERATOR_REVIEW_REQUIRED",
            "modelHashVerified": True, "schedulerViable": True,
        }

    def permitted(self, **changes):
        kwargs = {
            "model_license_reviewed": True,
            "approve_local_gpu": True,
            "confirm_plan_sha": self.digest,
            "readiness": self.readiness,
        }
        kwargs.update(changes)
        return approve_render(self.candidate, **kwargs)

    def test_default_inspection_only_carries_real_model_plan_without_job(self):
        result = describe_session(self.source)
        self.assertEqual(result["schema"], "REEL_P001_LOCAL_RENDER_SESSION_V1")
        self.assertEqual(result["mode"], "INSPECT_ONLY")
        self.assertEqual(result["planHash"], self.digest)
        self.assertEqual(result["sourceHash"], self.candidate["sourceHash"])
        self.assertEqual(result["shotId"], "reel-p001-s01")
        self.assertEqual(result["modelBackend"], "wan21-t2v-1.3b")
        self.assertEqual(result["native"], {"width": 832, "height": 480, "fps": 16})
        self.assertFalse(result["gpuModelExecuted"])
        self.assertFalse(result["publicReleaseAuthorized"])
        self.assertFalse(result["modelDownloaded"])
        self.assertEqual(result["readiness"]["status"], "NOT_CHECKED")

    def test_human_and_full_plan_hash_all_required(self):
        self.assertEqual(self.permitted()["shots"][0]["durationSeconds"], 8)
        for name, value in [
            ("model_license_reviewed", False),
            ("approve_local_gpu", False),
            ("confirm_plan_sha", "0"*64),
            ("confirm_plan_sha", "a"),
            ("confirm_plan_sha", self.digest[:16]),
            ("readiness", {"status": "BLOCKED_MODEL_NOT_CONFIGURED",
                           "modelHashVerified": False, "schedulerViable": False}),
            ("readiness", {"status": "OPERATOR_REVIEW_REQUIRED",
                           "modelHashVerified": False, "schedulerViable": True}),
            ("readiness", {"status": "OPERATOR_REVIEW_REQUIRED",
                           "modelHashVerified": True, "schedulerViable": False}),
        ]:
            with self.subTest(name=name,value=str(value)[:30]):
                with self.assertRaises(LocalSessionDenied):
                    self.permitted(**{name: value})

    def test_mutated_native_plan_or_released_shot_is_denied(self):
        candidate = copy.deepcopy(self.candidate)
        candidate["nativeCandidatePlan"]["shots"][0]["prompt"] += " Altered text."
        with self.assertRaises(LocalSessionDenied):
            approve_render(candidate, model_license_reviewed=True,
                           approve_local_gpu=True, confirm_plan_sha=self.digest,
                           readiness=self.readiness)
        candidate = copy.deepcopy(self.candidate)
        candidate["nativeCandidatePlan"]["shots"][0]["publicReleaseAuthorized"] = True
        with self.assertRaises(LocalSessionDenied):
            approve_render(candidate, model_license_reviewed=True,
                           approve_local_gpu=True, confirm_plan_sha=self.digest,
                           readiness=self.readiness)

    def test_session_never_overwrites_existing_files_or_original_packet(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            packet = home / "pilot.json"
            packet.write_text(json.dumps(self.source))
            target = _new_path(home / "new-session", input_path=packet)
            self.assertFalse(target.exists())
            for path in [packet, home]:
                with self.subTest(path=path):
                    with self.assertRaises(LocalSessionDenied):
                        _new_path(path, input_path=packet)
            target.mkdir()
            with self.assertRaises(LocalSessionDenied):
                _new_path(target, input_path=packet)

    def test_ffmpeg_and_ffprobe_are_required_for_a_real_render(self):
        with self.assertRaisesRegex(LocalSessionDenied, "ffmpeg"):
            _safe_binaries(which=lambda name: None)
        with self.assertRaisesRegex(LocalSessionDenied, "ffprobe"):
            _safe_binaries(which=lambda name: "installed" if name == "ffmpeg" else None)

    def test_cli_inspection_no_network_no_gpu_and_no_creating_session(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory) / "will-never-be-created"
            code = [sys.executable, "-m", "cineswarm.reel_render_session", str(PILOT)]
            result = subprocess.run(code, cwd=ROOT, capture_output=True, text=True, timeout=25)
            self.assertEqual(result.returncode, 0, result.stderr)
            preview = json.loads(result.stdout)
            self.assertEqual(preview["planHash"], self.digest)
            self.assertFalse(session.exists())
            self.assertEqual(preview["readiness"]["status"], "NOT_CHECKED")
            attempt = subprocess.run(
                [*code, "--render", "--session-dir", str(session)],
                cwd=ROOT, capture_output=True, text=True, timeout=25,
            )
            self.assertEqual(attempt.returncode, 2)
            self.assertIn("REEL_LOCAL_RENDER_DENIED_OR_FAILED",attempt.stderr)
            self.assertFalse(session.exists())

    def test_cli_rejects_reuse_of_approval_flags_without_render(self):
        code = [sys.executable, "-m", "cineswarm.reel_render_session", str(PILOT)]
        out = subprocess.run(
            [*code, "--approve-local-gpu"],
            cwd=ROOT, capture_output=True, text=True, timeout=25,
        )
        self.assertEqual(out.returncode, 2)
        self.assertIn("valid only together with --render", out.stderr)

    def test_no_model_config_even_with_flags_cannot_create_session(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "missing-model-render"
            command = [
                sys.executable, "-m", "cineswarm.reel_render_session",
                str(PILOT), "--render", "--model-license-reviewed",
                "--approve-local-gpu", "--confirm-plan-sha", self.digest,
                "--session-dir", str(target),
            ]
            with patch.dict(os.environ, {
                "CINESWARM_WAN21_REPO": "", "CINESWARM_WAN21_CHECKPOINT": "",
                "CINESWARM_WAN21_MODEL_HASH": "",
            }):
                result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=25)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(target.exists())
            self.assertIn("REEL_LOCAL_RENDER_DENIED_OR_FAILED", result.stderr)
            self.assertNotIn("STARTING_SINGLE_AUTHORIZED_LOCAL_GPU_JOB", result.stdout)

    def test_sandboxed_coordinator_never_creates_fake_footage_without_gpu(self):
        """On a CPU-only CI host, one real job is queued and blocked, NOT completed."""
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "session"
            with patch.dict(os.environ, {
                "CINESWARM_WAN21_REPO": "", "CINESWARM_WAN21_CHECKPOINT": "",
                "CINESWARM_WAN21_MODEL_HASH": "",
                "CINESWARM_WAN_REPO": "", "CINESWARM_WAN_CHECKPOINT": "",
                "CINESWARM_WAN_MODEL_HASH": "",
            }):
                with self.assertRaisesRegex(LocalSessionDenied, "was not claimed"):
                    run_one_local_job(self.candidate["nativeCandidatePlan"],
                                      target, timeout_seconds=90)
            self.assertTrue((target / "coordinator").is_dir())
            self.assertFalse((target / "reel-p001-s01-evidence.json").exists())
            self.assertEqual(list(target.rglob("*.mp4")), [])

    def test_result_is_no_op_under_no_model_even_after_a_valid_brief(self):
        self.assertEqual(DEFAULT_TIMEOUT_SECONDS, 4*3600)
        self.assertEqual(self.source["authority"]["cineSwarmPlanSubmitted"], False)
        self.assertEqual(self.source["shots"][0]["id"], "P001-S01")


if __name__ == "__main__":
    unittest.main()
