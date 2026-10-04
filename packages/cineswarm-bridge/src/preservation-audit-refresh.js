import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import {
  CINESWARM_MIGRATION_RECEIPT_SCHEMA,
  CINESWARM_SYNC_RECEIPT_SCHEMA,
  validateReplicaMaintenancePolicy,
  validateReplicaMaintenanceRegister,
  validateReplicaMigrationReceipt,
  validateReplicaPlacementPlan,
  validateReplicaSyncReceipt,
  validateStorageAdapterRegistry,
} from './replica-maintenance.js';

export const CINESWARM_PRESERVATION_AUDIT_REFRESH_POLICY_SCHEMA = 'parallax.cineswarm.preservation-audit-refresh-policy.c1.20.v0.1';
export const CINESWARM_PRESERVATION_AUDIT_SCHEDULE_SCHEMA = 'parallax.cineswarm.preservation-audit-schedule.c1.20.v0.1';
export const CINESWARM_PRESERVATION_AUDIT_RECEIPT_SCHEMA = 'parallax.cineswarm.preservation-audit-receipt.c1.20.v0.1';
export const CINESWARM_MEDIA_REFRESH_REVIEW_SCHEMA = 'parallax.cineswarm.media-refresh-review.c1.20.v0.1';
export const CINESWARM_MEDIA_REFRESH_CEREMONY_SCHEMA = 'parallax.cineswarm.media-refresh-ceremony.c1.20.v0.1';
export const CINESWARM_MEDIA_REFRESH_RECEIPT_SCHEMA = 'parallax.cineswarm.media-refresh-receipt.c1.20.v0.1';
export const CINESWARM_MEDIA_RETIREMENT_CEREMONY_SCHEMA = 'parallax.cineswarm.media-retirement-ceremony.c1.20.v0.1';
export const CINESWARM_MEDIA_RETIREMENT_RECEIPT_SCHEMA = 'parallax.cineswarm.media-retirement-receipt.c1.20.v0.1';
export const CINESWARM_PRESERVATION_REGISTER_SCHEMA = 'parallax.cineswarm.preservation-register.c1.20.v0.1';
export const C1_20_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_20_REFRESH_DECISION = 'AUTHORIZE_EXACT_MEDIA_REFRESH';
export const C1_20_RETIREMENT_DECISION = 'RETIRE_SOURCE_AFTER_VERIFIED_REFRESH';
export const C1_20_REGISTER_EVENTS = ['AUDIT_COMPLETED', 'MEDIA_REFRESH_COMPLETED', 'SOURCE_RETIRED'];

const REFRESH_DOMAIN = 'PARALLAX-CINESWARM-C1.20-MEDIA-REFRESH';
const RETIREMENT_DOMAIN = 'PARALLAX-CINESWARM-C1.20-MEDIA-RETIREMENT';

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
function minusDays(iso, days) {
  const date = new Date(parseTime(iso, 'timestamp').time);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}
function plusHours(iso, hours) {
  const date = new Date(parseTime(iso, 'timestamp').time);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}
function assertBoundary(value, label) {
  for (const key of ['publicRelease', 'relayDependency']) if (value[key] !== false) throw new Error(`${label}.${key} must remain false`);
  if (value.preservationCanAuthorizeRelease !== false) throw new Error(`${label}.preservationCanAuthorizeRelease must remain false`);
}
function findKey(keyRegistry, keyId) {
  validateSigningKeyRegistry(keyRegistry);
  const key = keyRegistry.keys.find((item) => item.keyId === keyId);
  if (!key) throw new Error(`signing key ${keyId} is not registered`);
  return key;
}
function validateKeyForNewSignature(key, authorityId, at) {
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new C1.20 signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('C1.20 signing key authority mismatch');
  const when = parseTime(at, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('C1.20 signing key was not valid at recordedAt');
}
function validateKeyForHistoricalSignature(key, authorityId, at) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('C1.20 signing key authority mismatch');
  const when = parseTime(at, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('C1.20 signature was created outside key validity');
}

export function validatePreservationAuditRefreshPolicy(policy) {
  if (!policy || policy.schema !== CINESWARM_PRESERVATION_AUDIT_REFRESH_POLICY_SCHEMA) throw new Error('invalid C1.20 Preservation Audit + Refresh policy schema');
  for (const [value, label] of [[policy.policyId, 'policyId'], [policy.c19PolicyId, 'c19PolicyId'], [policy.episodeId, 'episodeId'], [policy.sequenceId, 'sequenceId'], [policy.networkId, 'networkId']]) safeToken(value, label);
  if (!Number.isInteger(policy.maxAuditAgeDays) || policy.maxAuditAgeDays < 1 || policy.maxAuditAgeDays > 365) throw new Error('maxAuditAgeDays must be an internal 1-365 day policy');
  if (!Number.isInteger(policy.refreshWarningLeadDays) || policy.refreshWarningLeadDays < 1 || policy.refreshWarningLeadDays > 3650) throw new Error('refreshWarningLeadDays must be an internal 1-3650 day policy');
  if (!Number.isInteger(policy.maxRefreshAuthorizationAgeHours) || policy.maxRefreshAuthorizationAgeHours < 1 || policy.maxRefreshAuthorizationAgeHours > 168) throw new Error('maxRefreshAuthorizationAgeHours must be 1-168');
  if (policy.signatureAlgorithm !== C1_20_SIGNATURE_ALGORITHM) throw new Error(`signatureAlgorithm must remain ${C1_20_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('C1.20 private key custody must remain external-human-controlled');
  for (const key of [
    'requireC19PlacementValidation', 'requireC19MaintenanceRegisterValidation', 'requireExactReplicaAdapterBinding',
    'requireOperatorDefinedRefreshDueAt', 'requireHealthySourceBeforeRefresh', 'requireHealthyDestinationAfterRefresh',
    'requireExactHistoricalIdentity', 'requireSignedHumanRefreshAuthorization', 'requireSeparateRetirementCeremony',
    'requirePostWriteVerification', 'appendOnlyPreservationRegister', 'retirementRequiresReplacementPlacement',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of ['autoRefresh', 'autoRetireSource', 'sourceDeleteAuthorizedByRefresh', 'preservationCanAuthorizeRelease', 'autoRepublish', 'relayDependency']) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function validateC19Anchor({ c20Policy, c19Policy, placementPlan, placementContext, maintenanceRegister, maintenanceRegisterContext }) {
  validatePreservationAuditRefreshPolicy(c20Policy);
  validateReplicaMaintenancePolicy(c19Policy);
  if (c20Policy.c19PolicyId !== c19Policy.policyId) throw new Error('C1.20 policy is not bound to supplied C1.19 policy');
  for (const key of ['episodeId', 'sequenceId', 'networkId']) if (c20Policy[key] !== c19Policy[key]) throw new Error(`C1.20 policy ${key} scope drift detected`);
  validateReplicaPlacementPlan(placementPlan, placementContext);
  validateReplicaMaintenanceRegister(maintenanceRegister, maintenanceRegisterContext);
  return { valid: true };
}

function schedulePayload(schedule) { return withoutFields(schedule, ['scheduleHash']); }
export function buildPreservationAuditSchedule({ c20Policy, c19Policy, placementPlan, placementContext, maintenanceRegister, maintenanceRegisterContext, mediaAssignments, generatedAt, scheduleId = null }) {
  validateC19Anchor({ c20Policy, c19Policy, placementPlan, placementContext, maintenanceRegister, maintenanceRegisterContext });
  if (!Array.isArray(mediaAssignments) || mediaAssignments.length !== placementPlan.placements.length) throw new Error('Preservation Audit Schedule requires exactly one media assignment per governed placement');
  const placementByReplica = new Map(placementPlan.placements.map((item) => [item.replicaId, item]));
  const latestByReplica = new Map();
  for (const entry of maintenanceRegister.entries) latestByReplica.set(entry.replicaId, entry);
  const mediaIds = new Set(); const replicas = new Set();
  const generated = parseTime(generatedAt, 'generatedAt');
  if (generated.time < parseTime(placementPlan.createdAt, 'placementPlan.createdAt').time) throw new Error('Preservation Audit Schedule cannot predate placement plan');
  const targets = mediaAssignments.map((assignment) => {
    const replicaId = safeToken(assignment.replicaId, 'mediaAssignment.replicaId');
    const placement = placementByReplica.get(replicaId);
    if (!placement) throw new Error(`media assignment references unknown replica ${replicaId}`);
    if (replicas.has(replicaId)) throw new Error('Preservation Audit Schedule cannot assign one replica twice');
    replicas.add(replicaId);
    const mediaId = safeToken(assignment.mediaId, 'mediaId');
    if (mediaIds.has(mediaId)) throw new Error('Preservation Audit Schedule mediaId values must be unique');
    mediaIds.add(mediaId);
    const commissioned = parseTime(assignment.commissionedAt, 'commissionedAt');
    const refreshDue = parseTime(assignment.refreshDueAt, 'refreshDueAt');
    if (commissioned.time > generated.time) throw new Error('media commissionedAt cannot be in the future relative to schedule');
    if (refreshDue.time <= commissioned.time) throw new Error('media refreshDueAt must be after commissionedAt');
    const latest = latestByReplica.get(replicaId) ?? null;
    const lastVerifiedAt = latest?.completedAt ?? placementPlan.createdAt;
    const nextAuditDueAt = plusDays(lastVerifiedAt, c20Policy.maxAuditAgeDays);
    return {
      replicaId,
      replicaManifestHash: placement.replicaManifestHash,
      adapterId: placement.adapterId,
      adapterContractHash: placement.adapterContractHash,
      locationId: placement.locationId,
      failureDomain: placement.failureDomain,
      mediaId,
      mediaClass: safeToken(assignment.mediaClass, 'mediaClass'),
      commissionedAt: commissioned.text,
      refreshDueAt: refreshDue.text,
      refreshWarningAt: minusDays(refreshDue.text, c20Policy.refreshWarningLeadDays),
      lastVerifiedAt,
      nextAuditDueAt,
      latestMaintenanceEntryHash: latest?.entryHash ?? null,
    };
  }).sort((a, b) => a.replicaId.localeCompare(b.replicaId));
  const schedule = {
    schema: CINESWARM_PRESERVATION_AUDIT_SCHEDULE_SCHEMA,
    scheduleId: safeToken(scheduleId ?? `${placementPlan.planId}-preservation-audit`, 'scheduleId'),
    policyId: c20Policy.policyId,
    c19PolicyId: c19Policy.policyId,
    episodeId: c20Policy.episodeId,
    sequenceId: c20Policy.sequenceId,
    networkId: c20Policy.networkId,
    placementPlanHash: placementPlan.placementPlanHash,
    sourceMaintenanceRegisterHash: maintenanceRegister.registerHash,
    generatedAt: generated.text,
    targets,
    targetCount: targets.length,
    operatorDefinedRefreshDates: true,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  schedule.scheduleHash = digestJson(schedulePayload(schedule));
  return schedule;
}

export function validatePreservationAuditSchedule(schedule, context) {
  if (!schedule || schedule.schema !== CINESWARM_PRESERVATION_AUDIT_SCHEDULE_SCHEMA) throw new Error('invalid C1.20 Preservation Audit Schedule schema');
  const rebuilt = buildPreservationAuditSchedule({ ...context, mediaAssignments: schedule.targets.map(({ replicaId, mediaId, mediaClass, commissionedAt, refreshDueAt }) => ({ replicaId, mediaId, mediaClass, commissionedAt, refreshDueAt })), generatedAt: schedule.generatedAt, scheduleId: schedule.scheduleId });
  if (JSON.stringify(schedule) !== JSON.stringify(rebuilt)) throw new Error('Preservation Audit Schedule drift detected');
  ensureSha256(schedule.scheduleHash, 'scheduleHash');
  assertBoundary(schedule, 'schedule');
  return { valid: true, targetCount: schedule.targetCount };
}

export function classifyPreservationAuditSchedule({ schedule, scheduleContext, now }) {
  validatePreservationAuditSchedule(schedule, scheduleContext);
  const current = parseTime(now, 'now').time;
  let overdueAuditCount = 0; let dueAuditCount = 0; let refreshDueCount = 0; let refreshWarningCount = 0;
  const targets = schedule.targets.map((target) => {
    const nextAudit = parseTime(target.nextAuditDueAt, 'nextAuditDueAt').time;
    const refreshDue = parseTime(target.refreshDueAt, 'refreshDueAt').time;
    const refreshWarning = parseTime(target.refreshWarningAt, 'refreshWarningAt').time;
    const auditState = current > nextAudit ? 'OVERDUE' : current === nextAudit ? 'DUE' : 'CURRENT';
    const refreshState = current >= refreshDue ? 'REFRESH_DUE' : current >= refreshWarning ? 'REFRESH_WARNING' : 'CURRENT';
    if (auditState === 'OVERDUE') overdueAuditCount += 1;
    if (auditState === 'DUE') dueAuditCount += 1;
    if (refreshState === 'REFRESH_DUE') refreshDueCount += 1;
    if (refreshState === 'REFRESH_WARNING') refreshWarningCount += 1;
    return { replicaId: target.replicaId, mediaId: target.mediaId, auditState, refreshState, nextAuditDueAt: target.nextAuditDueAt, refreshDueAt: target.refreshDueAt };
  });
  return { status: refreshDueCount || overdueAuditCount ? 'ATTENTION_REQUIRED' : 'CURRENT', targets, overdueAuditCount, dueAuditCount, refreshDueCount, refreshWarningCount, preservationCanAuthorizeRelease: false, publicRelease: false, relayDependency: false };
}

function auditReceiptPayload(receipt) { return withoutFields(receipt, ['auditReceiptHash']); }
export function buildPreservationAuditReceipt({ c20Policy, schedule, scheduleContext, targetReplicaId, c19SyncReceipt, c19SyncReceiptContext, auditorId, recordedAt, receiptId = null }) {
  validatePreservationAuditSchedule(schedule, scheduleContext);
  if (!c19SyncReceipt || c19SyncReceipt.schema !== CINESWARM_SYNC_RECEIPT_SCHEMA) throw new Error('Preservation Audit requires a C1.19 Replica Sync Receipt');
  validateReplicaSyncReceipt(c19SyncReceipt, c19SyncReceiptContext);
  if (c19SyncReceipt.syncMode !== 'VERIFY_SYNC' || c19SyncReceipt.changedObjectCount !== 0) throw new Error('Preservation Audit requires a zero-change C1.19 VERIFY_SYNC receipt');
  const target = schedule.targets.find((item) => item.replicaId === targetReplicaId);
  if (!target) throw new Error('Preservation Audit target is not in the governed schedule');
  if (c19SyncReceipt.targetReplicaId !== target.replicaId || c19SyncReceipt.targetReplicaManifestHash !== target.replicaManifestHash) throw new Error('Preservation Audit sync target drift detected');
  if (parseTime(c19SyncReceipt.completedAt, 'c19SyncReceipt.completedAt').time < parseTime(schedule.generatedAt, 'schedule.generatedAt').time) throw new Error('Preservation Audit cannot reuse verification that predates the schedule');
  const when = parseTime(recordedAt, 'recordedAt');
  if (when.time < parseTime(c19SyncReceipt.completedAt, 'c19SyncReceipt.completedAt').time) throw new Error('Preservation Audit receipt cannot predate C1.19 verification');
  const receipt = {
    schema: CINESWARM_PRESERVATION_AUDIT_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${target.replicaId}-preservation-audit-${when.text.slice(0, 10).replaceAll('-', '')}`, 'receiptId'),
    policyId: c20Policy.policyId,
    scheduleHash: schedule.scheduleHash,
    replicaId: target.replicaId,
    mediaId: target.mediaId,
    adapterId: target.adapterId,
    c19SyncReceiptHash: c19SyncReceipt.syncReceiptHash,
    verificationHash: c19SyncReceipt.targetVerificationHash,
    auditStatus: 'PASS',
    auditedAt: c19SyncReceipt.completedAt,
    nextAuditDueAt: plusDays(c19SyncReceipt.completedAt, c20Policy.maxAuditAgeDays),
    auditorId: safeToken(auditorId, 'auditorId'),
    recordedAt: when.text,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.auditReceiptHash = digestJson(auditReceiptPayload(receipt));
  return receipt;
}

export function validatePreservationAuditReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_PRESERVATION_AUDIT_RECEIPT_SCHEMA) throw new Error('invalid C1.20 Preservation Audit Receipt schema');
  const rebuilt = buildPreservationAuditReceipt({ ...context, targetReplicaId: receipt.replicaId, auditorId: receipt.auditorId, recordedAt: receipt.recordedAt, receiptId: receipt.receiptId });
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) throw new Error('Preservation Audit Receipt drift detected');
  ensureSha256(receipt.auditReceiptHash, 'auditReceiptHash');
  return { valid: true };
}

function reviewPayload(review) { return withoutFields(review, ['reviewHash']); }
export function buildMediaRefreshReview({ c20Policy, schedule, scheduleContext, sourceReplicaId, destinationReplicaId, destinationMediaId, destinationMediaClass, destinationCommissionedAt, destinationRefreshDueAt, decision, reason, authorityId, recordedAt, reviewId = null }) {
  validatePreservationAuditSchedule(schedule, scheduleContext);
  if (!['APPROVE_REFRESH', 'HOLD'].includes(decision)) throw new Error('unsupported Media Refresh Review decision');
  const source = schedule.targets.find((item) => item.replicaId === sourceReplicaId);
  const destination = schedule.targets.find((item) => item.replicaId === destinationReplicaId);
  if (!source || !destination) throw new Error('Media Refresh Review requires governed source and destination placements');
  if (source.replicaId === destination.replicaId) throw new Error('Media Refresh Review source and destination must differ');
  const newMediaId = safeToken(destinationMediaId, 'destinationMediaId');
  if (newMediaId === source.mediaId) throw new Error('Media Refresh Review requires a new destination mediaId');
  const commissioned = parseTime(destinationCommissionedAt, 'destinationCommissionedAt');
  const refreshDue = parseTime(destinationRefreshDueAt, 'destinationRefreshDueAt');
  const recorded = parseTime(recordedAt, 'recordedAt');
  if (commissioned.time > recorded.time) throw new Error('destination media cannot be commissioned after review');
  if (refreshDue.time <= commissioned.time) throw new Error('destination refreshDueAt must be after commissionedAt');
  const review = {
    schema: CINESWARM_MEDIA_REFRESH_REVIEW_SCHEMA,
    reviewId: safeToken(reviewId ?? `${source.replicaId}-media-refresh-review`, 'reviewId'),
    policyId: c20Policy.policyId,
    scheduleHash: schedule.scheduleHash,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    reason: requiredString(reason, 'reason'),
    sourceReplicaId: source.replicaId,
    sourceAdapterId: source.adapterId,
    sourceMediaId: source.mediaId,
    sourceRefreshDueAt: source.refreshDueAt,
    destinationReplicaId: destination.replicaId,
    destinationAdapterId: destination.adapterId,
    destinationMediaId: newMediaId,
    destinationMediaClass: safeToken(destinationMediaClass, 'destinationMediaClass'),
    destinationCommissionedAt: commissioned.text,
    destinationRefreshDueAt: refreshDue.text,
    recordedAt: recorded.text,
    refreshAuthorized: false,
    sourceRetirementAuthorized: false,
    sourceDeletionAuthorized: false,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  review.reviewHash = digestJson(reviewPayload(review));
  return review;
}

export function validateMediaRefreshReview(review, context) {
  if (!review || review.schema !== CINESWARM_MEDIA_REFRESH_REVIEW_SCHEMA) throw new Error('invalid C1.20 Media Refresh Review schema');
  const rebuilt = buildMediaRefreshReview({ ...context, sourceReplicaId: review.sourceReplicaId, destinationReplicaId: review.destinationReplicaId, destinationMediaId: review.destinationMediaId, destinationMediaClass: review.destinationMediaClass, destinationCommissionedAt: review.destinationCommissionedAt, destinationRefreshDueAt: review.destinationRefreshDueAt, decision: review.decision, reason: review.reason, authorityId: review.authority?.id, recordedAt: review.recordedAt, reviewId: review.reviewId });
  if (JSON.stringify(review) !== JSON.stringify(rebuilt)) throw new Error('Media Refresh Review drift detected');
  ensureSha256(review.reviewHash, 'reviewHash');
  return { valid: true };
}

function refreshCeremonyPayload(ceremony) { return withoutFields(ceremony, ['ceremonyDigest', 'signatureAlgorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']); }
function refreshMessage(ceremonyDigest, ceremony) {
  return [REFRESH_DOMAIN, ceremony.ceremonyId, ceremonyDigest, ceremony.keyId, ceremony.authority.id, ceremony.reviewHash, ceremony.transitionPlacementPlanHash, ceremony.postRefreshPlacementPlanHash, ceremony.sourceReplicaId, ceremony.destinationReplicaId, ceremony.recordedAt, ceremony.authorizationExpiresAt].join('\n');
}

export function buildMediaRefreshCeremonyPayload({ c20Policy, c19Policy, review, reviewContext, transitionPlacementPlan, transitionPlacementContext, postRefreshPlacementPlan, postRefreshPlacementContext, recoveryBundle, authorityId, keyId, recordedAt, ceremonyId = null }) {
  validatePreservationAuditRefreshPolicy(c20Policy); validateReplicaMaintenancePolicy(c19Policy);
  validateMediaRefreshReview(review, reviewContext);
  if (review.decision !== 'APPROVE_REFRESH') throw new Error('Media Refresh Ceremony requires APPROVE_REFRESH review');
  validateReplicaPlacementPlan(transitionPlacementPlan, transitionPlacementContext);
  validateReplicaPlacementPlan(postRefreshPlacementPlan, postRefreshPlacementContext);
  const sourceTransition = transitionPlacementPlan.placements.find((item) => item.replicaId === review.sourceReplicaId);
  const destTransition = transitionPlacementPlan.placements.find((item) => item.replicaId === review.destinationReplicaId);
  const sourcePost = postRefreshPlacementPlan.placements.find((item) => item.replicaId === review.sourceReplicaId);
  const destPost = postRefreshPlacementPlan.placements.find((item) => item.replicaId === review.destinationReplicaId);
  if (!sourceTransition || !destTransition) throw new Error('Media Refresh Ceremony transition plan must include source and destination');
  if (sourcePost) throw new Error('Media Refresh Ceremony post-refresh placement plan must exclude the source slated for retirement');
  if (!destPost) throw new Error('Media Refresh Ceremony post-refresh placement plan must retain the replacement destination');
  if (sourceTransition.adapterId !== review.sourceAdapterId || destTransition.adapterId !== review.destinationAdapterId) throw new Error('Media Refresh Ceremony replica/adapter pairing drift detected');
  if (!recoveryBundle || recoveryBundle.bundleManifestHash !== transitionPlacementPlan.bundleManifestHash || recoveryBundle.bundleManifestHash !== postRefreshPlacementPlan.bundleManifestHash) throw new Error('Media Refresh Ceremony Recovery Bundle drift detected');
  ensureSha256(recoveryBundle.outputSha256, 'recoveryBundle.outputSha256');
  const timestamp = parseTime(recordedAt, 'recordedAt');
  if (timestamp.time < parseTime(review.recordedAt, 'review.recordedAt').time) throw new Error('Media Refresh Ceremony cannot predate review');
  const ceremony = {
    schema: CINESWARM_MEDIA_REFRESH_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${review.sourceReplicaId}-to-${review.destinationReplicaId}-media-refresh`, 'ceremonyId'),
    policyId: c20Policy.policyId,
    c19PolicyId: c19Policy.policyId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision: C1_20_REFRESH_DECISION,
    keyId: safeToken(keyId, 'keyId'),
    reviewId: review.reviewId,
    reviewHash: review.reviewHash,
    transitionPlacementPlanHash: transitionPlacementPlan.placementPlanHash,
    postRefreshPlacementPlanHash: postRefreshPlacementPlan.placementPlanHash,
    bundleManifestHash: recoveryBundle.bundleManifestHash,
    historicalOutputSha256: recoveryBundle.outputSha256,
    sourceReplicaId: review.sourceReplicaId,
    sourceAdapterId: review.sourceAdapterId,
    sourceMediaId: review.sourceMediaId,
    destinationReplicaId: review.destinationReplicaId,
    destinationAdapterId: review.destinationAdapterId,
    destinationMediaId: review.destinationMediaId,
    recordedAt: timestamp.text,
    authorizationExpiresAt: plusHours(timestamp.text, c20Policy.maxRefreshAuthorizationAgeHours),
    refreshAuthorized: true,
    sourceRetirementAuthorized: false,
    sourceDeletionAuthorized: false,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  return ceremony;
}

export function signMediaRefreshCeremony(payload, { privateKeyPem, keyRegistry }) {
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  const ceremonyDigest = digestJson(refreshCeremonyPayload(payload));
  const signatureBase64 = cryptoSign(null, Buffer.from(refreshMessage(ceremonyDigest, payload)), privateKeyPem).toString('base64');
  const ceremony = { ...structuredClone(payload), ceremonyDigest, signatureAlgorithm: C1_20_SIGNATURE_ALGORITHM, signatureBase64, keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem) };
  ceremony.ceremonyHash = digestJson(withoutFields(ceremony, ['ceremonyHash']));
  return ceremony;
}

export function verifyMediaRefreshCeremony({ ceremony, keyRegistry, ...payloadContext }) {
  if (!ceremony || ceremony.schema !== CINESWARM_MEDIA_REFRESH_CEREMONY_SCHEMA) throw new Error('invalid C1.20 Media Refresh Ceremony schema');
  const expectedPayload = buildMediaRefreshCeremonyPayload({ ...payloadContext, authorityId: ceremony.authority?.id, keyId: ceremony.keyId, recordedAt: ceremony.recordedAt, ceremonyId: ceremony.ceremonyId });
  for (const key of Object.keys(expectedPayload)) if (JSON.stringify(ceremony[key]) !== JSON.stringify(expectedPayload[key])) throw new Error(`Media Refresh Ceremony ${key} drift detected`);
  if (ceremony.signatureAlgorithm !== C1_20_SIGNATURE_ALGORITHM) throw new Error('Media Refresh Ceremony signature algorithm drift detected');
  ensureSha256(ceremony.ceremonyDigest, 'ceremonyDigest'); ensureSha256(ceremony.keyFingerprintSha256, 'keyFingerprintSha256'); ensureSha256(ceremony.ceremonyHash, 'ceremonyHash');
  requiredString(ceremony.signatureBase64, 'signatureBase64');
  const expectedDigest = digestJson(refreshCeremonyPayload(ceremony));
  if (ceremony.ceremonyDigest !== expectedDigest) throw new Error('Media Refresh Ceremony payload digest mismatch');
  const key = findKey(keyRegistry, ceremony.keyId); validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Media Refresh Ceremony key fingerprint mismatch');
  if (!cryptoVerify(null, Buffer.from(refreshMessage(expectedDigest, ceremony)), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'))) throw new Error('Media Refresh Ceremony signature verification failed');
  if (ceremony.ceremonyHash !== digestJson(withoutFields(ceremony, ['ceremonyHash']))) throw new Error('Media Refresh Ceremony self-hash mismatch');
  assertBoundary(ceremony, 'ceremony');
  return { valid: true, ceremonyHash: ceremony.ceremonyHash };
}

function refreshReceiptPayload(receipt) { return withoutFields(receipt, ['refreshReceiptHash']); }
export function buildMediaRefreshReceipt({ c20Policy, ceremony, ceremonyContext, keyRegistry, c19MigrationReceipt, c19MigrationContext, recordedAt, receiptId = null }) {
  verifyMediaRefreshCeremony({ ceremony, keyRegistry, ...ceremonyContext });
  if (!c19MigrationReceipt || c19MigrationReceipt.schema !== CINESWARM_MIGRATION_RECEIPT_SCHEMA) throw new Error('Media Refresh Receipt requires C1.19 Replica Migration Receipt');
  validateReplicaMigrationReceipt(c19MigrationReceipt, c19MigrationContext);
  if (c19MigrationReceipt.sourceReplicaId !== ceremony.sourceReplicaId || c19MigrationReceipt.destinationReplicaId !== ceremony.destinationReplicaId) throw new Error('Media Refresh migration source/destination drift detected');
  if (c19MigrationReceipt.sourceAdapterId !== ceremony.sourceAdapterId || c19MigrationReceipt.destinationAdapterId !== ceremony.destinationAdapterId) throw new Error('Media Refresh migration adapter drift detected');
  if (c19MigrationReceipt.bundleManifestHash !== ceremony.bundleManifestHash || c19MigrationReceipt.historicalOutputSha256 !== ceremony.historicalOutputSha256) throw new Error('Media Refresh historical identity drift detected');
  if (c19MigrationReceipt.sourceRetirementAuthorized !== false || c19MigrationReceipt.sourceAutoDeleted !== false) throw new Error('C1.20 refresh requires C1.19 migration to leave source retirement/deletion unauthorized');
  const start = parseTime(c19MigrationReceipt.startedAt, 'migration.startedAt').time;
  if (start < parseTime(ceremony.recordedAt, 'ceremony.recordedAt').time) throw new Error('Media Refresh migration cannot start before signed authorization');
  if (start >= parseTime(ceremony.authorizationExpiresAt, 'ceremony.authorizationExpiresAt').time) throw new Error('Media Refresh migration started after authorization expired');
  const when = parseTime(recordedAt, 'recordedAt');
  if (when.time < parseTime(c19MigrationReceipt.completedAt, 'migration.completedAt').time) throw new Error('Media Refresh Receipt cannot predate migration completion');
  const receipt = {
    schema: CINESWARM_MEDIA_REFRESH_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${ceremony.sourceReplicaId}-to-${ceremony.destinationReplicaId}-media-refresh-receipt`, 'receiptId'),
    policyId: c20Policy.policyId,
    ceremonyHash: ceremony.ceremonyHash,
    migrationReceiptHash: c19MigrationReceipt.migrationReceiptHash,
    transitionPlacementPlanHash: ceremony.transitionPlacementPlanHash,
    postRefreshPlacementPlanHash: ceremony.postRefreshPlacementPlanHash,
    bundleManifestHash: ceremony.bundleManifestHash,
    historicalOutputSha256: ceremony.historicalOutputSha256,
    sourceReplicaId: ceremony.sourceReplicaId,
    sourceMediaId: ceremony.sourceMediaId,
    destinationReplicaId: ceremony.destinationReplicaId,
    destinationMediaId: ceremony.destinationMediaId,
    destinationVerificationHash: c19MigrationReceipt.destinationVerificationHash,
    exactHistoricalIdentityPreserved: true,
    destinationHealthyAfterRefresh: true,
    sourceRetirementEligible: true,
    sourceRetired: false,
    sourceDeletionAuthorized: false,
    sourceBytesDeleted: false,
    recordedAt: when.text,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.refreshReceiptHash = digestJson(refreshReceiptPayload(receipt));
  return receipt;
}

export function validateMediaRefreshReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_MEDIA_REFRESH_RECEIPT_SCHEMA) throw new Error('invalid C1.20 Media Refresh Receipt schema');
  const rebuilt = buildMediaRefreshReceipt({ ...context, recordedAt: receipt.recordedAt, receiptId: receipt.receiptId });
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) throw new Error('Media Refresh Receipt drift detected');
  ensureSha256(receipt.refreshReceiptHash, 'refreshReceiptHash');
  return { valid: true };
}

function retirementPayload(ceremony) { return withoutFields(ceremony, ['ceremonyDigest', 'signatureAlgorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']); }
function retirementMessage(ceremonyDigest, ceremony) {
  return [RETIREMENT_DOMAIN, ceremony.ceremonyId, ceremonyDigest, ceremony.keyId, ceremony.authority.id, ceremony.refreshReceiptHash, ceremony.postRefreshPlacementPlanHash, ceremony.sourceReplicaId, ceremony.destinationReplicaId, ceremony.recordedAt].join('\n');
}

export function buildMediaRetirementCeremonyPayload({ c20Policy, refreshReceipt, refreshReceiptContext, postRefreshPlacementPlan, postRefreshPlacementContext, authorityId, keyId, reason, recordedAt, ceremonyId = null }) {
  validateMediaRefreshReceipt(refreshReceipt, refreshReceiptContext);
  validateReplicaPlacementPlan(postRefreshPlacementPlan, postRefreshPlacementContext);
  if (postRefreshPlacementPlan.placementPlanHash !== refreshReceipt.postRefreshPlacementPlanHash) throw new Error('Media Retirement post-refresh placement plan drift detected');
  if (postRefreshPlacementPlan.placements.some((item) => item.replicaId === refreshReceipt.sourceReplicaId)) throw new Error('Media Retirement post-refresh plan must exclude source replica');
  if (!postRefreshPlacementPlan.placements.some((item) => item.replicaId === refreshReceipt.destinationReplicaId)) throw new Error('Media Retirement post-refresh plan must retain destination replica');
  const when = parseTime(recordedAt, 'recordedAt');
  if (when.time < parseTime(refreshReceipt.recordedAt, 'refreshReceipt.recordedAt').time) throw new Error('Media Retirement Ceremony cannot predate verified refresh');
  return {
    schema: CINESWARM_MEDIA_RETIREMENT_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${refreshReceipt.sourceReplicaId}-media-retirement`, 'ceremonyId'),
    policyId: c20Policy.policyId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision: C1_20_RETIREMENT_DECISION,
    keyId: safeToken(keyId, 'keyId'),
    refreshReceiptHash: refreshReceipt.refreshReceiptHash,
    postRefreshPlacementPlanHash: postRefreshPlacementPlan.placementPlanHash,
    historicalOutputSha256: refreshReceipt.historicalOutputSha256,
    sourceReplicaId: refreshReceipt.sourceReplicaId,
    sourceMediaId: refreshReceipt.sourceMediaId,
    destinationReplicaId: refreshReceipt.destinationReplicaId,
    destinationMediaId: refreshReceipt.destinationMediaId,
    reason: requiredString(reason, 'reason'),
    recordedAt: when.text,
    sourceRetirementAuthorized: true,
    sourceDeletionAuthorized: false,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function signMediaRetirementCeremony(payload, { privateKeyPem, keyRegistry }) {
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId); validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  const ceremonyDigest = digestJson(retirementPayload(payload));
  const signatureBase64 = cryptoSign(null, Buffer.from(retirementMessage(ceremonyDigest, payload)), privateKeyPem).toString('base64');
  const ceremony = { ...structuredClone(payload), ceremonyDigest, signatureAlgorithm: C1_20_SIGNATURE_ALGORITHM, signatureBase64, keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem) };
  ceremony.ceremonyHash = digestJson(withoutFields(ceremony, ['ceremonyHash']));
  return ceremony;
}

export function verifyMediaRetirementCeremony({ ceremony, keyRegistry, ...payloadContext }) {
  if (!ceremony || ceremony.schema !== CINESWARM_MEDIA_RETIREMENT_CEREMONY_SCHEMA) throw new Error('invalid C1.20 Media Retirement Ceremony schema');
  const expectedPayload = buildMediaRetirementCeremonyPayload({ ...payloadContext, authorityId: ceremony.authority?.id, keyId: ceremony.keyId, reason: ceremony.reason, recordedAt: ceremony.recordedAt, ceremonyId: ceremony.ceremonyId });
  for (const key of Object.keys(expectedPayload)) if (JSON.stringify(ceremony[key]) !== JSON.stringify(expectedPayload[key])) throw new Error(`Media Retirement Ceremony ${key} drift detected`);
  const expectedDigest = digestJson(retirementPayload(ceremony));
  if (ceremony.ceremonyDigest !== expectedDigest) throw new Error('Media Retirement Ceremony payload digest mismatch');
  const key = findKey(keyRegistry, ceremony.keyId); validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt);
  if (ceremony.signatureAlgorithm !== C1_20_SIGNATURE_ALGORITHM) throw new Error('Media Retirement Ceremony signature algorithm drift detected');
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Media Retirement Ceremony key fingerprint mismatch');
  if (!cryptoVerify(null, Buffer.from(retirementMessage(expectedDigest, ceremony)), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'))) throw new Error('Media Retirement Ceremony signature verification failed');
  if (ceremony.ceremonyHash !== digestJson(withoutFields(ceremony, ['ceremonyHash']))) throw new Error('Media Retirement Ceremony self-hash mismatch');
  assertBoundary(ceremony, 'retirement ceremony');
  return { valid: true, ceremonyHash: ceremony.ceremonyHash };
}

function retirementReceiptPayload(receipt) { return withoutFields(receipt, ['retirementReceiptHash']); }
export function buildMediaRetirementReceipt({ c20Policy, ceremony, ceremonyContext, keyRegistry, recordedAt, receiptId = null }) {
  verifyMediaRetirementCeremony({ ceremony, keyRegistry, ...ceremonyContext });
  const when = parseTime(recordedAt, 'recordedAt');
  if (when.time < parseTime(ceremony.recordedAt, 'ceremony.recordedAt').time) throw new Error('Media Retirement Receipt cannot predate ceremony');
  const receipt = {
    schema: CINESWARM_MEDIA_RETIREMENT_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${ceremony.sourceReplicaId}-media-retirement-receipt`, 'receiptId'),
    policyId: c20Policy.policyId,
    ceremonyHash: ceremony.ceremonyHash,
    refreshReceiptHash: ceremony.refreshReceiptHash,
    postRefreshPlacementPlanHash: ceremony.postRefreshPlacementPlanHash,
    historicalOutputSha256: ceremony.historicalOutputSha256,
    sourceReplicaId: ceremony.sourceReplicaId,
    sourceMediaId: ceremony.sourceMediaId,
    destinationReplicaId: ceremony.destinationReplicaId,
    destinationMediaId: ceremony.destinationMediaId,
    sourceRetired: true,
    sourceBytesDeleted: false,
    sourceDeletionAuthorized: false,
    historicalIdentityPreserved: true,
    recordedAt: when.text,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.retirementReceiptHash = digestJson(retirementReceiptPayload(receipt));
  return receipt;
}

export function validateMediaRetirementReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_MEDIA_RETIREMENT_RECEIPT_SCHEMA) throw new Error('invalid C1.20 Media Retirement Receipt schema');
  const rebuilt = buildMediaRetirementReceipt({ ...context, recordedAt: receipt.recordedAt, receiptId: receipt.receiptId });
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) throw new Error('Media Retirement Receipt drift detected');
  ensureSha256(receipt.retirementReceiptHash, 'retirementReceiptHash');
  return { valid: true };
}

function registerEntryPayload(entry) { return withoutFields(entry, ['entryHash']); }
function registerPayload(register) { return withoutFields(register, ['registerHash']); }
export function buildPreservationRegister({ c20Policy, c19Policy, c19MaintenanceRegister, c19MaintenanceRegisterContext, storageAdapterRegistry, entries = [], revision = 0, recordedAt }) {
  validatePreservationAuditRefreshPolicy(c20Policy); validateReplicaMaintenancePolicy(c19Policy);
  if (c20Policy.c19PolicyId !== c19Policy.policyId) throw new Error('Preservation Register policy binding mismatch');
  validateReplicaMaintenanceRegister(c19MaintenanceRegister, c19MaintenanceRegisterContext);
  validateStorageAdapterRegistry(storageAdapterRegistry, { c19Policy });
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision !== entries.length) throw new Error('Preservation Register revision must equal entry count');
  let previous = null; const receiptHashes = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!C1_20_REGISTER_EVENTS.includes(entry.eventType)) throw new Error('unsupported C1.20 Preservation Register eventType');
    if (entry.previousEntryHash !== previous) throw new Error(`Preservation Register hash chain broken at entry ${index}`);
    if (entry.entryHash !== digestJson(registerEntryPayload(entry))) throw new Error(`Preservation Register entry ${index} self-hash mismatch`);
    ensureSha256(entry.receiptHash, 'receiptHash');
    if (receiptHashes.has(entry.receiptHash)) throw new Error('C1.20 receipt is already registered');
    receiptHashes.add(entry.receiptHash);
    assertBoundary(entry, 'register entry');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_PRESERVATION_REGISTER_SCHEMA,
    registerId: `${c20Policy.sequenceId}-preservation-register`,
    policyId: c20Policy.policyId,
    c19PolicyId: c19Policy.policyId,
    episodeId: c20Policy.episodeId,
    sequenceId: c20Policy.sequenceId,
    networkId: c20Policy.networkId,
    sourceC19MaintenanceRegisterHash: c19MaintenanceRegister.registerHash,
    sourceStorageAdapterRegistryHash: storageAdapterRegistry.registryHash,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    entries: structuredClone(entries),
    entryCount: entries.length,
    headHash: previous,
    auditCount: entries.filter((item) => item.eventType === 'AUDIT_COMPLETED').length,
    refreshCount: entries.filter((item) => item.eventType === 'MEDIA_REFRESH_COMPLETED').length,
    retirementCount: entries.filter((item) => item.eventType === 'SOURCE_RETIRED').length,
    status: entries.length ? 'PRESERVATION_HISTORY_PRESENT' : 'EMPTY_NO_MANAGED_MEDIA',
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(registerPayload(register));
  return register;
}

export function validatePreservationRegister(register, context) {
  if (!register || register.schema !== CINESWARM_PRESERVATION_REGISTER_SCHEMA) throw new Error('invalid C1.20 Preservation Register schema');
  const rebuilt = buildPreservationRegister({ ...context, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  if (JSON.stringify(register) !== JSON.stringify(rebuilt)) throw new Error('Preservation Register drift detected');
  ensureSha256(register.registerHash, 'registerHash');
  return { valid: true, revision: register.revision };
}

export function appendPreservationReceipt({ register, receipt, receiptContext, registerContext, recordedAt }) {
  validatePreservationRegister(register, registerContext);
  let eventType; let receiptHash; let replicaId; let completedAt;
  if (receipt?.schema === CINESWARM_PRESERVATION_AUDIT_RECEIPT_SCHEMA) {
    validatePreservationAuditReceipt(receipt, receiptContext); eventType = 'AUDIT_COMPLETED'; receiptHash = receipt.auditReceiptHash; replicaId = receipt.replicaId; completedAt = receipt.recordedAt;
  } else if (receipt?.schema === CINESWARM_MEDIA_REFRESH_RECEIPT_SCHEMA) {
    validateMediaRefreshReceipt(receipt, receiptContext); eventType = 'MEDIA_REFRESH_COMPLETED'; receiptHash = receipt.refreshReceiptHash; replicaId = receipt.destinationReplicaId; completedAt = receipt.recordedAt;
  } else if (receipt?.schema === CINESWARM_MEDIA_RETIREMENT_RECEIPT_SCHEMA) {
    validateMediaRetirementReceipt(receipt, receiptContext); eventType = 'SOURCE_RETIRED'; receiptHash = receipt.retirementReceiptHash; replicaId = receipt.sourceReplicaId; completedAt = receipt.recordedAt;
  } else throw new Error('unsupported C1.20 preservation receipt');
  if (register.entries.some((entry) => entry.receiptHash === receiptHash)) throw new Error('C1.20 receipt is already registered');
  const when = parseTime(recordedAt, 'recordedAt');
  if (when.time < parseTime(completedAt, 'receipt.recordedAt').time) throw new Error('Preservation Register entry cannot predate receipt');
  const entry = {
    eventType,
    receiptHash,
    replicaId,
    recordedAt: when.text,
    previousEntryHash: register.headHash,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(registerEntryPayload(entry));
  return buildPreservationRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: when.text });
}

export function classifyPreservationState({ c20Policy, c19Policy, c19MaintenanceRegister, c19MaintenanceRegisterContext, storageAdapterRegistry, preservationRegister, schedule = null, scheduleContext = null, now = null }) {
  validatePreservationRegister(preservationRegister, { c20Policy, c19Policy, c19MaintenanceRegister, c19MaintenanceRegisterContext, storageAdapterRegistry });
  const scheduleStatus = schedule && scheduleContext && now ? classifyPreservationAuditSchedule({ schedule, scheduleContext, now }) : null;
  return {
    status: preservationRegister.status,
    auditCount: preservationRegister.auditCount,
    refreshCount: preservationRegister.refreshCount,
    retirementCount: preservationRegister.retirementCount,
    overdueAuditCount: scheduleStatus?.overdueAuditCount ?? 0,
    refreshDueCount: scheduleStatus?.refreshDueCount ?? 0,
    preservationCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}
