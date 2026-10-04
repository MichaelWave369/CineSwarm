import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildHumanFingerprintAcknowledgement,
  validateHumanFingerprintAcknowledgement,
  buildHumanKeyEnrollmentStage,
  validateHumanKeyEnrollmentStage,
  buildCanonicalAdmissionStageBundle,
  validateCanonicalAdmissionStageBundle,
  classifyHumanCeremonyConsoleState,
  validateHumanCeremonyConsolePolicy,
} from '../src/human-ceremony-console.js';

const root=resolve(import.meta.dirname,'../../..');
const j=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const consolePolicy=j('fixtures/cineswarm/pn-0001-c1-24e-human-ceremony-console-policy.json');
const kitPolicy=j('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json');
const keyCeremonyPolicy=j('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json');
const canonicalKeyRegistry=j('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
const admissionPolicy=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
const c24Policy=j('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
const canonical=j('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const admissionRegister=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const d='proof/c1-24d/synthetic-offline-human-admission';
const challenge=j(`${d}/ENROLLMENT_CHALLENGE.json`);
const response=j(`${d}/ENROLLMENT_RESPONSE.json`);
const review=j(`${d}/HUMAN_ADMISSION_REVIEW.json`);
const plan=j(`${d}/CANONICAL_ADMISSION_PLAN.json`);
const request=j(`${d}/OFFLINE_SIGNING_REQUEST.json`);
const signedResponse=j(`${d}/SIGNED_ADMISSION_RESPONSE.json`);
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
function ack(){return buildHumanFingerprintAcknowledgement({policy:consolePolicy,challenge,response,kitPolicy,acknowledgedFingerprintSha256:response.fingerprintSha256,authorityId:'proof-human',acknowledgedAt:'2026-08-13T23:42:00Z',acknowledgementId:'proof-c1-24e-fingerprint-ack'});}
function keyStage(){const a=ack(); return {a,stage:buildHumanKeyEnrollmentStage({policy:consolePolicy,acknowledgement:a,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry:canonicalKeyRegistry,recordedAt:'2026-08-13T23:42:30Z',stageId:'proof-c1-24e-key-stage'})};}
function admissionStage(){const {a,stage}=keyStage(); const bundle=buildCanonicalAdmissionStageBundle({policy:consolePolicy,request,signedResponse,kitPolicy,admissionPolicy,proofContext,c24CanonicalRegister:canonical,admissionRegister,review,plan,stagedKeyRegistry:stage.stagedKeyRegistry,stagedKeyRegistryHash:stage.stagedKeyRegistryHash,stagedAt:'2026-08-14T00:10:00Z',stageId:'proof-c1-24e-admission-stage'}); return {a,keyStage:stage,bundle};}

test('C1.24E policy is staging-only and has zero automatic human authority',()=>{assert.equal(validateHumanCeremonyConsolePolicy(consolePolicy).valid,true); assert.equal(consolePolicy.stagingOnly,true); assert.equal(consolePolicy.consoleCanAutoApplyCanonicalAdmission,false);});
test('exact full fingerprint re-entry creates a human acknowledgement receipt',()=>{const a=ack(); assert.equal(validateHumanFingerprintAcknowledgement(a,{policy:consolePolicy,challenge,response,kitPolicy}).valid,true); assert.equal(a.publicKeyFingerprintSha256,response.fingerprintSha256); assert.equal(a.exactFingerprintReentered,true);});
test('partial or wrong fingerprint cannot be acknowledged',()=>{assert.throws(()=>buildHumanFingerprintAcknowledgement({policy:consolePolicy,challenge,response,kitPolicy,acknowledgedFingerprintSha256:response.fingerprintSha256.slice(0,16),authorityId:'proof-human',acknowledgedAt:'2026-08-13T23:42:00Z'}),/SHA-256|mismatch/); assert.throws(()=>buildHumanFingerprintAcknowledgement({policy:consolePolicy,challenge,response,kitPolicy,acknowledgedFingerprintSha256:'0'.repeat(64),authorityId:'proof-human',acknowledgedAt:'2026-08-13T23:42:00Z'}),/mismatch/);});
test('acknowledgement tamper with retained hash fails',()=>{const a=ack(); const bad=structuredClone(a); bad.acknowledgedAt='2026-08-13T23:42:01Z'; assert.throws(()=>validateHumanFingerprintAcknowledgement(bad,{policy:consolePolicy,challenge,response,kitPolicy}),/self-hash mismatch/);});
test('public key enrollment is only staged into a cloned registry',()=>{const {a,stage}=keyStage(); assert.equal(validateHumanKeyEnrollmentStage(stage,{policy:consolePolicy,acknowledgement:a,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry:canonicalKeyRegistry}).valid,true); assert.equal(stage.stagedKeyRegistry.keys.length,1); assert.equal(canonicalKeyRegistry.keys.length,0); assert.equal(stage.canonicalKeyRegistryMutated,false);});
test('staged key registry hash tamper fails',()=>{const {a,stage}=keyStage(); const bad=structuredClone(stage); bad.stagedKeyRegistryHash='0'.repeat(64); assert.throws(()=>validateHumanKeyEnrollmentStage(bad,{policy:consolePolicy,acknowledgement:a,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry:canonicalKeyRegistry}),/self-hash mismatch/);});
test('valid signed C1.24D response produces only a proposed canonical admission bundle',()=>{const {bundle}=admissionStage(); assert.equal(bundle.proposedCanonicalFullIndependentSourceRebuildProven,true); assert.equal(bundle.proposedCanonicalRegister.revision,2); assert.equal(bundle.canonicalFilesMutated,false); assert.equal(bundle.canonicalApplyIncluded,false); assert.equal(canonical.revision,0);});
test('canonical admission stage revalidates exact signed target and staged key registry',()=>{const {keyStage,bundle}=admissionStage(); assert.equal(validateCanonicalAdmissionStageBundle(bundle,{policy:consolePolicy,request,signedResponse,kitPolicy,admissionPolicy,proofContext,c24CanonicalRegister:canonical,admissionRegister,review,plan,stagedKeyRegistry:keyStage.stagedKeyRegistry,stagedKeyRegistryHash:keyStage.stagedKeyRegistryHash}).valid,true); assert.equal(bundle.proposedCanonicalRegisterHash,plan.expectedCanonicalRegisterAfterHash);});
test('wrong staged key registry cannot stage the signed admission',()=>{const {keyStage}=admissionStage(); const empty=structuredClone(canonicalKeyRegistry); assert.throws(()=>buildCanonicalAdmissionStageBundle({policy:consolePolicy,request,signedResponse,kitPolicy,admissionPolicy,proofContext,c24CanonicalRegister:canonical,admissionRegister,review,plan,stagedKeyRegistry:empty,stagedKeyRegistryHash:keyStage.stagedKeyRegistryHash,stagedAt:'2026-08-14T00:10:00Z'}),/hash drift/);});
test('stage tamper with retained hash fails',()=>{const {keyStage,bundle}=admissionStage(); const bad=structuredClone(bundle); bad.proposedCanonicalRegister.revision=999; assert.throws(()=>validateCanonicalAdmissionStageBundle(bad,{policy:consolePolicy,request,signedResponse,kitPolicy,admissionPolicy,proofContext,c24CanonicalRegister:canonical,admissionRegister,review,plan,stagedKeyRegistry:keyStage.stagedKeyRegistry,stagedKeyRegistryHash:keyStage.stagedKeyRegistryHash}),/self-hash mismatch/);});
test('real C1.24E state awaits only public human ceremony artifacts and never infers acknowledgement from chat',()=>{const state=classifyHumanCeremonyConsoleState({technicalProofEarned:true}); assert.equal(state.status,'AWAITING_PUBLIC_ENROLLMENT_RESPONSE'); assert.equal(state.humanEnrollmentResponsePresent,false); assert.equal(state.consoleCanAutoAcknowledgeFingerprint,false); assert.equal(state.consoleCanAutoApplyCanonicalAdmission,false);});
test('a fully staged synthetic proof still requires separate human commit',()=>{const {bundle}=admissionStage(); const state=classifyHumanCeremonyConsoleState({technicalProofEarned:true,humanEnrollmentResponsePresent:true,fingerprintAcknowledged:true,publicKeyStaged:true,admissionSigningRequestPresent:true,signedAdmissionResponsePresent:true,canonicalAdmissionStagePresent:true,canonicalFullIndependentSourceRebuildProven:false}); assert.equal(state.status,'CANONICAL_COMMIT_READY_REQUIRES_SEPARATE_HUMAN_ACT'); assert.equal(bundle.requiresSeparateHumanCommit,true); assert.equal(state.canonicalFullIndependentSourceRebuildProven,false);});
