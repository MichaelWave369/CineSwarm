import { digestJson } from './authorization-seal.js';
import { validateReproDecodePolicy, validateReproDecodeRegister } from './reproducible-decode-capsule.js';

export const CINESWARM_INDEPENDENT_BUILD_POLICY_SCHEMA = 'parallax.cineswarm.independent-build-policy.c1.24.v0.1';
export const CINESWARM_BUILD_INPUT_STATUS_SCHEMA = 'parallax.cineswarm.build-input-acquisition-status.c1.24.v0.1';
export const CINESWARM_BUILD_INPUT_ARCHIVE_SCHEMA = 'parallax.cineswarm.build-input-archive.c1.24.v0.1';
export const CINESWARM_HERMETIC_BUILD_RECIPE_SCHEMA = 'parallax.cineswarm.hermetic-decoder-build-recipe.c1.24.v0.1';
export const CINESWARM_INDEPENDENT_REBUILD_REPORT_SCHEMA = 'parallax.cineswarm.independent-decoder-rebuild-report.c1.24.v0.1';
export const CINESWARM_INDEPENDENT_REBUILD_RECEIPT_SCHEMA = 'parallax.cineswarm.independent-decoder-rebuild-receipt.c1.24.v0.1';
export const CINESWARM_INDEPENDENT_REBUILD_REGISTER_SCHEMA = 'parallax.cineswarm.independent-rebuild-register.c1.24.v0.1';

const REQUIRED_INPUT_KINDS = [
  'UPSTREAM_SOURCE_TARBALL',
  'DETACHED_SIGNATURE',
  'SIGNING_PUBLIC_KEY',
  'COMPILER_TOOLCHAIN',
  'BUILD_TOOL',
  'SYSROOT_OR_BUILD_DEPENDENCY_CLOSURE',
  'BUILD_CONFIGURATION',
];

const REQUIRED_DECODER_CAPABILITIES = [
  'demuxer:avi',
  'demuxer:matroska',
  'decoder:mpeg4',
  'decoder:ffv1',
  'decoder:pcm_s16le',
  'decoder:pcm_s24le',
  'protocol:file',
];

function req(v,l){ if(typeof v!=='string'||!v.trim()) throw new Error(`${l} must be a non-empty string`); return v.trim(); }
function tok(v,l){ const s=req(v,l); if(!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`); return s; }
function sha(v,l){ const s=req(v,l); if(!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`); return s; }
function tm(v,l){ const s=req(v,l); const t=Date.parse(s); if(!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`); return {s,t}; }
function yes(v,l){ if(v!==true) throw new Error(`${l} must remain true`); }
function no(v,l){ if(v!==false) throw new Error(`${l} must remain false`); }
function strip(v, fields){ const x=structuredClone(v); for(const f of fields) delete x[f]; return x; }
function exactHash(v, field, label){ if(digestJson(strip(v,[field]))!==v[field]) throw new Error(`${label} self-hash mismatch`); }
function unique(arr,label,key=(x)=>x){ if(!Array.isArray(arr)) throw new Error(`${label} must be an array`); const seen=new Set(); for(const x of arr){ const k=key(x); if(seen.has(k)) throw new Error(`${label} duplicate ${k}`); seen.add(k); } }
function boundary(v,label){
  no(v.buildCanAuthorizeRelease,`${label}.buildCanAuthorizeRelease`);
  no(v.rebuildCanAuthorizeRelease,`${label}.rebuildCanAuthorizeRelease`);
  no(v.originalDeleteAuthorized,`${label}.originalDeleteAuthorized`);
  no(v.preservationDerivativeDeleteAuthorized,`${label}.preservationDerivativeDeleteAuthorized`);
  no(v.publicRelease,`${label}.publicRelease`);
  no(v.relayDependency,`${label}.relayDependency`);
}

export function validateIndependentBuildPolicy(policy){
  if(!policy||policy.schema!==CINESWARM_INDEPENDENT_BUILD_POLICY_SCHEMA) throw new Error('invalid C1.24 policy schema');
  for(const [v,l] of [[policy.policyId,'policyId'],[policy.c23PolicyId,'c23PolicyId'],[policy.episodeId,'episodeId'],[policy.sequenceId,'sequenceId'],[policy.networkId,'networkId'],[policy.sourceProject,'sourceProject'],[policy.sourceVersion,'sourceVersion']]) tok(v,l);
  sha(policy.sourceC23ReproDecodeRegisterHash,'sourceC23ReproDecodeRegisterHash');
  if(!/^[A-F0-9]{40}$/.test(req(policy.releaseSigningKeyFingerprint,'releaseSigningKeyFingerprint'))) throw new Error('releaseSigningKeyFingerprint invalid');
  if(!Array.isArray(policy.requiredInputKinds)||policy.requiredInputKinds.length!==REQUIRED_INPUT_KINDS.length) throw new Error('requiredInputKinds invalid');
  if(REQUIRED_INPUT_KINDS.some(k=>!policy.requiredInputKinds.includes(k))) throw new Error('requiredInputKinds drift');
  if(!Array.isArray(policy.requiredDecoderCapabilities)||policy.requiredDecoderCapabilities.length!==REQUIRED_DECODER_CAPABILITIES.length) throw new Error('requiredDecoderCapabilities invalid');
  if(REQUIRED_DECODER_CAPABILITIES.some(k=>!policy.requiredDecoderCapabilities.includes(k))) throw new Error('requiredDecoderCapabilities drift');
  for(const k of ['requireOfficialSourceArtifact','requireDetachedSignature','requireReleaseKeyFingerprint','requireAuthenticityVerification','requireCompleteBuildInputClosure','requireFreshBuildRoot','requireNetworkDisabledDuringBuild','requireSourceCompilation','requireNoCopiedDecoderBinary','requireBuildLogHash','requireBuiltExecutableHashes','requireOriginalFullDecode','requirePreservationDerivativeFullDecode','requireDecodedEquivalenceToAuthoritativeReceipts','appendOnlyIndependentRebuildRegister','originalStillRequired','preservationDerivativeStillRequired']) yes(policy[k],k);
  for(const k of ['allowNetworkFetchDuringBuild','allowCredentialCapture','allowHostDecoderBinaryCopy','allowInputClosureInference','autoPromoteIndependentProof','buildCanAuthorizeRelease','rebuildCanAuthorizeRelease','originalDeleteAuthorized','preservationDerivativeDeleteAuthorized','publicRelease','relayDependency']) no(policy[k],k);
  if(policy.proofRequirement!=='complete-input-closure-plus-source-build-plus-authoritative-media-decode') throw new Error('proofRequirement drift');
  return {valid:true};
}

function validateInputDescriptor(a,label,{allowMissing=false}={}){
  tok(a.artifactId,`${label}.artifactId`); req(a.kind,`${label}.kind`); req(a.origin,`${label}.origin`);
  if(!REQUIRED_INPUT_KINDS.includes(a.kind)) throw new Error(`${label}.kind unsupported`);
  if(a.present===true){ sha(a.sha256,`${label}.sha256`); if(!Number.isInteger(a.size)||a.size<=0) throw new Error(`${label}.size invalid`); req(a.path,`${label}.path`); }
  else if(!allowMissing) throw new Error(`${label} must be present`);
  else { if(a.present!==false) throw new Error(`${label}.present invalid`); if(a.sha256!==null||a.size!==null||a.path!==null) throw new Error(`${label} missing artifact fields must be null`); }
}

export function buildBuildInputAcquisitionStatus({policy, artifacts, checkedAt, statusId='build-input-acquisition-status'}){
  validateIndependentBuildPolicy(policy); tok(statusId,'statusId'); tm(checkedAt,'checkedAt');
  if(!Array.isArray(artifacts)||artifacts.length!==REQUIRED_INPUT_KINDS.length) throw new Error('acquisition status must describe every required input kind');
  unique(artifacts,'artifacts',x=>x.kind); artifacts.forEach((a,i)=>validateInputDescriptor(a,`artifacts[${i}]`,{allowMissing:true}));
  for(const k of REQUIRED_INPUT_KINDS) if(!artifacts.some(a=>a.kind===k)) throw new Error(`acquisition status missing ${k}`);
  const missingKinds=artifacts.filter(a=>a.present!==true).map(a=>a.kind);
  const sourcePresent=artifacts.find(a=>a.kind==='UPSTREAM_SOURCE_TARBALL')?.present===true;
  const detachedSignaturePresent=artifacts.find(a=>a.kind==='DETACHED_SIGNATURE')?.present===true;
  const signingKeyPresent=artifacts.find(a=>a.kind==='SIGNING_PUBLIC_KEY')?.present===true;
  const readyForArchive=missingKinds.length===0;
  const out={schema:CINESWARM_BUILD_INPUT_STATUS_SCHEMA,statusId,policyId:policy.policyId,sourceProject:policy.sourceProject,sourceVersion:policy.sourceVersion,checkedAt,artifacts:structuredClone(artifacts),missingKinds,checks:{sourcePresent,detachedSignaturePresent,signingKeyPresent,allRequiredInputsPresent:readyForArchive},status:readyForArchive?'READY_TO_BUILD_INPUT_ARCHIVE':'BLOCKED_MISSING_BUILD_INPUTS',fullIndependentSourceRebuildProven:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false};
  out.statusHash=digestJson(out); return out;
}
export function validateBuildInputAcquisitionStatus(v,{policy}){
  validateIndependentBuildPolicy(policy); if(v?.schema!==CINESWARM_BUILD_INPUT_STATUS_SCHEMA) throw new Error('invalid C1.24 acquisition status schema');
  if(v.policyId!==policy.policyId||v.sourceProject!==policy.sourceProject||v.sourceVersion!==policy.sourceVersion) throw new Error('acquisition status lineage drift');
  tm(v.checkedAt,'checkedAt'); unique(v.artifacts,'artifacts',x=>x.kind); v.artifacts.forEach((a,i)=>validateInputDescriptor(a,`artifacts[${i}]`,{allowMissing:true}));
  for(const k of REQUIRED_INPUT_KINDS) if(!v.artifacts.some(a=>a.kind===k)) throw new Error(`acquisition status missing ${k}`);
  const missing=v.artifacts.filter(a=>a.present!==true).map(a=>a.kind);
  if(JSON.stringify(missing)!==JSON.stringify(v.missingKinds)) throw new Error('acquisition missingKinds drift');
  const ready=missing.length===0;
  if(v.status!==(ready?'READY_TO_BUILD_INPUT_ARCHIVE':'BLOCKED_MISSING_BUILD_INPUTS')) throw new Error('acquisition status drift');
  if(v.fullIndependentSourceRebuildProven!==false) throw new Error('acquisition cannot prove independent rebuild'); boundary(v,'acquisitionStatus'); exactHash(v,'statusHash','acquisition status'); return {valid:true};
}

export function buildBuildInputArchive({policy, artifacts, authenticity, toolchain, buildConfiguration, createdAt, archiveId='ffmpeg-build-input-archive'}){
  validateIndependentBuildPolicy(policy); tok(archiveId,'archiveId'); tm(createdAt,'createdAt');
  if(!Array.isArray(artifacts)||artifacts.length!==REQUIRED_INPUT_KINDS.length) throw new Error('build input archive must contain every required input kind');
  unique(artifacts,'artifacts',x=>x.kind); artifacts.forEach((a,i)=>validateInputDescriptor(a,`artifacts[${i}]`));
  for(const k of REQUIRED_INPUT_KINDS) if(!artifacts.some(a=>a.kind===k)) throw new Error(`build input archive missing ${k}`);
  if(authenticity?.signatureVerified!==true) throw new Error('source authenticity signature must be verified');
  if(req(authenticity.signingKeyFingerprint,'signingKeyFingerprint')!==policy.releaseSigningKeyFingerprint) throw new Error('release signing fingerprint drift');
  const source=artifacts.find(a=>a.kind==='UPSTREAM_SOURCE_TARBALL');
  if(authenticity.sourceArtifactSha256!==source.sha256) throw new Error('authenticity source hash drift');
  req(authenticity.verificationTool,'verificationTool');
  req(toolchain?.compilerId,'toolchain.compilerId'); req(toolchain?.compilerVersion,'toolchain.compilerVersion'); sha(toolchain?.compilerSha256,'toolchain.compilerSha256');
  req(toolchain?.buildToolId,'toolchain.buildToolId'); req(toolchain?.buildToolVersion,'toolchain.buildToolVersion'); sha(toolchain?.buildToolSha256,'toolchain.buildToolSha256');
  if(buildConfiguration?.networkAllowed!==false||buildConfiguration?.credentialsAllowed!==false||buildConfiguration?.copyHostDecoderBinaries!==false) throw new Error('build configuration boundary drift');
  if(!Array.isArray(buildConfiguration.configureArgs)||buildConfiguration.configureArgs.length<1) throw new Error('configureArgs required');
  if(!buildConfiguration.configureArgs.includes('--disable-network')) throw new Error('configureArgs must disable network');
  const out={schema:CINESWARM_BUILD_INPUT_ARCHIVE_SCHEMA,archiveId,policyId:policy.policyId,sourceProject:policy.sourceProject,sourceVersion:policy.sourceVersion,sourceC23ReproDecodeRegisterHash:policy.sourceC23ReproDecodeRegisterHash,artifacts:structuredClone(artifacts),authenticity:structuredClone(authenticity),toolchain:structuredClone(toolchain),buildConfiguration:structuredClone(buildConfiguration),inputClosureComplete:true,sourceAuthenticityVerified:true,createdAt,fullIndependentSourceRebuildProven:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false};
  out.archiveHash=digestJson(out); return out;
}
export function validateBuildInputArchive(v,{policy}){
  validateIndependentBuildPolicy(policy); if(v?.schema!==CINESWARM_BUILD_INPUT_ARCHIVE_SCHEMA) throw new Error('invalid C1.24 build input archive schema');
  if(v.policyId!==policy.policyId||v.sourceProject!==policy.sourceProject||v.sourceVersion!==policy.sourceVersion||v.sourceC23ReproDecodeRegisterHash!==policy.sourceC23ReproDecodeRegisterHash) throw new Error('build input archive lineage drift');
  tm(v.createdAt,'createdAt'); unique(v.artifacts,'artifacts',x=>x.kind); if(v.artifacts.length!==REQUIRED_INPUT_KINDS.length) throw new Error('build input archive artifact count drift');
  v.artifacts.forEach((a,i)=>validateInputDescriptor(a,`artifacts[${i}]`)); for(const k of REQUIRED_INPUT_KINDS) if(!v.artifacts.some(a=>a.kind===k)) throw new Error(`build input archive missing ${k}`);
  if(v.authenticity?.signatureVerified!==true||v.authenticity?.signingKeyFingerprint!==policy.releaseSigningKeyFingerprint) throw new Error('source authenticity drift');
  const source=v.artifacts.find(a=>a.kind==='UPSTREAM_SOURCE_TARBALL'); if(v.authenticity.sourceArtifactSha256!==source.sha256) throw new Error('authenticity source hash drift');
  sha(v.toolchain?.compilerSha256,'compilerSha256'); sha(v.toolchain?.buildToolSha256,'buildToolSha256');
  if(v.buildConfiguration?.networkAllowed!==false||v.buildConfiguration?.credentialsAllowed!==false||v.buildConfiguration?.copyHostDecoderBinaries!==false||!v.buildConfiguration?.configureArgs?.includes('--disable-network')) throw new Error('build configuration boundary drift');
  if(v.inputClosureComplete!==true||v.sourceAuthenticityVerified!==true||v.fullIndependentSourceRebuildProven!==false) throw new Error('build input archive scope drift'); boundary(v,'buildInputArchive'); exactHash(v,'archiveHash','build input archive'); return {valid:true};
}

export function buildHermeticDecoderRecipe({policy, buildInputArchive, authoritativeMedia, createdAt, recipeId='ffmpeg-hermetic-build-recipe'}){
  validateBuildInputArchive(buildInputArchive,{policy}); tok(recipeId,'recipeId'); tm(createdAt,'createdAt');
  if(!Array.isArray(authoritativeMedia)||authoritativeMedia.length!==2) throw new Error('recipe requires exactly two authoritative media inputs'); unique(authoritativeMedia,'authoritativeMedia',m=>m.role);
  for(const role of ['ORIGINAL','PRESERVATION_DERIVATIVE']) if(!authoritativeMedia.some(m=>m.role===role)) throw new Error(`recipe missing ${role}`);
  for(const [i,m] of authoritativeMedia.entries()){ sha(m.sha256,`authoritativeMedia[${i}].sha256`); sha(m.decodedVideoSha256,`authoritativeMedia[${i}].decodedVideoSha256`); sha(m.decodedAudioSha256,`authoritativeMedia[${i}].decodedAudioSha256`); }
  const out={schema:CINESWARM_HERMETIC_BUILD_RECIPE_SCHEMA,recipeId,policyId:policy.policyId,buildInputArchiveHash:buildInputArchive.archiveHash,sourceProject:policy.sourceProject,sourceVersion:policy.sourceVersion,configureArgs:structuredClone(buildInputArchive.buildConfiguration.configureArgs),requiredDecoderCapabilities:structuredClone(policy.requiredDecoderCapabilities),authoritativeMedia:structuredClone(authoritativeMedia),steps:['create-fresh-build-root','verify-all-build-input-hashes','verify-source-signature','extract-source-from-archived-tarball','apply-no-unrecorded-inputs','configure-with-frozen-arguments','compile-ffmpeg-and-ffprobe-from-source','verify-build-log-hash','record-built-executable-hashes','probe-required-capabilities','full-decode-original','full-decode-preservation-derivative','compare-decoded-video-and-audio-hashes','issue-independent-rebuild-report'],networkAllowedDuringBuild:false,credentialsAllowed:false,copyHostDecoderBinaries:false,fullInputClosureRequired:true,createdAt,fullIndependentSourceRebuildProven:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false};
  out.recipeHash=digestJson(out); return out;
}
export function validateHermeticDecoderRecipe(v,{policy,buildInputArchive}){
  validateBuildInputArchive(buildInputArchive,{policy}); if(v?.schema!==CINESWARM_HERMETIC_BUILD_RECIPE_SCHEMA) throw new Error('invalid C1.24 build recipe schema');
  if(v.policyId!==policy.policyId||v.buildInputArchiveHash!==buildInputArchive.archiveHash||v.sourceProject!==policy.sourceProject||v.sourceVersion!==policy.sourceVersion) throw new Error('build recipe lineage drift');
  tm(v.createdAt,'createdAt'); if(v.networkAllowedDuringBuild!==false||v.credentialsAllowed!==false||v.copyHostDecoderBinaries!==false||v.fullInputClosureRequired!==true) throw new Error('build recipe boundary drift');
  unique(v.authoritativeMedia,'authoritativeMedia',m=>m.role); if(v.authoritativeMedia.length!==2) throw new Error('build recipe media count drift'); for(const m of v.authoritativeMedia){ sha(m.sha256,'media.sha256'); sha(m.decodedVideoSha256,'media.decodedVideoSha256'); sha(m.decodedAudioSha256,'media.decodedAudioSha256'); }
  if(JSON.stringify(v.configureArgs)!==JSON.stringify(buildInputArchive.buildConfiguration.configureArgs)) throw new Error('build recipe configure args drift');
  if(JSON.stringify(v.requiredDecoderCapabilities)!==JSON.stringify(policy.requiredDecoderCapabilities)) throw new Error('build recipe capability drift');
  if(v.fullIndependentSourceRebuildProven!==false) throw new Error('build recipe cannot itself prove rebuild'); boundary(v,'hermeticBuildRecipe'); exactHash(v,'recipeHash','hermetic build recipe'); return {valid:true};
}

export function buildIndependentRebuildReport({policy, buildInputArchive, recipe, startedAt, completedAt, buildEnvironment, buildResult, capabilityResults, mediaResults, reportId='independent-decoder-rebuild-report'}){
  validateHermeticDecoderRecipe(recipe,{policy,buildInputArchive}); tok(reportId,'reportId'); const st=tm(startedAt,'startedAt'), en=tm(completedAt,'completedAt'); if(en.t<st.t) throw new Error('independent rebuild chronology invalid');
  const checks={
    freshBuildRoot:buildEnvironment?.freshBuildRoot===true,
    networkDisabled:buildEnvironment?.networkDisabled===true,
    credentialsAbsent:buildEnvironment?.credentialsUsed===false,
    inputClosureComplete:buildInputArchive.inputClosureComplete===true,
    sourceAuthenticityVerified:buildInputArchive.sourceAuthenticityVerified===true,
    sourceBuiltNotCopied:buildResult?.sourceBuiltNotCopied===true&&buildResult?.hostDecoderBinariesCopied===false,
    buildSucceeded:buildResult?.exitCode===0,
    buildLogHashed:/^[a-f0-9]{64}$/.test(String(buildResult?.buildLogSha256||'')),
    builtFfmpegHashed:/^[a-f0-9]{64}$/.test(String(buildResult?.ffmpegSha256||'')),
    builtFfprobeHashed:/^[a-f0-9]{64}$/.test(String(buildResult?.ffprobeSha256||'')),
    requiredCapabilitiesPresent:Array.isArray(capabilityResults)&&policy.requiredDecoderCapabilities.every(k=>capabilityResults.some(c=>c.capability===k&&c.present===true)),
    originalFullDecodePassed:Array.isArray(mediaResults)&&mediaResults.find(m=>m.role==='ORIGINAL')?.fullDecodePassed===true,
    preservationFullDecodePassed:Array.isArray(mediaResults)&&mediaResults.find(m=>m.role==='PRESERVATION_DERIVATIVE')?.fullDecodePassed===true,
    mediaHashesExact:Array.isArray(mediaResults)&&recipe.authoritativeMedia.every(expected=>{ const obs=mediaResults.find(m=>m.role===expected.role); return obs&&obs.expectedSha256===expected.sha256&&obs.observedSha256===expected.sha256; }),
    decodedEquivalenceExact:Array.isArray(mediaResults)&&recipe.authoritativeMedia.every(expected=>{ const obs=mediaResults.find(m=>m.role===expected.role); return obs&&obs.decodedVideoSha256===expected.decodedVideoSha256&&obs.decodedAudioSha256===expected.decodedAudioSha256; }),
  };
  if(!Array.isArray(capabilityResults)) throw new Error('capabilityResults required'); unique(capabilityResults,'capabilityResults',c=>c.capability); for(const c of capabilityResults){ req(c.capability,'capability'); if(typeof c.present!=='boolean') throw new Error('capability present must be boolean'); }
  if(!Array.isArray(mediaResults)||mediaResults.length!==2) throw new Error('mediaResults invalid'); unique(mediaResults,'mediaResults',m=>m.role); for(const m of mediaResults){ sha(m.expectedSha256,'expectedSha256'); sha(m.observedSha256,'observedSha256'); sha(m.decodedVideoSha256,'decodedVideoSha256'); sha(m.decodedAudioSha256,'decodedAudioSha256'); if(typeof m.fullDecodePassed!=='boolean') throw new Error('fullDecodePassed must be boolean'); }
  const pass=Object.values(checks).every(Boolean);
  const out={schema:CINESWARM_INDEPENDENT_REBUILD_REPORT_SCHEMA,reportId,policyId:policy.policyId,buildInputArchiveHash:buildInputArchive.archiveHash,recipeHash:recipe.recipeHash,startedAt,completedAt,buildEnvironment:structuredClone(buildEnvironment),buildResult:structuredClone(buildResult),capabilityResults:structuredClone(capabilityResults),mediaResults:structuredClone(mediaResults),checks,status:pass?'PASS_INDEPENDENT_SOURCE_REBUILD':'FAIL',fullIndependentSourceRebuildProven:pass,fullOsIsolationProven:buildEnvironment?.fullOsIsolationProven===true,hermeticInputClosureProven:checks.inputClosureComplete&&checks.networkDisabled,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false};
  out.reportHash=digestJson(out); return out;
}
export function validateIndependentRebuildReport(v,{policy,buildInputArchive,recipe}){
  validateHermeticDecoderRecipe(recipe,{policy,buildInputArchive}); if(v?.schema!==CINESWARM_INDEPENDENT_REBUILD_REPORT_SCHEMA) throw new Error('invalid C1.24 rebuild report schema');
  if(v.policyId!==policy.policyId||v.buildInputArchiveHash!==buildInputArchive.archiveHash||v.recipeHash!==recipe.recipeHash) throw new Error('independent rebuild lineage drift');
  const st=tm(v.startedAt,'startedAt'), en=tm(v.completedAt,'completedAt'); if(en.t<st.t) throw new Error('independent rebuild chronology invalid');
  if(v.buildEnvironment?.freshBuildRoot!==true||v.buildEnvironment?.networkDisabled!==true||v.buildEnvironment?.credentialsUsed!==false) throw new Error('independent rebuild environment failed');
  if(v.buildResult?.sourceBuiltNotCopied!==true||v.buildResult?.hostDecoderBinariesCopied!==false||v.buildResult?.exitCode!==0) throw new Error('independent rebuild did not compile from source');
  sha(v.buildResult?.buildLogSha256,'buildLogSha256'); sha(v.buildResult?.ffmpegSha256,'ffmpegSha256'); sha(v.buildResult?.ffprobeSha256,'ffprobeSha256');
  unique(v.capabilityResults,'capabilityResults',c=>c.capability); for(const k of policy.requiredDecoderCapabilities) if(!v.capabilityResults.some(c=>c.capability===k&&c.present===true)) throw new Error(`missing required capability ${k}`);
  unique(v.mediaResults,'mediaResults',m=>m.role); if(v.mediaResults.length!==2) throw new Error('independent rebuild media count drift');
  for(const expected of recipe.authoritativeMedia){ const obs=v.mediaResults.find(m=>m.role===expected.role); if(!obs||obs.fullDecodePassed!==true||obs.expectedSha256!==expected.sha256||obs.observedSha256!==expected.sha256||obs.decodedVideoSha256!==expected.decodedVideoSha256||obs.decodedAudioSha256!==expected.decodedAudioSha256) throw new Error(`independent rebuild media validation failed for ${expected.role}`); }
  if(v.status!=='PASS_INDEPENDENT_SOURCE_REBUILD'||v.fullIndependentSourceRebuildProven!==true||v.hermeticInputClosureProven!==true||Object.values(v.checks||{}).some(x=>x!==true)) throw new Error('independent source rebuild was not fully proven');
  boundary(v,'independentRebuildReport'); exactHash(v,'reportHash','independent rebuild report'); return {valid:true};
}

export function buildIndependentRebuildReceipt({policy, report, reportContext, issuedAt, receiptId='independent-decoder-rebuild-receipt'}){
  validateIndependentRebuildReport(report,reportContext); tok(receiptId,'receiptId'); tm(issuedAt,'issuedAt');
  const out={schema:CINESWARM_INDEPENDENT_REBUILD_RECEIPT_SCHEMA,receiptId,policyId:policy.policyId,reportHash:report.reportHash,buildInputArchiveHash:report.buildInputArchiveHash,recipeHash:report.recipeHash,issuedAt,fullIndependentSourceRebuildProven:true,hermeticInputClosureProven:true,authoritativeMediaDecodeProven:true,fullOsIsolationProven:report.fullOsIsolationProven===true,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false};
  out.receiptHash=digestJson(out); return out;
}
export function validateIndependentRebuildReceipt(v,{policy,report,reportContext}){
  validateIndependentRebuildReport(report,reportContext); if(v?.schema!==CINESWARM_INDEPENDENT_REBUILD_RECEIPT_SCHEMA) throw new Error('invalid C1.24 rebuild receipt schema');
  if(v.policyId!==policy.policyId||v.reportHash!==report.reportHash||v.buildInputArchiveHash!==report.buildInputArchiveHash||v.recipeHash!==report.recipeHash) throw new Error('independent rebuild receipt lineage drift');
  tm(v.issuedAt,'issuedAt'); if(v.fullIndependentSourceRebuildProven!==true||v.hermeticInputClosureProven!==true||v.authoritativeMediaDecodeProven!==true) throw new Error('independent rebuild receipt proof flags invalid'); boundary(v,'independentRebuildReceipt'); exactHash(v,'receiptHash','independent rebuild receipt'); return {valid:true};
}

function regPayload(v){ return strip(v,['registerHash']); }
export function buildIndependentRebuildRegister({policy,sourceC23ReproDecodeRegisterHash,entries=[],revision=entries.length,recordedAt,registerId='independent-rebuild-register'}){
  validateIndependentBuildPolicy(policy); sha(sourceC23ReproDecodeRegisterHash,'sourceC23ReproDecodeRegisterHash'); if(sourceC23ReproDecodeRegisterHash!==policy.sourceC23ReproDecodeRegisterHash) throw new Error('C1.24 register source C1.23 hash drift'); tm(recordedAt,'recordedAt'); tok(registerId,'registerId');
  let prev=null; for(const [i,e] of entries.entries()){ if(e.index!==i+1||e.previousEntryHash!==prev) throw new Error('C1.24 register chain invalid'); exactHash(e,'entryHash','C1.24 register entry'); prev=e.entryHash; }
  const out={schema:CINESWARM_INDEPENDENT_REBUILD_REGISTER_SCHEMA,registerId,policyId:policy.policyId,c23PolicyId:policy.c23PolicyId,episodeId:policy.episodeId,sequenceId:policy.sequenceId,networkId:policy.networkId,sourceC23ReproDecodeRegisterHash,revision,recordedAt,entries:structuredClone(entries),entryCount:entries.length,headHash:prev,buildInputArchiveCount:entries.filter(e=>e.event==='BUILD_INPUT_ARCHIVE_RECORDED').length,independentRebuildReceiptCount:entries.filter(e=>e.event==='INDEPENDENT_REBUILD_RECEIPT_RECORDED').length,status:entries.length?'INDEPENDENT_REBUILD_HISTORY_PRESENT':'EMPTY_NO_INDEPENDENT_REBUILD_HISTORY',fullIndependentSourceRebuildProven:entries.some(e=>e.event==='INDEPENDENT_REBUILD_RECEIPT_RECORDED'&&e.fullIndependentSourceRebuildProven===true),buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false};
  out.registerHash=digestJson(regPayload(out)); return out;
}
export function validateIndependentRebuildRegister(v,{policy,sourceC23ReproDecodeRegisterHash}){
  const rebuilt=buildIndependentRebuildRegister({policy,sourceC23ReproDecodeRegisterHash,entries:v.entries,revision:v.revision,recordedAt:v.recordedAt,registerId:v.registerId}); if(rebuilt.registerHash!==v.registerHash) throw new Error('C1.24 register self-hash mismatch'); boundary(v,'independentRebuildRegister'); return {valid:true};
}
function append({register,registerContext,event,payload,recordedAt}){ validateIndependentRebuildRegister(register,registerContext); const entry={index:register.entries.length+1,event,...payload,recordedAt,previousEntryHash:register.headHash}; entry.entryHash=digestJson(strip(entry,['entryHash'])); return buildIndependentRebuildRegister({...registerContext,entries:[...register.entries,entry],revision:register.revision+1,recordedAt,registerId:register.registerId}); }
export function appendBuildInputArchive({register,buildInputArchive,archiveContext,registerContext,recordedAt}){ validateBuildInputArchive(buildInputArchive,archiveContext); if(register.entries.some(e=>e.archiveHash===buildInputArchive.archiveHash)) throw new Error('build input archive already registered'); return append({register,registerContext,event:'BUILD_INPUT_ARCHIVE_RECORDED',payload:{archiveId:buildInputArchive.archiveId,archiveHash:buildInputArchive.archiveHash,sourceVersion:buildInputArchive.sourceVersion},recordedAt}); }
export function appendIndependentRebuildReceipt({register,receipt,receiptContext,registerContext,recordedAt}){ validateIndependentRebuildReceipt(receipt,receiptContext); if(!register.entries.some(e=>e.archiveHash===receipt.buildInputArchiveHash)) throw new Error('rebuild receipt requires registered build input archive'); if(register.entries.some(e=>e.receiptHash===receipt.receiptHash)) throw new Error('independent rebuild receipt already registered'); return append({register,registerContext,event:'INDEPENDENT_REBUILD_RECEIPT_RECORDED',payload:{receiptId:receipt.receiptId,receiptHash:receipt.receiptHash,buildInputArchiveHash:receipt.buildInputArchiveHash,reportHash:receipt.reportHash,fullIndependentSourceRebuildProven:true},recordedAt}); }
export function classifyIndependentRebuildState({policy,register,sourceC23ReproDecodeRegisterHash,acquisitionStatus=null}){
  validateIndependentRebuildRegister(register,{policy,sourceC23ReproDecodeRegisterHash}); if(acquisitionStatus) validateBuildInputAcquisitionStatus(acquisitionStatus,{policy});
  return {phase:'C1.24',status:register.status,registerRevision:register.revision,buildInputArchives:register.buildInputArchiveCount,independentRebuildReceipts:register.independentRebuildReceiptCount,fullIndependentSourceRebuildProven:register.fullIndependentSourceRebuildProven,buildInputsReady:acquisitionStatus?.status==='READY_TO_BUILD_INPUT_ARCHIVE',missingBuildInputKinds:acquisitionStatus?.missingKinds??[],proofRequirement:policy.proofRequirement,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeletionAuthorized:false,preservationDerivativeDeletionAuthorized:false,publicRelease:false,relayDependency:false};
}
