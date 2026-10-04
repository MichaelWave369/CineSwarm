import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestJson } from '../src/authorization-seal.js';
import {
  validateResumableHumanCeremonyPolicy,
  buildResumableHumanCeremonySession,
  validateResumableHumanCeremonySession,
  buildCeremonyTranscript,
  validateCeremonyTranscript,
  buildCeremonyEvent,
  appendCeremonyEvent,
  buildCeremonyResumeState,
  validateCeremonyResumeState,
  buildCeremonyRecoveryPack,
  validateCeremonyRecoveryPack,
  classifyResumableHumanCeremonyState,
  C1_24G_EVENT_ORDER,
} from '../src/index.js';

const root=resolve(import.meta.dirname,'../../..');
const J=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const policy=J('fixtures/cineswarm/pn-0001-c1-24g-resumable-human-ceremony-policy.json');
const kitPolicy=J('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json');
const keyRegistry=J('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
const c24=J('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const admission=J('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const commit=J('fixtures/cineswarm/pn-0001-c1-24f-canonical-admission-commit-register.json');
const challenge=J('proof/c1-24d/synthetic-offline-human-admission/ENROLLMENT_CHALLENGE.json');
const sessionContext={policy,challenge,kitPolicy,currentKeyRegistryHash:digestJson(keyRegistry),currentC24RegisterHash:c24.registerHash,currentAdmissionRegisterHash:admission.registerHash,currentCommitRegisterHash:commit.registerHash,authorityId:'proof-human',keyId:'proof-human-c1-24d-key'};
const session=buildResumableHumanCeremonySession({...sessionContext,startedAt:'2026-08-14T00:00:10Z',sessionId:'proof-c1-24g-session'});
const transcript0=buildCeremonyTranscript({policy,session,sessionContext,events:[],recordedAt:'2026-08-14T00:00:10Z',transcriptId:'proof-c1-24g-transcript'});
function ev(t,transcript,actorKind='machine'){
  const i=transcript.entries.length+1;
  return buildCeremonyEvent({policy,session,sessionContext,transcript,eventType:t,artifactKind:`PROOF_${t}`,artifactHash:digestJson({t,i}),artifactPath:`proof/c1-24g/public/${String(i).padStart(2,'0')}-${t}.json`,validatorId:`validator.c1-24g.${i}`,actorKind,actorId:actorKind==='human'?'proof-human':'cineswarm-c1-24g',observedAt:`2026-08-14T00:${String(i).padStart(2,'0')}:00Z`});
}
function fullTranscript(){let tr=transcript0;for(const t of C1_24G_EVENT_ORDER){const actor=['FINGERPRINT_ACKNOWLEDGED','COMMIT_DIGEST_CONFIRMED'].includes(t)?'human':'machine';tr=appendCeremonyEvent({policy,session,sessionContext,transcript:tr,event:ev(t,tr,actor)});}return tr;}

test('C1.24G policy preserves human authority and public-only evidence',()=>{assert.equal(validateResumableHumanCeremonyPolicy(policy).valid,true);assert.equal(policy.witnessMode,'EVIDENCE_TRANSCRIPT_NOT_INDEPENDENT_HUMAN_WITNESS');assert.equal(policy.orchestratorCanSignAdmission,false);});
test('session binds exact challenge and four canonical baseline hashes',()=>{assert.equal(validateResumableHumanCeremonySession(session,sessionContext).valid,true);assert.equal(session.challengeHash,challenge.challengeHash);assert.equal(session.canonicalBaseline.c24RegisterHash,c24.registerHash);assert.equal(session.containsPrivateKeyMaterial,false);});
test('empty transcript is valid container but cannot produce resume state',()=>{assert.equal(validateCeremonyTranscript(transcript0,{policy,session,sessionContext}).valid,true);assert.throws(()=>buildCeremonyResumeState({policy,session,sessionContext,transcript:transcript0,now:'2026-08-14T00:00:20Z'}),/must contain CHALLENGE_BOUND/);});
test('event state machine rejects out-of-order ceremony progress',()=>{assert.throws(()=>buildCeremonyEvent({policy,session,sessionContext,transcript:transcript0,eventType:'FINGERPRINT_ACKNOWLEDGED',artifactKind:'ACK',artifactHash:'0'.repeat(64),artifactPath:'proof/ack.json',validatorId:'validator.ack',actorKind:'human',actorId:'proof-human',observedAt:'2026-08-14T00:01:00Z'}),/out-of-order/);});
test('human-only events cannot be machine-asserted',()=>{let tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});tr=appendCeremonyEvent({policy,session,sessionContext,transcript:tr,event:ev('ENROLLMENT_RESPONSE_VERIFIED',tr)});assert.throws(()=>buildCeremonyEvent({policy,session,sessionContext,transcript:tr,eventType:'FINGERPRINT_ACKNOWLEDGED',artifactKind:'ACK',artifactHash:'0'.repeat(64),artifactPath:'proof/ack.json',validatorId:'validator.ack',actorKind:'machine',actorId:'cineswarm',observedAt:'2026-08-14T00:03:00Z'}),/requires human actor/);});
test('transcript is append-only hash chained',()=>{let tr=transcript0;const e1=ev('CHALLENGE_BOUND',tr);tr=appendCeremonyEvent({policy,session,sessionContext,transcript:tr,event:e1});const e2=ev('ENROLLMENT_RESPONSE_VERIFIED',tr);tr=appendCeremonyEvent({policy,session,sessionContext,transcript:tr,event:e2});assert.equal(tr.revision,2);assert.equal(tr.entries[1].previousEventHash,tr.entries[0].eventHash);const bad=structuredClone(tr);bad.entries[0].artifactHash='0'.repeat(64);assert.throws(()=>validateCeremonyTranscript(bad,{policy,session,sessionContext}),/self-hash mismatch|hash-chain/);});
test('resume after challenge asks for public enrollment response',()=>{const tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});const r=buildCeremonyResumeState({policy,session,sessionContext,transcript:tr,now:'2026-08-14T00:05:00Z'});assert.equal(validateCeremonyResumeState(r,{policy,session,sessionContext,transcript:tr}).valid,true);assert.equal(r.status,'AWAITING_PUBLIC_ENROLLMENT_RESPONSE');assert.equal(r.humanActionRequired,true);});
test('expired challenge is never silently reused',()=>{const tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});const r=buildCeremonyResumeState({policy,session,sessionContext,transcript:tr,now:'2026-08-16T00:05:00Z'});assert.equal(r.status,'CHALLENGE_EXPIRED_REISSUE_REQUIRED');});
test('full synthetic transcript reaches COMPLETE without granting authority to orchestrator',()=>{const tr=fullTranscript();const r=buildCeremonyResumeState({policy,session,sessionContext,transcript:tr,now:'2026-08-14T00:20:00Z'});assert.equal(r.status,'COMPLETE');assert.equal(r.orchestratorCanAutoApplyCanonicalCommit,false);assert.equal(r.publicRelease,false);});
test('recovery pack rejects private key paths',()=>{const tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});const r=buildCeremonyResumeState({policy,session,sessionContext,transcript:tr,now:'2026-08-14T00:05:00Z'});const rc={policy,session,sessionContext,transcript:tr,resumeState:r,resumeContext:{policy,session,sessionContext,transcript:tr}};assert.throws(()=>buildCeremonyRecoveryPack({...rc,publicArtifacts:[{kind:'BAD',path:'keys/human.private.pem',sha256:'0'.repeat(64)}],createdAt:'2026-08-14T00:06:00Z'}),/private-key material/);});
test('recovery pack binds transcript + canonical baseline and stays public-only',()=>{const tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});const r=buildCeremonyResumeState({policy,session,sessionContext,transcript:tr,now:'2026-08-14T00:05:00Z'});const rc={policy,session,sessionContext,transcript:tr,resumeState:r,resumeContext:{policy,session,sessionContext,transcript:tr}};const pack=buildCeremonyRecoveryPack({...rc,publicArtifacts:[{kind:'CHALLENGE',path:'C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json',sha256:challenge.challengeHash},{kind:'STATUS',path:'CANONICAL_STATUS_C1_24F.json',sha256:digestJson({status:'AWAITING_HUMAN_KEY_CEREMONY'})}],createdAt:'2026-08-14T00:06:00Z'});assert.equal(validateCeremonyRecoveryPack(pack,rc).valid,true);assert.equal(pack.containsPrivateKeyMaterial,false);assert.equal(pack.canApplyCanonicalCommit,false);});
test('recovery pack rejects duplicate artifact paths',()=>{const tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});const r=buildCeremonyResumeState({policy,session,sessionContext,transcript:tr,now:'2026-08-14T00:05:00Z'});const rc={policy,session,sessionContext,transcript:tr,resumeState:r,resumeContext:{policy,session,sessionContext,transcript:tr}};assert.throws(()=>buildCeremonyRecoveryPack({...rc,publicArtifacts:[{kind:'A',path:'a.json',sha256:'0'.repeat(64)},{kind:'B',path:'a.json',sha256:'1'.repeat(64)}],createdAt:'2026-08-14T00:06:00Z'}),/duplicate artifact path/);});
test('classifier preserves every distinct human/machine gate',()=>{assert.equal(classifyResumableHumanCeremonyState({}).status,'AWAITING_PUBLIC_ENROLLMENT_RESPONSE');assert.equal(classifyResumableHumanCeremonyState({enrollmentResponsePresent:true}).status,'AWAITING_FINGERPRINT_ACKNOWLEDGEMENT');assert.equal(classifyResumableHumanCeremonyState({enrollmentResponsePresent:true,fingerprintAcknowledged:true,publicKeyStaged:true,admissionRequestPresent:true,admissionSignaturePresent:true,admissionStagePresent:true,commitDigestConfirmed:true,commitReceiptPresent:true}).status,'COMPLETE');});
test('generic momentum cannot be represented as a human ceremony event',()=>{let tr=appendCeremonyEvent({policy,session,sessionContext,transcript:transcript0,event:ev('CHALLENGE_BOUND',transcript0)});tr=appendCeremonyEvent({policy,session,sessionContext,transcript:tr,event:ev('ENROLLMENT_RESPONSE_VERIFIED',tr)});assert.throws(()=>buildCeremonyEvent({policy,session,sessionContext,transcript:tr,eventType:'FINGERPRINT_ACKNOWLEDGED',artifactKind:'CHAT_MESSAGE',artifactHash:digestJson({text:'yes bro keep moving'}),artifactPath:'conversation/momentum.json',validatorId:'validator.chat',actorKind:'machine',actorId:'assistant',observedAt:'2026-08-14T00:03:00Z'}),/requires human actor/);});
