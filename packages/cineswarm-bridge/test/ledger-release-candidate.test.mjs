import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendLedgerAdmissionReceiptToRegister,
  appendReleaseCandidatePackageToRegister,
  buildLedgerAdmissionCeremonyPayload,
  buildLedgerAdmissionReceipt,
  buildLedgerAdmissionRegister,
  buildLedgerVerificationReport,
  buildReleaseCandidatePackage,
  buildReleaseCandidateRegister,
  classifyLedgerReleaseReadiness,
  signLedgerAdmissionCeremony,
  validateLedgerAdmissionReceipt,
  validateLedgerAdmissionRegister,
  validateLedgerReleasePolicy,
  validateLedgerVerificationReport,
  validateReleaseCandidatePackage,
  validateReleaseCandidateRegister,
  verifyLedgerAdmissionCeremony,
} from '../src/ledger-release-candidate.js';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const proof = (name) => read(`c1-14-proof-base/${name}`);

const c14Policy = read('pn-0001-c1-14-ledger-release-policy.json');
const canonicalAdmissionRegister = read('pn-0001-c1-14-ledger-admission-register.json');
const canonicalReleaseRegister = read('pn-0001-c1-14-release-candidate-register.json');
const c13Policy = proof('canon-policy.json');
const masterPolicy = proof('master-policy.json');
const masterCandidate = proof('master-candidate.json');
const masterRegister = proof('master-register.json');
const canonReview = proof('canon-review.json');
const promotionCeremony = proof('canon-promotion-ceremony.json');
const canonRecord = proof('canon-record.json');
const canonRegister = proof('canon-register.json');
const packet = proof('ledger-admission-packet.json');
const packetRegister = proof('ledger-packet-register.json');
const baseKeyRegistry = proof('key-registry.json');

const lineage = { masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry: baseKeyRegistry };

function ledgerSigningMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const keyId = 'proof_ledger_c1_14_001';
  const keyRegistry = structuredClone(baseKeyRegistry);
  keyRegistry.keys.push({
    keyId,
    algorithm: 'Ed25519',
    status: 'active',
    authority: { kind: 'human', id: 'michael-hughes' },
    publicKeyPem,
    validFrom: '2026-08-13T19:40:00.000Z',
    validUntil: null,
  });
  return { privateKeyPem, keyId, keyRegistry };
}

function buildAdmittedFixture() {
  const report = buildLedgerVerificationReport({
    c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage,
    verifierId: 'parallax-ledger-local-verifier',
    verifiedAt: '2026-08-13T19:45:00.000Z',
    notes: 'Independent C1.14 proof verification of the exact C1.13 packet and packet-register lineage.',
  });
  const signing = ledgerSigningMaterial();
  const payload = buildLedgerAdmissionCeremonyPayload({
    c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage,
    verificationReport: report,
    authorityId: 'michael-hughes',
    keyId: signing.keyId,
    recordedAt: '2026-08-13T19:46:00.000Z',
    reason: 'Proof-only admission of the exact verified Canon/Ledger packet into the synthetic C1.14 Ledger path.',
  });
  const ceremony = signLedgerAdmissionCeremony(payload, { privateKeyPem: signing.privateKeyPem, keyRegistry: signing.keyRegistry });
  const receipt = buildLedgerAdmissionReceipt({
    c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage,
    verificationReport: report, admissionCeremony: ceremony, keyRegistry: signing.keyRegistry,
    admittedAt: '2026-08-13T19:47:00.000Z',
  });
  let admissionRegister = buildLedgerAdmissionRegister({ c14Policy, entries: [], revision: 0, recordedAt: '2026-08-13T19:40:00.000Z' });
  const receiptContext = { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: report, admissionCeremony: ceremony, keyRegistry: signing.keyRegistry };
  admissionRegister = appendLedgerAdmissionReceiptToRegister({ register: admissionRegister, receipt, c14Policy, receiptContext, recordedAt: '2026-08-13T19:47:00.000Z' });
  const packageContext = { c14Policy, packet, verificationReport: report, admissionCeremony: ceremony, admissionReceipt: receipt, admissionRegister, receiptContext };
  const releasePackage = buildReleaseCandidatePackage({ ...packageContext, createdAt: '2026-08-13T19:48:00.000Z' });
  let releaseRegister = buildReleaseCandidateRegister({ c14Policy, entries: [], revision: 0, recordedAt: '2026-08-13T19:40:00.000Z' });
  releaseRegister = appendReleaseCandidatePackageToRegister({ register: releaseRegister, pkg: releasePackage, c14Policy, packageContext, recordedAt: '2026-08-13T19:48:00.000Z' });
  return { report, signing, payload, ceremony, receipt, receiptContext, admissionRegister, releasePackage, packageContext, releaseRegister };
}

test('C1.14 policy preserves independent Ledger admission and separate Network release authority', () => {
  assert.equal(validateLedgerReleasePolicy(c14Policy).valid, true);
  const bad = structuredClone(c14Policy);
  bad.networkReleaseAuthority = true;
  assert.throws(() => validateLedgerReleasePolicy(bad), /networkReleaseAuthority must remain false/);
});

test('independent Ledger Verification Report rebuilds the exact C1.13 packet and registered evidence root', () => {
  const report = buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verifierId: 'parallax-ledger-local-verifier', verifiedAt: '2026-08-13T19:45:00.000Z', notes: 'Exact packet verification.' });
  const result = validateLedgerVerificationReport(report, { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage });
  assert.equal(result.verificationPassed, true);
  assert.equal(report.ledgerPacketHash, packet.ledgerPacketHash);
  assert.equal(report.evidenceRootHash, packet.evidenceRootHash);
  assert.equal(report.packetRegisterHash, packetRegister.registerHash);
  assert.equal(report.ledgerAdmitted, false);
});

test('Ledger Verification Report rejects a packet that is valid but not registered in the C1.13 packet register', () => {
  const empty = structuredClone(packetRegister);
  empty.entries = [];
  empty.revision = 0;
  empty.entryCount = 0;
  empty.packetCount = 0;
  empty.headHash = null;
  empty.status = 'EMPTY_NO_LEDGER_ADMISSION_PACKETS';
  empty.recordedAt = '2026-08-13T19:40:00.000Z';
  // Rebuild through the C1.13 builder is intentionally avoided; a structurally stale register must fail closed.
  assert.throws(() => buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister: empty, lineage, verifierId: 'parallax-ledger-local-verifier', verifiedAt: '2026-08-13T19:45:00.000Z', notes: 'Should fail.' }), /self-hash mismatch|registerHash|must be registered/);
});

test('Ledger Verification Report is tamper evident even when downstream admission has not started', () => {
  const report = buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verifierId: 'parallax-ledger-local-verifier', verifiedAt: '2026-08-13T19:45:00.000Z', notes: 'Exact packet verification.' });
  report.outputSha256 = '0'.repeat(64);
  assert.throws(() => validateLedgerVerificationReport(report, { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage }), /outputSha256 drift|self-hash mismatch/);
});

test('human Ledger Admission Ceremony signs the exact verification report, packet, evidence root, and output', () => {
  const fx = buildAdmittedFixture();
  const result = verifyLedgerAdmissionCeremony({ ceremony: fx.ceremony, c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: fx.report, keyRegistry: fx.signing.keyRegistry });
  assert.equal(result.ledgerAdmissionAuthorized, true);
  assert.equal(result.networkReleaseAuthorized, false);
  assert.equal(fx.ceremony.outputSha256, packet.outputAsset.sha256);
});

test('new Ledger Admission signature refuses retired keys and exact-lineage tampering', () => {
  const report = buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verifierId: 'parallax-ledger-local-verifier', verifiedAt: '2026-08-13T19:45:00.000Z', notes: 'Exact packet verification.' });
  const signing = ledgerSigningMaterial();
  signing.keyRegistry.keys.find((key) => key.keyId === signing.keyId).status = 'retired';
  const payload = buildLedgerAdmissionCeremonyPayload({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: report, authorityId: 'michael-hughes', keyId: signing.keyId, recordedAt: '2026-08-13T19:46:00.000Z', reason: 'Should fail.' });
  assert.throws(() => signLedgerAdmissionCeremony(payload, { privateKeyPem: signing.privateKeyPem, keyRegistry: signing.keyRegistry }), /must be active/);

  const fx = buildAdmittedFixture();
  const tampered = structuredClone(fx.ceremony);
  tampered.outputSha256 = '1'.repeat(64);
  assert.throws(() => verifyLedgerAdmissionCeremony({ ceremony: tampered, c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: fx.report, keyRegistry: fx.signing.keyRegistry }), /lineage drift|digest mismatch|self-hash mismatch/);
});

test('Ledger Admission Receipt is immutable evidence of admission but grants no Network release authority', () => {
  const fx = buildAdmittedFixture();
  const result = validateLedgerAdmissionReceipt(fx.receipt, fx.receiptContext);
  assert.equal(result.ledgerAdmitted, true);
  assert.equal(fx.receipt.releaseCandidateAssemblyEligible, true);
  assert.equal(fx.receipt.networkReleaseAuthorized, false);
  assert.equal(fx.receipt.publicRelease, false);
});

test('Ledger Admission Receipt detects post-admission output or evidence drift', () => {
  const fx = buildAdmittedFixture();
  const tampered = structuredClone(fx.receipt);
  tampered.evidenceRootHash = '2'.repeat(64);
  assert.throws(() => validateLedgerAdmissionReceipt(tampered, fx.receiptContext), /evidenceRootHash drift|self-hash mismatch/);
});

test('append-only Ledger Admission Register records admission once and rejects replay', () => {
  const fx = buildAdmittedFixture();
  assert.equal(validateLedgerAdmissionRegister(fx.admissionRegister, { c14Policy }).ledgerAdmittedCount, 1);
  assert.throws(() => appendLedgerAdmissionReceiptToRegister({ register: fx.admissionRegister, receipt: fx.receipt, c14Policy, receiptContext: fx.receiptContext, recordedAt: '2026-08-13T19:49:00.000Z' }), /already been admitted/);
  const tampered = structuredClone(fx.admissionRegister);
  tampered.entries[0].previousEntryHash = '3'.repeat(64);
  assert.throws(() => validateLedgerAdmissionRegister(tampered, { c14Policy }), /hash chain broken|self-hash mismatch/);
});

test('Release Candidate Package assembles only after registered Ledger Admission Receipt and carries nine exact evidence links', () => {
  const fx = buildAdmittedFixture();
  assert.equal(validateReleaseCandidatePackage(fx.releasePackage, fx.packageContext).releaseCeremonyEligible, true);
  assert.equal(fx.releasePackage.evidenceInventory.length, 9);
  assert.equal(fx.releasePackage.ledgerAdmitted, true);
  assert.equal(fx.releasePackage.networkReleaseAuthorized, false);
  assert.equal(fx.releasePackage.networkReleased, false);
  assert.equal(fx.releasePackage.publicRelease, false);
});

test('Release Candidate Package cannot be assembled from an unregistered Ledger Admission Receipt', () => {
  const fx = buildAdmittedFixture();
  const emptyAdmission = buildLedgerAdmissionRegister({ c14Policy, entries: [], revision: 0, recordedAt: '2026-08-13T19:40:00.000Z' });
  assert.throws(() => buildReleaseCandidatePackage({ c14Policy, packet, verificationReport: fx.report, admissionCeremony: fx.ceremony, admissionReceipt: fx.receipt, admissionRegister: emptyAdmission, receiptContext: fx.receiptContext, createdAt: '2026-08-13T19:48:00.000Z' }), /must be registered/);
});

test('Release Candidate Package and append-only register detect output drift and duplicate package registration', () => {
  const fx = buildAdmittedFixture();
  const tampered = structuredClone(fx.releasePackage);
  tampered.outputAsset.sha256 = '4'.repeat(64);
  assert.throws(() => validateReleaseCandidatePackage(tampered, fx.packageContext), /inventory\/output drift|self-hash mismatch/);
  assert.equal(validateReleaseCandidateRegister(fx.releaseRegister, { c14Policy }).releaseCandidateCount, 1);
  assert.throws(() => appendReleaseCandidatePackageToRegister({ register: fx.releaseRegister, pkg: fx.releasePackage, c14Policy, packageContext: fx.packageContext, recordedAt: '2026-08-13T19:50:00.000Z' }), /already registered/);
});

test('full synthetic C1.13 → C1.14 path reaches Release Candidate ready while Network release remains unauthorized', () => {
  const fx = buildAdmittedFixture();
  const state = classifyLedgerReleaseReadiness({ c14Policy, c13PacketRegister: packetRegister, admissionRegister: fx.admissionRegister, releaseCandidateRegister: fx.releaseRegister });
  assert.equal(state.status, 'RELEASE_CANDIDATE_READY_NETWORK_RELEASE_CEREMONY_REQUIRED');
  assert.equal(state.ledgerAdmitted, true);
  assert.equal(state.releaseCandidateReady, true);
  assert.equal(state.releaseCeremonyEligible, true);
  assert.equal(state.networkReleaseAuthorized, false);
  assert.equal(state.networkReleased, false);
  assert.equal(state.publicRelease, false);
});

test('canonical C1.14 truth remains empty because no real C1.13 Ledger packet has been admitted', () => {
  assert.equal(validateLedgerAdmissionRegister(canonicalAdmissionRegister, { c14Policy }).revision, 0);
  assert.equal(validateReleaseCandidateRegister(canonicalReleaseRegister, { c14Policy }).revision, 0);
  const canonicalPacketRegister = read('pn-0001-c1-13-ledger-packet-register.json');
  const state = classifyLedgerReleaseReadiness({ c14Policy, c13PacketRegister: canonicalPacketRegister, admissionRegister: canonicalAdmissionRegister, releaseCandidateRegister: canonicalReleaseRegister });
  assert.equal(state.status, 'BLOCKED_NO_LEDGER_ADMISSION_PACKET');
  assert.equal(state.ledgerAdmittedCount, 0);
  assert.equal(state.releaseCandidateCount, 0);
  assert.equal(state.publicRelease, false);
});

test('C1.14 chronology is fail-closed: admission cannot predate verification and Release Candidate cannot predate admission', () => {
  const report = buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verifierId: 'parallax-ledger-local-verifier', verifiedAt: '2026-08-13T19:45:00.000Z', notes: 'Exact packet verification.' });
  const signing = ledgerSigningMaterial();
  assert.throws(() => buildLedgerAdmissionCeremonyPayload({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: report, authorityId: 'michael-hughes', keyId: signing.keyId, recordedAt: '2026-08-13T19:44:59.000Z', reason: 'Too early.' }), /cannot predate/);
  const fx = buildAdmittedFixture();
  assert.throws(() => buildReleaseCandidatePackage({ ...fx.packageContext, createdAt: '2026-08-13T19:46:59.000Z' }), /cannot predate Ledger admission/);
});

test('a forged/rehashed admission register cannot substitute for validating the signed Ledger Admission Receipt', () => {
  const fx = buildAdmittedFixture();
  const tamperedReceipt = structuredClone(fx.receipt);
  tamperedReceipt.outputAsset.sha256 = '5'.repeat(64);
  // Even if an attacker fabricates a register-like object around that changed receipt, package assembly must first re-verify the signed receipt lineage.
  const forgedRegister = structuredClone(fx.admissionRegister);
  forgedRegister.entries[0].ledgerAdmissionReceiptHash = tamperedReceipt.ledgerAdmissionReceiptHash;
  assert.throws(() => buildReleaseCandidatePackage({ c14Policy, packet, verificationReport: fx.report, admissionCeremony: fx.ceremony, admissionReceipt: tamperedReceipt, admissionRegister: forgedRegister, receiptContext: fx.receiptContext, createdAt: '2026-08-13T19:48:00.000Z' }), /output asset drift|self-hash mismatch|drift detected/);
});
