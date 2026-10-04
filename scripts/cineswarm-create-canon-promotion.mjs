#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  appendCanonRecordToRegister,
  buildCanonPromotionCeremonyPayload,
  buildCanonRecord,
  signCanonPromotionCeremony,
} from '../packages/cineswarm-bridge/src/canon-ledger-admission.js';

const [canonPolicyPath, masterPolicyPath, masterCandidatePath, masterRegisterPath, canonReviewPath, keyRegistryPath, privateKeyPath, canonRegisterPath, authorityId, keyId, recordedAt, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('Usage: node scripts/cineswarm-create-canon-promotion.mjs <canon-policy.json> <master-policy.json> <master-candidate.json> <master-register.json> <canon-review.json> <key-registry.json> <external-private-key.pem> <canon-register.json> <authority-id> <key-id> <recorded-at> <output-dir>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = readJson(canonPolicyPath);
const masterPolicy = readJson(masterPolicyPath);
const masterCandidate = readJson(masterCandidatePath);
const masterRegister = readJson(masterRegisterPath);
const canonReview = readJson(canonReviewPath);
const keyRegistry = readJson(keyRegistryPath);
const privateKeyPem = readFileSync(resolve(privateKeyPath), 'utf8');
let canonRegister = readJson(canonRegisterPath);
const payload = buildCanonPromotionCeremonyPayload({ policy, masterPolicy, masterCandidate, masterRegister, canonReview, authorityId, keyId, recordedAt });
const ceremony = signCanonPromotionCeremony(payload, { privateKeyPem, keyRegistry });
const canonRecord = buildCanonRecord({ policy, masterPolicy, masterCandidate, masterRegister, canonReview, promotionCeremony: ceremony, keyRegistry, createdAt: recordedAt });
canonRegister = appendCanonRecordToRegister({ register: canonRegister, canonRecord, policy, masterPolicy, recordedAt });
mkdirSync(resolve(outputDir), { recursive: true });
for (const [name, value] of [['canon-promotion-ceremony.json', ceremony], ['canon-record.json', canonRecord], ['canon-register.json', canonRegister]]) writeFileSync(resolve(outputDir, name), `${JSON.stringify(value, null, 2)}\n`);
console.log(JSON.stringify({ created: true, privateKeyPersisted: false, sourcePrivateKeyFile: basename(privateKeyPath), ceremonyHash: ceremony.ceremonyHash, canonRecordHash: canonRecord.canonRecordHash, canonRegisterRevision: canonRegister.revision, ledgerAdmitted: false, networkReleaseEligible: false, publicRelease: false }, null, 2));
