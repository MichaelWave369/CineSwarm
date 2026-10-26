from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cineswarm.canonical import sha256_directory
from cineswarm.reel_launchpad import (
    SCHEMA, MIN_VRAM_MIB, MIN_RAM_MIB, MIN_DISK_MIB,
    launchpad_report, probe_torch_cuda,
)

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "examples" / "reel-p001.preproduction.fixture.json"


class ReelLaunchpadTests(unittest.TestCase):
    def test_default_has_no_gpu_jobs_downloads_license_or_publishing(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {
                "CINESWARM_WAN21_REPO": "",
                "CINESWARM_WAN21_CHECKPOINT": "",
                "CINESWARM_WAN21_MODEL_HASH": "",
            }):
                with patch("cineswarm.reel_launchpad.probe_torch_cuda") as torch:
                    result = launchpad_report(disk_path=Path(folder))
                    torch.assert_not_called()
            self.assertEqual(result["schema"], SCHEMA)
            self.assertEqual(result["mode"], "READ_ONLY_LOCAL_DIAGNOSTIC_NO_RENDER")
            self.assertEqual(result["pilot"]["status"], "NOT_PROVIDED")
            self.assertEqual(result["prerequisites"]["torchCuda"]["status"], "NOT_CHECKED")
            self.assertEqual(result["prerequisites"]["checkpointHash"]["status"], "NOT_CHECKED")
            self.assertFalse(result["readiness"]["allRequiredChecksObserved"])
            for key in ("modelLicenseReviewed", "gpuExecutionAuthorized",
                        "actualModelInferenceCompleted", "publicReleaseAuthorized"):
                self.assertIs(result["readiness"][key], False)
            for key in ("networkUsed", "modelDownloaded", "gpuInferenceStarted"):
                self.assertIs(result[key], False)

    def test_all_observed_technical_checks_never_create_a_license_or_approval(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "Wan2.1"
            weights = root / "Wan2.1-T2V-1.3B"
            repo.mkdir()
            weights.mkdir()
            (repo / "generate.py").write_text("# fake source fixture")
            (weights / "model.bin").write_bytes(b"fixture-only fake model")
            digest = sha256_directory(weights)
            env = {
                "CINESWARM_WAN21_REPO": str(repo),
                "CINESWARM_WAN21_CHECKPOINT": str(weights),
                "CINESWARM_WAN21_MODEL_HASH": digest,
            }
            gpu = {
                "index": 0, "name": "FAKE RTX 5070 TEST",
                "vramTotalMiB": 12288, "vramFreeMiB": 10240,
                "driverVersion": "test", "temperatureC": 40,
            }
            with patch.dict(os.environ, env, clear=True), \
                 patch("cineswarm.reel_launchpad._nvidia_gpus", return_value=([gpu], "test")), \
                 patch("cineswarm.reel_launchpad._memory_mib", return_value=(32768, 25000)), \
                 patch("cineswarm.reel_launchpad._tool", return_value={
                     "status": "FOUND", "executable": "/bin/test",
                 }), \
                 patch("cineswarm.reel_launchpad.probe_torch_cuda", return_value={
                     "status": "AVAILABLE", "cudaAvailable": True, "deviceCount": 1,
                 }):
                report = launchpad_report(PILOT, check_model_hash=True,
                                          probe_torch=True, disk_path=root)
            self.assertEqual(report["pilot"]["status"], "VALID_UNREVIEWED_PREPRODUCTION")
            self.assertRegex(report["pilot"]["nativePlanHash"], r"^[a-f0-9]{64}$")
            self.assertEqual(report["prerequisites"]["checkpointHash"]["status"], "MATCH")
            self.assertEqual(report["prerequisites"]["availableResources"]["status"], "POSSIBLE")
            self.assertEqual(report["readiness"]["status"], "TECHNICAL_PROBES_PASSED_NEEDS_HUMAN_REVIEW")
            self.assertTrue(report["readiness"]["allRequiredChecksObserved"])
            for key in ("modelLicenseReviewed", "creativeApprovalGranted",
                        "gpuExecutionAuthorized", "actualModelInferenceCompleted"):
                self.assertIs(report["readiness"][key], False)

    def test_checkpoint_mismatch_is_blocked_even_with_valid_model_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ckpt, repo = root / "weights", root / "wan"
            ckpt.mkdir()
            repo.mkdir()
            (ckpt / "weights.bin").write_bytes(b"placeholder bytes")
            (repo / "generate.py").write_text("pass")
            with patch.dict(os.environ, {
                "CINESWARM_WAN21_REPO": str(repo),
                "CINESWARM_WAN21_CHECKPOINT": str(ckpt),
                "CINESWARM_WAN21_MODEL_HASH": "0"*64,
            }):
                report = launchpad_report(PILOT, check_model_hash=True, disk_path=root)
            self.assertEqual(report["prerequisites"]["checkpointHash"]["status"], "MISMATCH")
            self.assertFalse(report["readiness"]["allRequiredChecksObserved"])

    def test_forged_pilot_rights_are_invalid(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            bad = root / "pilot.json"
            pkt = json.loads(PILOT.read_text(encoding="utf-8"))
            pkt["authority"]["rightsVerified"] = True
            bad.write_text(json.dumps(pkt), encoding="utf-8")
            report = launchpad_report(bad, disk_path=root)
            self.assertEqual(report["pilot"]["status"], "INVALID")
            self.assertIsNone(report["pilot"]["nativePlanHash"])

    def test_unavailable_resources_are_blocked_without_summing_gpus(self):
        with tempfile.TemporaryDirectory() as folder:
            fake_gpu = {"index": 0, "name": "TEST", "vramFreeMiB": 8000}
            other = {"index": 1, "name": "TEST2", "vramFreeMiB": 8000}
            with patch("cineswarm.reel_launchpad._tool", return_value={"status": "FOUND", "executable": "/bin/fake"}), \
                 patch("cineswarm.reel_launchpad._nvidia_gpus", return_value=([fake_gpu, other], None)), \
                 patch("cineswarm.reel_launchpad._memory_mib", return_value=(8192, 4000)):
                report = launchpad_report(PILOT, disk_path=Path(folder))
            self.assertEqual(report["prerequisites"]["availableResources"]["status"], "BLOCKED")
            self.assertEqual(report["prerequisites"]["availableResources"]["bestSingleGpuFreeMiB"], 8000)
            self.assertFalse(report["readiness"]["allRequiredChecksObserved"])
            self.assertEqual((MIN_VRAM_MIB, MIN_RAM_MIB, MIN_DISK_MIB), (9216, 16384, 20480))

    def test_cuda_probe_is_isolated_and_never_calls_generate(self):
        process = subprocess.CompletedProcess(args=["python"], returncode=1,
                                             stdout="", stderr="missing CUDA")
        with patch("cineswarm.reel_launchpad.subprocess.run", return_value=process) as run:
            report = probe_torch_cuda()
        self.assertEqual(report["status"], "BLOCKED")
        command = run.call_args.args[0]
        self.assertEqual(command[1], "-c")
        self.assertIn("import torch", command[2])
        self.assertIn("cuda.is_available", command[2])
        self.assertNotIn("generate.py", command[2])

    def test_cli_default_never_overwrites_and_no_model_probe_by_default(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "report.json"
            cmd = [sys.executable, "-m", "cineswarm.reel_launchpad", "--pilot", str(PILOT)]
            simple = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=25)
            self.assertEqual(simple.returncode, 0, simple.stderr)
            info = json.loads(simple.stdout)
            self.assertEqual(info["pilot"]["status"], "VALID_UNREVIEWED_PREPRODUCTION")
            self.assertEqual(info["prerequisites"]["torchCuda"]["status"], "NOT_CHECKED")
            first = subprocess.run([*cmd, "--out", str(output)], cwd=ROOT,
                                   capture_output=True, text=True, timeout=25)
            self.assertEqual(first.returncode, 0, first.stderr)
            second = subprocess.run([*cmd, "--out", str(output)], cwd=ROOT,
                                    capture_output=True, text=True, timeout=25)
            self.assertEqual(second.returncode, 2)
            self.assertFalse(json.loads(output.read_text())["gpuInferenceStarted"])
            refusal = subprocess.run([*cmd, "--out", str(PILOT)], cwd=ROOT,
                                     capture_output=True, text=True, timeout=25)
            self.assertEqual(refusal.returncode, 2)
            self.assertEqual(json.loads(PILOT.read_text())["id"], "REEL-P001")

    def test_powershell_entry_script_is_inspection_only(self):
        text = (ROOT / "tools" / "REEL-Launchpad.ps1").read_text(encoding="utf-8")
        for marker in (
            "Get-Command 'python'", "cineswarm.reel_launchpad", "PYTHONPATH",
            "--pilot", "--probe-torch", "--check-model-hash",
            "Diagnostics finished. No render was started.",
        ):
            self.assertIn(marker, text)
        for forbidden in (
            "Invoke-WebRequest", "Invoke-RestMethod", "Start-Process",
            "ExecutionPolicy Bypass", "Set-ExecutionPolicy",
            "huggingface-cli download", "git clone",
        ):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
