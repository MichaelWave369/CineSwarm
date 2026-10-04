from __future__ import annotations

import json
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .canonical import canonical_json, sha256_bytes, sha256_file, sha256_json
from .errors import CineSwarmError
from .media import probe_media
from .paths import StorageLayout
from .scheduler import Scheduler
from .schemas import validate_capabilities, validate_hardware_profile, validate_production_plan, validate_review


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _probe_fps(stream: dict[str, Any]) -> float | None:
    value = stream.get("avg_frame_rate")
    if not isinstance(value, str) or not value:
        return None
    try:
        if "/" in value:
            numerator, denominator = value.split("/", 1)
            denominator_value = float(denominator)
            return None if denominator_value == 0 else float(numerator) / denominator_value
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


class CineStore:
    def __init__(self, storage: StorageLayout, *, lease_seconds: int = 900, node_stale_seconds: int = 90) -> None:
        self.storage = storage
        self.lease_seconds = lease_seconds
        self.node_stale_seconds = node_stale_seconds
        self.scheduler = Scheduler()
        self.storage.initialize()
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.storage.database_path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        return connection


    @contextmanager
    def read_connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize_database(self) -> None:
        with self.read_connection() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;

                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    plan_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL REFERENCES jobs(id),
                    shot_id TEXT NOT NULL,
                    shot_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    backend_id TEXT,
                    strategy TEXT,
                    assigned_node TEXT,
                    lease_token_hash TEXT,
                    lease_expires_at REAL,
                    attempt INTEGER NOT NULL DEFAULT 0,
                    last_schedule_reason TEXT,
                    failure_code TEXT,
                    failure_detail TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(job_id, shot_id)
                );

                CREATE TABLE IF NOT EXISTS nodes (
                    node_id TEXT PRIMARY KEY,
                    hostname TEXT NOT NULL,
                    os TEXT NOT NULL,
                    hardware_json TEXT NOT NULL,
                    capabilities_json TEXT NOT NULL,
                    workload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    registered_at TEXT NOT NULL,
                    last_seen_epoch REAL NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS models (
                    model_id TEXT PRIMARY KEY,
                    backend_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    manifest_json TEXT NOT NULL,
                    local_hash TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(id),
                    job_id TEXT NOT NULL REFERENCES jobs(id),
                    shot_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    backend_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    model_revision TEXT NOT NULL,
                    model_hash TEXT NOT NULL,
                    adapter_hashes_json TEXT NOT NULL,
                    seed INTEGER NOT NULL,
                    parameters_json TEXT NOT NULL,
                    conditioning_hashes_json TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    artifact_role TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    probe_json TEXT NOT NULL,
                    generation_seconds REAL NOT NULL,
                    gpu_used TEXT,
                    review_status TEXT NOT NULL,
                    external_provider_called INTEGER NOT NULL,
                    provider_fee_usd REAL NOT NULL,
                    public_release_authorized INTEGER NOT NULL,
                    source_artifact_hash TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS reviews (
                    id TEXT PRIMARY KEY,
                    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
                    artifact_hash TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    reason_codes_json TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    reviewer_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS training_signals (
                    id TEXT PRIMARY KEY,
                    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
                    artifact_hash TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    reason_codes_json TEXT NOT NULL,
                    qc_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS receipts (
                    sequence INTEGER PRIMARY KEY,
                    receipt_id TEXT NOT NULL UNIQUE,
                    event_type TEXT NOT NULL,
                    subject_type TEXT NOT NULL,
                    subject_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    previous_hash TEXT NOT NULL,
                    event_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state, created_at);
                CREATE INDEX IF NOT EXISTS idx_nodes_seen ON nodes(last_seen_epoch);
                CREATE INDEX IF NOT EXISTS idx_artifacts_review ON artifacts(review_status, created_at);
                CREATE INDEX IF NOT EXISTS idx_receipts_subject ON receipts(subject_type, subject_id, sequence);
                """
            )

    @staticmethod
    def _append_receipt(connection: sqlite3.Connection, event_type: str, subject_type: str, subject_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        row = connection.execute("SELECT sequence, event_hash FROM receipts ORDER BY sequence DESC LIMIT 1").fetchone()
        sequence = (int(row["sequence"]) + 1) if row else 1
        previous_hash = row["event_hash"] if row else "GENESIS"
        receipt_id = str(uuid.uuid4())
        created_at = utc_now()
        payload_json = canonical_json(payload)
        payload_hash = sha256_bytes(payload_json.encode("utf-8"))
        core = {
            "sequence": sequence,
            "receiptId": receipt_id,
            "eventType": event_type,
            "subjectType": subject_type,
            "subjectId": subject_id,
            "payloadHash": payload_hash,
            "previousHash": previous_hash,
            "createdAt": created_at,
        }
        event_hash = sha256_json(core)
        connection.execute(
            "INSERT INTO receipts(sequence,receipt_id,event_type,subject_type,subject_id,payload_json,payload_hash,previous_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (sequence, receipt_id, event_type, subject_type, subject_id, payload_json, payload_hash, previous_hash, event_hash, created_at),
        )
        return {**core, "payload": payload, "eventHash": event_hash}

    def submit_plan(self, source: dict[str, Any]) -> dict[str, Any]:
        plan = validate_production_plan(source)
        plan_hash = sha256_json(plan)
        now = utc_now()
        with self.transaction() as connection:
            existing = connection.execute("SELECT id,state,plan_hash FROM jobs WHERE idempotency_key=?", (plan["idempotencyKey"],)).fetchone()
            if existing:
                if existing["plan_hash"] != plan_hash:
                    raise CineSwarmError("IDEMPOTENCY_CONFLICT", "Idempotency key already belongs to different plan bytes", 409)
                return {"jobId": existing["id"], "state": existing["state"], "idempotentReplay": True, "planHash": plan_hash}
            job_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO jobs(id,project_id,idempotency_key,state,plan_json,plan_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (job_id, plan["projectId"], plan["idempotencyKey"], "QUEUED", canonical_json(plan), plan_hash, now, now),
            )
            self._append_receipt(connection, "JOB_ACCEPTED", "job", job_id, {
                "projectId": plan["projectId"], "planHash": plan_hash,
                "provider": "PARALLAX_NATIVE", "externalProviderCalled": False,
            })
            task_ids: list[str] = []
            for shot in plan["shots"]:
                task_id = str(uuid.uuid4())
                task_ids.append(task_id)
                connection.execute(
                    "INSERT INTO tasks(id,job_id,shot_id,shot_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                    (task_id, job_id, shot["shotId"], canonical_json(shot), "QUEUED", now, now),
                )
                self._append_receipt(connection, "SHOT_COMPILED", "task", task_id, {"jobId": job_id, "shotId": shot["shotId"], "shotHash": sha256_json(shot)})
            return {"jobId": job_id, "taskIds": task_ids, "state": "QUEUED", "idempotentReplay": False, "planHash": plan_hash}

    def register_node(self, hardware_source: dict[str, Any], capabilities_source: Any, workload: dict[str, Any] | None = None) -> dict[str, Any]:
        hardware = validate_hardware_profile(hardware_source)
        capabilities = validate_capabilities(capabilities_source)
        workload = workload or {"activeTasks": 0}
        node_id = hardware["nodeId"]
        now = utc_now()
        epoch = time.time()
        with self.transaction() as connection:
            existed = connection.execute("SELECT node_id FROM nodes WHERE node_id=?", (node_id,)).fetchone() is not None
            connection.execute(
                """INSERT INTO nodes(node_id,hostname,os,hardware_json,capabilities_json,workload_json,status,registered_at,last_seen_epoch,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(node_id) DO UPDATE SET hostname=excluded.hostname,os=excluded.os,hardware_json=excluded.hardware_json,
                capabilities_json=excluded.capabilities_json,workload_json=excluded.workload_json,status='ONLINE',last_seen_epoch=excluded.last_seen_epoch,updated_at=excluded.updated_at""",
                (node_id, hardware["hostname"], hardware["os"], canonical_json(hardware), canonical_json(capabilities), canonical_json(workload), "ONLINE", now, epoch, now),
            )
            self._append_receipt(connection, "NODE_UPDATED" if existed else "NODE_REGISTERED", "node", node_id, {
                "hardwareHash": sha256_json(hardware), "capabilitiesHash": sha256_json(capabilities), "gpuCount": len(hardware["gpus"]),
            })
        return {"nodeId": node_id, "status": "ONLINE", "registered": True}

    def heartbeat(self, node_id: str, hardware_source: dict[str, Any] | None, workload: dict[str, Any] | None) -> dict[str, Any]:
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM nodes WHERE node_id=?", (node_id,)).fetchone()
            if not row:
                raise CineSwarmError("NODE_UNKNOWN", "Node must register before heartbeat", 404)
            hardware_json = row["hardware_json"]
            if hardware_source is not None:
                hardware = validate_hardware_profile(hardware_source)
                if hardware["nodeId"] != node_id:
                    raise CineSwarmError("NODE_ID_MISMATCH", "Heartbeat hardware nodeId does not match path", 409)
                hardware_json = canonical_json(hardware)
            workload_json = canonical_json(workload or json.loads(row["workload_json"]))
            connection.execute("UPDATE nodes SET hardware_json=?,workload_json=?,status='ONLINE',last_seen_epoch=?,updated_at=? WHERE node_id=?", (hardware_json, workload_json, time.time(), utc_now(), node_id))
        return {"nodeId": node_id, "status": "ONLINE"}

    def _recover_expired_leases(self, connection: sqlite3.Connection) -> int:
        rows = connection.execute("SELECT id,assigned_node,attempt FROM tasks WHERE state IN ('LEASED','RUNNING') AND lease_expires_at < ?", (time.time(),)).fetchall()
        for row in rows:
            connection.execute(
                "UPDATE tasks SET state='QUEUED',backend_id=NULL,strategy=NULL,assigned_node=NULL,lease_token_hash=NULL,lease_expires_at=NULL,failure_code='WORKER_LEASE_EXPIRED',failure_detail='Lease expired before completion',updated_at=? WHERE id=?",
                (utc_now(), row["id"]),
            )
            self._append_receipt(connection, "WORKER_LEASE_EXPIRED", "task", row["id"], {"nodeId": row["assigned_node"], "attempt": row["attempt"]})
        return len(rows)

    def claim_task(self, node_id: str) -> dict[str, Any] | None:
        with self.transaction() as connection:
            self._recover_expired_leases(connection)
            node = connection.execute("SELECT * FROM nodes WHERE node_id=?", (node_id,)).fetchone()
            if not node:
                raise CineSwarmError("NODE_UNKNOWN", "Node must register before claiming", 404)
            if time.time() - float(node["last_seen_epoch"]) > self.node_stale_seconds:
                raise CineSwarmError("NODE_OFFLINE", "Node heartbeat is stale", 409)
            hardware = json.loads(node["hardware_json"])
            capabilities = json.loads(node["capabilities_json"])
            rows = connection.execute("SELECT * FROM tasks WHERE state='QUEUED' ORDER BY created_at,id LIMIT 100").fetchall()
            first_failure: tuple[str, str] | None = None
            for row in rows:
                shot = json.loads(row["shot_json"])
                decision = self.scheduler.choose_for_node(shot, hardware, capabilities)
                if not decision.viable:
                    if first_failure is None:
                        first_failure = (row["id"], decision.reason)
                    continue
                token = secrets.token_urlsafe(32)
                token_hash = sha256_bytes(token.encode("utf-8"))
                expiry = time.time() + self.lease_seconds
                updated = connection.execute(
                    """UPDATE tasks SET state='LEASED',backend_id=?,strategy=?,assigned_node=?,lease_token_hash=?,lease_expires_at=?,attempt=attempt+1,
                    last_schedule_reason=?,failure_code=NULL,failure_detail=NULL,updated_at=? WHERE id=? AND state='QUEUED'""",
                    (decision.backend_id, decision.strategy, node_id, token_hash, expiry, decision.reason, utc_now(), row["id"]),
                )
                if updated.rowcount != 1:
                    continue
                connection.execute("UPDATE jobs SET state='ACTIVE',updated_at=? WHERE id=? AND state='QUEUED'", (utc_now(), row["job_id"]))
                self._append_receipt(connection, "RENDER_ASSIGNED", "task", row["id"], {
                    "jobId": row["job_id"], "shotId": row["shot_id"], "nodeId": node_id,
                    "backendId": decision.backend_id, "strategy": decision.strategy, "selectionReason": decision.reason,
                    "gpuIndex": decision.gpu_index, "leaseExpiresEpoch": expiry,
                })
                return {
                    "taskId": row["id"], "jobId": row["job_id"], "shotId": row["shot_id"], "shot": shot,
                    "backendId": decision.backend_id, "strategy": decision.strategy, "gpuIndex": decision.gpu_index,
                    "selectionReason": decision.reason, "leaseToken": token, "leaseExpiresEpoch": expiry,
                    "attempt": int(row["attempt"]) + 1,
                }
            if first_failure:
                connection.execute("UPDATE tasks SET last_schedule_reason=?,updated_at=? WHERE id=?", (first_failure[1], utc_now(), first_failure[0]))
            return None

    @staticmethod
    def _validate_lease(row: sqlite3.Row, node_id: str, lease_token: str, *, allowed_states: set[str]) -> None:
        if row["state"] not in allowed_states:
            raise CineSwarmError("STALE_STATE", f"Task state {row['state']} is not valid for this operation", 409)
        if row["assigned_node"] != node_id:
            raise CineSwarmError("LEASE_NODE_MISMATCH", "Task is leased to a different node", 409)
        if not row["lease_token_hash"] or sha256_bytes(lease_token.encode("utf-8")) != row["lease_token_hash"]:
            raise CineSwarmError("LEASE_INVALID", "Lease token does not match", 401)
        if float(row["lease_expires_at"] or 0) < time.time():
            raise CineSwarmError("LEASE_EXPIRED", "Task lease has expired", 409)

    def start_task(self, task_id: str, node_id: str, lease_token: str) -> dict[str, Any]:
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise CineSwarmError("TASK_UNKNOWN", "Task was not found", 404)
            self._validate_lease(row, node_id, lease_token, allowed_states={"LEASED"})
            connection.execute("UPDATE tasks SET state='RUNNING',updated_at=? WHERE id=?", (utc_now(), task_id))
            self._append_receipt(connection, "RENDER_STARTED", "task", task_id, {"nodeId": node_id, "attempt": row["attempt"], "backendId": row["backend_id"]})
            return {"taskId": task_id, "state": "RUNNING"}

    def fail_task(self, task_id: str, node_id: str, lease_token: str, code: str, detail: str) -> dict[str, Any]:
        safe_detail = detail[-8000:]
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise CineSwarmError("TASK_UNKNOWN", "Task was not found", 404)
            self._validate_lease(row, node_id, lease_token, allowed_states={"LEASED", "RUNNING"})
            connection.execute("UPDATE tasks SET state='FAILED',failure_code=?,failure_detail=?,lease_token_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?", (code, safe_detail, utc_now(), task_id))
            connection.execute("UPDATE jobs SET state='FAILED',updated_at=? WHERE id=?", (utc_now(), row["job_id"]))
            self._append_receipt(connection, "RENDER_FAILED", "task", task_id, {"nodeId": node_id, "attempt": row["attempt"], "failureCode": code, "detailHash": sha256_bytes(safe_detail.encode("utf-8"))})
        return {"taskId": task_id, "state": "FAILED", "failureCode": code}

    def ingest_artifact(self, task_id: str, node_id: str, lease_token: str, incoming: Path, expected_sha256: str, metadata: dict[str, Any]) -> dict[str, Any]:
        observed_sha = sha256_file(incoming)
        if observed_sha != expected_sha256:
            quarantined = self.storage.quarantine(incoming, "hash-mismatch")
            self.fail_task(task_id, node_id, lease_token, "ARTIFACT_HASH_MISMATCH", f"Expected {expected_sha256}; observed {observed_sha}; quarantined {quarantined.name}")
            raise CineSwarmError("ARTIFACT_HASH_MISMATCH", "Uploaded artifact bytes do not match X-Body-SHA256", 409)
        media_type = metadata.get("mediaType")
        role = metadata.get("artifactRole")
        finalize = metadata.get("finalizeTask") is True
        if not isinstance(media_type, str) or not isinstance(role, str):
            quarantined = self.storage.quarantine(incoming, "bad-metadata")
            self.fail_task(task_id, node_id, lease_token, "SCHEMA_INVALID", f"Artifact metadata invalid; quarantined {quarantined.name}")
            raise CineSwarmError("SCHEMA_INVALID", "Artifact metadata requires mediaType and artifactRole", 400)
        backend = metadata.get("backend", {})
        if backend.get("externalProviderCalled") is not False or float(backend.get("providerFeeUsd", 0.0)) != 0.0:
            quarantined = self.storage.quarantine(incoming, "external-provider")
            self.fail_task(task_id, node_id, lease_token, "EXTERNAL_PROVIDER_DISABLED", f"External-provider artifact rejected; quarantined {quarantined.name}")
            raise CineSwarmError("EXTERNAL_PROVIDER_DISABLED", "Native acceptance path requires no external provider and zero direct provider fee", 403)
        probe = probe_media(incoming) if media_type == "video/mp4" else {"probeStatus": "NOT_APPLICABLE", "reason": "Non-media test fixture"}
        if media_type == "video/mp4" and probe.get("probeStatus") != "PASSED":
            quarantined = self.storage.quarantine(incoming, "qc-failed")
            self.fail_task(task_id, node_id, lease_token, "QC_FAILED", f"ffprobe failed; quarantined {quarantined.name}")
            raise CineSwarmError("QC_FAILED", "Uploaded MP4 did not pass ffprobe", 422, {"probe": probe})
        if media_type == "video/mp4" and role == "master":
            with self.read_connection() as qc_connection:
                qc_task = qc_connection.execute("SELECT shot_json FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not qc_task:
                raise CineSwarmError("TASK_UNKNOWN", "Task was not found", 404)
            qc_shot = json.loads(qc_task["shot_json"])
            delivery = qc_shot["delivery"]
            video_streams = [stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"]
            video = video_streams[0] if video_streams else {}
            observed_fps = _probe_fps(video)
            mismatch: dict[str, Any] = {}
            if video.get("width") != delivery["width"]:
                mismatch["width"] = {"expected": delivery["width"], "observed": video.get("width")}
            if video.get("height") != delivery["height"]:
                mismatch["height"] = {"expected": delivery["height"], "observed": video.get("height")}
            if observed_fps is None or abs(observed_fps - float(delivery["fps"])) > 0.1:
                mismatch["fps"] = {"expected": delivery["fps"], "observed": observed_fps}
            if mismatch:
                quarantined = self.storage.quarantine(incoming, "delivery-qc-failed")
                self.fail_task(task_id, node_id, lease_token, "QC_FAILED", f"Master delivery contract mismatch; quarantined {quarantined.name}; {mismatch}")
                raise CineSwarmError("QC_FAILED", "Uploaded master does not match ProductionPlan delivery contract", 422, {"mismatch": mismatch, "probe": probe})
        extension = ".mp4" if media_type == "video/mp4" else ".json" if media_type.endswith("+json") else ".bin"
        artifact_id = str(uuid.uuid4())
        now = utc_now()
        with self.transaction() as connection:
            task = connection.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not task:
                raise CineSwarmError("TASK_UNKNOWN", "Task was not found", 404)
            self._validate_lease(task, node_id, lease_token, allowed_states={"RUNNING"})
            promoted = self.storage.promote_content_addressed(incoming, observed_sha, extension)
            relative = promoted.relative_to(self.storage.root).as_posix()
            review_status = "PENDING_REVIEW" if media_type == "video/mp4" and role == "master" and metadata.get("acceptanceEligible", True) else "NOT_APPLICABLE"
            shot = json.loads(task["shot_json"])
            conditioning_hashes = [item.get("artifactHash") for item in shot.get("conditioning", [])]
            connection.execute(
                """INSERT INTO artifacts(id,task_id,job_id,shot_id,node_id,backend_id,model_id,model_revision,model_hash,adapter_hashes_json,seed,
                parameters_json,conditioning_hashes_json,relative_path,media_type,artifact_role,size_bytes,sha256,probe_json,generation_seconds,gpu_used,
                review_status,external_provider_called,provider_fee_usd,public_release_authorized,source_artifact_hash,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    artifact_id, task_id, task["job_id"], task["shot_id"], node_id, task["backend_id"],
                    str(backend.get("modelId", "unknown")), str(backend.get("modelRevision", "unknown")), str(backend.get("modelHash", "unknown")),
                    canonical_json(backend.get("adapterHashes", [])), int(shot.get("seed", 0)), canonical_json(metadata.get("parameters", {})),
                    canonical_json(conditioning_hashes), relative, media_type, role, promoted.stat().st_size, observed_sha, canonical_json(probe),
                    float(metadata.get("generationSeconds", 0.0)), str(metadata.get("gpuUsed", "unknown")), review_status, 0, 0.0, 0,
                    metadata.get("sourceArtifactHash"), now,
                ),
            )
            self._append_receipt(connection, "MEDIA_HASHED", "artifact", artifact_id, {"taskId": task_id, "sha256": observed_sha, "sizeBytes": promoted.stat().st_size, "role": role})
            self._append_receipt(connection, "QC_COMPLETED", "artifact", artifact_id, {"probeStatus": probe.get("probeStatus"), "probeHash": sha256_json(probe), "reviewStatus": review_status})
            if finalize:
                connection.execute("UPDATE tasks SET state='COMPLETED',lease_token_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?", (now, task_id))
                self._append_receipt(connection, "RENDER_COMPLETED", "task", task_id, {"artifactId": artifact_id, "artifactHash": observed_sha, "nodeId": node_id, "externalProviderCalled": False, "providerFeeUsd": 0.0})
                incomplete = connection.execute("SELECT COUNT(*) AS count FROM tasks WHERE job_id=? AND state!='COMPLETED'", (task["job_id"],)).fetchone()["count"]
                if int(incomplete) == 0:
                    connection.execute("UPDATE jobs SET state='COMPLETED',updated_at=? WHERE id=?", (now, task["job_id"]))
            return {"artifactId": artifact_id, "artifactHash": observed_sha, "relativePath": relative, "probe": probe, "reviewStatus": review_status, "taskFinalized": finalize}

    def review_artifact(self, artifact_id: str, source: dict[str, Any]) -> dict[str, Any]:
        review = validate_review(source)
        now = utc_now()
        with self.transaction() as connection:
            artifact = connection.execute("SELECT * FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
            if not artifact:
                raise CineSwarmError("ARTIFACT_UNKNOWN", "Artifact was not found", 404)
            if artifact["review_status"] not in {"PENDING_REVIEW", "REVISION_REQUESTED"}:
                raise CineSwarmError("REVIEW_STATE_INVALID", f"Artifact review state is {artifact['review_status']}", 409)
            if review["artifactHash"] != artifact["sha256"]:
                raise CineSwarmError("REVIEW_HASH_MISMATCH", "Human decision must bind to the exact artifact SHA-256", 409)
            review_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO reviews(id,artifact_id,artifact_hash,decision,reason_codes_json,notes,reviewer_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (review_id, artifact_id, artifact["sha256"], review["decision"], canonical_json(review["reasonCodes"]), review["notes"], review["reviewerId"], now),
            )
            connection.execute("UPDATE artifacts SET review_status=? WHERE id=?", (review["decision"], artifact_id))
            signal_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO training_signals(id,artifact_id,artifact_hash,model_id,decision,reason_codes_json,qc_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (signal_id, artifact_id, artifact["sha256"], artifact["model_id"], review["decision"], canonical_json(review["reasonCodes"]), artifact["probe_json"], now),
            )
            event = {"ACCEPT": "HUMAN_ACCEPTED", "REJECT": "HUMAN_REJECTED", "REVISION_REQUESTED": "REVISION_REQUESTED"}[review["decision"]]
            self._append_receipt(connection, event, "artifact", artifact_id, {"artifactHash": artifact["sha256"], "reviewId": review_id, "reviewerId": review["reviewerId"], "reasonCodes": review["reasonCodes"], "publicReleaseAuthorized": False})
            self._append_receipt(connection, "TRAINING_SIGNAL_CREATED", "training-signal", signal_id, {"artifactId": artifact_id, "artifactHash": artifact["sha256"], "decision": review["decision"]})
            return {"reviewId": review_id, "artifactId": artifact_id, "artifactHash": artifact["sha256"], "decision": review["decision"], "trainingSignalId": signal_id, "publicReleaseAuthorized": False}

    def register_model_manifest(self, manifest: dict[str, Any]) -> dict[str, Any]:
        required = {"modelId", "backendId", "status", "source", "revision", "localHash", "license", "sizeBytes", "runtime", "vramProfiles", "approvedUse"}
        missing = sorted(required - manifest.keys())
        if missing:
            raise CineSwarmError("MODEL_MANIFEST_INVALID", "ModelManifest is missing required fields", 400, {"missing": missing})
        if manifest["status"] not in {"AVAILABLE", "TESTING", "APPROVED", "DEPRECATED", "BLOCKED"}:
            raise CineSwarmError("MODEL_MANIFEST_INVALID", "Unknown model status", 400)
        with self.transaction() as connection:
            connection.execute(
                "INSERT INTO models(model_id,backend_id,status,manifest_json,local_hash,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(model_id) DO UPDATE SET backend_id=excluded.backend_id,status=excluded.status,manifest_json=excluded.manifest_json,local_hash=excluded.local_hash,updated_at=excluded.updated_at",
                (manifest["modelId"], manifest["backendId"], manifest["status"], canonical_json(manifest), manifest["localHash"], utc_now()),
            )
            self._append_receipt(connection, "MODEL_MANIFEST_REGISTERED", "model", manifest["modelId"], {"backendId": manifest["backendId"], "status": manifest["status"], "localHash": manifest["localHash"], "manifestHash": sha256_json(manifest)})
        return {"modelId": manifest["modelId"], "status": manifest["status"], "registered": True}

    def verify_receipt_chain(self) -> dict[str, Any]:
        with self.read_connection() as connection:
            rows = connection.execute("SELECT * FROM receipts ORDER BY sequence").fetchall()
        previous = "GENESIS"
        for expected_sequence, row in enumerate(rows, start=1):
            payload_hash = sha256_bytes(row["payload_json"].encode("utf-8"))
            core = {
                "sequence": int(row["sequence"]), "receiptId": row["receipt_id"], "eventType": row["event_type"],
                "subjectType": row["subject_type"], "subjectId": row["subject_id"], "payloadHash": row["payload_hash"],
                "previousHash": row["previous_hash"], "createdAt": row["created_at"],
            }
            if int(row["sequence"]) != expected_sequence or row["previous_hash"] != previous or row["payload_hash"] != payload_hash or row["event_hash"] != sha256_json(core):
                return {"valid": False, "failureSequence": int(row["sequence"]), "expectedPreviousHash": previous}
            previous = row["event_hash"]
        return {"valid": True, "receiptCount": len(rows), "headHash": previous}

    def export_receipts(self) -> list[dict[str, Any]]:
        with self.read_connection() as connection:
            rows = connection.execute("SELECT * FROM receipts ORDER BY sequence").fetchall()
        return [{
            "sequence": row["sequence"], "receiptId": row["receipt_id"], "eventType": row["event_type"],
            "subjectType": row["subject_type"], "subjectId": row["subject_id"], "payload": json.loads(row["payload_json"]),
            "payloadHash": row["payload_hash"], "previousHash": row["previous_hash"], "eventHash": row["event_hash"], "createdAt": row["created_at"],
        } for row in rows]

    def status(self) -> dict[str, Any]:
        now_epoch = time.time()
        with self.read_connection() as connection:
            task_counts = {row["state"]: row["count"] for row in connection.execute("SELECT state,COUNT(*) AS count FROM tasks GROUP BY state")}
            job_counts = {row["state"]: row["count"] for row in connection.execute("SELECT state,COUNT(*) AS count FROM jobs GROUP BY state")}
            review_counts = {row["review_status"]: row["count"] for row in connection.execute("SELECT review_status,COUNT(*) AS count FROM artifacts GROUP BY review_status")}
            nodes = []
            for row in connection.execute("SELECT * FROM nodes ORDER BY node_id"):
                online = now_epoch - float(row["last_seen_epoch"]) <= self.node_stale_seconds
                nodes.append({
                    "nodeId": row["node_id"], "hostname": row["hostname"], "os": row["os"], "status": "ONLINE" if online else "OFFLINE",
                    "lastSeenEpoch": row["last_seen_epoch"], "hardware": json.loads(row["hardware_json"]),
                    "capabilities": json.loads(row["capabilities_json"]), "workload": json.loads(row["workload_json"]),
                })
            models = [{"modelId": row["model_id"], "backendId": row["backend_id"], "status": row["status"], "localHash": row["local_hash"], "manifest": json.loads(row["manifest_json"])} for row in connection.execute("SELECT * FROM models ORDER BY model_id")]
            artifacts = connection.execute("SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes FROM artifacts").fetchone()
            signals = connection.execute("SELECT COUNT(*) AS count FROM training_signals").fetchone()["count"]
            recent_failures = [{"taskId": row["id"], "shotId": row["shot_id"], "code": row["failure_code"], "detail": row["failure_detail"], "scheduleReason": row["last_schedule_reason"]} for row in connection.execute("SELECT * FROM tasks WHERE state='FAILED' OR last_schedule_reason IS NOT NULL ORDER BY updated_at DESC LIMIT 20")]
            review_queue = [{"artifactId": row["id"], "artifactHash": row["sha256"], "jobId": row["job_id"], "shotId": row["shot_id"], "role": row["artifact_role"], "relativePath": row["relative_path"], "probe": json.loads(row["probe_json"])} for row in connection.execute("SELECT * FROM artifacts WHERE review_status='PENDING_REVIEW' ORDER BY created_at LIMIT 100")]
        return {
            "provider": "PARALLAX_NATIVE", "externalProviderCalled": False,
            "jobs": job_counts, "tasks": task_counts, "nodes": nodes, "models": models,
            "artifacts": {"count": artifacts["count"], "sizeBytes": artifacts["bytes"], "reviewStates": review_counts},
            "reviewQueue": review_queue, "trainingSignals": signals, "receiptChain": self.verify_receipt_chain(), "recentFailures": recent_failures,
        }

    def raw_connection_for_tests(self) -> sqlite3.Connection:
        """Explicit test hook. Callers own and close the returned connection."""
        return self._connect()
