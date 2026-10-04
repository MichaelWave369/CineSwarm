#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyPublicArchiveState, validatePublicArchivePolicy, validatePublicArchiveRegister } from '../packages/cineswarm-bridge/src/public-archive-integrity.js';
const root = resolve(import.meta.dirname, '..', 'fixtures', 'cineswarm');
const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const c17Policy = read('pn-0001-c1-17-public-archive-policy.json');
const c16Policy = read('pn-0001-c1-16-release-lifecycle-policy.json');
const c15Policy = read('pn-0001-c1-15-network-release-policy.json');
const c15PublicReleaseRegister = read('pn-0001-c1-15-public-release-register.json');
const c16LifecycleRegister = read('pn-0001-c1-16-release-lifecycle-register.json');
const archiveRegister = read('pn-0001-c1-17-public-archive-register.json');
validatePublicArchivePolicy(c17Policy);
validatePublicArchiveRegister(archiveRegister, { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister });
const state = classifyPublicArchiveState({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister, archiveRegister, now: new Date().toISOString() });
console.log(JSON.stringify({ policyId: c17Policy.policyId, registerHash: archiveRegister.registerHash, revision: archiveRegister.revision, ...state }, null, 2));
