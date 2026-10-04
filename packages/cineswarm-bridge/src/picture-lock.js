import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson } from './authorization-seal.js';
import { validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import {
  classifyPicturePlan,
  validateCandidateAssetRegistry,
  validatePicturePlanCandidate,
  validatePicturePlanReview,
} from './candidate-picture-plan.js';

export const CINESWARM_PICTURE_LOCK_POLICY_SCHEMA = 'parallax.cineswarm.picture-lock-policy.c1.10.v0.1';
export const CINESWARM_PICTURE_LOCK_CEREMONY_SCHEMA = 'parallax.cineswarm.picture-lock-ceremony.c1.10.v0.1';
export const CINESWARM_LOCKED_PICTURE_MANIFEST_SCHEMA = 'parallax.cineswarm.locked-picture-manifest.c1.10.v0.1';
export const CINESWARM_PICTURE_LOCK_TRANSITION_SCHEMA = 'parallax.cineswarm.picture-lock-transition.c1.10.v0.1';
export const CINESWARM_PICTURE_LOCK_REGISTER_ENTRY_SCHEMA = 'parallax.cineswarm.picture-lock-register-entry.c1.10.v0.1';
export const CINESWARM_PICTURE_LOCK_REGISTER_SCHEMA = 'parallax.cineswarm.picture-lock-register.c1.10.v0.1';
export const C1_10_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_10_LOCK_DECISION = 'LOCK_EXACT_PICTURE_PLAN';
export const C1_10_TRANSITION_DECISIONS = Object.freeze(['UNLOCK_FOR_REVISION', 'SUPERSEDE']);

const LOCK_DOMAIN = 'PARALLAX-CINESWARM-C1.10-PICTURE-LOCK';
const TRANSITION_DOMAIN = 'PARALLAX-CINESWARM-C1.10-PICTURE-LOCK-TRANSITION';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeToken(value, label) {
  const text = requiredString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`${label} contains unsupported characters`);
  return text;
}

function parseTime(value, label) {
  const text = requiredString(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  return { text, time };
}

function ensureSha256(value, label) {
  const text = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}

function withoutFields(value, fields) {
  const copy = structuredClone(value);
  for (const field of fields) delete copy[field];
  return copy;
}

function findKey(keyRegistry, keyId) {
  validateSigningKeyRegistry(keyRegistry);
  const key = keyRegistry.keys.find((entry) => entry.keyId === keyId);
  if (!key) throw new Error(`signing key ${keyId} is not registered`);
  return key;
}

function validateKeyForNewSignature(key, authorityId, recordedAt) {
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new Picture Lock signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Picture Lock signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Picture Lock signing key was not valid at recordedAt');
}

function validateKeyForHistoricalSignature(key, authorityId, recordedAt) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Picture Lock signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Picture Lock signature was created outside key validity');
}

export function validatePictureLockPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('picture lock policy must be an object');
  if (policy.schema !== CINESWARM_PICTURE_LOCK_POLICY_SCHEMA) throw new Error(`unsupported picture lock policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  if (policy.signatureAlgorithm !== C1_10_SIGNATURE_ALGORITHM) throw new Error(`picture lock signatureAlgorithm must be ${C1_10_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('Picture Lock private key custody must remain external-human-controlled');
  const mustBeTrue = [
    'requireApprovedC1_9PlanReview',
    'requireExactPlanHash',
    'requireExactReviewHash',
    'requireExactCandidateRegistryHash',
    'requireExactShotSelectionDigest',
    'requireHumanSignature',
    'requireExplicitUnlockForRevision',
    'requireExplicitSupersession',
    'appendOnlyLockRegister',
  ];
  for (const key of mustBeTrue) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  const mustBeFalse = ['autoPictureLock', 'canonAuthority', 'ledgerPromotionAuthority', 'publicRelease', 'relayDependency'];
  for (const key of mustBeFalse) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function lockPayloadDigestSource(ceremony) {
  return withoutFields(ceremony, [
    'ceremonyDigest',
    'signatureAlgorithm',
    'signatureBase64',
    'keyFingerprintSha256',
    'ceremonyHash',
  ]);
}

function lockMessage(ceremonyDigest, ceremony) {
  return [
    LOCK_DOMAIN,
    ceremony.ceremonyId,
    ceremonyDigest,
    ceremony.keyId,
    ceremony.authority.id,
    ceremony.planHash,
    ceremony.reviewHash,
    ceremony.candidateRegistryHash,
    ceremony.shotSelectionDigest,
    ceremony.recordedAt,
  ].join('\n');
}

export function buildPictureLockCeremonyPayload({
  policy,
  plan,
  review,
  candidateRegistry,
  authorityId,
  keyId,
  recordedAt,
  ceremonyId = null,
}) {
  validatePictureLockPolicy(policy);
  validateCandidateAssetRegistry(candidateRegistry);
  validatePicturePlanCandidate(plan, { registry: candidateRegistry });
  validatePicturePlanReview(review, plan);
  const classification = classifyPicturePlan({ plan, review });
  if (!classification.pictureLockCeremonyEligible || review.decision !== 'APPROVE_FOR_LOCK_CEREMONY') throw new Error('Picture Lock requires an exact human-approved C1.9 plan review');
  if (plan.episodeId !== policy.episodeId || plan.sequenceId !== policy.sequenceId) throw new Error('Picture Lock plan does not match policy scope');
  if (candidateRegistry.episodeId !== policy.episodeId || candidateRegistry.sequenceId !== policy.sequenceId) throw new Error('Picture Lock candidate registry does not match policy scope');
  if (plan.registryHash !== candidateRegistry.registryHash || plan.registryRevision !== candidateRegistry.revision) throw new Error('Picture Lock candidate registry/version drift detected');
  const authority = safeToken(authorityId, 'authorityId');
  const signingKey = safeToken(keyId, 'keyId');
  const timestamp = parseTime(recordedAt, 'recordedAt').text;
  const id = ceremonyId ?? `${policy.sequenceId}-picture-lock-${plan.planHash.slice(0, 12)}`;
  safeToken(id, 'ceremonyId');
  return {
    schema: CINESWARM_PICTURE_LOCK_CEREMONY_SCHEMA,
    ceremonyId: id,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    authority: { kind: 'human', id: authority },
    simulated: false,
    decision: C1_10_LOCK_DECISION,
    keyId: signingKey,
    planId: plan.planId,
    planHash: plan.planHash,
    reviewId: review.reviewId,
    reviewHash: digestJson(review),
    candidateRegistryId: candidateRegistry.registryId,
    candidateRegistryRevision: candidateRegistry.revision,
    candidateRegistryHash: candidateRegistry.registryHash,
    sequenceJobDigest: plan.sequenceJobDigest,
    continuityVersion: plan.continuityVersion,
    shotSelectionDigest: digestJson(plan.shotSelections),
    shotCount: plan.shotCount,
    totalDurationSeconds: plan.totalDurationSeconds,
    recordedAt: timestamp,
    pictureLockAuthorized: true,
    changesRequireExplicitUnlock: true,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function signPictureLockCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!payload || typeof payload !== 'object') throw new Error('Picture Lock ceremony payload must be an object');
  if (payload.schema !== CINESWARM_PICTURE_LOCK_CEREMONY_SCHEMA) throw new Error(`unsupported Picture Lock ceremony schema: ${payload.schema}`);
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  const ceremonyDigest = digestJson(lockPayloadDigestSource(payload));
  const message = lockMessage(ceremonyDigest, payload);
  const signatureBase64 = cryptoSign(null, Buffer.from(message), privateKeyPem).toString('base64');
  const ceremony = {
    ...structuredClone(payload),
    ceremonyDigest,
    signatureAlgorithm: C1_10_SIGNATURE_ALGORITHM,
    signatureBase64,
    keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
  };
  ceremony.ceremonyHash = digestJson(withoutFields(ceremony, ['ceremonyHash']));
  return ceremony;
}

export function verifyPictureLockCeremony({ ceremony, plan, review, candidateRegistry, policy, keyRegistry }) {
  validatePictureLockPolicy(policy);
  validatePicturePlanCandidate(plan, { registry: candidateRegistry });
  validatePicturePlanReview(review, plan);
  if (!ceremony || typeof ceremony !== 'object') throw new Error('Picture Lock ceremony must be an object');
  if (ceremony.schema !== CINESWARM_PICTURE_LOCK_CEREMONY_SCHEMA) throw new Error(`unsupported Picture Lock ceremony schema: ${ceremony.schema}`);
  safeToken(ceremony.ceremonyId, 'ceremonyId');
  if (ceremony.authority?.kind !== 'human') throw new Error('Picture Lock ceremony requires human authority');
  safeToken(ceremony.authority?.id, 'authority.id');
  if (ceremony.simulated !== false) throw new Error('Picture Lock ceremony must be real, not simulated');
  if (ceremony.decision !== C1_10_LOCK_DECISION || ceremony.pictureLockAuthorized !== true) throw new Error('Picture Lock ceremony must explicitly lock the exact Picture Plan');
  if (ceremony.changesRequireExplicitUnlock !== true) throw new Error('Picture Lock ceremony must require explicit unlock for changes');
  if (ceremony.canonAuthorized !== false || ceremony.ledgerPromotionAuthorized !== false || ceremony.publicRelease !== false || ceremony.relayDependency !== false) throw new Error('Picture Lock ceremony must preserve downstream authority boundaries');
  if (ceremony.policyId !== policy.policyId || ceremony.episodeId !== policy.episodeId || ceremony.sequenceId !== policy.sequenceId) throw new Error('Picture Lock ceremony policy scope mismatch');
  if (ceremony.planId !== plan.planId || ceremony.planHash !== plan.planHash) throw new Error('Picture Lock ceremony does not bind the exact Picture Plan hash');
  if (ceremony.reviewId !== review.reviewId || ceremony.reviewHash !== digestJson(review)) throw new Error('Picture Lock ceremony does not bind the exact C1.9 review hash');
  if (ceremony.candidateRegistryId !== candidateRegistry.registryId || ceremony.candidateRegistryRevision !== candidateRegistry.revision || ceremony.candidateRegistryHash !== candidateRegistry.registryHash) throw new Error('Picture Lock ceremony candidate registry drift detected');
  if (ceremony.sequenceJobDigest !== plan.sequenceJobDigest || ceremony.continuityVersion !== plan.continuityVersion) throw new Error('Picture Lock ceremony sequence/continuity drift detected');
  if (ceremony.shotSelectionDigest !== digestJson(plan.shotSelections)) throw new Error('Picture Lock ceremony shot selection digest drift detected');
  if (ceremony.shotCount !== plan.shotCount || Number(ceremony.totalDurationSeconds) !== Number(plan.totalDurationSeconds)) throw new Error('Picture Lock ceremony shot/duration drift detected');
  parseTime(ceremony.recordedAt, 'recordedAt');
  ensureSha256(ceremony.ceremonyDigest, 'ceremonyDigest');
  ensureSha256(ceremony.keyFingerprintSha256, 'keyFingerprintSha256');
  ensureSha256(ceremony.ceremonyHash, 'ceremonyHash');
  if (ceremony.signatureAlgorithm !== C1_10_SIGNATURE_ALGORITHM) throw new Error(`Picture Lock ceremony signatureAlgorithm must be ${C1_10_SIGNATURE_ALGORITHM}`);
  requiredString(ceremony.signatureBase64, 'signatureBase64');
  const expectedDigest = digestJson(lockPayloadDigestSource(ceremony));
  if (ceremony.ceremonyDigest !== expectedDigest) throw new Error('Picture Lock ceremony payload digest mismatch');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Picture Lock ceremony public-key fingerprint mismatch');
  const signatureValid = cryptoVerify(null, Buffer.from(lockMessage(expectedDigest, ceremony)), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'));
  if (!signatureValid) throw new Error('Picture Lock ceremony signature verification failed');
  if (ceremony.ceremonyHash !== digestJson(withoutFields(ceremony, ['ceremonyHash']))) throw new Error('Picture Lock ceremony self-hash mismatch');
  return {
    valid: true,
    ceremonyId: ceremony.ceremonyId,
    ceremonyHash: ceremony.ceremonyHash,
    planHash: ceremony.planHash,
    authorityId: ceremony.authority.id,
    pictureLocked: true,
    publicRelease: false,
  };
}

function lockedManifestHashPayload(manifest) {
  return withoutFields(manifest, ['manifestHash']);
}

export function buildLockedPictureManifest({ ceremony, plan, review, candidateRegistry, policy, keyRegistry, manifestId = null }) {
  verifyPictureLockCeremony({ ceremony, plan, review, candidateRegistry, policy, keyRegistry });
  const id = manifestId ?? `${plan.sequenceId}-locked-picture-${plan.planHash.slice(0, 12)}`;
  safeToken(id, 'manifestId');
  const manifest = {
    schema: CINESWARM_LOCKED_PICTURE_MANIFEST_SCHEMA,
    manifestId: id,
    policyId: policy.policyId,
    episodeId: plan.episodeId,
    sequenceId: plan.sequenceId,
    state: 'PICTURE_LOCKED',
    lockCeremonyId: ceremony.ceremonyId,
    lockCeremonyHash: ceremony.ceremonyHash,
    lockAuthority: structuredClone(ceremony.authority),
    lockedAt: ceremony.recordedAt,
    planId: plan.planId,
    planHash: plan.planHash,
    reviewId: review.reviewId,
    reviewHash: digestJson(review),
    candidateRegistryId: candidateRegistry.registryId,
    candidateRegistryRevision: candidateRegistry.revision,
    candidateRegistryHash: candidateRegistry.registryHash,
    sequenceJobDigest: plan.sequenceJobDigest,
    continuityVersion: plan.continuityVersion,
    shotSelectionDigest: digestJson(plan.shotSelections),
    shotCount: plan.shotCount,
    totalDurationSeconds: plan.totalDurationSeconds,
    shots: plan.shotSelections.map((shot) => ({
      shotIndex: shot.shotIndex,
      shotTitle: shot.shotTitle,
      durationSeconds: shot.durationSeconds,
      candidateAssetId: shot.candidateAssetId,
      candidateEntryHash: shot.candidateEntryHash,
      artifactSha256: shot.artifactSha256,
      requestId: shot.requestId,
      requestDigest: shot.requestDigest,
      continuityVersion: shot.continuityVersion,
    })),
    pictureLocked: true,
    immutableManifest: true,
    changesRequireExplicitUnlock: true,
    supersessionRecordedInRegister: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  manifest.manifestHash = digestJson(lockedManifestHashPayload(manifest));
  return manifest;
}

export function validateLockedPictureManifest(manifest, { ceremony = null, plan = null, review = null, candidateRegistry = null, policy = null, keyRegistry = null } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Locked Picture Manifest must be an object');
  if (manifest.schema !== CINESWARM_LOCKED_PICTURE_MANIFEST_SCHEMA) throw new Error(`unsupported Locked Picture Manifest schema: ${manifest.schema}`);
  safeToken(manifest.manifestId, 'manifestId');
  safeToken(manifest.policyId, 'policyId');
  safeToken(manifest.episodeId, 'episodeId');
  safeToken(manifest.sequenceId, 'sequenceId');
  if (manifest.state !== 'PICTURE_LOCKED' || manifest.pictureLocked !== true || manifest.immutableManifest !== true || manifest.changesRequireExplicitUnlock !== true) throw new Error('Locked Picture Manifest must remain immutable PICTURE_LOCKED state');
  safeToken(manifest.lockCeremonyId, 'lockCeremonyId');
  ensureSha256(manifest.lockCeremonyHash, 'lockCeremonyHash');
  if (manifest.lockAuthority?.kind !== 'human') throw new Error('Locked Picture Manifest requires human lock authority');
  safeToken(manifest.lockAuthority?.id, 'lockAuthority.id');
  parseTime(manifest.lockedAt, 'lockedAt');
  safeToken(manifest.planId, 'planId');
  ensureSha256(manifest.planHash, 'planHash');
  safeToken(manifest.reviewId, 'reviewId');
  ensureSha256(manifest.reviewHash, 'reviewHash');
  safeToken(manifest.candidateRegistryId, 'candidateRegistryId');
  ensureSha256(manifest.candidateRegistryHash, 'candidateRegistryHash');
  ensureSha256(manifest.sequenceJobDigest, 'sequenceJobDigest');
  safeToken(manifest.continuityVersion, 'continuityVersion');
  ensureSha256(manifest.shotSelectionDigest, 'shotSelectionDigest');
  if (!Array.isArray(manifest.shots) || manifest.shots.length !== manifest.shotCount || !manifest.shots.length) throw new Error('Locked Picture Manifest shots/shotCount mismatch');
  if (new Set(manifest.shots.map((shot) => shot.shotIndex)).size !== manifest.shots.length) throw new Error('Locked Picture Manifest contains duplicate shotIndex');
  if (new Set(manifest.shots.map((shot) => shot.artifactSha256)).size !== manifest.shots.length) throw new Error('Locked Picture Manifest contains duplicate artifact SHA-256');
  const totalDuration = manifest.shots.reduce((sum, shot) => sum + Number(shot.durationSeconds), 0);
  if (Number(manifest.totalDurationSeconds) !== totalDuration) throw new Error('Locked Picture Manifest totalDurationSeconds mismatch');
  for (const shot of manifest.shots) {
    if (!Number.isInteger(shot.shotIndex) || shot.shotIndex <= 0) throw new Error('Locked Picture Manifest shotIndex must be positive');
    requiredString(shot.shotTitle, 'Locked Picture Manifest shotTitle');
    if (!Number.isFinite(Number(shot.durationSeconds)) || Number(shot.durationSeconds) <= 0) throw new Error('Locked Picture Manifest durationSeconds must be positive');
    safeToken(shot.candidateAssetId, 'Locked Picture Manifest candidateAssetId');
    ensureSha256(shot.candidateEntryHash, 'Locked Picture Manifest candidateEntryHash');
    ensureSha256(shot.artifactSha256, 'Locked Picture Manifest artifactSha256');
    safeToken(shot.requestId, 'Locked Picture Manifest requestId');
    ensureSha256(shot.requestDigest, 'Locked Picture Manifest requestDigest');
    if (shot.continuityVersion !== manifest.continuityVersion) throw new Error('Locked Picture Manifest continuity drift detected');
  }
  if (manifest.supersessionRecordedInRegister !== false) throw new Error('immutable Locked Picture Manifest cannot mutate itself to record supersession');
  if (manifest.canonEligible !== false || manifest.ledgerPromotionEligible !== false || manifest.publicRelease !== false || manifest.relayDependency !== false) throw new Error('Locked Picture Manifest must preserve downstream authority boundaries');
  ensureSha256(manifest.manifestHash, 'manifestHash');
  if (manifest.manifestHash !== digestJson(lockedManifestHashPayload(manifest))) throw new Error('Locked Picture Manifest self-hash mismatch');

  if (policy) {
    validatePictureLockPolicy(policy);
    if (manifest.policyId !== policy.policyId || manifest.episodeId !== policy.episodeId || manifest.sequenceId !== policy.sequenceId) throw new Error('Locked Picture Manifest policy scope mismatch');
  }
  if (plan) {
    validatePicturePlanCandidate(plan, candidateRegistry ? { registry: candidateRegistry } : {});
    if (manifest.planId !== plan.planId || manifest.planHash !== plan.planHash || manifest.shotSelectionDigest !== digestJson(plan.shotSelections)) throw new Error('Locked Picture Manifest plan drift detected');
    if (digestJson(manifest.shots) !== digestJson(plan.shotSelections)) throw new Error('Locked Picture Manifest shot selection drift detected');
  }
  if (review) {
    if (!plan) throw new Error('plan is required when validating review linkage');
    validatePicturePlanReview(review, plan);
    if (manifest.reviewId !== review.reviewId || manifest.reviewHash !== digestJson(review)) throw new Error('Locked Picture Manifest review drift detected');
  }
  if (candidateRegistry) {
    validateCandidateAssetRegistry(candidateRegistry);
    if (manifest.candidateRegistryId !== candidateRegistry.registryId || manifest.candidateRegistryRevision !== candidateRegistry.revision || manifest.candidateRegistryHash !== candidateRegistry.registryHash) throw new Error('Locked Picture Manifest candidate registry drift detected');
  }
  if (ceremony) {
    if (!plan || !review || !candidateRegistry || !policy || !keyRegistry) throw new Error('full Picture Lock inputs are required to verify ceremony linkage');
    verifyPictureLockCeremony({ ceremony, plan, review, candidateRegistry, policy, keyRegistry });
    if (manifest.lockCeremonyId !== ceremony.ceremonyId || manifest.lockCeremonyHash !== ceremony.ceremonyHash || manifest.lockAuthority.id !== ceremony.authority.id || manifest.lockedAt !== ceremony.recordedAt) throw new Error('Locked Picture Manifest ceremony linkage drift detected');
  }
  return { valid: true, manifestHash: manifest.manifestHash, pictureLocked: true, publicRelease: false };
}

function transitionPayloadDigestSource(transition) {
  return withoutFields(transition, [
    'transitionDigest',
    'signatureAlgorithm',
    'signatureBase64',
    'keyFingerprintSha256',
    'transitionHash',
  ]);
}

function transitionMessage(transitionDigest, transition) {
  return [
    TRANSITION_DOMAIN,
    transition.transitionId,
    transitionDigest,
    transition.decision,
    transition.targetManifestHash,
    transition.replacementManifestHash ?? 'none',
    transition.keyId,
    transition.authority.id,
    transition.recordedAt,
  ].join('\n');
}

export function buildPictureLockTransitionPayload({
  policy,
  manifest,
  decision,
  reason,
  authorityId,
  keyId,
  recordedAt,
  replacementManifest = null,
  transitionId = null,
}) {
  validatePictureLockPolicy(policy);
  validateLockedPictureManifest(manifest, { policy });
  if (!C1_10_TRANSITION_DECISIONS.includes(decision)) throw new Error('Picture Lock transition decision must be UNLOCK_FOR_REVISION or SUPERSEDE');
  const replacementManifestHash = replacementManifest ? validateLockedPictureManifest(replacementManifest, { policy }).manifestHash : null;
  if (decision === 'UNLOCK_FOR_REVISION' && replacementManifest !== null) throw new Error('UNLOCK_FOR_REVISION must not predeclare a replacement manifest');
  if (decision === 'SUPERSEDE') {
    if (!replacementManifest) throw new Error('SUPERSEDE requires a separately locked replacement manifest');
    if (replacementManifestHash === manifest.manifestHash) throw new Error('SUPERSEDE replacement manifest must differ from target manifest');
  }
  const authority = safeToken(authorityId, 'authorityId');
  const signingKey = safeToken(keyId, 'keyId');
  const timestamp = parseTime(recordedAt, 'recordedAt').text;
  const id = transitionId ?? `${manifest.sequenceId}-${decision.toLowerCase()}-${manifest.manifestHash.slice(0, 12)}`;
  safeToken(id, 'transitionId');
  return {
    schema: CINESWARM_PICTURE_LOCK_TRANSITION_SCHEMA,
    transitionId: id,
    policyId: policy.policyId,
    episodeId: manifest.episodeId,
    sequenceId: manifest.sequenceId,
    authority: { kind: 'human', id: authority },
    simulated: false,
    keyId: signingKey,
    decision,
    reason: requiredString(reason, 'reason'),
    targetManifestId: manifest.manifestId,
    targetManifestHash: manifest.manifestHash,
    replacementManifestId: replacementManifest?.manifestId ?? null,
    replacementManifestHash,
    recordedAt: timestamp,
    pictureLockMutationAuthorized: true,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function signPictureLockTransition(payload, { privateKeyPem, keyRegistry }) {
  if (!payload || typeof payload !== 'object') throw new Error('Picture Lock transition payload must be an object');
  if (payload.schema !== CINESWARM_PICTURE_LOCK_TRANSITION_SCHEMA) throw new Error(`unsupported Picture Lock transition schema: ${payload.schema}`);
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  const transitionDigest = digestJson(transitionPayloadDigestSource(payload));
  const signatureBase64 = cryptoSign(null, Buffer.from(transitionMessage(transitionDigest, payload)), privateKeyPem).toString('base64');
  const transition = {
    ...structuredClone(payload),
    transitionDigest,
    signatureAlgorithm: C1_10_SIGNATURE_ALGORITHM,
    signatureBase64,
    keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
  };
  transition.transitionHash = digestJson(withoutFields(transition, ['transitionHash']));
  return transition;
}

export function verifyPictureLockTransition({ transition, manifest, policy, keyRegistry, replacementManifest = null }) {
  validatePictureLockPolicy(policy);
  validateLockedPictureManifest(manifest, { policy });
  if (!transition || typeof transition !== 'object') throw new Error('Picture Lock transition must be an object');
  if (transition.schema !== CINESWARM_PICTURE_LOCK_TRANSITION_SCHEMA) throw new Error(`unsupported Picture Lock transition schema: ${transition.schema}`);
  safeToken(transition.transitionId, 'transitionId');
  if (transition.authority?.kind !== 'human' || transition.simulated !== false) throw new Error('Picture Lock transition requires real human authority');
  safeToken(transition.authority?.id, 'authority.id');
  safeToken(transition.keyId, 'keyId');
  if (!C1_10_TRANSITION_DECISIONS.includes(transition.decision)) throw new Error('unsupported Picture Lock transition decision');
  requiredString(transition.reason, 'reason');
  parseTime(transition.recordedAt, 'recordedAt');
  if (transition.policyId !== policy.policyId || transition.episodeId !== manifest.episodeId || transition.sequenceId !== manifest.sequenceId) throw new Error('Picture Lock transition scope mismatch');
  if (transition.targetManifestId !== manifest.manifestId || transition.targetManifestHash !== manifest.manifestHash) throw new Error('Picture Lock transition target manifest mismatch');
  if (transition.pictureLockMutationAuthorized !== true) throw new Error('Picture Lock transition must explicitly authorize the lock-state mutation');
  if (transition.canonAuthorized !== false || transition.ledgerPromotionAuthorized !== false || transition.publicRelease !== false || transition.relayDependency !== false) throw new Error('Picture Lock transition must preserve downstream authority boundaries');
  if (transition.decision === 'UNLOCK_FOR_REVISION') {
    if (transition.replacementManifestId !== null || transition.replacementManifestHash !== null || replacementManifest !== null) throw new Error('UNLOCK_FOR_REVISION cannot include a replacement manifest');
  } else {
    if (!replacementManifest) throw new Error('SUPERSEDE requires the separately locked replacement manifest');
    validateLockedPictureManifest(replacementManifest, { policy });
    if (transition.replacementManifestId !== replacementManifest.manifestId || transition.replacementManifestHash !== replacementManifest.manifestHash) throw new Error('SUPERSEDE replacement manifest mismatch');
    if (replacementManifest.manifestHash === manifest.manifestHash) throw new Error('SUPERSEDE replacement manifest must differ from target');
  }
  ensureSha256(transition.transitionDigest, 'transitionDigest');
  ensureSha256(transition.keyFingerprintSha256, 'keyFingerprintSha256');
  ensureSha256(transition.transitionHash, 'transitionHash');
  if (transition.signatureAlgorithm !== C1_10_SIGNATURE_ALGORITHM) throw new Error(`Picture Lock transition signatureAlgorithm must be ${C1_10_SIGNATURE_ALGORITHM}`);
  requiredString(transition.signatureBase64, 'signatureBase64');
  const expectedDigest = digestJson(transitionPayloadDigestSource(transition));
  if (transition.transitionDigest !== expectedDigest) throw new Error('Picture Lock transition payload digest mismatch');
  const key = findKey(keyRegistry, transition.keyId);
  validateKeyForHistoricalSignature(key, transition.authority.id, transition.recordedAt);
  if (transition.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Picture Lock transition public-key fingerprint mismatch');
  const signatureValid = cryptoVerify(null, Buffer.from(transitionMessage(expectedDigest, transition)), key.publicKeyPem, Buffer.from(transition.signatureBase64, 'base64'));
  if (!signatureValid) throw new Error('Picture Lock transition signature verification failed');
  if (transition.transitionHash !== digestJson(withoutFields(transition, ['transitionHash']))) throw new Error('Picture Lock transition self-hash mismatch');
  return { valid: true, transitionHash: transition.transitionHash, decision: transition.decision, publicRelease: false };
}

function registerEntryHashPayload(entry) {
  return withoutFields(entry, ['entryHash']);
}

function buildRegisterEntry({ register, eventType, manifest, transition = null, replacementManifest = null, recordedAt }) {
  const entry = {
    schema: CINESWARM_PICTURE_LOCK_REGISTER_ENTRY_SCHEMA,
    entryId: `${register.sequenceId}-lock-event-${String(register.entries.length + 1).padStart(4, '0')}`,
    eventType,
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    replacementManifestId: replacementManifest?.manifestId ?? null,
    replacementManifestHash: replacementManifest?.manifestHash ?? null,
    transitionId: transition?.transitionId ?? null,
    transitionHash: transition?.transitionHash ?? null,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(registerEntryHashPayload(entry));
  return entry;
}

function classifyRegisterEntries(entries) {
  const states = new Map();
  let currentManifestHash = null;
  for (const entry of entries) {
    if (entry.eventType === 'LOCK') {
      if (currentManifestHash !== null) throw new Error('Picture Lock register cannot create a second active lock without an explicit unlock');
      states.set(entry.manifestHash, 'LOCKED');
      currentManifestHash = entry.manifestHash;
      continue;
    }
    if (entry.eventType === 'UNLOCK_FOR_REVISION') {
      if (currentManifestHash !== entry.manifestHash || states.get(entry.manifestHash) !== 'LOCKED') throw new Error('UNLOCK_FOR_REVISION must target the current active lock');
      states.set(entry.manifestHash, 'UNLOCKED_FOR_REVISION');
      currentManifestHash = null;
      continue;
    }
    if (entry.eventType === 'SUPERSEDE') {
      if (states.get(entry.manifestHash) !== 'UNLOCKED_FOR_REVISION') throw new Error('SUPERSEDE requires the target manifest to have an explicit prior unlock');
      if (!entry.replacementManifestHash || states.get(entry.replacementManifestHash) !== 'LOCKED' || currentManifestHash !== entry.replacementManifestHash) throw new Error('SUPERSEDE requires an already locked replacement manifest to be current');
      states.set(entry.manifestHash, 'SUPERSEDED');
      continue;
    }
    throw new Error(`unsupported Picture Lock register eventType: ${entry.eventType}`);
  }
  return { states, currentManifestHash };
}

function registerHashPayload(register) {
  return withoutFields(register, ['registerHash']);
}

export function buildPictureLockRegister({ policy, entries = [], revision = 0, recordedAt }) {
  validatePictureLockPolicy(policy);
  if (!Array.isArray(entries)) throw new Error('Picture Lock register entries must be an array');
  if (!Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Picture Lock register revision must equal entry count');
  parseTime(recordedAt, 'recordedAt');
  let previous = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || entry.schema !== CINESWARM_PICTURE_LOCK_REGISTER_ENTRY_SCHEMA) throw new Error('invalid Picture Lock register entry schema');
    safeToken(entry.entryId, 'entryId');
    if (!['LOCK', 'UNLOCK_FOR_REVISION', 'SUPERSEDE'].includes(entry.eventType)) throw new Error('invalid Picture Lock register eventType');
    safeToken(entry.episodeId, 'entry.episodeId');
    safeToken(entry.sequenceId, 'entry.sequenceId');
    safeToken(entry.manifestId, 'entry.manifestId');
    ensureSha256(entry.manifestHash, 'entry.manifestHash');
    if (entry.previousEntryHash !== previous) throw new Error('Picture Lock register hash-chain previousEntryHash mismatch');
    if (entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Picture Lock register entries must preserve release/Relay boundaries');
    ensureSha256(entry.entryHash, 'entry.entryHash');
    if (entry.entryHash !== digestJson(registerEntryHashPayload(entry))) throw new Error('Picture Lock register entry self-hash mismatch');
    previous = entry.entryHash;
  }
  const classification = classifyRegisterEntries(entries);
  const stateValues = [...classification.states.values()];
  const register = {
    schema: CINESWARM_PICTURE_LOCK_REGISTER_SCHEMA,
    registerId: `${policy.sequenceId}-picture-lock-register`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    recordedAt,
    status: entries.length === 0 ? 'EMPTY_NO_PICTURE_LOCKS' : classification.currentManifestHash ? 'PICTURE_LOCKED' : 'UNLOCKED_FOR_REVISION',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: entries.length ? entries.at(-1).entryHash : null,
    currentManifestHash: classification.currentManifestHash,
    lockedManifestCount: entries.filter((entry) => entry.eventType === 'LOCK').length,
    unlockEventCount: entries.filter((entry) => entry.eventType === 'UNLOCK_FOR_REVISION').length,
    supersededManifestCount: stateValues.filter((state) => state === 'SUPERSEDED').length,
    pictureLocked: classification.currentManifestHash !== null,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(registerHashPayload(register));
  return register;
}

export function validatePictureLockRegister(register, { policy = null } = {}) {
  if (!register || typeof register !== 'object') throw new Error('Picture Lock register must be an object');
  if (register.schema !== CINESWARM_PICTURE_LOCK_REGISTER_SCHEMA) throw new Error(`unsupported Picture Lock register schema: ${register.schema}`);
  safeToken(register.registerId, 'registerId');
  safeToken(register.policyId, 'policyId');
  safeToken(register.episodeId, 'episodeId');
  safeToken(register.sequenceId, 'sequenceId');
  if (!Array.isArray(register.entries) || register.entryCount !== register.entries.length || register.revision !== register.entries.length) throw new Error('Picture Lock register entries/revision mismatch');
  parseTime(register.recordedAt, 'recordedAt');
  const effectivePolicy = policy ?? {
    schema: CINESWARM_PICTURE_LOCK_POLICY_SCHEMA,
    policyId: register.policyId,
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
    signatureAlgorithm: C1_10_SIGNATURE_ALGORITHM,
    privateKeyCustody: 'external-human-controlled',
    requireApprovedC1_9PlanReview: true,
    requireExactPlanHash: true,
    requireExactReviewHash: true,
    requireExactCandidateRegistryHash: true,
    requireExactShotSelectionDigest: true,
    requireHumanSignature: true,
    requireExplicitUnlockForRevision: true,
    requireExplicitSupersession: true,
    appendOnlyLockRegister: true,
    autoPictureLock: false,
    canonAuthority: false,
    ledgerPromotionAuthority: false,
    publicRelease: false,
    relayDependency: false,
  };
  const rebuilt = buildPictureLockRegister({ policy: effectivePolicy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'currentManifestHash', 'lockedManifestCount', 'unlockEventCount', 'supersededManifestCount', 'pictureLocked']) {
    if (register[key] !== rebuilt[key]) throw new Error(`Picture Lock register ${key} mismatch`);
  }
  if (register.canonEligible !== false || register.ledgerPromotionEligible !== false || register.publicRelease !== false || register.relayDependency !== false) throw new Error('Picture Lock register must preserve downstream authority boundaries');
  ensureSha256(register.registerHash, 'registerHash');
  if (register.registerHash !== digestJson(registerHashPayload(register))) throw new Error('Picture Lock register self-hash mismatch');
  if (policy) {
    validatePictureLockPolicy(policy);
    if (register.policyId !== policy.policyId || register.episodeId !== policy.episodeId || register.sequenceId !== policy.sequenceId) throw new Error('Picture Lock register policy scope mismatch');
  }
  return { valid: true, registerHash: register.registerHash, currentManifestHash: register.currentManifestHash, pictureLocked: register.pictureLocked };
}

export function appendLockedPictureToRegister({ register, manifest, policy, recordedAt }) {
  validatePictureLockRegister(register, { policy });
  validateLockedPictureManifest(manifest, { policy });
  if (manifest.episodeId !== register.episodeId || manifest.sequenceId !== register.sequenceId) throw new Error('Locked Picture Manifest does not match register scope');
  if (register.currentManifestHash !== null) throw new Error('explicit UNLOCK_FOR_REVISION is required before another Locked Picture Manifest may become active');
  if (register.entries.some((entry) => entry.manifestHash === manifest.manifestHash && entry.eventType === 'LOCK')) throw new Error('Locked Picture Manifest is already registered');
  const entry = buildRegisterEntry({ register, eventType: 'LOCK', manifest, recordedAt });
  return buildPictureLockRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt });
}

export function appendPictureLockTransitionToRegister({ register, transition, manifest, policy, keyRegistry, replacementManifest = null, recordedAt }) {
  validatePictureLockRegister(register, { policy });
  verifyPictureLockTransition({ transition, manifest, policy, keyRegistry, replacementManifest });
  const currentStates = classifyRegisterEntries(register.entries);
  if (transition.decision === 'UNLOCK_FOR_REVISION') {
    if (currentStates.currentManifestHash !== manifest.manifestHash) throw new Error('UNLOCK_FOR_REVISION must target the current active Picture Lock');
  } else {
    if (currentStates.states.get(manifest.manifestHash) !== 'UNLOCKED_FOR_REVISION') throw new Error('SUPERSEDE target must already be explicitly unlocked for revision');
    if (!replacementManifest || currentStates.currentManifestHash !== replacementManifest.manifestHash) throw new Error('SUPERSEDE replacement must already be the current locked manifest');
  }
  const entry = buildRegisterEntry({
    register,
    eventType: transition.decision,
    manifest,
    transition,
    replacementManifest,
    recordedAt,
  });
  return buildPictureLockRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt });
}

export function classifyPictureLockRegister(register) {
  validatePictureLockRegister(register);
  return {
    state: register.status,
    revision: register.revision,
    currentManifestHash: register.currentManifestHash,
    pictureLocked: register.pictureLocked,
    lockedManifestCount: register.lockedManifestCount,
    unlockEventCount: register.unlockEventCount,
    supersededManifestCount: register.supersededManifestCount,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
    note: register.pictureLocked
      ? 'An exact Locked Picture Manifest is active. Any edit requires an explicit signed unlock/supersession path.'
      : 'No active Picture Lock exists in this register.',
  };
}
