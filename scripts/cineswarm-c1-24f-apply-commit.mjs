#!/usr/bin/env node
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { digestJson } from '../packages/cineswarm-bridge/src/authorization-seal.js';
import {
  buildCanonicalAdmissionCommitConfirmation,
  buildCanonicalAdmissionTransactionPlan,
  buildCanonicalAdmissionPostCommitAudit,
  buildCanonicalAdmissionCommitReceipt,
  appendCanonicalAdmissionCommitReceipt,
  validateCanonicalAdmissionCommitPreview,
} from '../packages/cineswarm-bridge/src/canonical-admission-commit.js';
import { loadCeremonyDirectory } from './lib/c1-24f-context.mjs';

const args=process.argv.slice(2); const arg=(n)=>{const i=args.indexOf(`--${n}`); if(i<0||!args[i+1]) throw new Error(`missing --${n}`); return args[i+1];};
if(arg('apply-mode')!=='HUMAN_CONFIRMED_CANONICAL_COMMIT') throw new Error('C1.24F apply requires --apply-mode HUMAN_CONFIRMED_CANONICAL_COMMIT');
const ceremonyDir=resolve(arg('ceremony-dir')); const canonicalRoot=resolve(arg('canonical-root')); const previewPath=resolve(arg('preview')); const txDir=resolve(arg('transaction-dir'));
const enteredDigest=arg('commit-digest'); const authorityId=arg('authority-id'); const confirmedAt=arg('confirmed-at'); const preparedAt=arg('transaction-prepared-at'); const auditedAt=arg('audited-at'); const committedAt=arg('committed-at'); const recordedAt=arg('recorded-at');
if(existsSync(resolve(txDir,'JOURNAL.json'))) throw new Error('C1.24F transaction directory already contains JOURNAL.json; use recovery instead of replaying apply');
mkdirSync(txDir,{recursive:true}); mkdirSync(resolve(txDir,'backups'),{recursive:true}); mkdirSync(resolve(txDir,'staged'),{recursive:true});
const J=(p)=>JSON.parse(readFileSync(resolve(p),'utf8')); const c=loadCeremonyDirectory(ceremonyDir,canonicalRoot); const preview=J(previewPath);
const previewContext={policy:c.policy,keyStage:c.keyStage,admissionStage:c.admissionStage,keyStageContext:c.keyStageContext,admissionStageContext:c.admissionStageContext,currentKeyRegistry:c.keyRegistry,currentC24Register:c.c24Register,currentAdmissionRegister:c.admissionRegister};
validateCanonicalAdmissionCommitPreview(preview,previewContext);
const confirmation=buildCanonicalAdmissionCommitConfirmation({policy:c.policy,preview,previewContext,enteredCommitIntentDigest:enteredDigest,authorityId,confirmedAt});
const transaction=buildCanonicalAdmissionTransactionPlan({policy:c.policy,preview,previewContext,confirmation,preparedAt});
const transactionContext={policy:c.policy,preview,previewContext,confirmation};
const targetDefs=[
  {name:'keyRegistry',logical:preview.targets.keyRegistry,obj:c.keyStage.stagedKeyRegistry,expectedBefore:preview.before.keyRegistryHash,expectedAfter:preview.after.keyRegistryHash,semantic:(x)=>digestJson(x)},
  {name:'c24Register',logical:preview.targets.c24Register,obj:c.admissionStage.proposedCanonicalRegister,expectedBefore:preview.before.c24RegisterHash,expectedAfter:preview.after.c24RegisterHash,semantic:(x)=>x.registerHash},
  {name:'admissionRegister',logical:preview.targets.admissionRegister,obj:c.admissionStage.proposedAdmissionRegister,expectedBefore:preview.before.admissionRegisterHash,expectedAfter:preview.after.admissionRegisterHash,semantic:(x)=>x.registerHash},
];
function fileSha(p){return createHash('sha256').update(readFileSync(p)).digest('hex');}
function fsyncDir(p){try{const fd=openSync(p,'r');fsyncSync(fd);closeSync(fd);}catch{}}
function writeJsonDurable(p,obj){mkdirSync(dirname(p),{recursive:true});const tmp=`${p}.tmp-${process.pid}`;const fd=openSync(tmp,'w',0o600);try{writeFileSync(fd,JSON.stringify(obj,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,p);fsyncDir(dirname(p));}
function semanticFile(def,p){return def.semantic(J(p));}
function writeJournal(state,extra={}){const out={schema:'parallax.cineswarm.canonical-admission-transaction-journal.c1.24f.v0.1',transactionId:transaction.transactionId,transactionHash:transaction.transactionHash,state,updatedAt:new Date().toISOString(),canonicalRoot,ceremonyDir,previewPath,committedTargets:journalCommitted.slice(),...extra,multiFileAtomicityClaimed:false,publicRelease:false,relayDependency:false}; out.journalHash=digestJson(out); writeJsonDurable(resolve(txDir,'JOURNAL.json'),out); return out;}
const journalCommitted=[];
for(const def of targetDefs){const target=resolve(canonicalRoot,def.logical); if(!existsSync(target)) throw new Error(`C1.24F canonical target missing: ${def.logical}`); const got=semanticFile(def,target); if(got!==def.expectedBefore) throw new Error(`C1.24F before-hash drift at ${def.logical}`); const backup=resolve(txDir,'backups',`${def.name}.json`); copyFileSync(target,backup); fsyncDir(dirname(backup)); if(semanticFile(def,backup)!==def.expectedBefore) throw new Error(`C1.24F backup verification failed for ${def.logical}`); const staged=resolve(txDir,'staged',`${def.name}.json`); writeJsonDurable(staged,def.obj); if(semanticFile(def,staged)!==def.expectedAfter) throw new Error(`C1.24F staged after-hash verification failed for ${def.logical}`); }
writeJsonDurable(resolve(txDir,'PREVIEW.json'),preview); writeJsonDurable(resolve(txDir,'CONFIRMATION.json'),confirmation); writeJsonDurable(resolve(txDir,'TRANSACTION.json'),transaction); writeJsonDurable(resolve(txDir,'KEY_STAGE.json'),c.keyStage); writeJsonDurable(resolve(txDir,'ADMISSION_STAGE.json'),c.admissionStage); writeJournal('PREPARED');
try{
  for(const def of targetDefs){const target=resolve(canonicalRoot,def.logical); writeJsonDurable(target,def.obj); const got=semanticFile(def,target); if(got!==def.expectedAfter) throw new Error(`C1.24F post-write verification failed for ${def.logical}`); journalCommitted.push(def.name); writeJournal('COMMITTING',{lastCommitted:def.name});}
}catch(err){
  for(const def of [...targetDefs].reverse()){const backup=resolve(txDir,'backups',`${def.name}.json`);const target=resolve(canonicalRoot,def.logical);if(existsSync(backup)){copyFileSync(backup,target);fsyncDir(dirname(target));}}
  const rollbackOk=targetDefs.every(def=>semanticFile(def,resolve(canonicalRoot,def.logical))===def.expectedBefore); writeJournal(rollbackOk?'ROLLED_BACK':'ROLLBACK_FAILED_MANUAL_INTERVENTION_REQUIRED',{error:String(err?.message||err),rollbackOk}); throw err;
}
writeJournal('CANONICAL_FILES_COMMITTED');
const applied=loadCeremonyDirectory(ceremonyDir,canonicalRoot);
const audit=buildCanonicalAdmissionPostCommitAudit({policy:c.policy,transaction,transactionContext,appliedKeyRegistry:applied.keyRegistry,appliedC24Register:applied.c24Register,appliedAdmissionRegister:applied.admissionRegister,auditedAt});
const auditContext={policy:c.policy,transaction,transactionContext,appliedKeyRegistry:applied.keyRegistry,appliedC24Register:applied.c24Register,appliedAdmissionRegister:applied.admissionRegister};
const receipt=buildCanonicalAdmissionCommitReceipt({policy:c.policy,transaction,transactionContext,audit,auditContext,committedAt});
writeJsonDurable(resolve(txDir,'POST_COMMIT_AUDIT.json'),audit); writeJsonDurable(resolve(txDir,'COMMIT_RECEIPT.json'),receipt); writeJournal('CANONICAL_COMMITTED_AUDIT_PASSED_REGISTER_PENDING',{auditHash:audit.auditHash,receiptHash:receipt.receiptHash});
const receiptContext={policy:c.policy,transaction,transactionContext,audit,auditContext};
const nextCommitRegister=appendCanonicalAdmissionCommitReceipt({register:c.commitRegister,receipt,receiptContext,policy:c.policy,recordedAt});
const commitRegisterPath=resolve(canonicalRoot,'fixtures/cineswarm/pn-0001-c1-24f-canonical-admission-commit-register.json'); writeJsonDurable(commitRegisterPath,nextCommitRegister);
if(J(commitRegisterPath).registerHash!==nextCommitRegister.registerHash) throw new Error('C1.24F commit register post-write verification failed');
writeJsonDurable(resolve(txDir,'COMMIT_REGISTER_AFTER.json'),nextCommitRegister); const finalJournal=writeJournal('COMMITTED',{auditHash:audit.auditHash,receiptHash:receipt.receiptHash,commitRegisterHash:nextCommitRegister.registerHash});
console.log(JSON.stringify({status:'COMMITTED',transactionHash:transaction.transactionHash,auditHash:audit.auditHash,receiptHash:receipt.receiptHash,commitRegisterHash:nextCommitRegister.registerHash,canonicalFullIndependentSourceRebuildProven:true,multiFileAtomicityClaimed:false,journalHash:finalJournal.journalHash,canonicalFileSha256:{keyRegistry:fileSha(resolve(canonicalRoot,preview.targets.keyRegistry)),c24Register:fileSha(resolve(canonicalRoot,preview.targets.c24Register)),admissionRegister:fileSha(resolve(canonicalRoot,preview.targets.admissionRegister))},publicRelease:false,relayDependency:false},null,2));
