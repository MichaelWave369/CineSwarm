#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyIndependentRebuildAdmissionState } from '../packages/cineswarm-bridge/src/independent-rebuild-admission.js';

const root=resolve(import.meta.dirname,'..');
const j=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const c24Policy=j('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
const policy=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
const canonical=j('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const admissionRegister=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const keyRegistry=j('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
const proofDir='proof/c1-24/real-independent-rebuild';
const proofContext={c24Policy,buildInputArchive:j(`${proofDir}/BUILD_INPUT_ARCHIVE.json`),recipe:j(`${proofDir}/HERMETIC_BUILD_RECIPE.json`),report:j(`${proofDir}/INDEPENDENT_REBUILD_REPORT.json`),rebuildReceipt:j(`${proofDir}/INDEPENDENT_REBUILD_RECEIPT.json`),proofRegister:j(`${proofDir}/PROOF_REGISTER.json`),buildLogSha256:createHash('sha256').update(readFileSync(resolve(root,`${proofDir}/BUILD.log`))).digest('hex')};
console.log(JSON.stringify(classifyIndependentRebuildAdmissionState({policy,proofContext,c24CanonicalRegister:canonical,admissionRegister,keyRegistry}),null,2));
