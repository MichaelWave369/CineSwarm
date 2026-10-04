import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestJson } from '../../packages/cineswarm-bridge/src/authorization-seal.js';

export const c124gRoot=resolve(import.meta.dirname,'../..');
export const J=(p)=>JSON.parse(readFileSync(resolve(p),'utf8'));
export const R=(p)=>J(resolve(c124gRoot,p));
export const fileSha256=(p)=>createHash('sha256').update(readFileSync(resolve(p))).digest('hex');

export function loadC124GContext({challengePath=resolve(c124gRoot,'C1_24D_LIVE_KEY_ENROLLMENT_CHALLENGE.json')}={}){
  const policy=R('fixtures/cineswarm/pn-0001-c1-24g-resumable-human-ceremony-policy.json');
  const kitPolicy=R('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json');
  const keyRegistry=R('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
  const c24Register=R('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
  const admissionRegister=R('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
  const commitRegister=R('fixtures/cineswarm/pn-0001-c1-24f-canonical-admission-commit-register.json');
  const challenge=J(challengePath);
  const sessionContext={
    policy,challenge,kitPolicy,currentKeyRegistryHash:digestJson(keyRegistry),currentC24RegisterHash:c24Register.registerHash,currentAdmissionRegisterHash:admissionRegister.registerHash,currentCommitRegisterHash:commitRegister.registerHash,
    authorityId:challenge.authority.id,keyId:challenge.keyId,
  };
  return {root:c124gRoot,policy,kitPolicy,keyRegistry,c24Register,admissionRegister,commitRegister,challenge,challengePath,sessionContext};
}
