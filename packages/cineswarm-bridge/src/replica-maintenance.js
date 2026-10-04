import { digestJson } from './authorization-seal.js';
import {
  CINESWARM_ARCHIVE_RECOVERY_REGISTER_SCHEMA,
  CINESWARM_RECOVERY_BUNDLE_SCHEMA,
  buildArchiveReplicaSet,
  validateArchiveRecoveryBundleManifest,
  validateArchiveRecoveryPolicy,
  validateArchiveRecoveryRegister,
  validateArchiveReplicaManifest,
  validateArchiveReplicaSet,
  validateReplicaVerificationReport,
} from './archive-recovery.js';

export const CINESWARM_REPLICA_MAINTENANCE_POLICY_SCHEMA = 'parallax.cineswarm.replica-maintenance-policy.c1.19.v0.1';
export const CINESWARM_STORAGE_ADAPTER_SCHEMA = 'parallax.cineswarm.storage-adapter-contract.c1.19.v0.1';
export const CINESWARM_STORAGE_ADAPTER_REGISTRY_SCHEMA = 'parallax.cineswarm.storage-adapter-registry.c1.19.v0.1';
export const CINESWARM_REPLICA_PLACEMENT_SCHEMA = 'parallax.cineswarm.replica-placement-plan.c1.19.v0.1';
export const CINESWARM_SYNC_RECEIPT_SCHEMA = 'parallax.cineswarm.replica-sync-receipt.c1.19.v0.1';
export const CINESWARM_REPAIR_RECEIPT_SCHEMA = 'parallax.cineswarm.replica-repair-receipt.c1.19.v0.1';
export const CINESWARM_MIGRATION_RECEIPT_SCHEMA = 'parallax.cineswarm.replica-migration-receipt.c1.19.v0.1';
export const CINESWARM_REPLICA_MAINTENANCE_REGISTER_SCHEMA = 'parallax.cineswarm.replica-maintenance-register.c1.19.v0.1';

export const C1_19_ADAPTER_KINDS = ['filesystem', 'object-store', 'cold-storage', 'removable-media'];
export const C1_19_RETRIEVAL_MODES = ['immediate', 'delayed', 'offline-manual'];
export const C1_19_SYNC_MODES = ['INITIAL_SYNC', 'VERIFY_SYNC', 'REPAIR_SYNC', 'MIGRATION_SYNC'];
export const C1_19_REGISTER_EVENTS = ['SYNC_VERIFIED', 'REPAIR_COMPLETED', 'MIGRATION_COMPLETED'];

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function safeToken(value, label) {
  const text = requiredString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`${label} contains unsupported characters`);
  return text;
}
function ensureSha256(value, label) {
  const text = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}
function parseTime(value, label) {
  const text = requiredString(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  return { text, time };
}
function withoutFields(value, fields) {
  const copy = structuredClone(value);
  for (const field of fields) delete copy[field];
  return copy;
}
function plusDays(iso, days) {
  const date = new Date(parseTime(iso, 'timestamp').time);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
function plusHours(iso, hours) {
  const date = new Date(parseTime(iso, 'timestamp').time);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}
function assertAuthorityBoundary(value, label) {
  for (const key of ['publicRelease', 'relayDependency']) if (value[key] !== false) throw new Error(`${label}.${key} must remain false`);
  if (value.maintenanceCanAuthorizeRelease !== false) throw new Error(`${label}.maintenanceCanAuthorizeRelease must remain false`);
}

export function validateReplicaMaintenancePolicy(policy) {
  if (!policy || policy.schema !== CINESWARM_REPLICA_MAINTENANCE_POLICY_SCHEMA) throw new Error('invalid C1.19 Replica Maintenance policy schema');
  for (const [value, label] of [[policy.policyId, 'policyId'], [policy.c18PolicyId, 'c18PolicyId'], [policy.episodeId, 'episodeId'], [policy.sequenceId, 'sequenceId'], [policy.networkId, 'networkId']]) safeToken(value, label);
  if (!Number.isInteger(policy.minimumManagedReplicaCount) || policy.minimumManagedReplicaCount < 2 || policy.minimumManagedReplicaCount > 10) throw new Error('minimumManagedReplicaCount must be 2-10');
  if (!Number.isInteger(policy.minimumDistinctFailureDomains) || policy.minimumDistinctFailureDomains < 2 || policy.minimumDistinctFailureDomains > policy.minimumManagedReplicaCount) throw new Error('minimumDistinctFailureDomains must be 2..minimumManagedReplicaCount');
  if (!Number.isInteger(policy.maxSyncAgeDays) || policy.maxSyncAgeDays < 1 || policy.maxSyncAgeDays > 365) throw new Error('maxSyncAgeDays must be an internal 1-365 day policy');
  if (!Number.isInteger(policy.maxOpenRepairAgeHours) || policy.maxOpenRepairAgeHours < 1 || policy.maxOpenRepairAgeHours > 720) throw new Error('maxOpenRepairAgeHours must be an internal 1-720 hour policy');
  for (const key of [
    'requireC18BundleValidation', 'requireExactInventoryParity', 'requireHealthySourceForRepair', 'requireHealthyDestinationAfterWrite',
    'requireDistinctFailureDomains', 'requireAtLeastOneColdOrOfflineReplica', 'verifyAfterEveryWrite', 'appendOnlyMaintenanceRegister',
    'migrationPreservesHistoricalIdentity', 'operatorAttestsPhysicalIndependence',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of ['autoDeleteSourceAfterMigration', 'maintenanceCanAuthorizeRelease', 'autoRepublish', 'relayDependency']) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function adapterPayload(adapter) { return withoutFields(adapter, ['adapterContractHash']); }
export function buildStorageAdapterContract({ c19Policy, adapterId, adapterKind, locationId, failureDomain, storageClass, retrievalMode, capabilities, implementationStatus, operatorAttestationId, createdAt }) {
  validateReplicaMaintenancePolicy(c19Policy);
  if (!C1_19_ADAPTER_KINDS.includes(adapterKind)) throw new Error('unsupported C1.19 storage adapter kind');
  if (!C1_19_RETRIEVAL_MODES.includes(retrievalMode)) throw new Error('unsupported C1.19 retrieval mode');
  if (!capabilities || typeof capabilities !== 'object') throw new Error('storage adapter capabilities are required');
  for (const key of ['read', 'write', 'verifySha256', 'inventory']) if (capabilities[key] !== true) throw new Error(`storage adapter capability ${key} must remain true`);
  if (capabilities.deleteWithoutHumanApproval !== false) throw new Error('storage adapter cannot allow deleteWithoutHumanApproval');
  if (!['CONTRACT_ONLY', 'LOCAL_PROOF_IMPLEMENTATION', 'OPERATOR_CONFIGURED'].includes(implementationStatus)) throw new Error('unsupported storage adapter implementationStatus');
  const adapter = {
    schema: CINESWARM_STORAGE_ADAPTER_SCHEMA,
    adapterId: safeToken(adapterId, 'adapterId'),
    policyId: c19Policy.policyId,
    adapterKind,
    locationId: safeToken(locationId, 'locationId'),
    failureDomain: safeToken(failureDomain, 'failureDomain'),
    storageClass: safeToken(storageClass, 'storageClass'),
    retrievalMode,
    capabilities: structuredClone(capabilities),
    implementationStatus,
    operatorAttestationId: safeToken(operatorAttestationId, 'operatorAttestationId'),
    physicalIndependenceIsOperatorAttestedNotMachineProven: true,
    credentialsStored: false,
    createdAt: parseTime(createdAt, 'createdAt').text,
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  adapter.adapterContractHash = digestJson(adapterPayload(adapter));
  return adapter;
}

export function validateStorageAdapterContract(adapter, { c19Policy }) {
  if (!adapter || adapter.schema !== CINESWARM_STORAGE_ADAPTER_SCHEMA) throw new Error('invalid C1.19 Storage Adapter schema');
  const rebuilt = buildStorageAdapterContract({ c19Policy, adapterId: adapter.adapterId, adapterKind: adapter.adapterKind, locationId: adapter.locationId, failureDomain: adapter.failureDomain, storageClass: adapter.storageClass, retrievalMode: adapter.retrievalMode, capabilities: adapter.capabilities, implementationStatus: adapter.implementationStatus, operatorAttestationId: adapter.operatorAttestationId, createdAt: adapter.createdAt });
  if (JSON.stringify(adapter) !== JSON.stringify(rebuilt)) throw new Error('Storage Adapter contract drift detected');
  ensureSha256(adapter.adapterContractHash, 'adapterContractHash');
  assertAuthorityBoundary(adapter, 'adapter');
  return { valid: true };
}

function adapterRegistryPayload(registry) { return withoutFields(registry, ['registryHash']); }
export function buildStorageAdapterRegistry({ c19Policy, adapters = [], revision = 0, recordedAt }) {
  validateReplicaMaintenancePolicy(c19Policy);
  if (!Array.isArray(adapters) || !Number.isInteger(revision) || revision < 0 || revision !== adapters.length) throw new Error('Storage Adapter Registry revision must equal adapter count');
  const ids = new Set();
  for (const adapter of adapters) {
    validateStorageAdapterContract(adapter, { c19Policy });
    if (ids.has(adapter.adapterId)) throw new Error('Storage Adapter Registry adapterIds must be unique');
    ids.add(adapter.adapterId);
  }
  const registry = {
    schema: CINESWARM_STORAGE_ADAPTER_REGISTRY_SCHEMA,
    registryId: `${c19Policy.sequenceId}-storage-adapter-registry`,
    policyId: c19Policy.policyId,
    episodeId: c19Policy.episodeId,
    sequenceId: c19Policy.sequenceId,
    networkId: c19Policy.networkId,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    adapters: structuredClone(adapters).sort((a, b) => a.adapterId.localeCompare(b.adapterId)),
    adapterCount: adapters.length,
    configuredAdapterCount: adapters.filter((item) => item.implementationStatus === 'OPERATOR_CONFIGURED').length,
    contractOnlyAdapterCount: adapters.filter((item) => item.implementationStatus === 'CONTRACT_ONLY').length,
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  registry.registryHash = digestJson(adapterRegistryPayload(registry));
  return registry;
}

export function validateStorageAdapterRegistry(registry, { c19Policy }) {
  if (!registry || registry.schema !== CINESWARM_STORAGE_ADAPTER_REGISTRY_SCHEMA) throw new Error('invalid C1.19 Storage Adapter Registry schema');
  const rebuilt = buildStorageAdapterRegistry({ c19Policy, adapters: registry.adapters, revision: registry.revision, recordedAt: registry.recordedAt });
  if (JSON.stringify(registry) !== JSON.stringify(rebuilt)) throw new Error('Storage Adapter Registry drift detected');
  ensureSha256(registry.registryHash, 'registryHash');
  return { valid: true, revision: registry.revision };
}

function validateC18MaintenanceAnchor({ c19Policy, c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests }) {
  validateReplicaMaintenancePolicy(c19Policy);
  validateArchiveRecoveryPolicy(c18Policy);
  if (c19Policy.c18PolicyId !== c18Policy.policyId) throw new Error('C1.19 policy is not bound to supplied C1.18 policy');
  for (const key of ['episodeId', 'sequenceId', 'networkId']) if (c19Policy[key] !== c18Policy[key]) throw new Error(`C1.19 policy ${key} scope drift detected`);
  if (!bundleValidationContext || typeof bundleValidationContext !== 'object') throw new Error('C1.19 requires C1.18 Recovery Bundle provenance validation context');
  validateArchiveRecoveryBundleManifest(recoveryBundle, bundleValidationContext);
  for (const manifest of replicaManifests) validateArchiveReplicaManifest(manifest, { c18Policy, recoveryBundle });
  validateArchiveReplicaSet(replicaSet, { c18Policy, recoveryBundle, replicaManifests });
  return { valid: true };
}

function placementPayload(plan) { return withoutFields(plan, ['placementPlanHash']); }
export function buildReplicaPlacementPlan({ c19Policy, c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, adapterRegistry, placements, createdAt, planId = null }) {
  validateC18MaintenanceAnchor({ c19Policy, c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests });
  validateStorageAdapterRegistry(adapterRegistry, { c19Policy });
  if (!Array.isArray(placements) || placements.length < c19Policy.minimumManagedReplicaCount) throw new Error(`Replica Placement Plan requires at least ${c19Policy.minimumManagedReplicaCount} placements`);
  const replicaById = new Map(replicaManifests.map((item) => [item.replicaId, item]));
  const adapterById = new Map(adapterRegistry.adapters.map((item) => [item.adapterId, item]));
  const replicaIds = new Set(); const adapterIds = new Set(); const domains = new Set(); let coldOrOffline = 0;
  const normalized = placements.map((placement) => {
    const replicaId = safeToken(placement.replicaId, 'placement.replicaId');
    const adapterId = safeToken(placement.adapterId, 'placement.adapterId');
    const replica = replicaById.get(replicaId); const adapter = adapterById.get(adapterId);
    if (!replica) throw new Error(`placement references unknown replica ${replicaId}`);
    if (!adapter) throw new Error(`placement references unknown adapter ${adapterId}`);
    if (replicaIds.has(replicaId)) throw new Error('Replica Placement Plan cannot place a replica twice');
    if (adapterIds.has(adapterId)) throw new Error('Replica Placement Plan cannot reuse one adapter for multiple managed replicas');
    if (replica.locationId !== adapter.locationId || replica.failureDomain !== adapter.failureDomain) throw new Error(`placement ${replicaId} adapter location/failure-domain drift detected`);
    replicaIds.add(replicaId); adapterIds.add(adapterId); domains.add(adapter.failureDomain);
    if (adapter.adapterKind === 'cold-storage' || adapter.retrievalMode === 'offline-manual') coldOrOffline += 1;
    return { replicaId, replicaManifestHash: replica.replicaManifestHash, adapterId, adapterContractHash: adapter.adapterContractHash, locationId: adapter.locationId, failureDomain: adapter.failureDomain, adapterKind: adapter.adapterKind, retrievalMode: adapter.retrievalMode };
  }).sort((a, b) => a.replicaId.localeCompare(b.replicaId));
  if (c19Policy.requireDistinctFailureDomains && domains.size < c19Policy.minimumDistinctFailureDomains) throw new Error('Replica Placement Plan does not meet distinct failure-domain requirement');
  if (c19Policy.requireAtLeastOneColdOrOfflineReplica && coldOrOffline < 1) throw new Error('Replica Placement Plan requires at least one cold-storage or offline replica');
  const time = parseTime(createdAt, 'createdAt');
  if (time.time < parseTime(replicaSet.createdAt, 'replicaSet.createdAt').time) throw new Error('Replica Placement Plan cannot predate Replica Set');
  const plan = {
    schema: CINESWARM_REPLICA_PLACEMENT_SCHEMA,
    planId: safeToken(planId ?? `${recoveryBundle.bundleId}-placement-plan`, 'planId'),
    policyId: c19Policy.policyId,
    c18PolicyId: c18Policy.policyId,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    replicaSetHash: replicaSet.replicaSetHash,
    adapterRegistryHash: adapterRegistry.registryHash,
    placements: normalized,
    placementCount: normalized.length,
    distinctFailureDomainCount: domains.size,
    coldOrOfflineReplicaCount: coldOrOffline,
    physicalIndependenceRemainsOperatorAttested: true,
    createdAt: time.text,
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  plan.placementPlanHash = digestJson(placementPayload(plan));
  return plan;
}

export function validateReplicaPlacementPlan(plan, context) {
  if (!plan || plan.schema !== CINESWARM_REPLICA_PLACEMENT_SCHEMA) throw new Error('invalid C1.19 Replica Placement Plan schema');
  const rebuilt = buildReplicaPlacementPlan({ ...context, placements: plan.placements.map(({ replicaId, adapterId }) => ({ replicaId, adapterId })), createdAt: plan.createdAt, planId: plan.planId });
  if (JSON.stringify(plan) !== JSON.stringify(rebuilt)) throw new Error('Replica Placement Plan drift detected');
  ensureSha256(plan.placementPlanHash, 'placementPlanHash');
  return { valid: true, placementCount: plan.placementCount };
}

function syncPayload(receipt) { return withoutFields(receipt, ['syncReceiptHash']); }
export function buildReplicaSyncReceipt({ c19Policy, recoveryBundle, placementPlan, placementContext, sourceReplicaManifest, sourceVerificationReport, targetReplicaManifest, targetVerificationReport, syncMode, changedKinds = [], operatorId, startedAt, completedAt, receiptId = null }) {
  validateReplicaPlacementPlan(placementPlan, placementContext);
  if (!C1_19_SYNC_MODES.includes(syncMode)) throw new Error('unsupported C1.19 syncMode');
  const { c18Policy } = placementContext;
  validateArchiveReplicaManifest(sourceReplicaManifest, { c18Policy, recoveryBundle });
  validateArchiveReplicaManifest(targetReplicaManifest, { c18Policy, recoveryBundle });
  validateReplicaVerificationReport(sourceVerificationReport, { c18Policy, recoveryBundle, replicaManifest: sourceReplicaManifest });
  validateReplicaVerificationReport(targetVerificationReport, { c18Policy, recoveryBundle, replicaManifest: targetReplicaManifest });
  if (sourceVerificationReport.health !== 'HEALTHY') throw new Error('Replica Sync requires a HEALTHY source replica');
  if (targetVerificationReport.health !== 'HEALTHY') throw new Error('Replica Sync requires a HEALTHY destination after write');
  if (sourceReplicaManifest.replicaId === targetReplicaManifest.replicaId) throw new Error('Replica Sync source and target must differ');
  const placementIds = new Set(placementPlan.placements.map((item) => item.replicaId));
  if (!placementIds.has(sourceReplicaManifest.replicaId) || !placementIds.has(targetReplicaManifest.replicaId)) throw new Error('Replica Sync source and target must both be governed placements');
  const uniqueChanged = [...new Set(changedKinds.map((item) => requiredString(item, 'changedKind')))].sort();
  const bundleKinds = new Set(recoveryBundle.objects.map((item) => item.kind));
  for (const kind of uniqueChanged) if (!bundleKinds.has(kind)) throw new Error(`Replica Sync changedKinds contains unknown bundle kind ${kind}`);
  if (syncMode === 'VERIFY_SYNC' && uniqueChanged.length !== 0) throw new Error('VERIFY_SYNC cannot claim changed objects');
  if (syncMode === 'REPAIR_SYNC' && uniqueChanged.length < 1) throw new Error('REPAIR_SYNC must identify repaired object kinds');
  const start = parseTime(startedAt, 'startedAt'); const done = parseTime(completedAt, 'completedAt');
  if (done.time < start.time) throw new Error('Replica Sync completion cannot predate start');
  if (start.time < parseTime(sourceVerificationReport.verifiedAt, 'sourceVerificationReport.verifiedAt').time) throw new Error('Replica Sync cannot start before source health verification');
  const targetVerifiedTime = parseTime(targetVerificationReport.verifiedAt, 'targetVerificationReport.verifiedAt').time;
  if (targetVerifiedTime < start.time) throw new Error('Replica Sync target post-write verification cannot predate sync start');
  if (done.time < targetVerifiedTime) throw new Error('Replica Sync receipt cannot predate target post-write verification');
  const receipt = {
    schema: CINESWARM_SYNC_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${targetReplicaManifest.replicaId}-${syncMode.toLowerCase()}-${done.text.slice(0, 10).replaceAll('-', '')}`, 'receiptId'),
    policyId: c19Policy.policyId,
    placementPlanHash: placementPlan.placementPlanHash,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    syncMode,
    sourceReplicaId: sourceReplicaManifest.replicaId,
    sourceReplicaManifestHash: sourceReplicaManifest.replicaManifestHash,
    sourceVerificationHash: sourceVerificationReport.replicaVerificationHash,
    targetReplicaId: targetReplicaManifest.replicaId,
    targetReplicaManifestHash: targetReplicaManifest.replicaManifestHash,
    targetVerificationHash: targetVerificationReport.replicaVerificationHash,
    changedKinds: uniqueChanged,
    changedObjectCount: uniqueChanged.length,
    exactInventoryVerified: true,
    targetHealthyAfterWrite: true,
    operatorId: safeToken(operatorId, 'operatorId'),
    startedAt: start.text,
    completedAt: done.text,
    nextSyncDueAt: plusDays(done.text, c19Policy.maxSyncAgeDays),
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.syncReceiptHash = digestJson(syncPayload(receipt));
  return receipt;
}

export function validateReplicaSyncReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_SYNC_RECEIPT_SCHEMA) throw new Error('invalid C1.19 Replica Sync Receipt schema');
  const rebuilt = buildReplicaSyncReceipt({ ...context, syncMode: receipt.syncMode, changedKinds: receipt.changedKinds, operatorId: receipt.operatorId, startedAt: receipt.startedAt, completedAt: receipt.completedAt, receiptId: receipt.receiptId });
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) throw new Error('Replica Sync Receipt drift detected');
  ensureSha256(receipt.syncReceiptHash, 'syncReceiptHash');
  return { valid: true, syncMode: receipt.syncMode };
}

function repairPayload(receipt) { return withoutFields(receipt, ['repairReceiptHash']); }
export function buildReplicaRepairReceipt({ c19Policy, recoveryBundle, placementPlan, placementContext, sourceReplicaManifest, sourceVerificationReport, targetReplicaManifest, preRepairVerificationReport, postRepairVerificationReport, repairedKinds, operatorId, startedAt, completedAt, receiptId = null }) {
  validateReplicaPlacementPlan(placementPlan, placementContext);
  const { c18Policy } = placementContext;
  validateReplicaVerificationReport(sourceVerificationReport, { c18Policy, recoveryBundle, replicaManifest: sourceReplicaManifest });
  validateReplicaVerificationReport(preRepairVerificationReport, { c18Policy, recoveryBundle, replicaManifest: targetReplicaManifest });
  validateReplicaVerificationReport(postRepairVerificationReport, { c18Policy, recoveryBundle, replicaManifest: targetReplicaManifest });
  const placementIds = new Set(placementPlan.placements.map((item) => item.replicaId));
  if (!placementIds.has(sourceReplicaManifest.replicaId) || !placementIds.has(targetReplicaManifest.replicaId)) throw new Error('Replica Repair source and target must both be governed placements');
  if (sourceReplicaManifest.replicaId === targetReplicaManifest.replicaId) throw new Error('Replica Repair source and target must differ');
  if (sourceVerificationReport.health !== 'HEALTHY') throw new Error('Replica Repair requires a HEALTHY source');
  if (!['FAIL', 'DEGRADED'].includes(preRepairVerificationReport.health)) throw new Error('Replica Repair requires a damaged or incomplete pre-repair target');
  if (postRepairVerificationReport.health !== 'HEALTHY') throw new Error('Replica Repair requires a HEALTHY post-repair target');
  const kinds = [...new Set(repairedKinds.map((item) => requiredString(item, 'repairedKind')))].sort();
  if (!kinds.length) throw new Error('Replica Repair must identify at least one repaired object');
  const badKinds = new Set(preRepairVerificationReport.observations.filter((item) => item.status !== 'MATCH').map((item) => item.kind));
  for (const kind of kinds) if (!badKinds.has(kind)) throw new Error(`Replica Repair cannot claim unchanged healthy kind ${kind}`);
  const start = parseTime(startedAt, 'startedAt'); const done = parseTime(completedAt, 'completedAt');
  if (done.time < start.time) throw new Error('Replica Repair completion cannot predate start');
  if (start.time < parseTime(preRepairVerificationReport.verifiedAt, 'preRepairVerificationReport.verifiedAt').time) throw new Error('Replica Repair cannot start before damage verification');
  const postRepairVerifiedTime = parseTime(postRepairVerificationReport.verifiedAt, 'postRepairVerificationReport.verifiedAt').time;
  if (postRepairVerifiedTime < start.time) throw new Error('Replica Repair post-repair verification cannot predate repair start');
  if (done.time < postRepairVerifiedTime) throw new Error('Replica Repair receipt cannot predate post-repair verification');
  if ((done.time - start.time) > c19Policy.maxOpenRepairAgeHours * 60 * 60 * 1000) throw new Error('Replica Repair exceeds internal maxOpenRepairAgeHours policy');
  const receipt = {
    schema: CINESWARM_REPAIR_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${targetReplicaManifest.replicaId}-repair-${done.text.slice(0, 10).replaceAll('-', '')}`, 'receiptId'),
    policyId: c19Policy.policyId,
    placementPlanHash: placementPlan.placementPlanHash,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    sourceReplicaId: sourceReplicaManifest.replicaId,
    sourceVerificationHash: sourceVerificationReport.replicaVerificationHash,
    targetReplicaId: targetReplicaManifest.replicaId,
    preRepairVerificationHash: preRepairVerificationReport.replicaVerificationHash,
    postRepairVerificationHash: postRepairVerificationReport.replicaVerificationHash,
    repairedKinds: kinds,
    repairedObjectCount: kinds.length,
    operatorId: safeToken(operatorId, 'operatorId'),
    startedAt: start.text,
    completedAt: done.text,
    targetHealthyAfterRepair: true,
    nextSyncDueAt: plusDays(done.text, c19Policy.maxSyncAgeDays),
    sourceHistoricalIdentityPreserved: true,
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.repairReceiptHash = digestJson(repairPayload(receipt));
  return receipt;
}

export function validateReplicaRepairReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_REPAIR_RECEIPT_SCHEMA) throw new Error('invalid C1.19 Replica Repair Receipt schema');
  const rebuilt = buildReplicaRepairReceipt({ ...context, repairedKinds: receipt.repairedKinds, operatorId: receipt.operatorId, startedAt: receipt.startedAt, completedAt: receipt.completedAt, receiptId: receipt.receiptId });
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) throw new Error('Replica Repair Receipt drift detected');
  ensureSha256(receipt.repairReceiptHash, 'repairReceiptHash');
  return { valid: true };
}

function migrationPayload(receipt) { return withoutFields(receipt, ['migrationReceiptHash']); }
export function buildReplicaMigrationReceipt({ c19Policy, recoveryBundle, placementPlan, placementContext, sourceReplicaManifest, sourceVerificationReport, destinationReplicaManifest, destinationVerificationReport, sourceAdapter, destinationAdapter, operatorId, startedAt, completedAt, sourceRetirementAuthorized = false, receiptId = null }) {
  validateReplicaPlacementPlan(placementPlan, placementContext);
  const { c18Policy } = placementContext;
  validateReplicaVerificationReport(sourceVerificationReport, { c18Policy, recoveryBundle, replicaManifest: sourceReplicaManifest });
  validateReplicaVerificationReport(destinationVerificationReport, { c18Policy, recoveryBundle, replicaManifest: destinationReplicaManifest });
  validateStorageAdapterContract(sourceAdapter, { c19Policy }); validateStorageAdapterContract(destinationAdapter, { c19Policy });
  const sourcePlacement = placementPlan.placements.find((item) => item.replicaId === sourceReplicaManifest.replicaId);
  const destinationPlacement = placementPlan.placements.find((item) => item.replicaId === destinationReplicaManifest.replicaId);
  if (!sourcePlacement || !destinationPlacement) throw new Error('Replica Migration source and destination must both be governed placements');
  if (sourcePlacement.adapterId !== sourceAdapter.adapterId || sourcePlacement.adapterContractHash !== sourceAdapter.adapterContractHash) throw new Error('Replica Migration source adapter does not match governed placement');
  if (destinationPlacement.adapterId !== destinationAdapter.adapterId || destinationPlacement.adapterContractHash !== destinationAdapter.adapterContractHash) throw new Error('Replica Migration destination adapter does not match governed placement');
  if (sourceVerificationReport.health !== 'HEALTHY' || destinationVerificationReport.health !== 'HEALTHY') throw new Error('Replica Migration requires HEALTHY source and destination');
  if (sourceAdapter.adapterId === destinationAdapter.adapterId) throw new Error('Replica Migration requires different storage adapters');
  if (sourceAdapter.failureDomain === destinationAdapter.failureDomain) throw new Error('Replica Migration destination must move to a different failure domain');
  const start = parseTime(startedAt, 'startedAt'); const done = parseTime(completedAt, 'completedAt');
  const sourceVerifiedTime = parseTime(sourceVerificationReport.verifiedAt, 'sourceVerificationReport.verifiedAt').time;
  const destinationVerifiedTime = parseTime(destinationVerificationReport.verifiedAt, 'destinationVerificationReport.verifiedAt').time;
  if (start.time < sourceVerifiedTime) throw new Error('Replica Migration cannot start before source health verification');
  if (destinationVerifiedTime < start.time) throw new Error('Replica Migration destination verification cannot predate migration start');
  if (done.time < destinationVerifiedTime) throw new Error('Replica Migration receipt cannot predate destination verification');
  if (done.time < start.time) throw new Error('Replica Migration completion cannot predate start');
  if (sourceRetirementAuthorized !== false && sourceRetirementAuthorized !== true) throw new Error('sourceRetirementAuthorized must be boolean');
  const receipt = {
    schema: CINESWARM_MIGRATION_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${sourceReplicaManifest.replicaId}-to-${destinationReplicaManifest.replicaId}-migration`, 'receiptId'),
    policyId: c19Policy.policyId,
    placementPlanHash: placementPlan.placementPlanHash,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    archiveRecordHash: recoveryBundle.archiveRecordHash,
    historicalOutputSha256: recoveryBundle.outputSha256,
    sourceReplicaId: sourceReplicaManifest.replicaId,
    sourceAdapterId: sourceAdapter.adapterId,
    sourceVerificationHash: sourceVerificationReport.replicaVerificationHash,
    destinationReplicaId: destinationReplicaManifest.replicaId,
    destinationAdapterId: destinationAdapter.adapterId,
    destinationVerificationHash: destinationVerificationReport.replicaVerificationHash,
    operatorId: safeToken(operatorId, 'operatorId'),
    startedAt: start.text,
    completedAt: done.text,
    historicalIdentityPreserved: true,
    destinationHealthyBeforeSourceRetirement: true,
    sourceRetirementAuthorized,
    sourceAutoDeleted: false,
    nextSyncDueAt: plusDays(done.text, c19Policy.maxSyncAgeDays),
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.migrationReceiptHash = digestJson(migrationPayload(receipt));
  return receipt;
}

export function validateReplicaMigrationReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_MIGRATION_RECEIPT_SCHEMA) throw new Error('invalid C1.19 Replica Migration Receipt schema');
  const rebuilt = buildReplicaMigrationReceipt({ ...context, operatorId: receipt.operatorId, startedAt: receipt.startedAt, completedAt: receipt.completedAt, sourceRetirementAuthorized: receipt.sourceRetirementAuthorized, receiptId: receipt.receiptId });
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) throw new Error('Replica Migration Receipt drift detected');
  ensureSha256(receipt.migrationReceiptHash, 'migrationReceiptHash');
  return { valid: true };
}

function maintenanceEntryPayload(entry) { return withoutFields(entry, ['entryHash']); }
function maintenanceRegisterPayload(register) { return withoutFields(register, ['registerHash']); }
export function buildReplicaMaintenanceRegister({ c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry, entries = [], revision = 0, recordedAt }) {
  validateReplicaMaintenancePolicy(c19Policy); validateArchiveRecoveryPolicy(c18Policy);
  if (c19Policy.c18PolicyId !== c18Policy.policyId) throw new Error('Maintenance Register policy binding mismatch');
  if (!c18RecoveryRegister || c18RecoveryRegister.schema !== CINESWARM_ARCHIVE_RECOVERY_REGISTER_SCHEMA) throw new Error('Maintenance Register requires C1.18 Recovery Register');
  validateArchiveRecoveryRegister(c18RecoveryRegister, c18RecoveryRegisterContext);
  validateStorageAdapterRegistry(adapterRegistry, { c19Policy });
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Replica Maintenance Register revision must equal entry count');
  let previous = null; const receipts = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!C1_19_REGISTER_EVENTS.includes(entry.eventType)) throw new Error('unsupported Replica Maintenance Register eventType');
    if (entry.previousEntryHash !== previous) throw new Error(`Replica Maintenance Register hash chain broken at entry ${index}`);
    ensureSha256(entry.entryHash, `entries[${index}].entryHash`);
    if (entry.entryHash !== digestJson(maintenanceEntryPayload(entry))) throw new Error(`Replica Maintenance Register entry ${index} self-hash mismatch`);
    ensureSha256(entry.receiptHash, 'receiptHash');
    if (receipts.has(entry.receiptHash)) throw new Error('Replica Maintenance receipt is already registered');
    receipts.add(entry.receiptHash);
    if (entry.maintenanceCanAuthorizeRelease !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Replica Maintenance Register entry violates authority boundary');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_REPLICA_MAINTENANCE_REGISTER_SCHEMA,
    registerId: `${c19Policy.sequenceId}-replica-maintenance-register`,
    policyId: c19Policy.policyId,
    c18PolicyId: c18Policy.policyId,
    episodeId: c19Policy.episodeId,
    sequenceId: c19Policy.sequenceId,
    networkId: c19Policy.networkId,
    sourceC18RecoveryRegisterHash: c18RecoveryRegister.registerHash,
    adapterRegistryHash: adapterRegistry.registryHash,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    entries: structuredClone(entries),
    entryCount: entries.length,
    headHash: previous,
    syncVerifiedCount: entries.filter((item) => item.eventType === 'SYNC_VERIFIED').length,
    repairCount: entries.filter((item) => item.eventType === 'REPAIR_COMPLETED').length,
    migrationCount: entries.filter((item) => item.eventType === 'MIGRATION_COMPLETED').length,
    status: entries.length ? 'MAINTENANCE_HISTORY_PRESENT' : 'EMPTY_NO_MANAGED_REPLICAS',
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(maintenanceRegisterPayload(register));
  return register;
}

export function validateReplicaMaintenanceRegister(register, context) {
  if (!register || register.schema !== CINESWARM_REPLICA_MAINTENANCE_REGISTER_SCHEMA) throw new Error('invalid C1.19 Replica Maintenance Register schema');
  const rebuilt = buildReplicaMaintenanceRegister({ ...context, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  if (JSON.stringify(register) !== JSON.stringify(rebuilt)) throw new Error('Replica Maintenance Register drift detected');
  ensureSha256(register.registerHash, 'registerHash');
  return { valid: true, revision: register.revision };
}

export function appendMaintenanceReceipt({ register, receipt, receiptContext, registerContext, recordedAt }) {
  validateReplicaMaintenanceRegister(register, registerContext);
  let eventType; let receiptHash; let replicaId; let completedAt; let nextSyncDueAt = null;
  if (receipt?.schema === CINESWARM_SYNC_RECEIPT_SCHEMA) {
    validateReplicaSyncReceipt(receipt, receiptContext); eventType = 'SYNC_VERIFIED'; receiptHash = receipt.syncReceiptHash; replicaId = receipt.targetReplicaId; completedAt = receipt.completedAt; nextSyncDueAt = receipt.nextSyncDueAt;
  } else if (receipt?.schema === CINESWARM_REPAIR_RECEIPT_SCHEMA) {
    validateReplicaRepairReceipt(receipt, receiptContext); eventType = 'REPAIR_COMPLETED'; receiptHash = receipt.repairReceiptHash; replicaId = receipt.targetReplicaId; completedAt = receipt.completedAt; nextSyncDueAt = receipt.nextSyncDueAt;
  } else if (receipt?.schema === CINESWARM_MIGRATION_RECEIPT_SCHEMA) {
    validateReplicaMigrationReceipt(receipt, receiptContext); eventType = 'MIGRATION_COMPLETED'; receiptHash = receipt.migrationReceiptHash; replicaId = receipt.destinationReplicaId; completedAt = receipt.completedAt; nextSyncDueAt = receipt.nextSyncDueAt;
  } else throw new Error('unsupported C1.19 maintenance receipt');
  if (register.entries.some((entry) => entry.receiptHash === receiptHash)) throw new Error('Replica Maintenance receipt is already registered');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(completedAt, 'receipt.completedAt').time) throw new Error('Maintenance register entry cannot predate receipt completion');
  const entry = {
    eventType, receiptHash, replicaId, bundleManifestHash: receipt.bundleManifestHash, completedAt, nextSyncDueAt,
    recordedAt: time.text, previousEntryHash: register.headHash,
    maintenanceCanAuthorizeRelease: false, publicRelease: false, relayDependency: false,
  };
  entry.entryHash = digestJson(maintenanceEntryPayload(entry));
  return buildReplicaMaintenanceRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}

export function classifyReplicaMaintenanceState({ c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry, maintenanceRegister, now = null }) {
  validateReplicaMaintenanceRegister(maintenanceRegister, { c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry });
  const current = now ? parseTime(now, 'now').time : null;
  const latestVerificationByReplica = new Map();
  for (const entry of maintenanceRegister.entries) if (entry.nextSyncDueAt) latestVerificationByReplica.set(entry.replicaId, entry);
  let overdueSyncCount = 0;
  if (current !== null) for (const entry of latestVerificationByReplica.values()) if (current > parseTime(entry.nextSyncDueAt, 'nextSyncDueAt').time) overdueSyncCount += 1;
  return {
    status: maintenanceRegister.status,
    adapterCount: adapterRegistry.adapterCount,
    configuredAdapterCount: adapterRegistry.configuredAdapterCount,
    managedReplicaEventCount: maintenanceRegister.entryCount,
    syncVerifiedCount: maintenanceRegister.syncVerifiedCount,
    repairCount: maintenanceRegister.repairCount,
    migrationCount: maintenanceRegister.migrationCount,
    overdueSyncCount,
    maintenanceCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}
