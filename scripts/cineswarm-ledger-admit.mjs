#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendLedgerAdmissionReceiptToRegister,
  buildLedgerAdmissionCeremonyPayload,
  buildLedgerAdmissionReceipt,
  buildLedgerVerificationReport,
  signLedgerAdmissionCeremony,
} from '../packages/cineswarm-bridge/src/ledger-release-candidate.js';

const [c14PolicyPath, contextDir, keyRegistryPath, privateKeyPath, admissionRegisterPath, authorityId, recordedAt, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('Usage: node scripts/cineswarm-ledger-admit.mjs <c1-14-policy.json> <c1-13-context-dir> <combined-key-registry.json> <external-private-key.pem> <ledger-admission-register.json> <human-authority-id> <recorded-at> <output-dir>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const ctx = (name) => readJson(resolve(contextDir, name));
const c14Policy = readJson(c14PolicyPath);
const c13Policy = ctx('canon-policy.json');
const masterPolicy = ctx('master-policy.json');
const packet = ctx('ledger-admission-packet.json');
const packetRegister = ctx('ledger-packet-register.json');
const keyRegistry = readJson(keyRegistryPath);
const lineage = {
  masterCandidate: ctx('master-candidate.json'),
  masterRegister: ctx('master-register.json'),
  canonReview: ctx('canon-review.json'),
  promotionCeremony: ctx('canon-promotion-ceremony.json'),
  canonRecord: ctx('canon-record.json'),
  canonRegister: ctx('canon-register.json'),
  keyRegistry,
};
const privateKeyPem = readFileSync(resolve(privateKeyPath), 'utf8');
const active = keyRegistry.keys.filter((key) => key.status === 'active' && key.authority?.kind === 'human' && key.authority.id === authorityId);
if (!active.length) throw new Error('no active human signing key is registered for the requested Ledger admission authority');
const keyId = active.at(-1).keyId;
const report = buildLedgerVerificationReport({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verifierId: 'parallax-ledger-local-verifier', verifiedAt: recordedAt, notes: 'C1.14 independent verification rebuilt the exact C1.13 Ledger Admission Packet and confirmed its registered evidence lineage.' });
const payload = buildLedgerAdmissionCeremonyPayload({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: report, authorityId, keyId, recordedAt, reason: 'Admit the exact independently verified Canon/Ledger evidence packet to Parallax Ledger. This does not authorize Network publication.' });
const ceremony = signLedgerAdmissionCeremony(payload, { privateKeyPem, keyRegistry });
const receipt = buildLedgerAdmissionReceipt({ c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: report, admissionCeremony: ceremony, keyRegistry, admittedAt: recordedAt });
let admissionRegister = readJson(admissionRegisterPath);
const receiptContext = { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport: report, admissionCeremony: ceremony, keyRegistry };
admissionRegister = appendLedgerAdmissionReceiptToRegister({ register: admissionRegister, receipt, c14Policy, receiptContext, recordedAt });
mkdirSync(resolve(outputDir), { recursive: true });
writeFileSync(resolve(outputDir, 'ledger-verification-report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'ledger-admission-ceremony.json'), `${JSON.stringify(ceremony, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'ledger-admission-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'ledger-admission-register.json'), `${JSON.stringify(admissionRegister, null, 2)}\n`);
console.log(JSON.stringify({
  admitted: true,
  ledgerPacketHash: packet.ledgerPacketHash,
  evidenceRootHash: packet.evidenceRootHash,
  verificationReportHash: report.verificationReportHash,
  ledgerAdmissionCeremonyHash: ceremony.ceremonyHash,
  ledgerAdmissionReceiptHash: receipt.ledgerAdmissionReceiptHash,
  ledgerAdmissionRegisterRevision: admissionRegister.revision,
  releaseCandidateAssemblyEligible: true,
  networkReleaseAuthorized: false,
  publicRelease: false,
}, null, 2));
