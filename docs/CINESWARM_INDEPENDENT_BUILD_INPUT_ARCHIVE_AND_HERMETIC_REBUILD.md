# CineSwarm C1.24B — Real Independent FFmpeg Source Rebuild

Status: **Real independent source rebuild proven. Canonical admission pending.**

## Purpose

C1.23 proved isolated reconstruction of a captured decoder runtime. C1.24 defines the stronger claim: preserve the actual upstream source/signature/key/toolchain/build-tool/sysroot/configuration closure, compile the decoder from source in a fresh network-denied root, and prove that the newly built decoder reproduces the authoritative decoded media hashes.

C1.24B has now earned that technical proof for FFmpeg 7.1.5. The proof is deliberately **not auto-promoted** into the canonical C1.24 register because `autoPromoteIndependentProof=false`.

## Seven-of-seven physical build-input closure

All required inputs are physically present and hash-addressed:

1. `UPSTREAM_SOURCE_TARBALL` — `ffmpeg-7.1.5.tar.xz`
2. `DETACHED_SIGNATURE` — `ffmpeg-7.1.5.tar.xz.asc`
3. `SIGNING_PUBLIC_KEY` — FFmpeg release public key
4. `COMPILER_TOOLCHAIN` — captured GCC/binutils closure
5. `BUILD_TOOL` — captured Make/core build-tool closure including tar/xz
6. `SYSROOT_OR_BUILD_DEPENDENCY_CLOSURE` — captured libc/Linux-header build closure
7. `BUILD_CONFIGURATION` — frozen configure arguments + seccomp network-denial launcher

The governed acquisition fixture is `READY_TO_BUILD_INPUT_ARCHIVE` with `missingKinds=[]`.

## Source authenticity

The exact source artifact is 11,050,340 bytes with SHA-256:

`de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f`

The detached signature SHA-256 is:

`7ce4b9d56e3ef0cd4c3a9c0b2c8a034ac91e6c4c011c1f10b05a8aa7292fca35`

The imported release key fingerprint is:

`FCF986EA15E6E293A5644F10B4322F04D67658D8`

The exact tarball bytes passed detached-signature verification before local governed ingestion and again during the local ingestion ceremony. The local receipt is:

`proof/c1-24/real-input-acquisition/C1_24_SOURCE_INGEST_RECEIPT.json`

The temporary GitHub Actions transport is preserved only as transport provenance in `C1_24_SOURCE_TRANSPORT_RECEIPT.txt`; transport does not replace the local source-authenticity verification.

## Build isolation and closure

The source build uses:

- a fresh chroot build root;
- archived GCC/binutils, Make/build tools, sysroot and build configuration;
- archived tar/xz to unpack the governed source;
- a Linux seccomp launcher that denies network socket syscalls with `EPERM`;
- no credentials;
- no copied host ffmpeg/ffprobe binaries;
- `--disable-autodetect`;
- `--disable-network`;
- a minimal frozen decoder/proof-output surface;
- `make_jobs=4`.

This proves a source build using the governed input closure with syscall-level network denial. It does **not** claim a separate kernel/VM/complete operating-system image, so `fullOsIsolationProven=false` remains explicit.

## Frozen source-build surface

The successful profile includes:

- AVI + Matroska demuxers;
- MPEG-4, FFV1, PCM s16le, PCM s24le decoders;
- `aresample` for canonical 48 kHz stereo s16 comparison output;
- file + pipe protocols;
- rawvideo + PCM s16le proof-output encoders;
- null/rawvideo/PCM-s16le output muxers;
- ffmpeg + ffprobe.

## Authoritative decode proof

The freshly built decoder successfully reproduced the frozen media identities:

Original file SHA-256:
`259afcbc9a18f058db3cf028ea1ea6e71205708592156eabd2220e7a07b8edd1`

Preservation derivative SHA-256:
`75119a3052bbe86cfaea2efc67b39003a714f889f7854d5e07487cd21c4848ee`

Canonical decoded video SHA-256 for both:
`505f99f3031ac2e9b05ee550c0230fa2318d1f0bf870caa7bb7496beeb989072`

Canonical decoded audio SHA-256 for both:
`e94bf471c0a8c1d229a8047fcd52516781023a35485c695fba862512bd4f5a23`

## Real proof receipts

- Build Input Archive: `16b0488d2ed201516ea28210d1f8afe00b9cbeb8dc4258dd0105c299eb7401df`
- Hermetic Build Recipe: `131aca2a679688789e8b2d6083c044bbb2d14d8c50a18a2856b32f7e0ee9c207`
- Independent Rebuild Report: `ffa490672c3e5e5a8da53bd663648031be019977577e1b3f115de77b9406a56b`
- Independent Rebuild Receipt: `93406d0a494f7d8829e8b707b6fdb714379b3c2b3ff9eca51b7c3eb392bdef3c`
- Proof Register: `6f1b2af31f1039942071e0af4dd51083411115e168d0306cc7b5fddd2706eb54`
- Build Log: `963c62f7e10ea8573c65ff97cb063b58c5fe1ec93801578c4eb03b47ec60387f`

Re-verify the saved proof without rebuilding:

```bash
node scripts/cineswarm-verify-c1-24-real-rebuild.mjs .
```

## Canonical admission boundary

The proof register is a real evidence register and says `fullIndependentSourceRebuildProven=true`.

The canonical PN-0001 C1.24 register deliberately remains:

- revision `0`;
- entry count `0`;
- `fullIndependentSourceRebuildProven=false`;
- `publicRelease=false`;
- `relayDependency=false`.

This is not a contradiction. The technical proof has been earned, but policy explicitly forbids automatic promotion. A separate real human/governance admission ceremony is the next clean step.

## Authority boundary

C1.24B does not authorize provider spending, media publication, deletion of originals, deletion of preservation derivatives, or use of Parallax Relay. It establishes one narrow fact: **the preserved FFmpeg 7.1.5 source/build-input closure successfully produced a fresh decoder that reproduced the authoritative preservation decode hashes.**
