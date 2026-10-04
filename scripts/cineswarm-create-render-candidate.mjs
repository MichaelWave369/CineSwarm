#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRenderCandidate, validateRenderCandidate } from '../packages/cineswarm-bridge/src/locked-render-audio.js';

const args = process.argv.slice(2);
if (args.length < 3 || args.length > 4) {
  console.error('Usage: node scripts/cineswarm-create-render-candidate.mjs <policy.json> <render-contract.json> <qc-report.json> [candidate-output.json]');
  process.exit(64);
}
const [policyPath, contractPath, qcPath, outputPath] = args;
const load = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = load(policyPath);
const contract = load(contractPath);
const qcReport = load(qcPath);
const candidate = buildRenderCandidate({ policy, contract, qcReport, createdAt: new Date().toISOString() });
validateRenderCandidate(candidate, { policy, contract, qcReport });
if (outputPath) writeFileSync(resolve(outputPath), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(JSON.stringify(candidate, null, 2));
