#!/usr/bin/env node
import { classifyResumableHumanCeremonyState } from '../packages/cineswarm-bridge/src/resumable-human-ceremony.js';
import { loadC124GContext } from './lib/c1-24g-context.mjs';
const c=loadC124GContext();const state=classifyResumableHumanCeremonyState({technicalProofEarned:true,challengePresent:true});
console.log(JSON.stringify({phase:'C1.24G',...state,challengeId:c.challenge.challengeId,challengeHash:c.challenge.challengeHash,challengeExpiresAt:c.challenge.expiresAt,canonicalC24RegisterHash:c.c24Register.registerHash,canonicalAdmissionRegisterHash:c.admissionRegister.registerHash,canonicalCommitRegisterHash:c.commitRegister.registerHash,humanPublicKeyEnrolled:c.keyRegistry.keys.length>0,canonicalC24Revision:c.c24Register.revision,canonicalAdmissionRevision:c.admissionRegister.revision,canonicalCommitRevision:c.commitRegister.revision,publicTranscriptIsNotIndependentHumanWitness:true,publicRelease:false,relayDependency:false},null,2));
