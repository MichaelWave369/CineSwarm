#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'; import { resolve } from 'node:path';
import { validateHumanKeyEnrollmentChallenge, validateHumanKeyEnrollmentResponse } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124EContext } from './lib/c1-24e-context.mjs';
const args=process.argv.slice(2); const arg=(n)=>{const i=args.indexOf(`--${n}`); if(i<0||!args[i+1]) throw new Error(`missing --${n}`); return args[i+1];};
const c=loadC124EContext(); const challenge=JSON.parse(readFileSync(resolve(arg('challenge')),'utf8')); const response=JSON.parse(readFileSync(resolve(arg('response')),'utf8')); const now=arg('now'); const out=resolve(arg('out'));
validateHumanKeyEnrollmentChallenge(challenge,{policy:c.kitPolicy,now}); validateHumanKeyEnrollmentResponse(response,{challenge,policy:c.kitPolicy,now});
const receipt={schema:'parallax.cineswarm.c1-24e-public-enrollment-response-verification.v0.1',valid:true,authority:response.authority,keyId:response.keyId,fingerprintSha256:response.fingerprintSha256,challengeHash:challenge.challengeHash,responseHash:response.responseHash,proofOfPossessionVerified:true,humanFingerprintAcknowledged:false,privateKeyReceived:false,publicRelease:false,relayDependency:false};
writeFileSync(out,JSON.stringify(receipt,null,2)+'\n'); console.log(JSON.stringify(receipt,null,2));
