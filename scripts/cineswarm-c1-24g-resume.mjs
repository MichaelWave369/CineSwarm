#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateResumableHumanCeremonySession, validateCeremonyTranscript, buildCeremonyResumeState, buildCeremonyRecoveryPack } from '../packages/cineswarm-bridge/src/resumable-human-ceremony.js';
import { loadC124GContext, fileSha256 } from './lib/c1-24g-context.mjs';
const args=process.argv.slice(2);const get=(n,d=null)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d;};
const dir=resolve(get('--dir',resolve(import.meta.dirname,'../live/c1-24g')));const now=get('--now',new Date().toISOString());
const challengePath=resolve(get('--challenge',resolve(import.meta.dirname,'../C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json')));const c=loadC124GContext({challengePath});
const J=(n)=>JSON.parse(readFileSync(resolve(dir,n),'utf8'));const session=J('SESSION.json');const transcript=J('TRANSCRIPT.json');
validateResumableHumanCeremonySession(session,c.sessionContext);validateCeremonyTranscript(transcript,{policy:c.policy,session,sessionContext:c.sessionContext});
const resume=buildCeremonyResumeState({policy:c.policy,session,sessionContext:c.sessionContext,transcript,now});
const resumeContext={policy:c.policy,session,sessionContext:c.sessionContext,transcript};
const publicArtifacts=[
  {kind:'SESSION',path:'SESSION.json',sha256:fileSha256(resolve(dir,'SESSION.json'))},
  {kind:'TRANSCRIPT',path:'TRANSCRIPT.json',sha256:fileSha256(resolve(dir,'TRANSCRIPT.json'))},
  {kind:'C1_24D_PUBLIC_ENROLLMENT_CHALLENGE',path:'C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json',sha256:fileSha256(challengePath)},
];
const pack=buildCeremonyRecoveryPack({policy:c.policy,session,sessionContext:c.sessionContext,transcript,resumeState:resume,resumeContext,publicArtifacts,createdAt:now,packId:`${session.sessionId}-recovery-pack`});
writeFileSync(resolve(dir,'RESUME_STATE.json'),JSON.stringify(resume,null,2)+'\n');writeFileSync(resolve(dir,'RECOVERY_PACK.json'),JSON.stringify(pack,null,2)+'\n');
console.log(JSON.stringify({phase:'C1.24G',status:resume.status,nextAction:resume.nextAction,completedEventCount:resume.completedEventCount,sessionHash:session.sessionHash,transcriptHash:transcript.transcriptHash,recoveryPackHash:pack.packHash,canonicalMutationPerformed:false,publicRelease:false,relayDependency:false},null,2));
