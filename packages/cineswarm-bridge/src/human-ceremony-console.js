import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import {
  buildC17EnrollCeremonyFromOfflineResponse,
  stageHumanKeyEnrollment,
  validateHumanKeyEnrollmentChallenge,
  validateHumanKeyEnrollmentResponse,
  validateOfflineAdmissionSignedResponse,
} from './offline-human-admission-kit.js';
import {
  applyIndependentRebuildCanonicalAdmission,
  appendIndependentRebuildAdmissionReceipt,
  buildIndependentRebuildAdmissionReceipt,
  validateIndependentRebuildAdmissionRegister,
} from './independent-rebuild-admission.js';

export const CINESWARM_C1_24E_CONSOLE_POLICY_SCHEMA = 'parallax.cineswarm.human-ceremony-console-policy.c1.24e.v0.1';
export const CINESWARM_C1_24E_FINGERPRINT_ACK_SCHEMA = 'parallax.cineswarm.human-key-fingerprint-acknowledgement.c1.24e.v0.1';
export const CINESWARM_C1_24E_KEY_STAGE_SCHEMA = 'parallax.cineswarm.human-key-enrollment-stage.c1.24e.v0.1';
export const CINESWARM_C1_24E_ADMISSION_STAGE_SCHEMA = 'parallax.cineswarm.canonical-admission-stage-bundle.c1.24e.v0.1';

function req(v,l){ if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`); return v.trim(); }
function tok(v,l){ const s=req(v,l); if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`); return s; }
function sha(v,l){ const s=req(v,l); if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`); return s; }
function tm(v,l){ const s=req(v,l); const t=Date.parse(s); if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`); return {s,t}; }
function yes(v,l){ if(v!==true) throw new Error(`${l} must remain true`); }
function no(v,l){ if(v!==false) throw new Error(`${l} must remain false`); }
function strip(v,fields){ const x=structuredClone(v); for(const f of fields) delete x[f]; return x; }
function exactHash(v,field,label){ sha(v?.[field],`${label}.${field}`); if(digestJson(strip(v,[field]))!==v[field]) throw new Error(`${label} self-hash mismatch`); }
function boundary(v,label){
  no(v.consoleCanGeneratePrivateKey,`${label}.consoleCanGeneratePrivateKey`);
  no(v.consoleCanAutoAcknowledgeFingerprint,`${label}.consoleCanAutoAcknowledgeFingerprint`);
  no(v.consoleCanAutoSignAdmission,`${label}.consoleCanAutoSignAdmission`);
  no(v.consoleCanAutoApplyCanonicalAdmission,`${label}.consoleCanAutoApplyCanonicalAdmission`);
  no(v.consoleCanAuthorizeRelease,`${label}.consoleCanAuthorizeRelease`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}

export function validateHumanCeremonyConsolePolicy(policy){
  if(!policy||policy.schema!==CINESWARM_C1_24E_CONSOLE_POLICY_SCHEMA) throw new Error('invalid C1.24E console policy schema');
  tok(policy.policyId,'policyId'); tok(policy.sourceC24DPolicyId,'sourceC24DPolicyId');
  for(const k of ['requireExactFingerprintReentry','requireProofOfPossessionBeforeAcknowledgement','requireStagedRegistryBeforeAdmissionSigning','requireSignedResponseBeforeAdmissionStage','requireExactCanonicalBeforeHash','stagingOnly']) yes(policy[k],k);
  for(const k of ['consoleCanGeneratePrivateKey','consoleCanAutoAcknowledgeFingerprint','consoleCanAutoSignAdmission','consoleCanAutoApplyCanonicalAdmission','consoleCanAuthorizeRelease','publicRelease','relayDependency']) no(policy[k],k);
  return {valid:true};
}

export function buildHumanFingerprintAcknowledgement({policy,challenge,response,kitPolicy,acknowledgedFingerprintSha256,authorityId,acknowledgedAt,acknowledgementId='pn0001-c1-24e-human-fingerprint-ack'}){
  validateHumanCeremonyConsolePolicy(policy);
  validateHumanKeyEnrollmentChallenge(challenge,{policy:kitPolicy,now:acknowledgedAt});
  validateHumanKeyEnrollmentResponse(response,{challenge,policy:kitPolicy,now:acknowledgedAt});
  tok(acknowledgementId,'acknowledgementId'); tok(authorityId,'authorityId'); tm(acknowledgedAt,'acknowledgedAt');
  sha(acknowledgedFingerprintSha256,'acknowledgedFingerprintSha256');
  if(authorityId!==response.authority.id) throw new Error('C1.24E fingerprint acknowledgement authority drift');
  if(acknowledgedFingerprintSha256!==response.fingerprintSha256) throw new Error('C1.24E full fingerprint acknowledgement mismatch');
  const out={
    schema:CINESWARM_C1_24E_FINGERPRINT_ACK_SCHEMA,
    acknowledgementId,
    policyId:policy.policyId,
    authority:{kind:'human',id:authorityId,simulated:false},
    keyId:response.keyId,
    challengeHash:challenge.challengeHash,
    enrollmentResponseHash:response.responseHash,
    publicKeyFingerprintSha256:response.fingerprintSha256,
    exactFingerprintReentered:true,
    proofOfPossessionVerified:true,
    acknowledgedAt,
    privateKeyIncluded:false,
    consoleCanGeneratePrivateKey:false,
    consoleCanAutoAcknowledgeFingerprint:false,
    consoleCanAutoSignAdmission:false,
    consoleCanAutoApplyCanonicalAdmission:false,
    consoleCanAuthorizeRelease:false,
    publicRelease:false,
    relayDependency:false,
  };
  out.acknowledgementHash=digestJson(out); return out;
}

export function validateHumanFingerprintAcknowledgement(v,{policy,challenge,response,kitPolicy}){
  if(v?.schema!==CINESWARM_C1_24E_FINGERPRINT_ACK_SCHEMA) throw new Error('invalid C1.24E fingerprint acknowledgement schema');
  const rebuilt=buildHumanFingerprintAcknowledgement({policy,challenge,response,kitPolicy,acknowledgedFingerprintSha256:v.publicKeyFingerprintSha256,authorityId:v.authority?.id,acknowledgedAt:v.acknowledgedAt,acknowledgementId:v.acknowledgementId});
  if(rebuilt.acknowledgementHash!==v.acknowledgementHash) throw new Error('C1.24E fingerprint acknowledgement self-hash mismatch');
  exactHash(v,'acknowledgementHash','C1.24E fingerprint acknowledgement'); boundary(v,'fingerprintAcknowledgement'); return {valid:true};
}

export function buildHumanKeyEnrollmentStage({policy,acknowledgement,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry,recordedAt,stageId='pn0001-c1-24e-key-enrollment-stage'}){
  validateHumanFingerprintAcknowledgement(acknowledgement,{policy,challenge,response,kitPolicy});
  validateSigningKeyRegistry(keyRegistry); tok(stageId,'stageId'); tm(recordedAt,'recordedAt');
  const ceremony=buildC17EnrollCeremonyFromOfflineResponse({response,challenge,policy:kitPolicy,keyCeremonyPolicy,keyRegistry,recordedAt,exactFingerprintAcknowledgement:acknowledgement.publicKeyFingerprintSha256});
  const staged=stageHumanKeyEnrollment({ceremony,keyRegistry,keyCeremonyPolicy,now:recordedAt});
  const out={
    schema:CINESWARM_C1_24E_KEY_STAGE_SCHEMA,
    stageId, policyId:policy.policyId, authority:structuredClone(acknowledgement.authority), keyId:response.keyId,
    acknowledgementHash:acknowledgement.acknowledgementHash,
    enrollmentResponseHash:response.responseHash,
    keyCeremony:ceremony,
    stagedKeyRegistry:staged.stagedRegistry,
    stagedKeyRegistryHash:digestJson(staged.stagedRegistry),
    canonicalKeyRegistryMutated:false,
    canonicalApplyIncluded:false,
    recordedAt,
    consoleCanGeneratePrivateKey:false,
    consoleCanAutoAcknowledgeFingerprint:false,
    consoleCanAutoSignAdmission:false,
    consoleCanAutoApplyCanonicalAdmission:false,
    consoleCanAuthorizeRelease:false,
    publicRelease:false,
    relayDependency:false,
  };
  out.stageHash=digestJson(out); return out;
}

export function validateHumanKeyEnrollmentStage(v,{policy,acknowledgement,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry}){
  if(v?.schema!==CINESWARM_C1_24E_KEY_STAGE_SCHEMA) throw new Error('invalid C1.24E key enrollment stage schema');
  const rebuilt=buildHumanKeyEnrollmentStage({policy,acknowledgement,challenge,response,kitPolicy,keyCeremonyPolicy,keyRegistry,recordedAt:v.recordedAt,stageId:v.stageId});
  if(rebuilt.stageHash!==v.stageHash) throw new Error('C1.24E key enrollment stage self-hash mismatch');
  if(v.canonicalKeyRegistryMutated!==false||v.canonicalApplyIncluded!==false) throw new Error('C1.24E key enrollment stage cannot mutate canonical key registry');
  exactHash(v,'stageHash','C1.24E key enrollment stage'); boundary(v,'keyEnrollmentStage'); return {valid:true};
}

export function buildCanonicalAdmissionStageBundle({
  policy, request, signedResponse, kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister, admissionRegister, review, plan, stagedKeyRegistry, stagedKeyRegistryHash, stagedAt, stageId='pn0001-c1-24e-canonical-admission-stage'
}){
  validateHumanCeremonyConsolePolicy(policy); validateSigningKeyRegistry(stagedKeyRegistry); sha(stagedKeyRegistryHash,'stagedKeyRegistryHash'); if(digestJson(stagedKeyRegistry)!==stagedKeyRegistryHash) throw new Error('C1.24E staged key registry hash drift');
  validateIndependentRebuildAdmissionRegister(admissionRegister,{policy:admissionPolicy}); tm(stagedAt,'stagedAt'); tok(stageId,'stageId');
  const validated=validateOfflineAdmissionSignedResponse(signedResponse,{request,policy:kitPolicy,admissionPolicy,proofContext,c24CanonicalRegister,review,plan,keyRegistry:stagedKeyRegistry,now:signedResponse.signedAt});
  const proposedCanonical=applyIndependentRebuildCanonicalAdmission({ceremony:validated.ceremony,keyRegistry:stagedKeyRegistry,policy:admissionPolicy,proofContext,c24CanonicalRegister,review,plan});
  const receipt=buildIndependentRebuildAdmissionReceipt({policy:admissionPolicy,ceremony:validated.ceremony,keyRegistry:stagedKeyRegistry,proofContext,c24CanonicalRegisterBefore:c24CanonicalRegister,review,plan,c24CanonicalRegisterAfter:proposedCanonical,issuedAt:stagedAt,receiptId:'pn0001-c1-24e-proposed-independent-rebuild-admission-receipt'});
  const proposedAdmissionRegister=appendIndependentRebuildAdmissionReceipt({register:admissionRegister,receipt,receiptContext:{policy:admissionPolicy,ceremony:validated.ceremony,keyRegistry:stagedKeyRegistry,proofContext,c24CanonicalRegisterBefore:c24CanonicalRegister,review,plan,c24CanonicalRegisterAfter:proposedCanonical},policy:admissionPolicy,recordedAt:stagedAt});
  const out={
    schema:CINESWARM_C1_24E_ADMISSION_STAGE_SCHEMA,
    stageId, policyId:policy.policyId, stagedAt,
    authority:structuredClone(signedResponse.authority), keyId:signedResponse.keyId,
    requestHash:request.requestHash, signedResponseHash:signedResponse.responseHash, stagedKeyRegistryHash,
    canonicalBeforeHash:c24CanonicalRegister.registerHash, canonicalBeforeRevision:c24CanonicalRegister.revision,
    proposedCanonicalRegister:proposedCanonical,
    proposedCanonicalRegisterHash:proposedCanonical.registerHash,
    proposedAdmissionReceipt:receipt,
    proposedAdmissionReceiptHash:receipt.receiptHash,
    proposedAdmissionRegister,
    proposedAdmissionRegisterHash:proposedAdmissionRegister.registerHash,
    exactSignedTargetMatched:proposedCanonical.registerHash===plan.expectedCanonicalRegisterAfterHash,
    proposedCanonicalFullIndependentSourceRebuildProven:proposedCanonical.fullIndependentSourceRebuildProven===true,
    canonicalFilesMutated:false,
    canonicalApplyIncluded:false,
    requiresSeparateHumanCommit:true,
    consoleCanGeneratePrivateKey:false,
    consoleCanAutoAcknowledgeFingerprint:false,
    consoleCanAutoSignAdmission:false,
    consoleCanAutoApplyCanonicalAdmission:false,
    consoleCanAuthorizeRelease:false,
    publicRelease:false,
    relayDependency:false,
  };
  if(!out.exactSignedTargetMatched||!out.proposedCanonicalFullIndependentSourceRebuildProven) throw new Error('C1.24E proposed canonical target does not match signed plan');
  out.stageHash=digestJson(out); return out;
}

export function validateCanonicalAdmissionStageBundle(v,ctx){
  if(v?.schema!==CINESWARM_C1_24E_ADMISSION_STAGE_SCHEMA) throw new Error('invalid C1.24E canonical admission stage schema');
  const rebuilt=buildCanonicalAdmissionStageBundle({...ctx,stagedAt:v.stagedAt,stageId:v.stageId});
  if(rebuilt.stageHash!==v.stageHash) throw new Error('C1.24E canonical admission stage self-hash mismatch');
  if(v.canonicalFilesMutated!==false||v.canonicalApplyIncluded!==false||v.requiresSeparateHumanCommit!==true) throw new Error('C1.24E canonical admission stage boundary drift');
  exactHash(v,'stageHash','C1.24E canonical admission stage'); boundary(v,'canonicalAdmissionStage'); return {valid:true};
}

export function classifyHumanCeremonyConsoleState({technicalProofEarned,humanEnrollmentResponsePresent=false,fingerprintAcknowledged=false,publicKeyStaged=false,admissionSigningRequestPresent=false,signedAdmissionResponsePresent=false,canonicalAdmissionStagePresent=false,canonicalFullIndependentSourceRebuildProven=false}){
  const blockers=[];
  if(!technicalProofEarned) blockers.push('TECHNICAL_PROOF_NOT_EARNED');
  if(!humanEnrollmentResponsePresent) blockers.push('PUBLIC_ENROLLMENT_RESPONSE_NOT_RECEIVED');
  if(!fingerprintAcknowledged) blockers.push('FULL_FINGERPRINT_NOT_ACKNOWLEDGED');
  if(!publicKeyStaged) blockers.push('HUMAN_PUBLIC_KEY_NOT_STAGED');
  if(!admissionSigningRequestPresent) blockers.push('ADMISSION_SIGNING_REQUEST_NOT_PREPARED');
  if(!signedAdmissionResponsePresent) blockers.push('SIGNED_ADMISSION_RESPONSE_NOT_RECEIVED');
  if(!canonicalAdmissionStagePresent) blockers.push('CANONICAL_ADMISSION_NOT_STAGED');
  if(!canonicalFullIndependentSourceRebuildProven) blockers.push('CANONICAL_C1_24_NOT_COMMITTED');
  let status='BLOCKED';
  if(technicalProofEarned&&!humanEnrollmentResponsePresent) status='AWAITING_PUBLIC_ENROLLMENT_RESPONSE';
  else if(humanEnrollmentResponsePresent&&!fingerprintAcknowledged) status='AWAITING_HUMAN_FINGERPRINT_ACKNOWLEDGEMENT';
  else if(publicKeyStaged&&!signedAdmissionResponsePresent) status='AWAITING_OFFLINE_ADMISSION_SIGNATURE';
  else if(canonicalAdmissionStagePresent&&!canonicalFullIndependentSourceRebuildProven) status='CANONICAL_COMMIT_READY_REQUIRES_SEPARATE_HUMAN_ACT';
  else if(canonicalFullIndependentSourceRebuildProven) status='CANONICAL_ADMISSION_COMPLETE';
  return {phase:'C1.24E',status,technicalProofEarned,humanEnrollmentResponsePresent,fingerprintAcknowledged,publicKeyStaged,admissionSigningRequestPresent,signedAdmissionResponsePresent,canonicalAdmissionStagePresent,canonicalFullIndependentSourceRebuildProven,blockers,consoleCanGeneratePrivateKey:false,consoleCanAutoAcknowledgeFingerprint:false,consoleCanAutoSignAdmission:false,consoleCanAutoApplyCanonicalAdmission:false,consoleCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
}
