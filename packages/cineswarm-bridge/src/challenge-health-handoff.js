import { digestJson } from './authorization-seal.js';
import { validateHumanKeyEnrollmentChallenge } from './offline-human-admission-kit.js';
import {
  validateResumableHumanCeremonyPolicy,
  validateResumableHumanCeremonySession,
  validateCeremonyTranscript,
  validateCeremonyResumeState,
  validateCeremonyRecoveryPack,
} from './resumable-human-ceremony.js';

export const CINESWARM_C1_24H_POLICY_SCHEMA='parallax.cineswarm.challenge-health-handoff-policy.c1.24h.v0.1';
export const CINESWARM_C1_24H_HEALTH_AUDIT_SCHEMA='parallax.cineswarm.ceremony-health-audit.c1.24h.v0.1';
export const CINESWARM_C1_24H_REISSUE_RECEIPT_SCHEMA='parallax.cineswarm.challenge-reissue-receipt.c1.24h.v0.1';
export const CINESWARM_C1_24H_HANDOFF_MANIFEST_SCHEMA='parallax.cineswarm.human-handoff-manifest.c1.24h.v0.1';

function req(v,l){if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`);return v.trim();}
function tok(v,l){const s=req(v,l);if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`);return s;}
function sha(v,l){const s=req(v,l);if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`);return s;}
function tm(v,l){const s=req(v,l);const t=Date.parse(s);if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`);return {s,t};}
function yes(v,l){if(v!==true) throw new Error(`${l} must remain true`);}
function no(v,l){if(v!==false) throw new Error(`${l} must remain false`);}
function strip(v,fields){const x=structuredClone(v);for(const f of fields) delete x[f];return x;}
function self(v,field,label){sha(v?.[field],`${label}.${field}`);if(digestJson(strip(v,[field]))!==v[field]) throw new Error(`${label} self-hash mismatch`);}
function safePublicPath(p,label='path'){
  const s=req(p,label);
  if(s.includes('..')) throw new Error(`${label} may not contain traversal`);
  if(/(^|[\\/])[^\\/]*\.private\.pem$/i.test(s)||/(^|[\\/])private[-_]?key/i.test(s)) throw new Error(`${label} may not reference private-key material`);
  return s;
}
function boundary(v,label){
  no(v.canGenerateHumanPrivateKey,`${label}.canGenerateHumanPrivateKey`);
  no(v.canInferHumanAcknowledgement,`${label}.canInferHumanAcknowledgement`);
  no(v.canSignAdmission,`${label}.canSignAdmission`);
  no(v.canConfirmCanonicalCommit,`${label}.canConfirmCanonicalCommit`);
  no(v.canAutoApplyCanonicalCommit,`${label}.canAutoApplyCanonicalCommit`);
  no(v.canAuthorizeRelease,`${label}.canAuthorizeRelease`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}

export function validateChallengeHealthHandoffPolicy(policy){
  if(policy?.schema!==CINESWARM_C1_24H_POLICY_SCHEMA) throw new Error('invalid C1.24H policy schema');
  tok(policy.policyId,'policyId');tok(policy.sourceC24GPolicyId,'sourceC24GPolicyId');
  if(Number(policy.maximumEnrollmentChallengeHours)!==24) throw new Error('C1.24H challenge lifetime policy drift');
  for(const k of ['requireCanonicalBaselineMatch','requirePublicArtifactHashVerification','requireChallengeFreshnessCheck','requirePublicOnlyHandoff','requireExplicitExpiredChallengeReissue','requireReissueLineage','requireCompactHandoff']) yes(policy[k],k);
  if(policy.reissueMode!=='EXPIRED_ONLY_NO_ENROLLMENT_RESPONSE') throw new Error('C1.24H reissue-mode drift');
  for(const k of ['canGenerateHumanPrivateKey','canInferHumanAcknowledgement','canSignAdmission','canConfirmCanonicalCommit','canAutoApplyCanonicalCommit','canAuthorizeRelease','publicRelease','relayDependency']) no(policy[k],k);
  return {valid:true};
}

function validateGContext({gPolicy,session,sessionContext,transcript,resumeState,resumeContext,recoveryPack,recoveryContext}){
  validateResumableHumanCeremonyPolicy(gPolicy);
  validateResumableHumanCeremonySession(session,sessionContext);
  validateCeremonyTranscript(transcript,{policy:gPolicy,session,sessionContext});
  validateCeremonyResumeState(resumeState,resumeContext);
  validateCeremonyRecoveryPack(recoveryPack,recoveryContext);
}

export function buildCeremonyHealthAudit({policy,gPolicy,session,sessionContext,transcript,resumeState,resumeContext,recoveryPack,recoveryContext,currentCanonicalHashes,artifactObservations,observedAt,auditId='pn0001-c1-24h-ceremony-health-audit'}){
  validateChallengeHealthHandoffPolicy(policy);validateGContext({gPolicy,session,sessionContext,transcript,resumeState,resumeContext,recoveryPack,recoveryContext});
  const now=tm(observedAt,'observedAt');tok(auditId,'auditId');
  const baseline=session.canonicalBaseline;
  const canon={
    keyRegistryHash:sha(currentCanonicalHashes?.keyRegistryHash,'currentCanonicalHashes.keyRegistryHash'),
    c24RegisterHash:sha(currentCanonicalHashes?.c24RegisterHash,'currentCanonicalHashes.c24RegisterHash'),
    admissionRegisterHash:sha(currentCanonicalHashes?.admissionRegisterHash,'currentCanonicalHashes.admissionRegisterHash'),
    commitRegisterHash:sha(currentCanonicalHashes?.commitRegisterHash,'currentCanonicalHashes.commitRegisterHash'),
  };
  const canonicalChecks=Object.keys(canon).map(k=>({kind:k,expectedSha256:baseline[k],actualSha256:canon[k],match:baseline[k]===canon[k]}));
  if(!Array.isArray(artifactObservations)||!artifactObservations.length) throw new Error('C1.24H audit requires artifact observations');
  const seen=new Set();
  const artifacts=artifactObservations.map((a,i)=>{
    const path=safePublicPath(a.path,`artifactObservations[${i}].path`);if(seen.has(path)) throw new Error('C1.24H duplicate artifact observation path');seen.add(path);
    const expected=sha(a.expectedSha256,`artifactObservations[${i}].expectedSha256`);
    const available=a.available===true;
    const actual=available?sha(a.actualSha256,`artifactObservations[${i}].actualSha256`):null;
    if(a.privateKeyDetected===true) return {kind:tok(a.kind,`artifactObservations[${i}].kind`),path,expectedSha256:expected,actualSha256:actual,available,match:false,privateKeyDetected:true};
    return {kind:tok(a.kind,`artifactObservations[${i}].kind`),path,expectedSha256:expected,actualSha256:actual,available,match:available&&actual===expected,privateKeyDetected:false};
  });
  const expired=now.t>=Date.parse(session.challengeExpiresAt);
  const canonicalDrift=canonicalChecks.some(x=>!x.match);
  const privateKeyDetected=artifacts.some(x=>x.privateKeyDetected);
  const artifactMismatch=artifacts.some(x=>x.available&&!x.match);
  const missing=artifacts.filter(x=>!x.available).length;
  let result='PASS';let status='HEALTHY_AWAITING_HUMAN_STEP';
  if(canonicalDrift||privateKeyDetected||artifactMismatch){result='FAIL';status='STOP_MANUAL_REVIEW';}
  else if(expired){result='DEGRADED';status='CHALLENGE_EXPIRED_REISSUE_REQUIRED';}
  else if(missing){result='DEGRADED';status='PUBLIC_HANDOFF_INCOMPLETE';}
  const out={
    schema:CINESWARM_C1_24H_HEALTH_AUDIT_SCHEMA,auditId,policyId:policy.policyId,sessionHash:session.sessionHash,transcriptHash:transcript.transcriptHash,resumeHash:resumeState.resumeHash,recoveryPackHash:recoveryPack.packHash,observedAt,
    result,status,challenge:{challengeHash:session.challengeHash,expiresAt:session.challengeExpiresAt,expired},canonicalChecks,artifactChecks:artifacts,summary:{canonicalDrift,privateKeyDetected,artifactMismatch,missingArtifactCount:missing,verifiedArtifactCount:artifacts.filter(x=>x.match).length},
    humanActionStillRequired:resumeState.humanActionRequired,healthAuditIsHumanAuthority:false,canGenerateHumanPrivateKey:false,canInferHumanAcknowledgement:false,canSignAdmission:false,canConfirmCanonicalCommit:false,canAutoApplyCanonicalCommit:false,canAuthorizeRelease:false,publicRelease:false,relayDependency:false,
  };
  out.auditHash=digestJson(out);return out;
}
export function validateCeremonyHealthAudit(v,ctx){if(v?.schema!==CINESWARM_C1_24H_HEALTH_AUDIT_SCHEMA) throw new Error('invalid C1.24H health-audit schema');const rebuilt=buildCeremonyHealthAudit({...ctx,observedAt:v.observedAt,auditId:v.auditId});if(rebuilt.auditHash!==v.auditHash) throw new Error('C1.24H health audit self-hash mismatch');self(v,'auditHash','C1.24H health audit');boundary(v,'healthAudit');return {valid:true};}

export function buildChallengeReissueReceipt({policy,gPolicy,oldSession,oldSessionContext,oldTranscript,newChallenge,kitPolicy,currentCanonicalHashes,reissuedAt,reason='EXPIRED',receiptId='pn0001-c1-24h-challenge-reissue'}){
  validateChallengeHealthHandoffPolicy(policy);validateResumableHumanCeremonyPolicy(gPolicy);validateResumableHumanCeremonySession(oldSession,oldSessionContext);validateCeremonyTranscript(oldTranscript,{policy:gPolicy,session:oldSession,sessionContext:oldSessionContext});
  const at=tm(reissuedAt,'reissuedAt');tok(receiptId,'receiptId');if(reason!=='EXPIRED') throw new Error('C1.24H only supports EXPIRED challenge reissue');
  if(at.t<Date.parse(oldSession.challengeExpiresAt)) throw new Error('C1.24H challenge cannot be reissued before expiry');
  if(oldTranscript.entries.length!==1||oldTranscript.entries[0]?.eventType!=='CHALLENGE_BOUND') throw new Error('C1.24H reissue requires no verified enrollment response on predecessor session');
  const baseline=oldSession.canonicalBaseline;
  for(const k of Object.keys(baseline)) if(sha(currentCanonicalHashes?.[k],`currentCanonicalHashes.${k}`)!==baseline[k]) throw new Error('C1.24H canonical baseline drift blocks challenge reissue');
  validateHumanKeyEnrollmentChallenge(newChallenge,{policy:kitPolicy,now:reissuedAt});
  if(newChallenge.challengeHash===oldSession.challengeHash) throw new Error('C1.24H replacement challenge must be distinct');
  if(newChallenge.authority?.id!==oldSession.authority.id||newChallenge.keyId!==oldSession.keyId) throw new Error('C1.24H replacement challenge authority/key drift');
  if(newChallenge.canonicalC24RegisterHash!==baseline.c24RegisterHash) throw new Error('C1.24H replacement challenge canonical C1.24 drift');
  const out={schema:CINESWARM_C1_24H_REISSUE_RECEIPT_SCHEMA,receiptId,policyId:policy.policyId,reissuedAt,reason,predecessor:{sessionHash:oldSession.sessionHash,transcriptHash:oldTranscript.transcriptHash,challengeHash:oldSession.challengeHash,challengeExpiredAt:oldSession.challengeExpiresAt},replacement:{challengeId:newChallenge.challengeId,challengeHash:newChallenge.challengeHash,challengeExpiresAt:newChallenge.expiresAt},canonicalBaseline:structuredClone(baseline),humanAuthorityChanged:false,enrollmentResponseCarriedForward:false,reissueCanEnrollKey:false,reissueCanAuthorizeAdmission:false,canGenerateHumanPrivateKey:false,canInferHumanAcknowledgement:false,canSignAdmission:false,canConfirmCanonicalCommit:false,canAutoApplyCanonicalCommit:false,canAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.receiptHash=digestJson(out);return out;
}
export function validateChallengeReissueReceipt(v,ctx){if(v?.schema!==CINESWARM_C1_24H_REISSUE_RECEIPT_SCHEMA) throw new Error('invalid C1.24H reissue receipt schema');const rebuilt=buildChallengeReissueReceipt({...ctx,reissuedAt:v.reissuedAt,reason:v.reason,receiptId:v.receiptId});if(rebuilt.receiptHash!==v.receiptHash) throw new Error('C1.24H reissue receipt self-hash mismatch');self(v,'receiptHash','C1.24H reissue receipt');boundary(v,'reissueReceipt');return {valid:true};}

export function buildHumanHandoffManifest({policy,healthAudit,files,generatedAt,manifestId='pn0001-c1-24h-human-handoff'}){
  validateChallengeHealthHandoffPolicy(policy);tm(generatedAt,'generatedAt');tok(manifestId,'manifestId');
  if(healthAudit?.schema!==CINESWARM_C1_24H_HEALTH_AUDIT_SCHEMA) throw new Error('C1.24H handoff requires health audit');self(healthAudit,'auditHash','C1.24H health audit');
  if(healthAudit.result!=='PASS') throw new Error('C1.24H handoff requires PASS health audit');
  if(!Array.isArray(files)||!files.length) throw new Error('C1.24H handoff requires files');const seen=new Set();
  const items=files.map((f,i)=>{const path=safePublicPath(f.path,`files[${i}].path`);if(seen.has(path)) throw new Error('C1.24H handoff duplicate file path');seen.add(path);return {kind:tok(f.kind,`files[${i}].kind`),path,sha256:sha(f.sha256,`files[${i}].sha256`),bytes:Number(f.bytes)};});
  for(const x of items) if(!Number.isSafeInteger(x.bytes)||x.bytes<0) throw new Error('C1.24H handoff bytes must be nonnegative integer');
  const out={schema:CINESWARM_C1_24H_HANDOFF_MANIFEST_SCHEMA,manifestId,policyId:policy.policyId,generatedAt,healthAuditHash:healthAudit.auditHash,sessionHash:healthAudit.sessionHash,transcriptHash:healthAudit.transcriptHash,fileCount:items.length,totalBytes:items.reduce((n,x)=>n+x.bytes,0),files:items,compactHandoff:true,containsPreservationBuildClosure:false,containsPrivateKeyMaterial:false,includesExternalKeyGenerator:true,privateKeyDestinationMustRemainOutsideHandoff:true,handoffCanEnrollKey:false,handoffCanAuthorizeAdmission:false,handoffCanApplyCanonicalCommit:false,canGenerateHumanPrivateKey:false,canInferHumanAcknowledgement:false,canSignAdmission:false,canConfirmCanonicalCommit:false,canAutoApplyCanonicalCommit:false,canAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.manifestHash=digestJson(out);return out;
}
export function validateHumanHandoffManifest(v,{policy,healthAudit}){if(v?.schema!==CINESWARM_C1_24H_HANDOFF_MANIFEST_SCHEMA) throw new Error('invalid C1.24H handoff manifest schema');const rebuilt=buildHumanHandoffManifest({policy,healthAudit,files:v.files,generatedAt:v.generatedAt,manifestId:v.manifestId});if(rebuilt.manifestHash!==v.manifestHash) throw new Error('C1.24H handoff manifest self-hash mismatch');self(v,'manifestHash','C1.24H handoff manifest');boundary(v,'handoffManifest');no(v.containsPrivateKeyMaterial,'handoffManifest.containsPrivateKeyMaterial');return {valid:true};}

export function classifyChallengeHealthHandoff({technicalProofEarned=true,liveSessionPresent=true,healthAuditResult='PASS',challengeExpired=false,handoffReady=false,enrollmentResponsePresent=false}){
  let status='BLOCKED_TECHNICAL_PROOF';
  if(technicalProofEarned&&!liveSessionPresent) status='NEEDS_RESUMABLE_SESSION';
  else if(healthAuditResult==='FAIL') status='STOP_MANUAL_REVIEW';
  else if(challengeExpired) status='CHALLENGE_EXPIRED_REISSUE_REQUIRED';
  else if(!handoffReady) status='BUILD_COMPACT_HUMAN_HANDOFF';
  else if(!enrollmentResponsePresent) status='HEALTHY_AWAITING_PUBLIC_ENROLLMENT_RESPONSE';
  else status='PUBLIC_ENROLLMENT_RESPONSE_READY_FOR_C1_24E';
  return {status,humanAuthorityStillRequired:true,canGenerateHumanPrivateKey:false,canInferHumanAcknowledgement:false,canSignAdmission:false,canConfirmCanonicalCommit:false,canAutoApplyCanonicalCommit:false,canAuthorizeRelease:false,publicRelease:false,relayDependency:false};
}
