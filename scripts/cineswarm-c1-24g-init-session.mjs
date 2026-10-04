#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { buildResumableHumanCeremonySession, buildCeremonyTranscript, buildCeremonyEvent, appendCeremonyEvent, buildCeremonyResumeState, buildCeremonyRecoveryPack } from '../packages/cineswarm-bridge/src/resumable-human-ceremony.js';
import { loadC124GContext, fileSha256 } from './lib/c1-24g-context.mjs';

const args=process.argv.slice(2);const get=(n,d=null)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d;};
const challengePath=resolve(get('--challenge',resolve(import.meta.dirname,'../C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json')));
const outDir=resolve(get('--out',resolve(import.meta.dirname,'../live/c1-24g')));const now=get('--now',new Date().toISOString());
const c=loadC124GContext({challengePath});mkdirSync(outDir,{recursive:true});
const session=buildResumableHumanCeremonySession({...c.sessionContext,startedAt:now,sessionId:`c1-24g-${c.challenge.keyId}-session`});
let transcript=buildCeremonyTranscript({policy:c.policy,session,sessionContext:c.sessionContext,events:[],recordedAt:now,transcriptId:`c1-24g-${c.challenge.keyId}-transcript`});
const challengeEvent=buildCeremonyEvent({policy:c.policy,session,sessionContext:c.sessionContext,transcript,eventType:'CHALLENGE_BOUND',artifactKind:'C1_24D_PUBLIC_ENROLLMENT_CHALLENGE',artifactHash:fileSha256(challengePath),artifactPath:basename(challengePath),validatorId:'cineswarm-c1-24d.validateHumanKeyEnrollmentChallenge',actorKind:'machine',actorId:'cineswarm-c1-24g',observedAt:now});
transcript=appendCeremonyEvent({policy:c.policy,session,sessionContext:c.sessionContext,transcript,event:challengeEvent});
const resume=buildCeremonyResumeState({policy:c.policy,session,sessionContext:c.sessionContext,transcript,now});
const artifacts=[
  {kind:'C1_24D_PUBLIC_ENROLLMENT_CHALLENGE',path:basename(challengePath),sha256:fileSha256(challengePath)},
  {kind:'C1_24F_CANONICAL_STATUS',path:'CANONICAL_STATUS_C1_24F.json',sha256:fileSha256(resolve(c.root,'CANONICAL_STATUS_C1_24F.json'))},
  {kind:'C1_24F_HUMAN_NEXT_STEP',path:'C1_24F_HUMAN_NEXT_STEP.md',sha256:fileSha256(resolve(c.root,'C1_24F_HUMAN_NEXT_STEP.md'))},
];
const resumeContext={policy:c.policy,session,sessionContext:c.sessionContext,transcript};
const pack=buildCeremonyRecoveryPack({policy:c.policy,session,sessionContext:c.sessionContext,transcript,resumeState:resume,resumeContext,publicArtifacts:artifacts,createdAt:now,packId:`c1-24g-${c.challenge.keyId}-recovery-pack`});
const W=(n,v)=>writeFileSync(resolve(outDir,n),JSON.stringify(v,null,2)+'\n');
W('SESSION.json',session);W('TRANSCRIPT.json',transcript);W('RESUME_STATE.json',resume);W('RECOVERY_PACK.json',pack);
const output={phase:'C1.24G',status:resume.status,nextAction:resume.nextAction,sessionHash:session.sessionHash,transcriptHash:transcript.transcriptHash,recoveryPackHash:pack.packHash,outDir,privateKeyCreated:false,canonicalMutationPerformed:false,publicRelease:false,relayDependency:false};
W('INIT_OUTPUT.json',output);console.log(JSON.stringify(output,null,2));
