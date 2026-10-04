#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyHumanKeyCeremony, validateHumanKeyCeremony } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';

const [ceremonyPath, registryPath = 'fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json', policyPath = 'fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json'] = process.argv.slice(2);
if (!ceremonyPath) {
  console.error('Usage: node scripts/cineswarm-verify-key-ceremony.mjs <ceremony.json> [key-registry.json] [policy.json]');
  process.exit(64);
}
const ceremony = JSON.parse(readFileSync(resolve(ceremonyPath), 'utf8'));
const keyRegistry = JSON.parse(readFileSync(resolve(registryPath), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(policyPath), 'utf8'));
const validation = validateHumanKeyCeremony(ceremony, { keyRegistry, policy, now: ceremony.recordedAt });
const nextRegistry = applyHumanKeyCeremony(ceremony, { keyRegistry, policy, now: ceremony.recordedAt });
console.log(JSON.stringify({ validation, nextRegistry }, null, 2));
