import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateCanonicalAdmissionCommitPolicy,
  buildCanonicalAdmissionCommitPreview,
  validateCanonicalAdmissionCommitPreview,
  buildCanonicalAdmissionCommitConfirmation,
  validateCanonicalAdmissionCommitConfirmation,
  buildCanonicalAdmissionTransactionPlan,
  validateCanonicalAdmissionTransactionPlan,
  buildCanonicalAdmissionPostCommitAudit,
  validateCanonicalAdmissionPostCommitAudit,
  buildCanonicalAdmissionCommitReceipt,
  validateCanonicalAdmissionCommitReceipt,
  buildCanonicalAdmissionCommitRegister,
  validateCanonicalAdmissionCommitRegister,
  appendCanonicalAdmissionCommitReceipt,
  classifyCanonicalAdmissionCommitState,
} from '../src/canonical-admission-commit.js';

const root=resolve(import.meta.dirname,'../../..');
const j=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const policy=j('fixtures/cineswarm/pn-0001-c1-24f-canonical-admission-commit-policy.json');
const commitRegister=j('fixtures/cineswarm/pn-0001-c1-24f-canonical-admission-commit-register.json');
const consolePolicy=j('fixtures/cineswarm/pn-0001-c1-24e-human-ceremony-console-policy.json');
const kitPolicy=j('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json');
const keyCeremonyPolicy=j('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json');
const canonicalKeyRegistry=j('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
const admissionPolicy=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
const c24Policy=j('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
const canonical=j('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const admissionRegister=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const d='proof/c1-24d/synthetic-offline-human-admission';
const e='proof/c1-24e/synthetic-human-ceremony-console';
const challenge=j(`${d}/ENROLLMENT_CHALLENGE.json`);
const response=j(`${d}/ENROLLMENT_RESPONSE.json`);
const review=j(`${d}/HUMAN_ADMISSION_REVIEW.json`);
const plan=j(`${d}/CANONICAL_ADMISSION_PLAN.json`);
const request=j(`${d}/OFFLINE_SIGNING_REQUEST.json`);
const signedResponse=j(`${d}/SIGNED_ADMISSION_RESPONSE.json`);
const acknowledgement=j(`${e}/FINGERPRINT_ACKNOWLEDGEMENT.json`);
const keyStage=j(`${e}/KEY_ENROLLMENT_STAGE.json`);
const admissionStage=j(`${e}/CANONICAL_ADMISSION_STAGE.json`);
const proofDir='proof/c1-24/real-independent-rebuild';
const proofContext={
  c24Policy,
  buildInputArchive:j(`${proofDir}/BUILD_INPUT_ARCHIVE.json`),
  recipe:j(`${proofDir}/HERMETIC_BUILD_RECIPE.json`),
  report:j(`${proofDir}/INDEPENDENT_REBUILD_REPORT.json`),
  rebuildReceipt:j(`${proofDir}/INDEPENDENT_REBUILD_RECEIPT.json`),
  proofRegister:j(`${proofDir}/PROOF_REGISTER.json`),
  buildLogSha256:createHash('sha256').update(readFileSync(resolve(root,`${proofDir}/BUILD.log`))).digest('hex'),
};
const keyStageContext={policy:consolePolicy,acknowledgement,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry:canonicalKeyRegistry};
const admissionStageContext={policy:consolePolicy,request,signedResponse,kitPolicy,admissionPolicy,proofContext,c24CanonicalRegister:canonical,admissionRegister,review,plan,stagedKeyRegistry:keyStage.stagedKeyRegistry,stagedKeyRegistryHash:keyStage.stagedKeyRegistryHash};
function preview(){return buildCanonicalAdmissionCommitPreview({policy,keyStage,admissionStage,keyStageContext,admissionStageContext,currentKeyRegistry:canonicalKeyRegistry,currentC24Register:canonical,currentAdmissionRegister:admissionRegister,preparedAt:'2026-08-14T00:35:00Z',previewId:'proof-c1-24f-preview'});}
function previewContext(){return {policy,keyStage,admissionStage,keyStageContext,admissionStageContext,currentKeyRegistry:canonicalKeyRegistry,currentC24Register:canonical,currentAdmissionRegister:admissionRegister};}
function confirmation(){const p=preview();return {p,c:buildCanonicalAdmissionCommitConfirmation({policy,preview:p,previewContext:previewContext(),enteredCommitIntentDigest:p.commitIntentDigest,authorityId:'proof-human',confirmedAt:'2026-08-14T00:36:00Z',confirmationId:'proof-c1-24f-confirmation'})};}
function tx(){const {p,c}=confirmation();return {p,c,t:buildCanonicalAdmissionTransactionPlan({policy,preview:p,previewContext:previewContext(),confirmation:c,preparedAt:'2026-08-14T00:36:30Z',transactionId:'proof-c1-24f-transaction'})};}
function txContext(p,c){return {policy,preview:p,previewContext:previewContext(),confirmation:c};}
function audit(){const {p,c,t}=tx();const tc=txContext(p,c);const a=buildCanonicalAdmissionPostCommitAudit({policy,transaction:t,transactionContext:tc,appliedKeyRegistry:keyStage.stagedKeyRegistry,appliedC24Register:admissionStage.proposedCanonicalRegister,appliedAdmissionRegister:admissionStage.proposedAdmissionRegister,auditedAt:'2026-08-14T00:37:30Z',auditId:'proof-c1-24f-audit'});return {p,c,t,tc,a};}
function receipt(){const x=audit();const ac={policy,transaction:x.t,transactionContext:x.tc,appliedKeyRegistry:keyStage.stagedKeyRegistry,appliedC24Register:admissionStage.proposedCanonicalRegister,appliedAdmissionRegister:admissionStage.proposedAdmissionRegister}; const r=buildCanonicalAdmissionCommitReceipt({policy,transaction:x.t,transactionContext:x.tc,audit:x.a,auditContext:ac,committedAt:'2026-08-14T00:38:00Z',receiptId:'proof-c1-24f-receipt'}); return {...x,ac,r};}

test('C1.24F policy requires journaled recoverability and forbids multi-file atomicity claim',()=>{assert.equal(validateCanonicalAdmissionCommitPolicy(policy).valid,true);assert.equal(policy.requireJournaledTwoPhaseCommit,true);assert.equal(policy.claimMultiFileAtomicity,false);});
test('commit preview binds exact staged and current canonical hashes',()=>{const p=preview();assert.equal(validateCanonicalAdmissionCommitPreview(p,previewContext()).valid,true);assert.equal(p.before.c24RegisterHash,canonical.registerHash);assert.equal(p.after.c24RegisterHash,admissionStage.proposedCanonicalRegisterHash);assert.equal(p.after.keyRegistryHash,keyStage.stagedKeyRegistryHash);});
test('commit preview rejects canonical C1.24 drift',()=>{const bad=structuredClone(canonical);bad.registerHash='0'.repeat(64);assert.throws(()=>buildCanonicalAdmissionCommitPreview({...previewContext(),currentC24Register:bad,preparedAt:'2026-08-14T00:35:00Z'}),/drift/);});
test('human commit confirmation requires full exact commit digest',()=>{const {p,c}=confirmation();assert.equal(validateCanonicalAdmissionCommitConfirmation(c,{policy,preview:p,previewContext:previewContext()}).valid,true);assert.equal(c.exactFullDigestReentered,true);});
test('partial or wrong commit digest cannot confirm canonical mutation',()=>{const p=preview();assert.throws(()=>buildCanonicalAdmissionCommitConfirmation({policy,preview:p,previewContext:previewContext(),enteredCommitIntentDigest:p.commitIntentDigest.slice(0,16),authorityId:'proof-human',confirmedAt:'2026-08-14T00:36:00Z'}),/SHA-256|mismatch/);assert.throws(()=>buildCanonicalAdmissionCommitConfirmation({policy,preview:p,previewContext:previewContext(),enteredCommitIntentDigest:'0'.repeat(64),authorityId:'proof-human',confirmedAt:'2026-08-14T00:36:00Z'}),/mismatch/);});
test('transaction contains three ordered recoverable canonical operations',()=>{const {p,c,t}=tx();assert.equal(validateCanonicalAdmissionTransactionPlan(t,txContext(p,c)).valid,true);assert.equal(t.operations.length,3);assert.deepEqual(t.operations.map(o=>o.order),[1,2,3]);assert.ok(t.operations.every(o=>o.backupRequired));assert.equal(t.multiFileAtomicityClaimed,false);});
test('transaction tamper with retained hash fails',()=>{const {p,c,t}=tx();const bad=structuredClone(t);bad.operations[1].afterHash='0'.repeat(64);assert.throws(()=>validateCanonicalAdmissionTransactionPlan(bad,txContext(p,c)),/self-hash mismatch/);});
test('post-commit audit passes only exact three-file target',()=>{const {t,tc,a}=audit();assert.equal(validateCanonicalAdmissionPostCommitAudit(a,{policy,transaction:t,transactionContext:tc,appliedKeyRegistry:keyStage.stagedKeyRegistry,appliedC24Register:admissionStage.proposedCanonicalRegister,appliedAdmissionRegister:admissionStage.proposedAdmissionRegister}).valid,true);assert.equal(a.result,'PASS');assert.equal(a.exactAll,true);});
test('post-commit audit rejects a mismatched canonical file',()=>{const {p,c,t}=tx();const tc=txContext(p,c);const bad=structuredClone(admissionStage.proposedCanonicalRegister);bad.registerHash='0'.repeat(64);assert.throws(()=>buildCanonicalAdmissionPostCommitAudit({policy,transaction:t,transactionContext:tc,appliedKeyRegistry:keyStage.stagedKeyRegistry,appliedC24Register:bad,appliedAdmissionRegister:admissionStage.proposedAdmissionRegister,auditedAt:'2026-08-14T00:37:30Z'}),/hash mismatch/);});
test('post-commit audit requires the admitted human public key active',()=>{const {p,c,t}=tx();const tc=txContext(p,c);assert.throws(()=>buildCanonicalAdmissionPostCommitAudit({policy,transaction:t,transactionContext:tc,appliedKeyRegistry:canonicalKeyRegistry,appliedC24Register:admissionStage.proposedCanonicalRegister,appliedAdmissionRegister:admissionStage.proposedAdmissionRegister,auditedAt:'2026-08-14T00:37:30Z'}),/hash mismatch|active admitted human public key/);});
test('successful audited commit creates immutable receipt',()=>{const {t,tc,a,ac,r}=receipt();assert.equal(validateCanonicalAdmissionCommitReceipt(r,{policy,transaction:t,transactionContext:tc,audit:a,auditContext:ac}).valid,true);assert.equal(r.commitSuccessful,true);assert.equal(r.canonicalFullIndependentSourceRebuildProven,true);});
test('commit register is append-only and records the audited receipt',()=>{const {t,tc,a,ac,r}=receipt();const rc={policy,transaction:t,transactionContext:tc,audit:a,auditContext:ac};const next=appendCanonicalAdmissionCommitReceipt({register:commitRegister,receipt:r,receiptContext:rc,policy,recordedAt:'2026-08-14T00:38:30Z'});assert.equal(validateCanonicalAdmissionCommitRegister(next,{policy}).valid,true);assert.equal(next.revision,1);assert.equal(next.successfulCommitCount,1);});
test('duplicate commit receipt is rejected',()=>{const {t,tc,a,ac,r}=receipt();const rc={policy,transaction:t,transactionContext:tc,audit:a,auditContext:ac};const next=appendCanonicalAdmissionCommitReceipt({register:commitRegister,receipt:r,receiptContext:rc,policy,recordedAt:'2026-08-14T00:38:30Z'});assert.throws(()=>appendCanonicalAdmissionCommitReceipt({register:next,receipt:r,receiptContext:rc,policy,recordedAt:'2026-08-14T00:39:00Z'}),/already registered/);});
test('real C1.24F state remains before human ceremony and cannot auto-apply',()=>{const s=classifyCanonicalAdmissionCommitState({technicalProofEarned:true});assert.equal(s.status,'AWAITING_HUMAN_KEY_CEREMONY');assert.equal(s.commitCanAutoApply,false);assert.equal(s.multiFileAtomicityClaimed,false);assert.equal(s.publicRelease,false);});
