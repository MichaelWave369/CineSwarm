#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIndependentRebuildAdmissionReview, buildIndependentRebuildCanonicalAdmissionPlan } from '../packages/cineswarm-bridge/src/independent-rebuild-admission.js';
import { buildOfflineAdmissionSigningRequest } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { loadC124DContext } from './lib/c1-24d-context.mjs';
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
const worksheetPath = arg('worksheet'); const registryPath = arg('key-registry'); const keyId = arg('key-id'); const outDir = resolve(arg('out-dir', './c1-24d-admission-signing-stage'));
if (!worksheetPath || !registryPath || !keyId) throw new Error('Usage: --worksheet <human worksheet.json> --key-registry <enrolled/staged public registry.json> --key-id <key id> [--out-dir <dir>]');
const c = loadC124DContext(); const worksheet = JSON.parse(readFileSync(resolve(worksheetPath), 'utf8')); const keyRegistry = JSON.parse(readFileSync(resolve(registryPath), 'utf8'));
if (worksheet.authorityId !== c.keyCeremonyPlan.authority.id) throw new Error('C1.24D worksheet authority mismatch');
if (!worksheet.reviewedAt) throw new Error('C1.24D worksheet reviewedAt must be set by the human reviewer');
const review = buildIndependentRebuildAdmissionReview({ policy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, reviewId: 'pn0001-c1-24d-human-independent-rebuild-review', authority: { kind: 'human', id: worksheet.authorityId, simulated: false }, decision: worksheet.decision, reason: worksheet.reason, reviewedAt: worksheet.reviewedAt, checks: worksheet.checks });
if (review.decision !== 'ADMIT_TO_CANONICAL') throw new Error('C1.24D signing request is only created after an explicit ADMIT_TO_CANONICAL human review');
const now = new Date(); if (now.getTime() < Date.parse(review.reviewedAt)) throw new Error('C1.24D cannot prepare a signing request before the human review timestamp');
const archiveAt = new Date(now.getTime() + 20 * 60 * 1000); const receiptAt = new Date(now.getTime() + 21 * 60 * 1000); const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
const plan = buildIndependentRebuildCanonicalAdmissionPlan({ policy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, review, archiveRecordedAt: archiveAt.toISOString(), receiptRecordedAt: receiptAt.toISOString(), planId: 'pn0001-c1-24d-canonical-admission-plan' });
const request = buildOfflineAdmissionSigningRequest({ policy: c.kitPolicy, admissionPolicy: c.admissionPolicy, proofContext: c.proofContext, c24CanonicalRegister: c.c24CanonicalRegister, review, plan, keyRegistry, keyId, signedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), ceremonyId: 'pn0001-c1-24d-independent-rebuild-admission-ceremony', requestId: 'pn0001-c1-24d-offline-admission-signing-request' });
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'HUMAN_ADMISSION_REVIEW.json'), JSON.stringify(review, null, 2) + '\n');
writeFileSync(resolve(outDir, 'CANONICAL_ADMISSION_PLAN.json'), JSON.stringify(plan, null, 2) + '\n');
writeFileSync(resolve(outDir, 'OFFLINE_SIGNING_REQUEST.json'), JSON.stringify(request, null, 2) + '\n');
writeFileSync(resolve(outDir, 'SIGNING_REQUEST_SUMMARY.txt'), [`C1.24D OFFLINE HUMAN SIGNING REQUEST`,`authority=${request.authority.id}`,`keyId=${request.keyId}`,`fingerprint=${request.expectedPublicKeyFingerprintSha256}`,`requestHash=${request.requestHash}`,`ceremonyDigest=${request.ceremonyDigest}`,`expectedCanonicalAfter=${request.expectedCanonicalRegisterAfterHash}`,`expiresAt=${request.expiresAt}`,`publicRelease=false`,`relayDependency=false`,``].join('\n'));
console.log(JSON.stringify({ prepared: true, outDir, requestHash: request.requestHash, fingerprintSha256: request.expectedPublicKeyFingerprintSha256, expiresAt: request.expiresAt, canonicalApplied: false, privateKeyImported: false }, null, 2));
