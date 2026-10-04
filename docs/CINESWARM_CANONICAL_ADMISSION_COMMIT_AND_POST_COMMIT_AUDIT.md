# CineSwarm C1.24F — Canonical Admission Commit + Post-Commit Audit

C1.24F is the operational commit layer after C1.24E staging. It does not add new human authority. The C1.24C Ed25519 admission signature remains the authority-bearing act; C1.24F adds an explicit anti-accident commit confirmation and a recoverable filesystem procedure.

## Authority boundary

C1.24F cannot generate a human key, acknowledge a fingerprint, create the admission signature, infer consent from chat, auto-confirm the commit, auto-apply canonical state, authorize public release, or depend on Parallax Relay.

The human must locally re-enter the complete 64-hex `commitIntentDigest` produced by the exact C1.24F preview. The digest binds the staged human public-key registry, the signed C1.24E admission stage, all three current canonical before-hashes, and all three proposed after-hashes.

## Filesystem truth

C1.24F explicitly does **not** claim multi-file atomicity. Three independent JSON targets cannot be made one indivisible filesystem rename using the existing layout. Instead C1.24F uses a journaled two-phase recoverable procedure:

1. Validate the C1.24E key-enrollment and admission-stage evidence.
2. Verify all canonical before-hashes.
3. Create verified backups of all three targets.
4. Create and verify all three staged after-images.
5. Write a `PREPARED` transaction journal.
6. Replace each target individually, verify its exact after-hash, and journal progress.
7. Re-read all three canonical targets.
8. Require a PASS post-commit audit: active human public key, admitted C1.24 revision, and recorded C1.24C admission receipt.
9. Issue an immutable C1.24F Commit Receipt and append it to the C1.24F Commit Register.

## Recovery

If recovery sees a recognizable partial state containing only signed `BEFORE`/`AFTER` hashes, it restores all three canonical targets from the verified backups. If all three targets already match the signed after-state, recovery may finish the audit/receipt/register path. If any target matches neither the signed before nor after hash, automatic recovery stops with `MANUAL_INTERVENTION_REQUIRED` and does not overwrite that target.

## Current canonical state

The real human enrollment response/signature has not been provided. Therefore the real C1.24 register, C1.24C Admission Register, and C1.24F Commit Register remain revision 0. The C1.24F operational proof uses only a disposable canonical clone and the existing synthetic proof identity; it is not a real human admission.
