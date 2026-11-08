from __future__ import annotations

import copy
import unittest

from cineswarm.continuity import compile_continuity_preview
from cineswarm.errors import CineSwarmError


def fixture() -> dict:
    return {
        "schemaVersion": "phi-continuity/v1",
        "shotId": "subject-369",
        "fps": 24,
        "durationSeconds": 5,
        "referenceAssets": [
            {"artifactHash": "a" * 64, "role": "identity", "tag": "hero"},
            {"artifactHash": "b" * 64, "role": "environment", "tag": "elsewhen"},
        ],
        "motionBeats": [
            {"atSeconds": 1.0, "intensity": 0.8, "label": "turn"},
            {"atSeconds": 2.5, "intensity": 1.0, "cameraCut": True, "label": "cut"},
            {"atSeconds": 4.0, "intensity": 0.4, "label": "settle"},
        ],
        "checkpointBudget": {"targetIntervalFrames": 24, "maxCheckpoints": 6},
    }


class ContinuityPreviewTests(unittest.TestCase):
    def test_deterministic_and_hash_bound(self) -> None:
        source = fixture()
        first = compile_continuity_preview(source)
        self.assertEqual(first, compile_continuity_preview(copy.deepcopy(source)))
        self.assertEqual(first["frameCount"], 120)
        self.assertEqual(first["executionStatus"], "PREVIEW_ONLY")
        self.assertFalse(first["backendAuthorized"])
        self.assertFalse(first["publicReleaseAuthorized"])
        frames = [item["frame"] for item in first["checkpoints"]]
        self.assertEqual(frames, sorted(set(frames)))
        self.assertEqual(frames[0], 0)
        self.assertEqual(frames[-1], 119)
        self.assertLessEqual(len(frames), 6)
        self.assertIn(60, frames)
        self.assertIn("camera-cut", {item["reason"] for item in first["checkpoints"]})

    def test_motion_prioritized_before_uniform_interval(self) -> None:
        source = fixture()
        source["checkpointBudget"]["maxCheckpoints"] = 4
        output = compile_continuity_preview(source)
        frames = {item["frame"] for item in output["checkpoints"]}
        self.assertEqual(frames, {0, 24, 60, 119})
        self.assertNotIn(48, frames)

    def test_source_change_changes_receipt(self) -> None:
        first = compile_continuity_preview(fixture())
        revised = fixture()
        revised["motionBeats"][0]["intensity"] = 0.3
        second = compile_continuity_preview(revised)
        self.assertNotEqual(first["sourceHash"], second["sourceHash"])
        self.assertNotEqual(first["previewHash"], second["previewHash"])

    def test_camera_cuts_fail_closed_on_budget(self) -> None:
        source = fixture()
        source["checkpointBudget"]["maxCheckpoints"] = 2
        with self.assertRaises(CineSwarmError) as context:
            compile_continuity_preview(source)
        self.assertEqual(context.exception.code, "CONTINUITY_BUDGET_EXCEEDED")

    def test_rejects_paths_and_unregistered_style_fields(self) -> None:
        source = fixture()
        source["referenceAssets"][0]["localPath"] = "../../private.png"
        with self.assertRaises(CineSwarmError):
            compile_continuity_preview(source)

    def test_rejects_incorrect_sha(self) -> None:
        source = fixture()
        source["referenceAssets"][0]["artifactHash"] = "not-a-hash"
        with self.assertRaises(CineSwarmError):
            compile_continuity_preview(source)

    def test_rejects_boolean_numeric_inputs(self) -> None:
        source = fixture()
        source["fps"] = True
        with self.assertRaises(CineSwarmError):
            compile_continuity_preview(source)

    def test_rejects_non_finite_motion(self) -> None:
        source = fixture()
        source["motionBeats"][0]["intensity"] = float("nan")
        with self.assertRaises(CineSwarmError):
            compile_continuity_preview(source)

    def test_tiny_clip_has_one_boundary(self) -> None:
        source = fixture()
        source["fps"] = 1
        source["durationSeconds"] = 0.25
        source["motionBeats"] = []
        output = compile_continuity_preview(source)
        self.assertEqual(output["frameCount"], 1)
        self.assertEqual([point["frame"] for point in output["checkpoints"]], [0])


if __name__ == "__main__":
    unittest.main()
