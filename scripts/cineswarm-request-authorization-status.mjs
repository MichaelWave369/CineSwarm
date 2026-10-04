#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyRequestAuthorizationBatch } from '../packages/cineswarm-bridge/src/execution-authorization.js';

const args = process.argv.slice(2);
if (!args[0] || !args[1] || !args[2]) {
  console.error('Usage: node scripts/cineswarm-request-authorization-status.mjs <readiness-packet.json> <provider-requests.json> <authorization-batch.json> [founder-decision.json]');
  process.exit(64);
}

const packet = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
const requests = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
const authorizationBatch = JSON.parse(readFileSync(resolve(args[2]), 'utf8'));
const founderDecision = args[3] ? JSON.parse(readFileSync(resolve(args[3]), 'utf8')) : null;
const result = classifyRequestAuthorizationBatch({ packet, requests, authorizationBatch, founderDecision });
console.log(JSON.stringify(result, null, 2));
process.exit(result.executionEligible ? 0 : 3);
