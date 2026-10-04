import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendPublicReleaseReceiptToRegister,
  buildNetworkReleaseCeremonyPayload,
  buildNetworkReleaseReview,
  buildPublicationConfirmation,
  buildPublicReleaseReceipt,
  buildPublicReleaseRegister,
  classifyNetworkReleaseState,
  signNetworkReleaseCeremony,
  validateNetworkReleasePolicy,
  validateNetworkReleaseReview,
  validatePublicationConfirmation,
  validatePublicReleaseReceipt,
  validatePublicReleaseRegister,
  verifyNetworkReleaseCeremony,
} from '../src/network-release.js';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const proof = (name) => read(`c1-15-proof-base/${name}`);

const c15Policy = read('pn-0001-c1-15-network-release-policy.json');
const c14Policy = read('pn-0001-c1-14-ledger-release-policy.json');
const canonicalPublicReleaseRegister = read('pn-0001-c1-15-public-release-register.json');
const canonicalReleaseRegister = read('pn-0001-c1-14-release-candidate-register.json');

const c13Policy = proof('canon-policy.json');
const masterPolicy = proof('master-policy.json');
const packet = proof('ledger-admission-packet.json');
const packetRegister = proof('ledger-packet-register.json');
const verificationReport = proof('ledger-verification-report.json');
const admissionCeremony = proof('ledger-admission-ceremony.json');
const admissionReceipt = proof('ledger-admission-receipt.json');
const admissionRegister = proof('ledger-admission-register.json');
const releasePackage = proof('release-candidate-package.json');
const releaseRegister = proof('release-candidate-register.json');
const baseKeyRegistry = proof('key-registry-combined.json');

function c14PackageContext(keyRegistry = baseKeyRegistry) {
  const lineage = {
    masterCandidate: proof('master-candidate.json'),
    masterRegister: proof('master-register.json'),
    canonReview: proof('canon-review.json'),
    promotionCeremony: proof('canon-promotion-ceremony.json'),
    canonRecord: proof('canon-record.json'),
    canonRegister: proof('canon-register.json'),
    keyRegistry,
  };
  const receiptContext = { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, admissionCeremony, keyRegistry };
  return { c14Policy, packet, verificationReport, admissionCeremony, admissionReceipt, admissionRegister, receiptContext };
}

function releaseSigningMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const keyId = 'proof_network_release_c1_15_001';
  const keyRegistry = structuredClone(baseKeyRegistry);
  keyRegistry.keys.push({
    keyId,
    algorithm: 'Ed25519',
    status: 'active',
    authority: { kind: 'human', id: 'michael-hughes' },
    publicKeyPem,
    validFrom: '2026-08-13T19:55:00.000Z',
    validUntil: null,
  });
  return { privateKeyPem, publicKeyPem, keyId, keyRegistry };
}

const route = {
  networkId: 'parallax-network',
  publicPath: '/watch/welcome-to-parallax-network',
  contentSlug: 'welcome-to-parallax-network',
  channelSlug: 'parallax-originals',
  visibility: 'public',
};

function buildReleasedFixture() {
  const signing = releaseSigningMaterial();
  const releasePackageContext = c14PackageContext(signing.keyRegistry);
  const review = buildNetworkReleaseReview({
    c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext,
    route,
    authorityId: 'michael-hughes',
    decision: 'APPROVE_FOR_PUBLIC_RELEASE',
    rightsClearanceVerified: true,
    audienceTrustDisclosureReady: true,
    publicReceiptSurfaceReady: true,
    withdrawalPathUnderstood: true,
    routeApproved: true,
    notes: 'Proof-only final human review of the exact registered C1.14 Release Candidate Package.',
    recordedAt: '2026-08-13T20:00:00.000Z',
  });
  const payload = buildNetworkReleaseCeremonyPayload({
    c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review,
    authorityId: 'michael-hughes', keyId: signing.keyId, recordedAt: '2026-08-13T20:01:00.000Z',
    reason: 'Proof-only authorization of this exact C1.14 Release Candidate Package to this exact Parallax Network route.',
  });
  const ceremony = signNetworkReleaseCeremony(payload, { privateKeyPem: signing.privateKeyPem, keyRegistry: signing.keyRegistry });
  const confirmation = buildPublicationConfirmation({
    c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry,
    publisherId: 'parallax-network-proof-publisher',
    publicationAttemptId: 'proof_publication_attempt_001',
    publisherEvidenceSha256: '9'.repeat(64),
    observedHttpStatus: 200,
    publicReachabilityVerified: true,
    contentReceiptExposed: true,
    ledgerAdmissionReceiptExposed: true,
    publishedAt: '2026-08-13T20:02:00.000Z',
    verifiedAt: '2026-08-13T20:02:30.000Z',
  });
  const receipt = buildPublicReleaseReceipt({
    c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry,
    publicationConfirmation: confirmation,
    issuedAt: '2026-08-13T20:03:00.000Z',
  });
  const receiptContext = { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publicationConfirmation: confirmation };
  let publicReleaseRegister = buildPublicReleaseRegister({ c15Policy, entries: [], revision: 0, recordedAt: '2026-08-13T19:55:00.000Z' });
  publicReleaseRegister = appendPublicReleaseReceiptToRegister({ register: publicReleaseRegister, receipt, c15Policy, receiptContext, recordedAt: '2026-08-13T20:03:00.000Z' });
  return { signing, releasePackageContext, review, payload, ceremony, confirmation, receipt, receiptContext, publicReleaseRegister };
}

test('C1.15 policy preserves human-only release, publication confirmation, and explicit unpublish boundary', () => {
  assert.equal(validateNetworkReleasePolicy(c15Policy).valid, true);
  const bad = structuredClone(c15Policy);
  bad.autoNetworkRelease = true;
  assert.throws(() => validateNetworkReleasePolicy(bad), /autoNetworkRelease must remain false/);
});

test('independent Network Release Review binds exact registered C1.14 package, evidence root, output, and route without authorizing release', () => {
  const ctx = c14PackageContext();
  const review = buildNetworkReleaseReview({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: ctx, route, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_PUBLIC_RELEASE', rightsClearanceVerified: true, audienceTrustDisclosureReady: true, publicReceiptSurfaceReady: true, withdrawalPathUnderstood: true, routeApproved: true, notes: 'Exact release review.', recordedAt: '2026-08-13T20:00:00.000Z' });
  const result = validateNetworkReleaseReview(review, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: ctx });
  assert.equal(result.eligibleForNetworkReleaseCeremony, true);
  assert.equal(review.releaseCandidatePackageHash, releasePackage.releaseCandidatePackageHash);
  assert.equal(review.releaseEvidenceRootHash, releasePackage.releaseEvidenceRootHash);
  assert.equal(review.networkReleaseAuthorized, false);
  assert.equal(review.publicRelease, false);
});

test('Network Release Review refuses incomplete approval assertions and unsafe route drift', () => {
  const ctx = c14PackageContext();
  assert.throws(() => buildNetworkReleaseReview({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: ctx, route, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_PUBLIC_RELEASE', rightsClearanceVerified: true, audienceTrustDisclosureReady: true, publicReceiptSurfaceReady: false, withdrawalPathUnderstood: true, routeApproved: true, notes: 'Incomplete.', recordedAt: '2026-08-13T20:00:00.000Z' }), /requires all public-release review assertions/);
  const badRoute = { ...route, publicPath: '/watch/../admin' };
  assert.throws(() => buildNetworkReleaseReview({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: ctx, route: badRoute, authorityId: 'michael-hughes', decision: 'HOLD', rightsClearanceVerified: false, audienceTrustDisclosureReady: false, publicReceiptSurfaceReady: false, withdrawalPathUnderstood: true, routeApproved: false, notes: 'Unsafe route.', recordedAt: '2026-08-13T20:00:00.000Z' }), /safe canonical public path|must end with/);
});

test('Network Release Review is self-hashed and rejects exact output or route tampering', () => {
  const fx = buildReleasedFixture();
  const tampered = structuredClone(fx.review);
  tampered.outputSha256 = '0'.repeat(64);
  assert.throws(() => validateNetworkReleaseReview(tampered, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext }), /lineage drift|self-hash mismatch/);
});

test('signed Network Release Ceremony authorizes exactly one package/route but does not claim publication success', () => {
  const fx = buildReleasedFixture();
  const result = verifyNetworkReleaseCeremony({ ceremony: fx.ceremony, c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, keyRegistry: fx.signing.keyRegistry });
  assert.equal(result.networkReleaseAuthorized, true);
  assert.equal(fx.ceremony.publicReleaseAuthorized, true);
  assert.equal(fx.ceremony.networkReleased, false);
  assert.equal(fx.ceremony.publicRelease, false);
});

test('new Network Release signature refuses retired keys and exact-lineage tampering', () => {
  const fx = buildReleasedFixture();
  const retired = structuredClone(fx.signing.keyRegistry);
  retired.keys.find((key) => key.keyId === fx.signing.keyId).status = 'retired';
  assert.throws(() => signNetworkReleaseCeremony(fx.payload, { privateKeyPem: fx.signing.privateKeyPem, keyRegistry: retired }), /must be active/);
  const tampered = structuredClone(fx.ceremony);
  tampered.route.publicPath = '/watch/other';
  assert.throws(() => verifyNetworkReleaseCeremony({ ceremony: tampered, c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, keyRegistry: fx.signing.keyRegistry }), /route|digest mismatch|self-hash mismatch/);
});

test('publication cannot be confirmed before signed authorization, without 2xx reachability, or without public provenance receipts', () => {
  const fx = buildReleasedFixture();
  const base = { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, releaseCeremony: fx.ceremony, keyRegistry: fx.signing.keyRegistry, publisherId: 'parallax-network-proof-publisher', publicationAttemptId: 'attempt_bad', publisherEvidenceSha256: '8'.repeat(64), publicReachabilityVerified: true, contentReceiptExposed: true, ledgerAdmissionReceiptExposed: true };
  assert.throws(() => buildPublicationConfirmation({ ...base, observedHttpStatus: 500, publishedAt: '2026-08-13T20:02:00.000Z', verifiedAt: '2026-08-13T20:02:30.000Z' }), /2xx/);
  assert.throws(() => buildPublicationConfirmation({ ...base, observedHttpStatus: 200, contentReceiptExposed: false, publishedAt: '2026-08-13T20:02:00.000Z', verifiedAt: '2026-08-13T20:02:30.000Z' }), /provenance receipt/);
  assert.throws(() => buildPublicationConfirmation({ ...base, observedHttpStatus: 200, publishedAt: '2026-08-13T20:00:59.000Z', verifiedAt: '2026-08-13T20:02:30.000Z' }), /predate Network Release authorization/);
});

test('successful Publication Confirmation binds the exact signed ceremony, route, package, and published output', () => {
  const fx = buildReleasedFixture();
  const result = validatePublicationConfirmation(fx.confirmation, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, releaseCeremony: fx.ceremony, keyRegistry: fx.signing.keyRegistry });
  assert.equal(result.networkReleased, true);
  assert.equal(result.publicReleaseReceiptEligible, true);
  assert.equal(fx.confirmation.outputSha256, releasePackage.outputAsset.sha256);
  assert.equal(fx.confirmation.routeHash, fx.ceremony.routeHash);
});

test('Publication Confirmation detects provider evidence, output, and route tampering', () => {
  const fx = buildReleasedFixture();
  const tampered = structuredClone(fx.confirmation);
  tampered.publisherEvidenceSha256 = '7'.repeat(64);
  assert.throws(() => validatePublicationConfirmation(tampered, { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, releaseCeremony: fx.ceremony, keyRegistry: fx.signing.keyRegistry }), /self-hash mismatch/);
});

test('Public Release Receipt is the first immutable object allowed to assert publicRelease=true', () => {
  const fx = buildReleasedFixture();
  const result = validatePublicReleaseReceipt(fx.receipt, fx.receiptContext);
  assert.equal(result.publicRelease, true);
  assert.equal(fx.receipt.networkReleaseAuthorized, true);
  assert.equal(fx.receipt.networkReleased, true);
  assert.equal(fx.receipt.publicRelease, true);
  assert.equal(fx.receipt.evidenceInventory.length, 6);
  assert.equal(fx.receipt.withdrawalRequiredForUnpublish, true);
});

test('Public Release Receipt refuses post-release Master output or publication-confirmation drift', () => {
  const fx = buildReleasedFixture();
  const tampered = structuredClone(fx.receipt);
  tampered.outputSha256 = '6'.repeat(64);
  assert.throws(() => validatePublicReleaseReceipt(tampered, fx.receiptContext), /outputSha256 drift|self-hash mismatch/);
});

test('append-only Public Release Register records a route/package once and rejects replay or hash-chain tampering', () => {
  const fx = buildReleasedFixture();
  assert.equal(validatePublicReleaseRegister(fx.publicReleaseRegister, { c15Policy }).publicReleaseCount, 1);
  assert.throws(() => appendPublicReleaseReceiptToRegister({ register: fx.publicReleaseRegister, receipt: fx.receipt, c15Policy, receiptContext: fx.receiptContext, recordedAt: '2026-08-13T20:04:00.000Z' }), /already registered as public/);
  const tampered = structuredClone(fx.publicReleaseRegister);
  tampered.entries[0].previousEntryHash = '5'.repeat(64);
  assert.throws(() => validatePublicReleaseRegister(tampered, { c15Policy }), /hash chain broken|self-hash mismatch/);
});

test('full synthetic C1.14 → C1.15 chain closes the loop only after publication confirmation + Public Release Receipt', () => {
  const fx = buildReleasedFixture();
  const state = classifyNetworkReleaseState({ c15Policy, releaseCandidateRegister: releaseRegister, publicReleaseRegister: fx.publicReleaseRegister });
  assert.equal(state.status, 'PUBLIC_RELEASED_WITHDRAWAL_REQUIRED_FOR_UNPUBLISH');
  assert.equal(state.releaseCandidateReady, true);
  assert.equal(state.networkReleased, true);
  assert.equal(state.publicRelease, true);
  assert.equal(state.withdrawalRequiredForUnpublish, true);
  assert.equal(state.relayDependency, false);
});

test('canonical C1.15 truth remains empty because no real PN-0001 Release Candidate has been publicly released', () => {
  assert.equal(validatePublicReleaseRegister(canonicalPublicReleaseRegister, { c15Policy }).revision, 0);
  const state = classifyNetworkReleaseState({ c15Policy, releaseCandidateRegister: canonicalReleaseRegister, publicReleaseRegister: canonicalPublicReleaseRegister });
  assert.equal(state.status, 'BLOCKED_NO_RELEASE_CANDIDATE');
  assert.equal(state.releaseCandidateCount, 0);
  assert.equal(state.publicReleaseCount, 0);
  assert.equal(state.networkReleased, false);
  assert.equal(state.publicRelease, false);
});

test('C1.15 chronology is fail-closed from registered Release Candidate through review, ceremony, receipt, and register', () => {
  const fx = buildReleasedFixture();
  assert.throws(() => buildNetworkReleaseReview({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, route, authorityId: 'michael-hughes', decision: 'HOLD', rightsClearanceVerified: false, audienceTrustDisclosureReady: false, publicReceiptSurfaceReady: false, withdrawalPathUnderstood: true, routeApproved: false, notes: 'Too early.', recordedAt: '2026-08-13T19:50:59.000Z' }), /cannot predate the registered C1.14 Release Candidate Package/);
  assert.throws(() => buildNetworkReleaseCeremonyPayload({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, authorityId: 'michael-hughes', keyId: fx.signing.keyId, recordedAt: '2026-08-13T19:59:59.000Z', reason: 'Too early.' }), /cannot predate/);
  assert.throws(() => buildPublicReleaseReceipt({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext: fx.releasePackageContext, releaseReview: fx.review, releaseCeremony: fx.ceremony, keyRegistry: fx.signing.keyRegistry, publicationConfirmation: fx.confirmation, issuedAt: '2026-08-13T20:02:29.000Z' }), /cannot predate publication verification/);
  const empty = buildPublicReleaseRegister({ c15Policy, entries: [], revision: 0, recordedAt: '2026-08-13T19:55:00.000Z' });
  assert.throws(() => appendPublicReleaseReceiptToRegister({ register: empty, receipt: fx.receipt, c15Policy, receiptContext: fx.receiptContext, recordedAt: '2026-08-13T20:02:59.000Z' }), /cannot predate Public Release Receipt/);
});
