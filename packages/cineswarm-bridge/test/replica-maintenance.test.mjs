import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { c17Policy, c16Policy, c15Policy } from './c1-17-fixture.mjs';
import { c18Policy } from './c1-18-fixture.mjs';
import { buildC1_19Fixture, c19Policy } from './c1-19-fixture.mjs';
import {
  appendMaintenanceReceipt,
  buildReplicaMaintenanceRegister,
  buildReplicaMigrationReceipt,
  buildReplicaPlacementPlan,
  buildReplicaRepairReceipt,
  buildReplicaSyncReceipt,
  buildStorageAdapterContract,
  buildStorageAdapterRegistry,
  classifyReplicaMaintenanceState,
  validateReplicaMaintenancePolicy,
  validateReplicaMaintenanceRegister,
  validateReplicaMigrationReceipt,
  validateReplicaPlacementPlan,
  validateReplicaRepairReceipt,
  validateReplicaSyncReceipt,
  validateStorageAdapterContract,
  validateStorageAdapterRegistry,
} from '../src/replica-maintenance.js';

const base = resolve(import.meta.dirname, '../../../fixtures/cineswarm');
const read = (name) => JSON.parse(readFileSync(resolve(base, name), 'utf8'));
const caps = { read: true, write: true, verifySha256: true, inventory: true, deleteWithoutHumanApproval: false };

function syncContext(fx, source = fx.c18fx.replicaA, sourceVerification = fx.verificationA, target = fx.c18fx.replicaB, targetVerification = fx.verificationB) {
  return { c19Policy, recoveryBundle: fx.c18fx.recoveryBundle, placementPlan: fx.placementPlan, placementContext: fx.placementContext, sourceReplicaManifest: source, sourceVerificationReport: sourceVerification, targetReplicaManifest: target, targetVerificationReport: targetVerification };
}
function repairContext(fx, pre, post) {
  return { c19Policy, recoveryBundle: fx.c18fx.recoveryBundle, placementPlan: fx.placementPlan, placementContext: fx.placementContext, sourceReplicaManifest: fx.c18fx.replicaA, sourceVerificationReport: fx.verificationA, targetReplicaManifest: fx.c18fx.replicaB, preRepairVerificationReport: pre, postRepairVerificationReport: post };
}
function migrationContext(fx, destAdapter = fx.adapterC) {
  return { c19Policy, recoveryBundle: fx.c18fx.recoveryBundle, placementPlan: fx.placementPlan, placementContext: fx.placementContext, sourceReplicaManifest: fx.c18fx.replicaA, sourceVerificationReport: fx.verificationA, destinationReplicaManifest: fx.replicaC, destinationVerificationReport: fx.verificationC, sourceAdapter: fx.adapterA, destinationAdapter: destAdapter };
}

test('C1.19 policy freezes 3 managed replicas, 3 failure domains, cold/offline placement, verification-after-write, and no release/Relay authority', () => {
  assert.equal(validateReplicaMaintenancePolicy(c19Policy).valid, true);
  assert.equal(c19Policy.minimumManagedReplicaCount, 3);
  assert.equal(c19Policy.minimumDistinctFailureDomains, 3);
  assert.equal(c19Policy.requireAtLeastOneColdOrOfflineReplica, true);
  assert.equal(c19Policy.maxSyncAgeDays, 30);
  assert.equal(c19Policy.relayDependency, false);
});

test('Storage Adapter contracts are credential-free capability contracts and physical independence remains operator-attested', () => {
  const fx = buildC1_19Fixture();
  for (const adapter of fx.adapters) assert.equal(validateStorageAdapterContract(adapter, { c19Policy }).valid, true);
  assert.equal(fx.adapterC.adapterKind, 'cold-storage');
  assert.equal(fx.adapterC.retrievalMode, 'delayed');
  assert.equal(fx.adapterC.credentialsStored, false);
  assert.equal(fx.adapterC.physicalIndependenceIsOperatorAttestedNotMachineProven, true);
});

test('Storage Adapter contract rejects secret-like deletion authority or unsupported capability weakening', () => {
  assert.throws(() => buildStorageAdapterContract({ c19Policy, adapterId: 'bad', adapterKind: 'filesystem', locationId: 'x', failureDomain: 'y', storageClass: 'disk', retrievalMode: 'immediate', capabilities: { ...caps, deleteWithoutHumanApproval: true }, implementationStatus: 'CONTRACT_ONLY', operatorAttestationId: 'attest', createdAt: '2026-08-13T20:30:00.000Z' }), /deleteWithoutHumanApproval/);
});

test('Storage Adapter Registry rejects duplicate adapter identities', () => {
  const fx = buildC1_19Fixture();
  assert.equal(validateStorageAdapterRegistry(fx.adapterRegistry, { c19Policy }).valid, true);
  assert.throws(() => buildStorageAdapterRegistry({ c19Policy, adapters: [fx.adapterA, fx.adapterA], revision: 2, recordedAt: '2026-08-13T20:31:00.000Z' }), /adapterIds must be unique/);
});

test('Replica Placement Plan binds exact C1.18 bundle/replica set to three adapters including cold storage', () => {
  const fx = buildC1_19Fixture();
  assert.equal(validateReplicaPlacementPlan(fx.placementPlan, fx.placementContext).valid, true);
  assert.equal(fx.placementPlan.placementCount, 3);
  assert.equal(fx.placementPlan.distinctFailureDomainCount, 3);
  assert.equal(fx.placementPlan.coldOrOfflineReplicaCount, 1);
});

test('Replica Placement Plan rejects missing cold/offline placement and failure-domain lies', () => {
  const fx = buildC1_19Fixture();
  assert.throws(() => buildReplicaPlacementPlan({ ...fx.placementContext, placements: [{ replicaId: 'replica-a', adapterId: 'adapter-fs-west' }, { replicaId: 'replica-b', adapterId: 'adapter-object-east' }], createdAt: '2026-08-13T20:31:00.000Z' }), /at least 3 placements/);
  const badCold = structuredClone(fx.adapterC); badCold.failureDomain = fx.adapterA.failureDomain;
  assert.throws(() => validateStorageAdapterContract(badCold, { c19Policy }), /contract drift/);
});

test('VERIFY_SYNC requires healthy source + target, exact placement, and zero changed objects', () => {
  const fx = buildC1_19Fixture();
  const receipt = buildReplicaSyncReceipt({ ...syncContext(fx), syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' });
  assert.equal(validateReplicaSyncReceipt(receipt, syncContext(fx)).valid, true);
  assert.equal(receipt.targetHealthyAfterWrite, true);
  assert.equal(receipt.publicRelease, false);
});

test('VERIFY_SYNC rejects changed-object claims and unhealthy targets', () => {
  const fx = buildC1_19Fixture();
  assert.throws(() => buildReplicaSyncReceipt({ ...syncContext(fx), syncMode: 'VERIFY_SYNC', changedKinds: ['published-master-media'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' }), /cannot claim changed objects/);
  const bad = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:33:20.000Z', { 'published-master-media': 'MISMATCH' }, 'bad-target');
  assert.throws(() => buildReplicaSyncReceipt({ ...syncContext(fx, fx.c18fx.replicaA, fx.verificationA, fx.c18fx.replicaB, bad), syncMode: 'INITIAL_SYNC', changedKinds: ['published-master-media'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' }), /HEALTHY destination/);
});

test('Replica Repair requires damaged pre-state, healthy source, healthy post-state, and exact repaired kinds', () => {
  const fx = buildC1_19Fixture();
  const pre = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:32:30.000Z', { 'published-master-media': 'MISMATCH' }, 'pre-repair');
  const post = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:34:00.000Z', {}, 'post-repair');
  const receipt = buildReplicaRepairReceipt({ ...repairContext(fx, pre, post), repairedKinds: ['published-master-media'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:34:30.000Z' });
  assert.equal(validateReplicaRepairReceipt(receipt, repairContext(fx, pre, post)).valid, true);
  assert.equal(receipt.targetHealthyAfterRepair, true);
});

test('Replica Repair refuses to claim healthy objects or exceed the internal repair window', () => {
  const fx = buildC1_19Fixture();
  const pre = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:32:30.000Z', { 'published-master-media': 'MISMATCH' }, 'pre-repair');
  const post = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:34:00.000Z', {}, 'post-repair');
  assert.throws(() => buildReplicaRepairReceipt({ ...repairContext(fx, pre, post), repairedKinds: ['public-release-receipt-json'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:34:30.000Z' }), /unchanged healthy kind/);
  assert.throws(() => buildReplicaRepairReceipt({ ...repairContext(fx, pre, post), repairedKinds: ['published-master-media'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-14T21:00:00.000Z' }), /maxOpenRepairAgeHours/);
});

test('Replica Migration preserves historical identity and never auto-deletes the source', () => {
  const fx = buildC1_19Fixture();
  const receipt = buildReplicaMigrationReceipt({ ...migrationContext(fx), operatorId: 'ori-proof', startedAt: '2026-08-13T20:36:00.000Z', completedAt: '2026-08-13T20:37:00.000Z', sourceRetirementAuthorized: true });
  assert.equal(validateReplicaMigrationReceipt(receipt, migrationContext(fx)).valid, true);
  assert.equal(receipt.historicalOutputSha256, fx.c18fx.recoveryBundle.outputSha256);
  assert.equal(receipt.sourceAutoDeleted, false);
  assert.equal(receipt.publicRelease, false);
});

test('Replica Migration rejects destination adapter substitution before failure-domain claims can be laundered', () => {
  const fx = buildC1_19Fixture();
  const sameDomain = buildStorageAdapterContract({ c19Policy, adapterId: 'adapter-cold-same-domain', adapterKind: 'cold-storage', locationId: 'storage-cold', failureDomain: fx.adapterA.failureDomain, storageClass: 'deep-archive', retrievalMode: 'delayed', capabilities: caps, implementationStatus: 'CONTRACT_ONLY', operatorAttestationId: 'same-domain-proof', createdAt: '2026-08-13T20:29:31.000Z' });
  assert.throws(() => buildReplicaMigrationReceipt({ ...migrationContext(fx, sameDomain), operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:35:00.000Z' }), /destination adapter does not match governed placement/);
});

test('Replica Maintenance Register appends sync, repair, and migration evidence in a hash chain', () => {
  const fx = buildC1_19Fixture();
  const c18RecoveryRegister = read('pn-0001-c1-18-archive-recovery-register.json');
  const c17 = read('pn-0001-c1-17-public-archive-policy.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c17RegisterContext = { c17Policy: c17, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy: c17, c17ArchiveRegister: c17reg, c17RegisterContext };
  const registerContext = { c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry: fx.adapterRegistry };
  let register = buildReplicaMaintenanceRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:32:30.000Z' });
  const syncCtx = syncContext(fx);
  const sync = buildReplicaSyncReceipt({ ...syncCtx, syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' });
  register = appendMaintenanceReceipt({ register, receipt: sync, receiptContext: syncCtx, registerContext, recordedAt: '2026-08-13T20:33:40.000Z' });
  const pre = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:34:00.000Z', { 'published-master-media': 'MISMATCH' }, 'pre-r2');
  const post = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:35:00.000Z', {}, 'post-r2');
  const repairCtx = repairContext(fx, pre, post);
  const repair = buildReplicaRepairReceipt({ ...repairCtx, repairedKinds: ['published-master-media'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:34:10.000Z', completedAt: '2026-08-13T20:35:30.000Z' });
  register = appendMaintenanceReceipt({ register, receipt: repair, receiptContext: repairCtx, registerContext, recordedAt: '2026-08-13T20:35:40.000Z' });
  const migCtx = migrationContext(fx);
  const migration = buildReplicaMigrationReceipt({ ...migCtx, operatorId: 'ori-proof', startedAt: '2026-08-13T20:36:00.000Z', completedAt: '2026-08-13T20:37:00.000Z' });
  register = appendMaintenanceReceipt({ register, receipt: migration, receiptContext: migCtx, registerContext, recordedAt: '2026-08-13T20:37:10.000Z' });
  assert.equal(validateReplicaMaintenanceRegister(register, registerContext).valid, true);
  assert.equal(register.revision, 3);
  assert.equal(register.syncVerifiedCount, 1);
  assert.equal(register.repairCount, 1);
  assert.equal(register.migrationCount, 1);
});

test('Replica Maintenance Register rejects duplicate receipts and hash-chain edits', () => {
  const fx = buildC1_19Fixture();
  const c18RecoveryRegister = read('pn-0001-c1-18-archive-recovery-register.json');
  const c17 = read('pn-0001-c1-17-public-archive-policy.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c17RegisterContext = { c17Policy: c17, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy: c17, c17ArchiveRegister: c17reg, c17RegisterContext };
  const registerContext = { c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry: fx.adapterRegistry };
  let register = buildReplicaMaintenanceRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:32:30.000Z' });
  const ctx = syncContext(fx);
  const sync = buildReplicaSyncReceipt({ ...ctx, syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' });
  register = appendMaintenanceReceipt({ register, receipt: sync, receiptContext: ctx, registerContext, recordedAt: '2026-08-13T20:33:40.000Z' });
  assert.throws(() => appendMaintenanceReceipt({ register, receipt: sync, receiptContext: ctx, registerContext, recordedAt: '2026-08-13T20:33:50.000Z' }), /already registered/);
  const tampered = structuredClone(register); tampered.entries[0].replicaId = 'evil-replica';
  assert.throws(() => validateReplicaMaintenanceRegister(tampered, registerContext), /self-hash mismatch|drift/);
});

test('Maintenance status reports overdue sync under internal 30-day policy without creating release authority', () => {
  const fx = buildC1_19Fixture();
  const c18RecoveryRegister = read('pn-0001-c1-18-archive-recovery-register.json');
  const c17 = read('pn-0001-c1-17-public-archive-policy.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c17RegisterContext = { c17Policy: c17, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy: c17, c17ArchiveRegister: c17reg, c17RegisterContext };
  const registerContext = { c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry: fx.adapterRegistry };
  let register = buildReplicaMaintenanceRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:32:30.000Z' });
  const ctx = syncContext(fx); const sync = buildReplicaSyncReceipt({ ...ctx, syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' });
  register = appendMaintenanceReceipt({ register, receipt: sync, receiptContext: ctx, registerContext, recordedAt: '2026-08-13T20:33:40.000Z' });
  const status = classifyReplicaMaintenanceState({ ...registerContext, maintenanceRegister: register, now: '2026-09-13T20:34:00.000Z' });
  assert.equal(status.overdueSyncCount, 1);
  assert.equal(status.publicRelease, false);
});

test('canonical C1.19 Adapter + Maintenance Registers remain revision 0 because PN-0001 has no real archive replicas to manage', () => {
  const c17 = read('pn-0001-c1-17-public-archive-policy.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c18reg = read('pn-0001-c1-18-archive-recovery-register.json');
  const adapters = read('pn-0001-c1-19-storage-adapter-registry.json');
  const register = read('pn-0001-c1-19-replica-maintenance-register.json');
  const c17RegisterContext = { c17Policy: c17, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy: c17, c17ArchiveRegister: c17reg, c17RegisterContext };
  assert.equal(validateStorageAdapterRegistry(adapters, { c19Policy }).valid, true);
  assert.equal(validateReplicaMaintenanceRegister(register, { c19Policy, c18Policy, c18RecoveryRegister: c18reg, c18RecoveryRegisterContext, adapterRegistry: adapters }).valid, true);
  assert.equal(adapters.revision, 0);
  assert.equal(register.revision, 0);
  assert.equal(register.publicRelease, false);
});

test('C1.19 revalidates the C1.18 source register rather than trusting a copied source hash', () => {
  const c17 = read('pn-0001-c1-17-public-archive-policy.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c18reg = read('pn-0001-c1-18-archive-recovery-register.json');
  const adapters = read('pn-0001-c1-19-storage-adapter-registry.json');
  const c17RegisterContext = { c17Policy: c17, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy: c17, c17ArchiveRegister: c17reg, c17RegisterContext };
  const bad = structuredClone(c18reg); bad.registerHash = 'f'.repeat(64);
  assert.throws(() => buildReplicaMaintenanceRegister({ c19Policy, c18Policy, c18RecoveryRegister: bad, c18RecoveryRegisterContext, adapterRegistry: adapters, entries: [], revision: 0, recordedAt: '2026-08-13T20:42:00.000Z' }), /Recovery Register self-hash mismatch/);
});

test('C1.19 maintenance evidence can never authorize release or create a Relay dependency', () => {
  const fx = buildC1_19Fixture();
  const receipt = buildReplicaMigrationReceipt({ ...migrationContext(fx), operatorId: 'ori-proof', startedAt: '2026-08-13T20:36:00.000Z', completedAt: '2026-08-13T20:37:00.000Z' });
  assert.equal(receipt.maintenanceCanAuthorizeRelease, false);
  assert.equal(receipt.publicRelease, false);
  assert.equal(receipt.relayDependency, false);
});

test('Replica Repair rejects valid replicas that are not both named in the governed placement plan', () => {
  const fx = buildC1_19Fixture();
  const reduced = structuredClone(fx.placementPlan);
  reduced.placements = reduced.placements.filter((item) => item.replicaId !== 'replica-b');
  reduced.placementCount = 2;
  // A hand-edited plan fails validation before it can weaken repair authority.
  const pre = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:32:30.000Z', { 'published-master-media': 'MISMATCH' }, 'pre-unplaced');
  const post = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:34:00.000Z', {}, 'post-unplaced');
  assert.throws(() => buildReplicaRepairReceipt({ ...repairContext(fx, pre, post), placementPlan: reduced, repairedKinds: ['published-master-media'], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:34:30.000Z' }), /Placement Plan drift|at least 3 placements/);
});

test('Replica Migration rejects a valid adapter contract when it is not the adapter paired to the destination replica', () => {
  const fx = buildC1_19Fixture();
  const wrong = buildStorageAdapterContract({ c19Policy, adapterId: 'adapter-unbound-cold', adapterKind: 'cold-storage', locationId: 'storage-cold', failureDomain: 'failure-domain-cold', storageClass: 'deep-archive', retrievalMode: 'delayed', capabilities: caps, implementationStatus: 'CONTRACT_ONLY', operatorAttestationId: 'unbound-proof', createdAt: '2026-08-13T20:29:31.000Z' });
  assert.throws(() => buildReplicaMigrationReceipt({ ...migrationContext(fx, wrong), operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:35:00.000Z' }), /destination adapter does not match governed placement/);
});


test('Replica Sync rejects a destination verification that predates the claimed sync window', () => {
  const fx = buildC1_19Fixture();
  const staleTarget = fx.verify(fx.c18fx.replicaB, '2026-08-13T20:32:30.000Z', {}, 'stale-target');
  assert.throws(() => buildReplicaSyncReceipt({ ...syncContext(fx, fx.c18fx.replicaA, fx.verificationA, fx.c18fx.replicaB, staleTarget), syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'ori-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z' }), /post-write verification cannot predate sync start/);
});

test('Replica Migration rejects destination verification that predates the migration window', () => {
  const fx = buildC1_19Fixture();
  const staleDestination = fx.verify(fx.replicaC, '2026-08-13T20:35:30.000Z', {}, 'stale-migration-dest');
  assert.throws(() => buildReplicaMigrationReceipt({ ...migrationContext(fx), destinationVerificationReport: staleDestination, operatorId: 'ori-proof', startedAt: '2026-08-13T20:36:00.000Z', completedAt: '2026-08-13T20:37:00.000Z' }), /destination verification cannot predate migration start/);
});
