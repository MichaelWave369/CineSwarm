#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyReleaseLifecycle, validateReleaseLifecyclePolicy, validateReleaseLifecycleRegister } from '../packages/cineswarm-bridge/src/release-lifecycle.js';

const read = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const [policyPath = 'fixtures/cineswarm/pn-0001-c1-16-release-lifecycle-policy.json', c15PolicyPath = 'fixtures/cineswarm/pn-0001-c1-15-network-release-policy.json', c15RegisterPath = 'fixtures/cineswarm/pn-0001-c1-15-public-release-register.json', lifecyclePath = 'fixtures/cineswarm/pn-0001-c1-16-release-lifecycle-register.json'] = process.argv.slice(2);
const c16Policy = read(policyPath);
const c15Policy = read(c15PolicyPath);
const c15PublicReleaseRegister = read(c15RegisterPath);
const lifecycleRegister = read(lifecyclePath);
validateReleaseLifecyclePolicy(c16Policy);
validateReleaseLifecycleRegister(lifecycleRegister, { c16Policy, c15Policy, c15PublicReleaseRegister });
console.log(JSON.stringify(classifyReleaseLifecycle({ c16Policy, c15Policy, c15PublicReleaseRegister, lifecycleRegister }), null, 2));
