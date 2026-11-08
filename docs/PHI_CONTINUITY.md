# PhiContinuity: reference-aware motion planning (Rung 0)

**Status:** Offline planning prototype. No trained sparse-attention implementation, GPU
video acceleration, model fine-tuning, identity guarantee, or render execution.

## Original concept

PhiContinuity is CineSwarm's model-neutral **continuity planning** layer. Rather
than importing a ComfyUI plugin or coupling the project to one model, it breaks
an animation shot into three independently auditable questions:

1. **AnchorVault:** Which already-registered, content-addressed visual references
   carry identity, environment, style, or pose intent?
2. **MotionPulse:** Which moments need continuity checkpoints, particularly
   camera cuts and rapid motion?
3. **BudgetGuard:** How many checkpoints may the planner propose without
   overclaiming inference speed, GPU memory savings, or successful rendering?

This is inspired by the general idea of allocating computation selectively and
preserving references, but **does not copy or implement Ref2VA-VSA**, learned
attention gates, key/value caching, kernel changes, or model-specific hooks.

## Rung 0: implemented now

- Pure Python standard-library preflight; no ComfyUI/Wan imports.
- Strict schema, range limits, lowercase SHA-256 references, and no file paths
  or URLs in reference objects.
- Boundaries and camera cuts have mandatory checkpoint priority. Remaining
  slots prefer high-intensity motion beats before uniform interval points.
- A deterministic, content-hashed JSON *preview*, containing explicit
  PREVIEW_ONLY status. No videos are generated.
- Camera cuts that overflow a checkpoint budget fail closed rather than silently
  losing required continuity markers.
- Tests exercise budgets, ordering, receipts, malformed input, and tiny clips.

Example:

~~~sh
python -m cineswarm.continuity examples/phi_continuity.example.json
~~~

Reference digests in the sample are illustrative placeholders. They are not
registered artifacts, and the preview does not attest that they exist.

Example output fields:

- **sourceHash:** digest of original preview request
- **previewHash:** digest of canonical output excluding the hash itself
- **checkpoints:** zero-based frame positions and selection reasons
- **backendAuthorized: false:** there is no backend or model invocation
- **warnings:** no reference-registry verification, memory guarantee, or speed claim

## Rung 1: registry binding and shot-specific gates (planned)

- Resolve each AnchorVault SHA-256 only through CineSwarm's existing asset registry.
- Distinguish reference *intent* from backends' supportedConditioning.
- Gate a production shot on a matching registered backend, memory profile,
  permitted conditioning, and verified asset residency.
- Emit a hash-chained request receipt via the existing store, not an
  unqualified independent acceptance signal.
- Require human review for reference appearance, artifacts, motion stability,
  and copyright/licensing of inputs and model weights.

## Rung 2: model-neutral video continuity (planned)

- Reference-derived scene cards and shot-level temporal checkpoints.
- Preview proxies, crop/pose descriptions, and scene-cut metadata where
  supported by actual tools, with clear source derivation.
- Evaluate cadence vs quality at low VRAM without pretending a text-to-video
  checkpoint supports reference-to-video conditioning.
- Reserve provider-specific implementations behind explicitly registered
  capability adapters, never silently reinterpret user intent.

## Rung 3: optional sparse/model optimizations (research only)

- Assess model-specific attention/tile/latent reuse strategies under an
  isolated experimental backend.
- Preserve dense access to reference features *if that architecture supports
  it*, but do not equate checklist planning with actual sparse attention.
- Compare image identity, temporal flicker, prompt adherence, runtime,
  peak VRAM, cold/warm startup, and failure behavior against a dense baseline.
- Record exact GPU/model/driver/checkpoint/kernel hashes and shot settings.
- Do not advertise speedups without reproducible measured data.

## Consumer GPU path

For a 12 GiB-class NVIDIA card, keep the existing declared Wan 2.1 T2V 1.3B
bootstrap lane (9 GiB free-VRAM scheduling floor) as the *current* candidate
for actual video generation. That backend is **text-to-video**; it does not
become reference-conditioned simply because a PhiContinuity plan exists.
More capable reference-to-video models must pass their own profile gates and
license checks before integration.

## Architecture seam

~~~text
Auralith / Domistika
  -> existing registered reference artifact hashes
  -> PhiContinuity offline planning / checkpoint proposal
  -> [future: verify registry + provider capability + memory profile]
  -> CineSwarm existing scheduler / NodeAgent / eligible backend
  -> existing media hash, ffprobe, human review, receipt ledger
  -> ParaCut / WaveForgeStudio
~~~

**Rung 0 has no execution edge.** Do not submit a PhiContinuity preview as a
ProductionPlan; it is not a valid production-plan/v1 payload.

## Attribution and independence

A general research inspiration is the public
[ComfyUI-Ref2VA-VSA project](https://github.com/Kablex/ComfyUI-Ref2VA-VSA).
This implementation is an original scheduling/preflight design and uses none
of that project's source or trained weights. Any future model-specific code
must be independently reviewed for licensing, benchmarks, and safety.
