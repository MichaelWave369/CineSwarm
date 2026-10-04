#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPicturePlanCandidate, validatePicturePlanCandidate } from '../packages/cineswarm-bridge/src/candidate-picture-plan.js';

const [policyFile, registryFile, sequenceJobsFile, requestsFile, selectionsFile, outputFile] = process.argv.slice(2);
if (![policyFile, registryFile, sequenceJobsFile, requestsFile, selectionsFile].every(Boolean)) {
  console.error('Usage: node scripts/cineswarm-build-picture-plan.mjs <policy.json> <registry.json> <sequence-jobs.json> <requests.json> <selections.json> [output-plan.json]');
  process.exit(64);
}
const readJson = (file) => JSON.parse(readFileSync(resolve(file), 'utf8'));
const policy = readJson(policyFile);
const registry = readJson(registryFile);
const sequenceJobs = readJson(sequenceJobsFile);
const requests = readJson(requestsFile);
const selections = readJson(selectionsFile);
const plan = buildPicturePlanCandidate({ policy, registry, sequenceJob: sequenceJobs, requests, selections, createdAt: new Date().toISOString() });
validatePicturePlanCandidate(plan, { policy, registry, sequenceJob: sequenceJobs, requests });
if (outputFile) writeFileSync(resolve(outputFile), `${JSON.stringify(plan, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
