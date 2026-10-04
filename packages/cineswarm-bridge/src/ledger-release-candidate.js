import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import { publicKeyFingerprintSha256 } from './key-ceremony-journal.js';
import {
  validateCanonLedgerPolicy,
  validateLedgerAdmissionPacket,
  validateLedgerPacketRegister,
} from './canon-ledger-admission.js';
import { validateMasterReviewPolicy } from './master-review-audio-lock.js';

export const CINESWARM_LEDGER_RELEASE_POLICY_SCHEMA = 'parallax.cineswarm.ledger-release-policy.c1.14.v0.1';
export const CINESWARM_LEDGER_VERIFICATION_REPORT_SCHEMA = 'parallax.cineswarm.ledger-verification-report.c1.14.v0.1';
export const CINESWARM_LEDGER_ADMISSION_CEREMONY_SCHEMA = 'parallax.cineswarm.ledger-admission-ceremony.c1.14.v0.1';
export const CINESWARM_LEDGER_ADMISSION_RECEIPT_SCHEMA = 'parallax.cineswarm.ledger-admission-receipt.c1.14.v0.1';
export const CINESWARM_LEDGER_ADMISSION_REGISTER_SCHEMA = 'parallax.cineswarm.ledger-admission-register.c1.14.v0.1';
export const CINESWARM_RELEASE_CANDIDATE_PACKAGE_SCHEMA = 'parallax.cineswarm.release-candidate-package.c1.14.v0.1';
export const CINESWARM_RELEASE_CANDIDATE_REGISTER_SCHEMA = 'parallax.cineswarm.release-candidate-register.c1.14.v0.1';

export const C1_14_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_14_LEDGER_ADMISSION_DECISION = 'ADMIT_EXACT_CANON_PACKET_TO_PARALLAX_LEDGER';
const LEDGER_ADMISSION_DOMAIN = 'PARALLAX-CINESWARM-C1.14-LEDGER-ADMISSION';

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
  if (key.status !== 'active') throw new Error(`signing key ${key.keyId} must be active for a new Ledger Admission signature`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Ledger Admission signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Ledger Admission signing key was not valid at recordedAt');
}

function validateKeyForHistoricalSignature(key, authorityId, recordedAt) {
  if (key.status === 'revoked') throw new Error(`signing key ${key.keyId} is revoked`);
  if (key.authority?.kind !== 'human' || key.authority.id !== authorityId) throw new Error('Ledger Admission signing key authority mismatch');
  const when = parseTime(recordedAt, 'recordedAt').time;
  const validFrom = parseTime(key.validFrom, 'key.validFrom').time;
  const validUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil').time : null;
  if (when < validFrom || (validUntil !== null && when >= validUntil)) throw new Error('Ledger Admission signature was created outside key validity');
}

export function validateLedgerReleasePolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('C1.14 Ledger/Release policy must be an object');
  if (policy.schema !== CINESWARM_LEDGER_RELEASE_POLICY_SCHEMA) throw new Error(`unsupported C1.14 policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.canonLedgerPolicyId, 'canonLedgerPolicyId');
  safeToken(policy.masterReviewPolicyId, 'masterReviewPolicyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  if (policy.signatureAlgorithm !== C1_14_SIGNATURE_ALGORITHM) throw new Error(`signatureAlgorithm must remain ${C1_14_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('private key custody must remain external-human-controlled');
  for (const key of [
    'requireRegisteredLedgerAdmissionPacket',
    'requireIndependentLedgerVerificationReport',
    'requireExactEvidenceRoot',
    'requireExactCanonRecordHash',
    'requireExactMasterCandidateHash',
    'requireExactMasterOutputHash',
    'requireHumanLedgerAdmissionSignature',
    'appendOnlyLedgerAdmissionRegister',
    'appendOnlyReleaseCandidateRegister',
    'requireLedgerAdmissionReceiptBeforeReleaseCandidate',
    'requireSeparateNetworkReleaseCeremony',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of [
    'autoLedgerAdmission',
    'autoReleaseCandidateAcceptance',
    'networkReleaseAuthority',
    'publicRelease',
    'relayDependency',
  ]) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function ensurePacketRegistered({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage }) {
  validateLedgerReleasePolicy(c14Policy);
  validateCanonLedgerPolicy(c13Policy);
  validateMasterReviewPolicy(masterPolicy);
  if (c14Policy.canonLedgerPolicyId !== c13Policy.policyId || c14Policy.masterReviewPolicyId !== masterPolicy.policyId) throw new Error('C1.14 policy is not bound to the supplied C1.13/C1.12 policies');
  if (c14Policy.episodeId !== c13Policy.episodeId || c14Policy.sequenceId !== c13Policy.sequenceId) throw new Error('C1.14 policy scope drift detected');
  validateLedgerAdmissionPacket(packet, { policy: c13Policy, masterPolicy, ...lineage });
  validateLedgerPacketRegister(packetRegister, { policy: c13Policy });
  const entry = packetRegister.entries.find((candidate) => candidate.ledgerPacketHash === packet.ledgerPacketHash);
  if (!entry) throw new Error('Ledger Admission Packet must be registered in the C1.13 append-only packet register');
  if (entry.canonRecordHash !== packet.canonRecordHash || entry.masterCandidateHash !== packet.masterCandidateHash || entry.outputSha256 !== packet.outputAsset.sha256 || entry.evidenceRootHash !== packet.evidenceRootHash) throw new Error('C1.13 packet-register lineage drift detected');
  return entry;
}

function verificationHashPayload(report) {
  return withoutFields(report, ['verificationReportHash']);
}

export function buildLedgerVerificationReport({
  c14Policy,
  c13Policy,
  masterPolicy,
  packet,
  packetRegister,
  lineage,
  verifierId,
  verifiedAt,
  notes,
  reportId = null,
}) {
  const packetEntry = ensurePacketRegistered({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage });
  const report = {
    schema: CINESWARM_LEDGER_VERIFICATION_REPORT_SCHEMA,
    reportId: safeToken(reportId ?? `${c14Policy.sequenceId}-ledger-verification-${packet.ledgerPacketHash.slice(0, 12)}`, 'reportId'),
    policyId: c14Policy.policyId,
    canonLedgerPolicyId: c13Policy.policyId,
    episodeId: c14Policy.episodeId,
    sequenceId: c14Policy.sequenceId,
    verifier: { kind: 'ledger-verifier', id: safeToken(verifierId, 'verifierId') },
    packetId: packet.packetId,
    ledgerPacketHash: packet.ledgerPacketHash,
    evidenceRootHash: packet.evidenceRootHash,
    evidenceItemCount: packet.evidenceItemCount,
    packetRegisterHash: packetRegister.registerHash,
    packetRegisterRevision: packetRegister.revision,
    packetRegisterEntryHash: packetEntry.entryHash,
    canonRecordHash: packet.canonRecordHash,
    masterCandidateHash: packet.masterCandidateHash,
    outputSha256: packet.outputAsset.sha256,
    assertions: {
      packetSelfHashValid: true,
      packetRegistered: true,
      evidenceInventoryRebuiltAndMatched: true,
      evidenceRootMatched: true,
      canonPromotionSignatureVerified: true,
      exactMasterCandidateBound: true,
      exactMasterOutputBound: true,
      publicReleaseStillFalse: true,
      relayDependencyStillFalse: true,
    },
    notes: requiredString(notes, 'notes'),
    verifiedAt: parseTime(verifiedAt, 'verifiedAt').text,
    verificationPassed: true,
    ledgerAdmitted: false,
    releaseCandidateEligible: false,
    networkReleaseAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  report.verificationReportHash = digestJson(verificationHashPayload(report));
  return report;
}

export function validateLedgerVerificationReport(report, { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage }) {
  ensurePacketRegistered({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage });
  if (!report || report.schema !== CINESWARM_LEDGER_VERIFICATION_REPORT_SCHEMA) throw new Error('invalid Ledger Verification Report schema');
  safeToken(report.reportId, 'reportId');
  safeToken(report.verifier?.id, 'verifier.id');
  if (report.verifier?.kind !== 'ledger-verifier') throw new Error('Ledger Verification Report verifier kind must be ledger-verifier');
  if (report.policyId !== c14Policy.policyId || report.canonLedgerPolicyId !== c13Policy.policyId || report.episodeId !== c14Policy.episodeId || report.sequenceId !== c14Policy.sequenceId) throw new Error('Ledger Verification Report policy scope mismatch');
  const expected = buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verifierId: report.verifier.id, verifiedAt: report.verifiedAt, notes: report.notes, reportId: report.reportId });
  for (const key of ['ledgerPacketHash', 'evidenceRootHash', 'packetRegisterHash', 'packetRegisterEntryHash', 'canonRecordHash', 'masterCandidateHash', 'outputSha256']) if (report[key] !== expected[key]) throw new Error(`Ledger Verification Report ${key} drift detected`);
  if (report.evidenceItemCount !== expected.evidenceItemCount || report.packetRegisterRevision !== expected.packetRegisterRevision || JSON.stringify(report.assertions) !== JSON.stringify(expected.assertions)) throw new Error('Ledger Verification Report verification assertions drift detected');
  if (report.verificationPassed !== true || report.ledgerAdmitted !== false || report.releaseCandidateEligible !== false || report.networkReleaseAuthorized !== false || report.publicRelease !== false || report.relayDependency !== false) throw new Error('Ledger Verification Report authority/state invariants violated');
  parseTime(report.verifiedAt, 'verifiedAt');
  ensureSha256(report.verificationReportHash, 'verificationReportHash');
  if (report.verificationReportHash !== digestJson(verificationHashPayload(report))) throw new Error('Ledger Verification Report self-hash mismatch');
  return { valid: true, verificationPassed: true, ledgerAdmitted: false };
}

function admissionCeremonyDigestPayload(payload) {
  return withoutFields(payload, ['ceremonyDigest', 'algorithm', 'signatureBase64', 'keyFingerprintSha256', 'ceremonyHash']);
}

function admissionCeremonyHashPayload(ceremony) {
  return withoutFields(ceremony, ['ceremonyHash']);
}

function ledgerAdmissionMessage(ceremonyDigest, ceremony) {
  return [
    LEDGER_ADMISSION_DOMAIN,
    ceremony.ceremonyId,
    ceremonyDigest,
    ceremony.keyId,
    ceremony.authority.id,
    ceremony.recordedAt,
  ].join('\n');
}

export function buildLedgerAdmissionCeremonyPayload({
  c14Policy,
  c13Policy,
  masterPolicy,
  packet,
  packetRegister,
  lineage,
  verificationReport,
  authorityId,
  keyId,
  recordedAt,
  reason,
  ceremonyId = null,
}) {
  validateLedgerVerificationReport(verificationReport, { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage });
  const ceremonyTime = parseTime(recordedAt, 'recordedAt');
  const verificationTime = parseTime(verificationReport.verifiedAt, 'verificationReport.verifiedAt');
  if (ceremonyTime.time < verificationTime.time) throw new Error('Ledger Admission Ceremony cannot predate the Ledger Verification Report');
  const payload = {
    schema: CINESWARM_LEDGER_ADMISSION_CEREMONY_SCHEMA,
    ceremonyId: safeToken(ceremonyId ?? `${c14Policy.sequenceId}-ledger-admission-${packet.ledgerPacketHash.slice(0, 12)}`, 'ceremonyId'),
    policyId: c14Policy.policyId,
    episodeId: c14Policy.episodeId,
    sequenceId: c14Policy.sequenceId,
    decision: C1_14_LEDGER_ADMISSION_DECISION,
    packetId: packet.packetId,
    ledgerPacketHash: packet.ledgerPacketHash,
    evidenceRootHash: packet.evidenceRootHash,
    packetRegisterHash: packetRegister.registerHash,
    packetRegisterRevision: packetRegister.revision,
    verificationReportId: verificationReport.reportId,
    verificationReportHash: verificationReport.verificationReportHash,
    canonRecordHash: packet.canonRecordHash,
    masterCandidateHash: packet.masterCandidateHash,
    outputSha256: packet.outputAsset.sha256,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    keyId: safeToken(keyId, 'keyId'),
    reason: requiredString(reason, 'reason'),
    recordedAt: ceremonyTime.text,
    ledgerAdmissionAuthorized: true,
    releaseCandidateAssemblyAuthorized: true,
    networkReleaseAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  payload.ceremonyDigest = digestJson(admissionCeremonyDigestPayload(payload));
  return payload;
}

export function signLedgerAdmissionCeremony(payload, { privateKeyPem, keyRegistry }) {
  if (!payload || payload.schema !== CINESWARM_LEDGER_ADMISSION_CEREMONY_SCHEMA) throw new Error('invalid Ledger Admission Ceremony payload schema');
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not a private key');
  const key = findKey(keyRegistry, payload.keyId);
  validateKeyForNewSignature(key, payload.authority?.id, payload.recordedAt);
  if (payload.ceremonyDigest !== digestJson(admissionCeremonyDigestPayload(payload))) throw new Error('Ledger Admission Ceremony payload digest mismatch');
  const signatureBase64 = cryptoSign(null, Buffer.from(ledgerAdmissionMessage(payload.ceremonyDigest, payload), 'utf8'), privateKeyPem).toString('base64');
  const ceremony = { ...structuredClone(payload), algorithm: C1_14_SIGNATURE_ALGORITHM, signatureBase64, keyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem) };
  ceremony.ceremonyHash = digestJson(admissionCeremonyHashPayload(ceremony));
  return ceremony;
}

export function verifyLedgerAdmissionCeremony({ ceremony, c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, keyRegistry }) {
  validateLedgerVerificationReport(verificationReport, { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage });
  if (!ceremony || ceremony.schema !== CINESWARM_LEDGER_ADMISSION_CEREMONY_SCHEMA) throw new Error('invalid Ledger Admission Ceremony schema');
  if (ceremony.policyId !== c14Policy.policyId || ceremony.episodeId !== c14Policy.episodeId || ceremony.sequenceId !== c14Policy.sequenceId) throw new Error('Ledger Admission Ceremony policy scope mismatch');
  if (ceremony.decision !== C1_14_LEDGER_ADMISSION_DECISION || ceremony.ledgerAdmissionAuthorized !== true || ceremony.releaseCandidateAssemblyAuthorized !== true || ceremony.networkReleaseAuthorized !== false || ceremony.publicRelease !== false || ceremony.relayDependency !== false) throw new Error('Ledger Admission Ceremony authority/state invariants violated');
  if (ceremony.ledgerPacketHash !== packet.ledgerPacketHash || ceremony.evidenceRootHash !== packet.evidenceRootHash || ceremony.packetRegisterHash !== packetRegister.registerHash || ceremony.packetRegisterRevision !== packetRegister.revision || ceremony.verificationReportHash !== verificationReport.verificationReportHash || ceremony.canonRecordHash !== packet.canonRecordHash || ceremony.masterCandidateHash !== packet.masterCandidateHash || ceremony.outputSha256 !== packet.outputAsset.sha256) throw new Error('Ledger Admission Ceremony lineage drift detected');
  ensureSha256(ceremony.ceremonyDigest, 'ceremonyDigest');
  ensureSha256(ceremony.ceremonyHash, 'ceremonyHash');
  requiredString(ceremony.signatureBase64, 'signatureBase64');
  ensureSha256(ceremony.keyFingerprintSha256, 'keyFingerprintSha256');
  if (ceremony.algorithm !== C1_14_SIGNATURE_ALGORITHM) throw new Error('Ledger Admission Ceremony signature algorithm mismatch');
  if (ceremony.authority?.kind !== 'human') throw new Error('Ledger Admission Ceremony authority must be human');
  safeToken(ceremony.authority?.id, 'authority.id');
  const key = findKey(keyRegistry, ceremony.keyId);
  validateKeyForHistoricalSignature(key, ceremony.authority.id, ceremony.recordedAt);
  if (ceremony.keyFingerprintSha256 !== publicKeyFingerprintSha256(key.publicKeyPem)) throw new Error('Ledger Admission key fingerprint mismatch');
  if (ceremony.ceremonyDigest !== digestJson(admissionCeremonyDigestPayload(ceremony))) throw new Error('Ledger Admission Ceremony digest mismatch');
  if (ceremony.ceremonyHash !== digestJson(admissionCeremonyHashPayload(ceremony))) throw new Error('Ledger Admission Ceremony self-hash mismatch');
  const signatureOk = cryptoVerify(null, Buffer.from(ledgerAdmissionMessage(ceremony.ceremonyDigest, ceremony), 'utf8'), key.publicKeyPem, Buffer.from(ceremony.signatureBase64, 'base64'));
  if (!signatureOk) throw new Error('Ledger Admission Ceremony signature verification failed');
  return { valid: true, ledgerAdmissionAuthorized: true, networkReleaseAuthorized: false };
}

function admissionReceiptHashPayload(receipt) {
  return withoutFields(receipt, ['ledgerAdmissionReceiptHash']);
}

export function buildLedgerAdmissionReceipt({
  c14Policy,
  c13Policy,
  masterPolicy,
  packet,
  packetRegister,
  lineage,
  verificationReport,
  admissionCeremony,
  keyRegistry,
  admittedAt,
  receiptId = null,
}) {
  verifyLedgerAdmissionCeremony({ ceremony: admissionCeremony, c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, keyRegistry });
  const admissionTime = parseTime(admittedAt, 'admittedAt');
  const ceremonyTime = parseTime(admissionCeremony.recordedAt, 'admissionCeremony.recordedAt');
  if (admissionTime.time < ceremonyTime.time) throw new Error('Ledger Admission Receipt cannot predate the signed admission ceremony');
  const receipt = {
    schema: CINESWARM_LEDGER_ADMISSION_RECEIPT_SCHEMA,
    receiptId: safeToken(receiptId ?? `${c14Policy.sequenceId}-ledger-receipt-${packet.ledgerPacketHash.slice(0, 12)}`, 'receiptId'),
    policyId: c14Policy.policyId,
    episodeId: c14Policy.episodeId,
    sequenceId: c14Policy.sequenceId,
    state: 'LEDGER_ADMITTED',
    packetId: packet.packetId,
    ledgerPacketHash: packet.ledgerPacketHash,
    evidenceRootHash: packet.evidenceRootHash,
    evidenceItemCount: packet.evidenceItemCount,
    packetRegisterHash: packetRegister.registerHash,
    packetRegisterRevision: packetRegister.revision,
    verificationReportId: verificationReport.reportId,
    verificationReportHash: verificationReport.verificationReportHash,
    admissionCeremonyId: admissionCeremony.ceremonyId,
    admissionCeremonyHash: admissionCeremony.ceremonyHash,
    canonRecordHash: packet.canonRecordHash,
    masterCandidateHash: packet.masterCandidateHash,
    outputAsset: structuredClone(packet.outputAsset),
    admittedBy: structuredClone(admissionCeremony.authority),
    admittedAt: admissionTime.text,
    ledgerAdmitted: true,
    releaseCandidateAssemblyEligible: true,
    networkReleaseCeremonyRequired: true,
    networkReleaseAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.ledgerAdmissionReceiptHash = digestJson(admissionReceiptHashPayload(receipt));
  return receipt;
}

export function validateLedgerAdmissionReceipt(receipt, { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, admissionCeremony, keyRegistry }) {
  if (!receipt || receipt.schema !== CINESWARM_LEDGER_ADMISSION_RECEIPT_SCHEMA) throw new Error('invalid Ledger Admission Receipt schema');
  const expected = buildLedgerAdmissionReceipt({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, admissionCeremony, keyRegistry, admittedAt: receipt.admittedAt, receiptId: receipt.receiptId });
  for (const key of ['ledgerPacketHash', 'evidenceRootHash', 'packetRegisterHash', 'verificationReportHash', 'admissionCeremonyHash', 'canonRecordHash', 'masterCandidateHash']) if (receipt[key] !== expected[key]) throw new Error(`Ledger Admission Receipt ${key} drift detected`);
  if (receipt.outputAsset?.sha256 !== expected.outputAsset.sha256 || receipt.outputAsset?.sizeBytes !== expected.outputAsset.sizeBytes || receipt.outputAsset?.mediaType !== expected.outputAsset.mediaType) throw new Error('Ledger Admission Receipt output asset drift detected');
  if (receipt.state !== 'LEDGER_ADMITTED' || receipt.ledgerAdmitted !== true || receipt.releaseCandidateAssemblyEligible !== true || receipt.networkReleaseCeremonyRequired !== true || receipt.networkReleaseAuthorized !== false || receipt.publicRelease !== false || receipt.relayDependency !== false) throw new Error('Ledger Admission Receipt authority/state invariants violated');
  ensureSha256(receipt.ledgerAdmissionReceiptHash, 'ledgerAdmissionReceiptHash');
  if (receipt.ledgerAdmissionReceiptHash !== digestJson(admissionReceiptHashPayload(receipt))) throw new Error('Ledger Admission Receipt self-hash mismatch');
  return { valid: true, ledgerAdmitted: true, releaseCandidateAssemblyEligible: true, publicRelease: false };
}

function admissionRegisterEntryHashPayload(entry) {
  return withoutFields(entry, ['entryHash']);
}
function admissionRegisterHashPayload(register) {
  return withoutFields(register, ['registerHash']);
}

export function buildLedgerAdmissionRegister({ c14Policy, entries = [], revision = 0, recordedAt }) {
  validateLedgerReleasePolicy(c14Policy);
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Ledger Admission Register revision must equal entry count');
  let previous = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Ledger Admission Register hash chain broken at entry ${index}`);
    for (const [value, label] of [[entry.ledgerAdmissionReceiptHash, 'ledgerAdmissionReceiptHash'], [entry.ledgerPacketHash, 'ledgerPacketHash'], [entry.evidenceRootHash, 'evidenceRootHash'], [entry.outputSha256, 'outputSha256'], [entry.entryHash, 'entryHash']]) ensureSha256(value, `entries[${index}].${label}`);
    if (entry.entryHash !== digestJson(admissionRegisterEntryHashPayload(entry))) throw new Error(`Ledger Admission Register entry ${index} self-hash mismatch`);
    if (entry.ledgerAdmitted !== true || entry.networkReleased !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Ledger Admission Register entry violates authority boundaries');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_LEDGER_ADMISSION_REGISTER_SCHEMA,
    registerId: `${c14Policy.sequenceId}-ledger-admission-register`,
    policyId: c14Policy.policyId,
    episodeId: c14Policy.episodeId,
    sequenceId: c14Policy.sequenceId,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    status: entries.length ? 'LEDGER_ADMITTED_RELEASE_CANDIDATE_PACKAGE_ALLOWED' : 'EMPTY_NO_LEDGER_ADMISSIONS',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: previous,
    ledgerAdmittedCount: entries.length,
    networkReleaseCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(admissionRegisterHashPayload(register));
  return register;
}

export function validateLedgerAdmissionRegister(register, { c14Policy }) {
  if (!register || register.schema !== CINESWARM_LEDGER_ADMISSION_REGISTER_SCHEMA) throw new Error('invalid Ledger Admission Register schema');
  const rebuilt = buildLedgerAdmissionRegister({ c14Policy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'ledgerAdmittedCount', 'networkReleaseCount']) if (register[key] !== rebuilt[key]) throw new Error(`Ledger Admission Register ${key} mismatch`);
  if (register.registerHash !== digestJson(admissionRegisterHashPayload(register))) throw new Error('Ledger Admission Register self-hash mismatch');
  if (register.publicRelease !== false || register.relayDependency !== false) throw new Error('Ledger Admission Register authority boundary violated');
  return { valid: true, revision: register.revision, ledgerAdmittedCount: register.ledgerAdmittedCount };
}

export function appendLedgerAdmissionReceiptToRegister({ register, receipt, c14Policy, receiptContext, recordedAt }) {
  validateLedgerAdmissionRegister(register, { c14Policy });
  validateLedgerAdmissionReceipt(receipt, receiptContext);
  if (register.entries.some((entry) => entry.ledgerAdmissionReceiptHash === receipt.ledgerAdmissionReceiptHash || entry.ledgerPacketHash === receipt.ledgerPacketHash)) throw new Error('this Ledger Admission Packet has already been admitted');
  const entry = {
    entryId: `${c14Policy.sequenceId}-ledger-admission-event-${String(register.revision + 1).padStart(4, '0')}`,
    receiptId: receipt.receiptId,
    ledgerAdmissionReceiptHash: receipt.ledgerAdmissionReceiptHash,
    ledgerPacketHash: receipt.ledgerPacketHash,
    evidenceRootHash: receipt.evidenceRootHash,
    canonRecordHash: receipt.canonRecordHash,
    masterCandidateHash: receipt.masterCandidateHash,
    outputSha256: receipt.outputAsset.sha256,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    ledgerAdmitted: true,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(admissionRegisterEntryHashPayload(entry));
  return buildLedgerAdmissionRegister({ c14Policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

function releasePackageHashPayload(pkg) {
  return withoutFields(pkg, ['releaseCandidatePackageHash']);
}

function releaseEvidenceRoot(items) {
  return digestJson(items.map((item) => ({ kind: item.kind, id: item.id, sha256: item.sha256 })));
}

export function buildReleaseCandidatePackage({
  c14Policy,
  packet,
  verificationReport,
  admissionCeremony,
  admissionReceipt,
  admissionRegister,
  receiptContext,
  createdAt,
  packageId = null,
}) {
  validateLedgerReleasePolicy(c14Policy);
  validateLedgerAdmissionReceipt(admissionReceipt, receiptContext);
  validateLedgerAdmissionRegister(admissionRegister, { c14Policy });
  const packageTime = parseTime(createdAt, 'createdAt');
  const receiptTime = parseTime(admissionReceipt.admittedAt, 'admissionReceipt.admittedAt');
  if (packageTime.time < receiptTime.time) throw new Error('Release Candidate Package cannot predate Ledger admission');
  const admissionEntry = admissionRegister.entries.find((entry) => entry.ledgerAdmissionReceiptHash === admissionReceipt.ledgerAdmissionReceiptHash);
  if (!admissionEntry) throw new Error('Ledger Admission Receipt must be registered before Release Candidate Package assembly');
  if (admissionReceipt.ledgerPacketHash !== packet.ledgerPacketHash || admissionReceipt.verificationReportHash !== verificationReport.verificationReportHash || admissionReceipt.admissionCeremonyHash !== admissionCeremony.ceremonyHash) throw new Error('Release Candidate Package admission lineage drift detected');
  const evidenceInventory = [
    { kind: 'master-output', id: 'master-output', sha256: packet.outputAsset.sha256 },
    { kind: 'master-candidate', id: 'master-candidate', sha256: packet.masterCandidateHash },
    { kind: 'canon-record', id: 'canon-record', sha256: packet.canonRecordHash },
    { kind: 'c1-13-ledger-admission-packet', id: packet.packetId, sha256: packet.ledgerPacketHash },
    { kind: 'c1-13-ledger-evidence-root', id: 'c1-13-evidence-root', sha256: packet.evidenceRootHash },
    { kind: 'c1-14-ledger-verification-report', id: verificationReport.reportId, sha256: verificationReport.verificationReportHash },
    { kind: 'c1-14-ledger-admission-ceremony', id: admissionCeremony.ceremonyId, sha256: admissionCeremony.ceremonyHash },
    { kind: 'c1-14-ledger-admission-receipt', id: admissionReceipt.receiptId, sha256: admissionReceipt.ledgerAdmissionReceiptHash },
    { kind: 'c1-14-ledger-admission-register', id: admissionRegister.registerId, sha256: admissionRegister.registerHash },
  ];
  const pkg = {
    schema: CINESWARM_RELEASE_CANDIDATE_PACKAGE_SCHEMA,
    packageId: safeToken(packageId ?? `${c14Policy.sequenceId}-release-candidate-${admissionReceipt.ledgerAdmissionReceiptHash.slice(0, 12)}`, 'packageId'),
    policyId: c14Policy.policyId,
    episodeId: c14Policy.episodeId,
    sequenceId: c14Policy.sequenceId,
    state: 'RELEASE_CANDIDATE_PACKAGE',
    outputAsset: structuredClone(packet.outputAsset),
    masterCandidateHash: packet.masterCandidateHash,
    canonRecordHash: packet.canonRecordHash,
    ledgerPacketHash: packet.ledgerPacketHash,
    ledgerEvidenceRootHash: packet.evidenceRootHash,
    ledgerVerificationReportHash: verificationReport.verificationReportHash,
    ledgerAdmissionCeremonyHash: admissionCeremony.ceremonyHash,
    ledgerAdmissionReceiptHash: admissionReceipt.ledgerAdmissionReceiptHash,
    ledgerAdmissionRegisterHash: admissionRegister.registerHash,
    evidenceInventory,
    releaseEvidenceRootHash: releaseEvidenceRoot(evidenceInventory),
    createdAt: packageTime.text,
    ledgerAdmitted: true,
    releaseCandidate: true,
    releaseCeremonyEligible: true,
    networkReleaseCeremonyRequired: true,
    networkReleaseAuthorized: false,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
  pkg.releaseCandidatePackageHash = digestJson(releasePackageHashPayload(pkg));
  return pkg;
}

export function validateReleaseCandidatePackage(pkg, { c14Policy, packet, verificationReport, admissionCeremony, admissionReceipt, admissionRegister, receiptContext }) {
  if (!pkg || pkg.schema !== CINESWARM_RELEASE_CANDIDATE_PACKAGE_SCHEMA) throw new Error('invalid Release Candidate Package schema');
  const expected = buildReleaseCandidatePackage({ c14Policy, packet, verificationReport, admissionCeremony, admissionReceipt, admissionRegister, receiptContext, createdAt: pkg.createdAt, packageId: pkg.packageId });
  for (const key of ['masterCandidateHash', 'canonRecordHash', 'ledgerPacketHash', 'ledgerEvidenceRootHash', 'ledgerVerificationReportHash', 'ledgerAdmissionCeremonyHash', 'ledgerAdmissionReceiptHash', 'ledgerAdmissionRegisterHash', 'releaseEvidenceRootHash']) if (pkg[key] !== expected[key]) throw new Error(`Release Candidate Package ${key} drift detected`);
  if (pkg.outputAsset?.sha256 !== expected.outputAsset.sha256 || JSON.stringify(pkg.evidenceInventory) !== JSON.stringify(expected.evidenceInventory)) throw new Error('Release Candidate Package inventory/output drift detected');
  if (pkg.state !== 'RELEASE_CANDIDATE_PACKAGE' || pkg.ledgerAdmitted !== true || pkg.releaseCandidate !== true || pkg.releaseCeremonyEligible !== true || pkg.networkReleaseCeremonyRequired !== true || pkg.networkReleaseAuthorized !== false || pkg.networkReleased !== false || pkg.publicRelease !== false || pkg.relayDependency !== false) throw new Error('Release Candidate Package authority/state invariants violated');
  ensureSha256(pkg.releaseCandidatePackageHash, 'releaseCandidatePackageHash');
  if (pkg.releaseCandidatePackageHash !== digestJson(releasePackageHashPayload(pkg))) throw new Error('Release Candidate Package self-hash mismatch');
  return { valid: true, releaseCeremonyEligible: true, networkReleased: false, publicRelease: false };
}

function releaseRegisterEntryHashPayload(entry) { return withoutFields(entry, ['entryHash']); }
function releaseRegisterHashPayload(register) { return withoutFields(register, ['registerHash']); }

export function buildReleaseCandidateRegister({ c14Policy, entries = [], revision = 0, recordedAt }) {
  validateLedgerReleasePolicy(c14Policy);
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Release Candidate Register revision must equal entry count');
  let previous = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Release Candidate Register hash chain broken at entry ${index}`);
    for (const [value, label] of [[entry.releaseCandidatePackageHash, 'releaseCandidatePackageHash'], [entry.ledgerAdmissionReceiptHash, 'ledgerAdmissionReceiptHash'], [entry.outputSha256, 'outputSha256'], [entry.entryHash, 'entryHash']]) ensureSha256(value, `entries[${index}].${label}`);
    if (entry.entryHash !== digestJson(releaseRegisterEntryHashPayload(entry))) throw new Error(`Release Candidate Register entry ${index} self-hash mismatch`);
    if (entry.releaseCeremonyEligible !== true || entry.networkReleased !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Release Candidate Register entry violates authority boundaries');
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_RELEASE_CANDIDATE_REGISTER_SCHEMA,
    registerId: `${c14Policy.sequenceId}-release-candidate-register`,
    policyId: c14Policy.policyId,
    episodeId: c14Policy.episodeId,
    sequenceId: c14Policy.sequenceId,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    status: entries.length ? 'RELEASE_CANDIDATE_READY_NETWORK_RELEASE_CEREMONY_REQUIRED' : 'EMPTY_NO_RELEASE_CANDIDATES',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: previous,
    releaseCandidateCount: entries.length,
    networkReleasedCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(releaseRegisterHashPayload(register));
  return register;
}

export function validateReleaseCandidateRegister(register, { c14Policy }) {
  if (!register || register.schema !== CINESWARM_RELEASE_CANDIDATE_REGISTER_SCHEMA) throw new Error('invalid Release Candidate Register schema');
  const rebuilt = buildReleaseCandidateRegister({ c14Policy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'releaseCandidateCount', 'networkReleasedCount']) if (register[key] !== rebuilt[key]) throw new Error(`Release Candidate Register ${key} mismatch`);
  if (register.registerHash !== digestJson(releaseRegisterHashPayload(register))) throw new Error('Release Candidate Register self-hash mismatch');
  if (register.publicRelease !== false || register.relayDependency !== false) throw new Error('Release Candidate Register authority boundary violated');
  return { valid: true, revision: register.revision, releaseCandidateCount: register.releaseCandidateCount };
}

export function appendReleaseCandidatePackageToRegister({ register, pkg, c14Policy, packageContext, recordedAt }) {
  validateReleaseCandidateRegister(register, { c14Policy });
  validateReleaseCandidatePackage(pkg, packageContext);
  if (register.entries.some((entry) => entry.releaseCandidatePackageHash === pkg.releaseCandidatePackageHash || entry.ledgerAdmissionReceiptHash === pkg.ledgerAdmissionReceiptHash)) throw new Error('Release Candidate Package for this Ledger Admission Receipt is already registered');
  const entry = {
    entryId: `${c14Policy.sequenceId}-release-candidate-event-${String(register.revision + 1).padStart(4, '0')}`,
    packageId: pkg.packageId,
    releaseCandidatePackageHash: pkg.releaseCandidatePackageHash,
    ledgerAdmissionReceiptHash: pkg.ledgerAdmissionReceiptHash,
    canonRecordHash: pkg.canonRecordHash,
    masterCandidateHash: pkg.masterCandidateHash,
    outputSha256: pkg.outputAsset.sha256,
    previousEntryHash: register.headHash,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    releaseCeremonyEligible: true,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(releaseRegisterEntryHashPayload(entry));
  return buildReleaseCandidateRegister({ c14Policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: entry.recordedAt });
}

export function classifyLedgerReleaseReadiness({ c14Policy, c13PacketRegister, admissionRegister, releaseCandidateRegister }) {
  validateLedgerReleasePolicy(c14Policy);
  if (!c13PacketRegister || !Number.isInteger(c13PacketRegister.packetCount)) throw new Error('C1.13 packet register is required');
  validateLedgerAdmissionRegister(admissionRegister, { c14Policy });
  validateReleaseCandidateRegister(releaseCandidateRegister, { c14Policy });
  const packetReady = c13PacketRegister.packetCount > 0;
  const ledgerAdmitted = admissionRegister.ledgerAdmittedCount > 0;
  const releaseCandidateReady = releaseCandidateRegister.releaseCandidateCount > 0;
  let status = 'BLOCKED_NO_LEDGER_ADMISSION_PACKET';
  if (packetReady && !ledgerAdmitted) status = 'LEDGER_PACKET_READY_ADMISSION_DECISION_PENDING';
  if (ledgerAdmitted && !releaseCandidateReady) status = 'LEDGER_ADMITTED_RELEASE_CANDIDATE_PACKAGE_REQUIRED';
  if (releaseCandidateReady) status = 'RELEASE_CANDIDATE_READY_NETWORK_RELEASE_CEREMONY_REQUIRED';
  return {
    status,
    ledgerAdmissionPacketCount: c13PacketRegister.packetCount,
    ledgerAdmitted,
    ledgerAdmittedCount: admissionRegister.ledgerAdmittedCount,
    releaseCandidateReady,
    releaseCandidateCount: releaseCandidateRegister.releaseCandidateCount,
    releaseCeremonyEligible: releaseCandidateReady,
    networkReleaseAuthorized: false,
    networkReleased: false,
    publicRelease: false,
    relayDependency: false,
  };
}
