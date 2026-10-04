# Parallax Native CineSwarm Engine v0.2.0 — Build Receipt

## Scope

Consumer-GPU bootstrap lane and delivery-contract hardening.

## Implemented

- `Wan21T2V13BBackend` using official Wan 2.1 `generate.py` command shape.
- Conservative single-GPU scheduler floor of 9216 MiB free VRAM.
- Native 832×480 / 16 fps artifact preservation.
- Local 1280×720 / 24 fps delivery normalization with explicit non-native metadata.
- Pocket Spark backend fallback: Wan 2.2 5B → Wan 2.1 1.3B.
- Wan 2.1 blocked model-manifest template and environment variables.
- Master-delivery QC now validates requested width, height, and FPS.
- SQLite read connections close deterministically; ResourceWarning-strict test suite passes.

## Reality boundary

No Wan repository/checkpoint is bundled. No model was downloaded. No GPU inference was executed in this build environment. Pocket Spark remains unrendered until physical local-node execution occurs.

## Verification target

- source tests: 32/32 PASS
- Python compileall: PASS
- ResourceWarning-strict suite: PASS
- wheel install + tests: 32/32 PASS
- packaged-wheel loopback orchestration: PASS; 8-receipt valid chain
- candidate fresh ZIP: manifest verified; 32/32 source tests PASS; compileall PASS; contained wheel fresh-install + 32/32 tests PASS
- final archive must reproduce the same checks before handoff
