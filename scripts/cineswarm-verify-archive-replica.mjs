#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReplicaVerificationReport } from '../packages/cineswarm-bridge/src/archive-recovery.js';

const args = process.argv.slice(2);
if (args.length < 5 || args.length > 6) {
  console.error('Usage: node scripts/cineswarm-verify-archive-replica.mjs <policy.json> <recovery-bundle.json> <replica-manifest.json> <replica-root> <verifier-id> [output.json]');
  process.exit(64);
}
const [policyPath, bundlePath, manifestPath, rootPath, verifierId, outputPath] = args;
const load = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = load(policyPath);
const recoveryBundle = load(bundlePath);
const replicaManifest = load(manifestPath);
const root = resolve(rootPath);
const observations = replicaManifest.objects.map((item) => {
  const file = resolve(root, item.relativePath);
  if (!file.startsWith(root) || !existsSync(file)) return { kind: item.kind, expectedBlobSha256: item.blobSha256, expectedSizeBytes: item.sizeBytes, available: false, observedBlobSha256: null, observedSizeBytes: null };
  const bytes = readFileSync(file);
  return { kind: item.kind, expectedBlobSha256: item.blobSha256, expectedSizeBytes: item.sizeBytes, available: true, observedBlobSha256: createHash('sha256').update(bytes).digest('hex'), observedSizeBytes: statSync(file).size };
});
const report = buildReplicaVerificationReport({ c18Policy: policy, recoveryBundle, replicaManifest, observations, verifierId, verifiedAt: new Date().toISOString() });
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), text);
console.log(text.trim());
if (report.health !== 'HEALTHY') process.exitCode = 2;
