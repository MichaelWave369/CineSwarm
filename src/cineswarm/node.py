from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .backends import DeterministicTestBackend, VideoBackend, Wan21T2V13BBackend, Wan22TI2VBackend
from .client import CoordinatorClient
from .errors import CineSwarmError
from .hardware import discover_hardware


class NodeAgent:
    def __init__(self, *, node_id: str, coordinator: CoordinatorClient, data_root: Path, timeout_seconds: int, enable_test_backend: bool = False) -> None:
        self.node_id = node_id
        self.coordinator = coordinator
        self.data_root = data_root.resolve()
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.timeout_seconds = timeout_seconds
        self.backends: dict[str, VideoBackend] = {}
        if enable_test_backend:
            test_backend = DeterministicTestBackend()
            self.backends[test_backend.backend_id] = test_backend
        wan21 = Wan21T2V13BBackend.from_env(timeout_seconds=timeout_seconds)
        if wan21 is not None:
            self.backends[wan21.backend_id] = wan21
        wan = Wan22TI2VBackend.from_env(timeout_seconds=timeout_seconds)
        if wan is not None:
            self.backends[wan.backend_id] = wan
        self.registered = False
        self.active_tasks = 0

    def hardware(self) -> dict[str, Any]:
        return discover_hardware(self.node_id, data_root=self.data_root)

    def capabilities(self) -> list[dict[str, Any]]:
        return [backend.capability() for backend in self.backends.values()]

    def register(self) -> dict[str, Any]:
        result = self.coordinator.request_json("POST", "/v1/nodes/register", {
            "hardware": self.hardware(), "capabilities": self.capabilities(), "workload": {"activeTasks": self.active_tasks},
        })
        self.registered = True
        return result

    def heartbeat(self) -> dict[str, Any]:
        return self.coordinator.request_json("POST", f"/v1/nodes/{self.node_id}/heartbeat", {
            "hardware": self.hardware(), "workload": {"activeTasks": self.active_tasks},
        })

    def run_once(self) -> bool:
        if not self.registered:
            self.register()
        else:
            self.heartbeat()
        claim = self.coordinator.request_json("POST", f"/v1/nodes/{self.node_id}/claim", {})
        task = claim.get("task")
        if not task:
            return False
        self.active_tasks = 1
        task_id = task["taskId"]
        lease_token = task["leaseToken"]
        try:
            self.coordinator.request_json("POST", f"/v1/tasks/{task_id}/start", {"nodeId": self.node_id, "leaseToken": lease_token})
            backend = self.backends.get(task["backendId"])
            if backend is None:
                raise CineSwarmError("MODEL_UNAVAILABLE", f"Backend {task['backendId']} is not loaded on this node", 500)
            output_dir = self.data_root / "jobs" / "active" / task_id / f"attempt-{task['attempt']}"
            result = backend.execute(task["shot"], task["strategy"], output_dir)
            capability = backend.capability()
            hardware = self.hardware()
            gpu_index = task.get("gpuIndex")
            gpu_used = "CPU"
            if isinstance(gpu_index, int):
                for gpu in hardware.get("gpus", []):
                    if gpu.get("index") == gpu_index:
                        gpu_used = f"{gpu.get('name')} (index {gpu_index})"
                        break
            for artifact in result.artifacts:
                metadata = {
                    "mediaType": artifact.media_type,
                    "artifactRole": artifact.role,
                    "finalizeTask": artifact.finalize_task,
                    "acceptanceEligible": artifact.metadata.get("acceptanceEligible", task["shot"].get("acceptanceEligible", True)),
                    "sourceArtifactHash": artifact.metadata.get("sourceArtifactHash"),
                    "parameters": {**result.parameters, **artifact.metadata},
                    "generationSeconds": result.generation_seconds,
                    "gpuUsed": gpu_used,
                    "backend": {
                        "backendId": capability["backendId"],
                        "modelId": capability.get("modelId", "unknown"),
                        "modelRevision": capability.get("modelRevision", "unknown"),
                        "modelHash": capability.get("modelHash", "unknown"),
                        "adapterHashes": [],
                        "externalProviderCalled": False,
                        "providerFeeUsd": 0.0,
                    },
                }
                self.coordinator.upload_artifact(f"/v1/tasks/{task_id}/artifact", artifact.path, node_id=self.node_id, lease_token=lease_token, metadata=metadata)
            return True
        except Exception as exc:
            code = exc.code if isinstance(exc, CineSwarmError) else "NODE_EXECUTION_ERROR"
            detail = str(exc)
            try:
                self.coordinator.request_json("POST", f"/v1/tasks/{task_id}/fail", {"nodeId": self.node_id, "leaseToken": lease_token, "code": code, "detail": detail})
            except CineSwarmError:
                pass
            raise
        finally:
            self.active_tasks = 0

    def run_forever(self, *, poll_seconds: float = 5.0) -> None:
        while True:
            try:
                worked = self.run_once()
                if not worked:
                    time.sleep(poll_seconds)
            except KeyboardInterrupt:
                return
            except Exception as exc:
                print(json.dumps({"event": "NODE_ERROR", "nodeId": self.node_id, "type": type(exc).__name__, "message": str(exc)}, sort_keys=True), flush=True)
                time.sleep(poll_seconds)

