# CineSwarm v0.2 — Consumer GPU Bootstrap Lane

## Purpose

v0.2 adds a real local video backend intended to let 12 GB-class NVIDIA nodes participate in native CineSwarm rendering before a 24 GB+ render node is available.

The lane uses the official Wan 2.1 T2V 1.3B source/checkpoint as a replaceable backend. It is not a test fixture and it does not call an external generation API.

## Upstream evidence frozen for this release

As checked 2026-08-13/14:

- Official Wan 2.1 repository: https://github.com/Wan-Video/Wan2.1
- Official docs state T2V-1.3B requires about 8.19 GB VRAM and supports 480P, not 720P.
- Official example uses `--task t2v-1.3B --size 832*480 --offload_model True --t5_cpu --sample_shift 8 --sample_guide_scale 6`.
- Wan 2.1 T2V 1.3B sample FPS is 16 and frame count must be `4n+1`.

CineSwarm deliberately schedules this backend only when at least 9216 MiB of free VRAM is reported on one GPU. This is a local operational safety margin, not an upstream claim.

## Artifact truth boundary

The backend preserves two artifacts:

1. native: 832×480, 16 fps, directly emitted by Wan 2.1;
2. delivery master: 1280×720, 24 fps, locally scaled/pillarboxed and frame-rate converted with ffmpeg.

The delivery master records:

- `native720p: false`
- `qualityClass: CONSUMER_BOOTSTRAP_480P`
- `nativeFps: 16`
- `deliveryFps: 24`
- `temporalConversion: frame duplication/drop only; no motion interpolation`

A successful master is therefore never described as native 720p.

## Scheduler behavior

Pocket Spark backend preference is now:

1. `wan22-ti2v-5b` — higher-quality 24 GB+ declared lane;
2. `wan21-t2v-1.3b` — consumer-GPU bootstrap fallback.

A 12 GB node cannot qualify for the Wan 2.2 24 GB profile, but may qualify for Wan 2.1 when free VRAM/RAM/disk meet the bootstrap manifest.

CineSwarm never sums unrelated GPU VRAM to make an unsupported model appear viable.

## First field milestone

The next honest field milestone is not "production quality achieved." It is:

> The actual Pocket Spark plan is assigned to a real local node, Wan 2.1 T2V 1.3B runs from locally pinned bytes, a native 832×480 MP4 is generated, a separate 1280×720 delivery master is created and hashed, and a human records ACCEPT/REJECT against the exact delivery hash.

If rejected for quality, that is still a successful infrastructure proof and a valid ParallaxTrainingSignal.
