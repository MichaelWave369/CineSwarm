import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateReproDecodePolicy, buildDecoderSbom, validateDecoderSbom,
  buildRebuildRecipe, validateRebuildRecipe, buildDecodeCapsule, validateDecodeCapsule,
  buildReconstructionReport, validateReconstructionReport, buildReproDecodeRegister,
  validateReproDecodeRegister, appendDecoderSbom, appendDecodeCapsule, appendReconstructionProof,
  classifyReproDecodeState,
} from '../src/reproducible-decode-capsule.js';

const repo = resolve(import.meta.dirname, '../../..');
const read = p => JSON.parse(readFileSync(resolve(repo,p),'utf8'));
const basePolicy = read('fixtures/cineswarm/pn-0001-c1-23-repro-decode-policy.json');
const proof = read('C1_22_OPERATIONAL_PROOF.json');
const c22Policy = read('fixtures/cineswarm/pn-0001-c1-22-decode-access-policy.json');
const c = proof.c21SyntheticContext;
const derivativeContext = { policy:c.policy, plan:c.plan, assessment:c.assessment, equivalenceReport:c.equivalenceReport, review:c.review, ceremony:c.ceremony, keyRegistry:c.keyRegistry };
const matrixContext = { policy:c22Policy, environmentSnapshot:proof.environmentSnapshot, c21Policy:c.policy, c21Register:c.register, c21SourceC20PreservationRegisterHash:c.sourceC20PreservationRegisterHash, derivativeRecord:c.derivativeRecord, derivativeContext };
const policy = {...basePolicy, sourceEnvironmentSnapshotHash:proof.environmentSnapshot.snapshotHash, c22Policy};

function fixture(){
  const components=[
    {componentId:'ffmpeg-bin',name:'ffmpeg',version:proof.environmentSnapshot.environment.ffmpeg.versionLine,path:proof.environmentSnapshot.environment.ffmpeg.executablePath,sha256:proof.environmentSnapshot.environment.ffmpeg.executableSha256,kind:'executable',package:{name:'ffmpeg',version:'7:7.1.5-0+deb13u1'}},
    {componentId:'ffprobe-bin',name:'ffprobe',version:proof.environmentSnapshot.environment.ffprobe.versionLine,path:proof.environmentSnapshot.environment.ffprobe.executablePath,sha256:proof.environmentSnapshot.environment.ffprobe.executableSha256,kind:'executable',package:{name:'ffmpeg',version:'7:7.1.5-0+deb13u1'}},
    {componentId:'libavcodec',name:'libavcodec.so',version:'61',path:'/usr/lib/x86_64-linux-gnu/libavcodec.so.61',sha256:'1'.repeat(64),kind:'shared-library',package:{name:'libavcodec61',version:'7:7.1.5-0+deb13u1'}},
  ];
  const packages=[{name:'ffmpeg',version:'7:7.1.5-0+deb13u1'},{name:'libavcodec61',version:'7:7.1.5-0+deb13u1'}];
  const sbom=buildDecoderSbom({policy,environmentSnapshot:proof.environmentSnapshot,os:{id:'debian',versionId:'13',prettyName:'Debian GNU/Linux 13'},components,packages,capturedAt:'2026-08-13T21:50:00.000Z',sbomId:'proof-sbom'});
  const recipe=buildRebuildRecipe({policy,sbom,environmentSnapshot:proof.environmentSnapshot,createdAt:'2026-08-13T21:51:00.000Z',recipeId:'proof-recipe'});
  const capsule=buildDecodeCapsule({policy,environmentSnapshot:proof.environmentSnapshot,compatibilityMatrix:proof.compatibilityMatrix,compatibilityMatrixContext:matrixContext,sbom,recipe,authoritativeMedia:[{role:'ORIGINAL',assetId:'proof-original',sha256:proof.sourceOriginal.sha256,relativePath:proof.sourceOriginal.path},{role:'PRESERVATION_DERIVATIVE',assetId:'proof-preservation',sha256:proof.preservationDerivative.sha256,relativePath:proof.preservationDerivative.path}],createdAt:'2026-08-13T21:52:00.000Z',capsuleId:'proof-capsule'});
  const capsuleContext={policy,environmentSnapshot:proof.environmentSnapshot,compatibilityMatrix:proof.compatibilityMatrix,compatibilityMatrixContext:matrixContext,sbom,recipe};
  const report=buildReconstructionReport({policy,capsule,capsuleContext,reconstructedEnvironment:{ffmpegExecutableSha256:proof.environmentSnapshot.environment.ffmpeg.executableSha256,ffprobeExecutableSha256:proof.environmentSnapshot.environment.ffprobe.executableSha256,capabilityHash:proof.environmentSnapshot.capabilityHash,freshWorkingDirectory:true,isolatedPath:true},mediaResults:[{role:'ORIGINAL',expectedSha256:proof.sourceOriginal.sha256,observedSha256:proof.sourceOriginal.sha256,fullDecodePassed:true},{role:'PRESERVATION_DERIVATIVE',expectedSha256:proof.preservationDerivative.sha256,observedSha256:proof.preservationDerivative.sha256,fullDecodePassed:true}],startedAt:'2026-08-13T21:53:00.000Z',completedAt:'2026-08-13T21:54:00.000Z',reportId:'proof-reconstruction'});
  return {sbom,recipe,capsule,capsuleContext,report};
}

test('C1.23 policy remains fail-closed and does not overclaim a full independent rebuild',()=>{
  assert.equal(validateReproDecodePolicy(policy).valid,true);
  assert.equal(policy.claimFullIndependentSourceRebuildFromLocalProof,false);
  assert.equal(policy.publicRelease,false);
  const bad={...policy,claimFullIndependentSourceRebuildFromLocalProof:true};
  assert.throws(()=>validateReproDecodePolicy(bad),/must remain false/);
});

test('decoder SBOM binds exact C1.22 environment executable hashes and linked libraries',()=>{
  const f=fixture(); assert.equal(validateDecoderSbom(f.sbom,{policy,environmentSnapshot:proof.environmentSnapshot}).valid,true);
  assert.equal(f.sbom.components.some(c=>c.kind==='shared-library'),true);
  assert.equal(f.sbom.components.find(c=>c.name==='ffmpeg').sha256,proof.environmentSnapshot.environment.ffmpeg.executableSha256);
});

test('SBOM rejects executable drift and unknown-field tampering',()=>{
  const f=fixture();
  const bad=structuredClone(f.sbom); bad.components.find(c=>c.name==='ffmpeg').sha256='2'.repeat(64);
  assert.throws(()=>validateDecoderSbom(bad,{policy,environmentSnapshot:proof.environmentSnapshot}),/ffmpeg executable mismatch|self-hash/);
  const extra=structuredClone(f.sbom); extra.untrusted=true;
  assert.throws(()=>validateDecoderSbom(extra,{policy,environmentSnapshot:proof.environmentSnapshot}),/self-hash/);
});

test('rebuild recipe is exact, offline, and explicitly scoped to local runtime reconstruction',()=>{
  const f=fixture(); assert.equal(validateRebuildRecipe(f.recipe,{policy,sbom:f.sbom,environmentSnapshot:proof.environmentSnapshot}).valid,true);
  assert.equal(f.recipe.networkFetchAllowed,false); assert.equal(f.recipe.fullIndependentSourceRebuildExpected,false);
  const bad=structuredClone(f.recipe); bad.networkFetchAllowed=true;
  assert.throws(()=>validateRebuildRecipe(bad,{policy,sbom:f.sbom,environmentSnapshot:proof.environmentSnapshot}),/boundary drift|self-hash/);
});

test('decode capsule binds PASS C1.22 compatibility evidence plus original and preservation hashes',()=>{
  const f=fixture(); assert.equal(validateDecodeCapsule(f.capsule,f.capsuleContext).valid,true);
  assert.deepEqual(new Set(f.capsule.authoritativeMedia.map(x=>x.role)),new Set(['ORIGINAL','PRESERVATION_DERIVATIVE']));
  const bad=structuredClone(f.capsule); bad.authoritativeMedia[0].sha256='3'.repeat(64);
  assert.throws(()=>validateDecodeCapsule(bad,f.capsuleContext),/self-hash/);
});

test('reconstruction PASS requires exact executables, capability fingerprint, media bytes, and full decode',()=>{
  const f=fixture(); assert.equal(validateReconstructionReport(f.report,{policy,capsule:f.capsule,capsuleContext:f.capsuleContext}).valid,true);
  assert.equal(f.report.status,'PASS_LOCAL_RUNTIME_RECONSTRUCTION'); assert.equal(f.report.fullIndependentSourceRebuildProven,false);
});

test('reconstruction rejects media or capability drift',()=>{
  const f=fixture();
  const badMedia=structuredClone(f.report); badMedia.mediaResults[0].observedSha256='4'.repeat(64);
  assert.throws(()=>validateReconstructionReport(badMedia,{policy,capsule:f.capsule,capsuleContext:f.capsuleContext}),/media validation failed|self-hash/);
  const badCap=structuredClone(f.report); badCap.reconstructedEnvironment.capabilityHash='5'.repeat(64);
  assert.throws(()=>validateReconstructionReport(badCap,{policy,capsule:f.capsule,capsuleContext:f.capsuleContext}),/did not pass|self-hash/);
});

test('C1.23 append-only register records SBOM, capsule, and reconstruction without release authority',()=>{
  const f=fixture(); const rc={policy,sourceC22DecodeAccessRegisterHash:proof.proofRegister.registerHash};
  let r=buildReproDecodeRegister({...rc,entries:[],revision:0,recordedAt:'2026-08-13T21:55:00.000Z',registerId:'proof-c1-23-register'});
  r=appendDecoderSbom({register:r,sbom:f.sbom,sbomContext:{policy,environmentSnapshot:proof.environmentSnapshot},registerContext:rc,recordedAt:'2026-08-13T21:56:00.000Z'});
  r=appendDecodeCapsule({register:r,capsule:f.capsule,capsuleContext:f.capsuleContext,registerContext:rc,recordedAt:'2026-08-13T21:57:00.000Z'});
  r=appendReconstructionProof({register:r,report:f.report,reportContext:{policy,capsule:f.capsule,capsuleContext:f.capsuleContext},registerContext:rc,recordedAt:'2026-08-13T21:58:00.000Z'});
  assert.equal(validateReproDecodeRegister(r,rc).valid,true); assert.equal(r.revision,3); assert.equal(r.publicRelease,false);
  assert.equal(classifyReproDecodeState({...rc,register:r}).fullIndependentSourceRebuildProven,false);
});

test('C1.23 register detects historical tampering and duplicate evidence',()=>{
  const f=fixture(); const rc={policy,sourceC22DecodeAccessRegisterHash:proof.proofRegister.registerHash};
  let r=buildReproDecodeRegister({...rc,entries:[],revision:0,recordedAt:'2026-08-13T21:55:00.000Z'});
  r=appendDecoderSbom({register:r,sbom:f.sbom,sbomContext:{policy,environmentSnapshot:proof.environmentSnapshot},registerContext:rc,recordedAt:'2026-08-13T21:56:00.000Z'});
  assert.throws(()=>appendDecoderSbom({register:r,sbom:f.sbom,sbomContext:{policy,environmentSnapshot:proof.environmentSnapshot},registerContext:rc,recordedAt:'2026-08-13T21:57:00.000Z'}),/already registered/);
  const bad=structuredClone(r); bad.entries[0].sbomHash='6'.repeat(64);
  assert.throws(()=>validateReproDecodeRegister(bad,rc),/entry self-hash|register self-hash/);
});

test('canonical C1.23 register remains revision 0 because PN-0001 has no governed C1.22 decode history',()=>{
  const canonical=read('fixtures/cineswarm/pn-0001-c1-23-repro-decode-register.json');
  const canonicalPolicy=read('fixtures/cineswarm/pn-0001-c1-23-repro-decode-policy.json');
  const source=read('fixtures/cineswarm/pn-0001-c1-22-decode-access-register.json').registerHash;
  assert.equal(validateReproDecodePolicy(canonicalPolicy).valid,true);
  assert.equal(validateReproDecodeRegister(canonical,{policy:canonicalPolicy,sourceC22DecodeAccessRegisterHash:source}).valid,true);
  const status=classifyReproDecodeState({policy:canonicalPolicy,register:canonical,sourceC22DecodeAccessRegisterHash:source});
  assert.equal(status.registerRevision,0); assert.equal(status.reconstructionProofs,0); assert.equal(status.publicRelease,false); assert.equal(status.relayDependency,false);
});
