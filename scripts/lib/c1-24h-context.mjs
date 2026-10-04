import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { digestJson } from '../../packages/cineswarm-bridge/src/authorization-seal.js';
import { loadC124GContext } from './c1-24g-context.mjs';

export const root=resolve(import.meta.dirname,'../..');
const J=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
export const fileSha256=p=>createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex');
export function loadC124HContext(){
  const g=loadC124GContext({challengePath:resolve(root,'C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json')});
  const policy=J('fixtures/cineswarm/pn-0001-c1-24h-challenge-health-handoff-policy.json');
  const session=J('C1_24G_LIVE_SESSION.json');
  const transcript=J('C1_24G_LIVE_TRANSCRIPT.json');
  const resumeState=J('C1_24G_LIVE_RESUME_STATE.json');
  const recoveryPack=J('C1_24G_LIVE_RECOVERY_PACK.json');
  const sessionContext={...g.sessionContext};
  const resumeContext={policy:g.policy,session,sessionContext,transcript};
  const recoveryContext={policy:g.policy,session,sessionContext,transcript,resumeState,resumeContext};
  const currentCanonicalHashes={keyRegistryHash:digestJson(g.keyRegistry),c24RegisterHash:g.c24Register.registerHash,admissionRegisterHash:g.admissionRegister.registerHash,commitRegisterHash:g.commitRegister.registerHash};
  const pathMap={SESSION:'C1_24G_LIVE_SESSION.json',TRANSCRIPT:'C1_24G_LIVE_TRANSCRIPT.json',C1_24D_PUBLIC_ENROLLMENT_CHALLENGE:'C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json'};
  const artifactObservations=recoveryPack.artifacts.map(a=>{
    const local=pathMap[a.kind];
    return {kind:a.kind,path:a.path,expectedSha256:a.sha256,actualSha256:local?fileSha256(local):null,available:Boolean(local),privateKeyDetected:false};
  });
  return {root,policy,gPolicy:g.policy,kitPolicy:g.kitPolicy,challenge:g.challenge,session,sessionContext,transcript,resumeState,resumeContext,recoveryPack,recoveryContext,currentCanonicalHashes,artifactObservations};
}
