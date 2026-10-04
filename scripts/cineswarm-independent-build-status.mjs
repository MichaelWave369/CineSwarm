#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyIndependentRebuildState } from '../packages/cineswarm-bridge/src/independent-source-rebuild.js';
const root=resolve(process.argv[2]||'.');
const load=(n)=>JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm',n),'utf8'));
const policy=load('pn-0001-c1-24-independent-build-policy.json');
const status=load('pn-0001-c1-24-build-input-status.json');
const register=load('pn-0001-c1-24-independent-rebuild-register.json');
console.log(JSON.stringify(classifyIndependentRebuildState({policy,register,sourceC23ReproDecodeRegisterHash:policy.sourceC23ReproDecodeRegisterHash,acquisitionStatus:status}),null,2));
