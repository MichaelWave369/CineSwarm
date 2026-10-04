import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  appendBuildInputArchive,
  appendIndependentRebuildReceipt,
  buildBuildInputAcquisitionStatus,
  buildBuildInputArchive,
  buildHermeticDecoderRecipe,
  buildIndependentRebuildReceipt,
  buildIndependentRebuildRegister,
  buildIndependentRebuildReport,
  classifyIndependentRebuildState,
  validateBuildInputAcquisitionStatus,
  validateBuildInputArchive,
  validateHermeticDecoderRecipe,
  validateIndependentBuildPolicy,
  validateIndependentRebuildReceipt,
  validateIndependentRebuildRegister,
  validateIndependentRebuildReport,
} from '../src/independent-source-rebuild.js';
import { digestJson } from '../src/authorization-seal.js';

const h=(c)=>c.repeat(64).slice(0,64);
const policy={
  schema:'parallax.cineswarm.independent-build-policy.c1.24.v0.1', policyId:'pn0001-c1-24-independent-build-policy', c23PolicyId:'pn0001-c1-23-repro-decode-policy', episodeId:'episode_pn_0001', sequenceId:'pn0001-seq01-cold-open', networkId:'parallax-network', sourceProject:'FFmpeg', sourceVersion:'7.1.5', sourceC23ReproDecodeRegisterHash:h('a'), releaseSigningKeyFingerprint:'FCF986EA15E6E293A5644F10B4322F04D67658D8',
  requiredInputKinds:['UPSTREAM_SOURCE_TARBALL','DETACHED_SIGNATURE','SIGNING_PUBLIC_KEY','COMPILER_TOOLCHAIN','BUILD_TOOL','SYSROOT_OR_BUILD_DEPENDENCY_CLOSURE','BUILD_CONFIGURATION'],
  requiredDecoderCapabilities:['demuxer:avi','demuxer:matroska','decoder:mpeg4','decoder:ffv1','decoder:pcm_s16le','decoder:pcm_s24le','protocol:file'],
  requireOfficialSourceArtifact:true,requireDetachedSignature:true,requireReleaseKeyFingerprint:true,requireAuthenticityVerification:true,requireCompleteBuildInputClosure:true,requireFreshBuildRoot:true,requireNetworkDisabledDuringBuild:true,requireSourceCompilation:true,requireNoCopiedDecoderBinary:true,requireBuildLogHash:true,requireBuiltExecutableHashes:true,requireOriginalFullDecode:true,requirePreservationDerivativeFullDecode:true,requireDecodedEquivalenceToAuthoritativeReceipts:true,appendOnlyIndependentRebuildRegister:true,originalStillRequired:true,preservationDerivativeStillRequired:true,
  allowNetworkFetchDuringBuild:false,allowCredentialCapture:false,allowHostDecoderBinaryCopy:false,allowInputClosureInference:false,autoPromoteIndependentProof:false,buildCanAuthorizeRelease:false,rebuildCanAuthorizeRelease:false,originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,publicRelease:false,relayDependency:false,
  proofRequirement:'complete-input-closure-plus-source-build-plus-authoritative-media-decode'
};

const mkArtifact=(kind,i)=>({artifactId:`artifact-${i}`,kind,origin:`proof://${kind.toLowerCase()}`,present:true,path:`inputs/${i}.bin`,sha256:h(String((i%9)+1)),size:100+i});
const artifacts=policy.requiredInputKinds.map(mkArtifact);
const authenticity={signatureVerified:true,signingKeyFingerprint:policy.releaseSigningKeyFingerprint,sourceArtifactSha256:artifacts.find(a=>a.kind==='UPSTREAM_SOURCE_TARBALL').sha256,verificationTool:'gpg-proof'};
const toolchain={compilerId:'gcc',compilerVersion:'gcc-proof-14',compilerSha256:h('b'),buildToolId:'make',buildToolVersion:'make-proof-4',buildToolSha256:h('c')};
const buildConfiguration={networkAllowed:false,credentialsAllowed:false,copyHostDecoderBinaries:false,configureArgs:['--disable-network','--disable-autodetect','--disable-doc','--disable-debug']};
const archive=buildBuildInputArchive({policy,artifacts,authenticity,toolchain,buildConfiguration,createdAt:'2026-08-13T20:00:00Z'});
const media=[
 {role:'ORIGINAL',sha256:h('d'),decodedVideoSha256:h('e'),decodedAudioSha256:h('f')},
 {role:'PRESERVATION_DERIVATIVE',sha256:h('1'),decodedVideoSha256:h('e'),decodedAudioSha256:h('f')},
];
const recipe=buildHermeticDecoderRecipe({policy,buildInputArchive:archive,authoritativeMedia:media,createdAt:'2026-08-13T20:01:00Z'});
const capabilities=policy.requiredDecoderCapabilities.map(capability=>({capability,present:true}));
const mediaResults=media.map(m=>({...m,expectedSha256:m.sha256,observedSha256:m.sha256,fullDecodePassed:true}));
const report=buildIndependentRebuildReport({policy,buildInputArchive:archive,recipe,startedAt:'2026-08-13T20:02:00Z',completedAt:'2026-08-13T20:10:00Z',buildEnvironment:{freshBuildRoot:true,networkDisabled:true,credentialsUsed:false,fullOsIsolationProven:true},buildResult:{sourceBuiltNotCopied:true,hostDecoderBinariesCopied:false,exitCode:0,buildLogSha256:h('2'),ffmpegSha256:h('3'),ffprobeSha256:h('4')},capabilityResults:capabilities,mediaResults});
const receipt=buildIndependentRebuildReceipt({policy,report,reportContext:{policy,buildInputArchive:archive,recipe},issuedAt:'2026-08-13T20:11:00Z'});

test('C1.24 policy requires complete signed source/build-input closure and remains release-inert',()=>{
  assert.equal(validateIndependentBuildPolicy(policy).valid,true);
  assert.equal(policy.publicRelease,false); assert.equal(policy.relayDependency,false);
});

test('acquisition status is fail-closed while official build inputs are missing',()=>{
  const missing=policy.requiredInputKinds.map((kind,i)=>({artifactId:`missing-${i}`,kind,origin:`expected://${kind}`,present:false,path:null,sha256:null,size:null}));
  const status=buildBuildInputAcquisitionStatus({policy,artifacts:missing,checkedAt:'2026-08-13T20:00:00Z'});
  assert.equal(validateBuildInputAcquisitionStatus(status,{policy}).valid,true);
  assert.equal(status.status,'BLOCKED_MISSING_BUILD_INPUTS'); assert.equal(status.missingKinds.length,7); assert.equal(status.fullIndependentSourceRebuildProven,false);
});

test('build input archive requires every exact input plus verified release-signing fingerprint',()=>{
  assert.equal(validateBuildInputArchive(archive,{policy}).valid,true);
  const bad=structuredClone(archive); bad.authenticity.signingKeyFingerprint='A'.repeat(40); bad.archiveHash=digestJson(Object.fromEntries(Object.entries(bad).filter(([k])=>k!=='archiveHash')));
  assert.throws(()=>validateBuildInputArchive(bad,{policy}),/source authenticity drift/);
});

test('build input archive rejects missing dependency closure instead of inferring it',()=>{
  const reduced=artifacts.filter(a=>a.kind!=='SYSROOT_OR_BUILD_DEPENDENCY_CLOSURE');
  assert.throws(()=>buildBuildInputArchive({policy,artifacts:reduced,authenticity,toolchain,buildConfiguration,createdAt:'2026-08-13T20:00:00Z'}),/every required input kind/);
});

test('hermetic recipe is offline, source-build-only, and binds authoritative decode hashes',()=>{
  assert.equal(validateHermeticDecoderRecipe(recipe,{policy,buildInputArchive:archive}).valid,true);
  assert.equal(recipe.networkAllowedDuringBuild,false); assert.equal(recipe.copyHostDecoderBinaries,false); assert.equal(recipe.authoritativeMedia.length,2);
});

test('independent rebuild PASS requires source compilation, all capabilities, exact media bytes, and decoded equivalence',()=>{
  assert.equal(validateIndependentRebuildReport(report,{policy,buildInputArchive:archive,recipe}).valid,true);
  assert.equal(report.status,'PASS_INDEPENDENT_SOURCE_REBUILD'); assert.equal(report.fullIndependentSourceRebuildProven,true);
});

test('copied host decoder binaries can never become an independent source rebuild',()=>{
  const bad=buildIndependentRebuildReport({policy,buildInputArchive:archive,recipe,startedAt:'2026-08-13T20:02:00Z',completedAt:'2026-08-13T20:10:00Z',buildEnvironment:{freshBuildRoot:true,networkDisabled:true,credentialsUsed:false,fullOsIsolationProven:false},buildResult:{sourceBuiltNotCopied:false,hostDecoderBinariesCopied:true,exitCode:0,buildLogSha256:h('2'),ffmpegSha256:h('3'),ffprobeSha256:h('4')},capabilityResults:capabilities,mediaResults});
  assert.equal(bad.status,'FAIL'); assert.equal(bad.fullIndependentSourceRebuildProven,false);
  assert.throws(()=>validateIndependentRebuildReport(bad,{policy,buildInputArchive:archive,recipe}),/did not compile from source/);
});

test('independent rebuild rejects missing required decoder capability or decoded-content drift',()=>{
  const caps=capabilities.map(x=>({...x})); caps[0].present=false;
  const badCaps=buildIndependentRebuildReport({policy,buildInputArchive:archive,recipe,startedAt:'2026-08-13T20:02:00Z',completedAt:'2026-08-13T20:10:00Z',buildEnvironment:{freshBuildRoot:true,networkDisabled:true,credentialsUsed:false,fullOsIsolationProven:true},buildResult:{sourceBuiltNotCopied:true,hostDecoderBinariesCopied:false,exitCode:0,buildLogSha256:h('2'),ffmpegSha256:h('3'),ffprobeSha256:h('4')},capabilityResults:caps,mediaResults});
  assert.equal(badCaps.status,'FAIL');
  const drift=mediaResults.map(x=>({...x})); drift[1].decodedVideoSha256=h('9');
  const badMedia=buildIndependentRebuildReport({policy,buildInputArchive:archive,recipe,startedAt:'2026-08-13T20:02:00Z',completedAt:'2026-08-13T20:10:00Z',buildEnvironment:{freshBuildRoot:true,networkDisabled:true,credentialsUsed:false,fullOsIsolationProven:true},buildResult:{sourceBuiltNotCopied:true,hostDecoderBinariesCopied:false,exitCode:0,buildLogSha256:h('2'),ffmpegSha256:h('3'),ffprobeSha256:h('4')},capabilityResults:capabilities,mediaResults:drift});
  assert.equal(badMedia.status,'FAIL');
});

test('independent rebuild receipt can only be issued from a fully passing report and remains release-inert',()=>{
  assert.equal(validateIndependentRebuildReceipt(receipt,{policy,report,reportContext:{policy,buildInputArchive:archive,recipe}}).valid,true);
  assert.equal(receipt.fullIndependentSourceRebuildProven,true); assert.equal(receipt.publicRelease,false); assert.equal(receipt.relayDependency,false);
});

test('C1.24 append-only register requires build-input archive before the rebuild receipt',()=>{
  const ctx={policy,sourceC23ReproDecodeRegisterHash:policy.sourceC23ReproDecodeRegisterHash};
  let reg=buildIndependentRebuildRegister({...ctx,recordedAt:'2026-08-13T20:00:00Z'});
  assert.throws(()=>appendIndependentRebuildReceipt({register:reg,receipt,receiptContext:{policy,report,reportContext:{policy,buildInputArchive:archive,recipe}},registerContext:ctx,recordedAt:'2026-08-13T20:12:00Z'}),/registered build input archive/);
  reg=appendBuildInputArchive({register:reg,buildInputArchive:archive,archiveContext:{policy},registerContext:ctx,recordedAt:'2026-08-13T20:01:00Z'});
  reg=appendIndependentRebuildReceipt({register:reg,receipt,receiptContext:{policy,report,reportContext:{policy,buildInputArchive:archive,recipe}},registerContext:ctx,recordedAt:'2026-08-13T20:12:00Z'});
  assert.equal(validateIndependentRebuildRegister(reg,ctx).valid,true); assert.equal(reg.fullIndependentSourceRebuildProven,true); assert.equal(reg.publicRelease,false);
});

test('register detects history tampering and duplicate evidence',()=>{
  const ctx={policy,sourceC23ReproDecodeRegisterHash:policy.sourceC23ReproDecodeRegisterHash};
  let reg=buildIndependentRebuildRegister({...ctx,recordedAt:'2026-08-13T20:00:00Z'});
  reg=appendBuildInputArchive({register:reg,buildInputArchive:archive,archiveContext:{policy},registerContext:ctx,recordedAt:'2026-08-13T20:01:00Z'});
  assert.throws(()=>appendBuildInputArchive({register:reg,buildInputArchive:archive,archiveContext:{policy},registerContext:ctx,recordedAt:'2026-08-13T20:02:00Z'}),/already registered/);
  const tampered=structuredClone(reg); tampered.entries[0].sourceVersion='9.9.9';
  assert.throws(()=>validateIndependentRebuildRegister(tampered,ctx),/self-hash mismatch|chain invalid/);
});

test('canonical C1.24 state remains revision 0 while the physical input closure is now complete',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const dir=resolve(root,'fixtures/cineswarm');
  const p=JSON.parse(readFileSync(resolve(dir,'pn-0001-c1-24-independent-build-policy.json'),'utf8'));
  const s=JSON.parse(readFileSync(resolve(dir,'pn-0001-c1-24-build-input-status.json'),'utf8'));
  const r=JSON.parse(readFileSync(resolve(dir,'pn-0001-c1-24-independent-rebuild-register.json'),'utf8'));
  assert.equal(validateIndependentBuildPolicy(p).valid,true);
  assert.equal(validateBuildInputAcquisitionStatus(s,{policy:p}).valid,true);
  assert.equal(validateIndependentRebuildRegister(r,{policy:p,sourceC23ReproDecodeRegisterHash:p.sourceC23ReproDecodeRegisterHash}).valid,true);
  const state=classifyIndependentRebuildState({policy:p,register:r,sourceC23ReproDecodeRegisterHash:p.sourceC23ReproDecodeRegisterHash,acquisitionStatus:s});
  assert.equal(state.registerRevision,0);
  assert.equal(state.fullIndependentSourceRebuildProven,false);
  assert.equal(state.buildInputsReady,true);
  assert.deepEqual(state.missingBuildInputKinds,[]);
  assert.equal(state.publicRelease,false);
  assert.equal(state.relayDependency,false);
});

const fullPhysicalAcquisitionProofAvailable = [
  'ffmpeg-7.1.5.tar.xz',
  'sysroot.tar.xz',
  'buildtools.tar',
  'toolchain.tar.xz',
].every((name)=>existsSync(resolve(import.meta.dirname,'../../../proof/c1-24/real-input-acquisition',name)));

test('C1.24B acquisition checkpoint preserves all seven physical input classes byte-for-byte', {
  skip: fullPhysicalAcquisitionProofAvailable ? false : 'sealed heavyweight acquisition archives intentionally omitted from public Git',
},()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const dir=resolve(root,'fixtures/cineswarm');
  const p=JSON.parse(readFileSync(resolve(dir,'pn-0001-c1-24-independent-build-policy.json'),'utf8'));
  const s=JSON.parse(readFileSync(resolve(dir,'pn-0001-c1-24-build-input-status.json'),'utf8'));
  assert.equal(validateBuildInputAcquisitionStatus(s,{policy:p}).valid,true);
  assert.deepEqual(s.missingKinds,[]);
  assert.equal(s.artifacts.filter(a=>a.present===true).length,7);
  assert.equal(s.status,'READY_TO_BUILD_INPUT_ARCHIVE');
  assert.equal(s.fullIndependentSourceRebuildProven,false);
  for(const a of s.artifacts){
    const path=resolve(root,a.path);
    assert.equal(existsSync(path),true,`${a.kind} evidence file must exist`);
    assert.equal(statSync(path).size,a.size,`${a.kind} byte size must match descriptor`);
    const observed=createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.equal(observed,a.sha256,`${a.kind} SHA-256 must match descriptor`);
  }
  const source=s.artifacts.find(a=>a.kind==='UPSTREAM_SOURCE_TARBALL');
  assert.equal(source.size,11050340);
  assert.equal(source.sha256,'de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f');
});

test('C1.24B source ingest receipt proves exact source hash, size, fingerprint, and detached-signature verification',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const dir=resolve(root,'proof/c1-24/real-input-acquisition');
  const p=JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json'),'utf8'));
  const receipt=JSON.parse(readFileSync(resolve(dir,'C1_24_SOURCE_INGEST_RECEIPT.json'),'utf8'));
  const unhashed=structuredClone(receipt); delete unhashed.receiptHash;
  assert.equal(digestJson(unhashed),receipt.receiptHash);
  assert.equal(receipt.sourceArtifactSha256,'de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f');
  assert.equal(receipt.sourceArtifactSize,11050340);
  assert.equal(receipt.detachedSignatureSha256,'7ce4b9d56e3ef0cd4c3a9c0b2c8a034ac91e6c4c011c1f10b05a8aa7292fca35');
  assert.equal(receipt.releaseSigningKeyFingerprint,p.releaseSigningKeyFingerprint);
  assert.equal(receipt.signatureVerified,true);
  assert.equal(receipt.publicRelease,false);
  assert.equal(receipt.relayDependency,false);
});

test('C1.24B wrong-source ingest is fail-closed and cannot mutate the current 7/7 status or good ingest receipt',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const statusPath=resolve(root,'fixtures/cineswarm/pn-0001-c1-24-build-input-status.json');
  const receiptPath=resolve(root,'proof/c1-24/real-input-acquisition/C1_24_SOURCE_INGEST_RECEIPT.json');
  const beforeStatus=readFileSync(statusPath,'utf8');
  const beforeReceipt=readFileSync(receiptPath,'utf8');
  const temp=mkdtempSync(resolve(tmpdir(),'c124-bad-source-'));
  try{
    const bad=resolve(temp,'ffmpeg-7.1.5.tar.xz');
    writeFileSync(bad,'not-the-governed-source-artifact');
    const result=spawnSync(process.execPath,[resolve(root,'scripts/cineswarm-c1-24-ingest-source-artifact.mjs'),bad,root],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/size mismatch|SHA-256 mismatch/);
    assert.equal(readFileSync(statusPath,'utf8'),beforeStatus);
    assert.equal(readFileSync(receiptPath,'utf8'),beforeReceipt);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

test('C1.24B governed build configuration enforces syscall-level network denial',(t)=>{
  if(process.platform!=='linux'){
    t.skip('governed network-denial artifact is an x86-64 Linux ELF proof; execute this assertion on Linux CI');
    return;
  }
  const root=resolve(import.meta.dirname,'../../..');
  const status=JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm/pn-0001-c1-24-build-input-status.json'),'utf8'));
  const config=status.artifacts.find(a=>a.kind==='BUILD_CONFIGURATION');
  const temp=mkdtempSync(resolve(tmpdir(),'c124-config-test-'));
  try{
    const extracted=spawnSync('tar',['-xf',resolve(root,config.path),'-C',temp],{encoding:'utf8'});
    assert.equal(extracted.status,0,extracted.stderr);
    const denied=spawnSync(resolve(temp,'network-deny'),[resolve(temp,'network-probe')],{encoding:'utf8'});
    assert.equal(denied.status,0,denied.stderr);
    assert.match(denied.stdout,/C1\.24_NETWORK_SYSCALL_BLOCKED:EPERM/);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

test('C1.24B stable real independent-source proof validates end-to-end and matches its saved build log',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const fixture=resolve(root,'fixtures/cineswarm');
  const proof=resolve(root,'proof/c1-24/real-independent-rebuild');
  const p=JSON.parse(readFileSync(resolve(fixture,'pn-0001-c1-24-independent-build-policy.json'),'utf8'));
  const a=JSON.parse(readFileSync(resolve(proof,'BUILD_INPUT_ARCHIVE.json'),'utf8'));
  const recipe=JSON.parse(readFileSync(resolve(proof,'HERMETIC_BUILD_RECIPE.json'),'utf8'));
  const report=JSON.parse(readFileSync(resolve(proof,'INDEPENDENT_REBUILD_REPORT.json'),'utf8'));
  const receipt=JSON.parse(readFileSync(resolve(proof,'INDEPENDENT_REBUILD_RECEIPT.json'),'utf8'));
  const reg=JSON.parse(readFileSync(resolve(proof,'PROOF_REGISTER.json'),'utf8'));
  assert.equal(validateBuildInputArchive(a,{policy:p}).valid,true);
  assert.equal(validateHermeticDecoderRecipe(recipe,{policy:p,buildInputArchive:a}).valid,true);
  assert.equal(validateIndependentRebuildReport(report,{policy:p,buildInputArchive:a,recipe}).valid,true);
  assert.equal(validateIndependentRebuildReceipt(receipt,{policy:p,report,reportContext:{policy:p,buildInputArchive:a,recipe}}).valid,true);
  assert.equal(validateIndependentRebuildRegister(reg,{policy:p,sourceC23ReproDecodeRegisterHash:p.sourceC23ReproDecodeRegisterHash}).valid,true);
  assert.equal(createHash('sha256').update(readFileSync(resolve(proof,'BUILD.log'))).digest('hex'),report.buildResult.buildLogSha256);
  assert.equal(report.status,'PASS_INDEPENDENT_SOURCE_REBUILD');
  assert.equal(report.fullIndependentSourceRebuildProven,true);
  assert.equal(receipt.fullIndependentSourceRebuildProven,true);
  assert.equal(receipt.fullOsIsolationProven,false);
  assert.equal(reg.fullIndependentSourceRebuildProven,true);
  assert.equal(reg.publicRelease,false);
  assert.equal(reg.relayDependency,false);
});

test('C1.24B real proof does not silently auto-promote the canonical register',()=>{
  const root=resolve(import.meta.dirname,'../../..');
  const canonical=JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json'),'utf8'));
  const proof=JSON.parse(readFileSync(resolve(root,'proof/c1-24/real-independent-rebuild/PROOF_REGISTER.json'),'utf8'));
  assert.equal(proof.fullIndependentSourceRebuildProven,true);
  assert.equal(canonical.revision,0);
  assert.equal(canonical.entryCount,0);
  assert.equal(canonical.fullIndependentSourceRebuildProven,false);
  assert.equal(canonical.publicRelease,false);
  assert.equal(canonical.relayDependency,false);
});
