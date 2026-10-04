import { digestJson } from './authorization-seal.js';
import { validateHumanKeyEnrollmentChallenge } from './offline-human-admission-kit.js';

export const CINESWARM_C1_24G_POLICY_SCHEMA='parallax.cineswarm.resumable-human-ceremony-policy.c1.24g.v0.1';
export const CINESWARM_C1_24G_SESSION_SCHEMA='parallax.cineswarm.resumable-human-ceremony-session.c1.24g.v0.1';
export const CINESWARM_C1_24G_EVENT_SCHEMA='parallax.cineswarm.resumable-human-ceremony-event.c1.24g.v0.1';
export const CINESWARM_C1_24G_TRANSCRIPT_SCHEMA='parallax.cineswarm.resumable-human-ceremony-transcript.c1.24g.v0.1';
export const CINESWARM_C1_24G_RESUME_SCHEMA='parallax.cineswarm.resumable-human-ceremony-resume-state.c1.24g.v0.1';
export const CINESWARM_C1_24G_RECOVERY_PACK_SCHEMA='parallax.cineswarm.resumable-human-ceremony-recovery-pack.c1.24g.v0.1';

export const C1_24G_EVENT_ORDER=Object.freeze([
  'CHALLENGE_BOUND',
  'ENROLLMENT_RESPONSE_VERIFIED',
  'FINGERPRINT_ACKNOWLEDGED',
  'PUBLIC_KEY_STAGE_VERIFIED',
  'ADMISSION_SIGNING_REQUEST_ISSUED',
  'ADMISSION_SIGNATURE_VERIFIED',
  'CANONICAL_ADMISSION_STAGE_VERIFIED',
  'COMMIT_DIGEST_CONFIRMED',
  'CANONICAL_COMMIT_RECEIPT_VERIFIED',
]);

const NEXT_STATUS=Object.freeze({
  CHALLENGE_BOUND:'AWAITING_PUBLIC_ENROLLMENT_RESPONSE',
  ENROLLMENT_RESPONSE_VERIFIED:'AWAITING_FINGERPRINT_ACKNOWLEDGEMENT',
  FINGERPRINT_ACKNOWLEDGED:'AWAITING_PUBLIC_KEY_STAGE',
  PUBLIC_KEY_STAGE_VERIFIED:'AWAITING_ADMISSION_SIGNING_REQUEST',
  ADMISSION_SIGNING_REQUEST_ISSUED:'AWAITING_OFFLINE_ADMISSION_SIGNATURE',
  ADMISSION_SIGNATURE_VERIFIED:'AWAITING_CANONICAL_ADMISSION_STAGE',
  CANONICAL_ADMISSION_STAGE_VERIFIED:'AWAITING_COMMIT_DIGEST_CONFIRMATION',
  COMMIT_DIGEST_CONFIRMED:'AWAITING_C1_24F_CANONICAL_COMMIT_RECEIPT',
  CANONICAL_COMMIT_RECEIPT_VERIFIED:'COMPLETE',
});
const NEXT_ACTION=Object.freeze({
  AWAITING_PUBLIC_ENROLLMENT_RESPONSE:'Generate the external Ed25519 key outside CineSwarm and return only the public enrollment-response JSON.',
  AWAITING_FINGERPRINT_ACKNOWLEDGEMENT:'Re-enter the full 64-hex public-key SHA-256 fingerprint in the human ceremony console.',
  AWAITING_PUBLIC_KEY_STAGE:'Stage the verified public key in a cloned signing-key registry; do not mutate the canonical registry.',
  AWAITING_ADMISSION_SIGNING_REQUEST:'Create the short-lived C1.24C offline admission signing request from the exact staged public evidence.',
  AWAITING_OFFLINE_ADMISSION_SIGNATURE:'Sign the C1.24C request offline with the human private key; return only the signed response.',
  AWAITING_CANONICAL_ADMISSION_STAGE:'Verify the returned signature and stage the proposed C1.24 / C1.24C canonical transition.',
  AWAITING_COMMIT_DIGEST_CONFIRMATION:'Re-enter the full C1.24F commit-intent digest locally.',
  AWAITING_C1_24F_CANONICAL_COMMIT_RECEIPT:'Run the C1.24F journaled commit/apply flow and verify its post-commit audit receipt.',
  COMPLETE:'Ceremony complete. Preserve the public transcript and recovery pack with the canonical admission evidence.',
  CHALLENGE_EXPIRED_REISSUE_REQUIRED:'Issue a new public enrollment challenge bound to the unchanged canonical C1.24 register; do not reuse the expired challenge.',
});

function req(v,l){if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`);return v.trim();}
function tok(v,l){const s=req(v,l);if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`);return s;}
function sha(v,l){const s=req(v,l);if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`);return s;}
function tm(v,l){const s=req(v,l);const t=Date.parse(s);if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`);return {s,t};}
function yes(v,l){if(v!==true) throw new Error(`${l} must remain true`);}
function no(v,l){if(v!==false) throw new Error(`${l} must remain false`);}
function strip(v,fields){const x=structuredClone(v);for(const f of fields) delete x[f];return x;}
function self(v,field,label){sha(v?.[field],`${label}.${field}`);if(digestJson(strip(v,[field]))!==v[field]) throw new Error(`${label} self-hash mismatch`);}
function boundary(v,label){
  no(v.orchestratorCanGeneratePrivateKey,`${label}.orchestratorCanGeneratePrivateKey`);
  no(v.orchestratorCanInferHumanAcknowledgement,`${label}.orchestratorCanInferHumanAcknowledgement`);
  no(v.orchestratorCanSignAdmission,`${label}.orchestratorCanSignAdmission`);
  no(v.orchestratorCanConfirmCommit,`${label}.orchestratorCanConfirmCommit`);
  no(v.orchestratorCanAutoApplyCanonicalCommit,`${label}.orchestratorCanAutoApplyCanonicalCommit`);
  no(v.orchestratorCanAuthorizeRelease,`${label}.orchestratorCanAuthorizeRelease`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}
function assertPublicArtifactPath(p,label='artifactPath'){
  const s=req(p,label);
  if(/(^|[\\/])[^\\/]*\.private\.pem$/i.test(s)||/(^|[\\/])private[-_]?key/i.test(s)) throw new Error(`${label} may not reference private-key material`);
  if(s.includes('..')) throw new Error(`${label} may not contain traversal`);
  return s;
}

export function validateResumableHumanCeremonyPolicy(policy){
  if(!policy||policy.schema!==CINESWARM_C1_24G_POLICY_SCHEMA) throw new Error('invalid C1.24G policy schema');
  tok(policy.policyId,'policyId');tok(policy.sourceC24FPolicyId,'sourceC24FPolicyId');
  for(const k of ['requirePublicArtifactsOnly','requireHashChainedTranscript','requireEvidenceBasedResume','requireHumanGateSeparation','requirePrivateKeyExclusion','requireRecoveryPack','requireCanonicalHashBinding']) yes(policy[k],k);
  if(policy.witnessMode!=='EVIDENCE_TRANSCRIPT_NOT_INDEPENDENT_HUMAN_WITNESS') throw new Error('C1.24G witness-mode drift');
  for(const k of ['orchestratorCanGeneratePrivateKey','orchestratorCanInferHumanAcknowledgement','orchestratorCanSignAdmission','orchestratorCanConfirmCommit','orchestratorCanAutoApplyCanonicalCommit','orchestratorCanAuthorizeRelease','publicRelease','relayDependency']) no(policy[k],k);
  return {valid:true};
}

export function buildResumableHumanCeremonySession({policy,challenge,kitPolicy,currentKeyRegistryHash,currentC24RegisterHash,currentAdmissionRegisterHash,currentCommitRegisterHash,authorityId,keyId,startedAt,sessionId='pn0001-c1-24g-human-ceremony-session'}){
  validateResumableHumanCeremonyPolicy(policy);validateHumanKeyEnrollmentChallenge(challenge,{policy:kitPolicy,now:startedAt});
  tm(startedAt,'startedAt');tok(sessionId,'sessionId');tok(authorityId,'authorityId');tok(keyId,'keyId');
  if(challenge.authority?.id!==authorityId||challenge.keyId!==keyId) throw new Error('C1.24G challenge authority/key mismatch');
  const out={
    schema:CINESWARM_C1_24G_SESSION_SCHEMA,sessionId,policyId:policy.policyId,startedAt,
    challengeId:challenge.challengeId,challengeHash:challenge.challengeHash,challengeExpiresAt:challenge.expiresAt,
    authority:{kind:'human',id:authorityId},keyId,
    canonicalBaseline:{
      keyRegistryHash:sha(currentKeyRegistryHash,'currentKeyRegistryHash'),
      c24RegisterHash:sha(currentC24RegisterHash,'currentC24RegisterHash'),
      admissionRegisterHash:sha(currentAdmissionRegisterHash,'currentAdmissionRegisterHash'),
      commitRegisterHash:sha(currentCommitRegisterHash,'currentCommitRegisterHash'),
    },
    witnessMode:policy.witnessMode,publicArtifactsOnly:true,containsPrivateKeyMaterial:false,
    orchestratorCanGeneratePrivateKey:false,orchestratorCanInferHumanAcknowledgement:false,orchestratorCanSignAdmission:false,orchestratorCanConfirmCommit:false,orchestratorCanAutoApplyCanonicalCommit:false,orchestratorCanAuthorizeRelease:false,publicRelease:false,relayDependency:false,
  };
  out.sessionHash=digestJson(out);return out;
}
export function validateResumableHumanCeremonySession(v,ctx){
  if(v?.schema!==CINESWARM_C1_24G_SESSION_SCHEMA) throw new Error('invalid C1.24G session schema');
  const rebuilt=buildResumableHumanCeremonySession({...ctx,startedAt:v.startedAt,sessionId:v.sessionId});
  if(rebuilt.sessionHash!==v.sessionHash) throw new Error('C1.24G session self-hash mismatch');self(v,'sessionHash','C1.24G session');boundary(v,'session');no(v.containsPrivateKeyMaterial,'session.containsPrivateKeyMaterial');return {valid:true};
}

export function buildCeremonyTranscript({policy,session,sessionContext,events=[],recordedAt,transcriptId='pn0001-c1-24g-human-ceremony-transcript'}){
  validateResumableHumanCeremonySession(session,sessionContext);tm(recordedAt,'recordedAt');tok(transcriptId,'transcriptId');
  if(!Array.isArray(events)) throw new Error('C1.24G transcript events must be an array');
  let prev=null;
  events.forEach((e,i)=>{
    validateCeremonyEvent(e,{policy,session,sessionContext,previousEventHash:prev,expectedIndex:i+1});
    prev=e.eventHash;
  });
  const out={schema:CINESWARM_C1_24G_TRANSCRIPT_SCHEMA,transcriptId,policyId:policy.policyId,sessionHash:session.sessionHash,revision:events.length,entries:structuredClone(events),headHash:prev,recordedAt,witnessMode:policy.witnessMode,publicArtifactsOnly:true,containsPrivateKeyMaterial:false,orchestratorCanGeneratePrivateKey:false,orchestratorCanInferHumanAcknowledgement:false,orchestratorCanSignAdmission:false,orchestratorCanConfirmCommit:false,orchestratorCanAutoApplyCanonicalCommit:false,orchestratorCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.transcriptHash=digestJson(out);return out;
}
export function validateCeremonyTranscript(v,ctx){
  if(v?.schema!==CINESWARM_C1_24G_TRANSCRIPT_SCHEMA) throw new Error('invalid C1.24G transcript schema');
  const rebuilt=buildCeremonyTranscript({...ctx,events:v.entries,recordedAt:v.recordedAt,transcriptId:v.transcriptId});
  if(rebuilt.transcriptHash!==v.transcriptHash) throw new Error('C1.24G transcript self-hash mismatch');self(v,'transcriptHash','C1.24G transcript');boundary(v,'transcript');return {valid:true};
}

export function buildCeremonyEvent({policy,session,sessionContext,transcript,eventType,artifactKind,artifactHash,artifactPath,validatorId,actorKind='machine',actorId,observedAt}){
  validateResumableHumanCeremonyPolicy(policy);validateResumableHumanCeremonySession(session,sessionContext);validateCeremonyTranscript(transcript,{policy,session,sessionContext});
  const expected=C1_24G_EVENT_ORDER[transcript.entries.length];
  if(!expected) throw new Error('C1.24G ceremony already complete');
  if(eventType!==expected) throw new Error(`C1.24G out-of-order event: expected ${expected}`);
  tok(artifactKind,'artifactKind');sha(artifactHash,'artifactHash');assertPublicArtifactPath(artifactPath);tok(validatorId,'validatorId');
  if(!['machine','human'].includes(actorKind)) throw new Error('actorKind must be machine or human');tok(actorId,'actorId');tm(observedAt,'observedAt');
  const humanEvents=new Set(['FINGERPRINT_ACKNOWLEDGED','COMMIT_DIGEST_CONFIRMED']);
  if(humanEvents.has(eventType)&&actorKind!=='human') throw new Error(`${eventType} requires human actor`);
  if(!humanEvents.has(eventType)&&actorKind!=='machine') throw new Error(`${eventType} must be recorded by machine validation`);
  const out={schema:CINESWARM_C1_24G_EVENT_SCHEMA,eventId:`${session.sessionId}:event:${transcript.entries.length+1}`,policyId:policy.policyId,sessionHash:session.sessionHash,index:transcript.entries.length+1,eventType,artifactKind,artifactHash,artifactPath,artifactVisibility:'PUBLIC',validatorId,validationResult:'PASS',actor:{kind:actorKind,id:actorId},observedAt,previousEventHash:transcript.headHash,containsPrivateKeyMaterial:false,orchestratorCanGeneratePrivateKey:false,orchestratorCanInferHumanAcknowledgement:false,orchestratorCanSignAdmission:false,orchestratorCanConfirmCommit:false,orchestratorCanAutoApplyCanonicalCommit:false,orchestratorCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.eventHash=digestJson(out);return out;
}
export function validateCeremonyEvent(v,{policy,session,sessionContext,previousEventHash=null,expectedIndex}){
  if(v?.schema!==CINESWARM_C1_24G_EVENT_SCHEMA) throw new Error('invalid C1.24G ceremony event schema');
  if(v.sessionHash!==session.sessionHash) throw new Error('C1.24G event session drift');
  if(v.index!==expectedIndex) throw new Error('C1.24G event index drift');
  if(v.previousEventHash!==previousEventHash) throw new Error('C1.24G event hash-chain drift');
  const expectedType=C1_24G_EVENT_ORDER[expectedIndex-1];if(v.eventType!==expectedType) throw new Error('C1.24G event order drift');
  assertPublicArtifactPath(v.artifactPath);sha(v.artifactHash,'artifactHash');tok(v.validatorId,'validatorId');
  const humanEvents=new Set(['FINGERPRINT_ACKNOWLEDGED','COMMIT_DIGEST_CONFIRMED']);
  if(humanEvents.has(v.eventType)&&v.actor?.kind!=='human') throw new Error(`${v.eventType} requires human actor`);
  if(!humanEvents.has(v.eventType)&&v.actor?.kind!=='machine') throw new Error(`${v.eventType} requires machine recorder`);
  self(v,'eventHash','C1.24G ceremony event');boundary(v,'event');return {valid:true};
}
export function appendCeremonyEvent({policy,session,sessionContext,transcript,event}){
  validateCeremonyTranscript(transcript,{policy,session,sessionContext});
  validateCeremonyEvent(event,{policy,session,sessionContext,previousEventHash:transcript.headHash,expectedIndex:transcript.entries.length+1});
  return buildCeremonyTranscript({policy,session,sessionContext,events:[...transcript.entries,event],recordedAt:event.observedAt,transcriptId:transcript.transcriptId});
}

export function buildCeremonyResumeState({policy,session,sessionContext,transcript,now,resumeId='pn0001-c1-24g-human-ceremony-resume-state'}){
  validateCeremonyTranscript(transcript,{policy,session,sessionContext});const {t:nowMs}=tm(now,'now');tok(resumeId,'resumeId');
  const last=transcript.entries.at(-1)?.eventType??null;
  let status=last?NEXT_STATUS[last]:'INVALID_EMPTY_TRANSCRIPT';
  if(last==='CHALLENGE_BOUND'&&nowMs>Date.parse(session.challengeExpiresAt)) status='CHALLENGE_EXPIRED_REISSUE_REQUIRED';
  if(status==='INVALID_EMPTY_TRANSCRIPT') throw new Error('C1.24G transcript must contain CHALLENGE_BOUND event');
  const out={schema:CINESWARM_C1_24G_RESUME_SCHEMA,resumeId,policyId:policy.policyId,sessionHash:session.sessionHash,transcriptHash:transcript.transcriptHash,observedAt:now,status,nextAction:NEXT_ACTION[status],completedEventCount:transcript.entries.length,lastEventType:last,challengeExpiresAt:session.challengeExpiresAt,publicEvidenceOnly:true,privateKeyRequiredOnlyForExternalHumanSigning:status==='AWAITING_OFFLINE_ADMISSION_SIGNATURE',humanActionRequired:['AWAITING_PUBLIC_ENROLLMENT_RESPONSE','AWAITING_FINGERPRINT_ACKNOWLEDGEMENT','AWAITING_OFFLINE_ADMISSION_SIGNATURE','AWAITING_COMMIT_DIGEST_CONFIRMATION'].includes(status),orchestratorCanGeneratePrivateKey:false,orchestratorCanInferHumanAcknowledgement:false,orchestratorCanSignAdmission:false,orchestratorCanConfirmCommit:false,orchestratorCanAutoApplyCanonicalCommit:false,orchestratorCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.resumeHash=digestJson(out);return out;
}
export function validateCeremonyResumeState(v,ctx){if(v?.schema!==CINESWARM_C1_24G_RESUME_SCHEMA) throw new Error('invalid C1.24G resume schema');const rebuilt=buildCeremonyResumeState({...ctx,now:v.observedAt,resumeId:v.resumeId});if(rebuilt.resumeHash!==v.resumeHash) throw new Error('C1.24G resume self-hash mismatch');self(v,'resumeHash','C1.24G resume');boundary(v,'resume');return {valid:true};}

export function buildCeremonyRecoveryPack({policy,session,sessionContext,transcript,resumeState,resumeContext,publicArtifacts,createdAt,packId='pn0001-c1-24g-human-ceremony-recovery-pack'}){
  validateCeremonyResumeState(resumeState,resumeContext);tm(createdAt,'createdAt');tok(packId,'packId');
  if(!Array.isArray(publicArtifacts)||!publicArtifacts.length) throw new Error('C1.24G recovery pack requires public artifacts');
  const seen=new Set();const items=publicArtifacts.map((a,i)=>{const kind=tok(a.kind,`publicArtifacts[${i}].kind`);const path=assertPublicArtifactPath(a.path,`publicArtifacts[${i}].path`);const h=sha(a.sha256,`publicArtifacts[${i}].sha256`);if(seen.has(path)) throw new Error('C1.24G recovery pack duplicate artifact path');seen.add(path);return {kind,path,sha256:h,visibility:'PUBLIC'};});
  const out={schema:CINESWARM_C1_24G_RECOVERY_PACK_SCHEMA,packId,policyId:policy.policyId,sessionHash:session.sessionHash,transcriptHash:transcript.transcriptHash,resumeHash:resumeState.resumeHash,currentStatus:resumeState.status,createdAt,canonicalBaseline:structuredClone(session.canonicalBaseline),artifacts:items,witnessMode:policy.witnessMode,containsPrivateKeyMaterial:false,privateKeyPathIncluded:false,canAuthorizeAdmission:false,canApplyCanonicalCommit:false,orchestratorCanGeneratePrivateKey:false,orchestratorCanInferHumanAcknowledgement:false,orchestratorCanSignAdmission:false,orchestratorCanConfirmCommit:false,orchestratorCanAutoApplyCanonicalCommit:false,orchestratorCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.packHash=digestJson(out);return out;
}
export function validateCeremonyRecoveryPack(v,{policy,session,sessionContext,transcript,resumeState,resumeContext}){if(v?.schema!==CINESWARM_C1_24G_RECOVERY_PACK_SCHEMA) throw new Error('invalid C1.24G recovery pack schema');const rebuilt=buildCeremonyRecoveryPack({policy,session,sessionContext,transcript,resumeState,resumeContext,publicArtifacts:v.artifacts.map(a=>({kind:a.kind,path:a.path,sha256:a.sha256})),createdAt:v.createdAt,packId:v.packId});if(rebuilt.packHash!==v.packHash) throw new Error('C1.24G recovery pack self-hash mismatch');self(v,'packHash','C1.24G recovery pack');boundary(v,'recoveryPack');no(v.containsPrivateKeyMaterial,'recoveryPack.containsPrivateKeyMaterial');no(v.privateKeyPathIncluded,'recoveryPack.privateKeyPathIncluded');return {valid:true};}

export function classifyResumableHumanCeremonyState({technicalProofEarned=true,challengePresent=true,enrollmentResponsePresent=false,fingerprintAcknowledged=false,publicKeyStaged=false,admissionRequestPresent=false,admissionSignaturePresent=false,admissionStagePresent=false,commitDigestConfirmed=false,commitReceiptPresent=false}){
  let status='BLOCKED_TECHNICAL_PROOF';
  if(technicalProofEarned&&!challengePresent) status='NEEDS_PUBLIC_ENROLLMENT_CHALLENGE';
  else if(technicalProofEarned&&!enrollmentResponsePresent) status='AWAITING_PUBLIC_ENROLLMENT_RESPONSE';
  else if(!fingerprintAcknowledged) status='AWAITING_FINGERPRINT_ACKNOWLEDGEMENT';
  else if(!publicKeyStaged) status='AWAITING_PUBLIC_KEY_STAGE';
  else if(!admissionRequestPresent) status='AWAITING_ADMISSION_SIGNING_REQUEST';
  else if(!admissionSignaturePresent) status='AWAITING_OFFLINE_ADMISSION_SIGNATURE';
  else if(!admissionStagePresent) status='AWAITING_CANONICAL_ADMISSION_STAGE';
  else if(!commitDigestConfirmed) status='AWAITING_COMMIT_DIGEST_CONFIRMATION';
  else if(!commitReceiptPresent) status='AWAITING_C1_24F_CANONICAL_COMMIT_RECEIPT';
  else status='COMPLETE';
  return {status,nextAction:NEXT_ACTION[status]??null,orchestratorCanGeneratePrivateKey:false,orchestratorCanInferHumanAcknowledgement:false,orchestratorCanSignAdmission:false,orchestratorCanConfirmCommit:false,orchestratorCanAutoApplyCanonicalCommit:false,orchestratorCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
}
