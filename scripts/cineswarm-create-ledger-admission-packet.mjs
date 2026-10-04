#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendLedgerAdmissionPacketToRegister,
  buildLedgerAdmissionPacket,
} from '../packages/cineswarm-bridge/src/canon-ledger-admission.js';

const [canonPolicyPath, masterPolicyPath, masterCandidatePath, masterRegisterPath, canonReviewPath, promotionCeremonyPath, canonRecordPath, canonRegisterPath, keyRegistryPath, ledgerRegisterPath, recordedAt, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('Usage: node scripts/cineswarm-create-ledger-admission-packet.mjs <canon-policy.json> <master-policy.json> <master-candidate.json> <master-register.json> <canon-review.json> <promotion-ceremony.json> <canon-record.json> <canon-register.json> <key-registry.json> <ledger-packet-register.json> <recorded-at> <output-dir>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = readJson(canonPolicyPath);
const masterPolicy = readJson(masterPolicyPath);
const masterCandidate = readJson(masterCandidatePath);
const masterRegister = readJson(masterRegisterPath);
const canonReview = readJson(canonReviewPath);
const promotionCeremony = readJson(promotionCeremonyPath);
const canonRecord = readJson(canonRecordPath);
const canonRegister = readJson(canonRegisterPath);
const keyRegistry = readJson(keyRegistryPath);
let ledgerRegister = readJson(ledgerRegisterPath);
const packet = buildLedgerAdmissionPacket({ policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry, createdAt: recordedAt });
ledgerRegister = appendLedgerAdmissionPacketToRegister({ register: ledgerRegister, packet, policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony, canonRecord, canonRegister, keyRegistry, recordedAt });
mkdirSync(resolve(outputDir), { recursive: true });
writeFileSync(resolve(outputDir, 'ledger-admission-packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'ledger-packet-register.json'), `${JSON.stringify(ledgerRegister, null, 2)}\n`);
console.log(JSON.stringify({ created: true, ledgerPacketHash: packet.ledgerPacketHash, evidenceItemCount: packet.evidenceItemCount, evidenceRootHash: packet.evidenceRootHash, ledgerPacketRegisterRevision: ledgerRegister.revision, ledgerAdmissionEligible: true, ledgerAdmitted: false, networkReleaseEligible: false, publicRelease: false }, null, 2));
