#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildHumanKeyEnrollmentChallenge } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124DContext } from './lib/c1-24d-context.mjs';
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const outPath = resolve(arg('out', './C1_24D_KEY_ENROLLMENT_CHALLENGE.json'));
const keyId = arg('key-id', 'michael-hughes-c1-24-admission-001');
const c = loadC124DContext();
const now = new Date(); const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const challenge = buildHumanKeyEnrollmentChallenge({ policy: c.kitPolicy, authorityId: c.keyCeremonyPlan.authority.id, keyId, ceremonyId: `c1-24d-enroll-${keyId}`, challengeId: `c1-24d-challenge-${randomBytes(8).toString('hex')}`, challengeNonce: randomBytes(32).toString('hex'), issuedAt: now.toISOString(), expiresAt: expires.toISOString(), canonicalC24RegisterHash: c.c24CanonicalRegister.registerHash, admissionPolicyId: c.admissionPolicy.policyId });
mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(challenge, null, 2) + '\n');
console.log(JSON.stringify({ created: true, outPath, challengeId: challenge.challengeId, challengeHash: challenge.challengeHash, expiresAt: challenge.expiresAt, privateKeyGenerated: false, publicRelease: false, relayDependency: false }, null, 2));
