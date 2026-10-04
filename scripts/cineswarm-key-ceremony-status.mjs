#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyKeyCeremonyReadiness, validateKeyCeremonyPolicy } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';

const [planPath = 'fixtures/cineswarm/pn-0001-c1-7-key-ceremony-plan.json', registryPath = 'fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json', policyPath = 'fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json'] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
const keyRegistry = JSON.parse(readFileSync(resolve(registryPath), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(policyPath), 'utf8'));
validateKeyCeremonyPolicy(policy);
console.log(JSON.stringify(classifyKeyCeremonyReadiness({ plan, keyRegistry }), null, 2));
