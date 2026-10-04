import { digestJson } from './authorization-seal.js';
import {
  validateFormatPreservationPolicy,
  validateFormatMigrationRegister,
  validatePreservationDerivativeRecord,
} from './format-obsolescence-migration.js';

export const CINESWARM_DECODE_ACCESS_POLICY_SCHEMA = 'parallax.cineswarm.decode-access-policy.c1.22.v0.1';
export const CINESWARM_DECODE_ENVIRONMENT_SNAPSHOT_SCHEMA = 'parallax.cineswarm.decode-environment-snapshot.c1.22.v0.1';
export const CINESWARM_COMPATIBILITY_MATRIX_SCHEMA = 'parallax.cineswarm.compatibility-matrix.c1.22.v0.1';
export const CINESWARM_ACCESS_DERIVATIVE_PLAN_SCHEMA = 'parallax.cineswarm.access-derivative-plan.c1.22.v0.1';
export const CINESWARM_ACCESS_DERIVATIVE_QC_SCHEMA = 'parallax.cineswarm.access-derivative-qc.c1.22.v0.1';
export const CINESWARM_ACCESS_DERIVATIVE_REVIEW_SCHEMA = 'parallax.cineswarm.access-derivative-review.c1.22.v0.1';
export const CINESWARM_ACCESS_DERIVATIVE_RECORD_SCHEMA = 'parallax.cineswarm.access-derivative.c1.22.v0.1';
export const CINESWARM_DECODE_ACCESS_REGISTER_SCHEMA = 'parallax.cineswarm.decode-access-register.c1.22.v0.1';

function requiredString(v, label) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${label} must be a non-empty string`);
  return v.trim();
}
function safeToken(v, label) {
  const s = requiredString(v, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${label} contains unsupported characters`);
  return s;
}
function sha(v, label) {
  const s = requiredString(v, label);
  if (!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${label} must be SHA-256`);
  return s;
}
function time(v, label) {
  const s = requiredString(v, label);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`${label} must be ISO-8601`);
  return { s, t };
}
function strip(v, fields) {
  const x = structuredClone(v);
  for (const field of fields) delete x[field];
  return x;
}
function boolTrue(v, label) { if (v !== true) throw new Error(`${label} must remain true`); }
function boolFalse(v, label) { if (v !== false) throw new Error(`${label} must remain false`); }
function boundary(v, label) {
  boolFalse(v.originalDeleteAuthorized, `${label}.originalDeleteAuthorized`);
  boolFalse(v.preservationDerivativeDeleteAuthorized, `${label}.preservationDerivativeDeleteAuthorized`);
  boolFalse(v.accessDerivativeCanReplaceOriginal, `${label}.accessDerivativeCanReplaceOriginal`);
  boolFalse(v.accessDerivativeCanReplacePreservationDerivative, `${label}.accessDerivativeCanReplacePreservationDerivative`);
  boolFalse(v.accessDerivativeCanAuthorizeRelease, `${label}.accessDerivativeCanAuthorizeRelease`);
  boolFalse(v.publicRelease, `${label}.publicRelease`);
  boolFalse(v.relayDependency, `${label}.relayDependency`);
}
function ageMs(a, b) { return time(b, 'laterAt').t - time(a, 'earlierAt').t; }
function positiveInt(v, label, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${label} must be an integer ${min}-${max}`);
  return v;
}
function positiveNumber(v, label, min = 0, max = Number.MAX_VALUE) {
  if (!Number.isFinite(Number(v)) || Number(v) < min || Number(v) > max) throw new Error(`${label} must be ${min}-${max}`);
  return Number(v);
}

export function validateDecodeAccessPolicy(policy) {
  if (!policy || policy.schema !== CINESWARM_DECODE_ACCESS_POLICY_SCHEMA) throw new Error('invalid C1.22 policy schema');
  for (const [v, l] of [[policy.policyId, 'policyId'], [policy.c21PolicyId, 'c21PolicyId'], [policy.episodeId, 'episodeId'], [policy.sequenceId, 'sequenceId'], [policy.networkId, 'networkId'], [policy.accessProfile?.profileId, 'accessProfile.profileId']]) safeToken(v, l);
  positiveInt(policy.maxEnvironmentSnapshotAgeDays, 'maxEnvironmentSnapshotAgeDays', 1, 3650);
  positiveInt(policy.maxCompatibilityMatrixAgeDays, 'maxCompatibilityMatrixAgeDays', 1, 3650);
  positiveNumber(policy.maxAccessDurationDeltaSeconds, 'maxAccessDurationDeltaSeconds', 0, 5);
  if (policy.accessProfile.container !== 'mp4' || policy.accessProfile.videoCodec !== 'h264' || policy.accessProfile.audioCodec !== 'aac') throw new Error('C1.22 internal access profile drift detected');
  if (policy.accessProfile.pixelFormat !== 'yuv420p' || policy.accessProfile.audioSampleRateHz !== 48000 || policy.accessProfile.audioChannels !== 2) throw new Error('C1.22 access technical profile drift detected');
  if (!Number.isInteger(policy.accessProfile.videoCrf) || policy.accessProfile.videoCrf < 0 || policy.accessProfile.videoCrf > 51) throw new Error('accessProfile.videoCrf invalid');
  for (const k of ['requireExecutableHashes', 'requireCapabilityHashes', 'requireFullDecode', 'requireFfprobe', 'requireC21DerivativeValidation', 'requirePreservationDerivativeCompatibility', 'requireAccessProfileMatch', 'requireTimelineParity', 'requireGeometryParity', 'requireFrameRateParity', 'requireHumanAccessReview', 'appendOnlyDecodeAccessRegister', 'originalStillRequired', 'preservationDerivativeStillRequired']) boolTrue(policy[k], k);
  for (const k of ['autoDownloadDecoder', 'autoTranscodeForRelease', 'originalDeleteAuthorized', 'preservationDerivativeDeleteAuthorized', 'accessDerivativeCanReplaceOriginal', 'accessDerivativeCanReplacePreservationDerivative', 'accessDerivativeCanAuthorizeRelease', 'publicRelease', 'relayDependency']) boolFalse(policy[k], k);
  return { valid: true };
}

function snapshotPayload(v) { return strip(v, ['snapshotHash']); }
export function buildDecodeEnvironmentSnapshot({ policy, environment, capturedAt, snapshotId = 'decode-environment-snapshot' }) {
  validateDecodeAccessPolicy(policy);
  safeToken(snapshotId, 'snapshotId');
  time(capturedAt, 'capturedAt');
  for (const [v, l] of [[environment.platform, 'environment.platform'], [environment.arch, 'environment.arch'], [environment.nodeVersion, 'environment.nodeVersion'], [environment.ffmpeg?.versionLine, 'ffmpeg.versionLine'], [environment.ffprobe?.versionLine, 'ffprobe.versionLine']]) requiredString(v, l);
  for (const [v, l] of [
    [environment.ffmpeg?.executableSha256, 'ffmpeg.executableSha256'],
    [environment.ffprobe?.executableSha256, 'ffprobe.executableSha256'],
    [environment.ffmpeg?.versionOutputSha256, 'ffmpeg.versionOutputSha256'],
    [environment.ffprobe?.versionOutputSha256, 'ffprobe.versionOutputSha256'],
    [environment.ffmpeg?.decodersOutputSha256, 'ffmpeg.decodersOutputSha256'],
    [environment.ffmpeg?.encodersOutputSha256, 'ffmpeg.encodersOutputSha256'],
    [environment.ffmpeg?.formatsOutputSha256, 'ffmpeg.formatsOutputSha256'],
  ]) sha(v, l);
  const capabilityHash = digestJson({
    ffmpegVersion: environment.ffmpeg.versionOutputSha256,
    ffprobeVersion: environment.ffprobe.versionOutputSha256,
    decoders: environment.ffmpeg.decodersOutputSha256,
    encoders: environment.ffmpeg.encodersOutputSha256,
    formats: environment.ffmpeg.formatsOutputSha256,
  });
  const out = {
    schema: CINESWARM_DECODE_ENVIRONMENT_SNAPSHOT_SCHEMA,
    snapshotId,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    environment: structuredClone(environment),
    capabilityHash,
    capturedAt,
    credentialsCaptured: false,
    decoderEnvironmentCanAuthorizeRelease: false,
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.snapshotHash = digestJson(snapshotPayload(out));
  return out;
}
export function validateDecodeEnvironmentSnapshot(v, { policy }) {
  validateDecodeAccessPolicy(policy);
  if (v?.schema !== CINESWARM_DECODE_ENVIRONMENT_SNAPSHOT_SCHEMA) throw new Error('invalid C1.22 environment snapshot schema');
  if (v.policyId !== policy.policyId) throw new Error('environment snapshot policy drift');
  time(v.capturedAt, 'capturedAt');
  for (const [value, label] of [
    [v.environment?.ffmpeg?.executableSha256, 'ffmpeg.executableSha256'],
    [v.environment?.ffprobe?.executableSha256, 'ffprobe.executableSha256'],
    [v.environment?.ffmpeg?.versionOutputSha256, 'ffmpeg.versionOutputSha256'],
    [v.environment?.ffprobe?.versionOutputSha256, 'ffprobe.versionOutputSha256'],
    [v.environment?.ffmpeg?.decodersOutputSha256, 'ffmpeg.decodersOutputSha256'],
    [v.environment?.ffmpeg?.encodersOutputSha256, 'ffmpeg.encodersOutputSha256'],
    [v.environment?.ffmpeg?.formatsOutputSha256, 'ffmpeg.formatsOutputSha256'],
    [v.capabilityHash, 'capabilityHash'],
  ]) sha(value, label);
  requiredString(v.environment?.ffmpeg?.versionLine, 'ffmpeg.versionLine');
  requiredString(v.environment?.ffprobe?.versionLine, 'ffprobe.versionLine');
  const expectedCapabilityHash = digestJson({ ffmpegVersion: v.environment.ffmpeg.versionOutputSha256, ffprobeVersion: v.environment.ffprobe.versionOutputSha256, decoders: v.environment.ffmpeg.decodersOutputSha256, encoders: v.environment.ffmpeg.encodersOutputSha256, formats: v.environment.ffmpeg.formatsOutputSha256 });
  if (expectedCapabilityHash !== v.capabilityHash) throw new Error('environment capability hash drift');
  if (v.credentialsCaptured !== false || v.decoderEnvironmentCanAuthorizeRelease !== false) throw new Error('environment snapshot authority boundary drift');
  boundary(v, 'environmentSnapshot');
  if (digestJson(snapshotPayload(v)) !== v.snapshotHash) throw new Error('environment snapshot self-hash mismatch');
  return { valid: true };
}

export function validateC21DerivativeRegistration({ c21Policy, c21Register, c21SourceC20PreservationRegisterHash, derivativeRecord, derivativeContext }) {
  validateFormatPreservationPolicy(c21Policy);
  validateFormatMigrationRegister(c21Register, { policy: c21Policy, sourceC20PreservationRegisterHash: c21SourceC20PreservationRegisterHash });
  validatePreservationDerivativeRecord(derivativeRecord, derivativeContext);
  if (derivativeRecord.policyId !== c21Policy.policyId) throw new Error('C1.21 derivative policy drift');
  const entry = c21Register.entries.find((e) => e.derivativeRecordHash === derivativeRecord.derivativeRecordHash);
  if (!entry) throw new Error('preservation derivative is not registered in C1.21');
  if (entry.originalSha256 !== derivativeRecord.originalSha256 || entry.derivativeSha256 !== derivativeRecord.derivativeSha256) throw new Error('C1.21 registered derivative hash lineage drift');
  return { valid: true, entry };
}

function normalizeCompatibilityObservation(input, expectedSha256, role) {
  const available = input.available === true;
  if (!available) {
    return { role, expectedSha256, available: false, actualSha256: null, probePassed: false, fullDecodePassed: false, technical: null, status: 'UNAVAILABLE' };
  }
  const actualSha256 = sha(input.actualSha256, `${role}.actualSha256`);
  const probePassed = input.probePassed === true;
  const fullDecodePassed = input.fullDecodePassed === true;
  const technical = structuredClone(input.technical ?? {});
  const status = actualSha256 === expectedSha256 && probePassed && fullDecodePassed ? 'PASS' : 'FAIL';
  return { role, expectedSha256, available: true, actualSha256, probePassed, fullDecodePassed, technical, status };
}
function matrixPayload(v) { return strip(v, ['matrixHash']); }
export function buildCompatibilityMatrix({ policy, environmentSnapshot, c21Policy, c21Register, c21SourceC20PreservationRegisterHash, derivativeRecord, derivativeContext, originalObservation, preservationObservation, observedAt, matrixId = 'decode-compatibility-matrix' }) {
  validateDecodeEnvironmentSnapshot(environmentSnapshot, { policy });
  validateC21DerivativeRegistration({ c21Policy, c21Register, c21SourceC20PreservationRegisterHash, derivativeRecord, derivativeContext });
  time(observedAt, 'observedAt');
  if (time(observedAt, 'observedAt').t < time(environmentSnapshot.capturedAt, 'capturedAt').t) throw new Error('compatibility matrix cannot predate environment snapshot');
  const original = normalizeCompatibilityObservation(originalObservation, derivativeRecord.originalSha256, 'ORIGINAL_MASTER');
  const preservation = normalizeCompatibilityObservation(preservationObservation, derivativeRecord.derivativeSha256, 'PRESERVATION_DERIVATIVE');
  let status = 'PASS';
  if (preservation.status !== 'PASS' || original.status === 'FAIL') status = 'FAIL';
  else if (original.status === 'UNAVAILABLE') status = 'DEGRADED';
  const out = {
    schema: CINESWARM_COMPATIBILITY_MATRIX_SCHEMA,
    matrixId,
    policyId: policy.policyId,
    environmentSnapshotHash: environmentSnapshot.snapshotHash,
    c21DerivativeRecordHash: derivativeRecord.derivativeRecordHash,
    observations: [original, preservation],
    preservationDerivativeCompatible: preservation.status === 'PASS',
    originalCompatibilityKnown: original.status !== 'UNAVAILABLE',
    status,
    observedAt,
    matrixCanAuthorizeRelease: false,
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.matrixHash = digestJson(matrixPayload(out));
  return out;
}
export function validateCompatibilityMatrix(v, ctx) {
  validateDecodeEnvironmentSnapshot(ctx.environmentSnapshot, { policy: ctx.policy });
  validateC21DerivativeRegistration(ctx);
  if (v?.schema !== CINESWARM_COMPATIBILITY_MATRIX_SCHEMA) throw new Error('invalid C1.22 compatibility matrix schema');
  if (!Array.isArray(v.observations) || v.observations.length !== 2) throw new Error('compatibility matrix must contain exactly two authoritative observations');
  if (v.observations.filter((x) => x.role === 'ORIGINAL_MASTER').length !== 1 || v.observations.filter((x) => x.role === 'PRESERVATION_DERIVATIVE').length !== 1) throw new Error('compatibility matrix roles must be unique and complete');
  if (digestJson(matrixPayload(v)) !== v.matrixHash) throw new Error('compatibility matrix received-object self-hash mismatch');
  const rebuilt = buildCompatibilityMatrix({ ...ctx, originalObservation: v.observations.find((x) => x.role === 'ORIGINAL_MASTER'), preservationObservation: v.observations.find((x) => x.role === 'PRESERVATION_DERIVATIVE'), observedAt: v.observedAt, matrixId: v.matrixId });
  if (rebuilt.matrixHash !== v.matrixHash) throw new Error('compatibility matrix drift or self-hash mismatch');
  boundary(v, 'compatibilityMatrix');
  return { valid: true, status: v.status };
}

function planPayload(v) { return strip(v, ['planHash']); }
export function buildAccessDerivativePlan({ policy, environmentSnapshot, compatibilityMatrix, compatibilityContext, plannedAt, planId = 'access-derivative-plan' }) {
  validateCompatibilityMatrix(compatibilityMatrix, compatibilityContext);
  if (!['PASS', 'DEGRADED'].includes(compatibilityMatrix.status) || compatibilityMatrix.preservationDerivativeCompatible !== true) throw new Error('access derivative requires compatible C1.21 preservation derivative');
  const now = time(plannedAt, 'plannedAt').t;
  if (now < time(compatibilityMatrix.observedAt, 'observedAt').t) throw new Error('access plan cannot predate compatibility matrix');
  if (ageMs(environmentSnapshot.capturedAt, plannedAt) > policy.maxEnvironmentSnapshotAgeDays * 86400000) throw new Error('decode environment snapshot is stale');
  if (ageMs(compatibilityMatrix.observedAt, plannedAt) > policy.maxCompatibilityMatrixAgeDays * 86400000) throw new Error('compatibility matrix is stale');
  const derivativeRecord = compatibilityContext.derivativeRecord;
  const out = {
    schema: CINESWARM_ACCESS_DERIVATIVE_PLAN_SCHEMA,
    planId,
    policyId: policy.policyId,
    environmentSnapshotHash: environmentSnapshot.snapshotHash,
    compatibilityMatrixHash: compatibilityMatrix.matrixHash,
    c21DerivativeRecordHash: derivativeRecord.derivativeRecordHash,
    sourcePreservationDerivativeSha256: derivativeRecord.derivativeSha256,
    originalSha256: derivativeRecord.originalSha256,
    accessProfile: structuredClone(policy.accessProfile),
    plannedAt,
    sourceIsPreservationDerivative: true,
    originalStillRequired: true,
    preservationDerivativeStillRequired: true,
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.planHash = digestJson(planPayload(out));
  return out;
}
export function validateAccessDerivativePlan(v, { policy, environmentSnapshot, compatibilityMatrix, compatibilityContext }) {
  if (v?.schema !== CINESWARM_ACCESS_DERIVATIVE_PLAN_SCHEMA) throw new Error('invalid access derivative plan schema');
  if (digestJson(planPayload(v)) !== v.planHash) throw new Error('access derivative plan received-object self-hash mismatch');
  const rebuilt = buildAccessDerivativePlan({ policy, environmentSnapshot, compatibilityMatrix, compatibilityContext, plannedAt: v.plannedAt, planId: v.planId });
  if (rebuilt.planHash !== v.planHash) throw new Error('access derivative plan drift or self-hash mismatch');
  boundary(v, 'accessPlan');
  return { valid: true };
}

function qcPayload(v) { return strip(v, ['qcHash']); }
export function buildAccessDerivativeQcReport({ policy, plan, planContext, sourceObservation, accessObservation, observedAt, reportId = 'access-derivative-qc' }) {
  validateAccessDerivativePlan(plan, planContext);
  if (sourceObservation.actualSha256 !== plan.sourcePreservationDerivativeSha256) throw new Error('access QC source preservation hash drift');
  sha(accessObservation.actualSha256, 'accessObservation.actualSha256');
  const s = sourceObservation.technical ?? {};
  const a = accessObservation.technical ?? {};
  const checks = {
    sourceHashMatch: sourceObservation.actualSha256 === plan.sourcePreservationDerivativeSha256,
    sourceFullDecodePass: sourceObservation.fullDecodePassed === true,
    accessFullDecodePass: accessObservation.fullDecodePassed === true,
    containerPass: a.container === policy.accessProfile.container,
    videoCodecPass: a.videoCodec === policy.accessProfile.videoCodec,
    audioCodecPass: a.audioCodec === policy.accessProfile.audioCodec,
    pixelFormatPass: a.pixelFormat === policy.accessProfile.pixelFormat,
    audioSampleRatePass: Number(a.audioSampleRateHz) === policy.accessProfile.audioSampleRateHz,
    audioChannelsPass: Number(a.audioChannels) === policy.accessProfile.audioChannels,
    durationPass: Math.abs(Number(a.durationSeconds) - Number(s.durationSeconds)) <= policy.maxAccessDurationDeltaSeconds,
    geometryPass: Number(a.width) === Number(s.width) && Number(a.height) === Number(s.height),
    frameRatePass: Math.abs(Number(a.frameRate) - Number(s.frameRate)) < 0.001,
  };
  const status = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
  const out = {
    schema: CINESWARM_ACCESS_DERIVATIVE_QC_SCHEMA,
    reportId,
    policyId: policy.policyId,
    planHash: plan.planHash,
    environmentSnapshotHash: plan.environmentSnapshotHash,
    compatibilityMatrixHash: plan.compatibilityMatrixHash,
    sourceObservation: structuredClone(sourceObservation),
    accessObservation: structuredClone(accessObservation),
    checks,
    status,
    observedAt,
    accessDerivativeIsPreservationAuthority: false,
    accessDerivativeIsReleaseAuthority: false,
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.qcHash = digestJson(qcPayload(out));
  return out;
}
export function validateAccessDerivativeQcReport(v, { policy, plan, planContext }) {
  if (v?.schema !== CINESWARM_ACCESS_DERIVATIVE_QC_SCHEMA) throw new Error('invalid access derivative QC schema');
  if (digestJson(qcPayload(v)) !== v.qcHash) throw new Error('access derivative QC received-object self-hash mismatch');
  const rebuilt = buildAccessDerivativeQcReport({ policy, plan, planContext, sourceObservation: v.sourceObservation, accessObservation: v.accessObservation, observedAt: v.observedAt, reportId: v.reportId });
  if (rebuilt.qcHash !== v.qcHash) throw new Error('access derivative QC drift or self-hash mismatch');
  boundary(v, 'accessQc');
  return { valid: true, status: v.status };
}

function reviewPayload(v) { return strip(v, ['reviewHash']); }
export function buildAccessDerivativeReview({ policy, plan, planContext, qcReport, authorityId, decision, reason, recordedAt, reviewId = 'access-derivative-review' }) {
  validateAccessDerivativeQcReport(qcReport, { policy, plan, planContext });
  if (!['APPROVE_ACCESS_DERIVATIVE', 'REVISE', 'HOLD'].includes(decision)) throw new Error('invalid access derivative review decision');
  if (decision === 'APPROVE_ACCESS_DERIVATIVE' && qcReport.status !== 'PASS') throw new Error('human cannot approve failed access derivative QC');
  const out = {
    schema: CINESWARM_ACCESS_DERIVATIVE_REVIEW_SCHEMA,
    reviewId,
    policyId: policy.policyId,
    planHash: plan.planHash,
    qcHash: qcReport.qcHash,
    authority: { kind: 'human', id: safeToken(authorityId, 'authorityId') },
    simulated: false,
    decision,
    reason: requiredString(reason, 'reason'),
    recordedAt,
    approvalScope: 'ACCESS_ONLY_NOT_PRESERVATION_NOT_RELEASE',
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.reviewHash = digestJson(reviewPayload(out));
  return out;
}
export function validateAccessDerivativeReview(v, { policy, plan, planContext, qcReport }) {
  validateAccessDerivativeQcReport(qcReport, { policy, plan, planContext });
  if (v?.schema !== CINESWARM_ACCESS_DERIVATIVE_REVIEW_SCHEMA) throw new Error('invalid access derivative review schema');
  if (v.authority?.kind !== 'human' || v.simulated !== false) throw new Error('access derivative approval requires real human review');
  if (v.planHash !== plan.planHash || v.qcHash !== qcReport.qcHash) throw new Error('access derivative review lineage drift');
  if (v.decision === 'APPROVE_ACCESS_DERIVATIVE' && qcReport.status !== 'PASS') throw new Error('approved access derivative has failed QC');
  boundary(v, 'accessReview');
  if (digestJson(reviewPayload(v)) !== v.reviewHash) throw new Error('access derivative review self-hash mismatch');
  return { valid: true };
}

function recordPayload(v) { return strip(v, ['accessDerivativeRecordHash']); }
export function buildAccessDerivativeRecord({ policy, plan, planContext, qcReport, review, recordedAt, derivativeId = 'preservation-access-derivative' }) {
  validateAccessDerivativeReview(review, { policy, plan, planContext, qcReport });
  if (review.decision !== 'APPROVE_ACCESS_DERIVATIVE') throw new Error('access derivative record requires human APPROVE_ACCESS_DERIVATIVE');
  if (time(recordedAt, 'recordedAt').t < time(review.recordedAt, 'review.recordedAt').t) throw new Error('access derivative record cannot predate human review');
  const out = {
    schema: CINESWARM_ACCESS_DERIVATIVE_RECORD_SCHEMA,
    derivativeId,
    policyId: policy.policyId,
    planHash: plan.planHash,
    qcHash: qcReport.qcHash,
    reviewHash: review.reviewHash,
    c21DerivativeRecordHash: plan.c21DerivativeRecordHash,
    originalSha256: plan.originalSha256,
    preservationDerivativeSha256: plan.sourcePreservationDerivativeSha256,
    accessDerivativeSha256: qcReport.accessObservation.actualSha256,
    accessProfile: structuredClone(policy.accessProfile),
    recordedAt,
    originalStillRequired: true,
    preservationDerivativeStillRequired: true,
    accessDerivativeMayBeUsedForPlayback: true,
    accessDerivativeIsPreservationAuthority: false,
    accessDerivativeIsReleaseAuthority: false,
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.accessDerivativeRecordHash = digestJson(recordPayload(out));
  return out;
}
export function validateAccessDerivativeRecord(v, { policy, plan, planContext, qcReport, review }) {
  validateAccessDerivativeReview(review, { policy, plan, planContext, qcReport });
  if (v?.schema !== CINESWARM_ACCESS_DERIVATIVE_RECORD_SCHEMA) throw new Error('invalid access derivative record schema');
  if (v.preservationDerivativeSha256 !== plan.sourcePreservationDerivativeSha256 || v.accessDerivativeSha256 !== qcReport.accessObservation.actualSha256) throw new Error('access derivative record lineage drift');
  if (v.originalStillRequired !== true || v.preservationDerivativeStillRequired !== true || v.accessDerivativeIsPreservationAuthority !== false || v.accessDerivativeIsReleaseAuthority !== false) throw new Error('access derivative authority boundary drift');
  boundary(v, 'accessRecord');
  if (digestJson(recordPayload(v)) !== v.accessDerivativeRecordHash) throw new Error('access derivative record self-hash mismatch');
  return { valid: true };
}

function registerPayload(v) { return strip(v, ['registerHash']); }
function validateRegisterEntries(entries) {
  let prev = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.index !== index + 1 || entry.previousEntryHash !== prev) throw new Error('decode/access register hash chain invalid');
    sha(entry.entryHash, 'entryHash');
    if (digestJson(strip(entry, ['entryHash'])) !== entry.entryHash) throw new Error('decode/access register entry self-hash mismatch');
    prev = entry.entryHash;
  }
  return prev;
}
export function buildDecodeAccessRegister({ policy, sourceC21FormatMigrationRegisterHash, entries = [], revision = entries.length, recordedAt, registerId = 'decode-access-register' }) {
  validateDecodeAccessPolicy(policy);
  sha(sourceC21FormatMigrationRegisterHash, 'sourceC21FormatMigrationRegisterHash');
  if (revision !== entries.length) throw new Error('decode/access register revision must equal entry count');
  const headHash = validateRegisterEntries(entries);
  const snapshotCount = entries.filter((e) => e.event === 'DECODE_ENVIRONMENT_SNAPSHOT_RECORDED').length;
  const matrixCount = entries.filter((e) => e.event === 'COMPATIBILITY_MATRIX_RECORDED').length;
  const accessDerivativeCount = entries.filter((e) => e.event === 'ACCESS_DERIVATIVE_RECORDED').length;
  const out = {
    schema: CINESWARM_DECODE_ACCESS_REGISTER_SCHEMA,
    registerId,
    policyId: policy.policyId,
    c21PolicyId: policy.c21PolicyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    networkId: policy.networkId,
    sourceC21FormatMigrationRegisterHash,
    revision,
    recordedAt,
    entries: structuredClone(entries),
    entryCount: entries.length,
    headHash,
    snapshotCount,
    compatibilityMatrixCount: matrixCount,
    accessDerivativeCount,
    status: entries.length ? 'DECODE_ACCESS_HISTORY_PRESENT' : 'EMPTY_NO_DECODE_ACCESS_HISTORY',
    originalDeleteAuthorized: false,
    preservationDerivativeDeleteAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.registerHash = digestJson(registerPayload(out));
  return out;
}
export function validateDecodeAccessRegister(v, { policy, sourceC21FormatMigrationRegisterHash }) {
  const rebuilt = buildDecodeAccessRegister({ policy, sourceC21FormatMigrationRegisterHash, entries: v.entries, revision: v.revision, recordedAt: v.recordedAt, registerId: v.registerId });
  if (rebuilt.registerHash !== v.registerHash) throw new Error('decode/access register self-hash mismatch');
  boundary(v, 'decodeAccessRegister');
  return { valid: true };
}
function appendRegisterEvent({ register, registerContext, event, payload, recordedAt }) {
  validateDecodeAccessRegister(register, registerContext);
  const entry = { index: register.entries.length + 1, event, ...payload, recordedAt, previousEntryHash: register.headHash };
  entry.entryHash = digestJson(strip(entry, ['entryHash']));
  return buildDecodeAccessRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt, registerId: register.registerId });
}
export function appendDecodeEnvironmentSnapshot({ register, snapshot, policy, registerContext, recordedAt }) {
  validateDecodeEnvironmentSnapshot(snapshot, { policy });
  if (register.entries.some((e) => e.snapshotHash === snapshot.snapshotHash)) throw new Error('decode environment snapshot already registered');
  return appendRegisterEvent({ register, registerContext, event: 'DECODE_ENVIRONMENT_SNAPSHOT_RECORDED', payload: { snapshotId: snapshot.snapshotId, snapshotHash: snapshot.snapshotHash, capabilityHash: snapshot.capabilityHash }, recordedAt });
}
export function appendCompatibilityMatrix({ register, matrix, matrixContext, registerContext, recordedAt }) {
  validateCompatibilityMatrix(matrix, matrixContext);
  if (register.entries.some((e) => e.matrixHash === matrix.matrixHash)) throw new Error('compatibility matrix already registered');
  return appendRegisterEvent({ register, registerContext, event: 'COMPATIBILITY_MATRIX_RECORDED', payload: { matrixId: matrix.matrixId, matrixHash: matrix.matrixHash, environmentSnapshotHash: matrix.environmentSnapshotHash, status: matrix.status }, recordedAt });
}
export function appendAccessDerivative({ register, accessDerivativeRecord, recordContext, registerContext, recordedAt }) {
  validateAccessDerivativeRecord(accessDerivativeRecord, recordContext);
  if (register.entries.some((e) => e.accessDerivativeRecordHash === accessDerivativeRecord.accessDerivativeRecordHash || e.accessDerivativeSha256 === accessDerivativeRecord.accessDerivativeSha256)) throw new Error('access derivative already registered');
  return appendRegisterEvent({ register, registerContext, event: 'ACCESS_DERIVATIVE_RECORDED', payload: { derivativeId: accessDerivativeRecord.derivativeId, accessDerivativeRecordHash: accessDerivativeRecord.accessDerivativeRecordHash, preservationDerivativeSha256: accessDerivativeRecord.preservationDerivativeSha256, accessDerivativeSha256: accessDerivativeRecord.accessDerivativeSha256 }, recordedAt });
}

export function classifyDecodeAccessState({ policy, register, sourceC21FormatMigrationRegisterHash, now }) {
  validateDecodeAccessRegister(register, { policy, sourceC21FormatMigrationRegisterHash });
  return {
    phase: 'C1.22',
    status: register.status,
    registerRevision: register.revision,
    environmentSnapshots: register.snapshotCount,
    compatibilityMatrices: register.compatibilityMatrixCount,
    accessDerivatives: register.accessDerivativeCount,
    currentTime: now,
    environmentFreshnessPolicyDays: policy.maxEnvironmentSnapshotAgeDays,
    compatibilityFreshnessPolicyDays: policy.maxCompatibilityMatrixAgeDays,
    originalDeletionAuthorized: false,
    preservationDerivativeDeletionAuthorized: false,
    accessDerivativeCanReplaceOriginal: false,
    accessDerivativeCanReplacePreservationDerivative: false,
    accessDerivativeCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}
