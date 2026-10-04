from __future__ import annotations

import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from cineswarm.api import CineRequestHandler
from cineswarm.auth import RequestAuthenticator
from cineswarm.client import CoordinatorClient
from cineswarm.config import Settings
from cineswarm.node import NodeAgent
from cineswarm.paths import StorageLayout
from cineswarm.store import CineStore


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = Settings(data_root=self.root / "coordinator", host="127.0.0.1", port=0)
        self.store = CineStore(StorageLayout(self.settings.data_root), lease_seconds=30, node_stale_seconds=10)
        handler = type("TestCineHandler", (CineRequestHandler,), {
            "store": self.store,
            "settings": self.settings,
            "authenticator": RequestAuthenticator(None),
        })
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = CoordinatorClient(f"http://127.0.0.1:{self.server.server_port}")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def test_end_to_end_test_backend_is_not_review_eligible(self) -> None:
        source = json.loads(Path("examples/orchestration_test.production-plan.json").read_text(encoding="utf-8"))
        submitted = self.client.request_json("POST", "/v1/jobs", source)
        self.assertEqual(submitted["state"], "QUEUED")
        agent = NodeAgent(
            node_id="CINESWARM-TEST-01",
            coordinator=self.client,
            data_root=self.root / "node",
            timeout_seconds=60,
            enable_test_backend=True,
        )
        self.assertTrue(agent.run_once())
        status = self.client.request_json("GET", "/v1/status")
        self.assertEqual(status["jobs"].get("COMPLETED"), 1)
        self.assertEqual(status["tasks"].get("COMPLETED"), 1)
        self.assertEqual(status["artifacts"]["reviewStates"].get("NOT_APPLICABLE"), 1)
        self.assertEqual(status["reviewQueue"], [])
        self.assertFalse(status["externalProviderCalled"])
        self.assertTrue(status["receiptChain"]["valid"])


if __name__ == "__main__":
    unittest.main()

