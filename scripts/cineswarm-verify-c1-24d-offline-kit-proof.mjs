#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyHumanKeyCeremony, validateHumanKeyCeremony } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';
import {
  validateIndependentRebuildAdmissionCeremony,
  validateIndependentRebuildAdmissionReceipt,
  validateIndependentRebuildAdmissionRegister,
  validateIndependentRebuildAdmissionReview,
  validateIndependentRebuildCanonicalAdmissionPlan,
} from '../packages/cineswarm-bridge/src/independent-rebuild-admission.js';
import {
  validateHumanKeyEnrollmentChallenge,
  validateHumanKeyEnrollmentResponse,
  validateOfflineAdmissionSignedResponse,
  validateOfflineAdmissionSigningRequest,
  validateOfflineHumanAdmissionKitManifest,
} from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124DContext, repoRoot } from './lib/c1-24d-context.mjs';
const c=loadC124DContext(); const dir=resolve(repoRoot,'proof/c1-24d/synthetic-offline-human-admission'); const j=(n)=>JSON.parse(readFileSync(resolve(dir,n),'utf8'));
const manifest=j('KIT_MANIFEST.json'); const challenge=j('ENROLLMENT_CHALLENGE.json'); const response=j('ENROLLMENT_RESPONSE.json'); const keyCeremony=j('C1_7_KEY_ENROLLMENT_CEREMONY.json'); const stagedRegistry=j('STAGED_SIGNING_KEY_REGISTRY.json'); const review=j('HUMAN_ADMISSION_REVIEW.json'); const plan=j('CANONICAL_ADMISSION_PLAN.json'); const request=j('OFFLINE_SIGNING_REQUEST.json'); const signedResponse=j('SIGNED_ADMISSION_RESPONSE.json'); const ceremony=j('VERIFIED_C1_24C_CEREMONY.json'); const admitted=j('PROPOSED_C24_CANONICAL_REGISTER.json'); const receipt=j('PROPOSED_C1_24C_ADMISSION_RECEIPT.json'); const proofAdmissionRegister=j('PROPOSED_C1_24C_ADMISSION_REGISTER.json'); const summary=j('C1_24D_OPERATIONAL_PROOF.json');
validateOfflineHumanAdmissionKitManifest(manifest,{policy:c.kitPolicy,keyCeremonyPolicy:c.keyCeremonyPolicy,keyCeremonyPlan:c.keyCeremonyPlan,admissionPolicy:c.admissionPolicy,proofContext:c.proofContext,c24CanonicalRegister:c.c24CanonicalRegister,admissionRegister:c.admissionRegister,keyRegistry:c.keyRegistry});
validateHumanKeyEnrollmentChallenge(challenge,{policy:c.kitPolicy,now:'2026-08-13T23:41:00Z'});
validateHumanKeyEnrollmentResponse(response,{challenge,policy:c.kitPolicy,now:'2026-08-13T23:41:00Z'});
validateHumanKeyCeremony(keyCeremony,{keyRegistry:c.keyRegistry,policy:c.keyCeremonyPolicy,now:keyCeremony.recordedAt});
const rebuiltRegistry=applyHumanKeyCeremony(keyCeremony,{keyRegistry:c.keyRegistry,policy:c.keyCeremonyPolicy,now:keyCeremony.recordedAt});
if(JSON.stringify(rebuiltRegistry)!==JSON.stringify(stagedRegistry)) throw new Error('C1.24D staged public-key registry drift');
validateIndependentRebuildAdmissionReview(review,{policy:c.admissionPolicy,proofContext:c.proofContext,c24CanonicalRegister:c.c24CanonicalRegister});
validateIndependentRebuildCanonicalAdmissionPlan(plan,{policy:c.admissionPolicy,proofContext:c.proofContext,c24CanonicalRegister:c.c24CanonicalRegister,review});
validateOfflineAdmissionSigningRequest(request,{policy:c.kitPolicy,admissionPolicy:c.admissionPolicy,proofContext:c.proofContext,c24CanonicalRegister:c.c24CanonicalRegister,review,plan,keyRegistry:stagedRegistry,now:'2026-08-13T23:44:30Z'});
const validated=validateOfflineAdmissionSignedResponse(signedResponse,{request,policy:c.kitPolicy,admissionPolicy:c.admissionPolicy,proofContext:c.proofContext,c24CanonicalRegister:c.c24CanonicalRegister,review,plan,keyRegistry:stagedRegistry,now:'2026-08-13T23:44:30Z'});
if(validated.ceremony.ceremonyHash!==ceremony.ceremonyHash) throw new Error('C1.24D verified ceremony drift');
validateIndependentRebuildAdmissionCeremony(ceremony,{keyRegistry:stagedRegistry,policy:c.admissionPolicy,proofContext:c.proofContext,c24CanonicalRegister:c.c24CanonicalRegister,review,plan});
validateIndependentRebuildAdmissionReceipt(receipt,{policy:c.admissionPolicy,ceremony,keyRegistry:stagedRegistry,proofContext:c.proofContext,c24CanonicalRegisterBefore:c.c24CanonicalRegister,review,plan,c24CanonicalRegisterAfter:admitted});
validateIndependentRebuildAdmissionRegister(proofAdmissionRegister,{policy:c.admissionPolicy});
if(admitted.registerHash!==plan.expectedCanonicalRegisterAfterHash||admitted.fullIndependentSourceRebuildProven!==true) throw new Error('C1.24D proposed canonical register does not match signed plan');
if(summary.proofOnly!==true||summary.realHumanKeyGenerated!==false||summary.realHumanKeyEnrolled!==false||summary.realHumanAdmissionPerformed!==false||summary.privateKeyPersisted!==false||summary.canonicalFixturesMutated!==false) throw new Error('C1.24D proof summary boundary drift');
if(c.c24CanonicalRegister.revision!==0||c.c24CanonicalRegister.fullIndependentSourceRebuildProven!==false||c.admissionRegister.revision!==0||c.keyRegistry.keys.length!==0) throw new Error('C1.24D real canonical fixtures were mutated');
const proofText=['KIT_MANIFEST.json','ENROLLMENT_CHALLENGE.json','ENROLLMENT_RESPONSE.json','C1_7_KEY_ENROLLMENT_CEREMONY.json','STAGED_SIGNING_KEY_REGISTRY.json','HUMAN_ADMISSION_REVIEW.json','CANONICAL_ADMISSION_PLAN.json','OFFLINE_SIGNING_REQUEST.json','SIGNED_ADMISSION_RESPONSE.json','VERIFIED_C1_24C_CEREMONY.json','PROPOSED_C24_CANONICAL_REGISTER.json','PROPOSED_C1_24C_ADMISSION_RECEIPT.json','PROPOSED_C1_24C_ADMISSION_REGISTER.json','C1_24D_OPERATIONAL_PROOF.json'].map(n=>readFileSync(resolve(dir,n),'utf8')).join('\n');
if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(proofText)) throw new Error('C1.24D proof contains private-key PEM material');
console.log(JSON.stringify({valid:true,proofOnly:true,manifestHash:manifest.manifestHash,challengeHash:challenge.challengeHash,enrollmentResponseHash:response.responseHash,signingRequestHash:request.requestHash,signedResponseHash:signedResponse.responseHash,ceremonyHash:ceremony.ceremonyHash,proposedCanonicalRegisterHash:admitted.registerHash,admissionReceiptHash:receipt.receiptHash,proofAdmissionRegisterHash:proofAdmissionRegister.registerHash,realCanonicalRevision:c.c24CanonicalRegister.revision,realAdmissionRegisterRevision:c.admissionRegister.revision,realHumanKeyCount:c.keyRegistry.keys.length,privateKeyPersisted:false,publicRelease:false,relayDependency:false},null,2));
