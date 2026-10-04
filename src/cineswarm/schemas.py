from __future__ import annotations

import copy
import re
from typing import Any

from .errors import CineSwarmError, require


SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_DECISIONS = {"ACCEPT", "REJECT", "REVISION_REQUESTED"}


def _safe_id(value: Any, field: str) -> str:
    require(isinstance(value, str) and SAFE_ID.fullmatch(value) is not None, "SCHEMA_INVALID", f"{field} must be a safe 1–64 character identifier", field=field)
    return value


def _sha(value: Any, field: str) -> str:
    require(isinstance(value, str) and SHA256.fullmatch(value) is not None, "SCHEMA_INVALID", f"{field} must be a lowercase SHA-256", field=field)
    return value


def validate_production_plan(source: dict[str, Any]) -> dict[str, Any]:
    require(isinstance(source, dict), "SCHEMA_INVALID", "ProductionPlan must be a JSON object")
    plan = copy.deepcopy(source)
    require(plan.get("schemaVersion") == "production-plan/v1", "SCHEMA_INVALID", "Unsupported ProductionPlan schemaVersion")
    plan["projectId"] = _safe_id(plan.get("projectId"), "projectId")
    idempotency = plan.get("idempotencyKey")
    require(isinstance(idempotency, str) and 1 <= len(idempotency) <= 128, "SCHEMA_INVALID", "idempotencyKey must contain 1–128 characters")
    lineage = plan.get("lineage")
    require(isinstance(lineage, dict), "SCHEMA_INVALID", "lineage is required")
    lineage["sourceSystem"] = _safe_id(lineage.get("sourceSystem"), "lineage.sourceSystem")
    lineage["sourceHash"] = _sha(lineage.get("sourceHash"), "lineage.sourceHash")
    shots = plan.get("shots")
    require(isinstance(shots, list) and 1 <= len(shots) <= 1000, "SCHEMA_INVALID", "shots must contain 1–1000 items")
    seen: set[str] = set()
    for index, shot in enumerate(shots):
        require(isinstance(shot, dict), "SCHEMA_INVALID", "Each shot must be an object", shotIndex=index)
        shot_id = _safe_id(shot.get("shotId"), f"shots[{index}].shotId")
        require(shot_id not in seen, "SCHEMA_INVALID", "shotId values must be unique", shotId=shot_id)
        seen.add(shot_id)
        prompt = shot.get("prompt")
        require(isinstance(prompt, str) and 1 <= len(prompt) <= 20_000, "SCHEMA_INVALID", "Shot prompt must contain 1–20,000 characters", shotId=shot_id)
        duration = shot.get("durationSeconds")
        require(isinstance(duration, (int, float)) and 0.25 <= float(duration) <= 60, "SCHEMA_INVALID", "durationSeconds must be between 0.25 and 60", shotId=shot_id)
        delivery = shot.get("delivery")
        require(isinstance(delivery, dict), "SCHEMA_INVALID", "delivery is required", shotId=shot_id)
        for name, low, high in (("width", 64, 8192), ("height", 64, 8192), ("fps", 1, 240)):
            value = delivery.get(name)
            require(isinstance(value, int) and low <= value <= high, "SCHEMA_INVALID", f"delivery.{name} is outside its allowed range", shotId=shot_id)
        require(delivery.get("container") == "mp4", "SCHEMA_INVALID", "v0.1 delivery container must be mp4", shotId=shot_id)
        preference = shot.get("backendPreference")
        require(isinstance(preference, list) and preference and all(isinstance(item, str) and SAFE_ID.fullmatch(item) for item in preference), "SCHEMA_INVALID", "backendPreference must contain safe backend IDs", shotId=shot_id)
        conditioning = shot.setdefault("conditioning", [])
        require(isinstance(conditioning, list), "CONDITIONING_INVALID", "conditioning must be an array", shotId=shot_id)
        for item in conditioning:
            require(isinstance(item, dict), "CONDITIONING_INVALID", "conditioning items must be objects", shotId=shot_id)
            require(not any(key in item for key in ("localPath", "path", "url")), "MALICIOUS_PATH", "ProductionPlan conditioning may reference only registered artifact hashes, never direct paths or URLs", shotId=shot_id)
            _sha(item.get("artifactHash"), "conditioning.artifactHash")
            require(isinstance(item.get("type"), str) and SAFE_ID.fullmatch(item["type"]), "CONDITIONING_INVALID", "conditioning.type is invalid", shotId=shot_id)
        require(shot.get("publicReleaseAuthorized") is False, "RELEASE_NOT_AUTHORIZED", "ProductionPlan may not pre-authorize public release in v0.1", status=403, shotId=shot_id)
        shot.setdefault("acceptanceEligible", True)
        require(isinstance(shot["acceptanceEligible"], bool), "SCHEMA_INVALID", "acceptanceEligible must be boolean", shotId=shot_id)
        if "seed" in shot:
            require(isinstance(shot["seed"], int) and 0 <= shot["seed"] < 2**63, "SCHEMA_INVALID", "seed is invalid", shotId=shot_id)
        else:
            shot["seed"] = 369
    return plan


def validate_hardware_profile(source: dict[str, Any]) -> dict[str, Any]:
    require(isinstance(source, dict), "SCHEMA_INVALID", "HardwareProfile must be an object")
    profile = copy.deepcopy(source)
    profile["nodeId"] = _safe_id(profile.get("nodeId"), "nodeId")
    require(isinstance(profile.get("hostname"), str) and profile["hostname"], "SCHEMA_INVALID", "hostname is required")
    require(isinstance(profile.get("os"), str) and profile["os"], "SCHEMA_INVALID", "os is required")
    for field in ("ramTotalMiB", "ramFreeMiB", "diskFreeMiB"):
        require(isinstance(profile.get(field), int) and profile[field] >= 0, "SCHEMA_INVALID", f"{field} must be a nonnegative integer")
    gpus = profile.setdefault("gpus", [])
    require(isinstance(gpus, list) and len(gpus) <= 32, "SCHEMA_INVALID", "gpus must be an array")
    for gpu in gpus:
        require(isinstance(gpu, dict), "SCHEMA_INVALID", "GPU entries must be objects")
        require(isinstance(gpu.get("name"), str) and gpu["name"], "SCHEMA_INVALID", "GPU name is required")
        for field in ("vramTotalMiB", "vramFreeMiB"):
            require(isinstance(gpu.get(field), int) and gpu[field] >= 0, "SCHEMA_INVALID", f"GPU {field} must be nonnegative")
    return profile


def validate_capabilities(source: Any) -> list[dict[str, Any]]:
    require(isinstance(source, list), "SCHEMA_INVALID", "capabilities must be an array")
    result: list[dict[str, Any]] = []
    for item in source:
        require(isinstance(item, dict), "SCHEMA_INVALID", "capability entries must be objects")
        capability = copy.deepcopy(item)
        capability["backendId"] = _safe_id(capability.get("backendId"), "backendId")
        require(capability.get("protocolVersion") == "video-backend/v1", "SCHEMA_INVALID", "Unsupported backend protocol")
        require(capability.get("externalProvider") is False, "EXTERNAL_PROVIDER_DISABLED", "External-provider backends are disabled", status=403)
        profiles = capability.get("vramProfiles")
        require(isinstance(profiles, list) and profiles, "SCHEMA_INVALID", "Backend requires at least one execution profile")
        for profile in profiles:
            require(profile.get("strategy") in {"FULL_GPU", "QUANTIZED_GPU", "CPU_OFFLOAD", "SEQUENTIAL_OFFLOAD", "TILED", "DISTRIBUTED_PREPOST"}, "SCHEMA_INVALID", "Unknown execution strategy")
            for field in ("minimumVramMiB", "minimumRamMiB", "minimumDiskMiB"):
                require(isinstance(profile.get(field, 0), int) and profile.get(field, 0) >= 0, "SCHEMA_INVALID", f"{field} must be nonnegative")
        result.append(capability)
    return result


def validate_review(source: dict[str, Any]) -> dict[str, Any]:
    require(isinstance(source, dict), "SCHEMA_INVALID", "Review must be an object")
    review = copy.deepcopy(source)
    require(review.get("decision") in ALLOWED_DECISIONS, "SCHEMA_INVALID", "Unknown review decision")
    review["artifactHash"] = _sha(review.get("artifactHash"), "artifactHash")
    review["reviewerId"] = _safe_id(review.get("reviewerId"), "reviewerId")
    reasons = review.setdefault("reasonCodes", [])
    require(isinstance(reasons, list) and len(reasons) <= 32, "SCHEMA_INVALID", "reasonCodes must be an array")
    for reason in reasons:
        _safe_id(reason, "reasonCodes[]")
    notes = review.setdefault("notes", "")
    require(isinstance(notes, str) and len(notes) <= 10_000, "SCHEMA_INVALID", "notes is too long")
    return review
