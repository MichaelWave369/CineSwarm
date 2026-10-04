import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendDisasterRecoveryReceiptToRegister,
  buildArchiveRecoveryBundleManifest,
  buildArchiveRecoveryRegister,
  buildArchiveReplicaManifest,
  buildArchiveReplicaSet,
  buildDisasterRecoveryReceipt,
  buildReplicaVerificationReport,
  buildRestoreDrillReport,
  classifyArchiveRecoveryState,
  validateArchiveRecoveryBundleManifest,
  validateArchiveRecoveryPolicy,
  validateArchiveRecoveryRegister,
  validateArchiveReplicaManifest,
  validateArchiveReplicaSet,
  validateDisasterRecoveryReceipt,
  validateReplicaVerificationReport,
  validateRestoreDrillReport,
} from '../src/archive-recovery.js';
import { c17Policy, c16Policy, c15Policy } from './c1-17-fixture.mjs';
import { buildC1_18Fixture, c18Policy } from './c1-18-fixture.mjs';

const restoredFrom = (bundle) => bundle.objects.map((item) => ({ kind: item.kind, observedBlobSha256: item.blobSha256, observedSizeBytes: item.sizeBytes }));

function restoreContext(fx) {
  return {
    c18Policy,
    recoveryBundle: fx.recoveryBundle,
    bundleValidationContext: fx.bundleContext,
    replicaSet: fx.replicaSet,
    replicaManifests: fx.replicaManifests,
    sourceReplicaManifest: fx.replicaA,
    sourceVerificationReport: fx.verificationA,
  };
}

function receiptContext(fx, drill) {
  return { ...restoreContext(fx), restoreDrillReport: drill };
}

function recoveryRegisterContext(fx) {
  return { c18Policy, c17Policy, c17ArchiveRegister: fx.c17ArchiveRegister, c17RegisterContext: fx.c17RegisterContext };
}

test('C1.18 policy requires two replicas, two failure domains, exact restore verification, and no release/Relay authority', () => {
  assert.equal(validateArchiveRecoveryPolicy(c18Policy).valid, true);
  const bad = structuredClone(c18Policy); bad.minimumReplicaCount = 1;
  assert.throws(() => validateArchiveRecoveryPolicy(bad), /minimumReplicaCount/);
  const overreach = structuredClone(c18Policy); overreach.recoveryCanAuthorizeRelease = true;
  assert.throws(() => validateArchiveRecoveryPolicy(overreach), /recoveryCanAuthorizeRelease must remain false/);
});

test('Recovery Bundle binds a registered C1.17 archive + PASS revalidation and exact eight-object semantic inventory', () => {
  const fx = buildC1_18Fixture();
  assert.equal(validateArchiveRecoveryBundleManifest(fx.recoveryBundle, fx.bundleContext).valid, true);
  assert.equal(fx.recoveryBundle.objectCount, 8);
  assert.equal(fx.recoveryBundle.fullPublishedMasterIncluded, true);
  assert.equal(fx.recoveryBundle.publicRelease, false);
});

test('Recovery Bundle rejects semantic hash drift and non-verbatim published Master storage', () => {
  const fx = buildC1_18Fixture();
  const semanticDrift = structuredClone(fx.recoveryBundle);
  semanticDrift.objects[0].semanticSha256 = '1'.repeat(64);
  assert.throws(() => validateArchiveRecoveryBundleManifest(semanticDrift, fx.bundleContext), /semantic hash drift|self-hash/);
  const nonVerbatim = structuredClone(fx.recoveryBundle);
  const master = nonVerbatim.objects.find((item) => item.kind === 'published-master-media');
  master.storageEncoding = 'canonical-json';
  nonVerbatim.bundleManifestHash = '2'.repeat(64);
  assert.throws(() => validateArchiveRecoveryBundleManifest(nonVerbatim, fx.bundleContext), /published-master-media must use verbatim storage|self-hash/);
});

test('Replica Manifests copy exact bundle inventory and remain self-hashed', () => {
  const fx = buildC1_18Fixture();
  assert.equal(validateArchiveReplicaManifest(fx.replicaA, { c18Policy, recoveryBundle: fx.recoveryBundle }).valid, true);
  const tampered = structuredClone(fx.replicaA);
  tampered.objects[1].blobSha256 = '3'.repeat(64);
  assert.throws(() => validateArchiveReplicaManifest(tampered, { c18Policy, recoveryBundle: fx.recoveryBundle }), /inventory drift|self-hash/);
});

test('Replica Set requires distinct location IDs and at least two distinct failure domains', () => {
  const fx = buildC1_18Fixture();
  assert.equal(validateArchiveReplicaSet(fx.replicaSet, { c18Policy, recoveryBundle: fx.recoveryBundle, replicaManifests: fx.replicaManifests }).valid, true);
  const copies = fx.replicaB.objects.map((item) => ({ kind: item.kind, relativePath: item.relativePath, blobSha256: item.blobSha256, sizeBytes: item.sizeBytes }));
  const badReplica = buildArchiveReplicaManifest({ c18Policy, recoveryBundle: fx.recoveryBundle, replicaId: 'replica-c', locationId: fx.replicaA.locationId, failureDomain: fx.replicaA.failureDomain, storageKind: 'filesystem', objectCopies: copies, recordedAt: '2026-08-14T00:03:30.000Z' });
  assert.throws(() => buildArchiveReplicaSet({ c18Policy, recoveryBundle: fx.recoveryBundle, replicaManifests: [fx.replicaA, badReplica], createdAt: '2026-08-14T00:04:30.000Z' }), /distinct locationIds|failure-domain/);
});

test('Replica Verification reports HEALTHY, DEGRADED, and FAIL without softening corruption into absence', () => {
  const fx = buildC1_18Fixture();
  assert.equal(validateReplicaVerificationReport(fx.verificationA, { c18Policy, recoveryBundle: fx.recoveryBundle, replicaManifest: fx.replicaA }).health, 'HEALTHY');
  const missing = fx.healthyObservations(fx.replicaA); missing[0] = { kind: missing[0].kind, expectedBlobSha256: missing[0].expectedBlobSha256, expectedSizeBytes: missing[0].expectedSizeBytes, available: false, observedBlobSha256: null, observedSizeBytes: null };
  const degraded = buildReplicaVerificationReport({ c18Policy, recoveryBundle: fx.recoveryBundle, replicaManifest: fx.replicaA, observations: missing, verifierId: 'v', verifiedAt: '2026-08-14T00:06:00.000Z' });
  assert.equal(degraded.health, 'DEGRADED');
  const corrupt = fx.healthyObservations(fx.replicaA); corrupt[0].observedBlobSha256 = '4'.repeat(64);
  const failed = buildReplicaVerificationReport({ c18Policy, recoveryBundle: fx.recoveryBundle, replicaManifest: fx.replicaA, observations: corrupt, verifierId: 'v', verifiedAt: '2026-08-14T00:06:00.000Z' });
  assert.equal(failed.health, 'FAIL');
});

test('Restore Drill refuses DEGRADED or FAIL source replicas', () => {
  const fx = buildC1_18Fixture();
  const corrupt = fx.healthyObservations(fx.replicaA); corrupt[2].observedBlobSha256 = '5'.repeat(64);
  const failed = buildReplicaVerificationReport({ c18Policy, recoveryBundle: fx.recoveryBundle, replicaManifest: fx.replicaA, observations: corrupt, verifierId: 'v', verifiedAt: '2026-08-14T00:06:00.000Z' });
  assert.throws(() => buildRestoreDrillReport({ ...restoreContext(fx), sourceVerificationReport: failed, restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' }), /HEALTHY source replica/);
});

test('Restore Drill proves byte-for-byte full bundle + published Master recovery while primary is assumed unavailable', () => {
  const fx = buildC1_18Fixture();
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  assert.equal(validateRestoreDrillReport(drill, restoreContext(fx)).status, 'PASS');
  assert.equal(drill.byteForByteRestoreVerified, true);
  assert.equal(drill.fullPublishedMasterRestored, true);
  assert.equal(drill.publicRelease, false);
});

test('Restore Drill marks restored-byte substitution FAIL rather than producing a recovery success', () => {
  const fx = buildC1_18Fixture();
  const restored = restoredFrom(fx.recoveryBundle); restored[3].observedBlobSha256 = '6'.repeat(64);
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restored, restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  assert.equal(drill.status, 'FAIL');
  assert.equal(drill.byteForByteRestoreVerified, false);
  assert.throws(() => buildDisasterRecoveryReceipt({ ...receiptContext(fx, drill), issuedAt: '2026-08-14T00:09:00.000Z' }), /full PASS restore drill/);
});

test('Disaster Recovery Receipt requires a PASS drill and still cannot authorize republishing', () => {
  const fx = buildC1_18Fixture();
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  const receipt = buildDisasterRecoveryReceipt({ ...receiptContext(fx, drill), issuedAt: '2026-08-14T00:09:00.000Z' });
  assert.equal(validateDisasterRecoveryReceipt(receipt, receiptContext(fx, drill)).disasterRecoveryProven, true);
  assert.equal(receipt.autoRepublish, false);
  assert.equal(receipt.recoveryCanAuthorizeRelease, false);
  assert.equal(receipt.publicRelease, false);
});

test('Archive Recovery Register is append-only and rejects duplicate recovery receipts', () => {
  const fx = buildC1_18Fixture();
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  const receipt = buildDisasterRecoveryReceipt({ ...receiptContext(fx, drill), issuedAt: '2026-08-14T00:09:00.000Z' });
  const registerContext = recoveryRegisterContext(fx);
  let register = buildArchiveRecoveryRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-14T00:00:45.000Z' });
  register = appendDisasterRecoveryReceiptToRegister({ register, receipt, receiptContext: receiptContext(fx, drill), registerContext, recordedAt: '2026-08-14T00:09:30.000Z' });
  assert.equal(validateArchiveRecoveryRegister(register, registerContext).valid, true);
  assert.equal(register.revision, 1);
  assert.equal(register.successfulRestoreDrillCount, 1);
  assert.throws(() => appendDisasterRecoveryReceiptToRegister({ register, receipt, receiptContext: receiptContext(fx, drill), registerContext, recordedAt: '2026-08-14T00:10:00.000Z' }), /already registered/);
});

test('Archive Recovery Register hash-chain tampering fails closed', () => {
  const fx = buildC1_18Fixture();
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  const receipt = buildDisasterRecoveryReceipt({ ...receiptContext(fx, drill), issuedAt: '2026-08-14T00:09:00.000Z' });
  const registerContext = recoveryRegisterContext(fx);
  let register = buildArchiveRecoveryRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-14T00:00:45.000Z' });
  register = appendDisasterRecoveryReceiptToRegister({ register, receipt, receiptContext: receiptContext(fx, drill), registerContext, recordedAt: '2026-08-14T00:09:30.000Z' });
  const tampered = structuredClone(register); tampered.entries[0].restoredPublishedMasterSha256 = '7'.repeat(64);
  assert.throws(() => validateArchiveRecoveryRegister(tampered, registerContext), /self-hash mismatch/);
});

test('Recovery status reports overdue internal restore drills without changing release authority', () => {
  const fx = buildC1_18Fixture();
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  const receipt = buildDisasterRecoveryReceipt({ ...receiptContext(fx, drill), issuedAt: '2026-08-14T00:09:00.000Z' });
  const registerContext = recoveryRegisterContext(fx);
  let register = buildArchiveRecoveryRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-14T00:00:45.000Z' });
  register = appendDisasterRecoveryReceiptToRegister({ register, receipt, receiptContext: receiptContext(fx, drill), registerContext, recordedAt: '2026-08-14T00:09:30.000Z' });
  const state = classifyArchiveRecoveryState({ ...registerContext, recoveryRegister: register, now: '2027-02-11T00:09:01.000Z' });
  assert.equal(state.overdueRestoreDrillCount, 1);
  assert.equal(state.recoveryCanAuthorizeRelease, false);
  assert.equal(state.publicRelease, false);
});

test('C1.18 revalidates the C1.17 source register instead of trusting a copied source hash', () => {
  const fx = buildC1_18Fixture();
  const badRegister = structuredClone(fx.c17ArchiveRegister); badRegister.registerHash = '8'.repeat(64);
  assert.throws(() => buildArchiveRecoveryRegister({ c18Policy, c17Policy, c17ArchiveRegister: badRegister, c17RegisterContext: fx.c17RegisterContext, entries: [], revision: 0, recordedAt: '2026-08-14T00:01:00.000Z' }), /Public Archive Register self-hash mismatch/);
});


test('C1.18 re-validates the full C1.17 Archive Record lineage instead of trusting register membership alone', () => {
  const fx = buildC1_18Fixture();
  const forged = structuredClone(fx.archiveRecord);
  forged.outputSha256 = '9'.repeat(64);
  const forgedContext = { ...fx.bundleContext, archiveRecord: forged };
  assert.throws(() => buildArchiveRecoveryBundleManifest({ ...forgedContext, objects: fx.recoveryBundle.objects, createdAt: '2026-08-14T00:01:30.000Z' }), /Public Archive Record outputSha256 drift detected/);
});

test('canonical C1.18 Recovery Register remains revision 0 because PN-0001 has no real archived public release to replicate', () => {
  const base = resolve(import.meta.dirname, '../../../fixtures/cineswarm');
  const canonicalC17 = JSON.parse(readFileSync(resolve(base, 'pn-0001-c1-17-public-archive-register.json'), 'utf8'));
  const canonicalC15 = JSON.parse(readFileSync(resolve(base, 'pn-0001-c1-15-public-release-register.json'), 'utf8'));
  const canonicalC16 = JSON.parse(readFileSync(resolve(base, 'pn-0001-c1-16-release-lifecycle-register.json'), 'utf8'));
  const register = JSON.parse(readFileSync(resolve(base, 'pn-0001-c1-18-archive-recovery-register.json'), 'utf8'));
  const c17RegisterContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: canonicalC15, c16LifecycleRegister: canonicalC16 };
  assert.equal(validateArchiveRecoveryRegister(register, { c18Policy, c17Policy, c17ArchiveRegister: canonicalC17, c17RegisterContext }).valid, true);
  assert.equal(register.revision, 0);
  assert.equal(register.successfulRestoreDrillCount, 0);
  assert.equal(register.publicRelease, false);
  assert.equal(register.relayDependency, false);
});

test('C1.18 recovery evidence never substitutes for archive history, Ledger, release, or Relay authority', () => {
  const fx = buildC1_18Fixture();
  const drill = buildRestoreDrillReport({ ...restoreContext(fx), restoredObjects: restoredFrom(fx.recoveryBundle), restoreTargetId: 'restore-proof', verifierId: 'restore-v', startedAt: '2026-08-14T00:07:00.000Z', completedAt: '2026-08-14T00:08:00.000Z' });
  const receipt = buildDisasterRecoveryReceipt({ ...receiptContext(fx, drill), issuedAt: '2026-08-14T00:09:00.000Z' });
  assert.equal(receipt.historicalArchiveMutated, false);
  assert.equal(receipt.recoveryCanAuthorizeRelease, false);
  assert.equal(receipt.publicRelease, false);
  assert.equal(receipt.relayDependency, false);
});
