#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  buildMasterAcceptanceCeremonyPayload,
  buildMasterCandidate,
  signMasterAcceptanceCeremony,
  validateMasterReview,
} from '../packages/cineswarm-bridge/src/master-review-audio-lock.js';

const [policyArg, renderCandidateArg, masterReviewArg, lockedAudioArg, audioRegisterArg, keyRegistryArg, privateKeyArg, outDirArg, authorityIdArg] = process.argv.slice(2);
if (!policyArg || !renderCandidateArg || !masterReviewArg || !lockedAudioArg || !audioRegisterArg || !keyRegistryArg || !privateKeyArg || !outDirArg || !authorityIdArg) {
  console.error('Usage: node scripts/cineswarm-create-master-candidate.mjs <c1.12-policy.json> <render-candidate.json> <master-review.json> <locked-audio-manifest.json> <audio-lock-register.json> <public-key-registry.json> <external-private-key.pem> <output-dir> <human-authority-id>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = readJson(policyArg);
const renderCandidate = readJson(renderCandidateArg);
const masterReview = readJson(masterReviewArg);
const lockedAudioManifest = readJson(lockedAudioArg);
const audioLockRegister = readJson(audioRegisterArg);
const keyRegistry = readJson(keyRegistryArg);
const privateKeyPath = resolve(privateKeyArg);
const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
const activeKeys = keyRegistry.keys.filter((key) => key.status === 'active' && key.authority?.id === authorityIdArg);
if (activeKeys.length !== 1) throw new Error(`expected exactly one active signing key for ${authorityIdArg}; found ${activeKeys.length}`);
const reviewState = validateMasterReview(masterReview, { policy, renderCandidate, lockedAudioManifest, audioLockRegister });
if (!reviewState.acceptedForMasterCeremony) throw new Error('Master Review is not ACCEPT_MASTER_CANDIDATE');
const recordedAt = new Date().toISOString();
const payload = buildMasterAcceptanceCeremonyPayload({ policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, authorityId: authorityIdArg, keyId: activeKeys[0].keyId, recordedAt });
const ceremony = signMasterAcceptanceCeremony(payload, { privateKeyPem, keyRegistry });
const candidate = buildMasterCandidate({ policy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister, acceptanceCeremony: ceremony, keyRegistry, createdAt: recordedAt });
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });
const ceremonyPath = resolve(outDir, `${ceremony.ceremonyId}.json`);
const candidatePath = resolve(outDir, `${candidate.masterCandidateId}.json`);
writeFileSync(ceremonyPath, JSON.stringify(ceremony, null, 2) + '\n');
writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n');
console.log(JSON.stringify({
  valid: true,
  privateKeySource: basename(privateKeyPath),
  privateKeyStoredInOutput: false,
  ceremonyPath,
  ceremonyHash: ceremony.ceremonyHash,
  candidatePath,
  masterCandidateHash: candidate.masterCandidateHash,
  outputSha256: candidate.outputAsset.sha256,
  masterAccepted: true,
  canonEligible: false,
  ledgerPromotionEligible: false,
  publicRelease: false,
}, null, 2));
