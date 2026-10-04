#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildNetworkReleaseCeremonyPayload, signNetworkReleaseCeremony } from '../packages/cineswarm-bridge/src/network-release.js';
import { loadC15ReleaseContext, readJson } from './_cineswarm-c1-15-context.mjs';

const [c15PolicyPath, c14PolicyPath, contextDir, keyRegistryPath, reviewPath, privateKeyPath, authorityId, recordedAt, outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error('Usage: node scripts/cineswarm-authorize-network-release.mjs <c1-15-policy.json> <c1-14-policy.json> <release-context-dir> <combined-key-registry.json> <release-review.json> <external-private-key.pem> <human-authority-id> <recorded-at> <output-ceremony.json>');
  process.exit(64);
}
const c15Policy = readJson(c15PolicyPath);
const releaseReview = readJson(reviewPath);
const { c14Policy, keyRegistry, releasePackage, releaseRegister, releasePackageContext } = loadC15ReleaseContext({ c14PolicyPath, contextDir, keyRegistryPath });
const privateKeyPem = readFileSync(resolve(privateKeyPath), 'utf8');
const active = keyRegistry.keys.filter((key) => key.status === 'active' && key.authority?.kind === 'human' && key.authority.id === authorityId);
if (!active.length) throw new Error('no active human signing key is registered for the requested Network Release authority');
const keyId = active.at(-1).keyId;
const payload = buildNetworkReleaseCeremonyPayload({
  c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview,
  authorityId, keyId, recordedAt,
  reason: 'Authorize publication of this exact Release Candidate Package to this exact Parallax Network route. Publication success must still be independently confirmed.',
});
const ceremony = signNetworkReleaseCeremony(payload, { privateKeyPem, keyRegistry });
mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(ceremony, null, 2)}\n`);
console.log(JSON.stringify({ authorized: true, ceremonyHash: ceremony.ceremonyHash, releaseCandidatePackageHash: ceremony.releaseCandidatePackageHash, routeHash: ceremony.routeHash, networkReleaseAuthorized: true, publicReleaseAuthorized: true, networkReleased: false, publicRelease: false }, null, 2));
