#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildNetworkReleaseReview } from '../packages/cineswarm-bridge/src/network-release.js';
import { loadC15ReleaseContext, readJson } from './_cineswarm-c1-15-context.mjs';

const [c15PolicyPath, c14PolicyPath, contextDir, keyRegistryPath, routePath, authorityId, recordedAt, outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error('Usage: node scripts/cineswarm-create-network-release-review.mjs <c1-15-policy.json> <c1-14-policy.json> <release-context-dir> <combined-key-registry.json> <route.json> <human-authority-id> <recorded-at> <output-review.json>');
  process.exit(64);
}
const c15Policy = readJson(c15PolicyPath);
const route = readJson(routePath);
const { c14Policy, releasePackage, releaseRegister, releasePackageContext } = loadC15ReleaseContext({ c14PolicyPath, contextDir, keyRegistryPath });
const review = buildNetworkReleaseReview({
  c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, route, authorityId,
  decision: 'APPROVE_FOR_PUBLIC_RELEASE',
  rightsClearanceVerified: true,
  audienceTrustDisclosureReady: true,
  publicReceiptSurfaceReady: true,
  withdrawalPathUnderstood: true,
  routeApproved: true,
  notes: 'Human C1.15 review approved this exact registered Release Candidate Package for the exact named Parallax Network route. This review does not itself authorize or confirm publication.',
  recordedAt,
});
mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify({ reviewCreated: true, reviewHash: review.reviewHash, routeHash: review.routeHash, eligibleForNetworkReleaseCeremony: review.eligibleForNetworkReleaseCeremony, networkReleaseAuthorized: false, publicRelease: false }, null, 2));
