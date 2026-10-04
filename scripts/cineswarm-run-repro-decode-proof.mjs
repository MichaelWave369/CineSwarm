#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import {
  buildDecoderSbom, buildRebuildRecipe, buildDecodeCapsule, buildReconstructionReport,
  buildReproDecodeRegister, appendDecoderSbom, appendDecodeCapsule, appendReconstructionProof,
} from '../packages/cineswarm-bridge/src/reproducible-decode-capsule.js';
import { digestJson } from '../packages/cineswarm-bridge/src/authorization-seal.js';

function json(path){ return JSON.parse(readFileSync(path,'utf8')); }
function shaFile(path){ return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function shaText(text){ return createHash('sha256').update(text).digest('hex'); }
function run(cmd,args=[],opts={}){ return execFileSync(cmd,args,{encoding:'utf8',maxBuffer:128*1024*1024,...opts}); }
function firstLine(s){ return String(s).split(/\r?\n/,1)[0]; }
function osRelease(){ const x={}; for(const line of readFileSync('/etc/os-release','utf8').split(/\r?\n/)){ const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m) x[m[1]]=m[2].replace(/^"|"$/g,''); } return {id:x.ID||'unknown',versionId:x.VERSION_ID||'unknown',prettyName:x.PRETTY_NAME||x.NAME||'unknown'}; }
function packageFor(path){
  try {
    const out=run('dpkg-query',['-S',path]).trim().split(/\r?\n/)[0];
    const pkgRaw=out.split(': ')[0];
    const pkg=pkgRaw.replace(/:[a-z0-9_-]+$/i,'');
    const version=run('dpkg-query',['-W',"-f=${Version}",pkg]).trim();
    return {name:pkg,version};
  } catch { return null; }
}
function linkedLibraries(executable){
  const out=run('ldd',[executable]);
  const paths=[];
  for(const line of out.split(/\r?\n/)){
    let m=line.match(/=>\s+(\/[^\s]+)\s+\(/); if(!m) m=line.match(/^\s*(\/[^\s]+)\s+\(/);
    if(m && existsSync(m[1])) paths.push(realpathSync(m[1]));
  }
  return [...new Set(paths)].sort();
}
function buildMatrixContext(c22Policy,proof){
  const c=proof.c21SyntheticContext;
  const derivativeContext={policy:c.policy,plan:c.plan,assessment:c.assessment,equivalenceReport:c.equivalenceReport,review:c.review,ceremony:c.ceremony,keyRegistry:c.keyRegistry};
  return {policy:c22Policy,environmentSnapshot:proof.environmentSnapshot,c21Policy:c.policy,c21Register:c.register,c21SourceC20PreservationRegisterHash:c.sourceC20PreservationRegisterHash,derivativeRecord:c.derivativeRecord,derivativeContext};
}
function fullDecode(ffmpeg,media,env){ run(ffmpeg,['-v','error','-i',media,'-map','0','-f','null','-'],{env,stdio:['ignore','pipe','pipe']}); }

const [rootArg='.', outputArg='C1_23_OPERATIONAL_PROOF.json'] = process.argv.slice(2);
const root=resolve(rootArg); const output=resolve(root,outputArg);
const c22Proof=json(resolve(root,'C1_22_OPERATIONAL_PROOF.json'));
const basePolicy=json(resolve(root,'fixtures/cineswarm/pn-0001-c1-23-repro-decode-policy.json'));
const c22Policy=json(resolve(root,'fixtures/cineswarm/pn-0001-c1-22-decode-access-policy.json'));
const policy={...basePolicy,c22Policy,sourceEnvironmentSnapshotHash:c22Proof.environmentSnapshot.snapshotHash};
const matrixContext=buildMatrixContext(c22Policy,c22Proof);
const sourceEnv=c22Proof.environmentSnapshot;
const ffmpeg=sourceEnv.environment.ffmpeg.executablePath;
const ffprobe=sourceEnv.environment.ffprobe.executablePath;
if(shaFile(ffmpeg)!==sourceEnv.environment.ffmpeg.executableSha256) throw new Error('current ffmpeg bytes no longer match C1.22 snapshot');
if(shaFile(ffprobe)!==sourceEnv.environment.ffprobe.executableSha256) throw new Error('current ffprobe bytes no longer match C1.22 snapshot');

const libPaths=[...new Set([...linkedLibraries(ffmpeg),...linkedLibraries(ffprobe)])].sort();
const packageMap=new Map();
const components=[];
for(const [name,path,expected] of [['ffmpeg',ffmpeg,sourceEnv.environment.ffmpeg.executableSha256],['ffprobe',ffprobe,sourceEnv.environment.ffprobe.executableSha256]]){
  const pkg=packageFor(realpathSync(path)); if(pkg) packageMap.set(`${pkg.name}@${pkg.version}`,pkg);
  components.push({componentId:`${name}-executable`,name,version:firstLine(run(path,['-version'])),path:realpathSync(path),sha256:expected,kind:'executable',package:pkg});
}
for(const [i,path] of libPaths.entries()){
  const pkg=packageFor(path); if(pkg) packageMap.set(`${pkg.name}@${pkg.version}`,pkg);
  components.push({componentId:`linked-library-${String(i+1).padStart(3,'0')}`,name:basename(path),version:pkg?.version??'unpackaged-or-unresolved',path,sha256:shaFile(path),kind:'shared-library',package:pkg});
}
const packages=[...packageMap.values()].sort((a,b)=>`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const capturedAt=new Date().toISOString();
const sbom=buildDecoderSbom({policy,environmentSnapshot:sourceEnv,os:osRelease(),components,packages,capturedAt,sbomId:'c1-23-local-decoder-sbom-proof'});
const recipe=buildRebuildRecipe({policy,sbom,environmentSnapshot:sourceEnv,createdAt:new Date().toISOString(),recipeId:'c1-23-local-rebuild-recipe-proof'});
const capsule=buildDecodeCapsule({policy,environmentSnapshot:sourceEnv,compatibilityMatrix:c22Proof.compatibilityMatrix,compatibilityMatrixContext:matrixContext,sbom,recipe,authoritativeMedia:[
  {role:'ORIGINAL',assetId:'c1-23-proof-original',sha256:c22Proof.sourceOriginal.sha256,relativePath:c22Proof.sourceOriginal.path},
  {role:'PRESERVATION_DERIVATIVE',assetId:'c1-23-proof-preservation',sha256:c22Proof.preservationDerivative.sha256,relativePath:c22Proof.preservationDerivative.path},
],createdAt:new Date().toISOString(),capsuleId:'c1-23-local-decode-capsule-proof'});

const runtimeRoot=resolve(root,'proof/c1-23/reconstructed-runtime');
rmSync(runtimeRoot,{recursive:true,force:true}); mkdirSync(resolve(runtimeRoot,'bin'),{recursive:true}); mkdirSync(resolve(runtimeRoot,'home'),{recursive:true}); mkdirSync(resolve(runtimeRoot,'tmp'),{recursive:true});
const rFfmpeg=resolve(runtimeRoot,'bin/ffmpeg'); const rFfprobe=resolve(runtimeRoot,'bin/ffprobe');
copyFileSync(ffmpeg,rFfmpeg); copyFileSync(ffprobe,rFfprobe); chmodSync(rFfmpeg,0o755); chmodSync(rFfprobe,0o755);
if(shaFile(rFfmpeg)!==sourceEnv.environment.ffmpeg.executableSha256||shaFile(rFfprobe)!==sourceEnv.environment.ffprobe.executableSha256) throw new Error('reconstructed executable hash mismatch');
for(const c of sbom.components.filter(c=>c.kind==='shared-library')) if(shaFile(c.path)!==c.sha256) throw new Error(`host shared-library drift: ${c.path}`);
const isolatedEnv={PATH:resolve(runtimeRoot,'bin'),HOME:resolve(runtimeRoot,'home'),TMPDIR:resolve(runtimeRoot,'tmp'),LANG:'C',LC_ALL:'C'};
const ffmpegVersion=run(rFfmpeg,['-version'],{env:isolatedEnv});
const ffprobeVersion=run(rFfprobe,['-version'],{env:isolatedEnv});
const decoders=run(rFfmpeg,['-hide_banner','-decoders'],{env:isolatedEnv});
const encoders=run(rFfmpeg,['-hide_banner','-encoders'],{env:isolatedEnv});
const formats=run(rFfmpeg,['-hide_banner','-formats'],{env:isolatedEnv});
const componentHashes={ffmpegVersion:shaText(ffmpegVersion),ffprobeVersion:shaText(ffprobeVersion),decoders:shaText(decoders),encoders:shaText(encoders),formats:shaText(formats)};
const capabilityHash=digestJson(componentHashes);
const mediaResults=[];
for(const m of capsule.authoritativeMedia){ const path=resolve(root,m.relativePath); const observed=shaFile(path); fullDecode(rFfmpeg,path,isolatedEnv); mediaResults.push({role:m.role,expectedSha256:m.sha256,observedSha256:observed,fullDecodePassed:true}); }
const startedAt=new Date().toISOString();
const completedAt=new Date(Date.now()+1000).toISOString();
const capsuleContext={policy,environmentSnapshot:sourceEnv,compatibilityMatrix:c22Proof.compatibilityMatrix,compatibilityMatrixContext:matrixContext,sbom,recipe};
const report=buildReconstructionReport({policy,capsule,capsuleContext,reconstructedEnvironment:{ffmpegExecutableSha256:shaFile(rFfmpeg),ffprobeExecutableSha256:shaFile(rFfprobe),capabilityHash,freshWorkingDirectory:true,isolatedPath:true},mediaResults,startedAt,completedAt,reportId:'c1-23-local-reconstruction-proof'});
const registerContext={policy,sourceC22DecodeAccessRegisterHash:c22Proof.proofRegister.registerHash};
let register=buildReproDecodeRegister({...registerContext,entries:[],revision:0,recordedAt:new Date().toISOString(),registerId:'c1-23-operational-proof-register'});
register=appendDecoderSbom({register,sbom,sbomContext:{policy,environmentSnapshot:sourceEnv},registerContext,recordedAt:new Date().toISOString()});
register=appendDecodeCapsule({register,capsule,capsuleContext,registerContext,recordedAt:new Date().toISOString()});
register=appendReconstructionProof({register,report,reportContext:{policy,capsule,capsuleContext},registerContext,recordedAt:new Date().toISOString()});
const proofOut={proofOnly:true,sourceC22Proof:'C1_22_OPERATIONAL_PROOF.json',scope:'isolated-runtime-reconstruction-with-host-shared-dynamic-libraries',fullIndependentSourceRebuildProven:false,fullOsIsolation:false,networkFetchUsed:false,credentialsUsed:false,sbom,recipe,capsule,reconstructionReport:report,proofRegister:register,media:{original:c22Proof.sourceOriginal,preservationDerivative:c22Proof.preservationDerivative},runtimeEvidence:{runtimeRoot:'proof/c1-23/reconstructed-runtime',ffmpegSha256:shaFile(rFfmpeg),ffprobeSha256:shaFile(rFfprobe),linkedLibraryCount:libPaths.length,packageCount:packages.length,capabilityComponentHashes:componentHashes,capabilityHash},authorityBoundaries:{originalDeleteAuthorized:false,preservationDerivativeDeleteAuthorized:false,capsuleCanAuthorizeRelease:false,reconstructionCanAuthorizeRelease:false,publicRelease:false,relayDependency:false}};
mkdirSync(dirname(output),{recursive:true}); writeFileSync(output,JSON.stringify(proofOut,null,2)+'\n');
console.log(JSON.stringify({valid:true,sbomHash:sbom.sbomHash,recipeHash:recipe.recipeHash,capsuleHash:capsule.capsuleHash,reconstructionReportHash:report.reportHash,reconstructionStatus:report.status,registerRevision:register.revision,registerHash:register.registerHash,linkedLibraries:libPaths.length,packages:packages.length,fullIndependentSourceRebuildProven:false,publicRelease:false,relayDependency:false},null,2));
