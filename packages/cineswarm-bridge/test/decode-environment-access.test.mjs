import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { publicKeyFingerprintSha256 } from '../src/key-ceremony-journal.js';
import {
  appendPreservationDerivative,
  buildFormatAssessment,
  buildFormatEquivalenceReport,
  buildFormatMigrationCeremonyPayload,
  buildFormatMigrationPlan,
  buildFormatMigrationRegister,
  buildFormatMigrationReview,
  buildPreservationDerivativeRecord,
  signFormatMigrationCeremony,
} from '../src/format-obsolescence-migration.js';
import {
  appendAccessDerivative,
  appendCompatibilityMatrix,
  appendDecodeEnvironmentSnapshot,
  buildAccessDerivativePlan,
  buildAccessDerivativeQcReport,
  buildAccessDerivativeRecord,
  buildAccessDerivativeReview,
  buildCompatibilityMatrix,
  buildDecodeAccessRegister,
  buildDecodeEnvironmentSnapshot,
  classifyDecodeAccessState,
  validateAccessDerivativePlan,
  validateAccessDerivativeQcReport,
  validateAccessDerivativeRecord,
  validateAccessDerivativeReview,
  validateC21DerivativeRegistration,
  validateCompatibilityMatrix,
  validateDecodeAccessPolicy,
  validateDecodeAccessRegister,
  validateDecodeEnvironmentSnapshot,
} from '../src/decode-environment-access.js';

const base = resolve(import.meta.dirname, '../../../fixtures/cineswarm');
const read = (name) => JSON.parse(readFileSync(resolve(base, name), 'utf8'));
const c21Policy = read('pn-0001-c1-21-format-preservation-policy.json');
const policy = read('pn-0001-c1-22-decode-access-policy.json');
const c21SourceC20 = '0c7c00d090f5d796f537879688cbda077cb2a48fa8b4b718c04bf4c2d2f963f2';
const canonicalC21Hash = 'bc9c629c8bd755fdcf747ce51ecfeb6bf39b26ed29ba02e173b4ab70d3d47b1c';

function c21Fixture() {
  const source = { assetId: 'proof-original-master', sha256: '1'.repeat(64), container: 'avi', videoCodec: 'mpeg4', audioCodec: 'pcm_s16le' };
  const assessment = buildFormatAssessment({ policy: c21Policy, source, disposition: 'MIGRATION_RECOMMENDED', evidenceRefs: ['operator:synthetic-proof-profile'], assessedAt: '2026-08-13T20:21:00.000Z', reviewDueAt: '2027-02-09T20:21:00.000Z' });
  const plan = buildFormatMigrationPlan({ policy: c21Policy, assessment, source, plannedAt: '2026-08-13T20:22:00.000Z' });
  const obs = { sha256: source.sha256, container: 'avi', videoCodec: 'mpeg4', audioCodec: 'pcm_s16le', durationSeconds: 2, width: 320, height: 180, frameRate: '24/1', sampleRate: 48000, channels: 2, decodedVideoSha256: '2'.repeat(64), decodedAudioSha256: '3'.repeat(64) };
  const derObs = { ...obs, sha256: '4'.repeat(64), container: 'matroska', videoCodec: 'ffv1', audioCodec: 'pcm_s24le' };
  const equivalenceReport = buildFormatEquivalenceReport({ policy: c21Policy, plan, assessment, sourceObservation: obs, derivativeObservation: derObs, observedAt: '2026-08-13T20:23:00.000Z' });
  const review = buildFormatMigrationReview({ policy: c21Policy, plan, assessment, equivalenceReport, authorityId: 'michael-hughes', decision: 'APPROVE_DERIVATIVE', reason: 'Test-only governed fixture.', recordedAt: '2026-08-13T20:24:00.000Z' });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyRegistry = { schema: 'parallax.cineswarm.signing-key-registry.c1.6.v0.1', keys: [{ keyId: 'c1-22-test-key', algorithm: 'Ed25519', status: 'active', authority: { kind: 'human', id: 'michael-hughes' }, publicKeyPem, fingerprintSha256: publicKeyFingerprintSha256(publicKeyPem), validFrom: '2026-08-13T20:00:00.000Z', validUntil: null }] };
  const ceremonyPayload = buildFormatMigrationCeremonyPayload({ policy: c21Policy, plan, assessment, equivalenceReport, review, authorityId: 'michael-hughes', keyId: 'c1-22-test-key', recordedAt: '2026-08-13T20:25:00.000Z', expiresAt: '2026-08-14T20:25:00.000Z' });
  const ceremony = signFormatMigrationCeremony({ ceremony: ceremonyPayload, privateKeyPem });
  const derivativeContext = { policy: c21Policy, plan, assessment, equivalenceReport, review, ceremony, keyRegistry };
  const derivativeRecord = buildPreservationDerivativeRecord({ ...derivativeContext, recordedAt: '2026-08-13T20:26:00.000Z', derivativeId: 'c1-22-test-preservation-derivative' });
  const registerContext = { policy: c21Policy, sourceC20PreservationRegisterHash: c21SourceC20 };
  let c21Register = buildFormatMigrationRegister({ ...registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:27:00.000Z', registerId: 'c1-22-test-c21-register' });
  c21Register = appendPreservationDerivative({ register: c21Register, derivativeRecord, derivativeContext, registerContext, recordedAt: '2026-08-13T20:28:00.000Z' });
  return { source, derivativeRecord, derivativeContext, c21Register };
}

function environmentFixture() {
  return {
    platform: 'linux', arch: 'x64', nodeVersion: 'v24.0.0',
    ffmpeg: {
      executablePath: '/usr/bin/ffmpeg', executableSha256: 'a'.repeat(64), versionLine: 'ffmpeg version synthetic-test', versionOutputSha256: 'b'.repeat(64), decodersOutputSha256: 'c'.repeat(64), encodersOutputSha256: 'd'.repeat(64), formatsOutputSha256: 'e'.repeat(64),
    },
    ffprobe: { executablePath: '/usr/bin/ffprobe', executableSha256: 'f'.repeat(64), versionLine: 'ffprobe version synthetic-test', versionOutputSha256: '0'.repeat(64) },
  };
}

function fixture() {
  const c21 = c21Fixture();
  const snapshot = buildDecodeEnvironmentSnapshot({ policy, environment: environmentFixture(), capturedAt: '2026-08-13T20:30:00.000Z', snapshotId: 'c1-22-test-snapshot' });
  const derivativeContextBase = {
    c21Policy,
    c21Register: c21.c21Register,
    c21SourceC20PreservationRegisterHash: c21SourceC20,
    derivativeRecord: c21.derivativeRecord,
    derivativeContext: c21.derivativeContext,
  };
  const originalObservation = { available: true, actualSha256: c21.derivativeRecord.originalSha256, probePassed: true, fullDecodePassed: true, technical: { container: 'avi', videoCodec: 'mpeg4', audioCodec: 'pcm_s16le' } };
  const preservationObservation = { available: true, actualSha256: c21.derivativeRecord.derivativeSha256, probePassed: true, fullDecodePassed: true, technical: { container: 'matroska', videoCodec: 'ffv1', audioCodec: 'pcm_s24le' } };
  const matrixContext = { policy, environmentSnapshot: snapshot, ...derivativeContextBase };
  const matrix = buildCompatibilityMatrix({ ...matrixContext, originalObservation, preservationObservation, observedAt: '2026-08-13T20:31:00.000Z', matrixId: 'c1-22-test-matrix' });
  const planContext = { policy, environmentSnapshot: snapshot, compatibilityMatrix: matrix, compatibilityContext: matrixContext };
  const plan = buildAccessDerivativePlan({ ...planContext, plannedAt: '2026-08-13T20:32:00.000Z', planId: 'c1-22-test-access-plan' });
  const sourceObservation = { actualSha256: c21.derivativeRecord.derivativeSha256, fullDecodePassed: true, technical: { container: 'matroska', videoCodec: 'ffv1', audioCodec: 'pcm_s24le', pixelFormat: 'yuv420p', audioSampleRateHz: 48000, audioChannels: 2, durationSeconds: 2, width: 320, height: 180, frameRate: 24 } };
  const accessObservation = { actualSha256: '9'.repeat(64), fullDecodePassed: true, technical: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', audioSampleRateHz: 48000, audioChannels: 2, durationSeconds: 2.001, width: 320, height: 180, frameRate: 24 } };
  const qc = buildAccessDerivativeQcReport({ policy, plan, planContext, sourceObservation, accessObservation, observedAt: '2026-08-13T20:33:00.000Z', reportId: 'c1-22-test-qc' });
  const review = buildAccessDerivativeReview({ policy, plan, planContext, qcReport: qc, authorityId: 'michael-hughes', decision: 'APPROVE_ACCESS_DERIVATIVE', reason: 'Playback access derivative passes the bounded technical gate.', recordedAt: '2026-08-13T20:34:00.000Z', reviewId: 'c1-22-test-review' });
  const record = buildAccessDerivativeRecord({ policy, plan, planContext, qcReport: qc, review, recordedAt: '2026-08-13T20:35:00.000Z', derivativeId: 'c1-22-test-access-derivative' });
  const registerContext = { policy, sourceC21FormatMigrationRegisterHash: c21.c21Register.registerHash };
  return { ...c21, snapshot, derivativeContextBase, matrixContext, matrix, planContext, plan, sourceObservation, accessObservation, qc, review, record, registerContext };
}

test('C1.22 policy keeps original and preservation derivative authoritative and blocks release authority', () => {
  assert.equal(validateDecodeAccessPolicy(policy).valid, true);
  assert.equal(policy.originalStillRequired, true);
  assert.equal(policy.preservationDerivativeStillRequired, true);
  assert.equal(policy.accessDerivativeCanReplaceOriginal, false);
  assert.equal(policy.accessDerivativeCanReplacePreservationDerivative, false);
  assert.equal(policy.accessDerivativeCanAuthorizeRelease, false);
  assert.equal(policy.publicRelease, false);
});

test('decode environment snapshot hashes executable identity and decoder capabilities without credentials', () => {
  const f = fixture();
  assert.equal(validateDecodeEnvironmentSnapshot(f.snapshot, { policy }).valid, true);
  assert.equal(f.snapshot.credentialsCaptured, false);
  const bad = structuredClone(f.snapshot);
  bad.environment.ffmpeg.decodersOutputSha256 = '1'.repeat(64);
  assert.throws(() => validateDecodeEnvironmentSnapshot(bad, { policy }), /capability hash|self-hash/);
});

test('C1.22 refuses an unregistered C1.21 preservation derivative even if its record itself validates', () => {
  const f = fixture();
  const empty = buildFormatMigrationRegister({ policy: c21Policy, sourceC20PreservationRegisterHash: c21SourceC20, entries: [], revision: 0, recordedAt: '2026-08-13T20:29:00.000Z', registerId: 'empty-c21' });
  assert.throws(() => validateC21DerivativeRegistration({ ...f.derivativeContextBase, c21Register: empty }), /not registered/);
});

test('compatibility matrix passes only when original and preservation derivative hashes probe and fully decode', () => {
  const f = fixture();
  assert.equal(validateCompatibilityMatrix(f.matrix, f.matrixContext).status, 'PASS');
  assert.equal(f.matrix.preservationDerivativeCompatible, true);
  assert.equal(f.matrix.originalCompatibilityKnown, true);
});

test('compatibility matrix degrades, rather than inventing success, when the original is unavailable', () => {
  const f = fixture();
  const degraded = buildCompatibilityMatrix({ ...f.matrixContext, originalObservation: { available: false }, preservationObservation: { available: true, actualSha256: f.derivativeRecord.derivativeSha256, probePassed: true, fullDecodePassed: true, technical: {} }, observedAt: '2026-08-13T20:31:00.000Z', matrixId: 'degraded' });
  assert.equal(degraded.status, 'DEGRADED');
  assert.equal(degraded.originalCompatibilityKnown, false);
});

test('compatibility matrix fails when the preservation derivative bytes drift', () => {
  const f = fixture();
  const failed = buildCompatibilityMatrix({ ...f.matrixContext, originalObservation: { available: true, actualSha256: f.derivativeRecord.originalSha256, probePassed: true, fullDecodePassed: true, technical: {} }, preservationObservation: { available: true, actualSha256: '7'.repeat(64), probePassed: true, fullDecodePassed: true, technical: {} }, observedAt: '2026-08-13T20:31:00.000Z', matrixId: 'failed' });
  assert.equal(failed.status, 'FAIL');
  assert.throws(() => buildAccessDerivativePlan({ policy, environmentSnapshot: f.snapshot, compatibilityMatrix: failed, compatibilityContext: { ...f.matrixContext }, plannedAt: '2026-08-13T20:32:00.000Z' }), /requires compatible/);
});

test('access derivative plan rejects stale decoder snapshots and compatibility evidence', () => {
  const f = fixture();
  assert.equal(validateAccessDerivativePlan(f.plan, f.planContext).valid, true);
  assert.throws(() => buildAccessDerivativePlan({ ...f.planContext, plannedAt: '2026-10-20T20:32:00.000Z', planId: 'stale' }), /stale/);
});

test('access derivative QC requires the exact internal MP4 H.264 AAC playback profile and timeline parity', () => {
  const f = fixture();
  assert.equal(validateAccessDerivativeQcReport(f.qc, { policy, plan: f.plan, planContext: f.planContext }).status, 'PASS');
  const wrong = { ...f.accessObservation, technical: { ...f.accessObservation.technical, videoCodec: 'hevc' } };
  const qc = buildAccessDerivativeQcReport({ policy, plan: f.plan, planContext: f.planContext, sourceObservation: f.sourceObservation, accessObservation: wrong, observedAt: '2026-08-13T20:33:00.000Z', reportId: 'wrong-profile' });
  assert.equal(qc.status, 'FAIL');
  assert.equal(qc.checks.videoCodecPass, false);
});

test('access derivative QC rejects excessive duration drift instead of treating lossy access as preservation equivalence', () => {
  const f = fixture();
  const wrong = { ...f.accessObservation, technical: { ...f.accessObservation.technical, durationSeconds: 2.5 } };
  const qc = buildAccessDerivativeQcReport({ policy, plan: f.plan, planContext: f.planContext, sourceObservation: f.sourceObservation, accessObservation: wrong, observedAt: '2026-08-13T20:33:00.000Z', reportId: 'duration-drift' });
  assert.equal(qc.status, 'FAIL');
  assert.equal(qc.checks.durationPass, false);
});

test('human access review cannot approve failed QC and remains access-only', () => {
  const f = fixture();
  assert.equal(validateAccessDerivativeReview(f.review, { policy, plan: f.plan, planContext: f.planContext, qcReport: f.qc }).valid, true);
  assert.equal(f.review.approvalScope, 'ACCESS_ONLY_NOT_PRESERVATION_NOT_RELEASE');
  const badQc = structuredClone(f.qc);
  badQc.status = 'FAIL';
  assert.throws(() => buildAccessDerivativeReview({ policy, plan: f.plan, planContext: f.planContext, qcReport: badQc, authorityId: 'michael-hughes', decision: 'APPROVE_ACCESS_DERIVATIVE', reason: 'no', recordedAt: '2026-08-13T20:34:00.000Z' }), /drift|failed|self-hash/);
});

test('access derivative record preserves both authoritative ancestors and cannot become preservation or release authority', () => {
  const f = fixture();
  assert.equal(validateAccessDerivativeRecord(f.record, { policy, plan: f.plan, planContext: f.planContext, qcReport: f.qc, review: f.review }).valid, true);
  assert.equal(f.record.originalStillRequired, true);
  assert.equal(f.record.preservationDerivativeStillRequired, true);
  assert.equal(f.record.accessDerivativeIsPreservationAuthority, false);
  assert.equal(f.record.accessDerivativeIsReleaseAuthority, false);
});

test('decode/access register records snapshots, compatibility matrices, and approved access derivatives append-only', () => {
  const f = fixture();
  let r = buildDecodeAccessRegister({ ...f.registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:36:00.000Z', registerId: 'c1-22-test-register' });
  r = appendDecodeEnvironmentSnapshot({ register: r, snapshot: f.snapshot, policy, registerContext: f.registerContext, recordedAt: '2026-08-13T20:37:00.000Z' });
  r = appendCompatibilityMatrix({ register: r, matrix: f.matrix, matrixContext: f.matrixContext, registerContext: f.registerContext, recordedAt: '2026-08-13T20:38:00.000Z' });
  r = appendAccessDerivative({ register: r, accessDerivativeRecord: f.record, recordContext: { policy, plan: f.plan, planContext: f.planContext, qcReport: f.qc, review: f.review }, registerContext: f.registerContext, recordedAt: '2026-08-13T20:39:00.000Z' });
  assert.equal(validateDecodeAccessRegister(r, f.registerContext).valid, true);
  assert.equal(r.revision, 3);
  assert.equal(r.snapshotCount, 1);
  assert.equal(r.compatibilityMatrixCount, 1);
  assert.equal(r.accessDerivativeCount, 1);
  assert.throws(() => appendAccessDerivative({ register: r, accessDerivativeRecord: f.record, recordContext: { policy, plan: f.plan, planContext: f.planContext, qcReport: f.qc, review: f.review }, registerContext: f.registerContext, recordedAt: '2026-08-13T20:40:00.000Z' }), /already registered/);
});

test('decode/access register detects historical entry tampering', () => {
  const f = fixture();
  let r = buildDecodeAccessRegister({ ...f.registerContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:36:00.000Z' });
  r = appendDecodeEnvironmentSnapshot({ register: r, snapshot: f.snapshot, policy, registerContext: f.registerContext, recordedAt: '2026-08-13T20:37:00.000Z' });
  const bad = structuredClone(r);
  bad.entries[0].capabilityHash = '7'.repeat(64);
  assert.throws(() => validateDecodeAccessRegister(bad, f.registerContext), /entry self-hash|register self-hash/);
});

test('canonical C1.22 register remains revision 0 because PN-0001 has no real C1.21 preservation derivative', () => {
  const r = read('pn-0001-c1-22-decode-access-register.json');
  const ctx = { policy, sourceC21FormatMigrationRegisterHash: canonicalC21Hash };
  assert.equal(validateDecodeAccessRegister(r, ctx).valid, true);
  const status = classifyDecodeAccessState({ ...ctx, register: r, now: '2026-08-13T21:40:00.000Z' });
  assert.equal(status.registerRevision, 0);
  assert.equal(status.environmentSnapshots, 0);
  assert.equal(status.compatibilityMatrices, 0);
  assert.equal(status.accessDerivatives, 0);
  assert.equal(status.publicRelease, false);
  assert.equal(status.relayDependency, false);
});

test('C1.22 validators reject unknown-field injection even when the attacker keeps the old canonical hash', () => {
  const f = fixture();
  const matrix = structuredClone(f.matrix);
  matrix.untrustedExtraField = 'should-not-pass';
  assert.throws(() => validateCompatibilityMatrix(matrix, f.matrixContext), /received-object self-hash/);
  const plan = structuredClone(f.plan);
  plan.untrustedExtraField = true;
  assert.throws(() => validateAccessDerivativePlan(plan, f.planContext), /received-object self-hash/);
  const qc = structuredClone(f.qc);
  qc.untrustedExtraField = 123;
  assert.throws(() => validateAccessDerivativeQcReport(qc, { policy, plan: f.plan, planContext: f.planContext }), /received-object self-hash/);
});

test('decode environment validator rejects malformed individual capability hashes even if an attacker recomputes outer hashes', () => {
  const f = fixture();
  const bad = structuredClone(f.snapshot);
  bad.environment.ffmpeg.formatsOutputSha256 = 'not-a-sha';
  assert.throws(() => validateDecodeEnvironmentSnapshot(bad, { policy }), /formatsOutputSha256 must be SHA-256/);
});
