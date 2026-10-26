# REEL Pilot 001: Proof of a Real Shot (Offline Evidence Export)

This workflow exists **after a genuine human-authorized local Wan2.1 render**. It does not produce footage, install a model, submit a CineSwarm job or publish anything. A GitHub PR with green tests is **not** evidence that the pilot rendered.

## Why this bridge exists

CineSwarm already records `MEDIA_HASHED`, `QC_COMPLETED`, `RENDER_COMPLETED` and optional human `ACCEPT` / `REJECT` receipts. This utility reads those **existing** records and the **actual native and scaled MP4 files** rather than accepting a browser-edited production proposal as proof of execution.

The export is an editable unsigned JSON sidecar. It proves consistency with **that local database and those locally inspected files at export time**, not global identity, rights or a signed proof from a trusted service.

## Offline export command

Once an authorized CineSwarm operator has actually submitted and completed REEL P001 Shot 001 and has the *real master artifact UUID* from `cine status`:

```bash
python -m cineswarm.reel_media_evidence \
  --data-root ./parallax-cineswarm-data \
  --artifact-id <REAL-MASTER-ARTIFACT-UUID> \
  --out reel-p001-shot-one-evidence.json
```

The command reads the SQLite database using `mode=ro`, replays the full hash-chained receipt ledger, verifies one completed REEL_P001 job and one `reel-p001-s01` task, checks the actual Wan2.1 model/backend identity recorded by CineSwarm, locates both the native and delivery master in the contained content-addressed store, recomputes **both SHA-256 hashes directly from disk**, and re-probes both video streams using local `ffprobe`.

The master must actually be `1280×720/24 fps`, and the native file `832×480/16 fps`. Both must have plausible positive video durations. The master's `source_artifact_hash` must equal the native media's recorded hash. The receipts for job acceptance, shot compilation, native and master media hashing, video QC and actual render completion must exist in the verified chain.

**No fake fixture-video or deterministic-test backend is eligible.** The recorded Wan2.1 model checkpoint SHA-256 and provider-status information are shown, but this particular export does **not** re-hash the model files at export time. Even an independently verified checkpoint is not a rights license.

The resulting **`REEL_P001_REAL_MEDIA_EVIDENCE_V1`** file includes the exact master/native media hashes and byte counts, real video dimensions/frame rates, source-plan lineage, recorded model identity/hash, receipt-chain head, existing exact-hash human-review decision (or `PENDING_REVIEW`), and explicit **false** copyright/publication/voice/music rights authorization fields.

An `ACCEPT` decision means a reviewer accepted *that exact locally stored master SHA-256* for QC. It **never** authorizes public upload, third-party content reuse, a podcast feed or an RCTV channel. `REJECT` and `REVISION_REQUESTED` are preserved as such, not promoted.

The command writes only a **new** JSON file with `--out` and will refuse to overwrite an existing file. It never copies the source media, mutates the database, exposes an HTTP endpoint, publishes online, reads a credential secret or accesses a GPU.

## REEL and ParaCut handoff

1. Download the exact same existing **master MP4 file** via your own filesystem, and export its evidence JSON separately.
2. On the REEL browser's **Real Shot Evidence Desk**, explicitly select both the MP4 and the JSON. The page hashes the MP4 bytes in the browser and compares the resulting SHA-256 and size against the evidence, and checks the envelope's fail-closed source and authority semantics.
3. Preview the **selected local MP4** without uploading it. This is an editorial viewing surface, not a broadcast.
4. If you decide to use this shot, import that very same file into ParaCut through its own verified user-controlled source importer. **This bridge is not an automatic native ParaCut RenderPlan or API.** Keep the native CineSwarm export for provenance review; ParaCut's timeline edit, music, voice and public release require their own approvals.

## No hidden installation promise

The user's static GitHub Pages REEL interface does not install CineSwarm, retrieve model weights or reach localhost. The native evidence export requires a user-controlled CineSwarm installation and the preexisting, genuinely rendered media and SQLite records.

There is no sample real footage bundled here. Only synthetic videos created by offline FFmpeg **inside tests** prove the software's ability to validate a plausible data layout. Synthetic CI fixtures are **not** real model output or valid CineSwarm production receipts.

## Tests

`tests/test_reel_media_evidence.py` creates test-only FFmpeg MP4 files and a local CineSwarm SQLite record/receipt chain; it checks fresh master and native hashes, ffprobe, valid pending and accepted reviews, tampered media, tampered receipts, backend impersonation, misclaimed release, invalid IDs and no-overwrite CLI semantics. Existing full CineSwarm CI remains mandatory.

The future public REEL channel remains unassigned until exact media, rights, consent, editorial review, original music, final ParaCut mastering, separately approved publication and a real hosted destination are documented.
