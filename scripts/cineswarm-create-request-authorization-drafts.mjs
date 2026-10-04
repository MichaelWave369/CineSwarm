#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRequestAuthorizationBatchDraft } from '../packages/cineswarm-bridge/src/execution-authorization.js';

const args = process.argv.slice(2);
if (!args[0] || !args[1]) {
  console.error('Usage: node scripts/cineswarm-create-request-authorization-drafts.mjs <readiness-packet.json> <provider-requests.json> [output.json]');
  process.exit(64);
}
const packet = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
const requests = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
const batch = buildRequestAuthorizationBatchDraft(requests, packet);
const output = `${JSON.stringify(batch, null, 2)}\n`;
if (args[2]) {
  writeFileSync(resolve(args[2]), output, { mode: 0o600 });
  console.log(JSON.stringify({ written: resolve(args[2]), recordCount: batch.records.length, totalMaxSpendUsd: batch.totalMaxSpendUsd }, null, 2));
} else {
  process.stdout.write(output);
}
