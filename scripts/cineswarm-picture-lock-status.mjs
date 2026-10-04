#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyPictureLockRegister, validatePictureLockPolicy, validatePictureLockRegister } from '../packages/cineswarm-bridge/src/picture-lock.js';

const args = process.argv.slice(2);
const policyPath = resolve(args[0] ?? 'fixtures/cineswarm/pn-0001-c1-10-picture-lock-policy.json');
const registerPath = resolve(args[1] ?? 'fixtures/cineswarm/pn-0001-c1-10-picture-lock-register.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const register = JSON.parse(readFileSync(registerPath, 'utf8'));
validatePictureLockPolicy(policy);
validatePictureLockRegister(register, { policy });
console.log(JSON.stringify({ policyId: policy.policyId, ...classifyPictureLockRegister(register), registerHash: register.registerHash }, null, 2));
