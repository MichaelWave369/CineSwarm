from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from cineswarm.canonical import canonical_json, sha256_file, sha256_json
from cineswarm.media import probe_media
from cineswarm.paths import StorageLayout
from cineswarm.reel_media_evidence import (
    SCHEMA, MediaEvidenceDenied, build_media_evidence,
)
from cineswarm.store import CineStore

JOB = "11111111-1111-4111-8111-111111111111"
TASK = "22222222-2222-4222-8222-222222222222"
MASTER = "33333333-3333-4333-8333-333333333333"
NATIVE = "44444444-4444-4444-8444-444444444444"
REVIEW = "55555555-5555-4555-8555-555555555555"
SRC = "a"*64
MODEL = "b"*64


def make_plan() -> dict:
    return {
        "schemaVersion": "production-plan/v1",
        "projectId": "reel-p001-"+SRC[:12],
        "idempotencyKey": "p001-s01-wan21-"+SRC[:32],
        "lineage": {"sourceSystem": "REEL_P001", "sourceHash": SRC},
        "shots": [{
            "shotId": "reel-p001-s01", "prompt": "Original luminous point in black theatre.",
            "durationSeconds": 8, "delivery": {"width": 1280, "height": 720, "fps": 24, "container": "mp4"},
            "backendPreference": ["wan21-t2v-1.3b"], "conditioning": [],
            "seed": 369, "acceptanceEligible": True, "publicReleaseAuthorized": False,
        }],
    }


class MediaEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.layout = StorageLayout(Path(self.temp.name))
        self.store = CineStore(self.layout)
        self.plan = make_plan()
        self.plan_hash = sha256_json(self.plan)
        self.paths = {}

        for role, size, fps in (("native", "832x480", 16), ("master", "1280x720", 24)):
            temp_path = self.layout.root / f"{role}-temp.mp4"
            completed = subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", f"color=c=black:s={size}:r={fps}",
                "-t", "8", "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", str(temp_path),
            ], capture_output=True, text=True, timeout=90)
            if completed.returncode != 0:
                self.fail("ffmpeg test media unavailable: "+completed.stderr)
            digest = sha256_file(temp_path)
            target = self.layout.root / "assets" / "generated" / "sha256" / digest[:2] / f"{digest}.mp4"
            target.parent.mkdir(parents=True, exist_ok=True)
            temp_path.rename(target)
            self.paths[role] = (target, digest)
        with self.store.transaction() as db:
            db.execute(
                "INSERT INTO jobs(id,project_id,idempotency_key,state,plan_json,plan_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (JOB, self.plan["projectId"], self.plan["idempotencyKey"], "COMPLETED",
                 canonical_json(self.plan), self.plan_hash, "2026-10-25T00:00:00.000Z", "2026-10-25T00:00:00.000Z"),
            )
            db.execute(
                "INSERT INTO tasks(id,job_id,shot_id,shot_json,state,backend_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (TASK, JOB, "reel-p001-s01", canonical_json(self.plan["shots"][0]), "COMPLETED",
                 "wan21-t2v-1.3b", "2026-10-25T00:00:00.000Z", "2026-10-25T00:00:00.000Z"),
            )
            CineStore._append_receipt(db, "JOB_ACCEPTED", "job", JOB, {"planHash": self.plan_hash})
            CineStore._append_receipt(db, "SHOT_COMPILED", "task", TASK, {"shotId": "reel-p001-s01"})
            for role, identifier in (("native", NATIVE), ("master", MASTER)):
                path, digest = self.paths[role]
                probe = probe_media(path)
                self.assertEqual(probe["probeStatus"], "PASSED")
                relative = path.relative_to(self.layout.root).as_posix()
                db.execute(
                    """INSERT INTO artifacts(
                        id,task_id,job_id,shot_id,node_id,backend_id,model_id,model_revision,
                        model_hash,adapter_hashes_json,seed,parameters_json,conditioning_hashes_json,
                        relative_path,media_type,artifact_role,size_bytes,sha256,probe_json,
                        generation_seconds,gpu_used,review_status,external_provider_called,
                        provider_fee_usd,public_release_authorized,source_artifact_hash,created_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (identifier,TASK,JOB,"reel-p001-s01","NODE-01",
                     "wan21-t2v-1.3b","Wan-AI/Wan2.1-T2V-1.3B","operator-pinned",
                     MODEL,"[]",369,"{}","[]",relative,"video/mp4",role,path.stat().st_size,
                     digest,canonical_json(probe),8.0,"RTX-TEST",
                     "PENDING_REVIEW" if role == "master" else "NOT_APPLICABLE",
                     0,0.0,0,self.paths["native"][1] if role=="master" else None,
                     "2026-10-25T00:00:00.000Z"),
                )
                CineStore._append_receipt(db,"MEDIA_HASHED","artifact",identifier,{"sha256":digest})
                CineStore._append_receipt(db,"QC_COMPLETED","artifact",identifier,{"probeStatus":"PASSED"})
            CineStore._append_receipt(db,"RENDER_COMPLETED","task",TASK,{"artifactHash":self.paths["master"][1]})

    def test_real_two_mp4_provenance_is_rechecked_with_pending_human_review(self):
        result = build_media_evidence(self.layout.root, MASTER)
        self.assertEqual(result["schema"], SCHEMA)
        self.assertEqual(result["shotId"], "reel-p001-s01")
        self.assertEqual(result["lineage"]["sourceHash"], SRC)
        self.assertEqual(result["master"]["sha256"], self.paths["master"][1])
        self.assertEqual(result["native"]["sha256"], self.paths["native"][1])
        self.assertEqual(result["master"]["width"], 1280)
        self.assertEqual(result["native"]["width"], 832)
        self.assertEqual(result["review"]["decision"], "PENDING_REVIEW")
        self.assertFalse(result["review"]["exactHashDecisionRecorded"])
        self.assertTrue(result["integrity"]["localReceiptChainVerified"])
        self.assertFalse(result["integrity"]["signaturePresent"])
        self.assertTrue(all(value is False for value in result["authority"].values()))
        self.assertTrue(result["model"]["recordedCheckpointHash"] == MODEL)
        self.assertFalse(result["model"]["runtimeCheckpointRecheckedOnExport"])
        self.assertNotIn("relativePath", json.dumps(result))

    def test_exact_hash_human_review_is_reported_not_as_public_release(self):
        with self.store.transaction() as db:
            db.execute("UPDATE artifacts SET review_status='ACCEPT' WHERE id=?", (MASTER,))
            db.execute(
                "INSERT INTO reviews(id,artifact_id,artifact_hash,decision,reason_codes_json,notes,reviewer_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (REVIEW, MASTER, self.paths["master"][1], "ACCEPT", '["VISUAL_PASS"]',
                 "reviewed actual media", "REVIEWER-01", "2026-10-25T00:10:00.000Z"),
            )
            CineStore._append_receipt(db, "HUMAN_ACCEPTED", "artifact", MASTER, {
                "artifactHash": self.paths["master"][1], "reviewId": REVIEW,
                "publicReleaseAuthorized": False,
            })
        result = build_media_evidence(self.layout.root, MASTER)
        self.assertEqual(result["review"]["decision"], "ACCEPT")
        self.assertTrue(result["review"]["exactHashDecisionRecorded"])
        self.assertFalse(result["authority"]["publishingAuthorized"])

    def test_mutated_master_bytes_fail_closed_even_with_existing_db_receipts(self):
        path, digest = self.paths["master"]
        with path.open("ab") as file:
            file.write(b"tampering")
        with self.assertRaisesRegex(MediaEvidenceDenied,"MP4 size"):
            build_media_evidence(self.layout.root, MASTER)

    def test_mutated_receipts_fail_before_media_acceptance(self):
        with self.store.transaction() as db:
            db.execute("UPDATE receipts SET payload_json=? WHERE sequence=1", ('{"false":"yes"}',))
        with self.assertRaisesRegex(MediaEvidenceDenied,"Receipt chain"):
            build_media_evidence(self.layout.root, MASTER)

    def test_rejects_native_as_master_and_nonexistent_id(self):
        with self.assertRaisesRegex(MediaEvidenceDenied,"Select the master"):
            build_media_evidence(self.layout.root, NATIVE)
        with self.assertRaisesRegex(MediaEvidenceDenied,"Artifact not found"):
            build_media_evidence(self.layout.root,"66666666-6666-4666-8666-666666666666")

    def test_forged_backend_model_or_public_release_fail_closed(self):
        cases=[
            ("backend_id", "deterministic-test"),
            ("model_id", "not-a-real-model"),
            ("public_release_authorized", 1),
            ("external_provider_called", 1),
        ]
        for field, value in cases:
            with self.subTest(field=field):
                with self.store.transaction() as db:
                    db.execute(f"UPDATE artifacts SET {field}=? WHERE id=?", (value,MASTER))
                with self.assertRaises(MediaEvidenceDenied):
                    build_media_evidence(self.layout.root, MASTER)
                with self.store.transaction() as db:
                    restored={
                        "backend_id":"wan21-t2v-1.3b",
                        "model_id":"Wan-AI/Wan2.1-T2V-1.3B",
                        "public_release_authorized":0,
                        "external_provider_called":0,
                    }[field]
                    db.execute(f"UPDATE artifacts SET {field}=? WHERE id=?", (restored,MASTER))

    def test_cli_offline_export_file_must_be_new(self):
        target=self.layout.root / "evidence-export.json"
        command=[sys.executable, "-m", "cineswarm.reel_media_evidence",
                 "--data-root", str(self.layout.root), "--artifact-id", MASTER,
                 "--out", str(target)]
        first=subprocess.run(command,capture_output=True,text=True,timeout=30)
        self.assertEqual(first.returncode,0,first.stderr)
        saved=json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(saved["master"]["sha256"],self.paths["master"][1])
        second=subprocess.run(command,capture_output=True,text=True,timeout=30)
        self.assertEqual(second.returncode,2)
        self.assertIn("REEL_MEDIA_EVIDENCE_DENIED",second.stderr)

if __name__ == "__main__":
    unittest.main()
