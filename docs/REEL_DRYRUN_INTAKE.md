# REEL Network → CineSwarm · Native Dry-Run Intake v1

**Status: offline validation + native TEST fixture preview, NOT a media rendering workflow.**

This receiver is owned by CineSwarm, rather than letting a public REEL browser create or submit jobs. Its input is the `REEL_NETWORK_PITCH_PACKET_V1` local JSON exported from [ReelCommons REEL Network](https://github.com/MichaelWave369/ReelCommons). REEL is the public network brand; existing Parallax-native protocol names remain unchanged.

## Try the round trip (on a local machine with CineSwarm)

The standalone adapter uses only Python's standard library and this project's own source modules. With CineSwarm installed in the usual development environment:

```bash
python -m cineswarm.reel_intake examples/reel-network.pitch.fixture.json --out reel-preview.json
```

To inspect JSON to stdout without writing anything:

```bash
python -m cineswarm.reel_intake examples/reel-network.pitch.fixture.json
```

No running coordinator or GPU is required. **Nothing is submitted, queued, rendered, accepted, published, uploaded or broadcast.** The native output is `REEL_CINESWARM_DRYRUN_PREVIEW_V1`, with the normalized CineSwarm `production-plan/v1` object stored at `nativeTestPlan`. It has exactly one one-second deterministic-test rehearsal shot. Its backend preference is **only** `deterministic-test`, it is marked `acceptanceEligible: false`, and `publicReleaseAuthorized: false`. The fixture is not a video, model inference, rights decision, or release receipt.

The output records a canonical SHA-256 of the validated input, a canonical SHA-256 of the native test plan, `VALIDATED_NOT_SUBMITTED` status and explicit false authorization flags. The hashes prove byte-consistent canonical JSON at this step, **not copyright, consent, editorial truth or independently verified model output**.

## Fail-closed validation

- Only exact `schema`, `provenance`, REEL source/host identifiers and timestamp formats are accepted.
- All eleven **frozen REEL office roles** must be present exactly, in order, with the expected names/outputs, `state: not_started` and `executionAuthorized: false`.
- Every founder/human approval, release, consent, claims and rights flag must remain at its exported **unverified / denied** state. Unknown keys and elevated authority flags fail the entire intake.
- Text, enum and overall file sizes are bounded: 64 KiB maximum. Duplicate JSON keys are rejected. A supplied output filename never overwrites an existing file, and the input cannot be replaced.
- Input cannot select a backend, conditioning path, external provider, arbitrary host URL, real render budget, public channel number or output delivery target. The adapter fixes all native test-shot values and validates the result through CineSwarm's existing `validate_production_plan()` routine.
- Running the command never calls `/v1/jobs`, starts a coordinator, launches a node, probes media, downloads models, opens a microphone, or creates network access.

## Distinguish the stages

| Stage | Status |
|---|---|
| REEL creator pitch | Unverified browser-authored proposal |
| CineSwarm dry-run intake | Native schema validation and local test-shot plan preparation |
| Explicit `cine submit` of a native test plan | Separate human action; may queue only the deterministic fixture with a local coordinator/test node |
| Real CineSwarm native rendering | **Not authorized or planned by this converter**; requires separate model/node qualification, media/IP rights review, shot planning and explicit execution approval |
| ParaCut / WaveForge postproduction | Independent verified project/RenderPlan and media artifacts |
| REEL public channel or broadcast | Independent human publication, rights and distribution authorization; **not conferred by CineSwarm acceptance** |

The existing `cine submit` path remains a distinct operation. Do not blindly copy a REEL proposal, remove `acceptanceEligible: false`, or substitute a real rendering backend. Design and review actual production shot plans separately.

## Tests

```bash
python -m pytest -q tests/test_reel_intake.py
```

Tests cover valid browser-equivalent fixture, exact offices and authority requirements, deterministic canonical hashes, native plan schema, malicious role/authority mutations, unsafe JSON, duplicate keys, file-size limits and non-overwriting CLI behavior. The legacy `SOURCE_MANIFEST.sha256` still verifies the frozen public v0.2 source-release snapshot; all v1 intake files are newly additive and that archive is intentionally not silently rewritten.

## Follow-on bridge requirements

To move beyond dry-run planning, a separate opt-in adapter must receive independently approved shot briefs and human authorization, check model license/hardware capability, bind budgets and exact assets, and emit a signed/audited production receipt. The public REEL GitHub Pages UI must not talk directly to CineSwarm's loopback/LAN coordinator. A properly authenticated service or user-controlled local execution boundary is required.

The receiver must continue to treat rights/consent as **claims subject to human review** rather than asserting them from an exported browser JSON packet.
