import { digestJson } from './authorization-seal.js';
import { validateDecodeAccessPolicy, validateDecodeEnvironmentSnapshot, validateCompatibilityMatrix } from './decode-environment-access.js';

export const CINESWARM_REPRO_DECODE_POLICY_SCHEMA = 'parallax.cineswarm.repro-decode-policy.c1.23.v0.1';
export const CINESWARM_DECODER_SBOM_SCHEMA = 'parallax.cineswarm.decoder-sbom.c1.23.v0.1';
export const CINESWARM_REBUILD_RECIPE_SCHEMA = 'parallax.cineswarm.decoder-rebuild-recipe.c1.23.v0.1';
export const CINESWARM_DECODE_CAPSULE_SCHEMA = 'parallax.cineswarm.decode-capsule.c1.23.v0.1';
export const CINESWARM_RECONSTRUCTION_REPORT_SCHEMA = 'parallax.cineswarm.decode-reconstruction-report.c1.23.v0.1';
export const CINESWARM_REPRO_DECODE_REGISTER_SCHEMA = 'parallax.cineswarm.repro-decode-register.c1.23.v0.1';

function req(v,l){ if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`); return v.trim(); }
function tok(v,l){ const s=req(v,l); if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`); return s; }
function sha(v,l){ const s=req(v,l); if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`); return s; }
function tm(v,l){ const s=req(v,l); const t=Date.parse(s); if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`); return {s,t}; }
function yes(v,l){ if(v!==true) throw new Error(`${l} must remain true`); }
function no(v,l){ if(v!==false) throw new Error(`${l} must remain false`); }
function strip(v, fields){ const x=structuredClone(v); for(const f of fields) delete x[f]; return x; }
function exactHash(v, hashField, label){ if(digestJson(strip(v,[hashField]))!==v[hashField]) throw new Error(`${label} self-hash mismatch`); }
function unique(arr,label,keyFn=(x)=>x){ if(!Array.isArray(arr)) throw new Error(`${label} must be an array`); const seen=new Set(); for(const x of arr){ const k=keyFn(x); if(seen.has(k)) throw new Error(`${label} contains duplicate ${k}`); seen.add(k); } }
function boundary(v,label){
  no(v.capsuleCanAuthorizeRelease,`${label}.capsuleCanAuthorizeRelease`);
  no(v.reconstructionCanAuthorizeRelease,`${label}.reconstructionCanAuthorizeRelease`);
  no(v.originalDeleteAuthorized,`${label}.originalDeleteAuthorized`);
  no(v.preservationDerivativeDeleteAuthorized,`${label}.preservationDerivativeDeleteAuthorized`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}

export function validateReproDecodePolicy(policy){
  if(!policy||policy.schema!==CINESWARM_REPRO_DECODE_POLICY_SCHEMA) throw new Error('invalid C1.23 policy schema');
  for(const [v,l] of [[policy.policyId,'policyId'],[policy.c22PolicyId,'c22PolicyId'],[policy.episodeId,'episodeId'],[policy.sequenceId,'sequenceId'],[policy.networkId,'networkId']]) tok(v,l);
  if(!Number.isInteger(policy.maxSbomAgeDays)||policy.maxSbomAgeDays<1||policy.maxSbomAgeDays>3650) throw new Error('maxSbomAgeDays invalid');
  if(!Number.isInteger(policy.maxReconstructionProofAgeDays)||policy.maxReconstructionProofAgeDays<1||policy.maxReconstructionProofAgeDays>3650) throw new Error('maxReconstructionProofAgeDays invalid');
  for(const k of ['requireC22SnapshotValidation','requireExecutableHashes','requireLinkedLibraryHashes','requirePackageInventory','requireRebuildRecipe','requireFreshWorkingDirectory','requireIsolatedPath','requireOriginalFullDecode','requirePreservationDerivativeFullDecode','requireCapabilityFingerprintMatch','requireExactMediaHashes','appendOnlyReproDecodeRegister','originalStillRequired','preservationDerivativeStillRequired']) yes(policy[k],k);
  for(const k of ['allowNetworkFetchDuringLocalProof','allowCredentialCapture','claimFullIndependentSourceRebuildFromLocalProof','autoReplaceDecoderEnvironment','capsuleCanAuthorizeRelease','reconstructionCanAuthorizeRelease','originalDeleteAuthorized','preservationDerivativeDeleteAuthorized','publicRelease','relayDependency']) no(policy[k],k);
  if(policy.localProofScope!=='isolated-runtime-reconstruction-not-full-os-source-rebuild') throw new Error('localProofScope drift');
  return {valid:true};
}

function validateComponent(c,label){
  tok(c.componentId,`${label}.componentId`); req(c.name,`${label}.name`); req(c.version,`${label}.version`); req(c.path,`${label}.path`); sha(c.sha256,`${label}.sha256`);
  if(c.kind!=='executable'&&c.kind!=='shared-library') throw new Error(`${label}.kind invalid`);
  if(c.package){ req(c.package.name,`${label}.package.name`); req(c.package.version,`${label}.package.version`); }
}
export function buildDecoderSbom({policy, environmentSnapshot, os, components, packages, capturedAt, sbomId='decoder-sbom'}){
  validateReproDecodePolicy(policy); tok(sbomId,'sbomId'); validateDecodeEnvironmentSnapshot(environmentSnapshot,{policy:policy.c22Policy}); tm(capturedAt,'capturedAt');
  if(environmentSnapshot.snapshotHash!==policy.sourceEnvironmentSnapshotHash) throw new Error('SBOM source environment snapshot drift');
  req(os.id,'os.id'); req(os.versionId,'os.versionId'); req(os.prettyName,'os.prettyName');
  if(!Array.isArray(components)||components.length<2) throw new Error('SBOM requires components');
  unique(components,'components',x=>x.componentId); components.forEach((c,i)=>validateComponent(c,`components[${i}]`));
  const exeNames=new Set(components.filter(c=>c.kind==='executable').map(c=>c.name));
  if(!exeNames.has('ffmpeg')||!exeNames.has('ffprobe')) throw new Error('SBOM must include ffmpeg and ffprobe executables');
  if(!components.some(c=>c.kind==='shared-library')) throw new Error('SBOM must include linked shared libraries');
  if(!Array.isArray(packages)||!packages.length) throw new Error('SBOM requires package inventory');
  unique(packages,'packages',p=>`${p.name}@${p.version}`);
  for(const [i,p] of packages.entries()){ req(p.name,`packages[${i}].name`); req(p.version,`packages[${i}].version`); }
  const out={schema:CINESWARM_DECODER_SBOM_SCHEMA,sbomId,policyId:policy.policyId,environmentSnapshotHash:environmentSnapshot.snapshotHash,capabilityHash:environmentSnapshot.capabilityHash,os:structuredClone(os),components:structuredClone(components),packages:structuredClone(packages),capturedAt,credentialsCaptured:false,networkFetchUsed:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.sbomHash=digestJson(out); return out;
}
export function validateDecoderSbom(v,{policy,environmentSnapshot}){
  validateReproDecodePolicy(policy); validateDecodeEnvironmentSnapshot(environmentSnapshot,{policy:policy.c22Policy});
  if(v?.schema!==CINESWARM_DECODER_SBOM_SCHEMA) throw new Error('invalid C1.23 SBOM schema');
  if(v.policyId!==policy.policyId||v.environmentSnapshotHash!==environmentSnapshot.snapshotHash||v.capabilityHash!==environmentSnapshot.capabilityHash) throw new Error('SBOM lineage drift');
  tm(v.capturedAt,'capturedAt'); req(v.os?.id,'os.id'); req(v.os?.versionId,'os.versionId'); req(v.os?.prettyName,'os.prettyName');
  unique(v.components,'components',x=>x.componentId); v.components.forEach((c,i)=>validateComponent(c,`components[${i}]`));
  if(!v.components.some(c=>c.name==='ffmpeg'&&c.kind==='executable'&&c.sha256===environmentSnapshot.environment.ffmpeg.executableSha256)) throw new Error('SBOM ffmpeg executable mismatch');
  if(!v.components.some(c=>c.name==='ffprobe'&&c.kind==='executable'&&c.sha256===environmentSnapshot.environment.ffprobe.executableSha256)) throw new Error('SBOM ffprobe executable mismatch');
  if(!v.components.some(c=>c.kind==='shared-library')) throw new Error('SBOM missing linked libraries');
  unique(v.packages,'packages',p=>`${p.name}@${p.version}`);
  if(v.credentialsCaptured!==false||v.networkFetchUsed!==false) throw new Error('SBOM capture boundary drift'); boundary(v,'sbom');
  exactHash(v,'sbomHash','SBOM'); return {valid:true};
}

export function buildRebuildRecipe({policy,sbom,environmentSnapshot,createdAt,recipeId='decoder-rebuild-recipe'}){
  validateDecoderSbom(sbom,{policy,environmentSnapshot}); tok(recipeId,'recipeId'); tm(createdAt,'createdAt');
  const packageRequirements=sbom.packages.map(p=>({name:p.name,version:p.version}));
  const executableRequirements=sbom.components.filter(c=>c.kind==='executable'&&['ffmpeg','ffprobe'].includes(c.name)).map(c=>({name:c.name,sha256:c.sha256,sourcePath:c.path}));
  const linkedLibraryRequirements=sbom.components.filter(c=>c.kind==='shared-library').map(c=>({name:c.name,sha256:c.sha256,sourcePath:c.path,package:c.package??null}));
  const out={schema:CINESWARM_REBUILD_RECIPE_SCHEMA,recipeId,policyId:policy.policyId,sbomHash:sbom.sbomHash,environmentSnapshotHash:environmentSnapshot.snapshotHash,os:structuredClone(sbom.os),reconstructionMode:'isolated-runtime-copy-with-host-dynamic-linker',localProofScope:policy.localProofScope,packageRequirements,executableRequirements,linkedLibraryRequirements,steps:['create-fresh-work-root','copy-exact-ffmpeg-and-ffprobe-binaries','verify-executable-sha256','set-isolated-path-and-home','recompute-capability-fingerprints','full-decode-original-and-preservation-derivative','compare-media-and-capability-receipts'],networkFetchAllowed:false,credentialsAllowed:false,fullIndependentSourceRebuildExpected:false,createdAt,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.recipeHash=digestJson(out); return out;
}
export function validateRebuildRecipe(v,{policy,sbom,environmentSnapshot}){
  validateDecoderSbom(sbom,{policy,environmentSnapshot}); if(v?.schema!==CINESWARM_REBUILD_RECIPE_SCHEMA) throw new Error('invalid C1.23 recipe schema');
  if(v.policyId!==policy.policyId||v.sbomHash!==sbom.sbomHash||v.environmentSnapshotHash!==environmentSnapshot.snapshotHash) throw new Error('recipe lineage drift');
  if(v.reconstructionMode!=='isolated-runtime-copy-with-host-dynamic-linker'||v.localProofScope!==policy.localProofScope) throw new Error('recipe reconstruction scope drift');
  if(v.networkFetchAllowed!==false||v.credentialsAllowed!==false||v.fullIndependentSourceRebuildExpected!==false) throw new Error('recipe boundary drift');
  if(!Array.isArray(v.executableRequirements)||v.executableRequirements.length!==2) throw new Error('recipe requires ffmpeg + ffprobe executables');
  for(const r of v.executableRequirements){ req(r.name,'executableRequirement.name'); sha(r.sha256,'executableRequirement.sha256'); req(r.sourcePath,'executableRequirement.sourcePath'); }
  if(!Array.isArray(v.linkedLibraryRequirements)||!v.linkedLibraryRequirements.length) throw new Error('recipe requires linked libraries');
  for(const r of v.linkedLibraryRequirements){ req(r.name,'linkedLibraryRequirement.name'); sha(r.sha256,'linkedLibraryRequirement.sha256'); req(r.sourcePath,'linkedLibraryRequirement.sourcePath'); }
  boundary(v,'recipe'); exactHash(v,'recipeHash','recipe'); return {valid:true};
}

export function buildDecodeCapsule({policy,environmentSnapshot,compatibilityMatrix,compatibilityMatrixContext,sbom,recipe,authoritativeMedia,createdAt,capsuleId='decode-capsule'}){
  validateRebuildRecipe(recipe,{policy,sbom,environmentSnapshot}); validateCompatibilityMatrix(compatibilityMatrix,compatibilityMatrixContext); tok(capsuleId,'capsuleId'); tm(createdAt,'createdAt');
  if(compatibilityMatrix.environmentSnapshotHash!==environmentSnapshot.snapshotHash||compatibilityMatrix.status!=='PASS') throw new Error('capsule requires PASS compatibility matrix for source environment');
  if(!Array.isArray(authoritativeMedia)||authoritativeMedia.length!==2) throw new Error('capsule requires original + preservation media');
  unique(authoritativeMedia,'authoritativeMedia',x=>x.role);
  const roles=new Set(authoritativeMedia.map(x=>x.role)); if(!roles.has('ORIGINAL')||!roles.has('PRESERVATION_DERIVATIVE')) throw new Error('capsule media roles invalid');
  for(const [i,m] of authoritativeMedia.entries()){ tok(m.assetId,`media[${i}].assetId`); sha(m.sha256,`media[${i}].sha256`); req(m.relativePath,`media[${i}].relativePath`); }
  const out={schema:CINESWARM_DECODE_CAPSULE_SCHEMA,capsuleId,policyId:policy.policyId,environmentSnapshotHash:environmentSnapshot.snapshotHash,compatibilityMatrixHash:compatibilityMatrix.matrixHash,sbomHash:sbom.sbomHash,recipeHash:recipe.recipeHash,authoritativeMedia:structuredClone(authoritativeMedia),capsuleScope:'reconstruct-decoder-runtime-and-prove-authoritative-media-decode',createdAt,fullIndependentSourceRebuildProven:false,originalStillRequired:true,preservationDerivativeStillRequired:true,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.capsuleHash=digestJson(out); return out;
}
export function validateDecodeCapsule(v,{policy,environmentSnapshot,compatibilityMatrix,compatibilityMatrixContext,sbom,recipe}){
  validateRebuildRecipe(recipe,{policy,sbom,environmentSnapshot}); validateCompatibilityMatrix(compatibilityMatrix,compatibilityMatrixContext); if(v?.schema!==CINESWARM_DECODE_CAPSULE_SCHEMA) throw new Error('invalid C1.23 capsule schema');
  for(const [actual,expected,label] of [[v.environmentSnapshotHash,environmentSnapshot.snapshotHash,'environment'],[v.compatibilityMatrixHash,compatibilityMatrix.matrixHash,'matrix'],[v.sbomHash,sbom.sbomHash,'SBOM'],[v.recipeHash,recipe.recipeHash,'recipe']]) if(actual!==expected) throw new Error(`capsule ${label} lineage drift`);
  if(v.fullIndependentSourceRebuildProven!==false||v.originalStillRequired!==true||v.preservationDerivativeStillRequired!==true) throw new Error('capsule preservation/scope boundary drift');
  if(!Array.isArray(v.authoritativeMedia)||v.authoritativeMedia.length!==2) throw new Error('capsule media inventory invalid'); unique(v.authoritativeMedia,'authoritativeMedia',x=>x.role); for(const m of v.authoritativeMedia) sha(m.sha256,'media.sha256');
  boundary(v,'capsule'); exactHash(v,'capsuleHash','capsule'); return {valid:true};
}

export function buildReconstructionReport({policy,capsule,capsuleContext,reconstructedEnvironment,mediaResults,startedAt,completedAt,reportId='decode-reconstruction-report'}){
  validateDecodeCapsule(capsule,capsuleContext); tok(reportId,'reportId'); const st=tm(startedAt,'startedAt'), en=tm(completedAt,'completedAt'); if(en.t<st.t) throw new Error('reconstruction chronology invalid');
  for(const [v,l] of [[reconstructedEnvironment.ffmpegExecutableSha256,'ffmpegExecutableSha256'],[reconstructedEnvironment.ffprobeExecutableSha256,'ffprobeExecutableSha256'],[reconstructedEnvironment.capabilityHash,'capabilityHash']]) sha(v,l);
  if(!Array.isArray(mediaResults)||mediaResults.length!==2) throw new Error('reconstruction requires two media results'); unique(mediaResults,'mediaResults',x=>x.role);
  for(const [i,m] of mediaResults.entries()){ sha(m.expectedSha256,`mediaResults[${i}].expectedSha256`); sha(m.observedSha256,`mediaResults[${i}].observedSha256`); if(m.fullDecodePassed!==true) throw new Error('reconstruction full decode failed'); if(m.expectedSha256!==m.observedSha256) throw new Error('reconstruction media hash mismatch'); }
  const executableHashesMatch=reconstructedEnvironment.ffmpegExecutableSha256===capsuleContext.environmentSnapshot.environment.ffmpeg.executableSha256&&reconstructedEnvironment.ffprobeExecutableSha256===capsuleContext.environmentSnapshot.environment.ffprobe.executableSha256;
  const capabilityFingerprintMatch=reconstructedEnvironment.capabilityHash===capsuleContext.environmentSnapshot.capabilityHash;
  const mediaHashesMatch=mediaResults.every(m=>m.expectedSha256===m.observedSha256&&m.fullDecodePassed===true);
  const status=executableHashesMatch&&capabilityFingerprintMatch&&mediaHashesMatch?'PASS_LOCAL_RUNTIME_RECONSTRUCTION':'FAIL';
  const out={schema:CINESWARM_RECONSTRUCTION_REPORT_SCHEMA,reportId,policyId:policy.policyId,capsuleHash:capsule.capsuleHash,startedAt,completedAt,reconstructionMode:'isolated-runtime-copy-with-host-dynamic-linker',freshWorkingDirectory:reconstructedEnvironment.freshWorkingDirectory===true,isolatedPath:reconstructedEnvironment.isolatedPath===true,networkFetchUsed:false,credentialsUsed:false,hostDynamicLibrariesShared:true,fullOsIsolation:false,fullIndependentSourceRebuildProven:false,reconstructedEnvironment:structuredClone(reconstructedEnvironment),mediaResults:structuredClone(mediaResults),checks:{executableHashesMatch,capabilityFingerprintMatch,mediaHashesMatch,originalFullDecodePassed:mediaResults.find(m=>m.role==='ORIGINAL')?.fullDecodePassed===true,preservationFullDecodePassed:mediaResults.find(m=>m.role==='PRESERVATION_DERIVATIVE')?.fullDecodePassed===true},status,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.reportHash=digestJson(out); return out;
}
export function validateReconstructionReport(v,{policy,capsule,capsuleContext}){
  validateDecodeCapsule(capsule,capsuleContext); if(v?.schema!==CINESWARM_RECONSTRUCTION_REPORT_SCHEMA) throw new Error('invalid C1.23 reconstruction report schema');
  if(v.policyId!==policy.policyId||v.capsuleHash!==capsule.capsuleHash) throw new Error('reconstruction lineage drift');
  const st=tm(v.startedAt,'startedAt'), en=tm(v.completedAt,'completedAt'); if(en.t<st.t) throw new Error('reconstruction chronology invalid');
  if(v.reconstructionMode!=='isolated-runtime-copy-with-host-dynamic-linker'||v.freshWorkingDirectory!==true||v.isolatedPath!==true) throw new Error('reconstruction isolation contract failed');
  if(v.networkFetchUsed!==false||v.credentialsUsed!==false||v.hostDynamicLibrariesShared!==true||v.fullOsIsolation!==false||v.fullIndependentSourceRebuildProven!==false) throw new Error('reconstruction proof scope drift');
  sha(v.reconstructedEnvironment?.ffmpegExecutableSha256,'ffmpegExecutableSha256'); sha(v.reconstructedEnvironment?.ffprobeExecutableSha256,'ffprobeExecutableSha256'); sha(v.reconstructedEnvironment?.capabilityHash,'capabilityHash');
  if(!Array.isArray(v.mediaResults)||v.mediaResults.length!==2) throw new Error('reconstruction media results invalid'); unique(v.mediaResults,'mediaResults',x=>x.role);
  for(const m of v.mediaResults){ sha(m.expectedSha256,'expectedSha256'); sha(m.observedSha256,'observedSha256'); if(m.expectedSha256!==m.observedSha256||m.fullDecodePassed!==true) throw new Error('reconstruction media validation failed'); }
  if(v.status!=='PASS_LOCAL_RUNTIME_RECONSTRUCTION'||Object.values(v.checks||{}).some(x=>x!==true)) throw new Error('reconstruction report did not pass');
  boundary(v,'reconstructionReport'); exactHash(v,'reportHash','reconstruction report'); return {valid:true};
}

function regPayload(v){ return strip(v,['registerHash']); }
export function buildReproDecodeRegister({policy,sourceC22DecodeAccessRegisterHash,entries=[],revision=entries.length,recordedAt,registerId='repro-decode-register'}){
  validateReproDecodePolicy(policy); sha(sourceC22DecodeAccessRegisterHash,'sourceC22DecodeAccessRegisterHash'); tm(recordedAt,'recordedAt'); tok(registerId,'registerId');
  let prev=null; for(const [i,e] of entries.entries()){ if(e.index!==i+1||e.previousEntryHash!==prev) throw new Error('C1.23 register chain invalid'); exactHash(e,'entryHash','C1.23 register entry'); prev=e.entryHash; }
  const counts={sbom:entries.filter(e=>e.event==='DECODER_SBOM_RECORDED').length,capsule:entries.filter(e=>e.event==='DECODE_CAPSULE_RECORDED').length,reconstruction:entries.filter(e=>e.event==='RECONSTRUCTION_PROOF_RECORDED').length};
  const out={schema:CINESWARM_REPRO_DECODE_REGISTER_SCHEMA,registerId,policyId:policy.policyId,c22PolicyId:policy.c22PolicyId,episodeId:policy.episodeId,sequenceId:policy.sequenceId,networkId:policy.networkId,sourceC22DecodeAccessRegisterHash,revision,recordedAt,entries:structuredClone(entries),entryCount:entries.length,headHash:prev,sbomCount:counts.sbom,capsuleCount:counts.capsule,reconstructionProofCount:counts.reconstruction,status:entries.length?'REPRO_DECODE_HISTORY_PRESENT':'EMPTY_NO_REPRO_DECODE_HISTORY',originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false};
  out.registerHash=digestJson(regPayload(out)); return out;
}
export function validateReproDecodeRegister(v,{policy,sourceC22DecodeAccessRegisterHash}){
  const rebuilt=buildReproDecodeRegister({policy,sourceC22DecodeAccessRegisterHash,entries:v.entries,revision:v.revision,recordedAt:v.recordedAt,registerId:v.registerId}); if(rebuilt.registerHash!==v.registerHash) throw new Error('C1.23 register self-hash mismatch'); boundary(v,'reproDecodeRegister'); return {valid:true};
}
function append({register,registerContext,event,payload,recordedAt}){ validateReproDecodeRegister(register,registerContext); const entry={index:register.entries.length+1,event,...payload,recordedAt,previousEntryHash:register.headHash}; entry.entryHash=digestJson(strip(entry,['entryHash'])); return buildReproDecodeRegister({...registerContext,entries:[...register.entries,entry],revision:register.revision+1,recordedAt,registerId:register.registerId}); }
export function appendDecoderSbom({register,sbom,sbomContext,registerContext,recordedAt}){ validateDecoderSbom(sbom,sbomContext); if(register.entries.some(e=>e.sbomHash===sbom.sbomHash)) throw new Error('SBOM already registered'); return append({register,registerContext,event:'DECODER_SBOM_RECORDED',payload:{sbomId:sbom.sbomId,sbomHash:sbom.sbomHash,environmentSnapshotHash:sbom.environmentSnapshotHash},recordedAt}); }
export function appendDecodeCapsule({register,capsule,capsuleContext,registerContext,recordedAt}){ validateDecodeCapsule(capsule,capsuleContext); if(register.entries.some(e=>e.capsuleHash===capsule.capsuleHash)) throw new Error('decode capsule already registered'); return append({register,registerContext,event:'DECODE_CAPSULE_RECORDED',payload:{capsuleId:capsule.capsuleId,capsuleHash:capsule.capsuleHash,sbomHash:capsule.sbomHash,recipeHash:capsule.recipeHash},recordedAt}); }
export function appendReconstructionProof({register,report,reportContext,registerContext,recordedAt}){ validateReconstructionReport(report,reportContext); if(register.entries.some(e=>e.reportHash===report.reportHash)) throw new Error('reconstruction proof already registered'); return append({register,registerContext,event:'RECONSTRUCTION_PROOF_RECORDED',payload:{reportId:report.reportId,reportHash:report.reportHash,capsuleHash:report.capsuleHash,status:report.status,fullIndependentSourceRebuildProven:false},recordedAt}); }
export function classifyReproDecodeState({policy,register,sourceC22DecodeAccessRegisterHash}){ validateReproDecodeRegister(register,{policy,sourceC22DecodeAccessRegisterHash}); return {phase:'C1.23',status:register.status,registerRevision:register.revision,sboms:register.sbomCount,decodeCapsules:register.capsuleCount,reconstructionProofs:register.reconstructionProofCount,fullIndependentSourceRebuildProven:false,localRuntimeReconstructionScope:policy.localProofScope,originalDeletionAuthorized:false,preservationDerivativeDeletionAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}; }
