import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import {
  validateAudioConformManifest,
  validateRenderCandidate,
} from './locked-render-audio.js';

export const CINESWARM_MASTER_REVIEW_POLICY_SCHEMA = 'parallax.cineswarm.master-review-policy.c1.12.v0.1';
export const CINESWARM_AUDIO_LOCK_CEREMONY_SCHEMA = 'parallax.cineswarm.audio-lock-ceremony.c1.12.v0.1';
export const CINESWARM_LOCKED_AUDIO_MANIFEST_SCHEMA = 'parallax.cineswarm.locked-audio-manifest.c1.12.v0.1';
export const CINESWARM_AUDIO_LOCK_TRANSITION_SCHEMA = 'parallax.cineswarm.audio-lock-transition.c1.12.v0.1';
export const CINESWARM_AUDIO_LOCK_REGISTER_ENTRY_SCHEMA = 'parallax.cineswarm.audio-lock-register-entry.c1.12.v0.1';
export const CINESWARM_AUDIO_LOCK_REGISTER_SCHEMA = 'parallax.cineswarm.audio-lock-register.c1.12.v0.1';
export const CINESWARM_MASTER_REVIEW_SCHEMA = 'parallax.cineswarm.master-review.c1.12.v0.1';
export const CINESWARM_MASTER_ACCEPTANCE_CEREMONY_SCHEMA = 'parallax.cineswarm.master-acceptance-ceremony.c1.12.v0.1';
export const CINESWARM_MASTER_CANDIDATE_SCHEMA = 'parallax.cineswarm.master-candidate.c1.12.v0.1';
export const CINESWARM_MASTER_CANDIDATE_REGISTER_SCHEMA = 'parallax.cineswarm.master-candidate-register.c1.12.v0.1';

export const C1_12_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_12_AUDIO_LOCK_DECISION = 'LOCK_EXACT_AUDIO_CONFORM';
export const C1_12_AUDIO_TRANSITION_DECISIONS = Object.freeze(['UNLOCK_FOR_REMIX', 'SUPERSEDE']);
export const C1_12_MASTER_REVIEW_DECISIONS = Object.freeze(['ACCEPT_MASTER_CANDIDATE', 'REJECT', 'HOLD', 'REVISE']);
export const C1_12_MASTER_ACCEPTANCE_DECISION = 'ACCEPT_EXACT_RENDER_AS_MASTER_CANDIDATE';

const AUDIO_LOCK_DOMAIN = 'PARALLAX-CINESWARM-C1.12-AUDIO-LOCK';
const AUDIO_TRANSITION_DOMAIN = 'PARALLAX-CINESWARM-C1.12-AUDIO-LOCK-TRANSITION';
const MASTER_ACCEPTANCE_DOMAIN = 'PARALLAX-CINESWARM-C1.12-MASTER-CANDIDATE-ACCEPTANCE';

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

function validateKeyForNewSignature(key, authorityId, recordedAt, purpose) {
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new ${purpose} signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error(`${purpose} signing key authority mismatch`);
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error(`${purpose} signing key was not valid at recordedAt`);
}

function validateKeyForHistoricalSignature(key, authorityId, recordedAt, purpose) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error(`${purpose} signing key authority mismatch`);
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error(`${purpose} signature was created outside key validity`);
}

export function validateMasterReviewPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('master review policy must be an object');
  if (policy.schema !== CINESWARM_MASTER_REVIEW_POLICY_SCHEMA) throw new Error(`unsupported master review policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  if (policy.signatureAlgorithm !== C1_12_SIGNATURE_ALGORITHM) throw new Error(`C1.12 signatureAlgorithm must remain ${C1_12_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('C1.12 private key custody must remain external-human-controlled');
  const mustTrue = [
    'requireExactRenderCandidateHash',
    'requirePassedMeasuredQc',
    'requireExactAudioConformHash',
    'requireHumanAudioLockSignature',
    'requireHumanCreativeAndTechnicalMasterReview',
    'requireMasterAcceptanceSignature',
    'requireExplicitAudioUnlockForRemix',
    'requireExplicitAudioSupersession',
    'appendOnlyAudioLockRegister',
    'appendOnlyMasterCandidateRegister',
  ];
  for (const key of mustTrue) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  const mustFalse = ['autoAudioLock', 'autoMasterAcceptance', 'canonAuthority', 'ledgerPromotionAuthority', 'publicRelease', 'relayDependency'];
  for (const key of mustFalse) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function audioLockPayloadDigestSource(ceremony) {
  return withoutFields(ceremony, ['ceremonyDigest', 'signatureAlgorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']);
}

function audioLockMessage(ceremonyDigest, ceremony) {
  return [
    AUDIO_LOCK_DOMAIN,
    ceremony.ceremonyId,
    ceremonyDigest,
    ceremony.keyId,
    ceremony.authority.id,
    ceremony.audioConformHash,
    ceremony.mixAssetSha256,
    ceremony.lockedPictureManifestHash,
    ceremony.recordedAt,
  ].join('\n');
}

export function buildAudioLockCeremonyPayload({
  policy,
  audioConformManifest,
  authorityId,
  keyId,
  recordedAt,
  ceremonyId = null,
}) {
  validateMasterReviewPolicy(policy);
  validateAudioConformManifest(audioConformManifest);
  if (audioConformManifest.episodeId !== policy.episodeId || audioConformManifest.sequenceId !== policy.sequenceId) throw new Error('Audio Lock conform manifest does not match policy scope');
  const authority = safeToken(authorityId, 'authorityId');
  const signingKey = safeToken(keyId, 'keyId');
  const timestamp = parseTime(recordedAt, 'recordedAt').text;
  const id = ceremonyId ?? `${policy.sequenceId}-audio-lock-${audioConformManifest.audioConformHash.slice(0, 12)}`;
  safeToken(id, 'ceremonyId');
  return {
    schema: CINESWARM_AUDIO_LOCK_CEREMONY_SCHEMA,
    ceremonyId: id,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    authority: { kind: 'human', id: authority },
    simulated: false,
    decision: C1_12_AUDIO_LOCK_DECISION,
    keyId: signingKey,
    audioConformManifestId: audioConformManifest.manifestId,
    audioConformHash: audioConformManifest.audioConformHash,
    lockedPictureManifestHash: audioConformManifest.lockedPictureManifestHash,
    timelineDurationSeconds: audioConformManifest.timelineDurationSeconds,
    mixAssetSha256: audioConformManifest.mixAsset.sha256,
    mixAssetSizeBytes: audioConformManifest.mixAsset.sizeBytes,
    mixMediaType: audioConformManifest.mixAsset.mediaType,
    mixDurationSeconds: audioConformManifest.mixAsset.durationSeconds,
    mixSampleRateHz: audioConformManifest.mixAsset.sampleRateHz,
    mixChannels: audioConformManifest.mixAsset.channels,
    recordedAt: timestamp,
    audioLockAuthorized: true,
    changesRequireExplicitUnlock: true,
    masterAcceptanceAuthorized: false,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function signAudioLockCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!payload || typeof payload !== 'object') throw new Error('Audio Lock ceremony payload must be an object');
  if (payload.schema !== CINESWARM_AUDIO_LOCK_CEREMONY_SCHEMA) throw new Error(`unsupported Audio Lock ceremony schema: ${payload.schema}`);
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt, 'Audio Lock');
  const ceremonyDigest = digestJson(audioLockPayloadDigestSource(payload));
  const signatureBase64 = cryptoSign(null, Buffer.from(audioLockMessage(ceremonyDigest, payload)), privateKeyPem).toString('base64');
  const ceremony = {
    ...structuredClone(payload),
    ceremonyDigest,
    signatureAlgorithm: C1_12_SIGNATURE_ALGORITHM,
    signatureBase64,
    keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
  };
  ceremony.ceremonyHash = digestJson(withoutFields(ceremony, ['ceremonyHash']));
  return ceremony;
}

export function verifyAudioLockCeremony({ ceremony, audioConformManifest, policy, keyRegistry }) {
  validateMasterReviewPolicy(policy);
  validateAudioConformManifest(audioConformManifest);
  if (!ceremony || typeof ceremony !== 'object') throw new Error('Audio Lock ceremony must be an object');
  if (ceremony.schema !== CINESWARM_AUDIO_LOCK_CEREMONY_SCHEMA) throw new Error(`unsupported Audio Lock ceremony schema: ${ceremony.schema}`);
  safeToken(ceremony.ceremonyId, 'ceremonyId');
  if (ceremony.authority?.kind !== 'human') throw new Error('Audio Lock ceremony requires human authority');
  safeToken(ceremony.authority?.id, 'authority.id');
  if (ceremony.simulated !== false) throw new Error('Audio Lock ceremony must be real, not simulated');
  if (ceremony.decision !== C1_12_AUDIO_LOCK_DECISION || ceremony.audioLockAuthorized !== true) throw new Error('Audio Lock ceremony must explicitly lock the exact audio conform');
  if (ceremony.changesRequireExplicitUnlock !== true) throw new Error('Audio Lock ceremony must require explicit unlock for changes');
  if (ceremony.masterAcceptanceAuthorized !== false || ceremony.canonAuthorized !== false || ceremony.ledgerPromotionAuthorized !== false || ceremony.publicRelease !== false || ceremony.relayDependency !== false) throw new Error('Audio Lock ceremony must preserve downstream authority boundaries');
  if (ceremony.policyId !== policy.policyId || ceremony.episodeId !== policy.episodeId || ceremony.sequenceId !== policy.sequenceId) throw new Error('Audio Lock ceremony policy scope mismatch');
  if (ceremony.audioConformManifestId !== audioConformManifest.manifestId || ceremony.audioConformHash !== audioConformManifest.audioConformHash) throw new Error('Audio Lock ceremony does not bind the exact Audio Conform manifest');
  if (ceremony.lockedPictureManifestHash !== audioConformManifest.lockedPictureManifestHash) throw new Error('Audio Lock Picture Lock lineage drift detected');
  const mix = audioConformManifest.mixAsset;
  if (
    ceremony.mixAssetSha256 !== mix.sha256 ||
    ceremony.mixAssetSizeBytes !== mix.sizeBytes ||
    ceremony.mixMediaType !== mix.mediaType ||
    Number(ceremony.mixDurationSeconds) !== Number(mix.durationSeconds) ||
    ceremony.mixSampleRateHz !== mix.sampleRateHz ||
    ceremony.mixChannels !== mix.channels ||
    Number(ceremony.timelineDurationSeconds) !== Number(audioConformManifest.timelineDurationSeconds)
  ) throw new Error('Audio Lock exact mix/timeline drift detected');
  parseTime(ceremony.recordedAt, 'recordedAt');
  ensureSha256(ceremony.ceremonyDigest, 'ceremonyDigest');
  ensureSha256(ceremony.keyFingerprintSha256, 'keyFingerprintSha256');
  ensureSha256(ceremony.ceremonyHash, 'ceremonyHash');
  if (ceremony.signatureAlgorithm !== C1_12_SIGNATURE_ALGORITHM) throw new Error(`Audio Lock signatureAlgorithm must be ${C1_12_SIGNATURE_ALGORITHM}`);
  requiredString(ceremony.signatureBase64, 'signatureBase64');
  const expectedDigest = digestJson(audioLockPayloadDigestSource(ceremony));
  if (ceremony.ceremonyDigest !== expectedDigest) throw new Error('Audio Lock ceremony payload digest mismatch');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt, 'Audio Lock');
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Audio Lock public-key fingerprint mismatch');
  const signatureValid = cryptoVerify(null, Buffer.from(audioLockMessage(expectedDigest, ceremony)), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'));
  if (!signatureValid) throw new Error('Audio Lock ceremony signature verification failed');
  if (ceremony.ceremonyHash !== digestJson(withoutFields(ceremony, ['ceremonyHash']))) throw new Error('Audio Lock ceremony self-hash mismatch');
  return { valid: true, ceremonyHash: ceremony.ceremonyHash, audioConformHash: ceremony.audioConformHash, audioLocked: true, publicRelease: false };
}

function lockedAudioManifestHashPayload(manifest) {
  return withoutFields(manifest, ['manifestHash']);
}

export function buildLockedAudioManifest({ ceremony, audioConformManifest, policy, keyRegistry, manifestId = null }) {
  verifyAudioLockCeremony({ ceremony, audioConformManifest, policy, keyRegistry });
  const id = manifestId ?? `${policy.sequenceId}-locked-audio-${audioConformManifest.audioConformHash.slice(0, 12)}`;
  const manifest = {
    schema: CINESWARM_LOCKED_AUDIO_MANIFEST_SCHEMA,
    manifestId: safeToken(id, 'manifestId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    state: 'AUDIO_LOCKED',
    audioLockCeremonyId: ceremony.ceremonyId,
    audioLockCeremonyHash: ceremony.ceremonyHash,
    lockAuthority: structuredClone(ceremony.authority),
    lockedAt: ceremony.recordedAt,
    audioConformManifestId: audioConformManifest.manifestId,
    audioConformHash: audioConformManifest.audioConformHash,
    lockedPictureManifestHash: audioConformManifest.lockedPictureManifestHash,
    timelineDurationSeconds: audioConformManifest.timelineDurationSeconds,
    mixAsset: structuredClone(audioConformManifest.mixAsset),
    audioLocked: true,
    immutableManifest: true,
    changesRequireExplicitUnlock: true,
    supersessionRecordedInRegister: false,
    masterAccepted: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  manifest.manifestHash = digestJson(lockedAudioManifestHashPayload(manifest));
  return manifest;
}

export function validateLockedAudioManifest(manifest, { ceremony = null, audioConformManifest = null, policy = null, keyRegistry = null } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Locked Audio Manifest must be an object');
  if (manifest.schema !== CINESWARM_LOCKED_AUDIO_MANIFEST_SCHEMA) throw new Error(`unsupported Locked Audio Manifest schema: ${manifest.schema}`);
  safeToken(manifest.manifestId, 'manifestId');
  safeToken(manifest.policyId, 'policyId');
  safeToken(manifest.episodeId, 'episodeId');
  safeToken(manifest.sequenceId, 'sequenceId');
  if (manifest.state !== 'AUDIO_LOCKED' || manifest.audioLocked !== true || manifest.immutableManifest !== true || manifest.changesRequireExplicitUnlock !== true) throw new Error('Locked Audio Manifest must remain immutable AUDIO_LOCKED state');
  safeToken(manifest.audioLockCeremonyId, 'audioLockCeremonyId');
  ensureSha256(manifest.audioLockCeremonyHash, 'audioLockCeremonyHash');
  if (manifest.lockAuthority?.kind !== 'human') throw new Error('Locked Audio Manifest requires human lock authority');
  safeToken(manifest.lockAuthority?.id, 'lockAuthority.id');
  parseTime(manifest.lockedAt, 'lockedAt');
  safeToken(manifest.audioConformManifestId, 'audioConformManifestId');
  ensureSha256(manifest.audioConformHash, 'audioConformHash');
  ensureSha256(manifest.lockedPictureManifestHash, 'lockedPictureManifestHash');
  if (!manifest.mixAsset || typeof manifest.mixAsset !== 'object') throw new Error('Locked Audio Manifest mixAsset must be an object');
  ensureSha256(manifest.mixAsset.sha256, 'mixAsset.sha256');
  if (!Number.isInteger(manifest.mixAsset.sizeBytes) || manifest.mixAsset.sizeBytes < 0) throw new Error('mixAsset.sizeBytes must be a non-negative integer');
  requiredString(manifest.mixAsset.mediaType, 'mixAsset.mediaType');
  if (Number(manifest.mixAsset.durationSeconds) !== Number(manifest.timelineDurationSeconds)) throw new Error('Locked Audio Manifest mix/timeline duration drift detected');
  if (manifest.mixAsset.sampleRateHz !== 48000 || manifest.mixAsset.channels !== 2) throw new Error('Locked Audio Manifest must preserve 48 kHz stereo mix');
  if (manifest.supersessionRecordedInRegister !== false) throw new Error('immutable Locked Audio Manifest cannot mutate itself to record supersession');
  if (manifest.masterAccepted !== false || manifest.canonEligible !== false || manifest.ledgerPromotionEligible !== false || manifest.publicRelease !== false || manifest.relayDependency !== false) throw new Error('Locked Audio Manifest violates downstream authority boundaries');
  ensureSha256(manifest.manifestHash, 'manifestHash');
  if (manifest.manifestHash !== digestJson(lockedAudioManifestHashPayload(manifest))) throw new Error('Locked Audio Manifest self-hash mismatch');
  if (policy) {
    validateMasterReviewPolicy(policy);
    if (manifest.policyId !== policy.policyId || manifest.episodeId !== policy.episodeId || manifest.sequenceId !== policy.sequenceId) throw new Error('Locked Audio Manifest policy scope mismatch');
  }
  if (audioConformManifest) {
    validateAudioConformManifest(audioConformManifest);
    if (manifest.audioConformManifestId !== audioConformManifest.manifestId || manifest.audioConformHash !== audioConformManifest.audioConformHash || manifest.lockedPictureManifestHash !== audioConformManifest.lockedPictureManifestHash || digestJson(manifest.mixAsset) !== digestJson(audioConformManifest.mixAsset)) throw new Error('Locked Audio Manifest audio conform drift detected');
  }
  if (ceremony) {
    if (!audioConformManifest || !policy || !keyRegistry) throw new Error('audioConformManifest, policy, and keyRegistry are required when validating Audio Lock ceremony linkage');
    verifyAudioLockCeremony({ ceremony, audioConformManifest, policy, keyRegistry });
    if (manifest.audioLockCeremonyId !== ceremony.ceremonyId || manifest.audioLockCeremonyHash !== ceremony.ceremonyHash) throw new Error('Locked Audio Manifest ceremony linkage drift detected');
  }
  return { valid: true, manifestHash: manifest.manifestHash, audioLocked: true, publicRelease: false };
}

function audioTransitionPayloadDigestSource(transition) {
  return withoutFields(transition, ['transitionDigest', 'signatureAlgorithm', 'signatureBase64', 'keyFingerprintSha256', 'transitionHash']);
}

function audioTransitionMessage(digest, transition) {
  return [
    AUDIO_TRANSITION_DOMAIN,
    transition.transitionId,
    digest,
    transition.keyId,
    transition.authority.id,
    transition.decision,
    transition.manifestHash,
    transition.replacementManifestHash ?? '',
    transition.recordedAt,
  ].join('\n');
}

export function buildAudioLockTransitionPayload({ policy, manifest, decision, authorityId, keyId, recordedAt, reason, replacementManifest = null, transitionId = null }) {
  validateMasterReviewPolicy(policy);
  validateLockedAudioManifest(manifest, { policy });
  if (!C1_12_AUDIO_TRANSITION_DECISIONS.includes(decision)) throw new Error(`unsupported Audio Lock transition decision: ${decision}`);
  if (decision === 'SUPERSEDE') {
    if (!replacementManifest) throw new Error('SUPERSEDE requires a replacement Locked Audio Manifest');
    validateLockedAudioManifest(replacementManifest, { policy });
    if (replacementManifest.manifestHash === manifest.manifestHash) throw new Error('SUPERSEDE replacement must differ from old manifest');
  }
  if (decision === 'UNLOCK_FOR_REMIX' && replacementManifest) throw new Error('UNLOCK_FOR_REMIX must not include a replacement manifest');
  const id = transitionId ?? `${policy.sequenceId}-audio-${decision.toLowerCase()}-${manifest.manifestHash.slice(0, 10)}`;
  return {
    schema: CINESWARM_AUDIO_LOCK_TRANSITION_SCHEMA,
    transitionId: safeToken(id, 'transitionId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    keyId: safeToken(keyId, 'keyId'),
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    replacementManifestId: replacementManifest?.manifestId ?? null,
    replacementManifestHash: replacementManifest?.manifestHash ?? null,
    reason: requiredString(reason, 'reason'),
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    audioLockStillActive: decision === 'SUPERSEDE',
    masterAcceptanceAuthorized: false,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function signAudioLockTransition(payload, { privateKeyPem, keyRegistry }) {
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt, 'Audio Lock transition');
  const transitionDigest = digestJson(audioTransitionPayloadDigestSource(payload));
  const signatureBase64 = cryptoSign(null, Buffer.from(audioTransitionMessage(transitionDigest, payload)), privateKeyPem).toString('base64');
  const transition = { ...structuredClone(payload), transitionDigest, signatureAlgorithm: C1_12_SIGNATURE_ALGORITHM, signatureBase64, keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem) };
  transition.transitionHash = digestJson(withoutFields(transition, ['transitionHash']));
  return transition;
}

export function verifyAudioLockTransition({ transition, manifest, policy, keyRegistry, replacementManifest = null }) {
  validateMasterReviewPolicy(policy);
  validateLockedAudioManifest(manifest, { policy });
  if (!transition || transition.schema !== CINESWARM_AUDIO_LOCK_TRANSITION_SCHEMA) throw new Error('invalid Audio Lock transition schema');
  if (transition.authority?.kind !== 'human' || transition.simulated !== false) throw new Error('Audio Lock transition requires a real human authority');
  if (!C1_12_AUDIO_TRANSITION_DECISIONS.includes(transition.decision)) throw new Error('unsupported Audio Lock transition decision');
  if (transition.policyId !== policy.policyId || transition.episodeId !== policy.episodeId || transition.sequenceId !== policy.sequenceId) throw new Error('Audio Lock transition policy scope mismatch');
  if (transition.manifestId !== manifest.manifestId || transition.manifestHash !== manifest.manifestHash) throw new Error('Audio Lock transition manifest drift detected');
  if (transition.decision === 'SUPERSEDE') {
    if (!replacementManifest) throw new Error('SUPERSEDE verification requires replacement manifest');
    validateLockedAudioManifest(replacementManifest, { policy });
    if (transition.replacementManifestId !== replacementManifest.manifestId || transition.replacementManifestHash !== replacementManifest.manifestHash) throw new Error('Audio Lock replacement manifest drift detected');
  } else if (transition.replacementManifestId !== null || transition.replacementManifestHash !== null) throw new Error('UNLOCK_FOR_REMIX cannot name a replacement manifest');
  if (transition.masterAcceptanceAuthorized !== false || transition.canonAuthorized !== false || transition.ledgerPromotionAuthorized !== false || transition.publicRelease !== false || transition.relayDependency !== false) throw new Error('Audio Lock transition violates downstream authority boundaries');
  const expectedDigest = digestJson(audioTransitionPayloadDigestSource(transition));
  if (transition.transitionDigest !== expectedDigest) throw new Error('Audio Lock transition payload digest mismatch');
  const key = findKey(keyRegistry, transition.keyId);
  validateKeyForHistoricalSignature(key, transition.authority.id, transition.recordedAt, 'Audio Lock transition');
  if (transition.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Audio Lock transition public-key fingerprint mismatch');
  if (!cryptoVerify(null, Buffer.from(audioTransitionMessage(expectedDigest, transition)), key.publicKeyPem, Buffer.from(transition.signatureBase64, 'base64'))) throw new Error('Audio Lock transition signature verification failed');
  if (transition.transitionHash !== digestJson(withoutFields(transition, ['transitionHash']))) throw new Error('Audio Lock transition self-hash mismatch');
  return { valid: true, decision: transition.decision, transitionHash: transition.transitionHash, publicRelease: false };
}

function audioRegisterEntryHashPayload(entry) { return withoutFields(entry, ['entryHash']); }
function audioRegisterHashPayload(register) { return withoutFields(register, ['registerHash']); }

export function buildAudioLockRegister({ policy, entries = [], revision = 0, recordedAt }) {
  validateMasterReviewPolicy(policy);
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Audio Lock register revision must equal entry count');
  parseTime(recordedAt, 'recordedAt');
  let previous = null;
  let currentManifestHash = null;
  let status = 'EMPTY_NO_AUDIO_LOCK';
  let lockedManifestCount = 0;
  let unlockEventCount = 0;
  let supersededManifestCount = 0;
  const seenLocked = new Set();
  for (const entry of entries) {
    if (entry.schema !== CINESWARM_AUDIO_LOCK_REGISTER_ENTRY_SCHEMA) throw new Error('invalid Audio Lock register entry schema');
    safeToken(entry.entryId, 'entryId');
    if (!['LOCK', 'UNLOCK_FOR_REMIX', 'SUPERSEDE'].includes(entry.eventType)) throw new Error('invalid Audio Lock register eventType');
    if (entry.previousEntryHash !== previous) throw new Error('Audio Lock register previousEntryHash mismatch');
    if (entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Audio Lock register entry violates authority boundaries');
    ensureSha256(entry.entryHash, 'entryHash');
    if (entry.entryHash !== digestJson(audioRegisterEntryHashPayload(entry))) throw new Error('Audio Lock register entry self-hash mismatch');
    if (entry.eventType === 'LOCK') {
      ensureSha256(entry.manifestHash, 'manifestHash');
      if (currentManifestHash !== null) throw new Error('cannot append LOCK while an Audio Lock is already active; unlock first');
      if (seenLocked.has(entry.manifestHash)) throw new Error('Audio Lock register cannot lock the same manifest twice');
      seenLocked.add(entry.manifestHash);
      currentManifestHash = entry.manifestHash;
      status = 'AUDIO_LOCKED';
      lockedManifestCount += 1;
    } else if (entry.eventType === 'UNLOCK_FOR_REMIX') {
      if (currentManifestHash === null || entry.manifestHash !== currentManifestHash) throw new Error('UNLOCK_FOR_REMIX must target the active Audio Lock');
      currentManifestHash = null;
      status = 'UNLOCKED_FOR_REMIX';
      unlockEventCount += 1;
    } else if (entry.eventType === 'SUPERSEDE') {
      ensureSha256(entry.manifestHash, 'manifestHash');
      ensureSha256(entry.replacementManifestHash, 'replacementManifestHash');
      if (currentManifestHash !== entry.replacementManifestHash) throw new Error('SUPERSEDE requires the replacement manifest to be the active Audio Lock');
      supersededManifestCount += 1;
      status = 'AUDIO_LOCKED';
    }
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_AUDIO_LOCK_REGISTER_SCHEMA,
    registerId: `${policy.sequenceId}-audio-lock-register`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    recordedAt,
    status,
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: entries.length ? entries.at(-1).entryHash : null,
    currentManifestHash,
    lockedManifestCount,
    unlockEventCount,
    supersededManifestCount,
    audioLocked: currentManifestHash !== null,
    masterAcceptedCount: 0,
    canonEligibleCount: 0,
    ledgerPromotionEligibleCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(audioRegisterHashPayload(register));
  return register;
}

export function validateAudioLockRegister(register, { policy = null } = {}) {
  if (!register || register.schema !== CINESWARM_AUDIO_LOCK_REGISTER_SCHEMA) throw new Error('invalid Audio Lock register schema');
  const effectivePolicy = policy ?? {
    schema: CINESWARM_MASTER_REVIEW_POLICY_SCHEMA,
    policyId: register.policyId,
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
    signatureAlgorithm: C1_12_SIGNATURE_ALGORITHM,
    privateKeyCustody: 'external-human-controlled',
    requireExactRenderCandidateHash: true,
    requirePassedMeasuredQc: true,
    requireExactAudioConformHash: true,
    requireHumanAudioLockSignature: true,
    requireHumanCreativeAndTechnicalMasterReview: true,
    requireMasterAcceptanceSignature: true,
    requireExplicitAudioUnlockForRemix: true,
    requireExplicitAudioSupersession: true,
    appendOnlyAudioLockRegister: true,
    appendOnlyMasterCandidateRegister: true,
    autoAudioLock: false,
    autoMasterAcceptance: false,
    canonAuthority: false,
    ledgerPromotionAuthority: false,
    publicRelease: false,
    relayDependency: false,
  };
  const rebuilt = buildAudioLockRegister({ policy: effectivePolicy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'currentManifestHash', 'lockedManifestCount', 'unlockEventCount', 'supersededManifestCount', 'audioLocked']) if (register[key] !== rebuilt[key]) throw new Error(`Audio Lock register ${key} mismatch`);
  if (register.masterAcceptedCount !== 0 || register.canonEligibleCount !== 0 || register.ledgerPromotionEligibleCount !== 0 || register.publicRelease !== false || register.relayDependency !== false) throw new Error('Audio Lock register violates downstream authority boundaries');
  if (register.registerHash !== digestJson(audioRegisterHashPayload(register))) throw new Error('Audio Lock register self-hash mismatch');
  if (policy) {
    validateMasterReviewPolicy(policy);
    if (register.policyId !== policy.policyId || register.episodeId !== policy.episodeId || register.sequenceId !== policy.sequenceId) throw new Error('Audio Lock register policy scope mismatch');
  }
  return { valid: true, audioLocked: register.audioLocked, currentManifestHash: register.currentManifestHash, revision: register.revision };
}

export function appendLockedAudioToRegister({ register, manifest, policy, recordedAt }) {
  validateAudioLockRegister(register, { policy });
  validateLockedAudioManifest(manifest, { policy });
  if (register.currentManifestHash !== null) throw new Error('cannot append a new Audio Lock while another is active; unlock first');
  const entry = {
    schema: CINESWARM_AUDIO_LOCK_REGISTER_ENTRY_SCHEMA,
    entryId: `${policy.sequenceId}-audio-lock-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'LOCK',
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    replacementManifestId: null,
    replacementManifestHash: null,
    transitionId: null,
    transitionHash: null,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(audioRegisterEntryHashPayload(entry));
  return buildAudioLockRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

export function appendAudioLockTransitionToRegister({ register, transition, manifest, policy, keyRegistry, replacementManifest = null, recordedAt }) {
  validateAudioLockRegister(register, { policy });
  verifyAudioLockTransition({ transition, manifest, policy, keyRegistry, replacementManifest });
  if (transition.decision === 'UNLOCK_FOR_REMIX') {
    if (register.currentManifestHash !== manifest.manifestHash) throw new Error('UNLOCK_FOR_REMIX must target the current active Audio Lock');
  } else {
    if (register.currentManifestHash !== replacementManifest.manifestHash) throw new Error('SUPERSEDE can be recorded only after the replacement manifest is already the active Audio Lock');
  }
  const entry = {
    schema: CINESWARM_AUDIO_LOCK_REGISTER_ENTRY_SCHEMA,
    entryId: `${policy.sequenceId}-audio-lock-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: transition.decision,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    replacementManifestId: replacementManifest?.manifestId ?? null,
    replacementManifestHash: replacementManifest?.manifestHash ?? null,
    transitionId: transition.transitionId,
    transitionHash: transition.transitionHash,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(audioRegisterEntryHashPayload(entry));
  return buildAudioLockRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

export function classifyAudioLockRegister(register) {
  validateAudioLockRegister(register);
  return {
    status: register.status,
    audioLocked: register.audioLocked,
    currentManifestHash: register.currentManifestHash,
    revision: register.revision,
    publicRelease: false,
  };
}

function masterReviewHashPayload(review) { return withoutFields(review, ['reviewHash']); }

export function buildMasterReview({ policy, renderCandidate, lockedAudioManifest, audioLockRegister, authorityId, decision, creativeApproved, technicalApproved, recordedAt, notes, reviewId = null }) {
  validateMasterReviewPolicy(policy);
  validateRenderCandidate(renderCandidate);
  validateLockedAudioManifest(lockedAudioManifest, { policy });
  validateAudioLockRegister(audioLockRegister, { policy });
  if (renderCandidate.episodeId !== policy.episodeId || renderCandidate.sequenceId !== policy.sequenceId) throw new Error('Master Review Render Candidate scope mismatch');
  if (audioLockRegister.currentManifestHash !== lockedAudioManifest.manifestHash || audioLockRegister.audioLocked !== true) throw new Error('Master Review requires the exact active Audio Lock');
  if (renderCandidate.audioConformHash !== lockedAudioManifest.audioConformHash) throw new Error('Master Review Render Candidate / Audio Lock lineage mismatch');
  if (renderCandidate.lockedPictureManifestHash !== lockedAudioManifest.lockedPictureManifestHash) throw new Error('Master Review Picture Lock lineage mismatch');
  if (!C1_12_MASTER_REVIEW_DECISIONS.includes(decision)) throw new Error('unsupported Master Review decision');
  if (typeof creativeApproved !== 'boolean' || typeof technicalApproved !== 'boolean') throw new Error('Master Review creativeApproved and technicalApproved must be booleans');
  if (decision === 'ACCEPT_MASTER_CANDIDATE' && (!creativeApproved || !technicalApproved)) throw new Error('Master acceptance review requires both creative and technical approval');
  const id = reviewId ?? `${policy.sequenceId}-master-review-${renderCandidate.renderCandidateHash.slice(0, 12)}`;
  const review = {
    schema: CINESWARM_MASTER_REVIEW_SCHEMA,
    reviewId: safeToken(id, 'reviewId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    creativeApproved,
    technicalApproved,
    renderCandidateId: renderCandidate.candidateId,
    renderCandidateHash: renderCandidate.renderCandidateHash,
    outputSha256: renderCandidate.outputAsset.sha256,
    qcHash: renderCandidate.qcHash,
    renderContractHash: renderCandidate.renderContractHash,
    lockedPictureManifestHash: renderCandidate.lockedPictureManifestHash,
    audioConformHash: renderCandidate.audioConformHash,
    lockedAudioManifestId: lockedAudioManifest.manifestId,
    lockedAudioManifestHash: lockedAudioManifest.manifestHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    notes: requiredString(notes, 'notes'),
    masterAcceptanceCeremonyRequired: true,
    masterAccepted: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  review.reviewHash = digestJson(masterReviewHashPayload(review));
  return review;
}

export function validateMasterReview(review, { policy, renderCandidate, lockedAudioManifest, audioLockRegister }) {
  validateMasterReviewPolicy(policy);
  validateRenderCandidate(renderCandidate);
  validateLockedAudioManifest(lockedAudioManifest, { policy });
  validateAudioLockRegister(audioLockRegister, { policy });
  if (!review || review.schema !== CINESWARM_MASTER_REVIEW_SCHEMA) throw new Error('invalid Master Review schema');
  if (review.authority?.kind !== 'human' || review.simulated !== false) throw new Error('Master Review requires a real human authority');
  if (!C1_12_MASTER_REVIEW_DECISIONS.includes(review.decision)) throw new Error('unsupported Master Review decision');
  if (review.policyId !== policy.policyId || review.episodeId !== policy.episodeId || review.sequenceId !== policy.sequenceId) throw new Error('Master Review policy scope mismatch');
  if (review.renderCandidateId !== renderCandidate.candidateId || review.renderCandidateHash !== renderCandidate.renderCandidateHash || review.outputSha256 !== renderCandidate.outputAsset.sha256 || review.qcHash !== renderCandidate.qcHash || review.renderContractHash !== renderCandidate.renderContractHash || review.lockedPictureManifestHash !== renderCandidate.lockedPictureManifestHash || review.audioConformHash !== renderCandidate.audioConformHash) throw new Error('Master Review Render Candidate lineage drift detected');
  if (review.lockedAudioManifestId !== lockedAudioManifest.manifestId || review.lockedAudioManifestHash !== lockedAudioManifest.manifestHash || audioLockRegister.currentManifestHash !== lockedAudioManifest.manifestHash || !audioLockRegister.audioLocked) throw new Error('Master Review Audio Lock lineage drift detected');
  if (review.decision === 'ACCEPT_MASTER_CANDIDATE' && (review.creativeApproved !== true || review.technicalApproved !== true)) throw new Error('Master acceptance review requires creative + technical approval');
  if (review.masterAcceptanceCeremonyRequired !== true || review.masterAccepted !== false || review.canonEligible !== false || review.ledgerPromotionEligible !== false || review.publicRelease !== false || review.relayDependency !== false) throw new Error('Master Review violates authority boundaries');
  parseTime(review.recordedAt, 'recordedAt');
  requiredString(review.notes, 'notes');
  ensureSha256(review.reviewHash, 'reviewHash');
  if (review.reviewHash !== digestJson(masterReviewHashPayload(review))) throw new Error('Master Review self-hash mismatch');
  return { valid: true, acceptedForMasterCeremony: review.decision === 'ACCEPT_MASTER_CANDIDATE', reviewHash: review.reviewHash, publicRelease: false };
}

function masterAcceptancePayloadDigestSource(ceremony) {
  return withoutFields(ceremony, ['ceremonyDigest', 'signatureAlgorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']);
}

function masterAcceptanceMessage(digest, ceremony) {
  return [
    MASTER_ACCEPTANCE_DOMAIN,
    ceremony.ceremonyId,
    digest,
    ceremony.keyId,
    ceremony.authority.id,
    ceremony.renderCandidateHash,
    ceremony.masterReviewHash,
    ceremony.lockedAudioManifestHash,
    ceremony.outputSha256,
    ceremony.recordedAt,
  ].join('\n');
}

export function buildMasterAcceptanceCeremonyPayload({ policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, authorityId, keyId, recordedAt, ceremonyId = null }) {
  const review = validateMasterReview(masterReview, { policy, renderCandidate, lockedAudioManifest, audioLockRegister });
  if (!review.acceptedForMasterCeremony) throw new Error('Master Acceptance Ceremony requires ACCEPT_MASTER_CANDIDATE review');
  const id = ceremonyId ?? `${policy.sequenceId}-master-acceptance-${renderCandidate.renderCandidateHash.slice(0, 12)}`;
  return {
    schema: CINESWARM_MASTER_ACCEPTANCE_CEREMONY_SCHEMA,
    ceremonyId: safeToken(id, 'ceremonyId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision: C1_12_MASTER_ACCEPTANCE_DECISION,
    keyId: safeToken(keyId, 'keyId'),
    renderCandidateId: renderCandidate.candidateId,
    renderCandidateHash: renderCandidate.renderCandidateHash,
    outputSha256: renderCandidate.outputAsset.sha256,
    qcHash: renderCandidate.qcHash,
    renderContractHash: renderCandidate.renderContractHash,
    lockedPictureManifestHash: renderCandidate.lockedPictureManifestHash,
    audioConformHash: renderCandidate.audioConformHash,
    lockedAudioManifestId: lockedAudioManifest.manifestId,
    lockedAudioManifestHash: lockedAudioManifest.manifestHash,
    masterReviewId: masterReview.reviewId,
    masterReviewHash: masterReview.reviewHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    masterCandidateAcceptanceAuthorized: true,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function signMasterAcceptanceCeremony(payload, { privateKeyPem, keyRegistry }) {
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt, 'Master Acceptance');
  const ceremonyDigest = digestJson(masterAcceptancePayloadDigestSource(payload));
  const signatureBase64 = cryptoSign(null, Buffer.from(masterAcceptanceMessage(ceremonyDigest, payload)), privateKeyPem).toString('base64');
  const ceremony = { ...structuredClone(payload), ceremonyDigest, signatureAlgorithm: C1_12_SIGNATURE_ALGORITHM, signatureBase64, keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem) };
  ceremony.ceremonyHash = digestJson(withoutFields(ceremony, ['ceremonyHash']));
  return ceremony;
}

export function verifyMasterAcceptanceCeremony({ ceremony, policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, keyRegistry }) {
  const review = validateMasterReview(masterReview, { policy, renderCandidate, lockedAudioManifest, audioLockRegister });
  if (!review.acceptedForMasterCeremony) throw new Error('Master Acceptance requires an accepted Master Review');
  if (!ceremony || ceremony.schema !== CINESWARM_MASTER_ACCEPTANCE_CEREMONY_SCHEMA) throw new Error('invalid Master Acceptance Ceremony schema');
  if (ceremony.authority?.kind !== 'human' || ceremony.simulated !== false) throw new Error('Master Acceptance Ceremony requires a real human authority');
  if (ceremony.decision !== C1_12_MASTER_ACCEPTANCE_DECISION || ceremony.masterCandidateAcceptanceAuthorized !== true) throw new Error('Master Acceptance Ceremony must explicitly accept the exact Render Candidate');
  if (ceremony.policyId !== policy.policyId || ceremony.episodeId !== policy.episodeId || ceremony.sequenceId !== policy.sequenceId) throw new Error('Master Acceptance policy scope mismatch');
  if (ceremony.renderCandidateId !== renderCandidate.candidateId || ceremony.renderCandidateHash !== renderCandidate.renderCandidateHash || ceremony.outputSha256 !== renderCandidate.outputAsset.sha256 || ceremony.qcHash !== renderCandidate.qcHash || ceremony.renderContractHash !== renderCandidate.renderContractHash || ceremony.lockedPictureManifestHash !== renderCandidate.lockedPictureManifestHash || ceremony.audioConformHash !== renderCandidate.audioConformHash) throw new Error('Master Acceptance Render Candidate drift detected');
  if (ceremony.lockedAudioManifestId !== lockedAudioManifest.manifestId || ceremony.lockedAudioManifestHash !== lockedAudioManifest.manifestHash || audioLockRegister.currentManifestHash !== lockedAudioManifest.manifestHash || !audioLockRegister.audioLocked) throw new Error('Master Acceptance Audio Lock drift detected');
  if (ceremony.masterReviewId !== masterReview.reviewId || ceremony.masterReviewHash !== masterReview.reviewHash) throw new Error('Master Acceptance review drift detected');
  if (ceremony.canonAuthorized !== false || ceremony.ledgerPromotionAuthorized !== false || ceremony.publicRelease !== false || ceremony.relayDependency !== false) throw new Error('Master Acceptance Ceremony violates downstream authority boundaries');
  const expectedDigest = digestJson(masterAcceptancePayloadDigestSource(ceremony));
  if (ceremony.ceremonyDigest !== expectedDigest) throw new Error('Master Acceptance ceremony payload digest mismatch');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt, 'Master Acceptance');
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Master Acceptance public-key fingerprint mismatch');
  if (!cryptoVerify(null, Buffer.from(masterAcceptanceMessage(expectedDigest, ceremony)), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'))) throw new Error('Master Acceptance ceremony signature verification failed');
  if (ceremony.ceremonyHash !== digestJson(withoutFields(ceremony, ['ceremonyHash']))) throw new Error('Master Acceptance ceremony self-hash mismatch');
  return { valid: true, ceremonyHash: ceremony.ceremonyHash, masterCandidateAccepted: true, publicRelease: false };
}

function masterCandidateHashPayload(candidate) { return withoutFields(candidate, ['masterCandidateHash']); }

export function buildMasterCandidate({ policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, acceptanceCeremony, keyRegistry, createdAt, candidateId = null }) {
  verifyMasterAcceptanceCeremony({ ceremony: acceptanceCeremony, policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, keyRegistry });
  const id = candidateId ?? `${policy.sequenceId}-master-candidate-${renderCandidate.outputAsset.sha256.slice(0, 12)}`;
  const candidate = {
    schema: CINESWARM_MASTER_CANDIDATE_SCHEMA,
    masterCandidateId: safeToken(id, 'masterCandidateId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    state: 'MASTER_CANDIDATE',
    sourceRenderCandidateId: renderCandidate.candidateId,
    sourceRenderCandidateHash: renderCandidate.renderCandidateHash,
    outputAsset: structuredClone(renderCandidate.outputAsset),
    qcHash: renderCandidate.qcHash,
    renderContractHash: renderCandidate.renderContractHash,
    lockedPictureManifestHash: renderCandidate.lockedPictureManifestHash,
    audioConformHash: renderCandidate.audioConformHash,
    lockedAudioManifestId: lockedAudioManifest.manifestId,
    lockedAudioManifestHash: lockedAudioManifest.manifestHash,
    masterReviewId: masterReview.reviewId,
    masterReviewHash: masterReview.reviewHash,
    masterAcceptanceCeremonyId: acceptanceCeremony.ceremonyId,
    masterAcceptanceCeremonyHash: acceptanceCeremony.ceremonyHash,
    acceptedBy: structuredClone(acceptanceCeremony.authority),
    acceptedAt: acceptanceCeremony.recordedAt,
    createdAt: parseTime(createdAt, 'createdAt').text,
    pictureLocked: true,
    audioLocked: true,
    measuredQcPassed: true,
    masterAccepted: true,
    masterCandidateAccepted: true,
    canonPromotionRequired: true,
    ledgerAdmissionRequired: true,
    networkReleaseRequired: true,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  candidate.masterCandidateHash = digestJson(masterCandidateHashPayload(candidate));
  return candidate;
}

export function validateMasterCandidate(candidate, { policy, renderCandidate = null, masterReview = null, lockedAudioManifest = null, audioLockRegister = null, acceptanceCeremony = null, keyRegistry = null } = {}) {
  validateMasterReviewPolicy(policy);
  if (!candidate || candidate.schema !== CINESWARM_MASTER_CANDIDATE_SCHEMA) throw new Error('invalid Master Candidate schema');
  safeToken(candidate.masterCandidateId, 'masterCandidateId');
  if (candidate.state !== 'MASTER_CANDIDATE' || candidate.pictureLocked !== true || candidate.audioLocked !== true || candidate.measuredQcPassed !== true || candidate.masterAccepted !== true || candidate.masterCandidateAccepted !== true) throw new Error('Master Candidate state/lock/QC invariants violated');
  if (candidate.canonPromotionRequired !== true || candidate.ledgerAdmissionRequired !== true || candidate.networkReleaseRequired !== true || candidate.canonEligible !== false || candidate.ledgerPromotionEligible !== false || candidate.publicRelease !== false || candidate.relayDependency !== false) throw new Error('Master Candidate violates downstream authority boundaries');
  for (const [value, label] of [
    [candidate.sourceRenderCandidateHash, 'sourceRenderCandidateHash'],
    [candidate.outputAsset?.sha256, 'outputAsset.sha256'],
    [candidate.qcHash, 'qcHash'],
    [candidate.renderContractHash, 'renderContractHash'],
    [candidate.lockedPictureManifestHash, 'lockedPictureManifestHash'],
    [candidate.audioConformHash, 'audioConformHash'],
    [candidate.lockedAudioManifestHash, 'lockedAudioManifestHash'],
    [candidate.masterReviewHash, 'masterReviewHash'],
    [candidate.masterAcceptanceCeremonyHash, 'masterAcceptanceCeremonyHash'],
    [candidate.masterCandidateHash, 'masterCandidateHash'],
  ]) ensureSha256(value, label);
  parseTime(candidate.acceptedAt, 'acceptedAt');
  parseTime(candidate.createdAt, 'createdAt');
  if (candidate.masterCandidateHash !== digestJson(masterCandidateHashPayload(candidate))) throw new Error('Master Candidate self-hash mismatch');
  if (candidate.policyId !== policy.policyId || candidate.episodeId !== policy.episodeId || candidate.sequenceId !== policy.sequenceId) throw new Error('Master Candidate policy scope mismatch');
  if (renderCandidate) {
    validateRenderCandidate(renderCandidate);
    if (candidate.sourceRenderCandidateId !== renderCandidate.candidateId || candidate.sourceRenderCandidateHash !== renderCandidate.renderCandidateHash || candidate.outputAsset.sha256 !== renderCandidate.outputAsset.sha256 || candidate.qcHash !== renderCandidate.qcHash || candidate.renderContractHash !== renderCandidate.renderContractHash || candidate.lockedPictureManifestHash !== renderCandidate.lockedPictureManifestHash || candidate.audioConformHash !== renderCandidate.audioConformHash) throw new Error('Master Candidate Render Candidate lineage drift detected');
  }
  if (lockedAudioManifest) {
    validateLockedAudioManifest(lockedAudioManifest, { policy });
    if (candidate.lockedAudioManifestId !== lockedAudioManifest.manifestId || candidate.lockedAudioManifestHash !== lockedAudioManifest.manifestHash || candidate.audioConformHash !== lockedAudioManifest.audioConformHash) throw new Error('Master Candidate Audio Lock lineage drift detected');
  }
  if (masterReview) {
    if (!renderCandidate || !lockedAudioManifest || !audioLockRegister) throw new Error('renderCandidate, lockedAudioManifest, and audioLockRegister are required for Master Review linkage');
    validateMasterReview(masterReview, { policy, renderCandidate, lockedAudioManifest, audioLockRegister });
    if (candidate.masterReviewId !== masterReview.reviewId || candidate.masterReviewHash !== masterReview.reviewHash) throw new Error('Master Candidate review lineage drift detected');
  }
  if (acceptanceCeremony) {
    if (!renderCandidate || !masterReview || !lockedAudioManifest || !audioLockRegister || !keyRegistry) throw new Error('full lineage is required for Master Acceptance ceremony validation');
    verifyMasterAcceptanceCeremony({ ceremony: acceptanceCeremony, policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, keyRegistry });
    if (candidate.masterAcceptanceCeremonyId !== acceptanceCeremony.ceremonyId || candidate.masterAcceptanceCeremonyHash !== acceptanceCeremony.ceremonyHash) throw new Error('Master Candidate acceptance ceremony drift detected');
  }
  return { valid: true, masterCandidateHash: candidate.masterCandidateHash, masterAccepted: true, canonEligible: false, publicRelease: false };
}

function masterRegisterEntryHashPayload(entry) { return withoutFields(entry, ['entryHash']); }
function masterRegisterHashPayload(register) { return withoutFields(register, ['registerHash']); }

export function buildMasterCandidateRegister({ policy, entries = [], revision = 0, recordedAt }) {
  validateMasterReviewPolicy(policy);
  if (!Array.isArray(entries) || revision !== entries.length || !Number.isInteger(revision) || revision < 0) throw new Error('Master Candidate register revision must equal entry count');
  parseTime(recordedAt, 'recordedAt');
  let previous = null;
  const hashes = new Set();
  for (const entry of entries) {
    safeToken(entry.entryId, 'entryId');
    safeToken(entry.masterCandidateId, 'masterCandidateId');
    ensureSha256(entry.masterCandidateHash, 'masterCandidateHash');
    ensureSha256(entry.outputSha256, 'outputSha256');
    ensureSha256(entry.lockedAudioManifestHash, 'lockedAudioManifestHash');
    if (entry.previousEntryHash !== previous) throw new Error('Master Candidate register previousEntryHash mismatch');
    if (entry.masterAccepted !== true || entry.canonEligible !== false || entry.ledgerPromotionEligible !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Master Candidate register entry violates authority boundaries');
    ensureSha256(entry.entryHash, 'entryHash');
    if (entry.entryHash !== digestJson(masterRegisterEntryHashPayload(entry))) throw new Error('Master Candidate register entry self-hash mismatch');
    if (hashes.has(entry.masterCandidateHash)) throw new Error('Master Candidate register contains duplicate candidate hash');
    hashes.add(entry.masterCandidateHash);
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_MASTER_CANDIDATE_REGISTER_SCHEMA,
    registerId: `${policy.sequenceId}-master-candidate-register`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    recordedAt,
    status: entries.length ? 'MASTER_CANDIDATE_ACCEPTED' : 'EMPTY_NO_MASTER_CANDIDATES',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: entries.length ? entries.at(-1).entryHash : null,
    masterCandidateCount: entries.length,
    canonEligibleCount: 0,
    ledgerPromotionEligibleCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(masterRegisterHashPayload(register));
  return register;
}

export function validateMasterCandidateRegister(register, { policy = null } = {}) {
  if (!register || register.schema !== CINESWARM_MASTER_CANDIDATE_REGISTER_SCHEMA) throw new Error('invalid Master Candidate register schema');
  const effectivePolicy = policy ?? {
    schema: CINESWARM_MASTER_REVIEW_POLICY_SCHEMA,
    policyId: register.policyId,
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
    signatureAlgorithm: C1_12_SIGNATURE_ALGORITHM,
    privateKeyCustody: 'external-human-controlled',
    requireExactRenderCandidateHash: true,
    requirePassedMeasuredQc: true,
    requireExactAudioConformHash: true,
    requireHumanAudioLockSignature: true,
    requireHumanCreativeAndTechnicalMasterReview: true,
    requireMasterAcceptanceSignature: true,
    requireExplicitAudioUnlockForRemix: true,
    requireExplicitAudioSupersession: true,
    appendOnlyAudioLockRegister: true,
    appendOnlyMasterCandidateRegister: true,
    autoAudioLock: false,
    autoMasterAcceptance: false,
    canonAuthority: false,
    ledgerPromotionAuthority: false,
    publicRelease: false,
    relayDependency: false,
  };
  const rebuilt = buildMasterCandidateRegister({ policy: effectivePolicy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'masterCandidateCount', 'canonEligibleCount', 'ledgerPromotionEligibleCount']) if (register[key] !== rebuilt[key]) throw new Error(`Master Candidate register ${key} mismatch`);
  if (register.publicRelease !== false || register.relayDependency !== false) throw new Error('Master Candidate register violates authority boundaries');
  if (register.registerHash !== digestJson(masterRegisterHashPayload(register))) throw new Error('Master Candidate register self-hash mismatch');
  if (policy) {
    validateMasterReviewPolicy(policy);
    if (register.policyId !== policy.policyId || register.episodeId !== policy.episodeId || register.sequenceId !== policy.sequenceId) throw new Error('Master Candidate register policy scope mismatch');
  }
  return { valid: true, revision: register.revision, masterCandidateCount: register.masterCandidateCount, publicRelease: false };
}

export function appendMasterCandidateToRegister({ register, candidate, policy, recordedAt }) {
  validateMasterCandidateRegister(register, { policy });
  validateMasterCandidate(candidate, { policy });
  if (register.entries.some((entry) => entry.masterCandidateHash === candidate.masterCandidateHash)) throw new Error('Master Candidate is already registered');
  const entry = {
    entryId: `${policy.sequenceId}-master-candidate-event-${String(register.revision + 1).padStart(4, '0')}`,
    masterCandidateId: candidate.masterCandidateId,
    masterCandidateHash: candidate.masterCandidateHash,
    sourceRenderCandidateHash: candidate.sourceRenderCandidateHash,
    outputSha256: candidate.outputAsset.sha256,
    lockedPictureManifestHash: candidate.lockedPictureManifestHash,
    lockedAudioManifestHash: candidate.lockedAudioManifestHash,
    masterAcceptanceCeremonyHash: candidate.masterAcceptanceCeremonyHash,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    masterAccepted: true,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(masterRegisterEntryHashPayload(entry));
  return buildMasterCandidateRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

export function classifyMasterReadiness({ policy, renderCandidate = null, audioLockRegister, masterRegister }) {
  validateMasterReviewPolicy(policy);
  validateAudioLockRegister(audioLockRegister, { policy });
  validateMasterCandidateRegister(masterRegister, { policy });
  if (renderCandidate) validateRenderCandidate(renderCandidate);
  return {
    renderCandidateAvailable: Boolean(renderCandidate),
    activeAudioLock: audioLockRegister.audioLocked,
    audioLockManifestHash: audioLockRegister.currentManifestHash,
    masterCandidateCount: masterRegister.masterCandidateCount,
    readyForMasterReview: Boolean(renderCandidate && audioLockRegister.audioLocked),
    canonEligibleCount: 0,
    ledgerPromotionEligibleCount: 0,
    publicRelease: false,
    relayDependency: false,
    status: !renderCandidate ? 'BLOCKED_NO_RENDER_CANDIDATE' : (!audioLockRegister.audioLocked ? 'BLOCKED_NO_ACTIVE_AUDIO_LOCK' : (masterRegister.masterCandidateCount ? 'MASTER_CANDIDATE_ACCEPTED' : 'READY_FOR_MASTER_REVIEW')),
  };
}
