#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  buildAudioLockCeremonyPayload,
  buildLockedAudioManifest,
  signAudioLockCeremony,
} from '../packages/cineswarm-bridge/src/master-review-audio-lock.js';

const [policyArg, audioConformArg, keyRegistryArg, privateKeyArg, outDirArg, authorityIdArg] = process.argv.slice(2);
if (!policyArg || !audioConformArg || !keyRegistryArg || !privateKeyArg || !outDirArg || !authorityIdArg) {
  console.error('Usage: node scripts/cineswarm-create-audio-lock.mjs <c1.12-policy.json> <audio-conform.json> <public-key-registry.json> <external-private-key.pem> <output-dir> <human-authority-id>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = readJson(policyArg);
const audioConformManifest = readJson(audioConformArg);
const keyRegistry = readJson(keyRegistryArg);
const privateKeyPath = resolve(privateKeyArg);
const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
const activeKeys = keyRegistry.keys.filter((key) => key.status === 'active' && key.authority?.id === authorityIdArg);
if (activeKeys.length !== 1) throw new Error(`expected exactly one active signing key for ${authorityIdArg}; found ${activeKeys.length}`);
const recordedAt = new Date().toISOString();
const payload = buildAudioLockCeremonyPayload({ policy, audioConformManifest, authorityId: authorityIdArg, keyId: activeKeys[0].keyId, recordedAt });
const ceremony = signAudioLockCeremony(payload, { privateKeyPem, keyRegistry });
const manifest = buildLockedAudioManifest({ ceremony, audioConformManifest, policy, keyRegistry });
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });
const ceremonyPath = resolve(outDir, `${ceremony.ceremonyId}.json`);
const manifestPath = resolve(outDir, `${manifest.manifestId}.json`);
writeFileSync(ceremonyPath, JSON.stringify(ceremony, null, 2) + '\n');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({
  valid: true,
  privateKeySource: basename(privateKeyPath),
  privateKeyStoredInOutput: false,
  ceremonyPath,
  ceremonyHash: ceremony.ceremonyHash,
  manifestPath,
  manifestHash: manifest.manifestHash,
  mixSha256: manifest.mixAsset.sha256,
  audioLocked: true,
  masterAccepted: false,
  canonEligible: false,
  publicRelease: false,
}, null, 2));
