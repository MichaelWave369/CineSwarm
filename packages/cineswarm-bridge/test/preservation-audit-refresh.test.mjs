import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { c17Policy, c16Policy, c15Policy } from './c1-17-fixture.mjs';
import { c18Policy } from './c1-18-fixture.mjs';
import { c19Policy } from './c1-19-fixture.mjs';
import { buildReplicaMigrationReceipt, buildReplicaSyncReceipt } from '../src/replica-maintenance.js';
import { buildC1_20Fixture, c20Policy } from './c1-20-fixture.mjs';
import {
  appendPreservationReceipt,
  buildMediaRefreshCeremonyPayload,
  buildMediaRefreshReceipt,
  buildMediaRefreshReview,
  buildMediaRetirementCeremonyPayload,
  buildPreservationAuditReceipt,
  buildPreservationAuditSchedule,
  buildPreservationRegister,
  classifyPreservationAuditSchedule,
  classifyPreservationState,
  signMediaRefreshCeremony,
  validateMediaRefreshReceipt,
  validateMediaRefreshReview,
  validateMediaRetirementReceipt,
  validatePreservationAuditReceipt,
  validatePreservationAuditRefreshPolicy,
  validatePreservationAuditSchedule,
  validatePreservationRegister,
  verifyMediaRefreshCeremony,
  verifyMediaRetirementCeremony,
} from '../src/preservation-audit-refresh.js';

const base = resolve(import.meta.dirname, '../../../fixtures/cineswarm');
const read = (name) => JSON.parse(readFileSync(resolve(base, name), 'utf8'));

function canonicalRegisterContext() {
  const c18reg = read('pn-0001-c1-18-archive-recovery-register.json');
  const c17 = read('pn-0001-c1-17-public-archive-policy.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c19reg = read('pn-0001-c1-19-replica-maintenance-register.json');
  const adapters = read('pn-0001-c1-19-storage-adapter-registry.json');
  const c17RegisterContext = { c17Policy: c17, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy: c17, c17ArchiveRegister: c17reg, c17RegisterContext };
  const c19MaintenanceRegisterContext = { c19Policy, c18Policy, c18RecoveryRegister: c18reg, c18RecoveryRegisterContext, adapterRegistry: adapters };
  return { c19reg, adapters, c19MaintenanceRegisterContext };
}

test('C1.20 policy freezes audit/refresh boundaries without release or Relay authority', () => {
  assert.equal(validatePreservationAuditRefreshPolicy(c20Policy).valid, true);
  assert.equal(c20Policy.maxAuditAgeDays, 30);
  assert.equal(c20Policy.refreshWarningLeadDays, 90);
  assert.equal(c20Policy.requireSeparateRetirementCeremony, true);
  assert.equal(c20Policy.autoRetireSource, false);
  assert.equal(c20Policy.relayDependency, false);
});

test('Preservation Audit Schedule binds one unique media identity to every governed placement', () => {
  const fx = buildC1_20Fixture();
  assert.equal(validatePreservationAuditSchedule(fx.schedule, fx.scheduleContext).valid, true);
  assert.equal(fx.schedule.targetCount, 4);
  assert.equal(new Set(fx.schedule.targets.map((item) => item.mediaId)).size, 4);
  assert.equal(fx.schedule.publicRelease, false);
});

test('Preservation Audit Schedule rejects duplicate media identity and placement drift', () => {
  const fx = buildC1_20Fixture();
  const badAssignments = structuredClone(fx.mediaAssignments);
  badAssignments[1].mediaId = badAssignments[0].mediaId;
  assert.throws(() => buildPreservationAuditSchedule({ ...fx.scheduleContext, mediaAssignments: badAssignments, generatedAt: fx.schedule.generatedAt }), /mediaId values must be unique/);
  const tampered = structuredClone(fx.schedule); tampered.targets[0].adapterId = 'evil-adapter';
  assert.throws(() => validatePreservationAuditSchedule(tampered, fx.scheduleContext), /drift detected/);
});

test('Audit scheduler reports refresh warning/due and overdue audit state without authorizing release', () => {
  const fx = buildC1_20Fixture();
  const status = classifyPreservationAuditSchedule({ schedule: fx.schedule, scheduleContext: fx.scheduleContext, now: '2026-09-16T20:47:01.000Z' });
  assert.ok(status.overdueAuditCount >= 1);
  assert.ok(status.refreshDueCount >= 1);
  assert.equal(status.publicRelease, false);
});

test('Preservation Audit Receipt requires a fresh zero-change C1.19 VERIFY_SYNC', () => {
  const fx = buildC1_20Fixture();
  assert.equal(validatePreservationAuditReceipt(fx.auditReceipt, { c20Policy, schedule: fx.schedule, scheduleContext: fx.scheduleContext, targetReplicaId: 'replica-b', c19SyncReceipt: fx.syncReceipt, c19SyncReceiptContext: fx.syncContext, auditorId: fx.auditReceipt.auditorId, recordedAt: fx.auditReceipt.recordedAt, receiptId: fx.auditReceipt.receiptId }).valid, true);
  const staleContext = { ...fx.syncContext, sourceVerificationReport: fx.base.verificationA, targetVerificationReport: fx.base.verificationB };
  const stale = buildReplicaSyncReceipt({ ...staleContext, syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'stale-proof', startedAt: '2026-08-13T20:33:00.000Z', completedAt: '2026-08-13T20:33:30.000Z', receiptId: 'stale-before-c1-20-schedule' });
  assert.throws(() => buildPreservationAuditReceipt({ c20Policy, schedule: fx.schedule, scheduleContext: fx.scheduleContext, targetReplicaId: 'replica-b', c19SyncReceipt: stale, c19SyncReceiptContext: staleContext, auditorId: 'x', recordedAt: '2026-08-13T20:49:10.000Z' }), /predates the schedule/);
});

test('Media Refresh Review is human-only evidence and does not itself authorize refresh or retirement', () => {
  const fx = buildC1_20Fixture();
  assert.equal(validateMediaRefreshReview(fx.review, fx.reviewContext).valid, true);
  assert.equal(fx.review.decision, 'APPROVE_REFRESH');
  assert.equal(fx.review.refreshAuthorized, false);
  assert.equal(fx.review.sourceRetirementAuthorized, false);
  assert.equal(fx.review.sourceDeletionAuthorized, false);
});

test('Signed Media Refresh Ceremony binds exact review, old/new placement plans, historical output, and short authorization window', () => {
  const fx = buildC1_20Fixture();
  const verified = verifyMediaRefreshCeremony({ ceremony: fx.refreshCeremony, keyRegistry: fx.keyRegistry, ...fx.ceremonyContext });
  assert.equal(verified.valid, true);
  assert.equal(fx.refreshCeremony.refreshAuthorized, true);
  assert.equal(fx.refreshCeremony.sourceRetirementAuthorized, false);
  assert.equal(fx.refreshCeremony.sourceDeletionAuthorized, false);
});

test('Media Refresh Ceremony rejects post-signature placement or review tampering', () => {
  const fx = buildC1_20Fixture();
  const tampered = structuredClone(fx.refreshCeremony); tampered.destinationMediaId = 'other-media';
  assert.throws(() => verifyMediaRefreshCeremony({ ceremony: tampered, keyRegistry: fx.keyRegistry, ...fx.ceremonyContext }), /drift detected|digest mismatch|signature/);
  const badReview = structuredClone(fx.review); badReview.reason = 'changed';
  assert.throws(() => buildMediaRefreshCeremonyPayload({ ...fx.ceremonyContext, review: badReview, authorityId: 'michael-hughes', keyId: 'c1-20-proof-key', recordedAt: '2026-08-13T20:51:00.000Z' }), /Review drift/);
});


test('Media Refresh Ceremony rejects revoked human signing keys', () => {
  const fx = buildC1_20Fixture();
  const revoked = structuredClone(fx.keyRegistry);
  revoked.keys[0].status = 'revoked';
  assert.throws(() => verifyMediaRefreshCeremony({ ceremony: fx.refreshCeremony, keyRegistry: revoked, ...fx.ceremonyContext }), /revoked/);
});

test('Media Refresh Receipt rejects migration attempts started after the signed authorization expires', () => {
  const fx = buildC1_20Fixture();
  const sourceVerification = fx.base.verify(fx.base.c18fx.replicaA, '2026-08-14T21:50:00.000Z', {}, 'c1-20-late-source');
  const destinationVerification = fx.base.verify(fx.replicaD, '2026-08-14T21:53:00.000Z', {}, 'c1-20-late-destination');
  const lateContext = { ...fx.migrationContext, sourceVerificationReport: sourceVerification, destinationVerificationReport: destinationVerification };
  const lateMigration = buildReplicaMigrationReceipt({ ...lateContext, operatorId: 'late-proof', startedAt: '2026-08-14T21:52:00.000Z', completedAt: '2026-08-14T21:54:00.000Z', sourceRetirementAuthorized: false, receiptId: 'c1-20-late-migration' });
  assert.throws(() => buildMediaRefreshReceipt({ ...fx.refreshReceiptContext, c19MigrationReceipt: lateMigration, c19MigrationContext: lateContext, recordedAt: '2026-08-14T21:54:10.000Z' }), /authorization expired/);
});

test('Media Refresh Receipt requires an exact C1.19 migration executed after authorization and preserves historical identity', () => {
  const fx = buildC1_20Fixture();
  assert.equal(validateMediaRefreshReceipt(fx.refreshReceipt, fx.refreshReceiptContext).valid, true);
  assert.equal(fx.refreshReceipt.historicalOutputSha256, fx.base.c18fx.recoveryBundle.outputSha256);
  assert.equal(fx.refreshReceipt.destinationHealthyAfterRefresh, true);
  assert.equal(fx.refreshReceipt.sourceRetired, false);
  assert.equal(fx.refreshReceipt.sourceBytesDeleted, false);
});

test('Media Refresh Receipt rejects migration that tries to pre-authorize source retirement', () => {
  const fx = buildC1_20Fixture();
  const bad = structuredClone(fx.migrationReceipt); bad.sourceRetirementAuthorized = true;
  assert.throws(() => buildMediaRefreshReceipt({ ...fx.refreshReceiptContext, c19MigrationReceipt: bad, recordedAt: '2026-08-13T20:54:10.000Z' }), /drift|leave source retirement/);
});

test('Media Retirement Ceremony requires verified replacement and a post-refresh plan that excludes old source but retains replacement', () => {
  const fx = buildC1_20Fixture();
  assert.equal(verifyMediaRetirementCeremony({ ceremony: fx.retirementCeremony, keyRegistry: fx.keyRegistry, ...fx.retirementContext }).valid, true);
  assert.equal(fx.retirementCeremony.sourceRetirementAuthorized, true);
  assert.equal(fx.retirementCeremony.sourceDeletionAuthorized, false);
  const badPlan = fx.transitionPlacementPlan;
  assert.throws(() => buildMediaRetirementCeremonyPayload({ ...fx.retirementContext, postRefreshPlacementPlan: badPlan, authorityId: 'michael-hughes', keyId: 'c1-20-proof-key', reason: 'bad', recordedAt: '2026-08-13T20:55:00.000Z' }), /post-refresh placement plan drift detected|must exclude source replica/);
});

test('Media Retirement Receipt records logical retirement but never deletion authority', () => {
  const fx = buildC1_20Fixture();
  assert.equal(validateMediaRetirementReceipt(fx.retirementReceipt, fx.retirementReceiptContext).valid, true);
  assert.equal(fx.retirementReceipt.sourceRetired, true);
  assert.equal(fx.retirementReceipt.sourceBytesDeleted, false);
  assert.equal(fx.retirementReceipt.sourceDeletionAuthorized, false);
  assert.equal(fx.retirementReceipt.publicRelease, false);
});

test('Preservation Register appends audit → refresh → retirement history in an immutable hash chain', () => {
  const fx = buildC1_20Fixture();
  const registerContext = { c20Policy, c19Policy, c19MaintenanceRegister: fx.maintenanceRegister, c19MaintenanceRegisterContext: fx.maintenanceRegisterContext, storageAdapterRegistry: fx.adapterRegistry };
  let register = buildPreservationRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:54:20.000Z' });
  const auditCtx = { c20Policy, schedule: fx.schedule, scheduleContext: fx.scheduleContext, targetReplicaId: 'replica-b', c19SyncReceipt: fx.syncReceipt, c19SyncReceiptContext: fx.syncContext, auditorId: fx.auditReceipt.auditorId, recordedAt: fx.auditReceipt.recordedAt, receiptId: fx.auditReceipt.receiptId };
  register = appendPreservationReceipt({ register, receipt: fx.auditReceipt, receiptContext: auditCtx, registerContext, recordedAt: '2026-08-13T20:54:30.000Z' });
  register = appendPreservationReceipt({ register, receipt: fx.refreshReceipt, receiptContext: fx.refreshReceiptContext, registerContext, recordedAt: '2026-08-13T20:54:40.000Z' });
  register = appendPreservationReceipt({ register, receipt: fx.retirementReceipt, receiptContext: fx.retirementReceiptContext, registerContext, recordedAt: '2026-08-13T20:55:20.000Z' });
  assert.equal(validatePreservationRegister(register, registerContext).valid, true);
  assert.equal(register.revision, 3);
  assert.equal(register.auditCount, 1);
  assert.equal(register.refreshCount, 1);
  assert.equal(register.retirementCount, 1);
});

test('Preservation Register rejects duplicate receipts and hash-chain edits', () => {
  const fx = buildC1_20Fixture();
  const registerContext = { c20Policy, c19Policy, c19MaintenanceRegister: fx.maintenanceRegister, c19MaintenanceRegisterContext: fx.maintenanceRegisterContext, storageAdapterRegistry: fx.adapterRegistry };
  let register = buildPreservationRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:54:20.000Z' });
  register = appendPreservationReceipt({ register, receipt: fx.refreshReceipt, receiptContext: fx.refreshReceiptContext, registerContext, recordedAt: '2026-08-13T20:54:40.000Z' });
  assert.throws(() => appendPreservationReceipt({ register, receipt: fx.refreshReceipt, receiptContext: fx.refreshReceiptContext, registerContext, recordedAt: '2026-08-13T20:54:50.000Z' }), /already registered/);
  const tampered = structuredClone(register); tampered.entries[0].replicaId = 'evil-replica';
  assert.throws(() => validatePreservationRegister(tampered, registerContext), /self-hash mismatch|drift/);
});

test('C1.20 full proof path can refresh and retire old media without gaining release authority', () => {
  const fx = buildC1_20Fixture();
  const registerContext = { c20Policy, c19Policy, c19MaintenanceRegister: fx.maintenanceRegister, c19MaintenanceRegisterContext: fx.maintenanceRegisterContext, storageAdapterRegistry: fx.adapterRegistry };
  let register = buildPreservationRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:54:20.000Z' });
  register = appendPreservationReceipt({ register, receipt: fx.refreshReceipt, receiptContext: fx.refreshReceiptContext, registerContext, recordedAt: '2026-08-13T20:54:40.000Z' });
  register = appendPreservationReceipt({ register, receipt: fx.retirementReceipt, receiptContext: fx.retirementReceiptContext, registerContext, recordedAt: '2026-08-13T20:55:20.000Z' });
  const status = classifyPreservationState({ ...registerContext, preservationRegister: register });
  assert.equal(status.refreshCount, 1);
  assert.equal(status.retirementCount, 1);
  assert.equal(status.preservationCanAuthorizeRelease, false);
  assert.equal(status.publicRelease, false);
  assert.equal(status.relayDependency, false);
});

test('canonical C1.20 Preservation Register remains revision 0 because PN-0001 has no real managed archive media', () => {
  const { c19reg, adapters, c19MaintenanceRegisterContext } = canonicalRegisterContext();
  const register = read('pn-0001-c1-20-preservation-register.json');
  const context = { c20Policy, c19Policy, c19MaintenanceRegister: c19reg, c19MaintenanceRegisterContext, storageAdapterRegistry: adapters };
  assert.equal(validatePreservationRegister(register, context).valid, true);
  assert.equal(register.revision, 0);
  assert.equal(register.refreshCount, 0);
  assert.equal(register.retirementCount, 0);
  assert.equal(register.publicRelease, false);
});
