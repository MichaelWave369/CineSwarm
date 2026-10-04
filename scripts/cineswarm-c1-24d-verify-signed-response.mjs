#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIndependentRebuildAdmissionCeremony } from '../packages/cineswarm-bridge/src/independent-rebuild-admission.js';
import { validateOfflineAdmissionSignedResponse } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124DContext } from './lib/c1-24d-context.mjs';
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const requestPath = arg('request'); const responsePath = arg('response'); const registryPath = arg('key-registry'); const reviewPath = arg('review'); const planPath = arg('plan'); const outPath = resolve(arg('out', './C1_24D_VERIFIED_C1_24C_CEREMONY.json'));
if (![requestPath, responsePath, registryPath, reviewPath, planPath].every(Boolean)) throw new Error('Usage: --request <json> --response <json> --key-registry <json> --review <json> --plan <json> [--out <json>]');
const c = loadC124DContext(); const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8')); const response = JSON.parse(readFileSync(resolve(responsePath), 'utf8')); const keyRegistry = JSON.parse(readFileSync(resolve(registryPath), 'utf8')); const review = JSON.parse(readFileSync(resolve(reviewPath), 'utf8')); const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
const validated = validateOfflineAdmissionSignedResponse(response, { request, policy: c.kitPolicy, admissionPolicy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, review, plan, keyRegistry, now: new Date().toISOString() });
validateIndependentRebuildAdmissionCeremony(validated.ceremony, { keyRegistry, policy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, review, plan });
writeFileSync(outPath, JSON.stringify(validated.ceremony, null, 2) + '\n');
console.log(JSON.stringify({ valid: true, outPath, ceremonyHash: validated.ceremony.ceremonyHash, admissionAuthorizedBySignature: true, canonicalApplied: false, publicRelease: false, relayDependency: false }, null, 2));
