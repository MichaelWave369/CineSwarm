import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildArchiveReplicaManifest,
  buildArchiveReplicaSet,
} from '../src/archive-recovery.js';
import {
  appendMaintenanceReceipt,
  buildReplicaMaintenanceRegister,
  buildReplicaMigrationReceipt,
  buildReplicaPlacementPlan,
  buildReplicaSyncReceipt,
  buildStorageAdapterContract,
  buildStorageAdapterRegistry,
} from '../src/replica-maintenance.js';
import {
  buildMediaRefreshCeremonyPayload,
  buildMediaRefreshReceipt,
  buildMediaRefreshReview,
  buildMediaRetirementCeremonyPayload,
  buildMediaRetirementReceipt,
  buildPreservationAuditReceipt,
  buildPreservationAuditSchedule,
  signMediaRefreshCeremony,
  signMediaRetirementCeremony,
} from '../src/preservation-audit-refresh.js';
import { buildC1_19Fixture, c19Policy } from './c1-19-fixture.mjs';
import { c18Policy } from './c1-18-fixture.mjs';
import { c17Policy, c16Policy, c15Policy } from './c1-17-fixture.mjs';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
export const c20Policy = read('pn-0001-c1-20-preservation-audit-refresh-policy.json');
const caps = { read: true, write: true, verifySha256: true, inventory: true, deleteWithoutHumanApproval: false };

export function buildC1_20Fixture() {
  const base = buildC1_19Fixture();
  const copies = base.c18fx.recoveryBundle.objects.map(({ kind, relativePath, blobSha256, sizeBytes }) => ({ kind, relativePath, blobSha256, sizeBytes }));
  const replicaD = buildArchiveReplicaManifest({ c18Policy, recoveryBundle: base.c18fx.recoveryBundle, replicaId: 'replica-d', locationId: 'storage-refresh', failureDomain: 'failure-domain-refresh', storageKind: 'removable-media', objectCopies: copies, recordedAt: '2026-08-13T20:42:00.000Z' });
  const replicaManifests = [base.c18fx.replicaA, base.c18fx.replicaB, base.replicaC, replicaD];
  const replicaSet = buildArchiveReplicaSet({ c18Policy, recoveryBundle: base.c18fx.recoveryBundle, replicaManifests, createdAt: '2026-08-13T20:43:00.000Z', replicaSetId: 'c1-20-proof-replica-set' });
  const adapterD = buildStorageAdapterContract({ c19Policy, adapterId: 'adapter-refresh-media', adapterKind: 'removable-media', locationId: 'storage-refresh', failureDomain: 'failure-domain-refresh', storageClass: 'refresh-media', retrievalMode: 'offline-manual', capabilities: caps, implementationStatus: 'LOCAL_PROOF_IMPLEMENTATION', operatorAttestationId: 'proof-refresh-attestation', createdAt: '2026-08-13T20:43:10.000Z' });
  const adapters = [base.adapterA, base.adapterB, base.adapterC, adapterD];
  const adapterRegistry = buildStorageAdapterRegistry({ c19Policy, adapters, revision: 4, recordedAt: '2026-08-13T20:44:00.000Z' });
  const placementContext = { c19Policy, c18Policy, recoveryBundle: base.c18fx.recoveryBundle, bundleValidationContext: base.c18fx.bundleContext, replicaSet, replicaManifests, adapterRegistry };
  const transitionPlacementPlan = buildReplicaPlacementPlan({ ...placementContext, placements: [
    { replicaId: 'replica-a', adapterId: 'adapter-fs-west' },
    { replicaId: 'replica-b', adapterId: 'adapter-object-east' },
    { replicaId: 'replica-c', adapterId: 'adapter-cold' },
    { replicaId: 'replica-d', adapterId: 'adapter-refresh-media' },
  ], createdAt: '2026-08-13T20:45:00.000Z', planId: 'c1-20-transition-placement' });
  const postRefreshPlacementPlan = buildReplicaPlacementPlan({ ...placementContext, placements: [
    { replicaId: 'replica-b', adapterId: 'adapter-object-east' },
    { replicaId: 'replica-c', adapterId: 'adapter-cold' },
    { replicaId: 'replica-d', adapterId: 'adapter-refresh-media' },
  ], createdAt: '2026-08-13T20:45:30.000Z', planId: 'c1-20-post-refresh-placement' });

  const c18RecoveryRegister = read('pn-0001-c1-18-archive-recovery-register.json');
  const c15reg = read('pn-0001-c1-15-public-release-register.json');
  const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
  const c17reg = read('pn-0001-c1-17-public-archive-register.json');
  const c17RegisterContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
  const c18RecoveryRegisterContext = { c18Policy, c17Policy, c17ArchiveRegister: c17reg, c17RegisterContext };
  const maintenanceRegisterContext = { c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry };
  let maintenanceRegister = buildReplicaMaintenanceRegister({ ...maintenanceRegisterContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:46:00.000Z' });

  const scheduleContext = { c20Policy, c19Policy, placementPlan: transitionPlacementPlan, placementContext, maintenanceRegister, maintenanceRegisterContext };
  const mediaAssignments = [
    { replicaId: 'replica-a', mediaId: 'media-west-001', mediaClass: 'ssd', commissionedAt: '2024-08-13T00:00:00.000Z', refreshDueAt: '2026-08-14T00:00:00.000Z' },
    { replicaId: 'replica-b', mediaId: 'media-east-001', mediaClass: 'object-store', commissionedAt: '2025-08-13T00:00:00.000Z', refreshDueAt: '2030-08-13T00:00:00.000Z' },
    { replicaId: 'replica-c', mediaId: 'media-cold-001', mediaClass: 'cold-storage', commissionedAt: '2025-08-13T00:00:00.000Z', refreshDueAt: '2030-08-13T00:00:00.000Z' },
    { replicaId: 'replica-d', mediaId: 'media-refresh-staging', mediaClass: 'removable-media', commissionedAt: '2026-08-13T20:40:00.000Z', refreshDueAt: '2031-08-13T00:00:00.000Z' },
  ];
  const schedule = buildPreservationAuditSchedule({ ...scheduleContext, mediaAssignments, generatedAt: '2026-08-13T20:47:00.000Z' });

  const verificationA = base.verify(base.c18fx.replicaA, '2026-08-13T20:47:30.000Z', {}, 'c1-20-verify-a');
  const verificationB = base.verify(base.c18fx.replicaB, '2026-08-13T20:48:30.000Z', {}, 'c1-20-verify-b');
  const syncContext = { c19Policy, recoveryBundle: base.c18fx.recoveryBundle, placementPlan: transitionPlacementPlan, placementContext, sourceReplicaManifest: base.c18fx.replicaA, sourceVerificationReport: verificationA, targetReplicaManifest: base.c18fx.replicaB, targetVerificationReport: verificationB };
  const syncReceipt = buildReplicaSyncReceipt({ ...syncContext, syncMode: 'VERIFY_SYNC', changedKinds: [], operatorId: 'c1-20-proof', startedAt: '2026-08-13T20:48:00.000Z', completedAt: '2026-08-13T20:49:00.000Z', receiptId: 'c1-20-proof-audit-sync' });
  const auditReceipt = buildPreservationAuditReceipt({ c20Policy, schedule, scheduleContext, targetReplicaId: 'replica-b', c19SyncReceipt: syncReceipt, c19SyncReceiptContext: syncContext, auditorId: 'c1-20-proof-auditor', recordedAt: '2026-08-13T20:49:10.000Z' });
  maintenanceRegister = appendMaintenanceReceipt({ register: maintenanceRegister, receipt: syncReceipt, receiptContext: syncContext, registerContext: maintenanceRegisterContext, recordedAt: '2026-08-13T20:49:20.000Z' });

  const reviewContext = { c20Policy, schedule, scheduleContext };
  const review = buildMediaRefreshReview({ ...reviewContext, sourceReplicaId: 'replica-a', destinationReplicaId: 'replica-d', destinationMediaId: 'media-refresh-002', destinationMediaClass: 'removable-media', destinationCommissionedAt: '2026-08-13T20:40:00.000Z', destinationRefreshDueAt: '2031-08-13T00:00:00.000Z', decision: 'APPROVE_REFRESH', reason: 'Operator-defined media refresh date is approaching; migrate before retirement.', authorityId: 'michael-hughes', recordedAt: '2026-08-13T20:50:00.000Z' });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyRegistry = {
    schema: 'parallax.cineswarm.signing-key-registry.c1.6.v0.1',
    keys: [{ keyId: 'c1-20-proof-key', algorithm: 'Ed25519', status: 'active', authority: { kind: 'human', id: 'michael-hughes' }, publicKeyPem, validFrom: '2026-08-13T20:00:00.000Z', validUntil: null }],
  };
  const ceremonyContext = { c20Policy, c19Policy, review, reviewContext, transitionPlacementPlan, transitionPlacementContext: placementContext, postRefreshPlacementPlan, postRefreshPlacementContext: placementContext, recoveryBundle: base.c18fx.recoveryBundle };
  const ceremonyPayload = buildMediaRefreshCeremonyPayload({ ...ceremonyContext, authorityId: 'michael-hughes', keyId: 'c1-20-proof-key', recordedAt: '2026-08-13T20:51:00.000Z' });
  const refreshCeremony = signMediaRefreshCeremony(ceremonyPayload, { privateKeyPem, keyRegistry });

  const verificationD = base.verify(replicaD, '2026-08-13T20:53:30.000Z', {}, 'c1-20-verify-d');
  const migrationContext = { c19Policy, recoveryBundle: base.c18fx.recoveryBundle, placementPlan: transitionPlacementPlan, placementContext, sourceReplicaManifest: base.c18fx.replicaA, sourceVerificationReport: verificationA, destinationReplicaManifest: replicaD, destinationVerificationReport: verificationD, sourceAdapter: base.adapterA, destinationAdapter: adapterD };
  const migrationReceipt = buildReplicaMigrationReceipt({ ...migrationContext, operatorId: 'c1-20-proof', startedAt: '2026-08-13T20:52:00.000Z', completedAt: '2026-08-13T20:54:00.000Z', sourceRetirementAuthorized: false, receiptId: 'c1-20-proof-media-migration' });
  maintenanceRegister = appendMaintenanceReceipt({ register: maintenanceRegister, receipt: migrationReceipt, receiptContext: migrationContext, registerContext: maintenanceRegisterContext, recordedAt: '2026-08-13T20:54:05.000Z' });

  const refreshReceiptContext = { c20Policy, ceremony: refreshCeremony, ceremonyContext, keyRegistry, c19MigrationReceipt: migrationReceipt, c19MigrationContext: migrationContext };
  const refreshReceipt = buildMediaRefreshReceipt({ ...refreshReceiptContext, recordedAt: '2026-08-13T20:54:10.000Z' });
  const retirementContext = { c20Policy, refreshReceipt, refreshReceiptContext, postRefreshPlacementPlan, postRefreshPlacementContext: placementContext };
  const retirementPayload = buildMediaRetirementCeremonyPayload({ ...retirementContext, authorityId: 'michael-hughes', keyId: 'c1-20-proof-key', reason: 'Verified replacement is healthy and the governed post-refresh placement plan preserves required redundancy.', recordedAt: '2026-08-13T20:55:00.000Z' });
  const retirementCeremony = signMediaRetirementCeremony(retirementPayload, { privateKeyPem, keyRegistry });
  const retirementReceiptContext = { c20Policy, ceremony: retirementCeremony, ceremonyContext: retirementContext, keyRegistry };
  const retirementReceipt = buildMediaRetirementReceipt({ ...retirementReceiptContext, recordedAt: '2026-08-13T20:55:10.000Z' });

  return {
    base, replicaD, replicaManifests, replicaSet, adapterD, adapters, adapterRegistry, placementContext, transitionPlacementPlan, postRefreshPlacementPlan,
    maintenanceRegisterContext, maintenanceRegister, scheduleContext, mediaAssignments, schedule, verificationA, verificationB, syncContext, syncReceipt, auditReceipt,
    reviewContext, review, keyRegistry, privateKeyPem, ceremonyContext, refreshCeremony, verificationD, migrationContext, migrationReceipt, refreshReceiptContext, refreshReceipt,
    retirementContext, retirementCeremony, retirementReceiptContext, retirementReceipt,
  };
}
