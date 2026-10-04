#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyChallengeHealthHandoff } from '../packages/cineswarm-bridge/src/challenge-health-handoff.js';
import { root } from './lib/c1-24h-context.mjs';
const hp=resolve(root,'C1_24H_HEALTH_AUDIT.json'); const handoff=resolve(root,'C1_24H_HANDOFF_MANIFEST.json');
const health=existsSync(hp)?JSON.parse(readFileSync(hp,'utf8')):null; const m=existsSync(handoff)?JSON.parse(readFileSync(handoff,'utf8')):null;
const s=classifyChallengeHealthHandoff({healthAuditResult:health?.result??'DEGRADED',challengeExpired:health?.challenge?.expired===true,handoffReady:Boolean(m),enrollmentResponsePresent:false});
console.log(JSON.stringify({...s,healthAuditHash:health?.auditHash??null,handoffManifestHash:m?.manifestHash??null,challengeExpiresAt:health?.challenge?.expiresAt??null,canonicalMutation:false,publicRelease:false,relayDependency:false},null,2));
