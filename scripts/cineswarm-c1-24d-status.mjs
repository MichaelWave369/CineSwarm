#!/usr/bin/env node
import { buildOfflineHumanAdmissionKitManifest, classifyOfflineHumanAdmissionKitState } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124DContext } from './lib/c1-24d-context.mjs';
const c = loadC124DContext();
const state = classifyOfflineHumanAdmissionKitState({ policy: c.kitPolicy, keyCeremonyPolicy: c.keyCeremonyPolicy, keyCeremonyPlan: c.keyCeremonyPlan, admissionPolicy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, admissionRegister: c.admissionRegister, keyRegistry: c.keyRegistry });
const manifest = buildOfflineHumanAdmissionKitManifest({ policy: c.kitPolicy, keyCeremonyPolicy: c.keyCeremonyPolicy, keyCeremonyPlan: c.keyCeremonyPlan, admissionPolicy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, admissionRegister: c.admissionRegister, keyRegistry: c.keyRegistry, generatedAt: new Date().toISOString() });
console.log(JSON.stringify({ ...state, kitManifestHash: manifest.manifestHash, humanNextAction: 'Run cineswarm-c1-24d-create-enrollment-challenge.mjs, then generate the Ed25519 key in a directory OUTSIDE this repository/sidecar.' }, null, 2));
