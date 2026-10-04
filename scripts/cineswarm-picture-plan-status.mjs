#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyPicturePlan, validatePicturePlanCandidate } from '../packages/cineswarm-bridge/src/candidate-picture-plan.js';

const [planFile, reviewFile] = process.argv.slice(2);
if (!planFile) {
  console.error('Usage: node scripts/cineswarm-picture-plan-status.mjs <picture-plan.json> [human-review.json]');
  process.exit(64);
}
const plan = JSON.parse(readFileSync(resolve(planFile), 'utf8'));
validatePicturePlanCandidate(plan);
const review = reviewFile ? JSON.parse(readFileSync(resolve(reviewFile), 'utf8')) : null;
console.log(JSON.stringify({
  planId: plan.planId,
  planHash: plan.planHash,
  shotCount: plan.shotCount,
  continuityVersion: plan.continuityVersion,
  ...classifyPicturePlan({ plan, review }),
}, null, 2));
