#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyArchiveRecoveryState } from '../packages/cineswarm-bridge/src/archive-recovery.js';

const here = dirname(fileURLToPath(import.meta.url));
const base = resolve(here, '../fixtures/cineswarm');
const load = (name) => JSON.parse(readFileSync(resolve(base, name), 'utf8'));
const c18Policy = load('pn-0001-c1-18-archive-recovery-policy.json');
const c17Policy = load('pn-0001-c1-17-public-archive-policy.json');
const c17ArchiveRegister = load('pn-0001-c1-17-public-archive-register.json');
const c16Policy = load('pn-0001-c1-16-release-lifecycle-policy.json');
const c16LifecycleRegister = load('pn-0001-c1-16-release-lifecycle-register.json');
const c15Policy = load('pn-0001-c1-15-network-release-policy.json');
const c15PublicReleaseRegister = load('pn-0001-c1-15-public-release-register.json');
const recoveryRegister = load('pn-0001-c1-18-archive-recovery-register.json');
const c17RegisterContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister };
const state = classifyArchiveRecoveryState({ c18Policy, c17Policy, c17ArchiveRegister, c17RegisterContext, recoveryRegister, now: new Date().toISOString() });
console.log(JSON.stringify({ recoveryRegisterHash: recoveryRegister.registerHash, ...state }, null, 2));
