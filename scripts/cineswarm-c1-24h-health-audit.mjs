#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCeremonyHealthAudit } from '../packages/cineswarm-bridge/src/challenge-health-handoff.js';
import { loadC124HContext, root } from './lib/c1-24h-context.mjs';
function arg(n,f=null){const i=process.argv.indexOf(`--${n}`);return i>=0?process.argv[i+1]:f;}
const c=loadC124HContext();const observedAt=arg('observed-at',new Date().toISOString());
const audit=buildCeremonyHealthAudit({...c,observedAt});
const out=resolve(arg('out',resolve(root,'C1_24H_HEALTH_AUDIT.json')));writeFileSync(out,JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({written:out,result:audit.result,status:audit.status,auditHash:audit.auditHash,challengeExpiresAt:audit.challenge.expiresAt,canonicalDrift:audit.summary.canonicalDrift,missingArtifactCount:audit.summary.missingArtifactCount,publicRelease:false,relayDependency:false},null,2));
