#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appendCandidateAssetToRegistry, buildCandidateAssetEntry } from '../packages/cineswarm-bridge/src/candidate-picture-plan.js';

const [registryFile, policyFile, manifestFile, reviewFile, requestFile, sequenceJobsFile, continuityVersion, outputFile] = process.argv.slice(2);
if (![registryFile, policyFile, manifestFile, reviewFile, requestFile, sequenceJobsFile, continuityVersion].every(Boolean)) {
  console.error('Usage: node scripts/cineswarm-register-candidate-asset.mjs <registry.json> <policy.json> <quarantine-manifest.json> <human-review.json> <provider-request.json> <sequence-jobs.json> <continuity-version> [output-registry.json]');
  process.exit(64);
}
const readJson = (file) => JSON.parse(readFileSync(resolve(file), 'utf8'));
const registry = readJson(registryFile);
const policy = readJson(policyFile);
const manifest = readJson(manifestFile);
const reviewDecision = readJson(reviewFile);
const request = readJson(requestFile);
const sequenceJobs = readJson(sequenceJobsFile);
const now = new Date().toISOString();
const entry = buildCandidateAssetEntry({ manifest, reviewDecision, request, sequenceJob: sequenceJobs, policy, continuityVersion, registeredAt: now });
const nextRegistry = appendCandidateAssetToRegistry({ registry, entry, policy, recordedAt: now });
const output = `${JSON.stringify({ entry, registry: nextRegistry }, null, 2)}\n`;
if (outputFile) writeFileSync(resolve(outputFile), `${JSON.stringify(nextRegistry, null, 2)}\n`);
process.stdout.write(output);
