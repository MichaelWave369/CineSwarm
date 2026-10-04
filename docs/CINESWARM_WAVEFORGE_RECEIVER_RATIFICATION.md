# CineSwarm ↔ WaveForgeStudio Release-Reference Receiver Ratification

**Decision date:** 2026-10-04  
**Receiver repository:** `MichaelWave369/CineSwarm`  
**Sender repository:** `MichaelWave369/WaveForgeStudio`  
**Extension:** `parallax.creative-interop.v2.cineswarm-reference`  
**Receiver package:** `@parallax-network/cineswarm-bridge@0.27.0`  
**Ratification state:** `ratified_receiver`

## Adoption decision

The project owner authorizes CineSwarm to adopt the bounded WaveForgeStudio final-release reference receiver defined by this repository.

This is a receiver-contract adoption decision only. It does not authorize automatic import, media acquisition, rendering, subprocess execution, network activity, publication, public release, Canon promotion, Ledger promotion, or Relay dependency.

## Accepted packet boundary

A ratified packet must remain:

- `schema = parallax.bridge.v2`
- `protocol = parallax-bridge`
- `version = 2`
- `interopProfile = parallax.creative-interop.v2`
- `extensionProfile = parallax.creative-interop.v2.cineswarm-reference`
- `extensionStatus = ratified_receiver`
- `source = WaveForgeStudio`
- `target = CineSwarm`
- `localOnly = true`
- `requiresUserAction = true`

Its native payload must remain `waveforge.cineswarm_release_reference.v1_alpha`, reference a `waveforge.final_release_manifest.v2_alpha`, and bind the packet content hash to the canonical native payload.

## Authority boundary

Every accepted packet and every CineSwarm receiver receipt must preserve all of these as false:

- automatic import;
- media acquisition;
- rendering;
- subprocess execution;
- network activity;
- publishing/public release.

Receiver ratification means **CineSwarm recognizes and can verify the reference format**.

It does not mean **CineSwarm imported, rendered, published, acquired, or otherwise acted on the referenced release**.

## Human boundary

A valid ratified packet may produce only a receiver receipt with state:

`REFERENCE_RECEIVED_PENDING_HUMAN_ACCEPTANCE`

That receipt is reference-only and self-hashed. Any later local import or use requires a separate explicit human action under the policy governing that action.

Historical packets carrying `extensionStatus = unratified_receiver` remain recognizable for provenance and debugging, but they cannot produce a ratified receiver receipt.

## Hash and lineage rules

The receiver independently verifies:

1. `contentHash` against canonical JSON of the native WaveForge payload;
2. `transferId` against the referenced final-release SHA-256;
3. optional Creative Interop v2 lineage and `lineageRef`;
4. all explicit authority flags;
5. its own receiver receipt hash.

No sender claim is trusted merely because the sender produced it.

## Scope

This ratification does not alter the broader C1.24H human-ceremony, Canon, Ledger, archive, preservation, or release authority model.

It adds one bounded upstream reference receiver to CineSwarm and nothing more.
