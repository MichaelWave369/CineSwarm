#!/usr/bin/env node
import { classifyCanonicalAdmissionCommitState } from '../packages/cineswarm-bridge/src/canonical-admission-commit.js';
import { loadC124FBaseContext, loadCanonicalFiles, c124fRoot } from './lib/c1-24f-context.mjs';
const b=loadC124FBaseContext(); const c=loadCanonicalFiles(c124fRoot);
const out=classifyCanonicalAdmissionCommitState({technicalProofEarned:b.proofContext.rebuildReceipt.fullIndependentSourceRebuildProven===true,humanPublicKeyEnrolled:c.keyRegistry.keys.some(k=>k.status==='active'&&k.authority?.kind==='human'),canonicalCommitted:c.c24Register.fullIndependentSourceRebuildProven===true,postCommitAuditPassed:c.commitRegister.successfulCommitCount>0,commitReceiptRecorded:c.commitRegister.successfulCommitCount>0});
console.log(JSON.stringify({...out,canonicalC24RegisterHash:c.c24Register.registerHash,canonicalAdmissionRegisterHash:c.admissionRegister.registerHash,canonicalCommitRegisterHash:c.commitRegister.registerHash,humanNextAction:'Complete the external C1.24D/E human key + admission signature ceremony. C1.24F will then require exact full commit-intent digest re-entry before any canonical file mutation.'},null,2));
