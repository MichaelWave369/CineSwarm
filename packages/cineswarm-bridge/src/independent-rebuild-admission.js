import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import {
  appendBuildInputArchive,
  appendIndependentRebuildReceipt,
  validateBuildInputArchive,
  validateHermeticDecoderRecipe,
  validateIndependentBuildPolicy,
  validateIndependentRebuildReceipt,
  validateIndependentRebuildRegister,
  validateIndependentRebuildReport,
} from './independent-source-rebuild.js';

export const CINESWARM_C1_24C_ADMISSION_POLICY_SCHEMA = 'parallax.cineswarm.independent-rebuild-admission-policy.c1.24c.v0.1';
export const CINESWARM_C1_24C_REVIEW_SCHEMA = 'parallax.cineswarm.independent-rebuild-admission-review.c1.24c.v0.1';
export const CINESWARM_C1_24C_PLAN_SCHEMA = 'parallax.cineswarm.independent-rebuild-canonical-admission-plan.c1.24c.v0.1';
export const CINESWARM_C1_24C_CEREMONY_SCHEMA = 'parallax.cineswarm.independent-rebuild-admission-ceremony.c1.24c.v0.1';
export const CINESWARM_C1_24C_RECEIPT_SCHEMA = 'parallax.cineswarm.independent-rebuild-admission-receipt.c1.24c.v0.1';
export const CINESWARM_C1_24C_REGISTER_SCHEMA = 'parallax.cineswarm.independent-rebuild-admission-register.c1.24c.v0.1';
export const C1_24C_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_24C_SIGNATURE_DOMAIN = 'PARALLAX-CINESWARM-C1.24C-INDEPENDENT-REBUILD-ADMISSION';

function req(v,l){ if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`); return v.trim(); }
function tok(v,l){ const s=req(v,l); if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`); return s; }
function sha(v,l){ const s=req(v,l); if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`); return s; }
function tm(v,l){ const s=req(v,l); const t=Date.parse(s); if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`); return {s,t}; }
function yes(v,l){ if(v!==true) throw new Error(`${l} must remain true`); }
function no(v,l){ if(v!==false) throw new Error(`${l} must remain false`); }
function strip(v,fields){ const x=structuredClone(v); for(const f of fields) delete x[f]; return x; }
function exactHash(v,field,label){ if(digestJson(strip(v,[field]))!==v[field]) throw new Error(`${label} self-hash mismatch`); }
function boundary(v,label){
  no(v.admissionCanAuthorizeRelease,`${label}.admissionCanAuthorizeRelease`);
  no(v.buildCanAuthorizeRelease,`${label}.buildCanAuthorizeRelease`);
  no(v.rebuildCanAuthorizeRelease,`${label}.rebuildCanAuthorizeRelease`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}

function proofObjects(proofContext){
  const { c24Policy, buildInputArchive, recipe, report, rebuildReceipt, proofRegister, buildLogSha256 } = proofContext;
  validateIndependentBuildPolicy(c24Policy);
  validateBuildInputArchive(buildInputArchive,{policy:c24Policy});
  validateHermeticDecoderRecipe(recipe,{policy:c24Policy,buildInputArchive});
  validateIndependentRebuildReport(report,{policy:c24Policy,buildInputArchive,recipe});
  validateIndependentRebuildReceipt(rebuildReceipt,{policy:c24Policy,report,reportContext:{policy:c24Policy,buildInputArchive,recipe}});
  validateIndependentRebuildRegister(proofRegister,{policy:c24Policy,sourceC23ReproDecodeRegisterHash:c24Policy.sourceC23ReproDecodeRegisterHash});
  if(proofRegister.fullIndependentSourceRebuildProven!==true) throw new Error('C1.24 proof register has not proven independent source rebuild');
  if(!proofRegister.entries.some(e=>e.archiveHash===buildInputArchive.archiveHash)) throw new Error('C1.24 proof register does not contain exact build input archive');
  if(!proofRegister.entries.some(e=>e.receiptHash===rebuildReceipt.receiptHash)) throw new Error('C1.24 proof register does not contain exact rebuild receipt');
  sha(buildLogSha256,'buildLogSha256');
  if(report.buildResult.buildLogSha256!==buildLogSha256) throw new Error('C1.24 proof build log hash drift');
  return { c24Policy, buildInputArchive, recipe, report, rebuildReceipt, proofRegister, buildLogSha256 };
}

export function validateIndependentRebuildAdmissionPolicy(policy,{proofContext,c24CanonicalRegister}){
  const proof=proofObjects(proofContext);
  if(!policy||policy.schema!==CINESWARM_C1_24C_ADMISSION_POLICY_SCHEMA) throw new Error('invalid C1.24C admission policy schema');
  for(const [v,l] of [[policy.policyId,'policyId'],[policy.sourceC24PolicyId,'sourceC24PolicyId'],[policy.episodeId,'episodeId'],[policy.sequenceId,'sequenceId'],[policy.networkId,'networkId']]) tok(v,l);
  if(policy.sourceC24PolicyId!==proof.c24Policy.policyId||policy.episodeId!==proof.c24Policy.episodeId||policy.sequenceId!==proof.c24Policy.sequenceId||policy.networkId!==proof.c24Policy.networkId) throw new Error('C1.24C policy lineage drift');
  validateIndependentRebuildRegister(c24CanonicalRegister,{policy:proof.c24Policy,sourceC23ReproDecodeRegisterHash:proof.c24Policy.sourceC23ReproDecodeRegisterHash});
  sha(policy.sourceCanonicalC24RegisterHash,'sourceCanonicalC24RegisterHash');
  if(policy.sourceCanonicalC24RegisterHash!==c24CanonicalRegister.registerHash) throw new Error('C1.24C canonical-before register hash drift');
  if(Number(policy.sourceCanonicalC24RegisterRevision)!==c24CanonicalRegister.revision) throw new Error('C1.24C canonical-before register revision drift');
  const expected={
    buildInputArchiveHash:proof.buildInputArchive.archiveHash,
    recipeHash:proof.recipe.recipeHash,
    reportHash:proof.report.reportHash,
    rebuildReceiptHash:proof.rebuildReceipt.receiptHash,
    proofRegisterHash:proof.proofRegister.registerHash,
    buildLogSha256:proof.buildLogSha256,
  };
  for(const [k,v] of Object.entries(expected)){ sha(policy.requiredProof?.[k],`requiredProof.${k}`); if(policy.requiredProof[k]!==v) throw new Error(`C1.24C required proof drift: ${k}`); }
  for(const k of ['requireExactC24Proof','requireHumanReview','requireHumanSignature','requireActiveSigningKey','requireExactCanonicalBeforeHash','requireCanonicalTransitionPreview','appendOnlyAdmissionRegister']) yes(policy[k],k);
  for(const k of ['autoAdmitIndependentProof','admissionCanAuthorizeRelease','buildCanAuthorizeRelease','rebuildCanAuthorizeRelease','publicRelease','relayDependency']) no(policy[k],k);
  if(policy.signatureAlgorithm!==C1_24C_SIGNATURE_ALGORITHM) throw new Error('C1.24C signature algorithm drift');
  return {valid:true};
}

export function buildIndependentRebuildAdmissionReview({policy,proofContext,c24CanonicalRegister,reviewId='c1-24c-independent-rebuild-admission-review',authority,decision,reason,reviewedAt,checks}){
  validateIndependentRebuildAdmissionPolicy(policy,{proofContext,c24CanonicalRegister});
  tok(reviewId,'reviewId'); tm(reviewedAt,'reviewedAt');
  if(authority?.kind!=='human') throw new Error('C1.24C admission review authority must be human');
  tok(authority.id,'authority.id'); if(authority.simulated!==false) throw new Error('C1.24C admission review must be real, not simulated');
  if(!['ADMIT_TO_CANONICAL','REJECT','HOLD'].includes(decision)) throw new Error('C1.24C review decision invalid');
  req(reason,'reason');
  const needed=['sourceAuthenticityAccepted','buildInputClosureAccepted','sourceBuildAccepted','authoritativeDecodeAccepted','fullOsIsolationLimitationAcknowledged','releaseBoundaryAcknowledged'];
  for(const k of needed){ if(typeof checks?.[k]!=='boolean') throw new Error(`checks.${k} must be boolean`); }
  if(decision==='ADMIT_TO_CANONICAL'&&needed.some(k=>checks[k]!==true)) throw new Error('C1.24C ADMIT review requires every review check to pass');
  const proof=proofObjects(proofContext);
  const out={schema:CINESWARM_C1_24C_REVIEW_SCHEMA,reviewId,policyId:policy.policyId,episodeId:policy.episodeId,sequenceId:policy.sequenceId,networkId:policy.networkId,reviewedAt,authority:structuredClone(authority),decision,reason,checks:structuredClone(checks),buildInputArchiveHash:proof.buildInputArchive.archiveHash,recipeHash:proof.recipe.recipeHash,reportHash:proof.report.reportHash,rebuildReceiptHash:proof.rebuildReceipt.receiptHash,proofRegisterHash:proof.proofRegister.registerHash,buildLogSha256:proof.buildLogSha256,canonicalRegisterBeforeHash:c24CanonicalRegister.registerHash,canonicalRegisterBeforeRevision:c24CanonicalRegister.revision,fullIndependentSourceRebuildProvenByMachine:true,fullOsIsolationProven:proof.rebuildReceipt.fullOsIsolationProven===true,admissionCanAuthorizeRelease:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.reviewHash=digestJson(out); return out;
}

export function validateIndependentRebuildAdmissionReview(v,{policy,proofContext,c24CanonicalRegister}){
  validateIndependentRebuildAdmissionPolicy(policy,{proofContext,c24CanonicalRegister});
  if(v?.schema!==CINESWARM_C1_24C_REVIEW_SCHEMA) throw new Error('invalid C1.24C admission review schema');
  if(v.policyId!==policy.policyId||v.episodeId!==policy.episodeId||v.sequenceId!==policy.sequenceId||v.networkId!==policy.networkId) throw new Error('C1.24C review lineage drift');
  tm(v.reviewedAt,'reviewedAt'); if(v.authority?.kind!=='human'||v.authority?.simulated!==false) throw new Error('C1.24C admission review must be real human authority'); tok(v.authority.id,'authority.id');
  if(!['ADMIT_TO_CANONICAL','REJECT','HOLD'].includes(v.decision)) throw new Error('C1.24C review decision invalid'); req(v.reason,'reason');
  const needed=['sourceAuthenticityAccepted','buildInputClosureAccepted','sourceBuildAccepted','authoritativeDecodeAccepted','fullOsIsolationLimitationAcknowledged','releaseBoundaryAcknowledged'];
  for(const k of needed){ if(typeof v.checks?.[k]!=='boolean') throw new Error(`checks.${k} must be boolean`); }
  if(v.decision==='ADMIT_TO_CANONICAL'&&needed.some(k=>v.checks[k]!==true)) throw new Error('C1.24C ADMIT review requires every review check to pass');
  const proof=proofObjects(proofContext);
  const expected=[['buildInputArchiveHash',proof.buildInputArchive.archiveHash],['recipeHash',proof.recipe.recipeHash],['reportHash',proof.report.reportHash],['rebuildReceiptHash',proof.rebuildReceipt.receiptHash],['proofRegisterHash',proof.proofRegister.registerHash],['buildLogSha256',proof.buildLogSha256],['canonicalRegisterBeforeHash',c24CanonicalRegister.registerHash]];
  for(const [k,val] of expected) if(v[k]!==val) throw new Error(`C1.24C review proof drift: ${k}`);
  if(v.canonicalRegisterBeforeRevision!==c24CanonicalRegister.revision) throw new Error('C1.24C review canonical revision drift');
  if(v.fullIndependentSourceRebuildProvenByMachine!==true) throw new Error('C1.24C review cannot admit an unproven machine result');
  boundary(v,'admissionReview'); exactHash(v,'reviewHash','C1.24C admission review'); return {valid:true};
}

export function buildIndependentRebuildCanonicalAdmissionPlan({policy,proofContext,c24CanonicalRegister,review,archiveRecordedAt,receiptRecordedAt,planId='c1-24c-canonical-admission-plan'}){
  validateIndependentRebuildAdmissionReview(review,{policy,proofContext,c24CanonicalRegister});
  if(review.decision!=='ADMIT_TO_CANONICAL') throw new Error('C1.24C canonical admission plan requires ADMIT_TO_CANONICAL review');
  tok(planId,'planId'); const a=tm(archiveRecordedAt,'archiveRecordedAt'); const r=tm(receiptRecordedAt,'receiptRecordedAt'); const reviewed=tm(review.reviewedAt,'reviewedAt');
  if(a.t<reviewed.t||r.t<a.t) throw new Error('C1.24C canonical admission chronology invalid');
  const proof=proofObjects(proofContext); const regCtx={policy:proof.c24Policy,sourceC23ReproDecodeRegisterHash:proof.c24Policy.sourceC23ReproDecodeRegisterHash};
  let target=appendBuildInputArchive({register:c24CanonicalRegister,buildInputArchive:proof.buildInputArchive,archiveContext:{policy:proof.c24Policy},registerContext:regCtx,recordedAt:archiveRecordedAt});
  target=appendIndependentRebuildReceipt({register:target,receipt:proof.rebuildReceipt,receiptContext:{policy:proof.c24Policy,report:proof.report,reportContext:{policy:proof.c24Policy,buildInputArchive:proof.buildInputArchive,recipe:proof.recipe}},registerContext:regCtx,recordedAt:receiptRecordedAt});
  const out={schema:CINESWARM_C1_24C_PLAN_SCHEMA,planId,policyId:policy.policyId,reviewHash:review.reviewHash,canonicalRegisterBeforeHash:c24CanonicalRegister.registerHash,canonicalRegisterBeforeRevision:c24CanonicalRegister.revision,archiveRecordedAt,receiptRecordedAt,buildInputArchiveHash:proof.buildInputArchive.archiveHash,rebuildReceiptHash:proof.rebuildReceipt.receiptHash,expectedCanonicalRegisterAfterHash:target.registerHash,expectedCanonicalRegisterAfterRevision:target.revision,expectedCanonicalFullIndependentSourceRebuildProven:true,admissionCanAuthorizeRelease:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.planHash=digestJson(out); return out;
}

export function validateIndependentRebuildCanonicalAdmissionPlan(v,{policy,proofContext,c24CanonicalRegister,review}){
  const rebuilt=buildIndependentRebuildCanonicalAdmissionPlan({policy,proofContext,c24CanonicalRegister,review,archiveRecordedAt:v.archiveRecordedAt,receiptRecordedAt:v.receiptRecordedAt,planId:v.planId});
  if(rebuilt.planHash!==v.planHash) throw new Error('C1.24C admission plan self-hash mismatch');
  if(rebuilt.expectedCanonicalRegisterAfterHash!==v.expectedCanonicalRegisterAfterHash||rebuilt.expectedCanonicalRegisterAfterRevision!==v.expectedCanonicalRegisterAfterRevision) throw new Error('C1.24C admission plan target drift');
  boundary(v,'admissionPlan'); return {valid:true};
}

function unsignedCeremonyPayload(v){ return strip(v,['ceremonyDigest','signatureBase64','ceremonyHash']); }
function ceremonyMessage(digest){ return `${C1_24C_SIGNATURE_DOMAIN}\n${digest}`; }
function findActiveKey(keyRegistry,keyId,authorityId,signedAt){
  validateSigningKeyRegistry(keyRegistry); const key=keyRegistry.keys.find(k=>k.keyId===keyId); if(!key) throw new Error(`C1.24C signing key ${keyId} is not registered`); if(key.status!=='active') throw new Error(`C1.24C signing key ${keyId} is not active`); if(key.authority?.kind!=='human'||key.authority.id!==authorityId) throw new Error('C1.24C signing key authority mismatch');
  const s=tm(signedAt,'signedAt'); const from=tm(key.validFrom,'key.validFrom'); if(s.t<from.t) throw new Error('C1.24C ceremony signed before key validity'); if(key.validUntil&&s.t>=tm(key.validUntil,'key.validUntil').t) throw new Error('C1.24C ceremony signed after key validity'); return key;
}

export function buildIndependentRebuildAdmissionCeremonyDraft({policy,proofContext,c24CanonicalRegister,review,plan,keyId,signedAt,ceremonyId='c1-24c-independent-rebuild-admission-ceremony'}){
  validateIndependentRebuildCanonicalAdmissionPlan(plan,{policy,proofContext,c24CanonicalRegister,review}); if(review.decision!=='ADMIT_TO_CANONICAL') throw new Error('C1.24C admission ceremony requires ADMIT review'); tok(keyId,'keyId'); tok(ceremonyId,'ceremonyId'); const s=tm(signedAt,'signedAt'); if(s.t<tm(review.reviewedAt,'reviewedAt').t) throw new Error('C1.24C ceremony cannot precede review'); if(s.t>tm(plan.archiveRecordedAt,'archiveRecordedAt').t) throw new Error('C1.24C ceremony must be signed before canonical transition');
  return {schema:CINESWARM_C1_24C_CEREMONY_SCHEMA,ceremonyId,policyId:policy.policyId,reviewHash:review.reviewHash,planHash:plan.planHash,canonicalRegisterBeforeHash:c24CanonicalRegister.registerHash,expectedCanonicalRegisterAfterHash:plan.expectedCanonicalRegisterAfterHash,buildInputArchiveHash:plan.buildInputArchiveHash,rebuildReceiptHash:plan.rebuildReceiptHash,keyId,authority:{kind:'human',id:review.authority.id},signedAt,signatureAlgorithm:C1_24C_SIGNATURE_ALGORITHM,admissionAuthorized:false,ceremonyDigest:null,signatureBase64:null,admissionCanAuthorizeRelease:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
}

export function signIndependentRebuildAdmissionCeremony({draft,privateKeyPem,keyRegistry,policy,proofContext,c24CanonicalRegister,review,plan}){
  const expected=buildIndependentRebuildAdmissionCeremonyDraft({policy,proofContext,c24CanonicalRegister,review,plan,keyId:draft.keyId,signedAt:draft.signedAt,ceremonyId:draft.ceremonyId}); if(digestJson(expected)!==digestJson(draft)) throw new Error('C1.24C ceremony draft drift');
  if(!privateKeyPem||!String(privateKeyPem).includes('BEGIN PRIVATE KEY')) throw new Error('C1.24C external Ed25519 private key is required'); findActiveKey(keyRegistry,draft.keyId,review.authority.id,draft.signedAt);
  const out=structuredClone(draft); out.admissionAuthorized=true; out.ceremonyDigest=digestJson(unsignedCeremonyPayload(out)); out.signatureBase64=cryptoSign(null,Buffer.from(ceremonyMessage(out.ceremonyDigest)),privateKeyPem).toString('base64'); out.ceremonyHash=digestJson(strip(out,['ceremonyHash'])); return out;
}

export function validateIndependentRebuildAdmissionCeremony(v,{keyRegistry,policy,proofContext,c24CanonicalRegister,review,plan}){
  if(v?.schema!==CINESWARM_C1_24C_CEREMONY_SCHEMA) throw new Error('invalid C1.24C admission ceremony schema');
  validateIndependentRebuildCanonicalAdmissionPlan(plan,{policy,proofContext,c24CanonicalRegister,review});
  if(v.policyId!==policy.policyId||v.reviewHash!==review.reviewHash||v.planHash!==plan.planHash||v.canonicalRegisterBeforeHash!==c24CanonicalRegister.registerHash||v.expectedCanonicalRegisterAfterHash!==plan.expectedCanonicalRegisterAfterHash||v.buildInputArchiveHash!==plan.buildInputArchiveHash||v.rebuildReceiptHash!==plan.rebuildReceiptHash) throw new Error('C1.24C ceremony lineage drift');
  if(v.signatureAlgorithm!==C1_24C_SIGNATURE_ALGORITHM||v.admissionAuthorized!==true) throw new Error('C1.24C admission ceremony is not authorized'); if(v.authority?.kind!=='human'||v.authority.id!==review.authority.id) throw new Error('C1.24C ceremony authority drift');
  const key=findActiveKey(keyRegistry,v.keyId,v.authority.id,v.signedAt); if(v.ceremonyDigest!==digestJson(unsignedCeremonyPayload(v))) throw new Error('C1.24C ceremony digest mismatch');
  if(!cryptoVerify(null,Buffer.from(ceremonyMessage(v.ceremonyDigest)),key.publicKeyPem,Buffer.from(req(v.signatureBase64,'signatureBase64'),'base64'))) throw new Error('C1.24C admission ceremony signature verification failed');
  exactHash(v,'ceremonyHash','C1.24C admission ceremony'); boundary(v,'admissionCeremony'); return {valid:true};
}

export function applyIndependentRebuildCanonicalAdmission({ceremony,keyRegistry,policy,proofContext,c24CanonicalRegister,review,plan}){
  validateIndependentRebuildAdmissionCeremony(ceremony,{keyRegistry,policy,proofContext,c24CanonicalRegister,review,plan});
  const proof=proofObjects(proofContext); const regCtx={policy:proof.c24Policy,sourceC23ReproDecodeRegisterHash:proof.c24Policy.sourceC23ReproDecodeRegisterHash};
  let target=appendBuildInputArchive({register:c24CanonicalRegister,buildInputArchive:proof.buildInputArchive,archiveContext:{policy:proof.c24Policy},registerContext:regCtx,recordedAt:plan.archiveRecordedAt});
  target=appendIndependentRebuildReceipt({register:target,receipt:proof.rebuildReceipt,receiptContext:{policy:proof.c24Policy,report:proof.report,reportContext:{policy:proof.c24Policy,buildInputArchive:proof.buildInputArchive,recipe:proof.recipe}},registerContext:regCtx,recordedAt:plan.receiptRecordedAt});
  if(target.registerHash!==plan.expectedCanonicalRegisterAfterHash||target.revision!==plan.expectedCanonicalRegisterAfterRevision||target.fullIndependentSourceRebuildProven!==true) throw new Error('C1.24C canonical transition did not produce signed target register'); return target;
}

export function buildIndependentRebuildAdmissionReceipt({policy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore,review,plan,c24CanonicalRegisterAfter,issuedAt,receiptId='c1-24c-independent-rebuild-admission-receipt'}){
  validateIndependentRebuildAdmissionCeremony(ceremony,{keyRegistry,policy,proofContext,c24CanonicalRegister:c24CanonicalRegisterBefore,review,plan}); tm(issuedAt,'issuedAt'); tok(receiptId,'receiptId');
  validateIndependentRebuildRegister(c24CanonicalRegisterAfter,{policy:proofContext.c24Policy,sourceC23ReproDecodeRegisterHash:proofContext.c24Policy.sourceC23ReproDecodeRegisterHash}); if(c24CanonicalRegisterAfter.registerHash!==plan.expectedCanonicalRegisterAfterHash||c24CanonicalRegisterAfter.fullIndependentSourceRebuildProven!==true) throw new Error('C1.24C admission receipt requires exact admitted canonical register');
  const out={schema:CINESWARM_C1_24C_RECEIPT_SCHEMA,receiptId,policyId:policy.policyId,ceremonyHash:ceremony.ceremonyHash,reviewHash:review.reviewHash,planHash:plan.planHash,authority:structuredClone(ceremony.authority),keyId:ceremony.keyId,issuedAt,canonicalRegisterBeforeHash:c24CanonicalRegisterBefore.registerHash,canonicalRegisterAfterHash:c24CanonicalRegisterAfter.registerHash,canonicalRegisterAfterRevision:c24CanonicalRegisterAfter.revision,buildInputArchiveHash:plan.buildInputArchiveHash,rebuildReceiptHash:plan.rebuildReceiptHash,proofRegisterHash:proofContext.proofRegister.registerHash,canonicalFullIndependentSourceRebuildProven:true,fullOsIsolationProven:proofContext.rebuildReceipt.fullOsIsolationProven===true,admissionCanAuthorizeRelease:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; out.receiptHash=digestJson(out); return out;
}

export function validateIndependentRebuildAdmissionReceipt(v,{policy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore,review,plan,c24CanonicalRegisterAfter}){
  const rebuilt=buildIndependentRebuildAdmissionReceipt({policy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore,review,plan,c24CanonicalRegisterAfter,issuedAt:v.issuedAt,receiptId:v.receiptId}); if(rebuilt.receiptHash!==v.receiptHash) throw new Error('C1.24C admission receipt self-hash mismatch'); boundary(v,'admissionReceipt'); return {valid:true};
}

function regPayload(v){ return strip(v,['registerHash']); }
export function buildIndependentRebuildAdmissionRegister({policy,sourceCanonicalC24RegisterHash,entries=[],revision=entries.length,recordedAt,registerId='c1-24c-independent-rebuild-admission-register'}){
  sha(sourceCanonicalC24RegisterHash,'sourceCanonicalC24RegisterHash'); if(sourceCanonicalC24RegisterHash!==policy.sourceCanonicalC24RegisterHash) throw new Error('C1.24C admission register source hash drift'); tm(recordedAt,'recordedAt'); tok(registerId,'registerId'); let prev=null; for(const [i,e] of entries.entries()){ if(e.index!==i+1||e.previousEntryHash!==prev) throw new Error('C1.24C admission register chain invalid'); exactHash(e,'entryHash','C1.24C admission register entry'); prev=e.entryHash; }
  const out={schema:CINESWARM_C1_24C_REGISTER_SCHEMA,registerId,policyId:policy.policyId,sourceC24PolicyId:policy.sourceC24PolicyId,episodeId:policy.episodeId,sequenceId:policy.sequenceId,networkId:policy.networkId,sourceCanonicalC24RegisterHash,revision,recordedAt,entries:structuredClone(entries),entryCount:entries.length,headHash:prev,admissionReceiptCount:entries.filter(e=>e.event==='INDEPENDENT_REBUILD_CANONICAL_ADMISSION_RECORDED').length,status:entries.length?'CANONICAL_ADMISSION_HISTORY_PRESENT':'EMPTY_NO_CANONICAL_ADMISSION_HISTORY',admissionCanAuthorizeRelease:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; out.registerHash=digestJson(regPayload(out)); return out;
}
export function validateIndependentRebuildAdmissionRegister(v,{policy}){ if(v?.schema!==CINESWARM_C1_24C_REGISTER_SCHEMA) throw new Error('invalid C1.24C admission register schema'); const rebuilt=buildIndependentRebuildAdmissionRegister({policy,sourceCanonicalC24RegisterHash:v.sourceCanonicalC24RegisterHash,entries:v.entries,revision:v.revision,recordedAt:v.recordedAt,registerId:v.registerId}); if(rebuilt.registerHash!==v.registerHash) throw new Error('C1.24C admission register self-hash mismatch'); boundary(v,'admissionRegister'); return {valid:true}; }
export function appendIndependentRebuildAdmissionReceipt({register,receipt,receiptContext,policy,recordedAt}){ validateIndependentRebuildAdmissionRegister(register,{policy}); validateIndependentRebuildAdmissionReceipt(receipt,receiptContext); if(register.entries.some(e=>e.receiptHash===receipt.receiptHash)) throw new Error('C1.24C admission receipt already registered'); const entry={index:register.entries.length+1,event:'INDEPENDENT_REBUILD_CANONICAL_ADMISSION_RECORDED',receiptId:receipt.receiptId,receiptHash:receipt.receiptHash,canonicalRegisterAfterHash:receipt.canonicalRegisterAfterHash,canonicalRegisterAfterRevision:receipt.canonicalRegisterAfterRevision,fullIndependentSourceRebuildProven:true,recordedAt,previousEntryHash:register.headHash}; entry.entryHash=digestJson(strip(entry,['entryHash'])); return buildIndependentRebuildAdmissionRegister({policy,sourceCanonicalC24RegisterHash:register.sourceCanonicalC24RegisterHash,entries:[...register.entries,entry],revision:register.revision+1,recordedAt,registerId:register.registerId}); }

export function classifyIndependentRebuildAdmissionState({policy,proofContext,c24CanonicalRegister,admissionRegister,keyRegistry}){
  validateIndependentRebuildAdmissionPolicy(policy,{proofContext,c24CanonicalRegister}); validateIndependentRebuildAdmissionRegister(admissionRegister,{policy}); validateSigningKeyRegistry(keyRegistry);
  const proof=proofObjects(proofContext); const technicalProofEarned=proof.rebuildReceipt.fullIndependentSourceRebuildProven===true&&proof.proofRegister.fullIndependentSourceRebuildProven===true; const activeHumanKeys=keyRegistry.keys.filter(k=>k.status==='active'&&k.authority?.kind==='human').length; const canonicalAdmitted=c24CanonicalRegister.fullIndependentSourceRebuildProven===true; const admissionRecorded=admissionRegister.admissionReceiptCount>0;
  const blockers=[]; if(!technicalProofEarned) blockers.push('TECHNICAL_INDEPENDENT_REBUILD_PROOF_NOT_EARNED'); if(activeHumanKeys===0) blockers.push('NO_ACTIVE_HUMAN_SIGNING_KEY'); if(!admissionRecorded) blockers.push('NO_HUMAN_ADMISSION_RECEIPT'); if(!canonicalAdmitted) blockers.push('CANONICAL_C1_24_NOT_ADMITTED');
  return {phase:'C1.24C',status:technicalProofEarned&&!canonicalAdmitted?'PENDING_HUMAN_ADMISSION':canonicalAdmitted&&admissionRecorded?'CANONICAL_INDEPENDENT_REBUILD_ADMITTED':'BLOCKED',technicalProofEarned,activeHumanSigningKeys:activeHumanKeys,admissionReceipts:admissionRegister.admissionReceiptCount,canonicalRegisterRevision:c24CanonicalRegister.revision,canonicalFullIndependentSourceRebuildProven:canonicalAdmitted,blockers,admissionCanAuthorizeRelease:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
}
