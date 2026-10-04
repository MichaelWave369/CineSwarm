import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendIndependentRebuildAdmissionReceipt,
  applyIndependentRebuildCanonicalAdmission,
  buildIndependentRebuildAdmissionCeremonyDraft,
  buildIndependentRebuildAdmissionReceipt,
  buildIndependentRebuildAdmissionRegister,
  buildIndependentRebuildAdmissionReview,
  buildIndependentRebuildCanonicalAdmissionPlan,
  classifyIndependentRebuildAdmissionState,
  signIndependentRebuildAdmissionCeremony,
  validateIndependentRebuildAdmissionCeremony,
  validateIndependentRebuildAdmissionPolicy,
  validateIndependentRebuildAdmissionReceipt,
  validateIndependentRebuildAdmissionRegister,
  validateIndependentRebuildAdmissionReview,
  validateIndependentRebuildCanonicalAdmissionPlan,
} from '../src/independent-rebuild-admission.js';

const root=resolve(import.meta.dirname,'../../..');
const j=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const c24Policy=j('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
const admissionPolicy=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
const canonical=j('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const canonicalAdmissionRegister=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const canonicalKeyRegistry=j('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
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

function humanKey(){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const publicKeyPem=publicKey.export({type:'spki',format:'pem'}).toString();
  const privateKeyPem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
  return {privateKeyPem,keyRegistry:{schema:'parallax.cineswarm.signing-key-registry.c1.6.v0.1',keys:[{keyId:'proof-human-admission-key',algorithm:'Ed25519',status:'active',authority:{kind:'human',id:'proof-human'},publicKeyPem,validFrom:'2026-08-13T23:00:00Z',validUntil:null}],status:'PROOF_ONLY'}};
}
function admittedReview(decision='ADMIT_TO_CANONICAL'){
  return buildIndependentRebuildAdmissionReview({policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,reviewId:'proof-c1-24c-review',authority:{kind:'human',id:'proof-human',simulated:false},decision,reason:decision==='ADMIT_TO_CANONICAL'?'Proof-only human accepts exact independent rebuild evidence for canonical transition.':'Proof-only hold.',reviewedAt:'2026-08-13T23:16:00Z',checks:{sourceAuthenticityAccepted:true,buildInputClosureAccepted:true,sourceBuildAccepted:true,authoritativeDecodeAccepted:true,fullOsIsolationLimitationAcknowledged:true,releaseBoundaryAcknowledged:true}});
}
function plan(review=admittedReview()){
  return buildIndependentRebuildCanonicalAdmissionPlan({policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,archiveRecordedAt:'2026-08-13T23:18:00Z',receiptRecordedAt:'2026-08-13T23:19:00Z',planId:'proof-c1-24c-plan'});
}
function signedChain(){
  const review=admittedReview(); const p=plan(review); const {privateKeyPem,keyRegistry}=humanKey();
  const draft=buildIndependentRebuildAdmissionCeremonyDraft({policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p,keyId:'proof-human-admission-key',signedAt:'2026-08-13T23:17:00Z',ceremonyId:'proof-c1-24c-ceremony'});
  const ceremony=signIndependentRebuildAdmissionCeremony({draft,privateKeyPem,keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p});
  const admitted=applyIndependentRebuildCanonicalAdmission({ceremony,keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p});
  const receipt=buildIndependentRebuildAdmissionReceipt({policy:admissionPolicy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore:canonical,review,plan:p,c24CanonicalRegisterAfter:admitted,issuedAt:'2026-08-13T23:19:30Z',receiptId:'proof-c1-24c-admission-receipt'});
  return {review,plan:p,keyRegistry,ceremony,admitted,receipt};
}

test('C1.24C policy binds exact C1.24B proof and canonical-before hash',()=>{
  assert.equal(validateIndependentRebuildAdmissionPolicy(admissionPolicy,{proofContext,c24CanonicalRegister:canonical}).valid,true);
  assert.equal(admissionPolicy.requiredProof.rebuildReceiptHash,proofContext.rebuildReceipt.receiptHash);
  assert.equal(admissionPolicy.sourceCanonicalC24RegisterHash,canonical.registerHash);
});

test('canonical C1.24C state remains pending human admission with no active human key',()=>{
  assert.equal(validateIndependentRebuildAdmissionRegister(canonicalAdmissionRegister,{policy:admissionPolicy}).valid,true);
  const state=classifyIndependentRebuildAdmissionState({policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,admissionRegister:canonicalAdmissionRegister,keyRegistry:canonicalKeyRegistry});
  assert.equal(state.status,'PENDING_HUMAN_ADMISSION');
  assert.equal(state.technicalProofEarned,true);
  assert.equal(state.canonicalFullIndependentSourceRebuildProven,false);
  assert.equal(state.activeHumanSigningKeys,0);
  assert.deepEqual(state.blockers,['NO_ACTIVE_HUMAN_SIGNING_KEY','NO_HUMAN_ADMISSION_RECEIPT','CANONICAL_C1_24_NOT_ADMITTED']);
  assert.equal(state.publicRelease,false);
});

test('real human review is exact-proof-bound and ADMIT requires every acknowledgement',()=>{
  const review=admittedReview();
  assert.equal(validateIndependentRebuildAdmissionReview(review,{policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical}).valid,true);
  assert.equal(review.fullOsIsolationProven,false);
  const bad=structuredClone(review); bad.checks.fullOsIsolationLimitationAcknowledged=false; delete bad.reviewHash; bad.reviewHash='0'.repeat(64);
  assert.throws(()=>validateIndependentRebuildAdmissionReview(bad,{policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical}),/ADMIT review requires every review check/);
});

test('canonical transition plan signs the exact predicted revision-2 C1.24 register',()=>{
  const review=admittedReview(); const p=plan(review);
  assert.equal(validateIndependentRebuildCanonicalAdmissionPlan(p,{policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review}).valid,true);
  assert.equal(p.expectedCanonicalRegisterAfterRevision,2);
  assert.notEqual(p.expectedCanonicalRegisterAfterHash,canonical.registerHash);
});

test('synthetic human signature can admit the exact proof to a cloned canonical register without release authority',()=>{
  const {review,plan:p,keyRegistry,ceremony,admitted,receipt}=signedChain();
  assert.equal(validateIndependentRebuildAdmissionCeremony(ceremony,{keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p}).valid,true);
  assert.equal(admitted.revision,2);
  assert.equal(admitted.fullIndependentSourceRebuildProven,true);
  assert.equal(admitted.publicRelease,false);
  assert.equal(validateIndependentRebuildAdmissionReceipt(receipt,{policy:admissionPolicy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore:canonical,review,plan:p,c24CanonicalRegisterAfter:admitted}).valid,true);
});

test('admission receipt appends to independent C1.24C register but cannot authorize release',()=>{
  const chain=signedChain();
  const reg=appendIndependentRebuildAdmissionReceipt({register:canonicalAdmissionRegister,receipt:chain.receipt,receiptContext:{policy:admissionPolicy,ceremony:chain.ceremony,keyRegistry:chain.keyRegistry,proofContext,c24CanonicalRegisterBefore:canonical,review:chain.review,plan:chain.plan,c24CanonicalRegisterAfter:chain.admitted},policy:admissionPolicy,recordedAt:'2026-08-13T23:20:00Z'});
  assert.equal(reg.revision,1); assert.equal(reg.admissionReceiptCount,1); assert.equal(reg.publicRelease,false); assert.equal(validateIndependentRebuildAdmissionRegister(reg,{policy:admissionPolicy}).valid,true);
});

test('HOLD review cannot produce canonical admission plan or ceremony',()=>{
  const review=admittedReview('HOLD');
  assert.equal(validateIndependentRebuildAdmissionReview(review,{policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical}).valid,true);
  assert.throws(()=>buildIndependentRebuildCanonicalAdmissionPlan({policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,archiveRecordedAt:'2026-08-13T23:18:00Z',receiptRecordedAt:'2026-08-13T23:19:00Z'}),/requires ADMIT_TO_CANONICAL/);
});

test('revoked/retired signing key cannot authorize canonical admission',()=>{
  const review=admittedReview(); const p=plan(review); const {privateKeyPem,keyRegistry}=humanKey(); keyRegistry.keys[0].status='revoked';
  const draft=buildIndependentRebuildAdmissionCeremonyDraft({policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p,keyId:'proof-human-admission-key',signedAt:'2026-08-13T23:17:00Z'});
  assert.throws(()=>signIndependentRebuildAdmissionCeremony({draft,privateKeyPem,keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p}),/not active/);
});

test('signed admission rejects post-signature plan or proof drift',()=>{
  const chain=signedChain();
  const changed=structuredClone(chain.plan); changed.expectedCanonicalRegisterAfterHash='0'.repeat(64); changed.planHash='0'.repeat(64);
  assert.throws(()=>validateIndependentRebuildAdmissionCeremony(chain.ceremony,{keyRegistry:chain.keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review:chain.review,plan:changed}),/plan self-hash mismatch|plan target drift|ceremony lineage drift/);
  const drift=structuredClone(proofContext); drift.buildLogSha256='0'.repeat(64);
  assert.throws(()=>validateIndependentRebuildAdmissionCeremony(chain.ceremony,{keyRegistry:chain.keyRegistry,policy:admissionPolicy,proofContext:drift,c24CanonicalRegister:canonical,review:chain.review,plan:chain.plan}),/build log hash drift|required proof drift/);
});

test('signature tampering is rejected',()=>{
  const chain=signedChain(); const bad=structuredClone(chain.ceremony); bad.signatureBase64=Buffer.from('bad-signature').toString('base64'); delete bad.ceremonyHash; bad.ceremonyHash='0'.repeat(64);
  assert.throws(()=>validateIndependentRebuildAdmissionCeremony(bad,{keyRegistry:chain.keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review:chain.review,plan:chain.plan}),/signature verification failed/);
});

test('canonical-before register drift invalidates the entire admission',()=>{
  const chain=signedChain(); const altered=structuredClone(canonical); altered.recordedAt='2026-08-13T23:00:01Z'; altered.registerHash='0'.repeat(64);
  assert.throws(()=>applyIndependentRebuildCanonicalAdmission({ceremony:chain.ceremony,keyRegistry:chain.keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:altered,review:chain.review,plan:chain.plan}),/register self-hash mismatch|canonical-before register hash drift/);
});

test('duplicate admission receipt is rejected by append-only C1.24C register',()=>{
  const chain=signedChain(); const ctx={policy:admissionPolicy,ceremony:chain.ceremony,keyRegistry:chain.keyRegistry,proofContext,c24CanonicalRegisterBefore:canonical,review:chain.review,plan:chain.plan,c24CanonicalRegisterAfter:chain.admitted};
  const reg=appendIndependentRebuildAdmissionReceipt({register:canonicalAdmissionRegister,receipt:chain.receipt,receiptContext:ctx,policy:admissionPolicy,recordedAt:'2026-08-13T23:20:00Z'});
  assert.throws(()=>appendIndependentRebuildAdmissionReceipt({register:reg,receipt:chain.receipt,receiptContext:ctx,policy:admissionPolicy,recordedAt:'2026-08-13T23:21:00Z'}),/already registered/);
});

test('canonical fixture is never auto-promoted merely because technical proof exists',()=>{
  assert.equal(proofContext.proofRegister.fullIndependentSourceRebuildProven,true);
  assert.equal(canonical.revision,0);
  assert.equal(canonical.fullIndependentSourceRebuildProven,false);
  assert.equal(admissionPolicy.autoAdmitIndependentProof,false);
});

test('packaged C1.24C synthetic operational proof revalidates while real canonical state stays unchanged',()=>{
  const q='proof/c1-24c/synthetic-admission';
  const keyRegistry=j(`${q}/PROOF_PUBLIC_KEY_REGISTRY.json`);
  const review=j(`${q}/ADMISSION_REVIEW.json`);
  const p=j(`${q}/ADMISSION_PLAN.json`);
  const ceremony=j(`${q}/ADMISSION_CEREMONY.json`);
  const admitted=j(`${q}/ADMITTED_C24_REGISTER.json`);
  const receipt=j(`${q}/ADMISSION_RECEIPT.json`);
  const reg=j(`${q}/ADMISSION_REGISTER.json`);
  const summary=j(`${q}/C1_24C_OPERATIONAL_PROOF.json`);
  assert.equal(validateIndependentRebuildAdmissionReview(review,{policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical}).valid,true);
  assert.equal(validateIndependentRebuildCanonicalAdmissionPlan(p,{policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review}).valid,true);
  assert.equal(validateIndependentRebuildAdmissionCeremony(ceremony,{keyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister:canonical,review,plan:p}).valid,true);
  assert.equal(validateIndependentRebuildAdmissionReceipt(receipt,{policy:admissionPolicy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore:canonical,review,plan:p,c24CanonicalRegisterAfter:admitted}).valid,true);
  assert.equal(validateIndependentRebuildAdmissionRegister(reg,{policy:admissionPolicy}).valid,true);
  assert.equal(summary.proofOnly,true); assert.equal(summary.realHumanAdmissionPerformed,false); assert.equal(summary.privateKeyPersisted,false);
  assert.equal(canonical.revision,0); assert.equal(canonical.fullIndependentSourceRebuildProven,false);
});

test('C1.24C proof directory contains no persisted private-key PEM material',()=>{
  const files=['PROOF_PUBLIC_KEY_REGISTRY.json','ADMISSION_REVIEW.json','ADMISSION_PLAN.json','ADMISSION_CEREMONY.json','ADMITTED_C24_REGISTER.json','ADMISSION_RECEIPT.json','ADMISSION_REGISTER.json','C1_24C_OPERATIONAL_PROOF.json'];
  for(const f of files){ const text=readFileSync(resolve(root,'proof/c1-24c/synthetic-admission',f),'utf8'); assert.equal(text.includes('-----BEGIN PRIVATE KEY-----'),false,`${f} must not contain a private key`); }
});
