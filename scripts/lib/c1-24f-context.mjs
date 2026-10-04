import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const c124fRoot=resolve(import.meta.dirname,'../..');
export const J=(p)=>JSON.parse(readFileSync(resolve(p),'utf8'));
const R=(p)=>J(resolve(c124fRoot,p));

export function loadC124FBaseContext(){
  const proofDir=resolve(c124fRoot,'proof/c1-24/real-independent-rebuild');
  const c24Policy=R('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
  return {
    root:c124fRoot,
    policy:R('fixtures/cineswarm/pn-0001-c1-24f-canonical-admission-commit-policy.json'),
    consolePolicy:R('fixtures/cineswarm/pn-0001-c1-24e-human-ceremony-console-policy.json'),
    kitPolicy:R('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json'),
    keyCeremonyPolicy:R('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json'),
    admissionPolicy:R('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json'),
    c24Policy,
    proofContext:{
      c24Policy,
      buildInputArchive:J(resolve(proofDir,'BUILD_INPUT_ARCHIVE.json')),
      recipe:J(resolve(proofDir,'HERMETIC_BUILD_RECIPE.json')),
      report:J(resolve(proofDir,'INDEPENDENT_REBUILD_REPORT.json')),
      rebuildReceipt:J(resolve(proofDir,'INDEPENDENT_REBUILD_RECEIPT.json')),
      proofRegister:J(resolve(proofDir,'PROOF_REGISTER.json')),
      buildLogSha256:createHash('sha256').update(readFileSync(resolve(proofDir,'BUILD.log'))).digest('hex'),
    },
  };
}

export function loadCanonicalFiles(canonicalRoot){
  const f=(name)=>J(resolve(canonicalRoot,'fixtures/cineswarm',name));
  return {
    keyRegistry:f('pn-0001-c1-6-signing-key-registry.json'),
    c24Register:f('pn-0001-c1-24-independent-rebuild-register.json'),
    admissionRegister:f('pn-0001-c1-24c-independent-rebuild-admission-register.json'),
    commitRegister:f('pn-0001-c1-24f-canonical-admission-commit-register.json'),
  };
}

export function loadCeremonyDirectory(ceremonyDir,canonicalRoot){
  const b=loadC124FBaseContext(); const c=loadCanonicalFiles(canonicalRoot); const F=(n)=>J(resolve(ceremonyDir,n));
  const challenge=F('ENROLLMENT_CHALLENGE.json');
  const response=F('ENROLLMENT_RESPONSE.json');
  const acknowledgement=F('FINGERPRINT_ACKNOWLEDGEMENT.json');
  const keyStage=F('KEY_ENROLLMENT_STAGE.json');
  const review=F('HUMAN_ADMISSION_REVIEW.json');
  const plan=F('CANONICAL_ADMISSION_PLAN.json');
  const request=F('OFFLINE_SIGNING_REQUEST.json');
  const signedResponse=F('SIGNED_ADMISSION_RESPONSE.json');
  const admissionStage=F('CANONICAL_ADMISSION_STAGE.json');
  const keyStageContext={policy:b.consolePolicy,acknowledgement,challenge,response,kitPolicy:b.kitPolicy,keyCeremonyPolicy:b.keyCeremonyPolicy,keyRegistry:c.keyRegistry};
  const admissionStageContext={policy:b.consolePolicy,request,signedResponse,kitPolicy:b.kitPolicy,admissionPolicy:b.admissionPolicy,proofContext:b.proofContext,c24CanonicalRegister:c.c24Register,admissionRegister:c.admissionRegister,review,plan,stagedKeyRegistry:keyStage.stagedKeyRegistry,stagedKeyRegistryHash:keyStage.stagedKeyRegistryHash};
  return {...b,...c,challenge,response,acknowledgement,keyStage,review,plan,request,signedResponse,admissionStage,keyStageContext,admissionStageContext};
}
