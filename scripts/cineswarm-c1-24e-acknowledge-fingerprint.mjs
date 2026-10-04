#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'; import { resolve } from 'node:path';
import { buildHumanFingerprintAcknowledgement } from '../packages/cineswarm-bridge/src/human-ceremony-console.js'; import { loadC124EContext } from './lib/c1-24e-context.mjs';
const args=process.argv.slice(2); const arg=(n)=>{const i=args.indexOf(`--${n}`); if(i<0||!args[i+1]) throw new Error(`missing --${n}`); return args[i+1];};
const c=loadC124EContext(); const challenge=JSON.parse(readFileSync(resolve(arg('challenge')),'utf8')); const response=JSON.parse(readFileSync(resolve(arg('response')),'utf8')); const at=arg('acknowledged-at');
const ack=buildHumanFingerprintAcknowledgement({policy:c.consolePolicy,challenge,response,kitPolicy:c.kitPolicy,acknowledgedFingerprintSha256:arg('ack-fingerprint'),authorityId:response.authority.id,acknowledgedAt:at}); const out=resolve(arg('out')); writeFileSync(out,JSON.stringify(ack,null,2)+'\n'); console.log(JSON.stringify(ack,null,2));
