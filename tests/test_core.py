from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from cineswarm.auth import RequestAuthenticator
from cineswarm.canonical import sha256_file
from cineswarm.errors import CineSwarmError
from cineswarm.hardware import discover_hardware
from cineswarm.paths import StorageLayout
from cineswarm.scheduler import Scheduler
from cineswarm.schemas import validate_production_plan
from cineswarm.store import CineStore


SOURCE_HASH = "3a476f12d215dcad55744c962e93aa702dba78b48ab6e1907b4d24cbec78ef0f"


def plan(*, backend: str = "fixture-video", idempotency: str = "core-v1", acceptance: bool = True) -> dict:
    return {
        "schemaVersion": "production-plan/v1",
        "projectId": "test-project",
        "idempotencyKey": idempotency,
        "lineage": {"sourceSystem": "TEST", "sourceHash": SOURCE_HASH},
        "shots": [{
            "shotId": "shot-001",
            "prompt": "A governed local test shot.",
            "durationSeconds": 1,
            "delivery": {"width": 1280, "height": 720, "fps": 24, "container": "mp4"},
            "backendPreference": [backend],
            "conditioning": [],
            "seed": 369,
            "acceptanceEligible": acceptance,
            "publicReleaseAuthorized": False,
        }],
    }


def hardware(node_id: str = "NODE-01", *, vram: list[int] | None = None, ram: int = 65536, disk: int = 100000) -> dict:
    vram = vram or []
    return {
        "schemaVersion": "hardware-profile/v1",
        "nodeId": node_id,
        "hostname": node_id.lower(),
        "os": "TestOS",
        "ramTotalMiB": ram,
        "ramFreeMiB": ram,
        "diskFreeMiB": disk,
        "gpus": [{"index": index, "name": f"GPU-{amount}", "vramTotalMiB": amount, "vramFreeMiB": amount} for index, amount in enumerate(vram)],
    }


def capability(backend: str = "fixture-video", *, minimum_vram: int = 0, minimum_ram: int = 64, minimum_disk: int = 1, test_only: bool = False) -> dict:
    return {
        "backendId": backend,
        "protocolVersion": "video-backend/v1",
        "modelId": "fixture-model",
        "modelRevision": "fixture-v1",
        "modelHash": "1" * 64,
        "modelStatus": "APPROVED",
        "externalProvider": False,
        "testOnly": test_only,
        "nativeResolutions": [[1280, 720]],
        "nativeFps": [24],
        "supportedConditioning": [],
        "postprocess": [],
        "vramProfiles": [{
            "strategy": "FULL_GPU" if minimum_vram else "DISTRIBUTED_PREPOST",
            "minimumVramMiB": minimum_vram,
            "minimumRamMiB": minimum_ram,
            "minimumDiskMiB": minimum_disk,
        }],
    }


class SchedulerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scheduler = Scheduler()
        self.shot = plan()["shots"][0]

    def test_12gb_is_rejected_for_24gb_profile(self) -> None:
        decision = self.scheduler.choose_for_node(self.shot, hardware(vram=[12288]), [capability(minimum_vram=24576)])
        self.assertFalse(decision.viable)
        self.assertIn("needs 24576 MiB", decision.reason)

    def test_two_12gb_gpus_are_not_summed(self) -> None:
        decision = self.scheduler.choose_for_node(self.shot, hardware(vram=[12288, 12288]), [capability(minimum_vram=24576)])
        self.assertFalse(decision.viable)
        self.assertIn("best is 12288", decision.reason)

    def test_24gb_node_is_viable(self) -> None:
        decision = self.scheduler.choose_for_node(self.shot, hardware(vram=[24576]), [capability(minimum_vram=24576)])
        self.assertTrue(decision.viable)
        self.assertEqual(decision.gpu_index, 0)

    def test_consumer_9gb_profile_is_viable_on_12gb_node(self) -> None:
        decision = self.scheduler.choose_for_node(self.shot, hardware(vram=[12288], ram=32768, disk=50000), [capability(minimum_vram=9216, minimum_ram=16384, minimum_disk=20480)])
        self.assertTrue(decision.viable)
        self.assertEqual(decision.gpu_index, 0)

    def test_low_disk_fails_closed(self) -> None:
        decision = self.scheduler.choose_for_node(self.shot, hardware(vram=[24576], disk=10), [capability(minimum_vram=24576, minimum_disk=100)])
        self.assertFalse(decision.viable)
        self.assertIn("free disk", decision.reason)

    def test_test_backend_cannot_take_acceptance_shot(self) -> None:
        decision = self.scheduler.choose_for_node(self.shot, hardware(), [capability(test_only=True)])
        self.assertFalse(decision.viable)
        self.assertIn("test-only backend prohibited", decision.reason)


class SchemaAndSecurityTests(unittest.TestCase):
    def test_hardware_probe_initializes_new_data_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "new-data-root"
            profile = discover_hardware("DOCTOR-01", data_root=target)
            self.assertTrue(target.is_dir())
            self.assertEqual(profile["nodeId"], "DOCTOR-01")

    def test_path_conditioning_is_rejected(self) -> None:
        value = plan()
        value["shots"][0]["conditioning"] = [{"type": "reference-image", "artifactHash": "a" * 64, "localPath": "../../secret"}]
        with self.assertRaises(CineSwarmError) as context:
            validate_production_plan(value)
        self.assertEqual(context.exception.code, "MALICIOUS_PATH")

    def test_public_release_cannot_be_pre_authorized(self) -> None:
        value = plan()
        value["shots"][0]["publicReleaseAuthorized"] = True
        with self.assertRaises(CineSwarmError) as context:
            validate_production_plan(value)
        self.assertEqual(context.exception.code, "RELEASE_NOT_AUTHORIZED")

    def test_storage_rejects_traversal_and_absolute_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            layout = StorageLayout(Path(directory))
            layout.initialize()
            for value in ("../escape", str(Path(directory).parent / "outside")):
                with self.assertRaises(CineSwarmError):
                    layout.resolve_relative(value)

    def test_hmac_detects_stale_and_bad_signature(self) -> None:
        auth = RequestAuthenticator("secret", allowed_skew_seconds=2)
        timestamp = str(int(time.time()))
        signature = auth.sign(timestamp, "POST", "/v1/jobs", "0" * 64)
        auth.verify(timestamp, signature, "POST", "/v1/jobs", "0" * 64)
        with self.assertRaises(CineSwarmError):
            auth.verify(timestamp, "0" * 64, "POST", "/v1/jobs", "0" * 64)
        with self.assertRaises(CineSwarmError):
            auth.verify(str(int(time.time()) - 20), signature, "POST", "/v1/jobs", "0" * 64)


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = CineStore(StorageLayout(self.root), lease_seconds=30, node_stale_seconds=10)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def register_fixture_node(self, node_id: str = "NODE-01") -> None:
        self.store.register_node(hardware(node_id), [capability()], {"activeTasks": 0})

    def test_job_idempotency_and_conflict(self) -> None:
        first = self.store.submit_plan(plan())
        replay = self.store.submit_plan(plan())
        self.assertEqual(first["jobId"], replay["jobId"])
        self.assertTrue(replay["idempotentReplay"])
        changed = plan()
        changed["shots"][0]["prompt"] = "Different bytes"
        with self.assertRaises(CineSwarmError) as context:
            self.store.submit_plan(changed)
        self.assertEqual(context.exception.code, "IDEMPOTENCY_CONFLICT")

    def test_concurrent_duplicate_submit_creates_one_job(self) -> None:
        outcomes: list[dict] = []
        errors: list[Exception] = []

        def submit() -> None:
            try:
                outcomes.append(self.store.submit_plan(plan(idempotency="concurrent-v1")))
            except Exception as exc:  # pragma: no cover - captured for assertion
                errors.append(exc)

        threads = [threading.Thread(target=submit) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(len({item["jobId"] for item in outcomes}), 1)
        self.assertEqual(sum(not item["idempotentReplay"] for item in outcomes), 1)

    def test_atomic_claim_and_expired_lease_recovery(self) -> None:
        self.register_fixture_node()
        self.store.submit_plan(plan())
        first = self.store.claim_task("NODE-01")
        self.assertIsNotNone(first)
        self.assertIsNone(self.store.claim_task("NODE-01"))
        connection = self.store.raw_connection_for_tests()
        try:
            connection.execute("UPDATE tasks SET lease_expires_at=? WHERE id=?", (time.time() - 1, first["taskId"]))
            connection.commit()
        finally:
            connection.close()
        second = self.store.claim_task("NODE-01")
        self.assertEqual(second["taskId"], first["taskId"])
        self.assertEqual(second["attempt"], 2)
        self.assertNotEqual(second["leaseToken"], first["leaseToken"])

    def test_offline_node_cannot_claim(self) -> None:
        self.register_fixture_node()
        self.store.submit_plan(plan())
        connection = self.store.raw_connection_for_tests()
        try:
            connection.execute("UPDATE nodes SET last_seen_epoch=0 WHERE node_id='NODE-01'")
            connection.commit()
        finally:
            connection.close()
        with self.assertRaises(CineSwarmError) as context:
            self.store.claim_task("NODE-01")
        self.assertEqual(context.exception.code, "NODE_OFFLINE")

    def _running_task(self) -> dict:
        self.register_fixture_node()
        self.store.submit_plan(plan())
        task = self.store.claim_task("NODE-01")
        self.store.start_task(task["taskId"], "NODE-01", task["leaseToken"])
        return task

    def _make_mp4(self, target: Path) -> None:
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=1280x720:r=24", "-t", "0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", str(target),
        ], check=True, timeout=60)

    def _metadata(self) -> dict:
        return {
            "mediaType": "video/mp4", "artifactRole": "master", "finalizeTask": True,
            "acceptanceEligible": True, "parameters": {"seed": 369}, "generationSeconds": 0.25,
            "gpuUsed": "Fixture GPU", "backend": {
                "modelId": "fixture-model", "modelRevision": "fixture-v1", "modelHash": "1" * 64,
                "adapterHashes": [], "externalProviderCalled": False, "providerFeeUsd": 0.0,
            },
        }

    def test_master_delivery_fps_mismatch_fails_closed(self) -> None:
        task = self._running_task()
        incoming = self.store.storage.incoming_path(".mp4.part")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
            "color=c=blue:s=1280x720:r=16", "-t", "0.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4", str(incoming),
        ], check=True, timeout=60)
        digest = sha256_file(incoming)
        with self.assertRaises(CineSwarmError) as context:
            self.store.ingest_artifact(task["taskId"], "NODE-01", task["leaseToken"], incoming, digest, self._metadata())
        self.assertEqual(context.exception.code, "QC_FAILED")
        self.assertIn("delivery contract", context.exception.message.lower())

    def test_mp4_ingest_exact_hash_review_and_training_signal(self) -> None:
        task = self._running_task()
        incoming = self.store.storage.incoming_path(".mp4.part")
        self._make_mp4(incoming)
        digest = sha256_file(incoming)
        artifact = self.store.ingest_artifact(task["taskId"], "NODE-01", task["leaseToken"], incoming, digest, self._metadata())
        self.assertEqual(artifact["probe"]["probeStatus"], "PASSED")
        self.assertEqual(artifact["reviewStatus"], "PENDING_REVIEW")
        with self.assertRaises(CineSwarmError) as context:
            self.store.review_artifact(artifact["artifactId"], {"decision": "ACCEPT", "artifactHash": "0" * 64, "reviewerId": "MIKEY", "reasonCodes": [], "notes": ""})
        self.assertEqual(context.exception.code, "REVIEW_HASH_MISMATCH")
        result = self.store.review_artifact(artifact["artifactId"], {"decision": "ACCEPT", "artifactHash": digest, "reviewerId": "MIKEY", "reasonCodes": ["VISUAL_PASS"], "notes": "Fixture acceptance-path test"})
        self.assertEqual(result["decision"], "ACCEPT")
        self.assertFalse(result["publicReleaseAuthorized"])
        self.assertEqual(self.store.status()["trainingSignals"], 1)
        self.assertTrue(self.store.verify_receipt_chain()["valid"])
        with self.assertRaises(CineSwarmError):
            self.store.review_artifact(artifact["artifactId"], {"decision": "REJECT", "artifactHash": digest, "reviewerId": "MIKEY", "reasonCodes": [], "notes": ""})

    def test_corrupt_video_fails_and_is_quarantined(self) -> None:
        task = self._running_task()
        incoming = self.store.storage.incoming_path(".mp4.part")
        incoming.write_bytes(b"not an mp4")
        digest = sha256_file(incoming)
        with self.assertRaises(CineSwarmError) as context:
            self.store.ingest_artifact(task["taskId"], "NODE-01", task["leaseToken"], incoming, digest, self._metadata())
        self.assertEqual(context.exception.code, "QC_FAILED")
        self.assertEqual(self.store.status()["tasks"].get("FAILED"), 1)
        self.assertTrue(any((self.root / "assets" / "quarantine").iterdir()))

    def test_receipt_tamper_is_detected(self) -> None:
        self.store.submit_plan(plan())
        self.assertTrue(self.store.verify_receipt_chain()["valid"])
        connection = self.store.raw_connection_for_tests()
        try:
            connection.execute("UPDATE receipts SET payload_json='{}' WHERE sequence=1")
            connection.commit()
        finally:
            connection.close()
        result = self.store.verify_receipt_chain()
        self.assertFalse(result["valid"])
        self.assertEqual(result["failureSequence"], 1)


if __name__ == "__main__":
    unittest.main()
