#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateCanonicalAdmissionCommitPreview,
  validateCanonicalAdmissionCommitConfirmation,
  validateCanonicalAdmissionTransactionPlan,
  validateCanonicalAdmissionPostCommitAudit,
  validateCanonicalAdmissionCommitReceipt,
  validateCanonicalAdmissionCommitRegister,
} from '../packages/cineswarm-bridge/src/canonical-admission-commit.js';
import { loadC124FBaseContext, loadCanonicalFiles, c124fRoot } from './lib/c1-24f-context.mjs';
const J=(p)=>JSON.parse(readFileSync(resolve(p),'utf8')); const b=loadC124FBaseContext(); const c=loadCanonicalFiles(c124fRoot); const d=resolve(c124fRoot,'proof/c1-24f/synthetic-canonical-commit'); const ceremony=resolve(d,'ceremony'); const F=(n)=>J(resolve(ceremony,n));
const challenge=F('ENROLLMENT_CHALLENGE.json'), response=F('ENROLLMENT_RESPONSE.json'), acknowledgement=F('FINGERPRINT_ACKNOWLEDGEMENT.json'), keyStage=F('KEY_ENROLLMENT_STAGE.json'), review=F('HUMAN_ADMISSION_REVIEW.json'), plan=F('CANONICAL_ADMISSION_PLAN.json'), request=F('OFFLINE_SIGNING_REQUEST.json'), signedResponse=F('SIGNED_ADMISSION_RESPONSE.json'), admissionStage=F('CANONICAL_ADMISSION_STAGE.json');
const keyStageContext={policy:b.consolePolicy,acknowledgement,challenge,response,kitPolicy:b.kitPolicy,keyCeremonyPolicy:b.keyCeremonyPolicy,keyRegistry:c.keyRegistry}; const admissionStageContext={policy:b.consolePolicy,request,signedResponse,kitPolicy:b.kitPolicy,admissionPolicy:b.admissionPolicy,proofContext:b.proofContext,c24CanonicalRegister:c.c24Register,admissionRegister:c.admissionRegister,review,plan,stagedKeyRegistry:keyStage.stagedKeyRegistry,stagedKeyRegistryHash:keyStage.stagedKeyRegistryHash};
const preview=J(resolve(d,'preview/C1_24F_COMMIT_PREVIEW.json')); const previewContext={policy:b.policy,keyStage,admissionStage,keyStageContext,admissionStageContext,currentKeyRegistry:c.keyRegistry,currentC24Register:c.c24Register,currentAdmissionRegister:c.admissionRegister}; validateCanonicalAdmissionCommitPreview(preview,previewContext);
const confirmation=J(resolve(d,'transaction/CONFIRMATION.json')); validateCanonicalAdmissionCommitConfirmation(confirmation,{policy:b.policy,preview,previewContext}); const transaction=J(resolve(d,'transaction/TRANSACTION.json')); const transactionContext={policy:b.policy,preview,previewContext,confirmation}; validateCanonicalAdmissionTransactionPlan(transaction,transactionContext);
const audit=J(resolve(d,'transaction/POST_COMMIT_AUDIT.json')); const auditContext={policy:b.policy,transaction,transactionContext,appliedKeyRegistry:keyStage.stagedKeyRegistry,appliedC24Register:admissionStage.proposedCanonicalRegister,appliedAdmissionRegister:admissionStage.proposedAdmissionRegister}; validateCanonicalAdmissionPostCommitAudit(audit,auditContext);
const receipt=J(resolve(d,'transaction/COMMIT_RECEIPT.json')); validateCanonicalAdmissionCommitReceipt(receipt,{policy:b.policy,transaction,transactionContext,audit,auditContext}); const proofReg=J(resolve(d,'transaction/COMMIT_REGISTER_AFTER.json')); validateCanonicalAdmissionCommitRegister(proofReg,{policy:b.policy}); assert.equal(proofReg.successfulCommitCount,1);
const partial=J(resolve(d,'recovery-partial/RECOVERY_OUTPUT.json')); assert.equal(partial.status,'ROLLED_BACK_RECOVERED'); assert.equal(partial.restored,true); const unknown=J(resolve(d,'recovery-unknown/RECOVERY_OUTPUT.json')); assert.equal(unknown.status,'MANUAL_INTERVENTION_REQUIRED');
const wrapper=J(resolve(c124fRoot,'C1_24F_OPERATIONAL_PROOF.json')); assert.equal(wrapper.previewHash,preview.previewHash); assert.equal(wrapper.transactionHash,transaction.transactionHash); assert.equal(wrapper.postCommitAuditHash,audit.auditHash); assert.equal(wrapper.commitReceiptHash,receipt.receiptHash); assert.equal(wrapper.proofCommitRegisterHash,proofReg.registerHash); assert.equal(wrapper.canonicalApplyPerformedOnRealState,false); assert.equal(wrapper.multiFileAtomicityClaimed,false); assert.equal(wrapper.publicRelease,false); assert.equal(wrapper.relayDependency,false);
assert.equal(c.keyRegistry.keys.length,0); assert.equal(c.c24Register.revision,0); assert.equal(c.c24Register.fullIndependentSourceRebuildProven,false); assert.equal(c.admissionRegister.revision,0); assert.equal(c.commitRegister.revision,0); assert.equal(c.commitRegister.successfulCommitCount,0);
const sha=(p)=>createHash('sha256').update(readFileSync(resolve(p))).digest('hex');
console.log(JSON.stringify({status:'PASS',phase:'C1.24F',proofWrapperSha256:sha(resolve(c124fRoot,'C1_24F_OPERATIONAL_PROOF.json')),previewHash:preview.previewHash,transactionHash:transaction.transactionHash,auditHash:audit.auditHash,receiptHash:receipt.receiptHash,proofCommitRegisterHash:proofReg.registerHash,partialRecovery:partial.status,unknownHashRecovery:unknown.status,realCanonicalRevision:c.c24Register.revision,realCommitRegisterRevision:c.commitRegister.revision,multiFileAtomicityClaimed:false,publicRelease:false,relayDependency:false},null,2));
