#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyQuarantinedAsset } from '../packages/cineswarm-bridge/src/asset-intake.js';

const [manifestPath, decisionPath] = process.argv.slice(2);
if (!manifestPath) {
  console.error('Usage: node scripts/cineswarm-asset-review-status.mjs <quarantine-manifest.json> [human-review-decision.json]');
  process.exit(64);
}
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const decision = decisionPath ? JSON.parse(readFileSync(resolve(decisionPath), 'utf8')) : null;
console.log(JSON.stringify(classifyQuarantinedAsset({ manifest, decision }), null, 2));
