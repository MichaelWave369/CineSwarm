import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import {
  validateMasterCandidate,
  validateMasterCandidateRegister,
  validateMasterReviewPolicy,
} from './master-review-audio-lock.js';

export const CINESWARM_CANON_POLICY_SCHEMA = 'parallax.cineswarm.canon-ledger-policy.c1.13.v0.1';
export const CINESWARM_CANON_REVIEW_SCHEMA = 'parallax.cineswarm.canon-review.c1.13.v0.1';
export const CINESWARM_CANON_PROMOTION_CEREMONY_SCHEMA = 'parallax.cineswarm.canon-promotion-ceremony.c1.13.v0.1';
export const CINESWARM_CANON_RECORD_SCHEMA = 'parallax.cineswarm.canon-record.c1.13.v0.1';
export const CINESWARM_CANON_REGISTER_SCHEMA = 'parallax.cineswarm.canon-register.c1.13.v0.1';
export const CINESWARM_LEDGER_ADMISSION_PACKET_SCHEMA = 'parallax.cineswarm.ledger-admission-packet.c1.13.v0.1';
export const CINESWARM_LEDGER_PACKET_REGISTER_SCHEMA = 'parallax.cineswarm.ledger-packet-register.c1.13.v0.1';

export const C1_13_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_13_CANON_REVIEW_DECISIONS = Object.freeze(['APPROVE_FOR_CANON_PROMOTION', 'REJECT', 'HOLD', 'REVISE']);
export const C1_13_CANON_PROMOTION_DECISION = 'PROMOTE_EXACT_MASTER_CANDIDATE_TO_CANON';

const CANON_PROMOTION_DOMAIN = 'PARALLAX-CINESWARM-C1.13-CANON-PROMOTION';

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
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new Canon Promotion signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Canon Promotion signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Canon Promotion signing key was not valid at recordedAt');
}

function validateKeyForHistoricalSignature(key, authorityId, recordedAt) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Canon Promotion signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Canon Promotion signature was created outside key validity');
}

export function validateCanonLedgerPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('Canon/Ledger policy must be an object');
  if (policy.schema !== CINESWARM_CANON_POLICY_SCHEMA) throw new Error(`unsupported Canon/Ledger policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.masterReviewPolicyId, 'masterReviewPolicyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  if (policy.signatureAlgorithm !== C1_13_SIGNATURE_ALGORITHM) throw new Error(`C1.13 signatureAlgorithm must remain ${C1_13_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('C1.13 private key custody must remain external-human-controlled');
  for (const key of [
    'requireRegisteredMasterCandidate',
    'requireExactMasterCandidateHash',
    'requireExactMasterOutputHash',
    'requireIndependentCanonReviewRecord',
    'requireHumanCanonPromotionSignature',
    'requireCompleteLedgerEvidenceInventory',
    'appendOnlyCanonRegister',
    'appendOnlyLedgerPacketRegister',
    'requireExplicitCanonSupersessionForReplacement',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of [
    'autoCanonPromotion',
    'autoLedgerAdmission',
    'networkReleaseAuthority',
    'publicRelease',
    'relayDependency',
  ]) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function ensureMasterRegistered({ policy, masterPolicy, masterCandidate, masterRegister }) {
  validateCanonLedgerPolicy(policy);
  validateMasterReviewPolicy(masterPolicy);
  validateMasterCandidate(masterCandidate, { policy: masterPolicy });
  validateMasterCandidateRegister(masterRegister, { policy: masterPolicy });
  if (policy.masterReviewPolicyId !== masterPolicy.policyId || policy.episodeId !== masterPolicy.episodeId || policy.sequenceId !== masterPolicy.sequenceId) throw new Error('C1.13 policy is not bound to this C1.12 Master policy');
  if (masterCandidate.policyId !== masterPolicy.policyId || masterCandidate.episodeId !== policy.episodeId || masterCandidate.sequenceId !== policy.sequenceId) throw new Error('Master Candidate is outside Canon policy scope');
  const registration = masterRegister.entries.find((entry) => entry.masterCandidateHash === masterCandidate.masterCandidateHash);
  if (!registration) throw new Error('Master Candidate must be present in the C1.12 append-only Master Candidate Register before Canon review');
  if (registration.outputSha256 !== masterCandidate.outputAsset.sha256 || registration.masterAcceptanceCeremonyHash !== masterCandidate.masterAcceptanceCeremonyHash) throw new Error('Master Candidate register lineage drift detected');
  return registration;
}

function canonReviewHashPayload(review) {
  return withoutFields(review, ['reviewHash']);
}

export function buildCanonReview({
  policy,
  masterPolicy,
  masterCandidate,
  masterRegister,
  authorityId,
  decision,
  masterLineageApproved,
  provenanceCompleteForCanon,
  promotionBoundaryUnderstood,
  recordedAt,
  notes,
  reviewId = null,
}) {
  ensureMasterRegistered({ policy, masterPolicy, masterCandidate, masterRegister });
  if (!C1_13_CANON_REVIEW_DECISIONS.includes(decision)) throw new Error('unsupported Canon Review decision');
  if (decision === 'APPROVE_FOR_CANON_PROMOTION' && (masterLineageApproved !== true || provenanceCompleteForCanon !== true || promotionBoundaryUnderstood !== true)) throw new Error('Canon approval requires lineage, provenance, and boundary approval');
  const review = {
    schema: CINESWARM_CANON_REVIEW_SCHEMA,
    reviewId: safeToken(reviewId ?? `${policy.sequenceId}-canon-review-${masterCandidate.masterCandidateHash.slice(0, 12)}`, 'reviewId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    masterReviewPolicyId: masterPolicy.policyId,
    masterCandidateId: masterCandidate.masterCandidateId,
    masterCandidateHash: masterCandidate.masterCandidateHash,
    outputAssetSha256: masterCandidate.outputAsset.sha256,
    masterCandidateRegisterHash: masterRegister.registerHash,
    masterCandidateRegisterRevision: masterRegister.revision,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    masterLineageApproved: Boolean(masterLineageApproved),
    provenanceCompleteForCanon: Boolean(provenanceCompleteForCanon),
    promotionBoundaryUnderstood: Boolean(promotionBoundaryUnderstood),
    notes: requiredString(notes, 'notes'),
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    eligibleForCanonPromotionCeremony: decision === 'APPROVE_FOR_CANON_PROMOTION' && masterLineageApproved === true && provenanceCompleteForCanon === true && promotionBoundaryUnderstood === true,
    canonPromoted: false,
    ledgerAdmitted: false,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
  review.reviewHash = digestJson(canonReviewHashPayload(review));
  return review;
}

export function validateCanonReview(review, { policy, masterPolicy, masterCandidate, masterRegister }) {
  ensureMasterRegistered({ policy, masterPolicy, masterCandidate, masterRegister });
  if (!review || review.schema !== CINESWARM_CANON_REVIEW_SCHEMA) throw new Error('invalid Canon Review schema');
  safeToken(review.reviewId, 'reviewId');
  if (review.policyId !== policy.policyId || review.episodeId !== policy.episodeId || review.sequenceId !== policy.sequenceId || review.masterReviewPolicyId !== masterPolicy.policyId) throw new Error('Canon Review policy scope mismatch');
  if (review.masterCandidateId !== masterCandidate.masterCandidateId || review.masterCandidateHash !== masterCandidate.masterCandidateHash || review.outputAssetSha256 !== masterCandidate.outputAsset.sha256) throw new Error('Canon Review Master Candidate lineage drift detected');
  if (review.masterCandidateRegisterHash !== masterRegister.registerHash || review.masterCandidateRegisterRevision !== masterRegister.revision) throw new Error('Canon Review Master Candidate Register drift detected');
  if (review.authority?.kind !== 'human' || review.simulated !== false) throw new Error('Canon Review requires a real human authority');
  safeToken(review.authority.id, 'authority.id');
  if (!C1_13_CANON_REVIEW_DECISIONS.includes(review.decision)) throw new Error('unsupported Canon Review decision');
  parseTime(review.recordedAt, 'recordedAt');
  requiredString(review.notes, 'notes');
  const approved = review.decision === 'APPROVE_FOR_CANON_PROMOTION' && review.masterLineageApproved === true && review.provenanceCompleteForCanon === true && review.promotionBoundaryUnderstood === true;
  if (review.eligibleForCanonPromotionCeremony !== approved) throw new Error('Canon Review eligibility mismatch');
  if (review.canonPromoted !== false || review.ledgerAdmitted !== false || review.networkReleased !== false || review.publicRelease !== false || review.relayDependency !== false) throw new Error('Canon Review violates downstream authority boundaries');
  ensureSha256(review.reviewHash, 'reviewHash');
  if (review.reviewHash !== digestJson(canonReviewHashPayload(review))) throw new Error('Canon Review self-hash mismatch');
  return { valid: true, eligibleForCanonPromotionCeremony: approved };
}

function canonPromotionPayloadDigestSource(ceremony) {
  return withoutFields(ceremony, ['ceremonyDigest', 'signatureAlgorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']);
}

function canonPromotionMessage(ceremonyDigest, ceremony) {
  return [
    CANON_PROMOTION_DOMAIN,
    ceremony.ceremonyId,
    ceremonyDigest,
    ceremony.keyId,
    ceremony.authority.id,
    ceremony.masterCandidateHash,
    ceremony.canonReviewHash,
    ceremony.outputAssetSha256,
  ].join('\n');
}

export function buildCanonPromotionCeremonyPayload({
  policy,
  masterPolicy,
  masterCandidate,
  masterRegister,
  canonReview,
  authorityId,
  keyId,
  recordedAt,
  ceremonyId = null,
}) {
  const reviewState = validateCanonReview(canonReview, { policy, masterPolicy, masterCandidate, masterRegister });
  if (!reviewState.eligibleForCanonPromotionCeremony) throw new Error('Canon Promotion Ceremony requires an approved Canon Review');
  const payload = {
    schema: CINESWARM_CANON_PROMOTION_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${policy.sequenceId}-canon-promotion-${masterCandidate.masterCandidateHash.slice(0, 12)}`, 'ceremonyId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    decision: C1_13_CANON_PROMOTION_DECISION,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    keyId: safeToken(keyId, 'keyId'),
    masterCandidateId: masterCandidate.masterCandidateId,
    masterCandidateHash: masterCandidate.masterCandidateHash,
    outputAssetSha256: masterCandidate.outputAsset.sha256,
    qcHash: masterCandidate.qcHash,
    lockedPictureManifestHash: masterCandidate.lockedPictureManifestHash,
    lockedAudioManifestHash: masterCandidate.lockedAudioManifestHash,
    masterReviewHash: masterCandidate.masterReviewHash,
    masterAcceptanceCeremonyHash: masterCandidate.masterAcceptanceCeremonyHash,
    masterCandidateRegisterHash: masterRegister.registerHash,
    masterCandidateRegisterRevision: masterRegister.revision,
    canonReviewId: canonReview.reviewId,
    canonReviewHash: canonReview.reviewHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    ledgerAdmissionAuthorized: false,
    networkReleaseAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  payload.ceremonyDigest = digestJson(canonPromotionPayloadDigestSource(payload));
  return payload;
}

export function signCanonPromotionCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!payload || payload.schema !== CINESWARM_CANON_PROMOTION_CEREMONY_SCHEMA) throw new Error('invalid Canon Promotion Ceremony payload');
  if (payload.decision !== C1_13_CANON_PROMOTION_DECISION || payload.authority?.kind !== 'human' || payload.simulated !== false) throw new Error('Canon Promotion Ceremony authority/decision invariants violated');
  if (payload.ledgerAdmissionAuthorized !== false || payload.networkReleaseAuthorized !== false || payload.publicRelease !== false || payload.relayDependency !== false) throw new Error('Canon Promotion Ceremony violates downstream authority boundaries');
  const expectedDigest = digestJson(canonPromotionPayloadDigestSource(payload));
  if (payload.ceremonyDigest !== expectedDigest) throw new Error('Canon Promotion Ceremony payload digest mismatch');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority.id, payload.recordedAt);
  const signature = cryptoSign(null, Buffer.from(canonPromotionMessage(payload.ceremonyDigest, payload), 'utf8'), privateKeyPem);
  const ceremony = {
    ...structuredClone(payload),
    signatureAlgorithm: C1_13_SIGNATURE_ALGORITHM,
    signatureBase64: signature.toString('base64'),
    keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
  };
  ceremony.ceremonyHash = digestJson(withoutFields(ceremony, ['ceremonyHash']));
  return ceremony;
}

export function verifyCanonPromotionCeremony({ ceremony, policy, masterPolicy, masterCandidate, masterRegister, canonReview, keyRegistry }) {
  validateCanonLedgerPolicy(policy);
  const expectedPayload = buildCanonPromotionCeremonyPayload({
    policy,
    masterPolicy,
    masterCandidate,
    masterRegister,
    canonReview,
    authorityId: ceremony?.authority?.id,
    keyId: ceremony?.keyId,
    recordedAt: ceremony?.recordedAt,
    ceremonyId: ceremony?.ceremonyId,
  });
  if (!ceremony || ceremony.schema !== CINESWARM_CANON_PROMOTION_CEREMONY_SCHEMA) throw new Error('invalid Canon Promotion Ceremony schema');
  for (const key of Object.keys(expectedPayload)) {
    if (JSON.stringify(ceremony[key]) !== JSON.stringify(expectedPayload[key])) throw new Error(`Canon Promotion Ceremony exact lineage drift detected at ${key}`);
  }
  if (ceremony.signatureAlgorithm !== C1_13_SIGNATURE_ALGORITHM) throw new Error('Canon Promotion signature algorithm mismatch');
  requiredString(ceremony.signatureBase64, 'signatureBase64');
  ensureSha256(ceremony.keyFingerprintSha256, 'keyFingerprintSha256');
  ensureSha256(ceremony.ceremonyHash, 'ceremonyHash');
  if (ceremony.ceremonyHash !== digestJson(withoutFields(ceremony, ['ceremonyHash']))) throw new Error('Canon Promotion Ceremony self-hash mismatch');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Canon Promotion key fingerprint mismatch');
  const signatureOk = cryptoVerify(null, Buffer.from(canonPromotionMessage(ceremony.ceremonyDigest, ceremony), 'utf8'), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'));
  if (!signatureOk) throw new Error('Canon Promotion signature verification failed');
  return { valid: true, canonPromotionAuthorized: true, ledgerAdmissionAuthorized: false, networkReleaseAuthorized: false };
}

function canonRecordHashPayload(record) {
  return withoutFields(record, ['canonRecordHash']);
}

export function buildCanonRecord({
  policy,
  masterPolicy,
  masterCandidate,
  masterRegister,
  canonReview,
  promotionCeremony,
  keyRegistry,
  createdAt,
  canonRecordId = null,
}) {
  verifyCanonPromotionCeremony({ ceremony: promotionCeremony, policy, masterPolicy, masterCandidate, masterRegister, canonReview, keyRegistry });
  const record = {
    schema: CINESWARM_CANON_RECORD_SCHEMA,
    canonRecordId: safeToken(canonRecordId ?? `${policy.sequenceId}-canon-${masterCandidate.masterCandidateHash.slice(0, 12)}`, 'canonRecordId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    state: 'CANON_PROMOTED',
    masterCandidateId: masterCandidate.masterCandidateId,
    masterCandidateHash: masterCandidate.masterCandidateHash,
    outputAsset: structuredClone(masterCandidate.outputAsset),
    qcHash: masterCandidate.qcHash,
    renderContractHash: masterCandidate.renderContractHash,
    lockedPictureManifestHash: masterCandidate.lockedPictureManifestHash,
    audioConformHash: masterCandidate.audioConformHash,
    lockedAudioManifestHash: masterCandidate.lockedAudioManifestHash,
    masterReviewHash: masterCandidate.masterReviewHash,
    masterAcceptanceCeremonyHash: masterCandidate.masterAcceptanceCeremonyHash,
    masterCandidateRegisterHash: masterRegister.registerHash,
    canonReviewId: canonReview.reviewId,
    canonReviewHash: canonReview.reviewHash,
    promotionCeremonyId: promotionCeremony.ceremonyId,
    promotionCeremonyHash: promotionCeremony.ceremonyHash,
    promotedBy: structuredClone(promotionCeremony.authority),
    promotedAt: promotionCeremony.recordedAt,
    createdAt: parseTime(createdAt, 'createdAt').text,
    canonPromoted: true,
    ledgerAdmissionPacketRequired: true,
    ledgerAdmitted: false,
    networkReleaseRequired: true,
    networkReleaseEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  record.canonRecordHash = digestJson(canonRecordHashPayload(record));
  return record;
}

export function validateCanonRecord(record, { policy, masterPolicy, masterCandidate = null, masterRegister = null, canonReview = null, promotionCeremony = null, keyRegistry = null } = {}) {
  validateCanonLedgerPolicy(policy);
  validateMasterReviewPolicy(masterPolicy);
  if (!record || record.schema !== CINESWARM_CANON_RECORD_SCHEMA) throw new Error('invalid Canon Record schema');
  safeToken(record.canonRecordId, 'canonRecordId');
  if (record.policyId !== policy.policyId || record.episodeId !== policy.episodeId || record.sequenceId !== policy.sequenceId) throw new Error('Canon Record policy scope mismatch');
  if (record.state !== 'CANON_PROMOTED' || record.canonPromoted !== true || record.ledgerAdmissionPacketRequired !== true || record.ledgerAdmitted !== false || record.networkReleaseRequired !== true || record.networkReleaseEligible !== false || record.publicRelease !== false || record.relayDependency !== false) throw new Error('Canon Record authority/state invariants violated');
  for (const [value, label] of [
    [record.masterCandidateHash, 'masterCandidateHash'],
    [record.outputAsset?.sha256, 'outputAsset.sha256'],
    [record.qcHash, 'qcHash'],
    [record.renderContractHash, 'renderContractHash'],
    [record.lockedPictureManifestHash, 'lockedPictureManifestHash'],
    [record.audioConformHash, 'audioConformHash'],
    [record.lockedAudioManifestHash, 'lockedAudioManifestHash'],
    [record.masterReviewHash, 'masterReviewHash'],
    [record.masterAcceptanceCeremonyHash, 'masterAcceptanceCeremonyHash'],
    [record.masterCandidateRegisterHash, 'masterCandidateRegisterHash'],
    [record.canonReviewHash, 'canonReviewHash'],
    [record.promotionCeremonyHash, 'promotionCeremonyHash'],
    [record.canonRecordHash, 'canonRecordHash'],
  ]) ensureSha256(value, label);
  parseTime(record.promotedAt, 'promotedAt');
  parseTime(record.createdAt, 'createdAt');
  if (record.promotedBy?.kind !== 'human') throw new Error('Canon Record promotedBy must be human');
  if (record.canonRecordHash !== digestJson(canonRecordHashPayload(record))) throw new Error('Canon Record self-hash mismatch');
  if (masterCandidate) {
    if (!masterRegister) throw new Error('masterRegister is required with masterCandidate');
    ensureMasterRegistered({ policy, masterPolicy, masterCandidate, masterRegister });
    if (record.masterCandidateId !== masterCandidate.masterCandidateId || record.masterCandidateHash !== masterCandidate.masterCandidateHash || record.outputAsset.sha256 !== masterCandidate.outputAsset.sha256 || record.qcHash !== masterCandidate.qcHash || record.renderContractHash !== masterCandidate.renderContractHash || record.lockedPictureManifestHash !== masterCandidate.lockedPictureManifestHash || record.audioConformHash !== masterCandidate.audioConformHash || record.lockedAudioManifestHash !== masterCandidate.lockedAudioManifestHash || record.masterReviewHash !== masterCandidate.masterReviewHash || record.masterAcceptanceCeremonyHash !== masterCandidate.masterAcceptanceCeremonyHash || record.masterCandidateRegisterHash !== masterRegister.registerHash) throw new Error('Canon Record Master Candidate lineage drift detected');
  }
  if (canonReview) {
    if (!masterCandidate || !masterRegister) throw new Error('Master lineage is required for Canon Review validation');
    validateCanonReview(canonReview, { policy, masterPolicy, masterCandidate, masterRegister });
    if (record.canonReviewId !== canonReview.reviewId || record.canonReviewHash !== canonReview.reviewHash) throw new Error('Canon Record review lineage drift detected');
  }
  if (promotionCeremony) {
    if (!masterCandidate || !masterRegister || !canonReview || !keyRegistry) throw new Error('full lineage is required for Canon Promotion Ceremony validation');
    verifyCanonPromotionCeremony({ ceremony: promotionCeremony, policy, masterPolicy, masterCandidate, masterRegister, canonReview, keyRegistry });
    if (record.promotionCeremonyId !== promotionCeremony.ceremonyId || record.promotionCeremonyHash !== promotionCeremony.ceremonyHash) throw new Error('Canon Record promotion ceremony drift detected');
  }
  return { valid: true, canonPromoted: true, ledgerAdmitted: false, publicRelease: false };
}

function canonRegisterEntryHashPayload(entry) {
  return withoutFields(entry, ['entryHash']);
}

function canonRegisterHashPayload(register) {
  return withoutFields(register, ['registerHash']);
}

export function buildCanonRegister({ policy, entries = [], revision = 0, recordedAt }) {
  validateCanonLedgerPolicy(policy);
  if (!Array.isArray(entries)) throw new Error('Canon register entries must be an array');
  if (!Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Canon register revision must equal entry count');
  let previous = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Canon register hash chain broken at entry ${index}`);
    ensureSha256(entry.canonRecordHash, `entries[${index}].canonRecordHash`);
    ensureSha256(entry.masterCandidateHash, `entries[${index}].masterCandidateHash`);
    ensureSha256(entry.outputSha256, `entries[${index}].outputSha256`);
    ensureSha256(entry.promotionCeremonyHash, `entries[${index}].promotionCeremonyHash`);
    ensureSha256(entry.entryHash, `entries[${index}].entryHash`);
    if (entry.entryHash !== digestJson(canonRegisterEntryHashPayload(entry))) throw new Error(`Canon register entry ${index} self-hash mismatch`);
    if (entry.canonPromoted !== true || entry.ledgerAdmitted !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Canon register entry violates authority boundaries');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_CANON_REGISTER_SCHEMA,
    registerId: `${policy.sequenceId}-canon-register`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    status: entries.length ? 'CANON_PROMOTED_LEDGER_ADMISSION_PENDING' : 'EMPTY_NO_CANON_RECORDS',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: previous,
    canonRecordCount: entries.length,
    activeCanonRecordHash: entries.length ? entries.at(-1).canonRecordHash : null,
    ledgerAdmittedCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(canonRegisterHashPayload(register));
  return register;
}

export function validateCanonRegister(register, { policy = null } = {}) {
  if (!register || register.schema !== CINESWARM_CANON_REGISTER_SCHEMA) throw new Error('invalid Canon register schema');
  safeToken(register.registerId, 'registerId');
  const effectivePolicy = policy ?? {
    schema: CINESWARM_CANON_POLICY_SCHEMA,
    policyId: register.policyId,
    masterReviewPolicyId: 'placeholder-master-policy',
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
    signatureAlgorithm: C1_13_SIGNATURE_ALGORITHM,
    privateKeyCustody: 'external-human-controlled',
    requireRegisteredMasterCandidate: true,
    requireExactMasterCandidateHash: true,
    requireExactMasterOutputHash: true,
    requireIndependentCanonReviewRecord: true,
    requireHumanCanonPromotionSignature: true,
    requireCompleteLedgerEvidenceInventory: true,
    appendOnlyCanonRegister: true,
    appendOnlyLedgerPacketRegister: true,
    requireExplicitCanonSupersessionForReplacement: true,
    autoCanonPromotion: false,
    autoLedgerAdmission: false,
    networkReleaseAuthority: false,
    publicRelease: false,
    relayDependency: false,
  };
  const rebuilt = buildCanonRegister({ policy: effectivePolicy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'canonRecordCount', 'activeCanonRecordHash', 'ledgerAdmittedCount']) if (register[key] !== rebuilt[key]) throw new Error(`Canon register ${key} mismatch`);
  if (register.publicRelease !== false || register.relayDependency !== false) throw new Error('Canon register violates authority boundaries');
  if (register.registerHash !== digestJson(canonRegisterHashPayload(register))) throw new Error('Canon register self-hash mismatch');
  if (policy) {
    validateCanonLedgerPolicy(policy);
    if (register.policyId !== policy.policyId || register.episodeId !== policy.episodeId || register.sequenceId !== policy.sequenceId) throw new Error('Canon register policy scope mismatch');
  }
  return { valid: true, revision: register.revision, canonRecordCount: register.canonRecordCount, publicRelease: false };
}

export function appendCanonRecordToRegister({ register, canonRecord, policy, masterPolicy, recordedAt }) {
  validateCanonRegister(register, { policy });
  validateCanonRecord(canonRecord, { policy, masterPolicy });
  if (register.canonRecordCount > 0) throw new Error('existing Canon record requires an explicit signed supersession ceremony before replacement; C1.13 will not silently replace Canon');
  const entry = {
    entryId: `${policy.sequenceId}-canon-event-${String(register.revision + 1).padStart(4, '0')}`,
    canonRecordId: canonRecord.canonRecordId,
    canonRecordHash: canonRecord.canonRecordHash,
    masterCandidateHash: canonRecord.masterCandidateHash,
    outputSha256: canonRecord.outputAsset.sha256,
    promotionCeremonyHash: canonRecord.promotionCeremonyHash,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    canonPromoted: true,
    ledgerAdmitted: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(canonRegisterEntryHashPayload(entry));
  return buildCanonRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

function ledgerEvidenceInventory({ masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister }) {
  return [
    { kind: 'output-asset', id: masterCandidate.outputAsset.relativePath, sha256: masterCandidate.outputAsset.sha256 },
    { kind: 'measured-render-qc', id: 'qcHash', sha256: masterCandidate.qcHash },
    { kind: 'render-contract', id: 'renderContractHash', sha256: masterCandidate.renderContractHash },
    { kind: 'locked-picture-manifest', id: 'lockedPictureManifestHash', sha256: masterCandidate.lockedPictureManifestHash },
    { kind: 'audio-conform', id: 'audioConformHash', sha256: masterCandidate.audioConformHash },
    { kind: 'locked-audio-manifest', id: masterCandidate.lockedAudioManifestId, sha256: masterCandidate.lockedAudioManifestHash },
    { kind: 'master-review', id: masterCandidate.masterReviewId, sha256: masterCandidate.masterReviewHash },
    { kind: 'master-acceptance-ceremony', id: masterCandidate.masterAcceptanceCeremonyId, sha256: masterCandidate.masterAcceptanceCeremonyHash },
    { kind: 'master-candidate', id: masterCandidate.masterCandidateId, sha256: masterCandidate.masterCandidateHash },
    { kind: 'master-candidate-register', id: masterRegister.registerId, sha256: masterRegister.registerHash },
    { kind: 'canon-review', id: canonReview.reviewId, sha256: canonReview.reviewHash },
    { kind: 'canon-promotion-ceremony', id: promotionCeremony.ceremonyId, sha256: promotionCeremony.ceremonyHash },
    { kind: 'canon-record', id: canonRecord.canonRecordId, sha256: canonRecord.canonRecordHash },
    { kind: 'canon-register', id: canonRegister.registerId, sha256: canonRegister.registerHash },
  ];
}

function ledgerPacketHashPayload(packet) {
  return withoutFields(packet, ['ledgerPacketHash']);
}

export function buildLedgerAdmissionPacket({
  policy,
  masterPolicy,
  masterCandidate,
  masterRegister,
  canonReview,
  promotionCeremony,
  canonRecord,
  canonRegister,
  keyRegistry,
  createdAt,
  packetId = null,
}) {
  validateCanonRecord(canonRecord, { policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, keyRegistry });
  validateCanonRegister(canonRegister, { policy });
  if (canonRegister.activeCanonRecordHash !== canonRecord.canonRecordHash) throw new Error('Ledger packet requires the active Canon record in the append-only Canon register');
  const evidenceInventory = ledgerEvidenceInventory({ masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister });
  for (const [index, item] of evidenceInventory.entries()) {
    requiredString(item.kind, `evidenceInventory[${index}].kind`);
    requiredString(item.id, `evidenceInventory[${index}].id`);
    ensureSha256(item.sha256, `evidenceInventory[${index}].sha256`);
  }
  const packet = {
    schema: CINESWARM_LEDGER_ADMISSION_PACKET_SCHEMA,
    packetId: safeToken(packetId ?? `${policy.sequenceId}-ledger-admission-${canonRecord.canonRecordHash.slice(0, 12)}`, 'packetId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    state: 'LEDGER_ADMISSION_PACKET',
    canonRecordId: canonRecord.canonRecordId,
    canonRecordHash: canonRecord.canonRecordHash,
    canonRegisterHash: canonRegister.registerHash,
    masterCandidateId: masterCandidate.masterCandidateId,
    masterCandidateHash: masterCandidate.masterCandidateHash,
    outputAsset: structuredClone(masterCandidate.outputAsset),
    evidenceInventory,
    evidenceItemCount: evidenceInventory.length,
    evidenceRootHash: digestJson(evidenceInventory),
    createdAt: parseTime(createdAt, 'createdAt').text,
    verificationAssertions: {
      pictureLocked: true,
      audioLocked: true,
      measuredQcPassed: true,
      masterAccepted: true,
      canonPromoted: true,
      humanCanonPromotionSignatureVerified: true,
      exactMasterOutputHashBound: true,
      provenanceInventoryComplete: true,
    },
    ledgerAdmissionEligible: true,
    ledgerAdmissionDecisionRequired: true,
    ledgerAdmissionReceiptRequired: true,
    ledgerAdmitted: false,
    networkReleaseCeremonyRequired: true,
    networkReleaseEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  packet.ledgerPacketHash = digestJson(ledgerPacketHashPayload(packet));
  return packet;
}

export function validateLedgerAdmissionPacket(packet, { policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry }) {
  validateCanonLedgerPolicy(policy);
  if (!packet || packet.schema !== CINESWARM_LEDGER_ADMISSION_PACKET_SCHEMA) throw new Error('invalid Ledger Admission Packet schema');
  safeToken(packet.packetId, 'packetId');
  if (packet.policyId !== policy.policyId || packet.episodeId !== policy.episodeId || packet.sequenceId !== policy.sequenceId) throw new Error('Ledger Admission Packet policy scope mismatch');
  if (packet.state !== 'LEDGER_ADMISSION_PACKET' || packet.ledgerAdmissionEligible !== true || packet.ledgerAdmissionDecisionRequired !== true || packet.ledgerAdmissionReceiptRequired !== true || packet.ledgerAdmitted !== false || packet.networkReleaseCeremonyRequired !== true || packet.networkReleaseEligible !== false || packet.publicRelease !== false || packet.relayDependency !== false) throw new Error('Ledger Admission Packet authority/state invariants violated');
  const expected = buildLedgerAdmissionPacket({ policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry, createdAt: packet.createdAt, packetId: packet.packetId });
  if (packet.ledgerPacketHash !== expected.ledgerPacketHash || JSON.stringify(packet.evidenceInventory) !== JSON.stringify(expected.evidenceInventory) || packet.evidenceRootHash !== expected.evidenceRootHash || packet.evidenceItemCount !== expected.evidenceItemCount || JSON.stringify(packet.verificationAssertions) !== JSON.stringify(expected.verificationAssertions)) throw new Error('Ledger Admission Packet lineage/evidence drift detected');
  ensureSha256(packet.ledgerPacketHash, 'ledgerPacketHash');
  if (packet.ledgerPacketHash !== digestJson(ledgerPacketHashPayload(packet))) throw new Error('Ledger Admission Packet self-hash mismatch');
  return { valid: true, evidenceItemCount: packet.evidenceItemCount, ledgerAdmissionEligible: true, ledgerAdmitted: false, publicRelease: false };
}

function ledgerRegisterEntryHashPayload(entry) {
  return withoutFields(entry, ['entryHash']);
}

function ledgerRegisterHashPayload(register) {
  return withoutFields(register, ['registerHash']);
}

export function buildLedgerPacketRegister({ policy, entries = [], revision = 0, recordedAt }) {
  validateCanonLedgerPolicy(policy);
  if (!Array.isArray(entries)) throw new Error('Ledger packet register entries must be an array');
  if (!Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Ledger packet register revision must equal entry count');
  let previous = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Ledger packet register hash chain broken at entry ${index}`);
    ensureSha256(entry.ledgerPacketHash, `entries[${index}].ledgerPacketHash`);
    ensureSha256(entry.canonRecordHash, `entries[${index}].canonRecordHash`);
    ensureSha256(entry.evidenceRootHash, `entries[${index}].evidenceRootHash`);
    ensureSha256(entry.entryHash, `entries[${index}].entryHash`);
    if (entry.entryHash !== digestJson(ledgerRegisterEntryHashPayload(entry))) throw new Error(`Ledger packet register entry ${index} self-hash mismatch`);
    if (entry.ledgerAdmissionEligible !== true || entry.ledgerAdmitted !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Ledger packet register entry violates authority boundaries');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_LEDGER_PACKET_REGISTER_SCHEMA,
    registerId: `${policy.sequenceId}-ledger-admission-packet-register`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    status: entries.length ? 'LEDGER_ADMISSION_PACKET_READY_HUMAN_LEDGER_DECISION_PENDING' : 'EMPTY_NO_LEDGER_ADMISSION_PACKETS',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: previous,
    packetCount: entries.length,
    ledgerAdmittedCount: 0,
    networkReleaseCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(ledgerRegisterHashPayload(register));
  return register;
}

export function validateLedgerPacketRegister(register, { policy = null } = {}) {
  if (!register || register.schema !== CINESWARM_LEDGER_PACKET_REGISTER_SCHEMA) throw new Error('invalid Ledger packet register schema');
  safeToken(register.registerId, 'registerId');
  const effectivePolicy = policy ?? {
    schema: CINESWARM_CANON_POLICY_SCHEMA,
    policyId: register.policyId,
    masterReviewPolicyId: 'placeholder-master-policy',
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
    signatureAlgorithm: C1_13_SIGNATURE_ALGORITHM,
    privateKeyCustody: 'external-human-controlled',
    requireRegisteredMasterCandidate: true,
    requireExactMasterCandidateHash: true,
    requireExactMasterOutputHash: true,
    requireIndependentCanonReviewRecord: true,
    requireHumanCanonPromotionSignature: true,
    requireCompleteLedgerEvidenceInventory: true,
    appendOnlyCanonRegister: true,
    appendOnlyLedgerPacketRegister: true,
    requireExplicitCanonSupersessionForReplacement: true,
    autoCanonPromotion: false,
    autoLedgerAdmission: false,
    networkReleaseAuthority: false,
    publicRelease: false,
    relayDependency: false,
  };
  const rebuilt = buildLedgerPacketRegister({ policy: effectivePolicy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'packetCount', 'ledgerAdmittedCount', 'networkReleaseCount']) if (register[key] !== rebuilt[key]) throw new Error(`Ledger packet register ${key} mismatch`);
  if (register.publicRelease !== false || register.relayDependency !== false) throw new Error('Ledger packet register violates authority boundaries');
  if (register.registerHash !== digestJson(ledgerRegisterHashPayload(register))) throw new Error('Ledger packet register self-hash mismatch');
  if (policy) {
    validateCanonLedgerPolicy(policy);
    if (register.policyId !== policy.policyId || register.episodeId !== policy.episodeId || register.sequenceId !== policy.sequenceId) throw new Error('Ledger packet register policy scope mismatch');
  }
  return { valid: true, revision: register.revision, packetCount: register.packetCount, publicRelease: false };
}

export function appendLedgerAdmissionPacketToRegister({ register, packet, policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry, recordedAt }) {
  validateLedgerPacketRegister(register, { policy });
  validateLedgerAdmissionPacket(packet, { policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry });
  if (register.entries.some((entry) => entry.ledgerPacketHash === packet.ledgerPacketHash || entry.canonRecordHash === packet.canonRecordHash)) throw new Error('Ledger Admission Packet for this Canon record is already registered');
  const entry = {
    entryId: `${policy.sequenceId}-ledger-packet-event-${String(register.revision + 1).padStart(4, '0')}`,
    packetId: packet.packetId,
    ledgerPacketHash: packet.ledgerPacketHash,
    canonRecordHash: packet.canonRecordHash,
    masterCandidateHash: packet.masterCandidateHash,
    outputSha256: packet.outputAsset.sha256,
    evidenceRootHash: packet.evidenceRootHash,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    ledgerAdmissionEligible: true,
    ledgerAdmitted: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(ledgerRegisterEntryHashPayload(entry));
  return buildLedgerPacketRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

export function classifyCanonLedgerReadiness({ policy, masterPolicy, masterRegister, canonRegister, ledgerPacketRegister }) {
  validateCanonLedgerPolicy(policy);
  validateMasterReviewPolicy(masterPolicy);
  validateMasterCandidateRegister(masterRegister, { policy: masterPolicy });
  validateCanonRegister(canonRegister, { policy });
  validateLedgerPacketRegister(ledgerPacketRegister, { policy });
  const masterCandidateAvailable = masterRegister.masterCandidateCount > 0;
  const canonPromoted = canonRegister.canonRecordCount > 0;
  const ledgerPacketReady = ledgerPacketRegister.packetCount > 0;
  let status = 'BLOCKED_NO_MASTER_CANDIDATE';
  if (masterCandidateAvailable && !canonPromoted) status = 'MASTER_CANDIDATE_READY_CANON_REVIEW_REQUIRED';
  if (canonPromoted && !ledgerPacketReady) status = 'CANON_PROMOTED_LEDGER_PACKET_REQUIRED';
  if (ledgerPacketReady) status = 'LEDGER_ADMISSION_PACKET_READY_LEDGER_DECISION_PENDING';
  return {
    status,
    masterCandidateAvailable,
    masterCandidateCount: masterRegister.masterCandidateCount,
    canonPromoted,
    canonRecordCount: canonRegister.canonRecordCount,
    ledgerAdmissionPacketReady: ledgerPacketReady,
    ledgerAdmissionPacketCount: ledgerPacketRegister.packetCount,
    ledgerAdmittedCount: 0,
    networkReleaseEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
}
