import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import {
  validateLedgerReleasePolicy,
  validateReleaseCandidatePackage,
  validateReleaseCandidateRegister,
} from './ledger-release-candidate.js';

export const CINESWARM_NETWORK_RELEASE_POLICY_SCHEMA = 'parallax.cineswarm.network-release-policy.c1.15.v0.1';
export const CINESWARM_NETWORK_RELEASE_REVIEW_SCHEMA = 'parallax.cineswarm.network-release-review.c1.15.v0.1';
export const CINESWARM_NETWORK_RELEASE_CEREMONY_SCHEMA = 'parallax.cineswarm.network-release-ceremony.c1.15.v0.1';
export const CINESWARM_PUBLICATION_CONFIRMATION_SCHEMA = 'parallax.cineswarm.publication-confirmation.c1.15.v0.1';
export const CINESWARM_PUBLIC_RELEASE_RECEIPT_SCHEMA = 'parallax.cineswarm.public-release-receipt.c1.15.v0.1';
export const CINESWARM_PUBLIC_RELEASE_REGISTER_SCHEMA = 'parallax.cineswarm.public-release-register.c1.15.v0.1';

export const C1_15_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_15_RELEASE_DECISION = 'AUTHORIZE_EXACT_PARALLAX_NETWORK_PUBLIC_RELEASE';
export const C1_15_REVIEW_DECISIONS = ['APPROVE_FOR_PUBLIC_RELEASE', 'REJECT', 'HOLD'];
const NETWORK_RELEASE_DOMAIN = 'PARALLAX-CINESWARM-C1.15-NETWORK-RELEASE';

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

function validateRoute(route, policy) {
  if (!route || typeof route !== 'object') throw new Error('public route must be an object');
  if (route.networkId !== policy.networkId) throw new Error('public route networkId does not match C1.15 policy');
  const publicPath = requiredString(route.publicPath, 'route.publicPath');
  if (!publicPath.startsWith(policy.requiredPublicPathPrefix)) throw new Error(`route.publicPath must remain under ${policy.requiredPublicPathPrefix}`);
  if (!publicPath.startsWith('/') || publicPath.includes('..') || publicPath.includes('\\') || publicPath.includes('?') || publicPath.includes('#')) throw new Error('route.publicPath is not a safe canonical public path');
  safeToken(route.contentSlug, 'route.contentSlug');
  safeToken(route.channelSlug, 'route.channelSlug');
  if (!publicPath.endsWith(`/${route.contentSlug}`)) throw new Error('route.publicPath must end with the exact contentSlug');
  if (route.visibility !== 'public') throw new Error('route.visibility must be public');
  return { valid: true, routeHash: digestJson(route) };
}

function findKey(keyRegistry, keyId) {
  validateSigningKeyRegistry(keyRegistry);
  const key = keyRegistry.keys.find((entry) => entry.keyId === keyId);
  if (!key) throw new Error(`signing key ${keyId} is not registered`);
  return key;
}

function validateKeyForNewSignature(key, authorityId, recordedAt) {
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new Network Release signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Network Release signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Network Release signing key was not valid at recordedAt');
}

function validateKeyForHistoricalSignature(key, authorityId, recordedAt) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Network Release signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Network Release signature was created outside key validity');
}

export function validateNetworkReleasePolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('C1.15 Network Release policy must be an object');
  if (policy.schema !== CINESWARM_NETWORK_RELEASE_POLICY_SCHEMA) throw new Error(`unsupported C1.15 policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.ledgerReleasePolicyId, 'ledgerReleasePolicyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  safeToken(policy.networkId, 'networkId');
  requiredString(policy.requiredPublicPathPrefix, 'requiredPublicPathPrefix');
  if (!policy.requiredPublicPathPrefix.startsWith('/') || policy.requiredPublicPathPrefix.includes('..')) throw new Error('requiredPublicPathPrefix must be a safe absolute path prefix');
  if (policy.signatureAlgorithm !== C1_15_SIGNATURE_ALGORITHM) throw new Error(`signatureAlgorithm must remain ${C1_15_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('C1.15 private key custody must remain external-human-controlled');
  for (const key of [
    'requireRegisteredReleaseCandidatePackage',
    'requireIndependentHumanReleaseReview',
    'requireExactReleaseEvidenceRoot',
    'requireExactLedgerAdmissionReceipt',
    'requireExactMasterOutputHash',
    'requireExactPublicRoute',
    'requireHumanNetworkReleaseSignature',
    'requirePublicationConfirmationBeforePublicReceipt',
    'requirePublicReachabilityVerification',
    'requirePublishedContentReceipt',
    'appendOnlyPublicReleaseRegister',
    'requireExplicitWithdrawalForUnpublish',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of ['autoNetworkRelease', 'autoPublicReleaseReceipt', 'directReleaseWithoutLedger', 'relayDependency']) {
    if (policy[key] !== false) throw new Error(`${key} must remain false`);
  }
  return { valid: true };
}

function ensureReleaseCandidateRegistered({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext }) {
  validateNetworkReleasePolicy(c15Policy);
  validateLedgerReleasePolicy(c14Policy);
  if (c15Policy.ledgerReleasePolicyId !== c14Policy.policyId) throw new Error('C1.15 policy is not bound to the supplied C1.14 policy');
  if (c15Policy.episodeId !== c14Policy.episodeId || c15Policy.sequenceId !== c14Policy.sequenceId) throw new Error('C1.15/C1.14 policy scope drift detected');
  validateReleaseCandidatePackage(releasePackage, releasePackageContext);
  validateReleaseCandidateRegister(releaseRegister, { c14Policy });
  const registration = releaseRegister.entries.find((entry) => entry.releaseCandidatePackageHash === releasePackage.releaseCandidatePackageHash);
  if (!registration) throw new Error('Release Candidate Package must be registered in the C1.14 append-only Release Candidate Register');
  if (registration.outputSha256 !== releasePackage.outputAsset.sha256 || registration.ledgerAdmissionReceiptHash !== releasePackage.ledgerAdmissionReceiptHash || registration.canonRecordHash !== releasePackage.canonRecordHash || registration.masterCandidateHash !== releasePackage.masterCandidateHash) throw new Error('C1.14 Release Candidate Register lineage drift detected');
  if (registration.releaseCeremonyEligible !== true || registration.networkReleased !== false || registration.publicRelease !== false) throw new Error('C1.14 release registration is not eligible for C1.15 ceremony');
  return registration;
}

function reviewHashPayload(review) { return withoutFields(review, ['reviewHash']); }

export function buildNetworkReleaseReview({
  c15Policy,
  c14Policy,
  releasePackage,
  releaseRegister,
  releasePackageContext,
  route,
  authorityId,
  decision,
  rightsClearanceVerified,
  audienceTrustDisclosureReady,
  publicReceiptSurfaceReady,
  withdrawalPathUnderstood,
  routeApproved,
  notes,
  recordedAt,
  reviewId = null,
}) {
  const registration = ensureReleaseCandidateRegistered({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext });
  const { routeHash } = validateRoute(route, c15Policy);
  const reviewTime = parseTime(recordedAt, 'recordedAt');
  const packageTime = parseTime(releasePackage.createdAt, 'releasePackage.createdAt');
  const registrationTime = parseTime(registration.recordedAt, 'releaseRegistration.recordedAt');
  if (reviewTime.time < packageTime.time || reviewTime.time < registrationTime.time) throw new Error('Network Release Review cannot predate the registered C1.14 Release Candidate Package');
  if (!C1_15_REVIEW_DECISIONS.includes(decision)) throw new Error('unsupported Network Release Review decision');
  const allApproved = rightsClearanceVerified === true && audienceTrustDisclosureReady === true && publicReceiptSurfaceReady === true && withdrawalPathUnderstood === true && routeApproved === true;
  if (decision === 'APPROVE_FOR_PUBLIC_RELEASE' && !allApproved) throw new Error('Network Release approval requires all public-release review assertions');
  const review = {
    schema: CINESWARM_NETWORK_RELEASE_REVIEW_SCHEMA,
    reviewId: safeToken(reviewId ?? `${c15Policy.sequenceId}-network-release-review-${releasePackage.releaseCandidatePackageHash.slice(0, 12)}`, 'reviewId'),
    policyId: c15Policy.policyId,
    ledgerReleasePolicyId: c14Policy.policyId,
    episodeId: c15Policy.episodeId,
    sequenceId: c15Policy.sequenceId,
    releaseCandidatePackageId: releasePackage.packageId,
    releaseCandidatePackageHash: releasePackage.releaseCandidatePackageHash,
    releaseEvidenceRootHash: releasePackage.releaseEvidenceRootHash,
    releaseCandidateRegisterHash: releaseRegister.registerHash,
    releaseCandidateRegisterRevision: releaseRegister.revision,
    releaseCandidateRegisterEntryHash: registration.entryHash,
    ledgerAdmissionReceiptHash: releasePackage.ledgerAdmissionReceiptHash,
    canonRecordHash: releasePackage.canonRecordHash,
    masterCandidateHash: releasePackage.masterCandidateHash,
    outputSha256: releasePackage.outputAsset.sha256,
    route: structuredClone(route),
    routeHash,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    rightsClearanceVerified: Boolean(rightsClearanceVerified),
    audienceTrustDisclosureReady: Boolean(audienceTrustDisclosureReady),
    publicReceiptSurfaceReady: Boolean(publicReceiptSurfaceReady),
    withdrawalPathUnderstood: Boolean(withdrawalPathUnderstood),
    routeApproved: Boolean(routeApproved),
    notes: requiredString(notes, 'notes'),
    recordedAt: reviewTime.text,
    eligibleForNetworkReleaseCeremony: decision === 'APPROVE_FOR_PUBLIC_RELEASE' && allApproved,
    networkReleaseAuthorized: false,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
  review.reviewHash = digestJson(reviewHashPayload(review));
  return review;
}

export function validateNetworkReleaseReview(review, context) {
  const { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext } = context;
  const registration = ensureReleaseCandidateRegistered({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext });
  if (!review || review.schema !== CINESWARM_NETWORK_RELEASE_REVIEW_SCHEMA) throw new Error('invalid Network Release Review schema');
  safeToken(review.reviewId, 'reviewId');
  if (review.policyId !== c15Policy.policyId || review.ledgerReleasePolicyId !== c14Policy.policyId || review.episodeId !== c15Policy.episodeId || review.sequenceId !== c15Policy.sequenceId) throw new Error('Network Release Review policy scope mismatch');
  if (review.releaseCandidatePackageId !== releasePackage.packageId || review.releaseCandidatePackageHash !== releasePackage.releaseCandidatePackageHash || review.releaseEvidenceRootHash !== releasePackage.releaseEvidenceRootHash || review.ledgerAdmissionReceiptHash !== releasePackage.ledgerAdmissionReceiptHash || review.canonRecordHash !== releasePackage.canonRecordHash || review.masterCandidateHash !== releasePackage.masterCandidateHash || review.outputSha256 !== releasePackage.outputAsset.sha256) throw new Error('Network Release Review Release Candidate lineage drift detected');
  if (review.releaseCandidateRegisterHash !== releaseRegister.registerHash || review.releaseCandidateRegisterRevision !== releaseRegister.revision || review.releaseCandidateRegisterEntryHash !== registration.entryHash) throw new Error('Network Release Review Release Candidate Register drift detected');
  const routeState = validateRoute(review.route, c15Policy);
  if (review.routeHash !== routeState.routeHash) throw new Error('Network Release Review route hash mismatch');
  if (review.authority?.kind !== 'human' || review.simulated !== false) throw new Error('Network Release Review requires real human authority');
  safeToken(review.authority.id, 'authority.id');
  if (!C1_15_REVIEW_DECISIONS.includes(review.decision)) throw new Error('unsupported Network Release Review decision');
  const allApproved = review.rightsClearanceVerified === true && review.audienceTrustDisclosureReady === true && review.publicReceiptSurfaceReady === true && review.withdrawalPathUnderstood === true && review.routeApproved === true;
  const eligible = review.decision === 'APPROVE_FOR_PUBLIC_RELEASE' && allApproved;
  if (review.decision === 'APPROVE_FOR_PUBLIC_RELEASE' && !allApproved) throw new Error('Network Release Review approval assertions are incomplete');
  if (review.eligibleForNetworkReleaseCeremony !== eligible) throw new Error('Network Release Review ceremony eligibility mismatch');
  if (review.networkReleaseAuthorized !== false || review.networkReleased !== false || review.publicRelease !== false || review.relayDependency !== false) throw new Error('Network Release Review violates downstream authority boundaries');
  const reviewTime = parseTime(review.recordedAt, 'recordedAt');
  const packageTime = parseTime(releasePackage.createdAt, 'releasePackage.createdAt');
  const registrationTime = parseTime(registration.recordedAt, 'releaseRegistration.recordedAt');
  if (reviewTime.time < packageTime.time || reviewTime.time < registrationTime.time) throw new Error('Network Release Review predates the registered C1.14 Release Candidate Package');
  requiredString(review.notes, 'notes');
  ensureSha256(review.reviewHash, 'reviewHash');
  if (review.reviewHash !== digestJson(reviewHashPayload(review))) throw new Error('Network Release Review self-hash mismatch');
  return { valid: true, eligibleForNetworkReleaseCeremony: eligible };
}

function ceremonyDigestPayload(ceremony) {
  return withoutFields(ceremony, ['ceremonyDigest', 'algorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']);
}
function ceremonyHashPayload(ceremony) { return withoutFields(ceremony, ['ceremonyHash']); }
function releaseMessage(ceremonyDigest, ceremony) {
  return [
    NETWORK_RELEASE_DOMAIN,
    ceremony.ceremonyId,
    ceremonyDigest,
    ceremony.keyId,
    ceremony.authority.id,
    ceremony.releaseCandidatePackageHash,
    ceremony.routeHash,
    ceremony.outputSha256,
    ceremony.recordedAt,
  ].join('\n');
}

export function buildNetworkReleaseCeremonyPayload({
  c15Policy,
  c14Policy,
  releasePackage,
  releaseRegister,
  releasePackageContext,
  releaseReview,
  authorityId,
  keyId,
  recordedAt,
  reason,
  ceremonyId = null,
}) {
  const reviewState = validateNetworkReleaseReview(releaseReview, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext });
  if (!reviewState.eligibleForNetworkReleaseCeremony) throw new Error('Network Release Ceremony requires an approved Network Release Review');
  const ceremonyTime = parseTime(recordedAt, 'recordedAt');
  if (ceremonyTime.time < parseTime(releaseReview.recordedAt, 'releaseReview.recordedAt').time) throw new Error('Network Release Ceremony cannot predate Network Release Review');
  const payload = {
    schema: CINESWARM_NETWORK_RELEASE_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${c15Policy.sequenceId}-network-release-${releasePackage.releaseCandidatePackageHash.slice(0, 12)}`, 'ceremonyId'),
    policyId: c15Policy.policyId,
    ledgerReleasePolicyId: c14Policy.policyId,
    episodeId: c15Policy.episodeId,
    sequenceId: c15Policy.sequenceId,
    decision: C1_15_RELEASE_DECISION,
    releaseCandidatePackageId: releasePackage.packageId,
    releaseCandidatePackageHash: releasePackage.releaseCandidatePackageHash,
    releaseEvidenceRootHash: releasePackage.releaseEvidenceRootHash,
    releaseCandidateRegisterHash: releaseRegister.registerHash,
    releaseCandidateRegisterRevision: releaseRegister.revision,
    ledgerAdmissionReceiptHash: releasePackage.ledgerAdmissionReceiptHash,
    canonRecordHash: releasePackage.canonRecordHash,
    masterCandidateHash: releasePackage.masterCandidateHash,
    outputSha256: releasePackage.outputAsset.sha256,
    route: structuredClone(releaseReview.route),
    routeHash: releaseReview.routeHash,
    releaseReviewId: releaseReview.reviewId,
    releaseReviewHash: releaseReview.reviewHash,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    keyId: safeToken(keyId, 'keyId'),
    reason: requiredString(reason, 'reason'),
    recordedAt: ceremonyTime.text,
    networkReleaseAuthorized: true,
    publicReleaseAuthorized: true,
    publicationConfirmationRequired: true,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
  payload.ceremonyDigest = digestJson(ceremonyDigestPayload(payload));
  return payload;
}

export function signNetworkReleaseCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!payload || payload.schema !== CINESWARM_NETWORK_RELEASE_CEREMONY_SCHEMA) throw new Error('invalid Network Release Ceremony payload schema');
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not a private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  if (payload.ceremonyDigest !== digestJson(ceremonyDigestPayload(payload))) throw new Error('Network Release Ceremony payload digest mismatch');
  const signatureBase64 = cryptoSign(null, Buffer.from(releaseMessage(payload.ceremonyDigest, payload), 'utf8'), privateKeyPem).toString('base64');
  const ceremony = {
    ...structuredClone(payload),
    algorithm: C1_15_SIGNATURE_ALGORITHM,
    signatureBase64,
    keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
  };
  ceremony.ceremonyHash = digestJson(ceremonyHashPayload(ceremony));
  return ceremony;
}

export function verifyNetworkReleaseCeremony({ ceremony, c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, keyRegistry }) {
  validateNetworkReleaseReview(releaseReview, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext });
  if (!ceremony || ceremony.schema !== CINESWARM_NETWORK_RELEASE_CEREMONY_SCHEMA) throw new Error('invalid Network Release Ceremony schema');
  if (ceremony.policyId !== c15Policy.policyId || ceremony.ledgerReleasePolicyId !== c14Policy.policyId || ceremony.episodeId !== c15Policy.episodeId || ceremony.sequenceId !== c15Policy.sequenceId) throw new Error('Network Release Ceremony policy scope mismatch');
  if (ceremony.decision !== C1_15_RELEASE_DECISION || ceremony.networkReleaseAuthorized !== true || ceremony.publicReleaseAuthorized !== true || ceremony.publicationConfirmationRequired !== true || ceremony.networkReleased !== false || ceremony.publicRelease !== false || ceremony.relayDependency !== false) throw new Error('Network Release Ceremony authority/state invariants violated');
  if (ceremony.releaseCandidatePackageId !== releasePackage.packageId || ceremony.releaseCandidatePackageHash !== releasePackage.releaseCandidatePackageHash || ceremony.releaseEvidenceRootHash !== releasePackage.releaseEvidenceRootHash || ceremony.releaseCandidateRegisterHash !== releaseRegister.registerHash || ceremony.releaseCandidateRegisterRevision !== releaseRegister.revision || ceremony.ledgerAdmissionReceiptHash !== releasePackage.ledgerAdmissionReceiptHash || ceremony.canonRecordHash !== releasePackage.canonRecordHash || ceremony.masterCandidateHash !== releasePackage.masterCandidateHash || ceremony.outputSha256 !== releasePackage.outputAsset.sha256 || ceremony.releaseReviewHash !== releaseReview.reviewHash) throw new Error('Network Release Ceremony lineage drift detected');
  const routeState = validateRoute(ceremony.route, c15Policy);
  if (ceremony.routeHash !== routeState.routeHash || ceremony.routeHash !== releaseReview.routeHash) throw new Error('Network Release Ceremony route drift detected');
  ensureSha256(ceremony.ceremonyDigest, 'ceremonyDigest');
  ensureSha256(ceremony.ceremonyHash, 'ceremonyHash');
  ensureSha256(ceremony.keyFingerprintSha256, 'keyFingerprintSha256');
  requiredString(ceremony.signatureBase64, 'signatureBase64');
  if (ceremony.algorithm !== C1_15_SIGNATURE_ALGORITHM) throw new Error('Network Release Ceremony signature algorithm mismatch');
  if (ceremony.authority?.kind !== 'human') throw new Error('Network Release Ceremony authority must be human');
  safeToken(ceremony.authority.id, 'authority.id');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Network Release signing-key fingerprint mismatch');
  if (ceremony.ceremonyDigest !== digestJson(ceremonyDigestPayload(ceremony))) throw new Error('Network Release Ceremony digest mismatch');
  if (ceremony.ceremonyHash !== digestJson(ceremonyHashPayload(ceremony))) throw new Error('Network Release Ceremony self-hash mismatch');
  const ok = cryptoVerify(null, Buffer.from(releaseMessage(ceremony.ceremonyDigest, ceremony), 'utf8'), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'));
  if (!ok) throw new Error('Network Release Ceremony signature verification failed');
  return { valid: true, networkReleaseAuthorized: true, publicReleaseAuthorized: true, networkReleased: false };
}

function confirmationHashPayload(confirmation) { return withoutFields(confirmation, ['publicationConfirmationHash']); }

export function buildPublicationConfirmation({
  c15Policy,
  c14Policy,
  releasePackage,
  releaseRegister,
  releasePackageContext,
  releaseReview,
  releaseCeremony,
  keyRegistry,
  publisherId,
  publicationAttemptId,
  publisherEvidenceSha256,
  observedHttpStatus,
  publicReachabilityVerified,
  contentReceiptExposed,
  ledgerAdmissionReceiptExposed,
  publishedAt,
  verifiedAt,
  confirmationId = null,
}) {
  verifyNetworkReleaseCeremony({ ceremony: releaseCeremony, c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, keyRegistry });
  const publishTime = parseTime(publishedAt, 'publishedAt');
  const verifyTime = parseTime(verifiedAt, 'verifiedAt');
  const ceremonyTime = parseTime(releaseCeremony.recordedAt, 'releaseCeremony.recordedAt');
  if (publishTime.time < ceremonyTime.time) throw new Error('Publication cannot predate Network Release authorization');
  if (verifyTime.time < publishTime.time) throw new Error('Publication verification cannot predate publication');
  if (!Number.isInteger(observedHttpStatus) || observedHttpStatus < 200 || observedHttpStatus >= 300) throw new Error('publication confirmation requires a successful 2xx HTTP status');
  if (publicReachabilityVerified !== true || contentReceiptExposed !== true || ledgerAdmissionReceiptExposed !== true) throw new Error('publication confirmation requires reachability and public provenance receipt verification');
  const confirmation = {
    schema: CINESWARM_PUBLICATION_CONFIRMATION_SCHEMA,
    confirmationId: safeToken(confirmationId ?? `${c15Policy.sequenceId}-publication-confirmation-${releaseCeremony.ceremonyHash.slice(0, 12)}`, 'confirmationId'),
    policyId: c15Policy.policyId,
    episodeId: c15Policy.episodeId,
    sequenceId: c15Policy.sequenceId,
    networkId: c15Policy.networkId,
    publisher: { kind: 'parallax-network-publisher-verifier', id: safeToken(publisherId, 'publisherId') },
    publicationAttemptId: safeToken(publicationAttemptId, 'publicationAttemptId'),
    publisherEvidenceSha256: ensureSha256(publisherEvidenceSha256, 'publisherEvidenceSha256'),
    releaseCandidatePackageHash: releasePackage.releaseCandidatePackageHash,
    releaseEvidenceRootHash: releasePackage.releaseEvidenceRootHash,
    releaseCeremonyHash: releaseCeremony.ceremonyHash,
    releaseReviewHash: releaseReview.reviewHash,
    ledgerAdmissionReceiptHash: releasePackage.ledgerAdmissionReceiptHash,
    canonRecordHash: releasePackage.canonRecordHash,
    masterCandidateHash: releasePackage.masterCandidateHash,
    outputSha256: releasePackage.outputAsset.sha256,
    route: structuredClone(releaseCeremony.route),
    routeHash: releaseCeremony.routeHash,
    observedHttpStatus,
    publicReachabilityVerified: true,
    contentReceiptExposed: true,
    ledgerAdmissionReceiptExposed: true,
    publishedAt: publishTime.text,
    verifiedAt: verifyTime.text,
    publicationOutcome: 'SUCCEEDED',
    networkReleased: true,
    publicReleaseConfirmed: true,
    publicReleaseReceiptEligible: true,
    relayDependency: false,
  };
  confirmation.publicationConfirmationHash = digestJson(confirmationHashPayload(confirmation));
  return confirmation;
}

export function validatePublicationConfirmation(confirmation, context) {
  const { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry } = context;
  verifyNetworkReleaseCeremony({ ceremony: releaseCeremony, c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, keyRegistry });
  if (!confirmation || confirmation.schema !== CINESWARM_PUBLICATION_CONFIRMATION_SCHEMA) throw new Error('invalid Publication Confirmation schema');
  if (confirmation.policyId !== c15Policy.policyId || confirmation.episodeId !== c15Policy.episodeId || confirmation.sequenceId !== c15Policy.sequenceId || confirmation.networkId !== c15Policy.networkId) throw new Error('Publication Confirmation policy scope mismatch');
  if (confirmation.publisher?.kind !== 'parallax-network-publisher-verifier') throw new Error('Publication Confirmation publisher kind mismatch');
  safeToken(confirmation.publisher?.id, 'publisher.id');
  safeToken(confirmation.publicationAttemptId, 'publicationAttemptId');
  ensureSha256(confirmation.publisherEvidenceSha256, 'publisherEvidenceSha256');
  if (confirmation.releaseCandidatePackageHash !== releasePackage.releaseCandidatePackageHash || confirmation.releaseEvidenceRootHash !== releasePackage.releaseEvidenceRootHash || confirmation.releaseCeremonyHash !== releaseCeremony.ceremonyHash || confirmation.releaseReviewHash !== releaseReview.reviewHash || confirmation.ledgerAdmissionReceiptHash !== releasePackage.ledgerAdmissionReceiptHash || confirmation.canonRecordHash !== releasePackage.canonRecordHash || confirmation.masterCandidateHash !== releasePackage.masterCandidateHash || confirmation.outputSha256 !== releasePackage.outputAsset.sha256) throw new Error('Publication Confirmation lineage drift detected');
  const routeState = validateRoute(confirmation.route, c15Policy);
  if (confirmation.routeHash !== routeState.routeHash || confirmation.routeHash !== releaseCeremony.routeHash) throw new Error('Publication Confirmation route drift detected');
  if (!Number.isInteger(confirmation.observedHttpStatus) || confirmation.observedHttpStatus < 200 || confirmation.observedHttpStatus >= 300) throw new Error('Publication Confirmation HTTP status is not successful');
  if (confirmation.publicReachabilityVerified !== true || confirmation.contentReceiptExposed !== true || confirmation.ledgerAdmissionReceiptExposed !== true || confirmation.publicationOutcome !== 'SUCCEEDED' || confirmation.networkReleased !== true || confirmation.publicReleaseConfirmed !== true || confirmation.publicReleaseReceiptEligible !== true || confirmation.relayDependency !== false) throw new Error('Publication Confirmation success invariants violated');
  const publishTime = parseTime(confirmation.publishedAt, 'publishedAt');
  const verifyTime = parseTime(confirmation.verifiedAt, 'verifiedAt');
  if (publishTime.time < parseTime(releaseCeremony.recordedAt, 'releaseCeremony.recordedAt').time) throw new Error('Publication Confirmation predates release authorization');
  if (verifyTime.time < publishTime.time) throw new Error('Publication Confirmation verification predates publication');
  ensureSha256(confirmation.publicationConfirmationHash, 'publicationConfirmationHash');
  if (confirmation.publicationConfirmationHash !== digestJson(confirmationHashPayload(confirmation))) throw new Error('Publication Confirmation self-hash mismatch');
  return { valid: true, networkReleased: true, publicReleaseReceiptEligible: true };
}

function publicReceiptHashPayload(receipt) { return withoutFields(receipt, ['publicReleaseReceiptHash']); }

export function buildPublicReleaseReceipt({
  c15Policy,
  c14Policy,
  releasePackage,
  releaseRegister,
  releasePackageContext,
  releaseReview,
  releaseCeremony,
  keyRegistry,
  publicationConfirmation,
  issuedAt,
  receiptId = null,
}) {
  validatePublicationConfirmation(publicationConfirmation, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry });
  const issueTime = parseTime(issuedAt, 'issuedAt');
  if (issueTime.time < parseTime(publicationConfirmation.verifiedAt, 'publicationConfirmation.verifiedAt').time) throw new Error('Public Release Receipt cannot predate publication verification');
  const evidenceInventory = [
    { kind: 'c1-14-release-candidate-package', id: releasePackage.packageId, sha256: releasePackage.releaseCandidatePackageHash },
    { kind: 'c1-14-release-evidence-root', id: 'c1-14-release-evidence-root', sha256: releasePackage.releaseEvidenceRootHash },
    { kind: 'c1-15-network-release-review', id: releaseReview.reviewId, sha256: releaseReview.reviewHash },
    { kind: 'c1-15-network-release-ceremony', id: releaseCeremony.ceremonyId, sha256: releaseCeremony.ceremonyHash },
    { kind: 'c1-15-publication-confirmation', id: publicationConfirmation.confirmationId, sha256: publicationConfirmation.publicationConfirmationHash },
    { kind: 'published-master-output', id: 'published-master-output', sha256: releasePackage.outputAsset.sha256 },
  ];
  const releaseReceiptEvidenceRootHash = digestJson(evidenceInventory);
  const receipt = {
    schema: CINESWARM_PUBLIC_RELEASE_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${c15Policy.sequenceId}-public-release-${publicationConfirmation.publicationConfirmationHash.slice(0, 12)}`, 'receiptId'),
    policyId: c15Policy.policyId,
    episodeId: c15Policy.episodeId,
    sequenceId: c15Policy.sequenceId,
    networkId: c15Policy.networkId,
    state: 'PUBLIC_RELEASED',
    releaseCandidatePackageHash: releasePackage.releaseCandidatePackageHash,
    releaseEvidenceRootHash: releasePackage.releaseEvidenceRootHash,
    ledgerAdmissionReceiptHash: releasePackage.ledgerAdmissionReceiptHash,
    canonRecordHash: releasePackage.canonRecordHash,
    masterCandidateHash: releasePackage.masterCandidateHash,
    outputSha256: releasePackage.outputAsset.sha256,
    route: structuredClone(publicationConfirmation.route),
    routeHash: publicationConfirmation.routeHash,
    releaseReviewHash: releaseReview.reviewHash,
    releaseCeremonyHash: releaseCeremony.ceremonyHash,
    publicationConfirmationHash: publicationConfirmation.publicationConfirmationHash,
    publisherEvidenceSha256: publicationConfirmation.publisherEvidenceSha256,
    evidenceInventory,
    releaseReceiptEvidenceRootHash,
    issuedAt: issueTime.text,
    ledgerAdmitted: true,
    canonPromoted: true,
    networkReleaseAuthorized: true,
    networkReleased: true,
    publicRelease: true,
    withdrawalRequiredForUnpublish: true,
    relayDependency: false,
  };
  receipt.publicReleaseReceiptHash = digestJson(publicReceiptHashPayload(receipt));
  return receipt;
}

export function validatePublicReleaseReceipt(receipt, context) {
  const { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry, publicationConfirmation } = context;
  validatePublicationConfirmation(publicationConfirmation, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry });
  if (!receipt || receipt.schema !== CINESWARM_PUBLIC_RELEASE_RECEIPT_SCHEMA) throw new Error('invalid Public Release Receipt schema');
  const expected = buildPublicReleaseReceipt({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry, publicationConfirmation, issuedAt: receipt.issuedAt, receiptId: receipt.receiptId });
  for (const key of ['releaseCandidatePackageHash', 'releaseEvidenceRootHash', 'ledgerAdmissionReceiptHash', 'canonRecordHash', 'masterCandidateHash', 'outputSha256', 'routeHash', 'releaseReviewHash', 'releaseCeremonyHash', 'publicationConfirmationHash', 'publisherEvidenceSha256', 'releaseReceiptEvidenceRootHash']) {
    if (receipt[key] !== expected[key]) throw new Error(`Public Release Receipt ${key} drift detected`);
  }
  if (JSON.stringify(receipt.route) !== JSON.stringify(expected.route) || JSON.stringify(receipt.evidenceInventory) !== JSON.stringify(expected.evidenceInventory)) throw new Error('Public Release Receipt route/evidence drift detected');
  if (receipt.state !== 'PUBLIC_RELEASED' || receipt.ledgerAdmitted !== true || receipt.canonPromoted !== true || receipt.networkReleaseAuthorized !== true || receipt.networkReleased !== true || receipt.publicRelease !== true || receipt.withdrawalRequiredForUnpublish !== true || receipt.relayDependency !== false) throw new Error('Public Release Receipt state/authority invariants violated');
  ensureSha256(receipt.publicReleaseReceiptHash, 'publicReleaseReceiptHash');
  if (receipt.publicReleaseReceiptHash !== digestJson(publicReceiptHashPayload(receipt))) throw new Error('Public Release Receipt self-hash mismatch');
  return { valid: true, networkReleased: true, publicRelease: true };
}

function releaseRegisterEntryHashPayload(entry) { return withoutFields(entry, ['entryHash']); }
function publicRegisterHashPayload(register) { return withoutFields(register, ['registerHash']); }

export function buildPublicReleaseRegister({ c15Policy, entries = [], revision = 0, recordedAt }) {
  validateNetworkReleasePolicy(c15Policy);
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Public Release Register revision must equal entry count');
  let previous = null;
  const routeHashes = new Set();
  const packageHashes = new Set();
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Public Release Register hash chain broken at entry ${index}`);
    for (const [value, label] of [[entry.publicReleaseReceiptHash, 'publicReleaseReceiptHash'], [entry.releaseCandidatePackageHash, 'releaseCandidatePackageHash'], [entry.releaseCeremonyHash, 'releaseCeremonyHash'], [entry.publicationConfirmationHash, 'publicationConfirmationHash'], [entry.routeHash, 'routeHash'], [entry.outputSha256, 'outputSha256'], [entry.entryHash, 'entryHash']]) ensureSha256(value, `entries[${index}].${label}`);
    if (routeHashes.has(entry.routeHash)) throw new Error('Public Release Register cannot contain duplicate active release routes');
    if (packageHashes.has(entry.releaseCandidatePackageHash)) throw new Error('Public Release Register cannot publish the same Release Candidate Package twice');
    routeHashes.add(entry.routeHash);
    packageHashes.add(entry.releaseCandidatePackageHash);
    if (entry.entryHash !== digestJson(releaseRegisterEntryHashPayload(entry))) throw new Error(`Public Release Register entry ${index} self-hash mismatch`);
    if (entry.eventType !== 'PUBLIC_RELEASED' || entry.networkReleased !== true || entry.publicRelease !== true || entry.withdrawalRequiredForUnpublish !== true || entry.relayDependency !== false) throw new Error('Public Release Register entry violates release-state invariants');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_PUBLIC_RELEASE_REGISTER_SCHEMA,
    registerId: `${c15Policy.sequenceId}-public-release-register`,
    policyId: c15Policy.policyId,
    episodeId: c15Policy.episodeId,
    sequenceId: c15Policy.sequenceId,
    networkId: c15Policy.networkId,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    status: entries.length ? 'PUBLIC_RELEASED_WITHDRAWAL_REQUIRED_FOR_UNPUBLISH' : 'EMPTY_NO_PUBLIC_RELEASES',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: previous,
    publicReleaseCount: entries.length,
    activePublicReleaseCount: entries.length,
    networkReleased: entries.length > 0,
    publicRelease: entries.length > 0,
    relayDependency: false,
  };
  register.registerHash = digestJson(publicRegisterHashPayload(register));
  return register;
}

export function validatePublicReleaseRegister(register, { c15Policy }) {
  if (!register || register.schema !== CINESWARM_PUBLIC_RELEASE_REGISTER_SCHEMA) throw new Error('invalid Public Release Register schema');
  const rebuilt = buildPublicReleaseRegister({ c15Policy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'publicReleaseCount', 'activePublicReleaseCount', 'networkReleased', 'publicRelease']) if (register[key] !== rebuilt[key]) throw new Error(`Public Release Register ${key} mismatch`);
  if (register.registerHash !== digestJson(publicRegisterHashPayload(register))) throw new Error('Public Release Register self-hash mismatch');
  if (register.relayDependency !== false) throw new Error('Public Release Register Relay boundary violated');
  return { valid: true, revision: register.revision, publicReleaseCount: register.publicReleaseCount, publicRelease: register.publicRelease };
}

export function appendPublicReleaseReceiptToRegister({ register, receipt, c15Policy, receiptContext, recordedAt }) {
  validatePublicReleaseRegister(register, { c15Policy });
  validatePublicReleaseReceipt(receipt, receiptContext);
  if (register.entries.some((entry) => entry.publicReleaseReceiptHash === receipt.publicReleaseReceiptHash || entry.releaseCandidatePackageHash === receipt.releaseCandidatePackageHash || entry.routeHash === receipt.routeHash)) throw new Error('this Release Candidate Package, route, or Public Release Receipt is already registered as public');
  const eventTime = parseTime(recordedAt, 'recordedAt');
  if (eventTime.time < parseTime(receipt.issuedAt, 'receipt.issuedAt').time) throw new Error('Public Release Register event cannot predate Public Release Receipt');
  const entry = {
    entryId: `${c15Policy.sequenceId}-public-release-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'PUBLIC_RELEASED',
    receiptId: receipt.receiptId,
    publicReleaseReceiptHash: receipt.publicReleaseReceiptHash,
    releaseCandidatePackageHash: receipt.releaseCandidatePackageHash,
    releaseCeremonyHash: receipt.releaseCeremonyHash,
    publicationConfirmationHash: receipt.publicationConfirmationHash,
    routeHash: receipt.routeHash,
    publicPath: receipt.route.publicPath,
    outputSha256: receipt.outputSha256,
    previousEntryHash: register.headHash,
    recordedAt: eventTime.text,
    networkReleased: true,
    publicRelease: true,
    withdrawalRequiredForUnpublish: true,
    relayDependency: false,
  };
  entry.entryHash = digestJson(releaseRegisterEntryHashPayload(entry));
  return buildPublicReleaseRegister({ c15Policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: eventTime.text });
}

export function classifyNetworkReleaseState({ c15Policy, releaseCandidateRegister, publicReleaseRegister }) {
  validateNetworkReleasePolicy(c15Policy);
  if (!releaseCandidateRegister || !Number.isInteger(releaseCandidateRegister.releaseCandidateCount)) throw new Error('C1.14 Release Candidate Register is required');
  validatePublicReleaseRegister(publicReleaseRegister, { c15Policy });
  const releaseCandidateReady = releaseCandidateRegister.releaseCandidateCount > 0;
  const publicRelease = publicReleaseRegister.publicReleaseCount > 0;
  let status = 'BLOCKED_NO_RELEASE_CANDIDATE';
  if (releaseCandidateReady && !publicRelease) status = 'RELEASE_CANDIDATE_READY_NETWORK_RELEASE_CEREMONY_REQUIRED';
  if (publicRelease) status = 'PUBLIC_RELEASED_WITHDRAWAL_REQUIRED_FOR_UNPUBLISH';
  return {
    status,
    releaseCandidateCount: releaseCandidateRegister.releaseCandidateCount,
    releaseCandidateReady,
    publicReleaseCount: publicReleaseRegister.publicReleaseCount,
    networkReleased: publicRelease,
    publicRelease,
    withdrawalRequiredForUnpublish: publicRelease,
    relayDependency: false,
  };
}
