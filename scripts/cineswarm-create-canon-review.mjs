#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCanonReview } from '../packages/cineswarm-bridge/src/canon-ledger-admission.js';

const [canonPolicyPath, masterPolicyPath, masterCandidatePath, masterRegisterPath, authorityId, recordedAt, outputPath, ...notesParts] = process.argv.slice(2);
if (!outputPath) {
  console.error('Usage: node scripts/cineswarm-create-canon-review.mjs <canon-policy.json> <master-policy.json> <master-candidate.json> <master-register.json> <authority-id> <recorded-at> <output.json> [notes...]');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const review = buildCanonReview({
  policy: readJson(canonPolicyPath),
  masterPolicy: readJson(masterPolicyPath),
  masterCandidate: readJson(masterCandidatePath),
  masterRegister: readJson(masterRegisterPath),
  authorityId,
  decision: 'APPROVE_FOR_CANON_PROMOTION',
  masterLineageApproved: true,
  provenanceCompleteForCanon: true,
  promotionBoundaryUnderstood: true,
  recordedAt,
  notes: notesParts.join(' ') || 'Human Canon Review approval for the exact registered Master Candidate.',
});
writeFileSync(resolve(outputPath), `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify({ created: true, reviewId: review.reviewId, reviewHash: review.reviewHash, eligibleForCanonPromotionCeremony: review.eligibleForCanonPromotionCeremony, canonPromoted: false, publicRelease: false }, null, 2));
