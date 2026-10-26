from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from cineswarm.canonical import sha256_json
from cineswarm.reel_intake import (
    OFFICE_IDS,
    PREVIEW_SCHEMA,
    ReelIntakeError,
    read_pitch_file,
    preview_reel_pitch,
    validate_reel_pitch,
)
from cineswarm.schemas import validate_production_plan

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "examples" / "reel-network.pitch.fixture.json"


def original() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class ReelIntakeTests(unittest.TestCase):
    def test_fixture_matches_frozen_ui_handoff_schema(self) -> None:
        packet = validate_reel_pitch(original())
        self.assertEqual(packet["schema"], "REEL_NETWORK_PITCH_PACKET_V1")
        self.assertEqual([order["officeId"] for order in packet["workOrders"]], list(OFFICE_IDS))
        self.assertEqual(packet["review"]["humanReleaseAuthorized"], False)

    def test_deterministic_native_plan_is_test_only_and_hashed(self) -> None:
        packet = original()
        first = preview_reel_pitch(packet)
        second = preview_reel_pitch(copy.deepcopy(packet))
        self.assertEqual(first, second)
        self.assertEqual(first["schema"], PREVIEW_SCHEMA)
        self.assertEqual(first["status"], "VALIDATED_NOT_SUBMITTED")
        self.assertEqual(first["inputHash"], sha256_json(packet))
        self.assertEqual(first["outputPlanHash"], sha256_json(first["nativeTestPlan"]))
        self.assertFalse(first["executionTriggered"])
        self.assertFalse(first["mediaRendered"])
        self.assertFalse(first["humanReleaseAuthorized"])
        self.assertFalse(first["rightsVerified"])
        self.assertFalse(first["publicationAuthorized"])
        native = validate_production_plan(first["nativeTestPlan"])
        self.assertEqual(native["lineage"]["sourceSystem"], "REEL_DRAFT")
        self.assertEqual(native["lineage"]["sourceHash"], first["inputHash"])
        self.assertEqual(len(native["shots"]), 1)
        shot = native["shots"][0]
        self.assertEqual(shot["backendPreference"], ["deterministic-test"])
        self.assertEqual(shot["durationSeconds"], 1)
        self.assertEqual(shot["conditioning"], [])
        self.assertFalse(shot["acceptanceEligible"])
        self.assertFalse(shot["publicReleaseAuthorized"])

    def test_all_authority_booleans_must_remain_exactly_denied(self) -> None:
        for field in (
            "cinemaProductionTriggered", "videoRendered", "autoImport",
            "broadcastAuthorized", "networkPublishingAuthorized",
        ):
            with self.subTest(field=field):
                packet = original()
                packet["authority"][field] = True
                with self.assertRaises(ReelIntakeError):
                    preview_reel_pitch(packet)
        packet = original()
        packet["authority"]["localPlanningOnly"] = False
        with self.assertRaises(ReelIntakeError):
            preview_reel_pitch(packet)
        packet = original()
        packet["authority"]["knownChannelNumber"] = 51
        with self.assertRaises(ReelIntakeError):
            preview_reel_pitch(packet)
        packet = original()
        packet["authority"]["videoRendered"] = 0  # bool/int equivalence bypass
        with self.assertRaises(ReelIntakeError):
            preview_reel_pitch(packet)

    def test_forged_rights_and_review_denied(self) -> None:
        fields = {
            "creatorRights": "obtained",
            "sourceLicense": "approved",
            "likenessConsent": "obtained",
            "claims": "passed",
            "humanAccepted": True,
            "humanReleaseAuthorized": True,
            "publicationStatus": "published",
        }
        for field, claimed in fields.items():
            with self.subTest(field=field):
                packet = original()
                packet["review"][field] = claimed
                with self.assertRaises(ReelIntakeError):
                    preview_reel_pitch(packet)

    def test_mutated_office_order_roles_or_commands_are_rejected(self) -> None:
        mutations = (
            lambda p: p["workOrders"].reverse(),
            lambda p: p["workOrders"].pop(),
            lambda p: p["workOrders"][0].update(officeId="release"),
            lambda p: p["workOrders"][6].update(office="Unrestricted AI Production"),
            lambda p: p["workOrders"][6].update(state="running"),
            lambda p: p["workOrders"][6].update(executionAuthorized=True),
            lambda p: p["workOrders"][0].update(secret="PASSWORD"),
        )
        for mutate in mutations:
            packet = original()
            mutate(packet)
            with self.assertRaises(ReelIntakeError):
                preview_reel_pitch(packet)

    def test_invalid_format_claim_strings_and_schema_are_rejected(self) -> None:
        changes = [
            ("schema", "production-plan/v1"),
            ("network", "UNKNOWN"),
            ("originPipeline", "http://127.0.0.1:8765"),
        ]
        for field, value in changes:
            packet = original()
            packet[field] = value
            with self.assertRaises(ReelIntakeError):
                preview_reel_pitch(packet)
        for field, value in [
            ("format", "raw-ffmpeg"), ("claimClass", "evidence-supported"),
            ("title", ""), ("concept", "A" * 1201), ("show", "B" * 101),
            ("creatorCredit", " " * 5), ("sourceWorld", "\x00secrets"),
        ]:
            packet = original()
            packet["pitch"][field] = value
            with self.assertRaises((ReelIntakeError, TypeError)):
                preview_reel_pitch(packet)
        packet = original()
        packet["pitch"]["format"] = []
        with self.assertRaises((ReelIntakeError, TypeError)):
            preview_reel_pitch(packet)
        packet = original()
        packet["shotInstructions"] = ["render this now"]
        with self.assertRaises(ReelIntakeError):
            preview_reel_pitch(packet)

    def test_traces_changes_without_claiming_production(self) -> None:
        original_packet = original()
        changed = copy.deepcopy(original_packet)
        changed["pitch"]["concept"] = "An alternate original proposal."
        self.assertNotEqual(
            preview_reel_pitch(original_packet)["inputHash"],
            preview_reel_pitch(changed)["inputHash"],
        )
        self.assertNotEqual(
            preview_reel_pitch(original_packet)["nativeTestPlan"]["projectId"],
            preview_reel_pitch(changed)["nativeTestPlan"]["projectId"],
        )

    def test_local_read_caps_and_duplicate_key_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            bad = root / "bad.json"
            bad.write_text('{"schema":"A","schema":"B"}', encoding="utf-8")
            with self.assertRaises(ReelIntakeError):
                read_pitch_file(bad)
            big = root / "big.json"
            big.write_bytes(b"{" + b"x" * (64 * 1024 + 1) + b"}")
            with self.assertRaises(ReelIntakeError):
                read_pitch_file(big)
            self.assertEqual(read_pitch_file(FIXTURE_PATH), original())

    def test_cli_writes_only_approved_local_preview_and_never_overwrites(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / "preview.json"
            cli = [
                sys.executable, "-m", "cineswarm.reel_intake",
                str(FIXTURE_PATH), "--out", str(output),
            ]
            completed = subprocess.run(cli, cwd=ROOT, capture_output=True, text=True, timeout=15)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "LOCAL_DRYRUN_ONLY")
            self.assertFalse(payload["executionTriggered"])
            self.assertEqual(payload["nativeTestPlan"]["shots"][0]["backendPreference"], ["deterministic-test"])
            second = subprocess.run(cli, cwd=ROOT, capture_output=True, text=True, timeout=15)
            self.assertEqual(second.returncode, 2)
            self.assertIn("REEL_INTAKE_DENIED", second.stderr)
            self.assertEqual(payload, json.loads(output.read_text(encoding="utf-8")))

    def test_invalid_cli_input_does_not_create_native_plan(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "untrusted.json"
            obj = original()
            obj["review"]["humanReleaseAuthorized"] = True
            bad.write_text(json.dumps(obj), encoding="utf-8")
            output = Path(d) / "invalid.preview.json"
            proc = subprocess.run(
                [sys.executable, "-m", "cineswarm.reel_intake", str(bad),
                 "--out", str(output)],
                cwd=ROOT, capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(proc.returncode, 2)
            self.assertFalse(output.exists())
            self.assertIn("REEL_INTAKE_DENIED", proc.stderr)


if __name__ == "__main__":
    unittest.main()
