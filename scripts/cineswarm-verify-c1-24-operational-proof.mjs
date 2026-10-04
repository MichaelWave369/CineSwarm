#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateBuildInputAcquisitionStatus, validateIndependentBuildPolicy, validateIndependentRebuildRegister } from '../packages/cineswarm-bridge/src/independent-source-rebuild.js';

const root=resolve(process.argv[2]||'.');
const shaFile=(p)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const run=(cmd,args,opts={})=>{ const r=spawnSync(cmd,args,{encoding:'utf8',...opts}); if(r.status!==0) throw new Error(`${cmd} failed: ${r.stderr||r.stdout}`); return r.stdout.trim(); };
const proof=JSON.parse(readFileSync(resolve(root,'C1_24_OPERATIONAL_PROOF.json'),'utf8'));
const policy=JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json'),'utf8'));
const status=JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm/pn-0001-c1-24-build-input-status.json'),'utf8'));
const register=JSON.parse(readFileSync(resolve(root,'fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json'),'utf8'));
validateIndependentBuildPolicy(policy); validateBuildInputAcquisitionStatus(status,{policy}); validateIndependentRebuildRegister(register,{policy,sourceC23ReproDecodeRegisterHash:policy.sourceC23ReproDecodeRegisterHash});
if(status.status!=='BLOCKED_MISSING_BUILD_INPUTS'||register.revision!==0||register.fullIndependentSourceRebuildProven!==false) throw new Error('canonical C1.24 state drift');
const src=resolve(root,proof.syntheticBuildEngineProof.sourceArchive.path);
if(shaFile(src)!==proof.syntheticBuildEngineProof.sourceArchive.sha256) throw new Error('synthetic source archive hash drift');
const gcc=run('bash',['-lc','command -v gcc']); const make=run('bash',['-lc','command -v make']);
if(shaFile(gcc)!==proof.syntheticBuildEngineProof.toolchain.gcc.sha256) throw new Error('gcc hash drift');
if(shaFile(make)!==proof.syntheticBuildEngineProof.toolchain.make.sha256) throw new Error('make hash drift');
const results=[];
for(let i=0;i<2;i++){
  const dir=mkdtempSync(join(tmpdir(),`c124-verify-${i}-`));
  try{
    run('tar',['-xJf',src,'-C',dir]);
    const env={PATH:'/usr/bin:/bin',HOME:join(dir,'home'),TMPDIR:join(dir,'tmp'),SOURCE_DATE_EPOCH:'1786579200'};
    run(make,['-j1'],{cwd:dir,env});
    const bin=join(dir,'c124-proof'); const hash=shaFile(bin); const output=run(bin,[]);
    results.push({hash,output});
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
const expected=proof.syntheticBuildEngineProof.build1.binarySha256;
if(results.some(r=>r.hash!==expected||r.output!==proof.syntheticBuildEngineProof.expectedProgramOutput)) throw new Error('synthetic rebuild reproduction failed');
if(results[0].hash!==results[1].hash) throw new Error('synthetic builds were not reproducible');
if(proof.governedFfmpegState.fullIndependentSourceRebuildProven!==false||proof.boundaries.publicRelease!==false||proof.boundaries.relayDependency!==false) throw new Error('proof boundary drift');
console.log(JSON.stringify({valid:true,syntheticBuildEngineReproduced:true,binarySha256:expected,canonicalStatus:status.status,fullIndependentSourceRebuildProven:false,publicRelease:false,relayDependency:false},null,2));
