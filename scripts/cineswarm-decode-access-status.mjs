#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyDecodeAccessState } from '../packages/cineswarm-bridge/src/decode-environment-access.js';
const root = resolve(import.meta.dirname, '..');
const policy = JSON.parse(readFileSync(resolve(root, 'fixtures/cineswarm/pn-0001-c1-22-decode-access-policy.json'), 'utf8'));
const register = JSON.parse(readFileSync(resolve(root, 'fixtures/cineswarm/pn-0001-c1-22-decode-access-register.json'), 'utf8'));
const status = classifyDecodeAccessState({ policy, register, sourceC21FormatMigrationRegisterHash: 'bc9c629c8bd755fdcf747ce51ecfeb6bf39b26ed29ba02e173b4ab70d3d47b1c', now: new Date().toISOString() });
console.log(JSON.stringify({ ...status, registerHash: register.registerHash }, null, 2));
