#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildQuarantineManifest } from '../packages/cineswarm-bridge/src/asset-intake.js';

const [receiptPath, journalPath, requestPath, packetPath, policyPath, artifactPath, destinationRelative, manifestOutput] = process.argv.slice(2);
if (!manifestOutput) {
  console.error('Usage: node scripts/cineswarm-quarantine-provider-asset.mjs <receipt.json> <journal.json> <request.json> <packet.json> <policy.json> <artifact> <quarantine-relative-path> <manifest-output.json>');
  process.exit(64);
}
const receipt = JSON.parse(readFileSync(resolve(receiptPath), 'utf8'));
const journal = JSON.parse(readFileSync(resolve(journalPath), 'utf8'));
const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
const packet = JSON.parse(readFileSync(resolve(packetPath), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(policyPath), 'utf8'));
const artifactBytes = readFileSync(resolve(artifactPath));
const manifest = buildQuarantineManifest({ receipt, journal, request, packet, policy, artifactBytes, artifactPath: destinationRelative });
const destination = resolve(destinationRelative);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(resolve(artifactPath), destination);
mkdirSync(dirname(resolve(manifestOutput)), { recursive: true });
writeFileSync(resolve(manifestOutput), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ quarantineId: manifest.quarantineId, artifactPath: manifest.artifact.path, sha256: manifest.artifact.sha256, state: manifest.quarantineState, publicRelease: false }, null, 2));
