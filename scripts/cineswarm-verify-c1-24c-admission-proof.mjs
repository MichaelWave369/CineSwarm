#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateIndependentRebuildAdmissionCeremony,
  validateIndependentRebuildAdmissionPolicy,
  validateIndependentRebuildAdmissionReceipt,
  validateIndependentRebuildAdmissionRegister,
  validateIndependentRebuildAdmissionReview,
  validateIndependentRebuildCanonicalAdmissionPlan,
} from '../packages/cineswarm-bridge/src/independent-rebuild-admission.js';
import { validateIndependentRebuildRegister } from '../packages/cineswarm-bridge/src/independent-source-rebuild.js';

const root=resolve(import.meta.dirname,'..');
const j=(p)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const c24Policy=j('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
const policy=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
const canonical=j('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const canonicalAdmission=j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const pd='proof/c1-24/real-independent-rebuild';
const proofContext={c24Policy,buildInputArchive:j(`${pd}/BUILD_INPUT_ARCHIVE.json`),recipe:j(`${pd}/HERMETIC_BUILD_RECIPE.json`),report:j(`${pd}/INDEPENDENT_REBUILD_REPORT.json`),rebuildReceipt:j(`${pd}/INDEPENDENT_REBUILD_RECEIPT.json`),proofRegister:j(`${pd}/PROOF_REGISTER.json`),buildLogSha256:createHash('sha256').update(readFileSync(resolve(root,`${pd}/BUILD.log`))).digest('hex')};
const q='proof/c1-24c/synthetic-admission';
const keyRegistry=j(`${q}/PROOF_PUBLIC_KEY_REGISTRY.json`);
const review=j(`${q}/ADMISSION_REVIEW.json`);
const plan=j(`${q}/ADMISSION_PLAN.json`);
const ceremony=j(`${q}/ADMISSION_CEREMONY.json`);
const admitted=j(`${q}/ADMITTED_C24_REGISTER.json`);
const receipt=j(`${q}/ADMISSION_RECEIPT.json`);
const admissionRegister=j(`${q}/ADMISSION_REGISTER.json`);
const summary=j(`${q}/C1_24C_OPERATIONAL_PROOF.json`);
validateIndependentRebuildAdmissionPolicy(policy,{proofContext,c24CanonicalRegister:canonical});
validateIndependentRebuildAdmissionReview(review,{policy,proofContext,c24CanonicalRegister:canonical});
validateIndependentRebuildCanonicalAdmissionPlan(plan,{policy,proofContext,c24CanonicalRegister:canonical,review});
validateIndependentRebuildAdmissionCeremony(ceremony,{keyRegistry,policy,proofContext,c24CanonicalRegister:canonical,review,plan});
validateIndependentRebuildRegister(admitted,{policy:c24Policy,sourceC23ReproDecodeRegisterHash:c24Policy.sourceC23ReproDecodeRegisterHash});
validateIndependentRebuildAdmissionReceipt(receipt,{policy,ceremony,keyRegistry,proofContext,c24CanonicalRegisterBefore:canonical,review,plan,c24CanonicalRegisterAfter:admitted});
validateIndependentRebuildAdmissionRegister(admissionRegister,{policy});
validateIndependentRebuildAdmissionRegister(canonicalAdmission,{policy});
if(summary.proofOnly!==true||summary.realHumanAdmissionPerformed!==false||summary.privateKeyPersisted!==false) throw new Error('C1.24C proof boundary drift');
if(admitted.revision!==2||admitted.fullIndependentSourceRebuildProven!==true) throw new Error('C1.24C synthetic admitted register drift');
if(canonical.revision!==0||canonical.fullIndependentSourceRebuildProven!==false) throw new Error('C1.24C real canonical register was unexpectedly promoted');
if(canonicalAdmission.revision!==0||canonicalAdmission.admissionReceiptCount!==0) throw new Error('C1.24C real admission register was unexpectedly promoted');
if(summary.publicRelease!==false||summary.relayDependency!==false) throw new Error('C1.24C proof authority boundary drift');
console.log(JSON.stringify({valid:true,proofOnly:true,syntheticCanonicalRevision:admitted.revision,syntheticCanonicalFullIndependentSourceRebuildProven:admitted.fullIndependentSourceRebuildProven,realCanonicalRevision:canonical.revision,realCanonicalFullIndependentSourceRebuildProven:canonical.fullIndependentSourceRebuildProven,realAdmissionRegisterRevision:canonicalAdmission.revision,publicRelease:false,relayDependency:false},null,2));
