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
  appendWithdrawalToLifecycleRegister,
  buildReleaseLifecycleRegister,
  buildWithdrawalCeremonyPayload,
  buildWithdrawalConfirmation,
  buildWithdrawalReceipt,
  buildWithdrawalReview,
  signWithdrawalCeremony,
} from '../src/release-lifecycle.js';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const proof = (name) => read(`c1-15-proof-base/${name}`);
export const c17Policy = read('pn-0001-c1-17-public-archive-policy.json');
export const c16Policy = read('pn-0001-c1-16-release-lifecycle-policy.json');
export const c15Policy = read('pn-0001-c1-15-network-release-policy.json');
const c14Policy = read('pn-0001-c1-14-ledger-release-policy.json');
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

function signingMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const keyRegistry = structuredClone(baseKeyRegistry);
  const keyId = 'proof_c1_17_archive_001';
  keyRegistry.keys.push({ keyId, algorithm: 'Ed25519', status: 'active', authority: { kind: 'human', id: 'michael-hughes' }, publicKeyPem, validFrom: '2026-08-13T20:00:00.000Z', validUntil: null });
  return { privateKeyPem, keyId, keyRegistry };
}

const route = { networkId: 'parallax-network', publicPath: '/watch/welcome-to-parallax-network', contentSlug: 'welcome-to-parallax-network', channelSlug: 'parallax-originals', visibility: 'public' };

function createC15Release(signing) {
  const releasePackageContext = packageContext(signing.keyRegistry);
  const review = buildNetworkReleaseReview({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, route, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_PUBLIC_RELEASE', rightsClearanceVerified: true, audienceTrustDisclosureReady: true, publicReceiptSurfaceReady: true, withdrawalPathUnderstood: true, routeApproved: true, notes: 'C1.17 archive proof release review.', recordedAt: '2026-08-13T20:10:00.000Z', reviewId: 'proof_c1_17_release_review' });
  const payload = buildNetworkReleaseCeremonyPayload({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, authorityId: 'michael-hughes', keyId: signing.keyId, recordedAt: '2026-08-13T20:11:00.000Z', reason: 'C1.17 proof release authorization.', ceremonyId: 'proof_c1_17_release_ceremony' });
  const ceremony = signNetworkReleaseCeremony(payload, { privateKeyPem: signing.privateKeyPem, keyRegistry: signing.keyRegistry });
  const confirmation = buildPublicationConfirmation({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publisherId: 'proof-publisher', publicationAttemptId: 'proof_c1_17_attempt', publisherEvidenceSha256: '9'.repeat(64), observedHttpStatus: 200, publicReachabilityVerified: true, contentReceiptExposed: true, ledgerAdmissionReceiptExposed: true, publishedAt: '2026-08-13T20:12:00.000Z', verifiedAt: '2026-08-13T20:12:30.000Z', confirmationId: 'proof_c1_17_publication_confirmation' });
  const receipt = buildPublicReleaseReceipt({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publicationConfirmation: confirmation, issuedAt: '2026-08-13T20:13:00.000Z', receiptId: 'proof_c1_17_public_release_receipt' });
  const receiptContext = { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview: review, releaseCeremony: ceremony, keyRegistry: signing.keyRegistry, publicationConfirmation: confirmation };
  return { receipt, receiptContext };
}

export function buildC1_17ActiveFixture() {
  const signing = signingMaterial();
  const original = createC15Release(signing);
  let c15Register = buildPublicReleaseRegister({ c15Policy, entries: [], revision: 0, recordedAt: '2026-08-13T20:09:00.000Z' });
  c15Register = appendPublicReleaseReceiptToRegister({ register: c15Register, receipt: original.receipt, c15Policy, receiptContext: original.receiptContext, recordedAt: '2026-08-13T20:13:30.000Z' });
  const lifecycle = buildReleaseLifecycleRegister({ c16Policy, c15Policy, c15PublicReleaseRegister: c15Register, entries: [], revision: 0, recordedAt: '2026-08-13T20:14:00.000Z' });
  return { signing, original, c15Register, lifecycle };
}

export function buildC1_17WithdrawnFixture() {
  const fx = buildC1_17ActiveFixture();
  const withdrawalReview = buildWithdrawalReview({ c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, authorityId: 'michael-hughes', decision: 'APPROVE_WITHDRAWAL', reasonCode: 'EDITORIAL_CORRECTION', reason: 'C1.17 proof requires archive notice.', historicalReceiptPreserved: true, withdrawalNoticePrepared: true, routeWithdrawalApproved: true, notes: 'Preserve historical receipt for archive.', recordedAt: '2026-08-13T20:15:00.000Z' });
  const payload = buildWithdrawalCeremonyPayload({ c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview, authorityId: 'michael-hughes', keyId: fx.signing.keyId, recordedAt: '2026-08-13T20:16:00.000Z', reason: 'Withdraw proof release for archive test.' });
  const ceremony = signWithdrawalCeremony(payload, { privateKeyPem: fx.signing.privateKeyPem, keyRegistry: fx.signing.keyRegistry });
  const confirmation = buildWithdrawalConfirmation({ c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview, withdrawalCeremony: ceremony, keyRegistry: fx.signing.keyRegistry, verifierId: 'proof-c1-17-withdrawal-verifier', withdrawalEvidenceSha256: '7'.repeat(64), observedHttpStatus: 200, withdrawnOutputNoLongerServed: true, withdrawalNoticeReachable: true, historicalReceiptReachable: true, confirmedAt: '2026-08-13T20:17:00.000Z' });
  const withdrawalReceipt = buildWithdrawalReceipt({ c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview, withdrawalCeremony: ceremony, keyRegistry: fx.signing.keyRegistry, withdrawalConfirmation: confirmation, issuedAt: '2026-08-13T20:18:00.000Z' });
  const withdrawalReceiptContext = { c16Policy, c15Policy, publicReleaseReceipt: fx.original.receipt, publicReleaseRegister: fx.c15Register, publicReceiptContext: fx.original.receiptContext, withdrawalReview, withdrawalCeremony: ceremony, keyRegistry: fx.signing.keyRegistry, withdrawalConfirmation: confirmation };
  const lifecycle = appendWithdrawalToLifecycleRegister({ register: fx.lifecycle, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, withdrawalReceipt, withdrawalReceiptContext, recordedAt: '2026-08-13T20:18:30.000Z' });
  return { ...fx, lifecycle, withdrawalReceipt, withdrawalReceiptContext };
}
