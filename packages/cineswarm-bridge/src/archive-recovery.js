import { digestJson } from './authorization-seal.js';
import {
  CINESWARM_ARCHIVE_RECORD_SCHEMA,
  CINESWARM_INTEGRITY_REVALIDATION_SCHEMA,
  validateIntegrityRevalidationReport,
  validatePublicArchivePolicy,
  validatePublicArchiveRecord,
  validatePublicArchiveRegister,
} from './public-archive-integrity.js';

export const CINESWARM_ARCHIVE_RECOVERY_POLICY_SCHEMA = 'parallax.cineswarm.archive-recovery-policy.c1.18.v0.1';
export const CINESWARM_RECOVERY_BUNDLE_SCHEMA = 'parallax.cineswarm.archive-recovery-bundle.c1.18.v0.1';
export const CINESWARM_REPLICA_MANIFEST_SCHEMA = 'parallax.cineswarm.archive-replica-manifest.c1.18.v0.1';
export const CINESWARM_REPLICA_SET_SCHEMA = 'parallax.cineswarm.archive-replica-set.c1.18.v0.1';
export const CINESWARM_REPLICA_VERIFICATION_SCHEMA = 'parallax.cineswarm.archive-replica-verification.c1.18.v0.1';
export const CINESWARM_RESTORE_DRILL_SCHEMA = 'parallax.cineswarm.archive-restore-drill.c1.18.v0.1';
export const CINESWARM_DISASTER_RECOVERY_RECEIPT_SCHEMA = 'parallax.cineswarm.disaster-recovery-receipt.c1.18.v0.1';
export const CINESWARM_ARCHIVE_RECOVERY_REGISTER_SCHEMA = 'parallax.cineswarm.archive-recovery-register.c1.18.v0.1';

export const C1_18_REPLICA_HEALTH = ['HEALTHY', 'DEGRADED', 'FAIL'];
export const C1_18_RESTORE_STATES = ['PASS', 'FAIL'];
export const C1_18_REQUIRED_BUNDLE_KINDS = [
  'public-release-receipt-json',
  'release-evidence-root-record',
  'published-master-media',
  'c1-15-public-release-register-json',
  'c1-16-release-lifecycle-register-json',
  'c1-17-public-archive-record-json',
  'c1-17-integrity-revalidation-json',
  'c1-17-public-archive-register-json',
];

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
function safeRelativePath(value, label) {
  const path = requiredString(value, label);
  if (path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('?') || path.includes('#')) throw new Error(`${label} must be a safe relative path without traversal`);
  if (!/^[A-Za-z0-9_./-]+$/.test(path)) throw new Error(`${label} contains unsupported path characters`);
  return path;
}
function plusDays(iso, days) {
  const date = new Date(parseTime(iso, 'timestamp').time);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
function sortedObjects(objects) {
  return [...objects].sort((a, b) => a.kind.localeCompare(b.kind));
}

export function validateArchiveRecoveryPolicy(policy) {
  if (!policy || policy.schema !== CINESWARM_ARCHIVE_RECOVERY_POLICY_SCHEMA) throw new Error('invalid C1.18 Archive Recovery policy schema');
  for (const [value, label] of [[policy.policyId, 'policyId'], [policy.c17PolicyId, 'c17PolicyId'], [policy.episodeId, 'episodeId'], [policy.sequenceId, 'sequenceId'], [policy.networkId, 'networkId']]) safeToken(value, label);
  if (!Number.isInteger(policy.minimumReplicaCount) || policy.minimumReplicaCount < 2 || policy.minimumReplicaCount > 10) throw new Error('minimumReplicaCount must be 2-10');
  if (!Number.isInteger(policy.minimumDistinctFailureDomains) || policy.minimumDistinctFailureDomains < 2 || policy.minimumDistinctFailureDomains > policy.minimumReplicaCount) throw new Error('minimumDistinctFailureDomains must be 2..minimumReplicaCount');
  if (!Number.isInteger(policy.maxRestoreDrillAgeDays) || policy.maxRestoreDrillAgeDays < 1 || policy.maxRestoreDrillAgeDays > 365) throw new Error('maxRestoreDrillAgeDays must be an internal 1-365 day policy');
  if (JSON.stringify(policy.requiredBundleKinds) !== JSON.stringify(C1_18_REQUIRED_BUNDLE_KINDS)) throw new Error('requiredBundleKinds must match the frozen C1.18 recovery bundle contract');
  for (const key of [
    'requireC17IntegrityPass',
    'requireExactBundleInventoryParity',
    'requireDistinctReplicaLocations',
    'requireDistinctFailureDomains',
    'requireVerbatimPublishedMasterForFullRecovery',
    'requireHealthySourceReplicaForRestore',
    'requireByteForByteRestoreVerification',
    'appendOnlyRecoveryRegister',
    'restoreDrillNeverMutatesArchiveHistory',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of ['autoRepublish', 'recoveryCanAuthorizeRelease', 'historyDeletionAllowed', 'relayDependency']) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function validateC17Anchor({ c18Policy, c17Policy, c17ArchiveRegister, archiveRecord, archiveRecordContext, integrityReport, c17RegisterContext }) {
  validateArchiveRecoveryPolicy(c18Policy);
  validatePublicArchivePolicy(c17Policy);
  if (c18Policy.c17PolicyId !== c17Policy.policyId) throw new Error('C1.18 policy is not bound to supplied C1.17 policy');
  for (const key of ['episodeId', 'sequenceId', 'networkId']) if (c18Policy[key] !== c17Policy[key]) throw new Error(`C1.18 policy ${key} scope drift detected`);
  validatePublicArchiveRegister(c17ArchiveRegister, c17RegisterContext);
  if (!archiveRecord || archiveRecord.schema !== CINESWARM_ARCHIVE_RECORD_SCHEMA) throw new Error('C1.18 requires a C1.17 Public Archive Record');
  if (!archiveRecordContext || typeof archiveRecordContext !== 'object') throw new Error('C1.18 requires original C1.17 Archive Record validation context');
  validatePublicArchiveRecord(archiveRecord, archiveRecordContext);
  ensureSha256(archiveRecord.archiveRecordHash, 'archiveRecord.archiveRecordHash');
  const archived = c17ArchiveRegister.entries.some((entry) => entry.eventType === 'ARCHIVED_PUBLIC_RELEASE' && entry.archiveRecordHash === archiveRecord.archiveRecordHash && entry.publicReleaseReceiptHash === archiveRecord.publicReleaseReceiptHash);
  if (!archived) throw new Error('C1.18 archive record is not registered in supplied C1.17 Archive Register');
  if (!integrityReport || integrityReport.schema !== CINESWARM_INTEGRITY_REVALIDATION_SCHEMA) throw new Error('C1.18 requires a C1.17 Integrity Revalidation Report');
  validateIntegrityRevalidationReport(integrityReport, { c17Policy, archiveRecord });
  const revalidated = c17ArchiveRegister.entries.some((entry) => entry.eventType === 'INTEGRITY_REVALIDATED' && entry.archiveRecordHash === archiveRecord.archiveRecordHash && entry.revalidationReportHash === integrityReport.revalidationReportHash);
  if (!revalidated) throw new Error('C1.18 integrity report is not registered in supplied C1.17 Archive Register');
  if (c18Policy.requireC17IntegrityPass && integrityReport.status !== 'PASS') throw new Error('C1.18 requires a C1.17 integrity PASS before replication');
  return { valid: true };
}

function expectedSemanticHash(kind, { archiveRecord, integrityReport, c17ArchiveRegister }) {
  const map = {
    'public-release-receipt-json': archiveRecord.publicReleaseReceiptHash,
    'release-evidence-root-record': archiveRecord.releaseReceiptEvidenceRootHash,
    'published-master-media': archiveRecord.outputSha256,
    'c1-15-public-release-register-json': archiveRecord.sourceC15RegisterHash,
    'c1-16-release-lifecycle-register-json': archiveRecord.sourceC16LifecycleRegisterHash,
    'c1-17-public-archive-record-json': archiveRecord.archiveRecordHash,
    'c1-17-integrity-revalidation-json': integrityReport.revalidationReportHash,
    'c1-17-public-archive-register-json': c17ArchiveRegister.registerHash,
  };
  return map[kind];
}

function bundlePayload(bundle) { return withoutFields(bundle, ['bundleManifestHash']); }
export function buildArchiveRecoveryBundleManifest({
  c18Policy,
  c17Policy,
  c17ArchiveRegister,
  archiveRecord,
  archiveRecordContext,
  integrityReport,
  c17RegisterContext,
  objects,
  createdAt,
  bundleId = null,
}) {
  validateC17Anchor({ c18Policy, c17Policy, c17ArchiveRegister, archiveRecord, archiveRecordContext, integrityReport, c17RegisterContext });
  if (!Array.isArray(objects) || objects.length !== C1_18_REQUIRED_BUNDLE_KINDS.length) throw new Error(`Recovery Bundle requires exactly ${C1_18_REQUIRED_BUNDLE_KINDS.length} governed objects`);
  const normalized = C1_18_REQUIRED_BUNDLE_KINDS.map((kind) => {
    const matches = objects.filter((item) => item?.kind === kind);
    if (matches.length !== 1) throw new Error(`Recovery Bundle requires exactly one ${kind}`);
    const item = matches[0];
    const semanticSha256 = ensureSha256(item.semanticSha256, `${kind}.semanticSha256`);
    const expected = expectedSemanticHash(kind, { archiveRecord, integrityReport, c17ArchiveRegister });
    if (semanticSha256 !== expected) throw new Error(`Recovery Bundle ${kind} semantic hash drift detected`);
    const blobSha256 = ensureSha256(item.blobSha256, `${kind}.blobSha256`);
    if (!Number.isInteger(item.sizeBytes) || item.sizeBytes < 1) throw new Error(`${kind}.sizeBytes must be a positive integer`);
    const storageEncoding = requiredString(item.storageEncoding, `${kind}.storageEncoding`);
    if (!['verbatim', 'canonical-json', 'hash-record'].includes(storageEncoding)) throw new Error(`${kind}.storageEncoding is unsupported`);
    if (kind === 'published-master-media' && c18Policy.requireVerbatimPublishedMasterForFullRecovery) {
      if (storageEncoding !== 'verbatim') throw new Error('published-master-media must use verbatim storage');
      if (blobSha256 !== semanticSha256) throw new Error('published-master-media blob hash must equal the historical Master SHA-256');
    }
    return {
      kind,
      relativePath: safeRelativePath(item.relativePath, `${kind}.relativePath`),
      semanticSha256,
      blobSha256,
      sizeBytes: item.sizeBytes,
      storageEncoding,
    };
  });
  const paths = new Set(normalized.map((item) => item.relativePath));
  if (paths.size !== normalized.length) throw new Error('Recovery Bundle relative paths must be unique');
  const created = parseTime(createdAt, 'createdAt');
  if (created.time < parseTime(integrityReport.verifiedAt, 'integrityReport.verifiedAt').time) throw new Error('Recovery Bundle cannot predate its C1.17 integrity PASS');
  const bundle = {
    schema: CINESWARM_RECOVERY_BUNDLE_SCHEMA,
    bundleId: safeToken(bundleId ?? `${archiveRecord.archiveRecordId}-recovery-bundle`, 'bundleId'),
    policyId: c18Policy.policyId,
    c17PolicyId: c17Policy.policyId,
    archiveRecordId: archiveRecord.archiveRecordId,
    archiveRecordHash: archiveRecord.archiveRecordHash,
    publicReleaseReceiptHash: archiveRecord.publicReleaseReceiptHash,
    outputSha256: archiveRecord.outputSha256,
    integrityRevalidationHash: integrityReport.revalidationReportHash,
    sourceC17ArchiveRegisterHash: c17ArchiveRegister.registerHash,
    objects: normalized,
    objectCount: normalized.length,
    totalBytes: normalized.reduce((sum, item) => sum + item.sizeBytes, 0),
    fullPublishedMasterIncluded: true,
    c17IntegrityPassBound: true,
    createdAt: created.text,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  bundle.bundleManifestHash = digestJson(bundlePayload(bundle));
  return bundle;
}

export function validateArchiveRecoveryBundleManifest(bundle, context) {
  if (!bundle || bundle.schema !== CINESWARM_RECOVERY_BUNDLE_SCHEMA) throw new Error('invalid C1.18 Recovery Bundle schema');
  const rebuilt = buildArchiveRecoveryBundleManifest({ ...context, objects: bundle.objects, createdAt: bundle.createdAt, bundleId: bundle.bundleId });
  for (const key of ['policyId','c17PolicyId','archiveRecordId','archiveRecordHash','publicReleaseReceiptHash','outputSha256','integrityRevalidationHash','sourceC17ArchiveRegisterHash','objectCount','totalBytes','fullPublishedMasterIncluded','c17IntegrityPassBound','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (bundle[key] !== rebuilt[key]) throw new Error(`Recovery Bundle ${key} drift detected`);
  if (JSON.stringify(bundle.objects) !== JSON.stringify(rebuilt.objects)) throw new Error('Recovery Bundle object inventory drift detected');
  ensureSha256(bundle.bundleManifestHash, 'bundleManifestHash');
  if (bundle.bundleManifestHash !== digestJson(bundlePayload(bundle))) throw new Error('Recovery Bundle self-hash mismatch');
  return { valid: true, objectCount: bundle.objectCount, totalBytes: bundle.totalBytes };
}

function replicaManifestPayload(manifest) { return withoutFields(manifest, ['replicaManifestHash']); }
export function buildArchiveReplicaManifest({ c18Policy, recoveryBundle, replicaId, locationId, failureDomain, storageKind, objectCopies, recordedAt }) {
  validateArchiveRecoveryPolicy(c18Policy);
  if (!recoveryBundle || recoveryBundle.schema !== CINESWARM_RECOVERY_BUNDLE_SCHEMA) throw new Error('Replica Manifest requires a C1.18 Recovery Bundle');
  ensureSha256(recoveryBundle.bundleManifestHash, 'recoveryBundle.bundleManifestHash');
  if (!Array.isArray(objectCopies) || objectCopies.length !== recoveryBundle.objects.length) throw new Error('Replica Manifest must copy the exact Recovery Bundle inventory');
  const copies = recoveryBundle.objects.map((expected) => {
    const matches = objectCopies.filter((item) => item?.kind === expected.kind);
    if (matches.length !== 1) throw new Error(`Replica Manifest requires exactly one ${expected.kind}`);
    const item = matches[0];
    if (item.relativePath !== expected.relativePath || item.blobSha256 !== expected.blobSha256 || item.sizeBytes !== expected.sizeBytes) throw new Error(`Replica ${expected.kind} inventory drift detected`);
    return { kind: expected.kind, relativePath: expected.relativePath, blobSha256: expected.blobSha256, sizeBytes: expected.sizeBytes };
  });
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(recoveryBundle.createdAt, 'recoveryBundle.createdAt').time) throw new Error('Replica Manifest cannot predate Recovery Bundle');
  const manifest = {
    schema: CINESWARM_REPLICA_MANIFEST_SCHEMA,
    replicaId: safeToken(replicaId, 'replicaId'),
    policyId: c18Policy.policyId,
    bundleId: recoveryBundle.bundleId,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    archiveRecordHash: recoveryBundle.archiveRecordHash,
    locationId: safeToken(locationId, 'locationId'),
    failureDomain: safeToken(failureDomain, 'failureDomain'),
    storageKind: safeToken(storageKind, 'storageKind'),
    objects: copies,
    objectCount: copies.length,
    totalBytes: copies.reduce((sum, item) => sum + item.sizeBytes, 0),
    recordedAt: time.text,
    locationIndependenceIsOperatorAttested: true,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  manifest.replicaManifestHash = digestJson(replicaManifestPayload(manifest));
  return manifest;
}

export function validateArchiveReplicaManifest(manifest, { c18Policy, recoveryBundle }) {
  if (!manifest || manifest.schema !== CINESWARM_REPLICA_MANIFEST_SCHEMA) throw new Error('invalid C1.18 Replica Manifest schema');
  const rebuilt = buildArchiveReplicaManifest({ c18Policy, recoveryBundle, replicaId: manifest.replicaId, locationId: manifest.locationId, failureDomain: manifest.failureDomain, storageKind: manifest.storageKind, objectCopies: manifest.objects, recordedAt: manifest.recordedAt });
  for (const key of ['policyId','bundleId','bundleManifestHash','archiveRecordHash','locationId','failureDomain','storageKind','objectCount','totalBytes','locationIndependenceIsOperatorAttested','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (manifest[key] !== rebuilt[key]) throw new Error(`Replica Manifest ${key} drift detected`);
  if (JSON.stringify(manifest.objects) !== JSON.stringify(rebuilt.objects)) throw new Error('Replica Manifest inventory drift detected');
  ensureSha256(manifest.replicaManifestHash, 'replicaManifestHash');
  if (manifest.replicaManifestHash !== digestJson(replicaManifestPayload(manifest))) throw new Error('Replica Manifest self-hash mismatch');
  return { valid: true };
}

function replicaSetPayload(set) { return withoutFields(set, ['replicaSetHash']); }
export function buildArchiveReplicaSet({ c18Policy, recoveryBundle, replicaManifests, createdAt, replicaSetId = null }) {
  validateArchiveRecoveryPolicy(c18Policy);
  if (!Array.isArray(replicaManifests) || replicaManifests.length < c18Policy.minimumReplicaCount) throw new Error(`Replica Set requires at least ${c18Policy.minimumReplicaCount} replicas`);
  for (const manifest of replicaManifests) validateArchiveReplicaManifest(manifest, { c18Policy, recoveryBundle });
  const replicaIds = new Set(replicaManifests.map((item) => item.replicaId));
  const locations = new Set(replicaManifests.map((item) => item.locationId));
  const domains = new Set(replicaManifests.map((item) => item.failureDomain));
  if (replicaIds.size !== replicaManifests.length) throw new Error('Replica Set replicaIds must be unique');
  if (c18Policy.requireDistinctReplicaLocations && locations.size !== replicaManifests.length) throw new Error('Replica Set requires distinct locationIds');
  if (c18Policy.requireDistinctFailureDomains && domains.size < c18Policy.minimumDistinctFailureDomains) throw new Error('Replica Set does not meet distinct failure-domain requirement');
  const time = parseTime(createdAt, 'createdAt');
  const latestReplicaTime = Math.max(...replicaManifests.map((item) => parseTime(item.recordedAt, 'replica.recordedAt').time));
  if (time.time < latestReplicaTime) throw new Error('Replica Set cannot predate a replica manifest');
  const replicas = [...replicaManifests].sort((a, b) => a.replicaId.localeCompare(b.replicaId)).map((item) => ({
    replicaId: item.replicaId,
    replicaManifestHash: item.replicaManifestHash,
    locationId: item.locationId,
    failureDomain: item.failureDomain,
    storageKind: item.storageKind,
  }));
  const set = {
    schema: CINESWARM_REPLICA_SET_SCHEMA,
    replicaSetId: safeToken(replicaSetId ?? `${recoveryBundle.bundleId}-replica-set`, 'replicaSetId'),
    policyId: c18Policy.policyId,
    bundleId: recoveryBundle.bundleId,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    archiveRecordHash: recoveryBundle.archiveRecordHash,
    replicas,
    replicaCount: replicas.length,
    distinctLocationCount: locations.size,
    distinctFailureDomainCount: domains.size,
    status: 'READY_FOR_RESTORE_DRILL',
    disasterRecoveryProven: false,
    createdAt: time.text,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  set.replicaSetHash = digestJson(replicaSetPayload(set));
  return set;
}

export function validateArchiveReplicaSet(set, { c18Policy, recoveryBundle, replicaManifests }) {
  if (!set || set.schema !== CINESWARM_REPLICA_SET_SCHEMA) throw new Error('invalid C1.18 Replica Set schema');
  const rebuilt = buildArchiveReplicaSet({ c18Policy, recoveryBundle, replicaManifests, createdAt: set.createdAt, replicaSetId: set.replicaSetId });
  for (const key of ['policyId','bundleId','bundleManifestHash','archiveRecordHash','replicaCount','distinctLocationCount','distinctFailureDomainCount','status','disasterRecoveryProven','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (set[key] !== rebuilt[key]) throw new Error(`Replica Set ${key} drift detected`);
  if (JSON.stringify(set.replicas) !== JSON.stringify(rebuilt.replicas)) throw new Error('Replica Set inventory drift detected');
  ensureSha256(set.replicaSetHash, 'replicaSetHash');
  if (set.replicaSetHash !== digestJson(replicaSetPayload(set))) throw new Error('Replica Set self-hash mismatch');
  return { valid: true, replicaCount: set.replicaCount };
}

function replicaVerificationPayload(report) { return withoutFields(report, ['replicaVerificationHash']); }
export function buildReplicaVerificationReport({ c18Policy, recoveryBundle, replicaManifest, observations, verifierId, verifiedAt, reportId = null }) {
  validateArchiveReplicaManifest(replicaManifest, { c18Policy, recoveryBundle });
  if (!Array.isArray(observations) || observations.length !== replicaManifest.objects.length) throw new Error('Replica Verification must observe the exact replica inventory');
  const normalized = replicaManifest.objects.map((expected) => {
    const matches = observations.filter((item) => item?.kind === expected.kind);
    if (matches.length !== 1) throw new Error(`Replica Verification requires exactly one ${expected.kind}`);
    const item = matches[0];
    if (item.expectedBlobSha256 !== expected.blobSha256 || item.expectedSizeBytes !== expected.sizeBytes) throw new Error(`Replica Verification ${expected.kind} expected value drift detected`);
    const available = item.available === true;
    const observedBlobSha256 = item.observedBlobSha256 == null ? null : ensureSha256(item.observedBlobSha256, `${expected.kind}.observedBlobSha256`);
    const observedSizeBytes = item.observedSizeBytes == null ? null : Number(item.observedSizeBytes);
    if (available && (!observedBlobSha256 || !Number.isInteger(observedSizeBytes) || observedSizeBytes < 0)) throw new Error(`${expected.kind} available observation requires hash and size`);
    if (!available && (observedBlobSha256 !== null || observedSizeBytes !== null)) throw new Error(`${expected.kind} unavailable observation cannot claim hash or size`);
    const status = !available ? 'MISSING' : (observedBlobSha256 === expected.blobSha256 && observedSizeBytes === expected.sizeBytes ? 'MATCH' : 'MISMATCH');
    return { kind: expected.kind, expectedBlobSha256: expected.blobSha256, expectedSizeBytes: expected.sizeBytes, available, observedBlobSha256, observedSizeBytes, status };
  });
  const mismatchCount = normalized.filter((item) => item.status === 'MISMATCH').length;
  const missingCount = normalized.filter((item) => item.status === 'MISSING').length;
  const health = mismatchCount > 0 ? 'FAIL' : (missingCount > 0 ? 'DEGRADED' : 'HEALTHY');
  const time = parseTime(verifiedAt, 'verifiedAt');
  if (time.time < parseTime(replicaManifest.recordedAt, 'replicaManifest.recordedAt').time) throw new Error('Replica Verification cannot predate Replica Manifest');
  const report = {
    schema: CINESWARM_REPLICA_VERIFICATION_SCHEMA,
    reportId: safeToken(reportId ?? `${replicaManifest.replicaId}-verification-${time.text.slice(0, 10).replaceAll('-', '')}`, 'reportId'),
    policyId: c18Policy.policyId,
    replicaId: replicaManifest.replicaId,
    replicaManifestHash: replicaManifest.replicaManifestHash,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    verifierId: safeToken(verifierId, 'verifierId'),
    verifiedAt: time.text,
    observations: normalized,
    observationCount: normalized.length,
    matchCount: normalized.filter((item) => item.status === 'MATCH').length,
    missingCount,
    mismatchCount,
    health,
    eligibleAsRestoreSource: health === 'HEALTHY',
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  report.replicaVerificationHash = digestJson(replicaVerificationPayload(report));
  return report;
}

export function validateReplicaVerificationReport(report, { c18Policy, recoveryBundle, replicaManifest }) {
  if (!report || report.schema !== CINESWARM_REPLICA_VERIFICATION_SCHEMA) throw new Error('invalid C1.18 Replica Verification schema');
  const rebuilt = buildReplicaVerificationReport({ c18Policy, recoveryBundle, replicaManifest, observations: report.observations.map((item) => ({ kind: item.kind, expectedBlobSha256: item.expectedBlobSha256, expectedSizeBytes: item.expectedSizeBytes, available: item.available, observedBlobSha256: item.observedBlobSha256, observedSizeBytes: item.observedSizeBytes })), verifierId: report.verifierId, verifiedAt: report.verifiedAt, reportId: report.reportId });
  for (const key of ['policyId','replicaId','replicaManifestHash','bundleManifestHash','observationCount','matchCount','missingCount','mismatchCount','health','eligibleAsRestoreSource','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (report[key] !== rebuilt[key]) throw new Error(`Replica Verification ${key} drift detected`);
  if (JSON.stringify(report.observations) !== JSON.stringify(rebuilt.observations)) throw new Error('Replica Verification observations drift detected');
  if (!C1_18_REPLICA_HEALTH.includes(report.health)) throw new Error('unsupported replica health');
  ensureSha256(report.replicaVerificationHash, 'replicaVerificationHash');
  if (report.replicaVerificationHash !== digestJson(replicaVerificationPayload(report))) throw new Error('Replica Verification self-hash mismatch');
  return { valid: true, health: report.health };
}

function restoreDrillPayload(report) { return withoutFields(report, ['restoreDrillHash']); }
export function buildRestoreDrillReport({ c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, sourceReplicaManifest, sourceVerificationReport, restoredObjects, restoreTargetId, verifierId, startedAt, completedAt, primaryArchiveAssumedUnavailable = true, drillId = null }) {
  if (!bundleValidationContext || typeof bundleValidationContext !== 'object') throw new Error('Restore Drill requires Recovery Bundle provenance validation context');
  validateArchiveRecoveryBundleManifest(recoveryBundle, bundleValidationContext);
  validateArchiveReplicaSet(replicaSet, { c18Policy, recoveryBundle, replicaManifests });
  validateArchiveReplicaManifest(sourceReplicaManifest, { c18Policy, recoveryBundle });
  validateReplicaVerificationReport(sourceVerificationReport, { c18Policy, recoveryBundle, replicaManifest: sourceReplicaManifest });
  if (!replicaSet.replicas.some((item) => item.replicaId === sourceReplicaManifest.replicaId && item.replicaManifestHash === sourceReplicaManifest.replicaManifestHash)) throw new Error('Restore source replica is not part of Replica Set');
  if (c18Policy.requireHealthySourceReplicaForRestore && sourceVerificationReport.health !== 'HEALTHY') throw new Error('Restore Drill requires a HEALTHY source replica');
  if (primaryArchiveAssumedUnavailable !== true) throw new Error('Restore Drill must exercise disaster recovery with primary archive assumed unavailable');
  if (!Array.isArray(restoredObjects) || restoredObjects.length !== recoveryBundle.objects.length) throw new Error('Restore Drill must verify the exact Recovery Bundle inventory');
  const normalized = recoveryBundle.objects.map((expected) => {
    const matches = restoredObjects.filter((item) => item?.kind === expected.kind);
    if (matches.length !== 1) throw new Error(`Restore Drill requires exactly one restored ${expected.kind}`);
    const item = matches[0];
    const observedBlobSha256 = ensureSha256(item.observedBlobSha256, `${expected.kind}.observedBlobSha256`);
    if (!Number.isInteger(item.observedSizeBytes) || item.observedSizeBytes < 0) throw new Error(`${expected.kind}.observedSizeBytes must be a non-negative integer`);
    const status = observedBlobSha256 === expected.blobSha256 && item.observedSizeBytes === expected.sizeBytes ? 'MATCH' : 'MISMATCH';
    return { kind: expected.kind, expectedBlobSha256: expected.blobSha256, expectedSizeBytes: expected.sizeBytes, observedBlobSha256, observedSizeBytes: item.observedSizeBytes, status };
  });
  const mismatchCount = normalized.filter((item) => item.status === 'MISMATCH').length;
  const status = mismatchCount === 0 ? 'PASS' : 'FAIL';
  const start = parseTime(startedAt, 'startedAt');
  const complete = parseTime(completedAt, 'completedAt');
  if (complete.time < start.time) throw new Error('Restore Drill completedAt cannot predate startedAt');
  if (start.time < parseTime(sourceVerificationReport.verifiedAt, 'sourceVerificationReport.verifiedAt').time) throw new Error('Restore Drill cannot begin before source replica verification');
  const report = {
    schema: CINESWARM_RESTORE_DRILL_SCHEMA,
    drillId: safeToken(drillId ?? `${recoveryBundle.bundleId}-restore-drill-${complete.text.slice(0, 10).replaceAll('-', '')}`, 'drillId'),
    policyId: c18Policy.policyId,
    bundleId: recoveryBundle.bundleId,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    replicaSetId: replicaSet.replicaSetId,
    replicaSetHash: replicaSet.replicaSetHash,
    sourceReplicaId: sourceReplicaManifest.replicaId,
    sourceReplicaManifestHash: sourceReplicaManifest.replicaManifestHash,
    sourceReplicaVerificationHash: sourceVerificationReport.replicaVerificationHash,
    restoreTargetId: safeToken(restoreTargetId, 'restoreTargetId'),
    verifierId: safeToken(verifierId, 'verifierId'),
    primaryArchiveAssumedUnavailable: true,
    startedAt: start.text,
    completedAt: complete.text,
    restoredObjects: normalized,
    restoredObjectCount: normalized.length,
    mismatchCount,
    status,
    byteForByteRestoreVerified: status === 'PASS',
    fullPublishedMasterRestored: status === 'PASS' && normalized.some((item) => item.kind === 'published-master-media' && item.status === 'MATCH'),
    autoRepublish: false,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  report.restoreDrillHash = digestJson(restoreDrillPayload(report));
  return report;
}

export function validateRestoreDrillReport(report, context) {
  if (!report || report.schema !== CINESWARM_RESTORE_DRILL_SCHEMA) throw new Error('invalid C1.18 Restore Drill schema');
  const rebuilt = buildRestoreDrillReport({ ...context, restoredObjects: report.restoredObjects.map((item) => ({ kind: item.kind, observedBlobSha256: item.observedBlobSha256, observedSizeBytes: item.observedSizeBytes })), restoreTargetId: report.restoreTargetId, verifierId: report.verifierId, startedAt: report.startedAt, completedAt: report.completedAt, primaryArchiveAssumedUnavailable: report.primaryArchiveAssumedUnavailable, drillId: report.drillId });
  for (const key of ['policyId','bundleId','bundleManifestHash','replicaSetId','replicaSetHash','sourceReplicaId','sourceReplicaManifestHash','sourceReplicaVerificationHash','restoreTargetId','primaryArchiveAssumedUnavailable','restoredObjectCount','mismatchCount','status','byteForByteRestoreVerified','fullPublishedMasterRestored','autoRepublish','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (report[key] !== rebuilt[key]) throw new Error(`Restore Drill ${key} drift detected`);
  if (JSON.stringify(report.restoredObjects) !== JSON.stringify(rebuilt.restoredObjects)) throw new Error('Restore Drill restored-object drift detected');
  ensureSha256(report.restoreDrillHash, 'restoreDrillHash');
  if (report.restoreDrillHash !== digestJson(restoreDrillPayload(report))) throw new Error('Restore Drill self-hash mismatch');
  return { valid: true, status: report.status };
}

function disasterReceiptPayload(receipt) { return withoutFields(receipt, ['disasterRecoveryReceiptHash']); }
export function buildDisasterRecoveryReceipt({ c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, sourceReplicaManifest, sourceVerificationReport, restoreDrillReport, issuedAt, receiptId = null }) {
  if (!bundleValidationContext || typeof bundleValidationContext !== 'object') throw new Error('Disaster Recovery Receipt requires Recovery Bundle provenance validation context');
  validateArchiveRecoveryBundleManifest(recoveryBundle, bundleValidationContext);
  validateRestoreDrillReport(restoreDrillReport, { c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, sourceReplicaManifest, sourceVerificationReport });
  if (restoreDrillReport.status !== 'PASS' || restoreDrillReport.byteForByteRestoreVerified !== true || restoreDrillReport.fullPublishedMasterRestored !== true) throw new Error('Disaster Recovery Receipt requires a full PASS restore drill');
  const time = parseTime(issuedAt, 'issuedAt');
  if (time.time < parseTime(restoreDrillReport.completedAt, 'restoreDrillReport.completedAt').time) throw new Error('Disaster Recovery Receipt cannot predate Restore Drill completion');
  const receipt = {
    schema: CINESWARM_DISASTER_RECOVERY_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${recoveryBundle.bundleId}-disaster-recovery-receipt`, 'receiptId'),
    policyId: c18Policy.policyId,
    archiveRecordHash: recoveryBundle.archiveRecordHash,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    replicaSetHash: replicaSet.replicaSetHash,
    restoreDrillHash: restoreDrillReport.restoreDrillHash,
    sourceReplicaId: restoreDrillReport.sourceReplicaId,
    restoredPublishedMasterSha256: recoveryBundle.outputSha256,
    issuedAt: time.text,
    nextRestoreDrillDueAt: plusDays(time.text, c18Policy.maxRestoreDrillAgeDays),
    disasterRecoveryProven: true,
    byteForByteRestoreVerified: true,
    fullPublishedMasterRestored: true,
    historicalArchiveMutated: false,
    autoRepublish: false,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.disasterRecoveryReceiptHash = digestJson(disasterReceiptPayload(receipt));
  return receipt;
}

export function validateDisasterRecoveryReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_DISASTER_RECOVERY_RECEIPT_SCHEMA) throw new Error('invalid C1.18 Disaster Recovery Receipt schema');
  const rebuilt = buildDisasterRecoveryReceipt({ ...context, issuedAt: receipt.issuedAt, receiptId: receipt.receiptId });
  for (const key of ['policyId','archiveRecordHash','bundleManifestHash','replicaSetHash','restoreDrillHash','sourceReplicaId','restoredPublishedMasterSha256','nextRestoreDrillDueAt','disasterRecoveryProven','byteForByteRestoreVerified','fullPublishedMasterRestored','historicalArchiveMutated','autoRepublish','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (receipt[key] !== rebuilt[key]) throw new Error(`Disaster Recovery Receipt ${key} drift detected`);
  ensureSha256(receipt.disasterRecoveryReceiptHash, 'disasterRecoveryReceiptHash');
  if (receipt.disasterRecoveryReceiptHash !== digestJson(disasterReceiptPayload(receipt))) throw new Error('Disaster Recovery Receipt self-hash mismatch');
  return { valid: true, disasterRecoveryProven: true };
}

function recoveryEntryPayload(entry) { return withoutFields(entry, ['entryHash']); }
function recoveryRegisterPayload(register) { return withoutFields(register, ['registerHash']); }
export function buildArchiveRecoveryRegister({ c18Policy, c17Policy, c17ArchiveRegister, c17RegisterContext, entries = [], revision = 0, recordedAt }) {
  validateArchiveRecoveryPolicy(c18Policy);
  validatePublicArchivePolicy(c17Policy);
  if (c18Policy.c17PolicyId !== c17Policy.policyId) throw new Error('Recovery Register policy binding mismatch');
  validatePublicArchiveRegister(c17ArchiveRegister, c17RegisterContext);
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Archive Recovery Register revision must equal entry count');
  let previous = null;
  const receipts = new Set();
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Archive Recovery Register hash chain broken at entry ${index}`);
    ensureSha256(entry.entryHash, `entries[${index}].entryHash`);
    if (entry.entryHash !== digestJson(recoveryEntryPayload(entry))) throw new Error(`Archive Recovery Register entry ${index} self-hash mismatch`);
    if (entry.eventType !== 'DISASTER_RECOVERY_PROVEN') throw new Error('unsupported Archive Recovery Register eventType');
    ensureSha256(entry.disasterRecoveryReceiptHash, 'disasterRecoveryReceiptHash');
    if (receipts.has(entry.disasterRecoveryReceiptHash)) throw new Error('Disaster Recovery Receipt is already registered');
    receipts.add(entry.disasterRecoveryReceiptHash);
    if (entry.disasterRecoveryProven !== true || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Archive Recovery Register entry violates authority boundary');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_ARCHIVE_RECOVERY_REGISTER_SCHEMA,
    registerId: `${c18Policy.sequenceId}-archive-recovery-register`,
    policyId: c18Policy.policyId,
    c17PolicyId: c17Policy.policyId,
    episodeId: c18Policy.episodeId,
    sequenceId: c18Policy.sequenceId,
    networkId: c18Policy.networkId,
    sourceC17ArchiveRegisterHash: c17ArchiveRegister.registerHash,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    entries: structuredClone(entries),
    entryCount: entries.length,
    headHash: previous,
    successfulRestoreDrillCount: entries.length,
    status: entries.length ? 'DISASTER_RECOVERY_PROVEN' : 'EMPTY_NO_RESTORE_DRILLS',
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(recoveryRegisterPayload(register));
  return register;
}

export function validateArchiveRecoveryRegister(register, context) {
  if (!register || register.schema !== CINESWARM_ARCHIVE_RECOVERY_REGISTER_SCHEMA) throw new Error('invalid C1.18 Archive Recovery Register schema');
  const rebuilt = buildArchiveRecoveryRegister({ ...context, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['policyId','c17PolicyId','episodeId','sequenceId','networkId','sourceC17ArchiveRegisterHash','revision','entryCount','headHash','successfulRestoreDrillCount','status','recoveryCanAuthorizeRelease','publicRelease','relayDependency']) if (register[key] !== rebuilt[key]) throw new Error(`Archive Recovery Register ${key} drift detected`);
  ensureSha256(register.registerHash, 'registerHash');
  if (register.registerHash !== digestJson(recoveryRegisterPayload(register))) throw new Error('Archive Recovery Register self-hash mismatch');
  return { valid: true, revision: register.revision };
}

export function appendDisasterRecoveryReceiptToRegister({ register, receipt, receiptContext, registerContext, recordedAt }) {
  validateArchiveRecoveryRegister(register, registerContext);
  validateDisasterRecoveryReceipt(receipt, receiptContext);
  if (register.entries.some((entry) => entry.disasterRecoveryReceiptHash === receipt.disasterRecoveryReceiptHash)) throw new Error('Disaster Recovery Receipt is already registered');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(receipt.issuedAt, 'receipt.issuedAt').time) throw new Error('Recovery register entry cannot predate receipt');
  const entry = {
    eventType: 'DISASTER_RECOVERY_PROVEN',
    disasterRecoveryReceiptHash: receipt.disasterRecoveryReceiptHash,
    archiveRecordHash: receipt.archiveRecordHash,
    bundleManifestHash: receipt.bundleManifestHash,
    replicaSetHash: receipt.replicaSetHash,
    restoreDrillHash: receipt.restoreDrillHash,
    restoredPublishedMasterSha256: receipt.restoredPublishedMasterSha256,
    nextRestoreDrillDueAt: receipt.nextRestoreDrillDueAt,
    disasterRecoveryProven: true,
    recordedAt: time.text,
    previousEntryHash: register.headHash,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(recoveryEntryPayload(entry));
  return buildArchiveRecoveryRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}

export function classifyArchiveRecoveryState({ c18Policy, c17Policy, c17ArchiveRegister, c17RegisterContext, recoveryRegister, now = null }) {
  validateArchiveRecoveryRegister(recoveryRegister, { c18Policy, c17Policy, c17ArchiveRegister, c17RegisterContext });
  const current = now ? parseTime(now, 'now').time : null;
  let overdueRestoreDrillCount = 0;
  if (current !== null) for (const entry of recoveryRegister.entries) if (current > parseTime(entry.nextRestoreDrillDueAt, 'nextRestoreDrillDueAt').time) overdueRestoreDrillCount += 1;
  return {
    status: recoveryRegister.status,
    successfulRestoreDrillCount: recoveryRegister.successfulRestoreDrillCount,
    overdueRestoreDrillCount,
    disasterRecoveryProven: recoveryRegister.successfulRestoreDrillCount > 0,
    recoveryCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}
