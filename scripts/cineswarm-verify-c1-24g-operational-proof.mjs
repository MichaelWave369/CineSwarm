#!/usr/bin/env node
import { readFileSync } from 'node:fs';import { resolve } from 'node:path';import { execFileSync } from 'node:child_process';
import { validateResumableHumanCeremonySession,validateCeremonyTranscript,validateCeremonyResumeState,validateCeremonyRecoveryPack } from '../packages/cineswarm-bridge/src/resumable-human-ceremony.js';
import { loadC124GContext } from './lib/c1-24g-context.mjs';
const root=resolve(import.meta.dirname,'..');
for(const s of ['cineswarm-verify-c1-24d-offline-kit-proof.mjs','cineswarm-verify-c1-24e-human-console-proof.mjs','cineswarm-verify-c1-24f-operational-proof.mjs']) execFileSync(process.execPath,[resolve(import.meta.dirname,s)],{cwd:root,stdio:'ignore'});
const p=resolve(root,'proof/c1-24g/synthetic-resumable-ceremony');const J=n=>JSON.parse(readFileSync(resolve(p,n),'utf8'));
const challenge=JSON.parse(readFileSync(resolve(root,'proof/c1-24d/synthetic-offline-human-admission/ENROLLMENT_CHALLENGE.json'),'utf8'));
const c=loadC124GContext({challengePath:resolve(root,'proof/c1-24d/synthetic-offline-human-admission/ENROLLMENT_CHALLENGE.json')});
const session=J('SESSION.json'),transcript=J('TRANSCRIPT.json'),resume=J('RESUME_STATE.json'),pack=J('RECOVERY_PACK.json');
validateResumableHumanCeremonySession(session,c.sessionContext);validateCeremonyTranscript(transcript,{policy:c.policy,session,sessionContext:c.sessionContext});
const resumeCtx={policy:c.policy,session,sessionContext:c.sessionContext,transcript};validateCeremonyResumeState(resume,resumeCtx);validateCeremonyRecoveryPack(pack,{policy:c.policy,session,sessionContext:c.sessionContext,transcript,resumeState:resume,resumeContext:resumeCtx});
if(resume.status!=='COMPLETE'||transcript.revision!==9) throw new Error('C1.24G synthetic ceremony did not complete all nine gates');
const out={status:'PASS',phase:'C1.24G',proofOnly:true,sessionHash:session.sessionHash,transcriptHash:transcript.transcriptHash,recoveryPackHash:pack.packHash,completedEventCount:transcript.revision,resumeStatus:resume.status,realCanonicalRevision:c.c24Register.revision,realAdmissionRevision:c.admissionRegister.revision,realCommitRevision:c.commitRegister.revision,realHumanKeyCount:c.keyRegistry.keys.length,privateKeyPersisted:false,independentHumanWitnessClaimed:false,publicRelease:false,relayDependency:false};console.log(JSON.stringify(out,null,2));
