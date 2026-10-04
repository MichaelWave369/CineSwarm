#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { validateFormatMigrationRegister, validatePreservationDerivativeRecord } from '../packages/cineswarm-bridge/src/format-obsolescence-migration.js';
import { validateDecodeEnvironmentSnapshot, validateCompatibilityMatrix, validateAccessDerivativePlan, validateAccessDerivativeQcReport, validateDecodeAccessRegister } from '../packages/cineswarm-bridge/src/decode-environment-access.js';

function fileSha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function verifyProofMedia(root, ref, label) {
  const path = resolve(root, ref.path);
  const actual = fileSha256(path);
  if (actual !== ref.sha256) throw new Error(`${label} proof media hash mismatch`);
  return { path, sha256: actual };
}

const [proofPathArg] = process.argv.slice(2);
if (!proofPathArg) { console.error('Usage: node scripts/cineswarm-verify-c1-22-operational-proof.mjs <C1_22_OPERATIONAL_PROOF.json>'); process.exit(64); }
const proofPath = resolve(proofPathArg);
const proofRoot = dirname(proofPath);
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const originalMedia = verifyProofMedia(proofRoot, proof.sourceOriginal, 'original');
const preservationMedia = verifyProofMedia(proofRoot, proof.preservationDerivative, 'preservation derivative');
const accessMedia = verifyProofMedia(proofRoot, proof.playbackAccessDerivative, 'access derivative');
const c = proof.c21SyntheticContext;
const derivativeContext = { policy: c.policy, plan: c.plan, assessment: c.assessment, equivalenceReport: c.equivalenceReport, review: c.review, ceremony: c.ceremony, keyRegistry: c.keyRegistry };
validatePreservationDerivativeRecord(c.derivativeRecord, derivativeContext);
validateFormatMigrationRegister(c.register, { policy: c.policy, sourceC20PreservationRegisterHash: c.sourceC20PreservationRegisterHash });
const policyPath = resolve(import.meta.dirname, '../fixtures/cineswarm/pn-0001-c1-22-decode-access-policy.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
validateDecodeEnvironmentSnapshot(proof.environmentSnapshot, { policy });
const matrixContext = { policy, environmentSnapshot: proof.environmentSnapshot, c21Policy: c.policy, c21Register: c.register, c21SourceC20PreservationRegisterHash: c.sourceC20PreservationRegisterHash, derivativeRecord: c.derivativeRecord, derivativeContext };
validateCompatibilityMatrix(proof.compatibilityMatrix, matrixContext);
const planContext = { policy, environmentSnapshot: proof.environmentSnapshot, compatibilityMatrix: proof.compatibilityMatrix, compatibilityContext: matrixContext };
validateAccessDerivativePlan(proof.accessPlan, planContext);
validateAccessDerivativeQcReport(proof.accessQc, { policy, plan: proof.accessPlan, planContext });
validateDecodeAccessRegister(proof.proofRegister, { policy, sourceC21FormatMigrationRegisterHash: c.register.registerHash });
if (proof.c22HumanAccessReviewCreated !== false || proof.c22GovernedAccessDerivativeRecordCreated !== false) throw new Error('operational proof must remain stopped before human access review');
if (proof.authorityBoundaries?.publicRelease !== false || proof.authorityBoundaries?.relayDependency !== false) throw new Error('operational proof authority boundary drift');
console.log(JSON.stringify({ valid: true, mediaHashesVerified: true, originalMedia, preservationMedia, accessMedia, c21DerivativeRecordHash: c.derivativeRecord.derivativeRecordHash, environmentSnapshotHash: proof.environmentSnapshot.snapshotHash, compatibilityMatrixHash: proof.compatibilityMatrix.matrixHash, compatibilityStatus: proof.compatibilityMatrix.status, accessQcHash: proof.accessQc.qcHash, accessQcStatus: proof.accessQc.status, proofRegisterHash: proof.proofRegister.registerHash, humanAccessReviewCreated: false, governedAccessDerivativeRecordCreated: false, publicRelease: false }, null, 2));
