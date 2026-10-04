# CineSwarm C1.24H Public Lineage

The public CineSwarm repository contains two intentionally distinct implementation lineages:

1. **Parallax Native CineSwarm Engine v0.2.0** — the Python local-first orchestration baseline.
2. **C1.24H / `@parallax-network/cineswarm-bridge` v0.26.0** — the governed Studio/CineSwarm bridge lineage covering authorization seals, human key ceremony, asset quarantine, picture lock, render/master gates, canon/ledger admission, release lifecycle, archive/recovery, preservation, reproducible decode, independent rebuild, canonical admission, resumable ceremony, and challenge-health handoff.

The bridge source is public under MIT. Its npm package remains marked `private: true` solely to prevent accidental registry publication.

The sealed C1.24H package is not unpacked wholesale into Git history. Compact provenance is retained under `provenance/c1-24h/`; four heavyweight physical acquisition archives remain outside Git and are bound by the sealed sidecar manifest and SHA-256.

The public suite keeps the original 358-test lineage. With the four sealed heavyweight acquisition archives intentionally absent, exactly one byte-for-byte physical-acquisition test is skipped rather than falsely failed or falsely passed. The original sealed sidecar independently passed 358/358 before the public split.

The August 2026 enrollment challenge preserved in provenance is expired and must not be interpreted as current ceremony state.

Public source availability never grants release, canonical mutation, human-signing, or Relay authority.
