#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyExecutionEnvelope } from '../packages/cineswarm-bridge/src/authorization-seal.js';

const args = process.argv.slice(2);
const envelopePath = args[0];
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const requiredFlag = (name) => {
  const value = flag(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));

if (!envelopePath) {
  console.error('Usage: node scripts/cineswarm-verify-execution-envelope.mjs <envelope.json> --packet packet.json --requests requests.json --auth-batch auth-batch.json --founder founder.json --founder-seal founder-seal.json --auth-seals auth-seals.json --key-registry key-registry.json --revocations revocations.json --now <iso>');
  process.exit(64);
}

const result = verifyExecutionEnvelope({
  envelope: readJson(envelopePath),
  packet: readJson(requiredFlag('--packet')),
  requests: readJson(requiredFlag('--requests')),
  authorizationBatch: readJson(requiredFlag('--auth-batch')),
  founderDecision: readJson(requiredFlag('--founder')),
  founderSeal: readJson(requiredFlag('--founder-seal')),
  authorizationSeals: readJson(requiredFlag('--auth-seals')),
  keyRegistry: readJson(requiredFlag('--key-registry')),
  revocationRegistry: readJson(requiredFlag('--revocations')),
  now: requiredFlag('--now'),
});
console.log(JSON.stringify(result, null, 2));
