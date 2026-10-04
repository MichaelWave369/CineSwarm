#!/usr/bin/env node
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs'; import { resolve } from 'node:path';
import { buildHumanKeyEnrollmentStage } from '../packages/cineswarm-bridge/src/human-ceremony-console.js'; import { loadC124EContext } from './lib/c1-24e-context.mjs';
const args=process.argv.slice(2); const arg=(n)=>{const i=args.indexOf(`--${n}`); if(i<0||!args[i+1]) throw new Error(`missing --${n}`); return args[i+1];}; const J=(p)=>JSON.parse(readFileSync(resolve(p),'utf8'));
const c=loadC124EContext(); const challenge=J(arg('challenge')), response=J(arg('response')), acknowledgement=J(arg('acknowledgement')); const recordedAt=arg('recorded-at'), outDir=resolve(arg('out-dir')); mkdirSync(outDir,{recursive:true});
const stage=buildHumanKeyEnrollmentStage({policy:c.consolePolicy,acknowledgement,challenge,response,kitPolicy:c.kitPolicy,keyCeremonyPolicy:c.keyCeremonyPolicy,keyRegistry:c.keyRegistry,recordedAt});
writeFileSync(resolve(outDir,'C1_24E_KEY_ENROLLMENT_STAGE.json'),JSON.stringify(stage,null,2)+'\n'); writeFileSync(resolve(outDir,'STAGED_SIGNING_KEY_REGISTRY.json'),JSON.stringify(stage.stagedKeyRegistry,null,2)+'\n'); console.log(JSON.stringify({stageHash:stage.stageHash,stagedKeyRegistryHash:stage.stagedKeyRegistryHash,canonicalKeyRegistryMutated:false},null,2));
