#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildC17EnrollCeremonyFromOfflineResponse, stageHumanKeyEnrollment } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124DContext } from './lib/c1-24d-context.mjs';
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const challengePath = arg('challenge'); const responsePath = arg('response'); const ack = arg('ack-fingerprint'); const outDir = resolve(arg('out-dir', './c1-24d-key-enrollment-stage'));
if (!challengePath || !responsePath || !ack) throw new Error('Usage: --challenge <challenge.json> --response <enrollment-response.json> --ack-fingerprint <full SHA-256> [--out-dir <dir>]');
const c = loadC124DContext(); const challenge = JSON.parse(readFileSync(resolve(challengePath), 'utf8')); const response = JSON.parse(readFileSync(resolve(responsePath), 'utf8'));
const recordedAt = new Date().toISOString();
const ceremony = buildC17EnrollCeremonyFromOfflineResponse({ response, challenge, policy: c.kitPolicy, keyCeremonyPolicy: c.keyCeremonyPolicy, keyRegistry: c.keyRegistry, recordedAt, exactFingerprintAcknowledgement: ack });
const staged = stageHumanKeyEnrollment({ ceremony, keyRegistry: c.keyRegistry, keyCeremonyPolicy: c.keyCeremonyPolicy, now: recordedAt });
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'C1_7_HUMAN_KEY_ENROLLMENT_CEREMONY.json'), JSON.stringify(ceremony, null, 2) + '\n');
writeFileSync(resolve(outDir, 'STAGED_SIGNING_KEY_REGISTRY.json'), JSON.stringify(staged.stagedRegistry, null, 2) + '\n');
writeFileSync(resolve(outDir, 'STAGE_RECEIPT.json'), JSON.stringify({ stagedAt: recordedAt, keyId: staged.keyId, fingerprintSha256: staged.fingerprintSha256, canonicalKeyRegistryMutated: false, nextAction: 'Human/operator may separately install this public-only registry after reviewing the exact fingerprint.', publicRelease: false, relayDependency: false }, null, 2) + '\n');
console.log(JSON.stringify({ staged: true, outDir, keyId: staged.keyId, fingerprintSha256: staged.fingerprintSha256, canonicalKeyRegistryMutated: false, privateKeyImported: false }, null, 2));
