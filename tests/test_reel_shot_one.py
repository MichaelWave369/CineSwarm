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

from cineswarm.canonical import sha256_directory, sha256_json
from cineswarm.reel_intake import ReelIntakeError
from cineswarm.reel_shot_one import (
    OUTPUT_SCHEMA, AUTHORITY_KEYS, SHOT_IDS, MAX_SOURCE_BYTES,
    create_first_shot_candidate, inspect_local_readiness,
    read_pilot_file, validate_pilot_packet,
)
from cineswarm.schemas import validate_production_plan

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "examples" / "reel-p001.preproduction.fixture.json"


def packet() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class ReelFirstShotTests(unittest.TestCase):
    def test_browser_equivalent_fixture_is_rejected_as_authority_but_accepted_as_brief(self):
        source = validate_pilot_packet(packet())
        self.assertEqual(source["id"], "REEL-P001")
        self.assertEqual([s["id"] for s in source["shots"]], list(SHOT_IDS))
        self.assertEqual(sum(s["durationSeconds"] for s in source["shots"]), 74)
        self.assertEqual(source["status"], "PREPRODUCTION_DRAFT_NOT_RENDERED")
        self.assertTrue(all(value is False for value in source["authority"].values()))

    def test_first_shot_is_real_backend_candidate_not_deterministic_fixture(self):
        source = packet()
        result = create_first_shot_candidate(source)
        self.assertEqual(result["schema"], OUTPUT_SCHEMA)
        self.assertEqual(result["mode"], "OFFLINE_REAL_SHOT_CANDIDATE_NOT_SUBMITTED")
        self.assertEqual(result["status"], "AWAITING_MANUAL_PRODUCTION_APPROVAL")
        self.assertEqual(result["sourceHash"], sha256_json(source))
        self.assertEqual(result["nativePlanHash"], sha256_json(result["nativeCandidatePlan"]))
        self.assertTrue(all(result[key] is False for key in (
            "gpuModelExecuted", "mediaRendered", "assetHashVerified", "rightsVerified",
            "humanProductionApprovalGranted", "publicReleaseAuthorized",
            "coordinatorContacted", "modelDownloaded",
        )))
        plan = validate_production_plan(result["nativeCandidatePlan"])
        self.assertEqual(plan["schemaVersion"], "production-plan/v1")
        self.assertEqual(plan["lineage"]["sourceHash"], result["sourceHash"])
        self.assertEqual(plan["lineage"]["sourceSystem"], "REEL_P001")
        self.assertEqual(len(plan["shots"]), 1)
        shot = plan["shots"][0]
        self.assertEqual(shot["shotId"], "reel-p001-s01")
        self.assertEqual(shot["prompt"], source["shots"][0]["imagePrompt"])
        self.assertEqual(shot["durationSeconds"], 8)
        self.assertEqual(shot["backendPreference"], ["wan21-t2v-1.3b"])
        self.assertEqual(shot["delivery"], {"width": 1280, "height": 720, "fps": 24, "container": "mp4"})
        self.assertTrue(shot["acceptanceEligible"])
        self.assertIs(shot["publicReleaseAuthorized"], False)
        self.assertEqual(shot["conditioning"], [])

    def test_source_mutations_change_hash_and_never_become_permissions(self):
        source = packet()
        changed = copy.deepcopy(source)
        changed["shots"][0]["imagePrompt"] += " Add original light."
        self.assertNotEqual(
            create_first_shot_candidate(source)["nativePlanHash"],
            create_first_shot_candidate(changed)["nativePlanHash"],
        )
        for field in AUTHORITY_KEYS:
            with self.subTest(field=field):
                modified = copy.deepcopy(source)
                modified["authority"][field] = True
                with self.assertRaises(ReelIntakeError):
                    create_first_shot_candidate(modified)
        modified = copy.deepcopy(source)
        modified["authority"]["humanReleaseAuthorized"] = 0
        with self.assertRaises(ReelIntakeError):
            create_first_shot_candidate(modified)

    def test_fake_review_receipt_or_altered_timeline_fails_closed(self):
        source = packet()
        mutations = (
            lambda o: o["reviewGates"][7].update(status="approved"),
            lambda o: o["reviewGates"][0].update(releaseAuthority=True),
            lambda o: o["reviewGates"].pop(),
            lambda o: o["shots"][0].update(durationSeconds=1),
            lambda o: o["shots"][0].update(startSeconds=1),
            lambda o: o["shots"][0].update(id="P001-MALICIOUS"),
            lambda o: o["shots"][0].update(modelUrl="https://evil.invalid"),
            lambda o: o["shots"][0].update(imagePrompt=""),
            lambda o: o["shots"].pop(),
            lambda o: o["handoff"].update(thisPackageIsNativeCineSwarmPlan=True),
            lambda o: o["credits"].update(musicAuthor="LICENSED CLAIM"),
            lambda o: o.update(status="RENDERED"),
            lambda o: o.update(published=True),
        )
        for mutation in mutations:
            altered = copy.deepcopy(source)
            mutation(altered)
            with self.assertRaises(ReelIntakeError):
                create_first_shot_candidate(altered)

    def test_json_reader_rejects_dup_keys_or_oversize(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "pilot.json"
            target.write_text('{"schema":"A","schema":"B"}', encoding="utf-8")
            with self.assertRaises(ReelIntakeError):
                read_pilot_file(target)
            target.write_bytes(b"{" + b"x" * (MAX_SOURCE_BYTES + 1) + b"}")
            with self.assertRaises(ReelIntakeError):
                read_pilot_file(target)
            self.assertEqual(read_pilot_file(FIXTURE), packet())

    def test_hardware_preflight_defaults_blocked_without_operator_config(self):
        plan = create_first_shot_candidate(packet())["nativeCandidatePlan"]
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {}, clear=True):
                result = inspect_local_readiness(plan, data_root=Path(folder))
                self.assertEqual(result["status"], "BLOCKED_MODEL_NOT_CONFIGURED")
                self.assertFalse(result["schedulerViable"])
                self.assertFalse(result["modelHashVerified"])

    def test_pinned_checkpoint_and_model_files_are_checked_locally(self):
        plan = create_first_shot_candidate(packet())["nativeCandidatePlan"]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "Wan2.1"
            checkpoint = root / "weights"
            repo.mkdir()
            checkpoint.mkdir()
            (repo / "generate.py").write_text("raise SystemExit('do not execute')\n")
            (checkpoint / "example.bin").write_bytes(b"placeholder fixture weights")
            digest = sha256_directory(checkpoint)
            env = {
                "CINESWARM_WAN21_REPO": str(repo),
                "CINESWARM_WAN21_CHECKPOINT": str(checkpoint),
                "CINESWARM_WAN21_MODEL_HASH": digest,
            }
            with patch.dict(os.environ, env, clear=True):
                with patch("cineswarm.reel_shot_one.discover_hardware", return_value={
                    "ramFreeMiB": 32768, "diskFreeMiB": 45000,
                    "gpus": [{"index": 0, "vramFreeMiB": 12288, "name": "12GB"}],
                }):
                    result = inspect_local_readiness(plan, data_root=root)
                    self.assertEqual(result["status"], "OPERATOR_REVIEW_REQUIRED")
                    self.assertTrue(result["modelHashVerified"])
                    self.assertTrue(result["schedulerViable"])
                    self.assertIs(result["modelLicenseReviewed"], False)
                    self.assertIs(result["humanProductionApprovalGranted"], False)
                    os.environ["CINESWARM_WAN21_MODEL_HASH"] = "0" * 64
                    wrong = inspect_local_readiness(plan, data_root=root)
                    self.assertEqual(wrong["status"], "BLOCKED_MODEL_HASH_MISMATCH")
                with patch("cineswarm.reel_shot_one.discover_hardware", return_value={
                    "ramFreeMiB": 32768, "diskFreeMiB": 45000,
                    "gpus": [{"index": 0, "vramFreeMiB": 8000, "name": "8GB"}],
                }):
                    os.environ["CINESWARM_WAN21_MODEL_HASH"] = digest
                    limited = inspect_local_readiness(plan, data_root=root)
                    self.assertEqual(limited["status"], "BLOCKED_HARDWARE_OR_MODEL_PROFILE")
                    self.assertFalse(limited["schedulerViable"])

    def test_cli_never_overwrites_or_submits_and_requires_explicit_flag_for_local_inspection(self):
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder) / "preflight.json"
            command = [
                sys.executable, "-m", "cineswarm.reel_shot_one",
                str(FIXTURE), "--out", str(dest),
            ]
            first = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=25)
            self.assertEqual(first.returncode, 0, first.stderr)
            data = json.loads(dest.read_text(encoding="utf-8"))
            self.assertEqual(data["readiness"]["status"], "NOT_CHECKED")
            self.assertFalse(data["readiness"]["localHardwareObserved"])
            self.assertIs(data["coordinatorContacted"], False)
            self.assertIs(data["gpuModelExecuted"], False)
            second = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=25)
            self.assertEqual(second.returncode, 2)
            self.assertIn("REEL_P001_PREFLIGHT_DENIED", second.stderr)
            self.assertEqual(json.loads(dest.read_text(encoding="utf-8")), data)


if __name__ == "__main__":
    unittest.main()
