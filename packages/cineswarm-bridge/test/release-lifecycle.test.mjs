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
  signNetworkReleaseCeremony,
} from '../src/network-release.js';
import {
  appendSupersessionToLifecycleRegister,
  appendWithdrawalToLifecycleRegister,
  buildCorrectionReview,
  buildReleaseLifecycleRegister,
  buildSupersessionCeremonyPayload,
  buildSupersessionReceipt,
  buildWithdrawalCeremonyPayload,
  buildWithdrawalConfirmation,
  buildWithdrawalReceipt,
  buildWithdrawalReview,
  classifyReleaseLifecycle,
  signSupersessionCeremony,
  signWithdrawalCeremony,
  validateCorrectionReview,
  validateReleaseLifecyclePolicy,
  validateReleaseLifecycleRegister,
  validateSupersessionReceipt,
  validateWithdrawalConfirmation,
  validateWithdrawalReceipt,
  validateWithdrawalReview,
  verifySupersessionCeremony,
  verifyWithdrawalCeremony,
} from '../src/release-lifecycle.js';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const proof = (name) => read(`c1-15-proof-base/${name}`);
const c16Policy = read('pn-0001-c1-16-release-lifecycle-policy.json');
const c15Policy = read('pn-0001-c1-15-network-release-policy.json');
const c14Policy = read('pn-0001-c1-14-ledger-release-policy.json');
const canonicalC15Register = read('pn-0001-c1-15-public-release-register.json');
const canonicalLifecycle = read('pn-0001-c1-16-release-lifecycle-register.json');
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

function packageContext(keyRegistry = baseKeyRegistry) {
  const lineage = {
    masterCandidate: proof('master-candidate.json'), masterRegister: proof('master-register.json'),
    canonReview: proof('canon-review.json'), promotionCeremony: proof('canon-promotion-ceremony.json'),
    canonRecord: proof('canon-record.json'), canonRegister: proof('canon-register.json'), keyRegistry,
  };
  const receiptContext = { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, admissionCeremony, keyRegistry };
  return { c14Policy, packet, verificationReport, admissionCeremony, admissionReceipt, admissionRegister, receiptContext };
}

function signingMaterial(id = 'proof_c1_16_release_lifecycle_001') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const keyRegistry = structuredClone(baseKeyRegistry);
  keyRegistry.keys.push({ keyId: id, algorithm: 'Ed25519', status: 'active', authority: { kind: 'human', id: 'michael-hughes' }, publicKeyPem, validFrom: '2026-08-13T20:00:00.000Z', validUntil: null });
  return { privateKeyPem, publicKeyPem, keyId: id, keyRegistry };
}

const route = { networkId: 'parallax-network', publicPath: '/watch/welcome-to-parallax-network', contentSlug: 'welcome-to-parallax-network', channelSlug: 'parallax-originals', visibility: 'public' };

function createC15Release({ signing, releaseIdSuffix = 'a', startMinute = 10, targetRoute = route }) {
  const releasePackageContext = packageContext(signing.keyRegistry);
  const m = (offset) => String(startMinute + offset).padStart(2, '0');
  const review = buildNetworkReleaseReview({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, route: targetRoute, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_PUBLIC_RELEASE', rightsClearanceVerified: true, audienceTrustDisclosureReady: true, publicReceiptSurfaceReady: true, withdrawalPathUnderstood: true, routeApproved: true, notes: `Proof release review ${releaseIdSuffix}.`, recordedAt: `2026-08-13T20:${m(0)}:00.000Z`, reviewId: `proof_release_review_${releaseIdSuffix}` });
  const payload = buildNetworkReleaseCeremonyPayload({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, authorityId: 'michael-hughes', keyId: signing.keyId, recordedAt: `2026-08-13T20:${m(1)}:00.000Z`, reason: `Proof release authorization ${releaseIdSuffix}.`, ceremonyId: `proof_release_ceremony_${releaseIdSuffix}` });
  const ceremony = signNetworkReleaseCeremony(payload, { privateKeyPem: signing.privateKeyPem, keyRegistry: signing.keyRegistry });
  const confirmation = buildPublicationConfirmation({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publisherId: 'proof-publisher', publicationAttemptId: `proof_attempt_${releaseIdSuffix}`, publisherEvidenceSha256: releaseIdSuffix === 'a' ? '9'.repeat(64) : '8'.repeat(64), observedHttpStatus: 200, publicReachabilityVerified: true, contentReceiptExposed: true, ledgerAdmissionReceiptExposed: true, publishedAt: `2026-08-13T20:${m(2)}:00.000Z`, verifiedAt: `2026-08-13T20:${m(2)}:30.000Z`, confirmationId: `proof_publication_confirmation_${releaseIdSuffix}` });
  const receipt = buildPublicReleaseReceipt({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publicationConfirmation: confirmation, issuedAt: `2026-08-13T20:${m(3)}:00.000Z`, receiptId: `proof_public_release_receipt_${releaseIdSuffix}` });
  const receiptContext = { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publicationConfirmation: confirmation };
  return { releasePackageContext, review, ceremony, confirmation, receipt, receiptContext };
}

function buildLifecycleFixture() {
  const signing = signingMaterial();
  const original = createC15Release({ signing, releaseIdSuffix: 'a', startMinute: 10 });
  let c15Register = buildPublicReleaseRegister({ c15Policy, entries: [], revision: 0, recordedAt: '2026-08-13T20:09:00.000Z' });
  c15Register = appendPublicReleaseReceiptToRegister({ register: c15Register, receipt: original.receipt, c15Policy, receiptContext: original.receiptContext, recordedAt: '2026-08-13T20:13:00.000Z' });
  const withdrawalReview = buildWithdrawalReview({ c16Policy, c15Policy, publicReleaseReceipt: original.receipt, publicReleaseRegister: c15Register, publicReceiptContext: original.receiptContext, authorityId: 'michael-hughes', decision: 'APPROVE_WITHDRAWAL', reasonCode: 'EDITORIAL_CORRECTION', reason: 'Proof-only correction requires temporary withdrawal.', historicalReceiptPreserved: true, withdrawalNoticePrepared: true, routeWithdrawalApproved: true, notes: 'Preserve original release history and show correction notice.', recordedAt: '2026-08-13T20:14:00.000Z' });
  const withdrawalPayload = buildWithdrawalCeremonyPayload({ c16Policy, c15Policy, publicReleaseReceipt: original.receipt, publicReleaseRegister: c15Register, publicReceiptContext: original.receiptContext, withdrawalReview, authorityId: 'michael-hughes', keyId: signing.keyId, recordedAt: '2026-08-13T20:15:00.000Z', reason: 'Withdraw exact published release while preserving evidence.' });
  const withdrawalCeremony = signWithdrawalCeremony(withdrawalPayload, { privateKeyPem: signing.privateKeyPem, keyRegistry: signing.keyRegistry });
  const withdrawalConfirmation = buildWithdrawalConfirmation({ c16Policy, c15Policy, publicReleaseReceipt: original.receipt, publicReleaseRegister: c15Register, publicReceiptContext: original.receiptContext, withdrawalReview, withdrawalCeremony, keyRegistry: signing.keyRegistry, verifierId: 'proof-withdrawal-verifier', withdrawalEvidenceSha256: '7'.repeat(64), observedHttpStatus: 200, withdrawnOutputNoLongerServed: true, withdrawalNoticeReachable: true, historicalReceiptReachable: true, confirmedAt: '2026-08-13T20:16:00.000Z' });
  const withdrawalReceipt = buildWithdrawalReceipt({ c16Policy, c15Policy, publicReleaseReceipt: original.receipt, publicReleaseRegister: c15Register, publicReceiptContext: original.receiptContext, withdrawalReview, withdrawalCeremony, keyRegistry: signing.keyRegistry, withdrawalConfirmation, issuedAt: '2026-08-13T20:17:00.000Z' });
  const withdrawalReceiptContext = { c16Policy, c15Policy, publicReleaseReceipt: original.receipt, publicReleaseRegister: c15Register, publicReceiptContext: original.receiptContext, withdrawalReview, withdrawalCeremony, keyRegistry: signing.keyRegistry, withdrawalConfirmation };
  let lifecycle = buildReleaseLifecycleRegister({ c16Policy, c15Policy, c15PublicReleaseRegister: c15Register, entries: [], revision: 0, recordedAt: '2026-08-13T20:13:30.000Z' });
  lifecycle = appendWithdrawalToLifecycleRegister({ register: lifecycle, c16Policy, c15Policy, c15PublicReleaseRegister: c15Register, withdrawalReceipt, withdrawalReceiptContext, recordedAt: '2026-08-13T20:17:30.000Z' });
  return { signing, original, c15Register, withdrawalReview, withdrawalPayload, withdrawalCeremony, withdrawalConfirmation, withdrawalReceipt, withdrawalReceiptContext, lifecycle };
}

function addCorrectionAndSupersession(fx) {
  const replacementPackageContext = packageContext(fx.signing.keyRegistry);
  const correctionReview = buildCorrectionReview({ c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, replacementReleasePackage: releasePackage, replacementReleasePackageContext: replacementPackageContext, targetRoute: route, authorityId: 'michael-hughes', decision: 'APPROVE_CORRECTION_FOR_RERELEASE', correctionKind: 'METADATA_OR_ROUTE', changeSummary: 'Proof-only metadata/provenance correction; same Master bytes intentionally retained.', notes: 'Return the corrected release to the same governed route after withdrawal.', recordedAt: '2026-08-13T20:18:00.000Z' });
  const correctionReviewContext = { c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, replacementReleasePackage: releasePackage, replacementReleasePackageContext: replacementPackageContext };
  const replacement = createC15Release({ signing: fx.signing, releaseIdSuffix: 'b', startMinute: 19, targetRoute: route });
  const supersessionPayload = buildSupersessionCeremonyPayload({ c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt: replacement.receipt, replacementPublicReceiptContext: replacement.receiptContext, authorityId: 'michael-hughes', keyId: fx.signing.keyId, reason: 'Record corrected replacement as successor while preserving withdrawn history.', recordedAt: '2026-08-13T20:23:00.000Z' });
  const supersessionCeremony = signSupersessionCeremony(supersessionPayload, { privateKeyPem: fx.signing.privateKeyPem, keyRegistry: fx.signing.keyRegistry });
  const supersessionReceipt = buildSupersessionReceipt({ c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt: replacement.receipt, replacementPublicReceiptContext: replacement.receiptContext, supersessionCeremony, keyRegistry: fx.signing.keyRegistry, issuedAt: '2026-08-13T20:24:00.000Z' });
  const supersessionReceiptContext = { c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, correctionReview, correctionReviewContext, replacementPublicReleaseReceipt: replacement.receipt, replacementPublicReceiptContext: replacement.receiptContext, supersessionCeremony, keyRegistry: fx.signing.keyRegistry };
  const lifecycle = appendSupersessionToLifecycleRegister({ register: fx.lifecycle, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, supersessionReceipt, supersessionReceiptContext, recordedAt: '2026-08-13T20:24:30.000Z' });
  return { correctionReview, correctionReviewContext, replacement, supersessionPayload, supersessionCeremony, supersessionReceipt, supersessionReceiptContext, lifecycle };
}

test('C1.16 policy forbids auto-withdrawal, auto-supersession, history deletion, and Relay dependency', () => {
  assert.equal(validateReleaseLifecyclePolicy(c16Policy).valid, true);
  for (const key of ['autoWithdrawal','autoSupersession','historyDeletionAllowed','relayDependency']) { const bad = structuredClone(c16Policy); bad[key] = true; assert.throws(() => validateReleaseLifecyclePolicy(bad), new RegExp(`${key} must remain false`)); }
});

test('canonical C1.16 register starts empty and binds exact frozen C1.15 register hash', () => {
  const result = validateReleaseLifecycleRegister(canonicalLifecycle, { c16Policy, c15Policy, c15PublicReleaseRegister: canonicalC15Register });
  assert.equal(result.revision, 0); assert.equal(result.currentPublicRelease, false); assert.equal(canonicalLifecycle.sourceC15PublicReleaseRegisterHash, canonicalC15Register.registerHash);
});

test('Withdrawal Review requires exact registered C1.15 public release and preserves historical receipt', () => {
  const fx = buildLifecycleFixture();
  const result = validateWithdrawalReview(fx.withdrawalReview, { c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext });
  assert.equal(result.eligibleForWithdrawalCeremony, true); assert.equal(fx.withdrawalReview.historicalReceiptPreserved, true); assert.equal(fx.withdrawalReview.publicRelease, true);
});

test('Withdrawal Review cannot approve without notice/history/route readiness', () => {
  const fx = buildLifecycleFixture();
  assert.throws(() => buildWithdrawalReview({ c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, authorityId: 'michael-hughes', decision: 'APPROVE_WITHDRAWAL', reasonCode: 'OTHER', reason: 'bad', historicalReceiptPreserved: true, withdrawalNoticePrepared: false, routeWithdrawalApproved: true, notes: 'bad', recordedAt: '2026-08-13T20:18:00.000Z' }), /requires history preservation/);
});

test('signed Withdrawal Ceremony authorizes withdrawal but does not rewrite historical public-release truth', () => {
  const fx = buildLifecycleFixture();
  const result = verifyWithdrawalCeremony({ ceremony: fx.withdrawalCeremony, c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview: fx.withdrawalReview, keyRegistry: fx.signing.keyRegistry });
  assert.equal(result.withdrawalAuthorized, true); assert.equal(fx.withdrawalCeremony.publicRelease, true); assert.equal(result.publicReleaseStillHistorical, true);
});

test('Withdrawal Ceremony signature rejects exact receipt/route tampering and revoked keys', () => {
  const fx = buildLifecycleFixture();
  const tampered = structuredClone(fx.withdrawalCeremony); tampered.outputSha256 = '0'.repeat(64);
  assert.throws(() => verifyWithdrawalCeremony({ ceremony: tampered, c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview: fx.withdrawalReview, keyRegistry: fx.signing.keyRegistry }), /lineage drift|digest mismatch/);
  const revoked = structuredClone(fx.signing.keyRegistry); revoked.keys.find((k) => k.keyId === fx.signing.keyId).status = 'revoked';
  assert.throws(() => verifyWithdrawalCeremony({ ceremony: fx.withdrawalCeremony, c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview: fx.withdrawalReview, keyRegistry: revoked }), /revoked/);
});

test('Withdrawal Confirmation requires old output removed while notice and historical receipt remain reachable', () => {
  const fx = buildLifecycleFixture();
  const result = validateWithdrawalConfirmation(fx.withdrawalConfirmation, { c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview: fx.withdrawalReview, withdrawalCeremony: fx.withdrawalCeremony, keyRegistry: fx.signing.keyRegistry });
  assert.equal(result.currentPublicRelease, false); assert.equal(result.historicalPublicRelease, true);
  assert.throws(() => buildWithdrawalConfirmation({ c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview: fx.withdrawalReview, withdrawalCeremony: fx.withdrawalCeremony, keyRegistry: fx.signing.keyRegistry, verifierId: 'bad', withdrawalEvidenceSha256: '1'.repeat(64), observedHttpStatus: 200, withdrawnOutputNoLongerServed: true, withdrawalNoticeReachable: false, historicalReceiptReachable: true, confirmedAt: '2026-08-13T20:18:00.000Z' }), /requires output removal/);
});

test('Withdrawal Receipt is immutable proof of current unpublish plus preserved historical release', () => {
  const fx = buildLifecycleFixture();
  const result = validateWithdrawalReceipt(fx.withdrawalReceipt, fx.withdrawalReceiptContext);
  assert.equal(result.currentPublicRelease, false); assert.equal(fx.withdrawalReceipt.historicalPublicRelease, true); assert.equal(fx.withdrawalReceipt.evidenceInventory.length, 4);
  const tampered = structuredClone(fx.withdrawalReceipt); tampered.currentPublicRelease = true;
  assert.throws(() => validateWithdrawalReceipt(tampered, fx.withdrawalReceiptContext), /self-hash mismatch|invariants/);
});

test('lifecycle register transitions active C1.15 release to withdrawn without deleting C1.15 history', () => {
  const fx = buildLifecycleFixture();
  assert.equal(fx.c15Register.publicReleaseCount, 1); assert.equal(fx.c15Register.publicRelease, true);
  assert.equal(fx.lifecycle.activePublicReleaseCount, 0); assert.equal(fx.lifecycle.historicalPublicReleaseCount, 1); assert.equal(fx.lifecycle.withdrawalCount, 1); assert.equal(fx.lifecycle.currentPublicRelease, false); assert.equal(fx.lifecycle.historicalPublicRelease, true);
});

test('duplicate withdrawal and hash-chain tampering fail closed', () => {
  const fx = buildLifecycleFixture();
  assert.throws(() => appendWithdrawalToLifecycleRegister({ register: fx.lifecycle, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, recordedAt: '2026-08-13T20:18:00.000Z' }), /already withdrawn|active historical release/);
  const tampered = structuredClone(fx.lifecycle); tampered.entries[0].outputSha256 = '2'.repeat(64);
  assert.throws(() => validateReleaseLifecycleRegister(tampered, { c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register }), /self-hash mismatch/);
});

test('Correction Review can approve metadata/provenance correction using same Master bytes but remains unreleased', () => {
  const fx = buildLifecycleFixture(); const next = addCorrectionAndSupersession(fx);
  const result = validateCorrectionReview(next.correctionReview, next.correctionReviewContext);
  assert.equal(result.eligibleForNewC1_15ReleaseCeremony, true); assert.equal(next.correctionReview.replacementOutputSha256, fx.withdrawalReceipt.outputSha256); assert.equal(next.correctionReview.replacementPublicRelease, false);
});

test('CONTENT_OR_MASTER correction requires changed Master output hash', () => {
  const fx = buildLifecycleFixture(); const ctx = packageContext(fx.signing.keyRegistry);
  assert.throws(() => buildCorrectionReview({ c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, replacementReleasePackage: releasePackage, replacementReleasePackageContext: ctx, targetRoute: route, authorityId: 'michael-hughes', decision: 'APPROVE_CORRECTION_FOR_RERELEASE', correctionKind: 'CONTENT_OR_MASTER', changeSummary: 'Should fail', notes: 'same output', recordedAt: '2026-08-13T20:18:00.000Z' }), /different Master output/);
});

test('same public route may be reused only through explicit post-withdrawal correction/supersession path', () => {
  const fx = buildLifecycleFixture(); const next = addCorrectionAndSupersession(fx);
  assert.equal(next.replacement.receipt.routeHash, fx.original.receipt.routeHash);
  assert.notEqual(next.replacement.receipt.publicReleaseReceiptHash, fx.original.receipt.publicReleaseReceiptHash);
  assert.equal(next.lifecycle.activePublicReleaseCount, 1); assert.equal(next.lifecycle.supersessionCount, 1);
});

test('signed Supersession Ceremony binds withdrawn receipt, correction review, and replacement Public Release Receipt', () => {
  const fx = buildLifecycleFixture(); const next = addCorrectionAndSupersession(fx);
  const result = verifySupersessionCeremony({ ceremony: next.supersessionCeremony, c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, correctionReview: next.correctionReview, correctionReviewContext: next.correctionReviewContext, replacementPublicReleaseReceipt: next.replacement.receipt, replacementPublicReceiptContext: next.replacement.receiptContext, keyRegistry: fx.signing.keyRegistry });
  assert.equal(result.supersessionAuthorized, true);
  const tampered = structuredClone(next.supersessionCeremony); tampered.replacementOutputSha256 = '3'.repeat(64);
  assert.throws(() => verifySupersessionCeremony({ ceremony: tampered, c16Policy, c15Policy, c14Policy, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, correctionReview: next.correctionReview, correctionReviewContext: next.correctionReviewContext, replacementPublicReleaseReceipt: next.replacement.receipt, replacementPublicReceiptContext: next.replacement.receiptContext, keyRegistry: fx.signing.keyRegistry }), /lineage drift|digest mismatch/);
});

test('Supersession Receipt preserves withdrawn history while naming replacement as current public release', () => {
  const fx = buildLifecycleFixture(); const next = addCorrectionAndSupersession(fx);
  const result = validateSupersessionReceipt(next.supersessionReceipt, next.supersessionReceiptContext);
  assert.equal(result.replacementPublicRelease, true); assert.equal(next.supersessionReceipt.historicalWithdrawnReleasePreserved, true); assert.equal(next.supersessionReceipt.evidenceInventory.length, 4);
});

test('full lifecycle classifies public → withdrawn → corrected replacement without erasing history', () => {
  const fx = buildLifecycleFixture(); const next = addCorrectionAndSupersession(fx);
  const state = classifyReleaseLifecycle({ c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, lifecycleRegister: next.lifecycle });
  assert.equal(state.currentPublicRelease, true); assert.equal(state.historicalPublicRelease, true); assert.equal(state.historicalPublicReleaseCount, 2); assert.equal(state.activePublicReleaseCount, 1); assert.equal(state.withdrawalCount, 1); assert.equal(state.supersessionCount, 1); assert.equal(state.relayDependency, false);
});

test('C1.16 re-validates the exact C1.15 historical register instead of trusting a copied register hash', () => {
  const tampered = structuredClone(canonicalC15Register);
  tampered.registerHash = 'f'.repeat(64);
  assert.throws(() => validateReleaseLifecycleRegister(canonicalLifecycle, { c16Policy, c15Policy, c15PublicReleaseRegister: tampered }), /Public Release Register self-hash mismatch/);
});

test('Correction Review rejects C1.14/C1.15 policy-scope substitution', () => {
  const fx = buildLifecycleFixture();
  const ctx = packageContext(fx.signing.keyRegistry);
  const wrongC14 = structuredClone(c14Policy);
  wrongC14.policyId = 'other-ledger-policy';
  assert.throws(() => buildCorrectionReview({ c16Policy, c15Policy, c14Policy: wrongC14, withdrawalReceipt: fx.withdrawalReceipt, withdrawalReceiptContext: fx.withdrawalReceiptContext, replacementReleasePackage: releasePackage, replacementReleasePackageContext: ctx, targetRoute: route, authorityId: 'michael-hughes', decision: 'HOLD', correctionKind: 'METADATA_OR_ROUTE', changeSummary: 'Scope substitution attempt.', notes: 'Must fail before review.', recordedAt: '2026-08-13T20:18:00.000Z' }), /policy scope does not match/);
});
