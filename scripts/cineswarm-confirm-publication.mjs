#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendPublicReleaseReceiptToRegister,
  buildPublicationConfirmation,
  buildPublicReleaseReceipt,
} from '../packages/cineswarm-bridge/src/network-release.js';
import { loadC15ReleaseContext, readJson } from './_cineswarm-c1-15-context.mjs';

const [c15PolicyPath, c14PolicyPath, contextDir, keyRegistryPath, reviewPath, ceremonyPath, publicationEvidencePath, publicReleaseRegisterPath, issuedAt, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('Usage: node scripts/cineswarm-confirm-publication.mjs <c1-15-policy.json> <c1-14-policy.json> <release-context-dir> <combined-key-registry.json> <release-review.json> <release-ceremony.json> <publication-evidence.json> <public-release-register.json> <issued-at> <output-dir>');
  process.exit(64);
}
const c15Policy = readJson(c15PolicyPath);
const releaseReview = readJson(reviewPath);
const releaseCeremony = readJson(ceremonyPath);
const evidence = readJson(publicationEvidencePath);
const { c14Policy, keyRegistry, releasePackage, releaseRegister, releasePackageContext } = loadC15ReleaseContext({ c14PolicyPath, contextDir, keyRegistryPath });
const confirmation = buildPublicationConfirmation({
  c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry,
  publisherId: evidence.publisherId,
  publicationAttemptId: evidence.publicationAttemptId,
  publisherEvidenceSha256: evidence.publisherEvidenceSha256,
  observedHttpStatus: evidence.observedHttpStatus,
  publicReachabilityVerified: evidence.publicReachabilityVerified,
  contentReceiptExposed: evidence.contentReceiptExposed,
  ledgerAdmissionReceiptExposed: evidence.ledgerAdmissionReceiptExposed,
  publishedAt: evidence.publishedAt,
  verifiedAt: evidence.verifiedAt,
});
const receipt = buildPublicReleaseReceipt({ c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry, publicationConfirmation: confirmation, issuedAt });
const receiptContext = { c15Policy, c14Policy, releasePackage, releaseRegister, releasePackageContext, releaseReview, releaseCeremony, keyRegistry, publicationConfirmation: confirmation };
let publicReleaseRegister = readJson(publicReleaseRegisterPath);
publicReleaseRegister = appendPublicReleaseReceiptToRegister({ register: publicReleaseRegister, receipt, c15Policy, receiptContext, recordedAt: issuedAt });
mkdirSync(resolve(outputDir), { recursive: true });
writeFileSync(resolve(outputDir, 'publication-confirmation.json'), `${JSON.stringify(confirmation, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'public-release-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'public-release-register.json'), `${JSON.stringify(publicReleaseRegister, null, 2)}\n`);
console.log(JSON.stringify({ confirmed: true, publicationConfirmationHash: confirmation.publicationConfirmationHash, publicReleaseReceiptHash: receipt.publicReleaseReceiptHash, releaseReceiptEvidenceRootHash: receipt.releaseReceiptEvidenceRootHash, publicReleaseRegisterRevision: publicReleaseRegister.revision, networkReleased: true, publicRelease: true, withdrawalRequiredForUnpublish: true }, null, 2));
