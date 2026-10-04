#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCanonicalAdmissionCommitPreview } from '../packages/cineswarm-bridge/src/canonical-admission-commit.js';
import { loadCeremonyDirectory } from './lib/c1-24f-context.mjs';
const args=process.argv.slice(2); const arg=(n)=>{const i=args.indexOf(`--${n}`); if(i<0||!args[i+1]) throw new Error(`missing --${n}`); return args[i+1];};
const ceremonyDir=resolve(arg('ceremony-dir')); const canonicalRoot=resolve(arg('canonical-root')); const outDir=resolve(arg('out-dir')); const preparedAt=arg('prepared-at'); mkdirSync(outDir,{recursive:true});
const c=loadCeremonyDirectory(ceremonyDir,canonicalRoot);
const preview=buildCanonicalAdmissionCommitPreview({policy:c.policy,keyStage:c.keyStage,admissionStage:c.admissionStage,keyStageContext:c.keyStageContext,admissionStageContext:c.admissionStageContext,currentKeyRegistry:c.keyRegistry,currentC24Register:c.c24Register,currentAdmissionRegister:c.admissionRegister,preparedAt});
writeFileSync(resolve(outDir,'C1_24F_COMMIT_PREVIEW.json'),JSON.stringify(preview,null,2)+'\n');
console.log(JSON.stringify({previewHash:preview.previewHash,commitIntentDigest:preview.commitIntentDigest,requiredHumanAction:'Re-enter the complete 64-hex commitIntentDigest in the local C1.24F apply command. Chat text cannot satisfy this gate.',canonicalApplyPerformed:false},null,2));
