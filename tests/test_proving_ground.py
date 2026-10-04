from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from cineswarm.api import CineRequestHandler
from cineswarm.auth import RequestAuthenticator
from cineswarm.canonical import sha256_file
from cineswarm.client import CoordinatorClient
from cineswarm.config import Settings
from cineswarm.errors import CineSwarmError
from cineswarm.paths import StorageLayout
from cineswarm.store import CineStore


SOURCE_HASH = "3a476f12d215dcad55744c962e93aa702dba78b48ab6e1907b4d24cbec78ef0f"


def make_plan(backend: str, *, key: str, acceptance: bool = True) -> dict:
    return {
        "schemaVersion": "production-plan/v1",
        "projectId": "wayne-proving-ground",
        "idempotencyKey": key,
        "lineage": {"sourceSystem": "WAYNE", "sourceHash": SOURCE_HASH},
        "shots": [{
            "shotId": "shot-001", "prompt": "Adversarial proof fixture", "durationSeconds": 1,
            "delivery": {"width": 1280, "height": 720, "fps": 24, "container": "mp4"},
            "backendPreference": [backend], "conditioning": [], "seed": 369,
            "acceptanceEligible": acceptance, "publicReleaseAuthorized": False,
        }],
    }


def make_hardware(node_id: str, vram: int = 0) -> dict:
    return {
        "schemaVersion": "hardware-profile/v1", "nodeId": node_id, "hostname": node_id.lower(), "os": "ProofOS",
        "ramTotalMiB": 65536, "ramFreeMiB": 65536, "diskFreeMiB": 100000,
        "gpus": [] if not vram else [{"index": 0, "name": "Proof GPU", "vramTotalMiB": vram, "vramFreeMiB": vram}],
    }


def make_capability(backend: str, *, minimum_vram: int = 0, test_only: bool = False) -> dict:
    return {
        "backendId": backend, "protocolVersion": "video-backend/v1", "modelId": "proof-model",
        "modelRevision": "proof-v1", "modelHash": "2" * 64, "modelStatus": "APPROVED",
        "externalProvider": False, "testOnly": test_only, "nativeResolutions": [[1280, 720]],
        "nativeFps": [24], "supportedConditioning": [], "postprocess": [],
        "vramProfiles": [{"strategy": "FULL_GPU" if minimum_vram else "DISTRIBUTED_PREPOST", "minimumVramMiB": minimum_vram, "minimumRamMiB": 64, "minimumDiskMiB": 1}],
    }


class ProvingGroundStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = CineStore(StorageLayout(self.root), lease_seconds=30, node_stale_seconds=10)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def running_task(self) -> dict:
        self.store.register_node(make_hardware("WAYNE-NODE"), [make_capability("proof-backend")], {})
        self.store.submit_plan(make_plan("proof-backend", key="artifact-proof"))
        task = self.store.claim_task("WAYNE-NODE")
        self.store.start_task(task["taskId"], "WAYNE-NODE", task["leaseToken"])
        return task

    def metadata(self, *, external: bool = False) -> dict:
        return {
            "mediaType": "application/octet-stream", "artifactRole": "test-fixture", "finalizeTask": True,
            "acceptanceEligible": False, "parameters": {}, "generationSeconds": 0.1, "gpuUsed": "CPU",
            "backend": {"modelId": "proof-model", "modelRevision": "proof-v1", "modelHash": "2" * 64,
                        "adapterHashes": [], "externalProviderCalled": external, "providerFeeUsd": 1.0 if external else 0.0},
        }

    def test_external_provider_artifact_is_quarantined_and_task_fails(self) -> None:
        task = self.running_task()
        incoming = self.store.storage.incoming_path()
        incoming.write_bytes(b"external-provider-attempt")
        digest = sha256_file(incoming)
        with self.assertRaises(CineSwarmError) as context:
            self.store.ingest_artifact(task["taskId"], "WAYNE-NODE", task["leaseToken"], incoming, digest, self.metadata(external=True))
        self.assertEqual(context.exception.code, "EXTERNAL_PROVIDER_DISABLED")
        self.assertEqual(self.store.status()["tasks"].get("FAILED"), 1)
        self.assertTrue(any((self.root / "assets" / "quarantine").iterdir()))

    def test_wire_hash_mismatch_is_quarantined_and_task_fails(self) -> None:
        task = self.running_task()
        incoming = self.store.storage.incoming_path()
        incoming.write_bytes(b"partial-or-mutated-output")
        with self.assertRaises(CineSwarmError) as context:
            self.store.ingest_artifact(task["taskId"], "WAYNE-NODE", task["leaseToken"], incoming, "0" * 64, self.metadata())
        self.assertEqual(context.exception.code, "ARTIFACT_HASH_MISMATCH")
        self.assertEqual(self.store.status()["tasks"].get("FAILED"), 1)

    def test_stale_lease_token_cannot_start_recovered_attempt(self) -> None:
        self.store.register_node(make_hardware("WAYNE-NODE"), [make_capability("proof-backend")], {})
        self.store.submit_plan(make_plan("proof-backend", key="stale-lease"))
        first = self.store.claim_task("WAYNE-NODE")
        connection = self.store.raw_connection_for_tests()
        try:
            connection.execute("UPDATE tasks SET lease_expires_at=? WHERE id=?", (time.time() - 1, first["taskId"]))
            connection.commit()
        finally:
            connection.close()
        second = self.store.claim_task("WAYNE-NODE")
        with self.assertRaises(CineSwarmError) as context:
            self.store.start_task(first["taskId"], "WAYNE-NODE", first["leaseToken"])
        self.assertEqual(context.exception.code, "LEASE_INVALID")
        self.store.start_task(second["taskId"], "WAYNE-NODE", second["leaseToken"])

    def test_pocket_spark_remains_queued_on_12gb_node(self) -> None:
        wan_capability = make_capability("wan22-ti2v-5b", minimum_vram=24576)
        wan_capability["nativeResolutions"] = [[1280, 704]]
        wan_capability["postprocess"] = [{"input": [1280, 704], "output": [1280, 720], "localOnly": True}]
        self.store.register_node(make_hardware("RTX5070-12GB", 12288), [wan_capability], {})
        source = json.loads(Path("examples/pocket_spark.production-plan.json").read_text(encoding="utf-8"))
        self.store.submit_plan(source)
        self.assertIsNone(self.store.claim_task("RTX5070-12GB"))
        status = self.store.status()
        self.assertEqual(status["tasks"].get("QUEUED"), 1)
        self.assertIn("needs 24576 MiB", status["recentFailures"][0]["scheduleReason"])

    def test_model_manifest_gate_and_receipt_export(self) -> None:
        with self.assertRaises(CineSwarmError) as context:
            self.store.register_model_manifest({"modelId": "incomplete"})
        self.assertEqual(context.exception.code, "MODEL_MANIFEST_INVALID")
        manifest = {
            "modelId": "proof/model", "backendId": "proof-backend", "status": "BLOCKED", "source": "local-fixture",
            "revision": "proof-v1", "localHash": "0" * 64, "license": "test-only", "sizeBytes": 1,
            "runtime": "none", "vramProfiles": [], "approvedUse": "none",
        }
        self.store.register_model_manifest(manifest)
        receipts = self.store.export_receipts()
        self.assertEqual(receipts[-1]["eventType"], "MODEL_MANIFEST_REGISTERED")
        self.assertEqual(receipts[-1]["eventHash"], self.store.verify_receipt_chain()["headHash"])


class AuthenticatedApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = Settings(data_root=self.root, host="127.0.0.1", port=0, shared_secret="proof-secret")
        self.store = CineStore(StorageLayout(self.root), lease_seconds=30, node_stale_seconds=10)
        handler = type("AuthenticatedProofHandler", (CineRequestHandler,), {
            "store": self.store, "settings": self.settings, "authenticator": RequestAuthenticator("proof-secret"),
        })
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def test_unsigned_request_is_rejected_and_signed_request_passes(self) -> None:
        with self.assertRaises(CineSwarmError) as context:
            CoordinatorClient(self.url).request_json("GET", "/v1/status")
        self.assertEqual(context.exception.code, "AUTH_REQUIRED")
        result = CoordinatorClient(self.url, "proof-secret").request_json("GET", "/v1/status")
        self.assertEqual(result["provider"], "PARALLAX_NATIVE")


if __name__ == "__main__":
    unittest.main()

