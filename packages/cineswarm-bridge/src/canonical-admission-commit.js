import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import {
  validateHumanKeyEnrollmentStage,
  validateCanonicalAdmissionStageBundle,
} from './human-ceremony-console.js';
import { validateIndependentRebuildAdmissionRegister } from './independent-rebuild-admission.js';

export const CINESWARM_C1_24F_POLICY_SCHEMA = 'parallax.cineswarm.canonical-admission-commit-policy.c1.24f.v0.1';
export const CINESWARM_C1_24F_PREVIEW_SCHEMA = 'parallax.cineswarm.canonical-admission-commit-preview.c1.24f.v0.1';
export const CINESWARM_C1_24F_CONFIRMATION_SCHEMA = 'parallax.cineswarm.canonical-admission-commit-confirmation.c1.24f.v0.1';
export const CINESWARM_C1_24F_TRANSACTION_SCHEMA = 'parallax.cineswarm.canonical-admission-transaction-plan.c1.24f.v0.1';
export const CINESWARM_C1_24F_AUDIT_SCHEMA = 'parallax.cineswarm.canonical-admission-post-commit-audit.c1.24f.v0.1';
export const CINESWARM_C1_24F_RECEIPT_SCHEMA = 'parallax.cineswarm.canonical-admission-commit-receipt.c1.24f.v0.1';
export const CINESWARM_C1_24F_REGISTER_SCHEMA = 'parallax.cineswarm.canonical-admission-commit-register.c1.24f.v0.1';

const LOGICAL_TARGETS = Object.freeze({
  keyRegistry: 'fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json',
  c24Register: 'fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json',
  admissionRegister: 'fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json',
});

function req(v,l){ if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`); return v.trim(); }
function tok(v,l){ const s=req(v,l); if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`); return s; }
function sha(v,l){ const s=req(v,l); if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`); return s; }
function tm(v,l){ const s=req(v,l); const t=Date.parse(s); if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`); return {s,t}; }
function yes(v,l){ if(v!==true) throw new Error(`${l} must remain true`); }
function no(v,l){ if(v!==false) throw new Error(`${l} must remain false`); }
function strip(v,fields){ const x=structuredClone(v); for(const f of fields) delete x[f]; return x; }
function exactHash(v,field,label){ sha(v?.[field],`${label}.${field}`); if(digestJson(strip(v,[field]))!==v[field]) throw new Error(`${label} self-hash mismatch`); }
function boundary(v,label){
  no(v.commitCanAutoConfirm,`${label}.commitCanAutoConfirm`);
  no(v.commitCanAutoApply,`${label}.commitCanAutoApply`);
  no(v.commitCanAuthorizeRelease,`${label}.commitCanAuthorizeRelease`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}

export function validateCanonicalAdmissionCommitPolicy(policy){
  if(!policy||policy.schema!==CINESWARM_C1_24F_POLICY_SCHEMA) throw new Error('invalid C1.24F commit policy schema');
  tok(policy.policyId,'policyId'); tok(policy.sourceC24EPolicyId,'sourceC24EPolicyId');
  for(const k of ['requireExactStageValidation','requireExactBeforeHashes','requireFullCommitDigestReentry','requireRecoveryBackups','requireJournaledTwoPhaseCommit','requirePostCommitAudit','requireSeparateHumanCommitAct']) yes(policy[k],k);
  for(const k of ['claimMultiFileAtomicity','commitCanAutoConfirm','commitCanAutoApply','commitCanAuthorizeRelease','publicRelease','relayDependency']) no(policy[k],k);
  if(policy.commitModel!=='JOURNALED_TWO_PHASE_RECOVERABLE_NOT_MULTI_FILE_ATOMIC') throw new Error('C1.24F commit model drift');
  return {valid:true};
}

function validateStageInputs({keyStage,admissionStage,keyStageContext,admissionStageContext,currentKeyRegistry,currentC24Register,currentAdmissionRegister}){
  validateSigningKeyRegistry(currentKeyRegistry);
  validateHumanKeyEnrollmentStage(keyStage,keyStageContext);
  validateCanonicalAdmissionStageBundle(admissionStage,admissionStageContext);
  validateIndependentRebuildAdmissionRegister(currentAdmissionRegister,{policy:admissionStageContext.admissionPolicy});
  if(digestJson(currentKeyRegistry)!==digestJson(keyStageContext.keyRegistry)) throw new Error('C1.24F current key registry drift from staged enrollment context');
  if(currentC24Register.registerHash!==admissionStage.canonicalBeforeHash||currentC24Register.registerHash!==admissionStageContext.c24CanonicalRegister.registerHash) throw new Error('C1.24F current C1.24 register drift');
  if(currentAdmissionRegister.registerHash!==admissionStageContext.admissionRegister.registerHash) throw new Error('C1.24F current C1.24C admission register drift');
  if(keyStage.stagedKeyRegistryHash!==admissionStage.stagedKeyRegistryHash) throw new Error('C1.24F key-stage/admission-stage registry hash mismatch');
  if(keyStage.keyId!==admissionStage.keyId||keyStage.authority?.id!==admissionStage.authority?.id) throw new Error('C1.24F human authority/key drift across stages');
  if(admissionStage.requiresSeparateHumanCommit!==true||admissionStage.canonicalFilesMutated!==false) throw new Error('C1.24F requires an unapplied C1.24E stage bundle');
}

export function buildCanonicalAdmissionCommitPreview({policy,keyStage,admissionStage,keyStageContext,admissionStageContext,currentKeyRegistry,currentC24Register,currentAdmissionRegister,preparedAt,previewId='pn0001-c1-24f-canonical-admission-commit-preview'}){
  validateCanonicalAdmissionCommitPolicy(policy); tm(preparedAt,'preparedAt'); tok(previewId,'previewId');
  validateStageInputs({keyStage,admissionStage,keyStageContext,admissionStageContext,currentKeyRegistry,currentC24Register,currentAdmissionRegister});
  const before={
    keyRegistryHash:digestJson(currentKeyRegistry),
    c24RegisterHash:currentC24Register.registerHash,
    admissionRegisterHash:currentAdmissionRegister.registerHash,
  };
  const after={
    keyRegistryHash:keyStage.stagedKeyRegistryHash,
    c24RegisterHash:admissionStage.proposedCanonicalRegisterHash,
    admissionRegisterHash:admissionStage.proposedAdmissionRegisterHash,
  };
  const commitIntentDigest=digestJson({
    domain:'PARALLAX-CINESWARM-C1.24F-CANONICAL-ADMISSION-COMMIT',
    policyId:policy.policyId,
    authorityId:admissionStage.authority.id,
    keyId:admissionStage.keyId,
    keyStageHash:keyStage.stageHash,
    admissionStageHash:admissionStage.stageHash,
    before,after,targets:LOGICAL_TARGETS,
  });
  const out={
    schema:CINESWARM_C1_24F_PREVIEW_SCHEMA,previewId,policyId:policy.policyId,preparedAt,
    authority:structuredClone(admissionStage.authority),keyId:admissionStage.keyId,
    keyStageHash:keyStage.stageHash,admissionStageHash:admissionStage.stageHash,
    before,after,targets:structuredClone(LOGICAL_TARGETS),
    commitIntentDigest,fullCommitDigestReentryRequired:true,
    journaledTwoPhaseCommit:true,multiFileAtomicityClaimed:false,recoveryBackupsRequired:true,postCommitAuditRequired:true,
    canonicalApplyPerformed:false,commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false,
  };
  out.previewHash=digestJson(out); return out;
}

export function validateCanonicalAdmissionCommitPreview(v,ctx){
  if(v?.schema!==CINESWARM_C1_24F_PREVIEW_SCHEMA) throw new Error('invalid C1.24F commit preview schema');
  const rebuilt=buildCanonicalAdmissionCommitPreview({...ctx,preparedAt:v.preparedAt,previewId:v.previewId});
  if(rebuilt.previewHash!==v.previewHash) throw new Error('C1.24F commit preview self-hash mismatch');
  exactHash(v,'previewHash','C1.24F commit preview'); boundary(v,'commitPreview');
  if(v.multiFileAtomicityClaimed!==false||v.canonicalApplyPerformed!==false) throw new Error('C1.24F preview boundary drift');
  return {valid:true};
}

export function buildCanonicalAdmissionCommitConfirmation({policy,preview,previewContext,enteredCommitIntentDigest,authorityId,confirmedAt,confirmationId='pn0001-c1-24f-canonical-admission-commit-confirmation'}){
  validateCanonicalAdmissionCommitPreview(preview,previewContext); tm(confirmedAt,'confirmedAt'); tok(confirmationId,'confirmationId'); tok(authorityId,'authorityId'); sha(enteredCommitIntentDigest,'enteredCommitIntentDigest');
  if(authorityId!==preview.authority.id) throw new Error('C1.24F commit confirmation authority drift');
  if(enteredCommitIntentDigest!==preview.commitIntentDigest) throw new Error('C1.24F full commit digest confirmation mismatch');
  const out={schema:CINESWARM_C1_24F_CONFIRMATION_SCHEMA,confirmationId,policyId:policy.policyId,previewHash:preview.previewHash,authority:{kind:'human',id:authorityId},keyId:preview.keyId,commitIntentDigest:preview.commitIntentDigest,exactFullDigestReentered:true,confirmedAt,canonicalApplyPerformed:false,commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.confirmationHash=digestJson(out); return out;
}

export function validateCanonicalAdmissionCommitConfirmation(v,{policy,preview,previewContext}){
  if(v?.schema!==CINESWARM_C1_24F_CONFIRMATION_SCHEMA) throw new Error('invalid C1.24F commit confirmation schema');
  const rebuilt=buildCanonicalAdmissionCommitConfirmation({policy,preview,previewContext,enteredCommitIntentDigest:v.commitIntentDigest,authorityId:v.authority?.id,confirmedAt:v.confirmedAt,confirmationId:v.confirmationId});
  if(rebuilt.confirmationHash!==v.confirmationHash) throw new Error('C1.24F commit confirmation self-hash mismatch');
  exactHash(v,'confirmationHash','C1.24F commit confirmation'); boundary(v,'commitConfirmation'); return {valid:true};
}

export function buildCanonicalAdmissionTransactionPlan({policy,preview,previewContext,confirmation,preparedAt,transactionId='pn0001-c1-24f-canonical-admission-transaction'}){
  validateCanonicalAdmissionCommitConfirmation(confirmation,{policy,preview,previewContext}); tm(preparedAt,'preparedAt'); tok(transactionId,'transactionId');
  const operations=[
    {order:1,target:'SIGNING_KEY_REGISTRY',logicalPath:preview.targets.keyRegistry,beforeHash:preview.before.keyRegistryHash,afterHash:preview.after.keyRegistryHash,backupRequired:true},
    {order:2,target:'C1_24_CANONICAL_REGISTER',logicalPath:preview.targets.c24Register,beforeHash:preview.before.c24RegisterHash,afterHash:preview.after.c24RegisterHash,backupRequired:true},
    {order:3,target:'C1_24C_ADMISSION_REGISTER',logicalPath:preview.targets.admissionRegister,beforeHash:preview.before.admissionRegisterHash,afterHash:preview.after.admissionRegisterHash,backupRequired:true},
  ];
  const out={schema:CINESWARM_C1_24F_TRANSACTION_SCHEMA,transactionId,policyId:policy.policyId,previewHash:preview.previewHash,confirmationHash:confirmation.confirmationHash,authority:structuredClone(confirmation.authority),keyId:preview.keyId,preparedAt,state:'PREPARED',operations,recoveryModel:'BACKUP_EACH_TARGET_AND_JOURNAL_EACH_RENAME',multiFileAtomicityClaimed:false,canonicalApplyPerformed:false,commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; out.transactionHash=digestJson(out); return out;
}

export function validateCanonicalAdmissionTransactionPlan(v,{policy,preview,previewContext,confirmation}){
  if(v?.schema!==CINESWARM_C1_24F_TRANSACTION_SCHEMA) throw new Error('invalid C1.24F transaction schema');
  const rebuilt=buildCanonicalAdmissionTransactionPlan({policy,preview,previewContext,confirmation,preparedAt:v.preparedAt,transactionId:v.transactionId});
  if(rebuilt.transactionHash!==v.transactionHash) throw new Error('C1.24F transaction self-hash mismatch');
  exactHash(v,'transactionHash','C1.24F transaction'); boundary(v,'transaction'); if(v.multiFileAtomicityClaimed!==false) throw new Error('C1.24F transaction cannot claim multi-file atomicity'); return {valid:true};
}

export function buildCanonicalAdmissionPostCommitAudit({policy,transaction,transactionContext,appliedKeyRegistry,appliedC24Register,appliedAdmissionRegister,auditedAt,auditId='pn0001-c1-24f-post-commit-audit'}){
  validateCanonicalAdmissionTransactionPlan(transaction,transactionContext); tm(auditedAt,'auditedAt'); tok(auditId,'auditId'); validateSigningKeyRegistry(appliedKeyRegistry);
  const observed={keyRegistryHash:digestJson(appliedKeyRegistry),c24RegisterHash:sha(appliedC24Register?.registerHash,'appliedC24Register.registerHash'),admissionRegisterHash:sha(appliedAdmissionRegister?.registerHash,'appliedAdmissionRegister.registerHash')};
  const expected={keyRegistryHash:transaction.operations[0].afterHash,c24RegisterHash:transaction.operations[1].afterHash,admissionRegisterHash:transaction.operations[2].afterHash};
  const matches={keyRegistry:observed.keyRegistryHash===expected.keyRegistryHash,c24Register:observed.c24RegisterHash===expected.c24RegisterHash,admissionRegister:observed.admissionRegisterHash===expected.admissionRegisterHash};
  const exactAll=Object.values(matches).every(Boolean);
  if(!exactAll) throw new Error('C1.24F post-commit audit hash mismatch');
  if(appliedC24Register.fullIndependentSourceRebuildProven!==true) throw new Error('C1.24F post-commit audit requires admitted C1.24 canonical proof');
  if(appliedAdmissionRegister.admissionReceiptCount<1) throw new Error('C1.24F post-commit audit requires recorded C1.24C admission receipt');
  if(!appliedKeyRegistry.keys.some(k=>k.keyId===transaction.keyId&&k.status==='active')) throw new Error('C1.24F post-commit audit requires active admitted human public key');
  const out={schema:CINESWARM_C1_24F_AUDIT_SCHEMA,auditId,policyId:policy.policyId,transactionHash:transaction.transactionHash,authority:structuredClone(transaction.authority),keyId:transaction.keyId,auditedAt,result:'PASS',expected,observed,matches,exactAll:true,canonicalFullIndependentSourceRebuildProven:true,admissionReceiptRecorded:true,humanPublicKeyActive:true,multiFileAtomicityClaimed:false,commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; out.auditHash=digestJson(out); return out;
}

export function validateCanonicalAdmissionPostCommitAudit(v,{policy,transaction,transactionContext,appliedKeyRegistry,appliedC24Register,appliedAdmissionRegister}){
  if(v?.schema!==CINESWARM_C1_24F_AUDIT_SCHEMA) throw new Error('invalid C1.24F post-commit audit schema');
  const rebuilt=buildCanonicalAdmissionPostCommitAudit({policy,transaction,transactionContext,appliedKeyRegistry,appliedC24Register,appliedAdmissionRegister,auditedAt:v.auditedAt,auditId:v.auditId});
  if(rebuilt.auditHash!==v.auditHash) throw new Error('C1.24F post-commit audit self-hash mismatch'); exactHash(v,'auditHash','C1.24F post-commit audit'); boundary(v,'postCommitAudit'); return {valid:true};
}

export function buildCanonicalAdmissionCommitReceipt({policy,transaction,transactionContext,audit,auditContext,committedAt,receiptId='pn0001-c1-24f-canonical-admission-commit-receipt'}){
  validateCanonicalAdmissionPostCommitAudit(audit,auditContext); validateCanonicalAdmissionTransactionPlan(transaction,transactionContext); tm(committedAt,'committedAt'); tok(receiptId,'receiptId');
  const out={schema:CINESWARM_C1_24F_RECEIPT_SCHEMA,receiptId,policyId:policy.policyId,transactionHash:transaction.transactionHash,auditHash:audit.auditHash,authority:structuredClone(transaction.authority),keyId:transaction.keyId,committedAt,commitSuccessful:true,journaledRecoveryModel:true,multiFileAtomicityClaimed:false,canonicalFullIndependentSourceRebuildProven:true,admissionReceiptRecorded:true,humanPublicKeyActive:true,commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; out.receiptHash=digestJson(out); return out;
}

export function validateCanonicalAdmissionCommitReceipt(v,{policy,transaction,transactionContext,audit,auditContext}){
  if(v?.schema!==CINESWARM_C1_24F_RECEIPT_SCHEMA) throw new Error('invalid C1.24F commit receipt schema'); const rebuilt=buildCanonicalAdmissionCommitReceipt({policy,transaction,transactionContext,audit,auditContext,committedAt:v.committedAt,receiptId:v.receiptId}); if(rebuilt.receiptHash!==v.receiptHash) throw new Error('C1.24F commit receipt self-hash mismatch'); exactHash(v,'receiptHash','C1.24F commit receipt'); boundary(v,'commitReceipt'); return {valid:true};
}

function regPayload(v){return strip(v,['registerHash']);}
export function buildCanonicalAdmissionCommitRegister({policy,sourceC24CanonicalRegisterHash,entries=[],revision=entries.length,recordedAt,registerId='pn0001-c1-24f-canonical-admission-commit-register'}){
  validateCanonicalAdmissionCommitPolicy(policy); sha(sourceC24CanonicalRegisterHash,'sourceC24CanonicalRegisterHash'); tm(recordedAt,'recordedAt'); tok(registerId,'registerId'); let prev=null; for(const [i,e] of entries.entries()){if(e.index!==i+1||e.previousEntryHash!==prev) throw new Error('C1.24F commit register chain invalid'); exactHash(e,'entryHash','C1.24F commit register entry'); prev=e.entryHash;}
  const out={schema:CINESWARM_C1_24F_REGISTER_SCHEMA,registerId,policyId:policy.policyId,sourceC24CanonicalRegisterHash,revision,recordedAt,entries:structuredClone(entries),entryCount:entries.length,headHash:prev,successfulCommitCount:entries.filter(e=>e.event==='CANONICAL_ADMISSION_COMMIT_RECORDED').length,status:entries.length?'CANONICAL_COMMIT_HISTORY_PRESENT':'EMPTY_NO_CANONICAL_COMMIT_HISTORY',commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; out.registerHash=digestJson(regPayload(out)); return out;
}
export function validateCanonicalAdmissionCommitRegister(v,{policy}){if(v?.schema!==CINESWARM_C1_24F_REGISTER_SCHEMA) throw new Error('invalid C1.24F commit register schema'); const rebuilt=buildCanonicalAdmissionCommitRegister({policy,sourceC24CanonicalRegisterHash:v.sourceC24CanonicalRegisterHash,entries:v.entries,revision:v.revision,recordedAt:v.recordedAt,registerId:v.registerId}); if(rebuilt.registerHash!==v.registerHash) throw new Error('C1.24F commit register self-hash mismatch'); boundary(v,'commitRegister'); return {valid:true};}
export function appendCanonicalAdmissionCommitReceipt({register,receipt,receiptContext,policy,recordedAt}){validateCanonicalAdmissionCommitRegister(register,{policy}); validateCanonicalAdmissionCommitReceipt(receipt,receiptContext); if(register.entries.some(e=>e.receiptHash===receipt.receiptHash)) throw new Error('C1.24F commit receipt already registered'); const entry={index:register.entries.length+1,event:'CANONICAL_ADMISSION_COMMIT_RECORDED',receiptId:receipt.receiptId,receiptHash:receipt.receiptHash,transactionHash:receipt.transactionHash,auditHash:receipt.auditHash,canonicalFullIndependentSourceRebuildProven:true,recordedAt,previousEntryHash:register.headHash}; entry.entryHash=digestJson(strip(entry,['entryHash'])); return buildCanonicalAdmissionCommitRegister({policy,sourceC24CanonicalRegisterHash:register.sourceC24CanonicalRegisterHash,entries:[...register.entries,entry],revision:register.revision+1,recordedAt,registerId:register.registerId});}

export function classifyCanonicalAdmissionCommitState({technicalProofEarned=true,humanPublicKeyEnrolled=false,humanAdmissionSigned=false,admissionStagePresent=false,commitConfirmed=false,canonicalCommitted=false,postCommitAuditPassed=false,commitReceiptRecorded=false}){
  const blockers=[]; if(!technicalProofEarned) blockers.push('TECHNICAL_PROOF_NOT_EARNED'); if(!humanPublicKeyEnrolled) blockers.push('HUMAN_PUBLIC_KEY_NOT_ENROLLED'); if(!humanAdmissionSigned) blockers.push('HUMAN_ADMISSION_SIGNATURE_NOT_RECEIVED'); if(!admissionStagePresent) blockers.push('C1_24E_ADMISSION_STAGE_NOT_PRESENT'); if(!commitConfirmed) blockers.push('EXACT_COMMIT_DIGEST_NOT_REENTERED'); if(!canonicalCommitted) blockers.push('CANONICAL_COMMIT_NOT_EXECUTED'); if(!postCommitAuditPassed) blockers.push('POST_COMMIT_AUDIT_NOT_PASSED'); if(!commitReceiptRecorded) blockers.push('COMMIT_RECEIPT_NOT_RECORDED');
  let status='BLOCKED'; if(technicalProofEarned&&!humanPublicKeyEnrolled) status='AWAITING_HUMAN_KEY_CEREMONY'; else if(humanPublicKeyEnrolled&&!humanAdmissionSigned) status='AWAITING_HUMAN_ADMISSION_SIGNATURE'; else if(admissionStagePresent&&!commitConfirmed) status='AWAITING_EXPLICIT_CANONICAL_COMMIT_CONFIRMATION'; else if(commitConfirmed&&!canonicalCommitted) status='CANONICAL_COMMIT_AUTHORIZED_NOT_EXECUTED'; else if(canonicalCommitted&&!postCommitAuditPassed) status='CANONICAL_COMMITTED_AUDIT_REQUIRED'; else if(postCommitAuditPassed&&commitReceiptRecorded) status='CANONICAL_ADMISSION_COMMIT_VERIFIED';
  return {phase:'C1.24F',status,technicalProofEarned,humanPublicKeyEnrolled,humanAdmissionSigned,admissionStagePresent,commitConfirmed,canonicalCommitted,postCommitAuditPassed,commitReceiptRecorded,blockers,multiFileAtomicityClaimed:false,commitCanAutoConfirm:false,commitCanAutoApply:false,commitCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
}
