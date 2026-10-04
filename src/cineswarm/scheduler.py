from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True, frozen=True)
class ScheduleDecision:
    viable: bool
    backend_id: str | None
    strategy: str
    reason: str
    gpu_index: int | None = None
    score: tuple[int, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "viable": self.viable,
            "backendId": self.backend_id,
            "strategy": self.strategy,
            "reason": self.reason,
            "gpuIndex": self.gpu_index,
        }


class Scheduler:
    def choose_for_node(self, shot: dict[str, Any], hardware: dict[str, Any], capabilities: list[dict[str, Any]]) -> ScheduleDecision:
        by_id = {capability["backendId"]: capability for capability in capabilities}
        failures: list[str] = []
        for preference_index, backend_id in enumerate(shot["backendPreference"]):
            capability = by_id.get(backend_id)
            if not capability:
                failures.append(f"{backend_id}: backend not registered on node")
                continue
            if capability.get("externalProvider") is not False:
                failures.append(f"{backend_id}: external provider disabled")
                continue
            if capability.get("testOnly") and shot.get("acceptanceEligible", True):
                failures.append(f"{backend_id}: test-only backend prohibited for acceptance-eligible shot")
                continue
            requested_conditioning = {item.get("type") for item in shot.get("conditioning", [])}
            supported_conditioning = set(capability.get("supportedConditioning", []))
            if not requested_conditioning.issubset(supported_conditioning):
                failures.append(f"{backend_id}: unsupported conditioning {sorted(requested_conditioning - supported_conditioning)}")
                continue
            status = capability.get("modelStatus", "APPROVED")
            if status not in {"APPROVED", "AVAILABLE"}:
                failures.append(f"{backend_id}: model status {status}")
                continue
            if not self._delivery_supported(shot, capability):
                failures.append(f"{backend_id}: delivery cannot be produced by declared native/postprocess capability")
                continue
            best = self._best_profile(preference_index, backend_id, capability, hardware)
            if best.viable:
                return best
            failures.append(f"{backend_id}: {best.reason}")
        reason = "; ".join(failures) if failures else "No compatible backend preference"
        return ScheduleDecision(False, None, "UNSUPPORTED", reason)

    @staticmethod
    def _delivery_supported(shot: dict[str, Any], capability: dict[str, Any]) -> bool:
        delivery = shot["delivery"]
        desired = [delivery["width"], delivery["height"]]
        native = capability.get("nativeResolutions", [])
        if desired in native:
            return True
        transformations = capability.get("postprocess", [])
        return any(item.get("output") == desired and item.get("localOnly") is True for item in transformations if isinstance(item, dict))

    @staticmethod
    def _best_profile(preference_index: int, backend_id: str, capability: dict[str, Any], hardware: dict[str, Any]) -> ScheduleDecision:
        profiles = capability.get("vramProfiles", [])
        gpus = hardware.get("gpus", [])
        ram_free = int(hardware.get("ramFreeMiB", 0))
        disk_free = int(hardware.get("diskFreeMiB", 0))
        candidates: list[ScheduleDecision] = []
        rejection: list[str] = []
        for order, profile in enumerate(profiles):
            min_vram = int(profile.get("minimumVramMiB", 0))
            min_ram = int(profile.get("minimumRamMiB", 0))
            min_disk = int(profile.get("minimumDiskMiB", 0))
            if ram_free < min_ram:
                rejection.append(f"{profile['strategy']} needs {min_ram} MiB free RAM, has {ram_free}")
                continue
            if disk_free < min_disk:
                rejection.append(f"{profile['strategy']} needs {min_disk} MiB free disk, has {disk_free}")
                continue
            eligible_gpus = [gpu for gpu in gpus if int(gpu.get("vramFreeMiB", 0)) >= min_vram]
            if min_vram > 0 and not eligible_gpus:
                available = max((int(gpu.get("vramFreeMiB", 0)) for gpu in gpus), default=0)
                rejection.append(f"{profile['strategy']} needs {min_vram} MiB free VRAM on one GPU, best is {available}")
                continue
            gpu = max(eligible_gpus, key=lambda item: int(item.get("vramFreeMiB", 0))) if eligible_gpus else None
            gpu_index = int(gpu["index"]) if gpu is not None else None
            spare = int(gpu.get("vramFreeMiB", 0)) - min_vram if gpu else 0
            score = (preference_index, order, -spare, gpu_index if gpu_index is not None else 999)
            candidates.append(ScheduleDecision(True, backend_id, profile["strategy"], f"{profile['strategy']} fits declared VRAM/RAM/disk profile", gpu_index, score))
        if not candidates:
            return ScheduleDecision(False, backend_id, "UNSUPPORTED", "; ".join(rejection) or "No execution profile")
        return min(candidates, key=lambda item: item.score)
