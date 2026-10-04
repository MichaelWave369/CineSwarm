import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import { validateReleaseCandidatePackage } from './ledger-release-candidate.js';
import {
  validateNetworkReleasePolicy,
  validatePublicReleaseReceipt,
  validatePublicReleaseRegister,
} from './network-release.js';

export const CINESWARM_RELEASE_LIFECYCLE_POLICY_SCHEMA = 'parallax.cineswarm.release-lifecycle-policy.c1.16.v0.1';
export const CINESWARM_WITHDRAWAL_REVIEW_SCHEMA = 'parallax.cineswarm.withdrawal-review.c1.16.v0.1';
export const CINESWARM_WITHDRAWAL_CEREMONY_SCHEMA = 'parallax.cineswarm.withdrawal-ceremony.c1.16.v0.1';
export const CINESWARM_WITHDRAWAL_CONFIRMATION_SCHEMA = 'parallax.cineswarm.withdrawal-confirmation.c1.16.v0.1';
export const CINESWARM_WITHDRAWAL_RECEIPT_SCHEMA = 'parallax.cineswarm.withdrawal-receipt.c1.16.v0.1';
export const CINESWARM_CORRECTION_REVIEW_SCHEMA = 'parallax.cineswarm.correction-review.c1.16.v0.1';
export const CINESWARM_SUPERSESSION_CEREMONY_SCHEMA = 'parallax.cineswarm.supersession-ceremony.c1.16.v0.1';
export const CINESWARM_SUPERSESSION_RECEIPT_SCHEMA = 'parallax.cineswarm.supersession-receipt.c1.16.v0.1';
export const CINESWARM_RELEASE_LIFECYCLE_REGISTER_SCHEMA = 'parallax.cineswarm.release-lifecycle-register.c1.16.v0.1';

export const C1_16_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_16_WITHDRAWAL_DECISION = 'AUTHORIZE_EXACT_PUBLIC_RELEASE_WITHDRAWAL';
export const C1_16_SUPERSESSION_DECISION = 'AUTHORIZE_EXACT_RELEASE_SUPERSESSION';
export const C1_16_WITHDRAWAL_REVIEW_DECISIONS = ['APPROVE_WITHDRAWAL', 'REJECT', 'HOLD'];
export const C1_16_CORRECTION_REVIEW_DECISIONS = ['APPROVE_CORRECTION_FOR_RERELEASE', 'REJECT', 'HOLD'];
export const C1_16_WITHDRAWAL_REASONS = ['EDITORIAL_CORRECTION', 'RIGHTS', 'SAFETY', 'TECHNICAL', 'LEGAL', 'SUPERSEDED', 'OTHER'];
export const C1_16_CORRECTION_KINDS = ['CONTENT_OR_MASTER', 'METADATA_OR_ROUTE', 'PROVENANCE_OR_RECEIPT'];
const WITHDRAWAL_DOMAIN = 'PARALLAX-CINESWARM-C1.16-PUBLIC-WITHDRAWAL';
const SUPERSESSION_DOMAIN = 'PARALLAX-CINESWARM-C1.16-RELEASE-SUPERSESSION';

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
function findKey(keyRegistry, keyId) {
  validateSigningKeyRegistry(keyRegistry);
  const key = keyRegistry.keys.find((entry) => entry.keyId === keyId);
  if (!key) throw new Error(`signing key ${keyId} is not registered`);
  return key;
}
function validateKeyForNewSignature(key, authorityId, recordedAt) {
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new C1.16 signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('C1.16 signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('C1.16 signing key was not valid at recordedAt');
}
function validateKeyForHistoricalSignature(key, authorityId, recordedAt) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('C1.16 signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('C1.16 signature was created outside key validity');
}
function validateRoute(route, c15Policy) {
  if (!route || typeof route !== 'object') throw new Error('route must be an object');
  if (route.networkId !== c15Policy.networkId) throw new Error('route networkId mismatch');
  const path = requiredString(route.publicPath, 'route.publicPath');
  if (!path.startsWith(c15Policy.requiredPublicPathPrefix) || path.includes('..') || path.includes('\\') || path.includes('?') || path.includes('#')) throw new Error('route.publicPath is not a safe governed Network route');
  safeToken(route.contentSlug, 'route.contentSlug');
  safeToken(route.channelSlug, 'route.channelSlug');
  if (!path.endsWith(`/${route.contentSlug}`)) throw new Error('route.publicPath must end with exact contentSlug');
  if (route.visibility !== 'public') throw new Error('route.visibility must be public');
  return { routeHash: digestJson(route) };
}

export function validateReleaseLifecyclePolicy(policy) {
  if (!policy || policy.schema !== CINESWARM_RELEASE_LIFECYCLE_POLICY_SCHEMA) throw new Error('invalid C1.16 Release Lifecycle policy schema');
  for (const [value, label] of [[policy.policyId, 'policyId'], [policy.c15PolicyId, 'c15PolicyId'], [policy.c14PolicyId, 'c14PolicyId'], [policy.episodeId, 'episodeId'], [policy.sequenceId, 'sequenceId'], [policy.networkId, 'networkId']]) safeToken(value, label);
  if (policy.signatureAlgorithm !== C1_16_SIGNATURE_ALGORITHM) throw new Error(`signatureAlgorithm must remain ${C1_16_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('privateKeyCustody must remain external-human-controlled');
  for (const key of ['requireRegisteredPublicRelease', 'requireIndependentHumanWithdrawalReview', 'requireExactPublicReleaseReceipt', 'requireHistoricalReceiptPreservation', 'requireWithdrawalNotice', 'requireRouteNoLongerServeWithdrawnOutput', 'requireSignedWithdrawalCeremony', 'requireWithdrawalConfirmation', 'requireCorrectionReviewBeforeSupersession', 'requireReplacementPublicReleaseReceipt', 'appendOnlyLifecycleRegister', 'c15HistoricalRegisterImmutable', 'allowSameRouteAfterWithdrawal']) {
    if (policy[key] !== true) throw new Error(`${key} must remain true`);
  }
  for (const key of ['autoWithdrawal', 'autoSupersession', 'historyDeletionAllowed', 'relayDependency']) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function ensureRegisteredHistoricalRelease({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext }) {
  validateReleaseLifecyclePolicy(c16Policy);
  validateNetworkReleasePolicy(c15Policy);
  if (c16Policy.c15PolicyId !== c15Policy.policyId || c16Policy.episodeId !== c15Policy.episodeId || c16Policy.sequenceId !== c15Policy.sequenceId || c16Policy.networkId !== c15Policy.networkId) throw new Error('C1.16/C1.15 policy scope drift detected');
  validatePublicReleaseReceipt(publicReleaseReceipt, publicReceiptContext);
  validatePublicReleaseRegister(publicReleaseRegister, { c15Policy });
  const entry = publicReleaseRegister.entries.find((candidate) => candidate.publicReleaseReceiptHash === publicReleaseReceipt.publicReleaseReceiptHash);
  if (!entry) throw new Error('C1.16 withdrawal requires a Public Release Receipt registered in immutable C1.15 history');
  if (entry.routeHash !== publicReleaseReceipt.routeHash || entry.outputSha256 !== publicReleaseReceipt.outputSha256 || entry.releaseCandidatePackageHash !== publicReleaseReceipt.releaseCandidatePackageHash) throw new Error('C1.15 public release register lineage drift detected');
  return entry;
}

function withdrawalReviewPayload(review) { return withoutFields(review, ['reviewHash']); }
export function buildWithdrawalReview({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, authorityId, decision, reasonCode, reason, historicalReceiptPreserved, withdrawalNoticePrepared, routeWithdrawalApproved, notes, recordedAt, reviewId = null }) {
  const entry = ensureRegisteredHistoricalRelease({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext });
  if (!C1_16_WITHDRAWAL_REVIEW_DECISIONS.includes(decision)) throw new Error('unsupported Withdrawal Review decision');
  if (!C1_16_WITHDRAWAL_REASONS.includes(reasonCode)) throw new Error('unsupported withdrawal reason code');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(publicReleaseReceipt.issuedAt, 'publicReleaseReceipt.issuedAt').time) throw new Error('Withdrawal Review cannot predate Public Release Receipt');
  const allReady = historicalReceiptPreserved === true && withdrawalNoticePrepared === true && routeWithdrawalApproved === true;
  if (decision === 'APPROVE_WITHDRAWAL' && !allReady) throw new Error('Withdrawal approval requires history preservation, notice preparation, and route withdrawal approval');
  const review = {
    schema: CINESWARM_WITHDRAWAL_REVIEW_SCHEMA,
    reviewId: safeToken(reviewId ?? `${c16Policy.sequenceId}-withdrawal-review-${publicReleaseReceipt.publicReleaseReceiptHash.slice(0, 12)}`, 'reviewId'),
    policyId: c16Policy.policyId,
    c15PolicyId: c15Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    networkId: c16Policy.networkId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    reasonCode,
    reason: requiredString(reason, 'reason'),
    publicReleaseReceiptHash: publicReleaseReceipt.publicReleaseReceiptHash,
    releaseCandidatePackageHash: publicReleaseReceipt.releaseCandidatePackageHash,
    outputSha256: publicReleaseReceipt.outputSha256,
    route: structuredClone(publicReleaseReceipt.route),
    routeHash: publicReleaseReceipt.routeHash,
    sourcePublicReleaseRegisterHash: publicReleaseRegister.registerHash,
    sourcePublicReleaseRegisterRevision: publicReleaseRegister.revision,
    sourcePublicReleaseEntryHash: entry.entryHash,
    historicalReceiptPreserved: historicalReceiptPreserved === true,
    withdrawalNoticePrepared: withdrawalNoticePrepared === true,
    routeWithdrawalApproved: routeWithdrawalApproved === true,
    eligibleForWithdrawalCeremony: decision === 'APPROVE_WITHDRAWAL' && allReady,
    networkReleased: true,
    publicRelease: true,
    notes: requiredString(notes, 'notes'),
    recordedAt: time.text,
    relayDependency: false,
  };
  review.reviewHash = digestJson(withdrawalReviewPayload(review));
  return review;
}
export function validateWithdrawalReview(review, context) {
  const { c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext } = context;
  const expected = buildWithdrawalReview({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, authorityId: review.authority?.id, decision: review.decision, reasonCode: review.reasonCode, reason: review.reason, historicalReceiptPreserved: review.historicalReceiptPreserved, withdrawalNoticePrepared: review.withdrawalNoticePrepared, routeWithdrawalApproved: review.routeWithdrawalApproved, notes: review.notes, recordedAt: review.recordedAt, reviewId: review.reviewId });
  if (!review || review.schema !== CINESWARM_WITHDRAWAL_REVIEW_SCHEMA) throw new Error('invalid Withdrawal Review schema');
  for (const key of ['publicReleaseReceiptHash','releaseCandidatePackageHash','outputSha256','routeHash','sourcePublicReleaseRegisterHash','sourcePublicReleaseEntryHash']) if (review[key] !== expected[key]) throw new Error(`Withdrawal Review ${key} drift detected`);
  if (review.reviewHash !== digestJson(withdrawalReviewPayload(review))) throw new Error('Withdrawal Review self-hash mismatch');
  if (review.relayDependency !== false) throw new Error('Withdrawal Review Relay boundary violated');
  return { valid: true, eligibleForWithdrawalCeremony: review.eligibleForWithdrawalCeremony === true };
}

function withdrawalCeremonyDigestPayload(payload) { return withoutFields(payload, ['ceremonyDigest', 'algorithm', 'keyFingerprintSha256', 'signatureBase64', 'ceremonyHash']); }
function withdrawalCeremonyHashPayload(ceremony) { return withoutFields(ceremony, ['ceremonyHash']); }
function withdrawalMessage(digest, payload) { return `${WITHDRAWAL_DOMAIN}\n${payload.policyId}\n${payload.publicReleaseReceiptHash}\n${payload.routeHash}\n${digest}`; }
export function buildWithdrawalCeremonyPayload({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, withdrawalReview, authorityId, keyId, recordedAt, reason, ceremonyId = null }) {
  validateWithdrawalReview(withdrawalReview, { c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext });
  if (withdrawalReview.eligibleForWithdrawalCeremony !== true) throw new Error('Withdrawal Ceremony requires an approved Withdrawal Review');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(withdrawalReview.recordedAt, 'withdrawalReview.recordedAt').time) throw new Error('Withdrawal Ceremony cannot predate Withdrawal Review');
  const payload = {
    schema: CINESWARM_WITHDRAWAL_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${c16Policy.sequenceId}-withdrawal-ceremony-${withdrawalReview.reviewHash.slice(0, 12)}`, 'ceremonyId'),
    policyId: c16Policy.policyId,
    c15PolicyId: c15Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    networkId: c16Policy.networkId,
    decision: C1_16_WITHDRAWAL_DECISION,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    keyId: safeToken(keyId, 'keyId'),
    publicReleaseReceiptHash: publicReleaseReceipt.publicReleaseReceiptHash,
    releaseCandidatePackageHash: publicReleaseReceipt.releaseCandidatePackageHash,
    outputSha256: publicReleaseReceipt.outputSha256,
    route: structuredClone(publicReleaseReceipt.route),
    routeHash: publicReleaseReceipt.routeHash,
    withdrawalReviewHash: withdrawalReview.reviewHash,
    reason: requiredString(reason, 'reason'),
    recordedAt: time.text,
    withdrawalAuthorized: true,
    historicalReceiptPreservationRequired: true,
    withdrawalConfirmationRequired: true,
    networkReleased: true,
    publicRelease: true,
    relayDependency: false,
  };
  payload.ceremonyDigest = digestJson(withdrawalCeremonyDigestPayload(payload));
  return payload;
}
export function signWithdrawalCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!privateKeyPem || String(privateKeyPem).includes('PUBLIC KEY')) throw new Error('external Ed25519 private key is required');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  const fingerprint = publicKeyFingerprintSha256(key.publicKeyPem);
  const signatureBase64 = cryptoSign(null, Buffer.from(withdrawalMessage(payload.ceremonyDigest, payload), 'utf8'), privateKeyPem).toString('base64');
  const ceremony = { ...structuredClone(payload), algorithm: C1_16_SIGNATURE_ALGORITHM, keyFingerprintSha256: fingerprint, signatureBase64 };
  ceremony.ceremonyHash = digestJson(withdrawalCeremonyHashPayload(ceremony));
  return ceremony;
}
export function verifyWithdrawalCeremony({ ceremony, c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, withdrawalReview, keyRegistry }) {
  validateWithdrawalReview(withdrawalReview, { c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext });
  if (!ceremony || ceremony.schema !== CINESWARM_WITHDRAWAL_CEREMONY_SCHEMA) throw new Error('invalid Withdrawal Ceremony schema');
  if (ceremony.decision !== C1_16_WITHDRAWAL_DECISION || ceremony.withdrawalAuthorized !== true || ceremony.historicalReceiptPreservationRequired !== true || ceremony.withdrawalConfirmationRequired !== true || ceremony.networkReleased !== true || ceremony.publicRelease !== true || ceremony.relayDependency !== false) throw new Error('Withdrawal Ceremony state invariants violated');
  if (ceremony.publicReleaseReceiptHash !== publicReleaseReceipt.publicReleaseReceiptHash || ceremony.releaseCandidatePackageHash !== publicReleaseReceipt.releaseCandidatePackageHash || ceremony.outputSha256 !== publicReleaseReceipt.outputSha256 || ceremony.routeHash !== publicReleaseReceipt.routeHash || ceremony.withdrawalReviewHash !== withdrawalReview.reviewHash) throw new Error('Withdrawal Ceremony lineage drift detected');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority?.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Withdrawal signing-key fingerprint mismatch');
  if (ceremony.ceremonyDigest !== digestJson(withdrawalCeremonyDigestPayload(ceremony))) throw new Error('Withdrawal Ceremony digest mismatch');
  if (ceremony.ceremonyHash !== digestJson(withdrawalCeremonyHashPayload(ceremony))) throw new Error('Withdrawal Ceremony self-hash mismatch');
  if (!cryptoVerify(null, Buffer.from(withdrawalMessage(ceremony.ceremonyDigest, ceremony), 'utf8'), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'))) throw new Error('Withdrawal Ceremony signature verification failed');
  return { valid: true, withdrawalAuthorized: true, publicReleaseStillHistorical: true };
}

function withdrawalConfirmationPayload(value) { return withoutFields(value, ['withdrawalConfirmationHash']); }
export function buildWithdrawalConfirmation({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, withdrawalReview, withdrawalCeremony, keyRegistry, verifierId, withdrawalEvidenceSha256, observedHttpStatus, withdrawnOutputNoLongerServed, withdrawalNoticeReachable, historicalReceiptReachable, confirmedAt, confirmationId = null }) {
  verifyWithdrawalCeremony({ ceremony: withdrawalCeremony, c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, withdrawalReview, keyRegistry });
  const time = parseTime(confirmedAt, 'confirmedAt');
  if (time.time < parseTime(withdrawalCeremony.recordedAt, 'withdrawalCeremony.recordedAt').time) throw new Error('Withdrawal Confirmation cannot predate authorization');
  if (![200, 404, 410].includes(observedHttpStatus)) throw new Error('Withdrawal Confirmation HTTP status must be 200, 404, or 410');
  if (withdrawnOutputNoLongerServed !== true || withdrawalNoticeReachable !== true || historicalReceiptReachable !== true) throw new Error('Withdrawal Confirmation requires output removal plus reachable notice and historical receipt');
  const confirmation = {
    schema: CINESWARM_WITHDRAWAL_CONFIRMATION_SCHEMA,
    confirmationId: safeToken(confirmationId ?? `${c16Policy.sequenceId}-withdrawal-confirmation-${withdrawalCeremony.ceremonyHash.slice(0, 12)}`, 'confirmationId'),
    policyId: c16Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    networkId: c16Policy.networkId,
    verifier: { kind: 'parallax-network-withdrawal-verifier', id: safeToken(verifierId, 'verifierId') },
    withdrawalEvidenceSha256: ensureSha256(withdrawalEvidenceSha256, 'withdrawalEvidenceSha256'),
    publicReleaseReceiptHash: publicReleaseReceipt.publicReleaseReceiptHash,
    withdrawalReviewHash: withdrawalReview.reviewHash,
    withdrawalCeremonyHash: withdrawalCeremony.ceremonyHash,
    route: structuredClone(publicReleaseReceipt.route),
    routeHash: publicReleaseReceipt.routeHash,
    outputSha256: publicReleaseReceipt.outputSha256,
    observedHttpStatus,
    withdrawnOutputNoLongerServed: true,
    withdrawalNoticeReachable: true,
    historicalReceiptReachable: true,
    confirmedAt: time.text,
    currentNetworkReleased: false,
    currentPublicRelease: false,
    historicalPublicRelease: true,
    relayDependency: false,
  };
  confirmation.withdrawalConfirmationHash = digestJson(withdrawalConfirmationPayload(confirmation));
  return confirmation;
}
export function validateWithdrawalConfirmation(confirmation, context) {
  const expected = buildWithdrawalConfirmation({ ...context, verifierId: confirmation.verifier?.id, withdrawalEvidenceSha256: confirmation.withdrawalEvidenceSha256, observedHttpStatus: confirmation.observedHttpStatus, withdrawnOutputNoLongerServed: confirmation.withdrawnOutputNoLongerServed, withdrawalNoticeReachable: confirmation.withdrawalNoticeReachable, historicalReceiptReachable: confirmation.historicalReceiptReachable, confirmedAt: confirmation.confirmedAt, confirmationId: confirmation.confirmationId });
  if (!confirmation || confirmation.schema !== CINESWARM_WITHDRAWAL_CONFIRMATION_SCHEMA) throw new Error('invalid Withdrawal Confirmation schema');
  if (confirmation.withdrawalConfirmationHash !== digestJson(withdrawalConfirmationPayload(confirmation))) throw new Error('Withdrawal Confirmation self-hash mismatch');
  if (confirmation.routeHash !== expected.routeHash || confirmation.outputSha256 !== expected.outputSha256 || confirmation.publicReleaseReceiptHash !== expected.publicReleaseReceiptHash || confirmation.withdrawalCeremonyHash !== expected.withdrawalCeremonyHash) throw new Error('Withdrawal Confirmation lineage drift detected');
  return { valid: true, currentPublicRelease: false, historicalPublicRelease: true };
}

function withdrawalReceiptPayload(value) { return withoutFields(value, ['withdrawalReceiptHash']); }
export function buildWithdrawalReceipt({ c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, withdrawalReview, withdrawalCeremony, keyRegistry, withdrawalConfirmation, issuedAt, receiptId = null }) {
  validateWithdrawalConfirmation(withdrawalConfirmation, { c16Policy, c15Policy, publicReleaseReceipt, publicReleaseRegister, publicReceiptContext, withdrawalReview, withdrawalCeremony, keyRegistry });
  const time = parseTime(issuedAt, 'issuedAt');
  if (time.time < parseTime(withdrawalConfirmation.confirmedAt, 'withdrawalConfirmation.confirmedAt').time) throw new Error('Withdrawal Receipt cannot predate confirmation');
  const evidenceInventory = [
    { kind: 'c1-15-public-release-receipt', id: publicReleaseReceipt.receiptId, sha256: publicReleaseReceipt.publicReleaseReceiptHash },
    { kind: 'c1-16-withdrawal-review', id: withdrawalReview.reviewId, sha256: withdrawalReview.reviewHash },
    { kind: 'c1-16-withdrawal-ceremony', id: withdrawalCeremony.ceremonyId, sha256: withdrawalCeremony.ceremonyHash },
    { kind: 'c1-16-withdrawal-confirmation', id: withdrawalConfirmation.confirmationId, sha256: withdrawalConfirmation.withdrawalConfirmationHash },
  ];
  const receipt = {
    schema: CINESWARM_WITHDRAWAL_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${c16Policy.sequenceId}-withdrawal-receipt-${withdrawalConfirmation.withdrawalConfirmationHash.slice(0, 12)}`, 'receiptId'),
    policyId: c16Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    networkId: c16Policy.networkId,
    state: 'WITHDRAWN_HISTORY_PRESERVED',
    publicReleaseReceiptHash: publicReleaseReceipt.publicReleaseReceiptHash,
    releaseCandidatePackageHash: publicReleaseReceipt.releaseCandidatePackageHash,
    outputSha256: publicReleaseReceipt.outputSha256,
    route: structuredClone(publicReleaseReceipt.route),
    routeHash: publicReleaseReceipt.routeHash,
    withdrawalReviewHash: withdrawalReview.reviewHash,
    withdrawalCeremonyHash: withdrawalCeremony.ceremonyHash,
    withdrawalConfirmationHash: withdrawalConfirmation.withdrawalConfirmationHash,
    evidenceInventory,
    withdrawalEvidenceRootHash: digestJson(evidenceInventory),
    issuedAt: time.text,
    currentNetworkReleased: false,
    currentPublicRelease: false,
    historicalPublicRelease: true,
    historicalPublicReleaseReceiptPreserved: true,
    correctionOrSupersessionRequiredForReplacement: true,
    relayDependency: false,
  };
  receipt.withdrawalReceiptHash = digestJson(withdrawalReceiptPayload(receipt));
  return receipt;
}
export function validateWithdrawalReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_WITHDRAWAL_RECEIPT_SCHEMA) throw new Error('invalid Withdrawal Receipt schema');
  const expected = buildWithdrawalReceipt({ ...context, issuedAt: receipt.issuedAt, receiptId: receipt.receiptId });
  for (const key of ['publicReleaseReceiptHash','releaseCandidatePackageHash','outputSha256','routeHash','withdrawalReviewHash','withdrawalCeremonyHash','withdrawalConfirmationHash','withdrawalEvidenceRootHash']) if (receipt[key] !== expected[key]) throw new Error(`Withdrawal Receipt ${key} drift detected`);
  if (JSON.stringify(receipt.evidenceInventory) !== JSON.stringify(expected.evidenceInventory)) throw new Error('Withdrawal Receipt evidence inventory drift detected');
  if (receipt.withdrawalReceiptHash !== digestJson(withdrawalReceiptPayload(receipt))) throw new Error('Withdrawal Receipt self-hash mismatch');
  if (receipt.currentPublicRelease !== false || receipt.historicalPublicRelease !== true || receipt.relayDependency !== false) throw new Error('Withdrawal Receipt lifecycle invariants violated');
  return { valid: true, currentPublicRelease: false, historicalPublicRelease: true };
}

function correctionReviewPayload(value) { return withoutFields(value, ['correctionReviewHash']); }
export function buildCorrectionReview({ c16Policy, c15Policy, c14Policy, withdrawalReceipt, withdrawalReceiptContext, replacementReleasePackage, replacementReleasePackageContext, targetRoute, authorityId, decision, correctionKind, changeSummary, notes, recordedAt, reviewId = null }) {
  validateWithdrawalReceipt(withdrawalReceipt, withdrawalReceiptContext);
  if (c16Policy.c14PolicyId !== c14Policy.policyId || c16Policy.c15PolicyId !== c15Policy.policyId) throw new Error('C1.16 correction policy scope does not match supplied C1.14/C1.15 policies');
  validateReleaseCandidatePackage(replacementReleasePackage, replacementReleasePackageContext);
  if (!C1_16_CORRECTION_REVIEW_DECISIONS.includes(decision)) throw new Error('unsupported Correction Review decision');
  if (!C1_16_CORRECTION_KINDS.includes(correctionKind)) throw new Error('unsupported correction kind');
  const { routeHash } = validateRoute(targetRoute, c15Policy);
  if (correctionKind === 'CONTENT_OR_MASTER' && replacementReleasePackage.outputAsset.sha256 === withdrawalReceipt.outputSha256) throw new Error('CONTENT_OR_MASTER correction requires a different Master output SHA-256');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(withdrawalReceipt.issuedAt, 'withdrawalReceipt.issuedAt').time) throw new Error('Correction Review cannot predate Withdrawal Receipt');
  const review = {
    schema: CINESWARM_CORRECTION_REVIEW_SCHEMA,
    reviewId: safeToken(reviewId ?? `${c16Policy.sequenceId}-correction-review-${replacementReleasePackage.releaseCandidatePackageHash.slice(0, 12)}`, 'reviewId'),
    policyId: c16Policy.policyId,
    c15PolicyId: c15Policy.policyId,
    c14PolicyId: c14Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    correctionKind,
    changeSummary: requiredString(changeSummary, 'changeSummary'),
    withdrawnPublicReleaseReceiptHash: withdrawalReceipt.publicReleaseReceiptHash,
    withdrawalReceiptHash: withdrawalReceipt.withdrawalReceiptHash,
    originalOutputSha256: withdrawalReceipt.outputSha256,
    replacementReleaseCandidatePackageHash: replacementReleasePackage.releaseCandidatePackageHash,
    replacementOutputSha256: replacementReleasePackage.outputAsset.sha256,
    targetRoute: structuredClone(targetRoute),
    targetRouteHash: routeHash,
    eligibleForNewC1_15ReleaseCeremony: decision === 'APPROVE_CORRECTION_FOR_RERELEASE',
    replacementNetworkReleased: false,
    replacementPublicRelease: false,
    notes: requiredString(notes, 'notes'),
    recordedAt: time.text,
    relayDependency: false,
  };
  review.correctionReviewHash = digestJson(correctionReviewPayload(review));
  return review;
}
export function validateCorrectionReview(review, context) {
  if (!review || review.schema !== CINESWARM_CORRECTION_REVIEW_SCHEMA) throw new Error('invalid Correction Review schema');
  const expected = buildCorrectionReview({ ...context, targetRoute: review.targetRoute, authorityId: review.authority?.id, decision: review.decision, correctionKind: review.correctionKind, changeSummary: review.changeSummary, notes: review.notes, recordedAt: review.recordedAt, reviewId: review.reviewId });
  for (const key of ['withdrawnPublicReleaseReceiptHash','withdrawalReceiptHash','originalOutputSha256','replacementReleaseCandidatePackageHash','replacementOutputSha256','targetRouteHash']) if (review[key] !== expected[key]) throw new Error(`Correction Review ${key} drift detected`);
  if (review.correctionReviewHash !== digestJson(correctionReviewPayload(review))) throw new Error('Correction Review self-hash mismatch');
  return { valid: true, eligibleForNewC1_15ReleaseCeremony: review.eligibleForNewC1_15ReleaseCeremony === true };
}

function supersessionDigestPayload(value) { return withoutFields(value, ['ceremonyDigest', 'algorithm', 'keyFingerprintSha256', 'signatureBase64', 'ceremonyHash']); }
function supersessionHashPayload(value) { return withoutFields(value, ['ceremonyHash']); }
function supersessionMessage(digest, value) { return `${SUPERSESSION_DOMAIN}\n${value.policyId}\n${value.withdrawnPublicReleaseReceiptHash}\n${value.replacementPublicReleaseReceiptHash}\n${digest}`; }
export function buildSupersessionCeremonyPayload({ c16Policy, c15Policy, c14Policy, withdrawalReceipt, withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt, replacementPublicReceiptContext, authorityId, keyId, reason, recordedAt, ceremonyId = null }) {
  validateCorrectionReview(correctionReview, correctionReviewContext);
  if (correctionReview.eligibleForNewC1_15ReleaseCeremony !== true) throw new Error('Supersession requires an approved Correction Review');
  validatePublicReleaseReceipt(replacementPublicReleaseReceipt, replacementPublicReceiptContext);
  if (replacementPublicReleaseReceipt.releaseCandidatePackageHash !== correctionReview.replacementReleaseCandidatePackageHash || replacementPublicReleaseReceipt.outputSha256 !== correctionReview.replacementOutputSha256 || replacementPublicReleaseReceipt.routeHash !== correctionReview.targetRouteHash) throw new Error('replacement Public Release Receipt does not match approved correction');
  if (replacementPublicReleaseReceipt.publicReleaseReceiptHash === withdrawalReceipt.publicReleaseReceiptHash) throw new Error('replacement Public Release Receipt must be distinct from withdrawn receipt');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(replacementPublicReleaseReceipt.issuedAt, 'replacementPublicReleaseReceipt.issuedAt').time) throw new Error('Supersession Ceremony cannot predate replacement Public Release Receipt');
  const payload = {
    schema: CINESWARM_SUPERSESSION_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${c16Policy.sequenceId}-supersession-${replacementPublicReleaseReceipt.publicReleaseReceiptHash.slice(0, 12)}`, 'ceremonyId'),
    policyId: c16Policy.policyId,
    c15PolicyId: c15Policy.policyId,
    c14PolicyId: c14Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    decision: C1_16_SUPERSESSION_DECISION,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    keyId: safeToken(keyId, 'keyId'),
    withdrawnPublicReleaseReceiptHash: withdrawalReceipt.publicReleaseReceiptHash,
    withdrawalReceiptHash: withdrawalReceipt.withdrawalReceiptHash,
    correctionReviewHash: correctionReview.correctionReviewHash,
    replacementPublicReleaseReceiptHash: replacementPublicReleaseReceipt.publicReleaseReceiptHash,
    replacementReleaseCandidatePackageHash: replacementPublicReleaseReceipt.releaseCandidatePackageHash,
    replacementOutputSha256: replacementPublicReleaseReceipt.outputSha256,
    replacementRoute: structuredClone(replacementPublicReleaseReceipt.route),
    replacementRouteHash: replacementPublicReleaseReceipt.routeHash,
    reason: requiredString(reason, 'reason'),
    recordedAt: time.text,
    supersessionAuthorized: true,
    withdrawnHistoryPreserved: true,
    replacementPublicReleaseAlreadyConfirmed: true,
    relayDependency: false,
  };
  payload.ceremonyDigest = digestJson(supersessionDigestPayload(payload));
  return payload;
}
export function signSupersessionCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!privateKeyPem || String(privateKeyPem).includes('PUBLIC KEY')) throw new Error('external Ed25519 private key is required');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  const ceremony = { ...structuredClone(payload), algorithm: C1_16_SIGNATURE_ALGORITHM, keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem), signatureBase64: cryptoSign(null, Buffer.from(supersessionMessage(payload.ceremonyDigest, payload), 'utf8'), privateKeyPem).toString('base64') };
  ceremony.ceremonyHash = digestJson(supersessionHashPayload(ceremony));
  return ceremony;
}
export function verifySupersessionCeremony({ ceremony, c16Policy, c15Policy, c14Policy, withdrawalReceipt, withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt, replacementPublicReceiptContext, keyRegistry }) {
  validateWithdrawalReceipt(withdrawalReceipt, withdrawalReceiptContext);
  validateCorrectionReview(correctionReview, correctionReviewContext);
  validatePublicReleaseReceipt(replacementPublicReleaseReceipt, replacementPublicReceiptContext);
  if (!ceremony || ceremony.schema !== CINESWARM_SUPERSESSION_CEREMONY_SCHEMA) throw new Error('invalid Supersession Ceremony schema');
  if (ceremony.decision !== C1_16_SUPERSESSION_DECISION || ceremony.supersessionAuthorized !== true || ceremony.withdrawnHistoryPreserved !== true || ceremony.replacementPublicReleaseAlreadyConfirmed !== true || ceremony.relayDependency !== false) throw new Error('Supersession Ceremony state invariants violated');
  if (ceremony.withdrawnPublicReleaseReceiptHash !== withdrawalReceipt.publicReleaseReceiptHash || ceremony.withdrawalReceiptHash !== withdrawalReceipt.withdrawalReceiptHash || ceremony.correctionReviewHash !== correctionReview.correctionReviewHash || ceremony.replacementPublicReleaseReceiptHash !== replacementPublicReleaseReceipt.publicReleaseReceiptHash || ceremony.replacementReleaseCandidatePackageHash !== replacementPublicReleaseReceipt.releaseCandidatePackageHash || ceremony.replacementOutputSha256 !== replacementPublicReleaseReceipt.outputSha256 || ceremony.replacementRouteHash !== replacementPublicReleaseReceipt.routeHash) throw new Error('Supersession Ceremony lineage drift detected');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority?.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Supersession signing-key fingerprint mismatch');
  if (ceremony.ceremonyDigest !== digestJson(supersessionDigestPayload(ceremony))) throw new Error('Supersession Ceremony digest mismatch');
  if (ceremony.ceremonyHash !== digestJson(supersessionHashPayload(ceremony))) throw new Error('Supersession Ceremony self-hash mismatch');
  if (!cryptoVerify(null, Buffer.from(supersessionMessage(ceremony.ceremonyDigest, ceremony), 'utf8'), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'))) throw new Error('Supersession Ceremony signature verification failed');
  return { valid: true, supersessionAuthorized: true };
}

function supersessionReceiptPayload(value) { return withoutFields(value, ['supersessionReceiptHash']); }
export function buildSupersessionReceipt({ c16Policy, c15Policy, c14Policy, withdrawalReceipt, withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt, replacementPublicReceiptContext, supersessionCeremony, keyRegistry, issuedAt, receiptId = null }) {
  verifySupersessionCeremony({ ceremony: supersessionCeremony, c16Policy, c15Policy, c14Policy, withdrawalReceipt, withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt, replacementPublicReceiptContext, keyRegistry });
  const time = parseTime(issuedAt, 'issuedAt');
  if (time.time < parseTime(supersessionCeremony.recordedAt, 'supersessionCeremony.recordedAt').time) throw new Error('Supersession Receipt cannot predate ceremony');
  const evidenceInventory = [
    { kind: 'c1-16-withdrawal-receipt', id: withdrawalReceipt.receiptId, sha256: withdrawalReceipt.withdrawalReceiptHash },
    { kind: 'c1-16-correction-review', id: correctionReview.reviewId, sha256: correctionReview.correctionReviewHash },
    { kind: 'replacement-c1-15-public-release-receipt', id: replacementPublicReleaseReceipt.receiptId, sha256: replacementPublicReleaseReceipt.publicReleaseReceiptHash },
    { kind: 'c1-16-supersession-ceremony', id: supersessionCeremony.ceremonyId, sha256: supersessionCeremony.ceremonyHash },
  ];
  const receipt = {
    schema: CINESWARM_SUPERSESSION_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${c16Policy.sequenceId}-supersession-receipt-${supersessionCeremony.ceremonyHash.slice(0, 12)}`, 'receiptId'),
    policyId: c16Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    state: 'SUPERSEDED_WITH_HISTORY_PRESERVED',
    withdrawnPublicReleaseReceiptHash: withdrawalReceipt.publicReleaseReceiptHash,
    withdrawalReceiptHash: withdrawalReceipt.withdrawalReceiptHash,
    correctionReviewHash: correctionReview.correctionReviewHash,
    replacementPublicReleaseReceiptHash: replacementPublicReleaseReceipt.publicReleaseReceiptHash,
    replacementReleaseCandidatePackageHash: replacementPublicReleaseReceipt.releaseCandidatePackageHash,
    replacementOutputSha256: replacementPublicReleaseReceipt.outputSha256,
    replacementRoute: structuredClone(replacementPublicReleaseReceipt.route),
    replacementRouteHash: replacementPublicReleaseReceipt.routeHash,
    supersessionCeremonyHash: supersessionCeremony.ceremonyHash,
    evidenceInventory,
    supersessionEvidenceRootHash: digestJson(evidenceInventory),
    issuedAt: time.text,
    historicalWithdrawnReleasePreserved: true,
    replacementNetworkReleased: true,
    replacementPublicRelease: true,
    relayDependency: false,
  };
  receipt.supersessionReceiptHash = digestJson(supersessionReceiptPayload(receipt));
  return receipt;
}
export function validateSupersessionReceipt(receipt, context) {
  if (!receipt || receipt.schema !== CINESWARM_SUPERSESSION_RECEIPT_SCHEMA) throw new Error('invalid Supersession Receipt schema');
  const expected = buildSupersessionReceipt({ ...context, issuedAt: receipt.issuedAt, receiptId: receipt.receiptId });
  for (const key of ['withdrawnPublicReleaseReceiptHash','withdrawalReceiptHash','correctionReviewHash','replacementPublicReleaseReceiptHash','replacementReleaseCandidatePackageHash','replacementOutputSha256','replacementRouteHash','supersessionCeremonyHash','supersessionEvidenceRootHash']) if (receipt[key] !== expected[key]) throw new Error(`Supersession Receipt ${key} drift detected`);
  if (receipt.supersessionReceiptHash !== digestJson(supersessionReceiptPayload(receipt))) throw new Error('Supersession Receipt self-hash mismatch');
  if (receipt.historicalWithdrawnReleasePreserved !== true || receipt.replacementPublicRelease !== true || receipt.relayDependency !== false) throw new Error('Supersession Receipt lifecycle invariants violated');
  return { valid: true, replacementPublicRelease: true };
}

function lifecycleEntryPayload(value) { return withoutFields(value, ['entryHash']); }
function lifecycleRegisterPayload(value) { return withoutFields(value, ['registerHash']); }
export function buildReleaseLifecycleRegister({ c16Policy, c15Policy, c15PublicReleaseRegister, entries = [], revision = 0, recordedAt }) {
  validateReleaseLifecyclePolicy(c16Policy);
  validateNetworkReleasePolicy(c15Policy);
  if (c16Policy.c15PolicyId !== c15Policy.policyId) throw new Error('C1.16 lifecycle policy is not bound to supplied C1.15 policy');
  validatePublicReleaseRegister(c15PublicReleaseRegister, { c15Policy });
  if (!Array.isArray(entries) || revision !== entries.length) throw new Error('Release Lifecycle Register revision must equal entry count');
  const releases = new Map();
  for (const entry of c15PublicReleaseRegister.entries) releases.set(entry.publicReleaseReceiptHash, { active: true, routeHash: entry.routeHash, outputSha256: entry.outputSha256, superseded: false, source: 'c1.15' });
  let previous = null;
  let withdrawalCount = 0;
  let supersessionCount = 0;
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Release Lifecycle Register hash chain broken at entry ${index}`);
    ensureSha256(entry.entryHash, `entries[${index}].entryHash`);
    if (entry.entryHash !== digestJson(lifecycleEntryPayload(entry))) throw new Error(`Release Lifecycle Register entry ${index} self-hash mismatch`);
    if (entry.eventType === 'WITHDRAWN') {
      const target = releases.get(entry.publicReleaseReceiptHash);
      if (!target || target.active !== true) throw new Error('WITHDRAWN event must target an active historical release');
      ensureSha256(entry.withdrawalReceiptHash, 'withdrawalReceiptHash');
      target.active = false; withdrawalCount += 1;
    } else if (entry.eventType === 'SUPERSEDED') {
      const target = releases.get(entry.withdrawnPublicReleaseReceiptHash);
      if (!target || target.active !== false || target.superseded === true) throw new Error('SUPERSEDED event requires a withdrawn, not-yet-superseded release');
      if (releases.has(entry.replacementPublicReleaseReceiptHash)) throw new Error('replacement Public Release Receipt is already in lifecycle history');
      ensureSha256(entry.supersessionReceiptHash, 'supersessionReceiptHash');
      releases.set(entry.replacementPublicReleaseReceiptHash, { active: true, routeHash: entry.replacementRouteHash, outputSha256: entry.replacementOutputSha256, superseded: false, source: 'c1.16' });
      target.superseded = true; supersessionCount += 1;
    } else throw new Error('unsupported Release Lifecycle eventType');
    if (entry.relayDependency !== false) throw new Error('Release Lifecycle event Relay boundary violated');
    previous = entry.entryHash;
  }
  const activePublicReleaseCount = [...releases.values()].filter((value) => value.active).length;
  const historicalPublicReleaseCount = releases.size;
  const register = {
    schema: CINESWARM_RELEASE_LIFECYCLE_REGISTER_SCHEMA,
    registerId: `${c16Policy.sequenceId}-release-lifecycle-register`,
    policyId: c16Policy.policyId,
    episodeId: c16Policy.episodeId,
    sequenceId: c16Policy.sequenceId,
    networkId: c16Policy.networkId,
    sourceC15PublicReleaseRegisterHash: c15PublicReleaseRegister.registerHash,
    sourceC15PublicReleaseRegisterRevision: c15PublicReleaseRegister.revision,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    entries: structuredClone(entries),
    entryCount: entries.length,
    headHash: previous,
    status: activePublicReleaseCount > 0 ? 'ACTIVE_PUBLIC_RELEASE_PRESENT' : (historicalPublicReleaseCount > 0 ? 'NO_ACTIVE_RELEASE_HISTORY_PRESERVED' : 'EMPTY_NO_PUBLIC_RELEASE_HISTORY'),
    historicalPublicReleaseCount,
    activePublicReleaseCount,
    withdrawalCount,
    supersessionCount,
    currentPublicRelease: activePublicReleaseCount > 0,
    historicalPublicRelease: historicalPublicReleaseCount > 0,
    relayDependency: false,
  };
  register.registerHash = digestJson(lifecycleRegisterPayload(register));
  return register;
}
export function validateReleaseLifecycleRegister(register, { c16Policy, c15Policy, c15PublicReleaseRegister }) {
  if (!register || register.schema !== CINESWARM_RELEASE_LIFECYCLE_REGISTER_SCHEMA) throw new Error('invalid Release Lifecycle Register schema');
  const rebuilt = buildReleaseLifecycleRegister({ c16Policy, c15Policy, c15PublicReleaseRegister, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['sourceC15PublicReleaseRegisterHash','sourceC15PublicReleaseRegisterRevision','status','headHash','historicalPublicReleaseCount','activePublicReleaseCount','withdrawalCount','supersessionCount','currentPublicRelease','historicalPublicRelease']) if (register[key] !== rebuilt[key]) throw new Error(`Release Lifecycle Register ${key} mismatch`);
  if (register.registerHash !== digestJson(lifecycleRegisterPayload(register))) throw new Error('Release Lifecycle Register self-hash mismatch');
  return { valid: true, revision: register.revision, currentPublicRelease: register.currentPublicRelease, historicalPublicRelease: register.historicalPublicRelease };
}
export function appendWithdrawalToLifecycleRegister({ register, c16Policy, c15Policy, c15PublicReleaseRegister, withdrawalReceipt, withdrawalReceiptContext, recordedAt }) {
  validateReleaseLifecycleRegister(register, { c16Policy, c15Policy, c15PublicReleaseRegister });
  validateWithdrawalReceipt(withdrawalReceipt, withdrawalReceiptContext);
  if (register.entries.some((entry) => entry.publicReleaseReceiptHash === withdrawalReceipt.publicReleaseReceiptHash || entry.withdrawalReceiptHash === withdrawalReceipt.withdrawalReceiptHash)) throw new Error('public release is already withdrawn in lifecycle history');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(withdrawalReceipt.issuedAt, 'withdrawalReceipt.issuedAt').time) throw new Error('lifecycle withdrawal event cannot predate Withdrawal Receipt');
  const entry = {
    entryId: `${c16Policy.sequenceId}-lifecycle-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'WITHDRAWN',
    publicReleaseReceiptHash: withdrawalReceipt.publicReleaseReceiptHash,
    withdrawalReceiptHash: withdrawalReceipt.withdrawalReceiptHash,
    routeHash: withdrawalReceipt.routeHash,
    outputSha256: withdrawalReceipt.outputSha256,
    previousEntryHash: register.headHash,
    recordedAt: time.text,
    currentPublicRelease: false,
    historicalPublicRelease: true,
    relayDependency: false,
  };
  entry.entryHash = digestJson(lifecycleEntryPayload(entry));
  return buildReleaseLifecycleRegister({ c16Policy, c15Policy, c15PublicReleaseRegister, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}
export function appendSupersessionToLifecycleRegister({ register, c16Policy, c15Policy, c15PublicReleaseRegister, supersessionReceipt, supersessionReceiptContext, recordedAt }) {
  validateReleaseLifecycleRegister(register, { c16Policy, c15Policy, c15PublicReleaseRegister });
  validateSupersessionReceipt(supersessionReceipt, supersessionReceiptContext);
  if (register.entries.some((entry) => entry.supersessionReceiptHash === supersessionReceipt.supersessionReceiptHash || entry.replacementPublicReleaseReceiptHash === supersessionReceipt.replacementPublicReleaseReceiptHash)) throw new Error('supersession or replacement release already recorded');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(supersessionReceipt.issuedAt, 'supersessionReceipt.issuedAt').time) throw new Error('lifecycle supersession event cannot predate Supersession Receipt');
  const entry = {
    entryId: `${c16Policy.sequenceId}-lifecycle-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'SUPERSEDED',
    withdrawnPublicReleaseReceiptHash: supersessionReceipt.withdrawnPublicReleaseReceiptHash,
    withdrawalReceiptHash: supersessionReceipt.withdrawalReceiptHash,
    supersessionReceiptHash: supersessionReceipt.supersessionReceiptHash,
    replacementPublicReleaseReceiptHash: supersessionReceipt.replacementPublicReleaseReceiptHash,
    replacementReleaseCandidatePackageHash: supersessionReceipt.replacementReleaseCandidatePackageHash,
    replacementRouteHash: supersessionReceipt.replacementRouteHash,
    replacementOutputSha256: supersessionReceipt.replacementOutputSha256,
    previousEntryHash: register.headHash,
    recordedAt: time.text,
    replacementPublicRelease: true,
    historicalWithdrawnReleasePreserved: true,
    relayDependency: false,
  };
  entry.entryHash = digestJson(lifecycleEntryPayload(entry));
  return buildReleaseLifecycleRegister({ c16Policy, c15Policy, c15PublicReleaseRegister, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}
export function classifyReleaseLifecycle({ c16Policy, c15Policy, c15PublicReleaseRegister, lifecycleRegister }) {
  validateReleaseLifecycleRegister(lifecycleRegister, { c16Policy, c15Policy, c15PublicReleaseRegister });
  let status = lifecycleRegister.status;
  return {
    status,
    historicalPublicReleaseCount: lifecycleRegister.historicalPublicReleaseCount,
    activePublicReleaseCount: lifecycleRegister.activePublicReleaseCount,
    withdrawalCount: lifecycleRegister.withdrawalCount,
    supersessionCount: lifecycleRegister.supersessionCount,
    currentPublicRelease: lifecycleRegister.currentPublicRelease,
    historicalPublicRelease: lifecycleRegister.historicalPublicRelease,
    relayDependency: false,
  };
}
