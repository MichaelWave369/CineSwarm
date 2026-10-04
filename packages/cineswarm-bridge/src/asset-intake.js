import { createHash } from 'node:crypto';
import { basename, posix } from 'node:path';
import { digestProviderRequest, validateProviderRequestForAuthorization } from './execution-authorization.js';
import { digestJson } from './authorization-seal.js';
import { validateExecutionJournal } from './key-ceremony-journal.js';

export const CINESWARM_ASSET_INTAKE_POLICY_SCHEMA = 'parallax.cineswarm.asset-intake-policy.c1.8.v0.1';
export const CINESWARM_PROVIDER_ATTEMPT_RECEIPT_SCHEMA = 'parallax.cineswarm.provider-attempt-receipt.c1.8.v0.1';
export const CINESWARM_QUARANTINE_MANIFEST_SCHEMA = 'parallax.cineswarm.asset-quarantine-manifest.c1.8.v0.1';
export const CINESWARM_ASSET_REVIEW_DECISION_SCHEMA = 'parallax.cineswarm.asset-review-decision.c1.8.v0.1';
export const CINESWARM_QUARANTINE_ROOT = 'production/provider-quarantine/';
export const C1_8_ATTEMPT_STATUSES = Object.freeze(['SUCCEEDED', 'FAILED']);
export const C1_8_REVIEW_DECISIONS = Object.freeze(['ACCEPT', 'REJECT', 'HOLD']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeToken(value, label) {
  const text = requiredString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`${label} contains unsupported characters`);
  return text;
}

function parseTime(value, label) {
  const text = requiredString(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  return { text, time };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function ensureSha256(value, label) {
  const text = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}

function ensureNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function normalizeQuarantinePath(value, sequenceId) {
  const raw = requiredString(value, 'artifactPath').replaceAll('\\', '/');
  if (raw.startsWith('/') || raw.includes('..')) throw new Error('artifactPath must be relative and traversal-free');
  const normalized = posix.normalize(raw);
  const expectedRoot = `${CINESWARM_QUARANTINE_ROOT}${sequenceId}/`;
  if (!normalized.startsWith(expectedRoot)) throw new Error(`artifactPath must remain inside ${expectedRoot}`);
  if (normalized.endsWith('/')) throw new Error('artifactPath must identify a file');
  return normalized;
}

function inspectImageBytes(bytes, mediaType) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (mediaType === 'image/png') {
    const signature = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) throw new Error('artifact bytes do not match image/png signature');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height) throw new Error('PNG dimensions must be positive');
    return { decodableHeader: true, width, height };
  }
  if (mediaType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error('artifact bytes do not match image/jpeg signature');
    return { decodableHeader: true, width: null, height: null };
  }
  if (mediaType === 'image/webp') {
    if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('artifact bytes do not match image/webp signature');
    return { decodableHeader: true, width: null, height: null };
  }
  throw new Error(`unsupported mediaType ${mediaType}`);
}

export function validateAssetIntakePolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('asset intake policy must be an object');
  if (policy.schema !== CINESWARM_ASSET_INTAKE_POLICY_SCHEMA) throw new Error(`unsupported asset intake policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  if (!Array.isArray(policy.allowedMediaTypes) || !policy.allowedMediaTypes.length) throw new Error('allowedMediaTypes must be non-empty');
  for (const mediaType of policy.allowedMediaTypes) requiredString(mediaType, 'allowedMediaType');
  if (!Number.isInteger(policy.maxArtifactBytes) || policy.maxArtifactBytes <= 0) throw new Error('maxArtifactBytes must be a positive integer');
  if (policy.requireJournalSucceededLink !== true) throw new Error('policy must require journal SUCCEEDED linkage');
  if (policy.requireHashVerification !== true) throw new Error('policy must require hash verification');
  if (policy.requireHumanReview !== true) throw new Error('policy must require human review');
  if (policy.autoAccept !== false) throw new Error('policy must preserve autoAccept=false');
  if (policy.pictureLockAuthority !== false) throw new Error('asset intake policy must not grant Picture Lock authority');
  if (policy.canonAuthority !== false) throw new Error('asset intake policy must not grant Canon authority');
  if (policy.publicRelease !== false) throw new Error('asset intake policy must preserve publicRelease=false');
  if (policy.relayDependency !== false) throw new Error('asset intake policy must preserve relayDependency=false');
  return { valid: true };
}

function findActiveClaim(journal, executionId) {
  validateExecutionJournal(journal);
  const claim = journal.entries.find((entry) => entry.event === 'CLAIMED' && entry.executionId === executionId);
  if (!claim) throw new Error(`execution ${executionId} has no CLAIMED journal entry`);
  const terminal = journal.entries.find((entry) => entry.event !== 'CLAIMED' && entry.executionId === executionId);
  if (terminal) throw new Error(`execution ${executionId} is already terminal in the journal`);
  return claim;
}

function attemptReceiptHashPayload(receipt) {
  const copy = structuredClone(receipt);
  delete copy.receiptHash;
  return copy;
}

export function buildProviderAttemptReceipt({
  journal,
  executionId,
  request,
  packet,
  providerResult,
  artifactBytes = null,
  startedAt,
  completedAt,
}) {
  const claim = findActiveClaim(journal, executionId);
  validateProviderRequestForAuthorization(request, packet);
  const start = parseTime(startedAt, 'startedAt');
  const complete = parseTime(completedAt, 'completedAt');
  if (complete.time < start.time) throw new Error('completedAt cannot precede startedAt');
  if (request.sequenceId !== journal.sequenceId) throw new Error('provider request sequenceId does not match execution journal');
  if (!providerResult || typeof providerResult !== 'object') throw new Error('providerResult must be an object');
  if (!C1_8_ATTEMPT_STATUSES.includes(providerResult.status)) throw new Error('providerResult.status must be SUCCEEDED or FAILED');
  if (providerResult.providerId !== request.providerId) throw new Error('provider result providerId does not match request');
  if (providerResult.model !== request.model) throw new Error('provider result model does not match request');
  if (providerResult.publicRelease !== false) throw new Error('provider result must preserve publicRelease=false');
  if (providerResult.relayDependency !== false) throw new Error('provider result must preserve relayDependency=false');
  if (providerResult.costUsd !== null && providerResult.costUsd !== undefined) {
    const cost = Number(providerResult.costUsd);
    if (!Number.isFinite(cost) || cost < 0) throw new Error('provider result costUsd must be null or non-negative');
    if (cost > Number(request.maxCostUsd)) throw new Error('provider result costUsd exceeds request maxCostUsd');
  }

  let artifact = null;
  if (providerResult.status === 'SUCCEEDED') {
    if (!Buffer.isBuffer(artifactBytes)) throw new Error('successful provider result requires artifactBytes');
    const mediaType = requiredString(providerResult.mediaType, 'providerResult.mediaType');
    const inspected = inspectImageBytes(artifactBytes, mediaType);
    artifact = {
      mediaType,
      sha256: sha256(artifactBytes),
      byteSize: artifactBytes.length,
      width: inspected.width,
      height: inspected.height,
    };
  } else if (artifactBytes !== null) {
    throw new Error('failed provider result must not carry artifactBytes');
  }

  const receipt = {
    schema: CINESWARM_PROVIDER_ATTEMPT_RECEIPT_SCHEMA,
    receiptId: `${executionId}_${request.requestId}_attempt`,
    executionId,
    envelopeId: claim.envelopeId,
    episodeId: request.episodeId,
    sequenceId: request.sequenceId,
    requestId: request.requestId,
    requestDigest: digestProviderRequest(request),
    providerId: request.providerId,
    model: request.model,
    providerJobId: providerResult.providerJobId ?? null,
    status: providerResult.status,
    startedAt: start.text,
    completedAt: complete.text,
    httpStatus: providerResult.httpStatus ?? null,
    costUsd: providerResult.costUsd ?? null,
    artifact,
    errorCode: providerResult.status === 'FAILED' ? (providerResult.errorCode ?? 'PROVIDER_ATTEMPT_FAILED') : null,
    responseBodyStored: false,
    secretsStored: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.receiptHash = digestJson(attemptReceiptHashPayload(receipt));
  return receipt;
}

export function validateProviderAttemptReceipt(receipt, { journal, request, packet, requireTerminalLink = false } = {}) {
  if (!receipt || typeof receipt !== 'object') throw new Error('provider attempt receipt must be an object');
  if (receipt.schema !== CINESWARM_PROVIDER_ATTEMPT_RECEIPT_SCHEMA) throw new Error(`unsupported provider attempt receipt schema: ${receipt.schema}`);
  safeToken(receipt.receiptId, 'receiptId');
  safeToken(receipt.executionId, 'executionId');
  safeToken(receipt.envelopeId, 'envelopeId');
  safeToken(receipt.requestId, 'requestId');
  ensureSha256(receipt.requestDigest, 'requestDigest');
  ensureSha256(receipt.receiptHash, 'receiptHash');
  if (receipt.receiptHash !== digestJson(attemptReceiptHashPayload(receipt))) throw new Error('provider attempt receipt self-hash mismatch');
  if (!C1_8_ATTEMPT_STATUSES.includes(receipt.status)) throw new Error('provider attempt receipt status is invalid');
  const started = parseTime(receipt.startedAt, 'startedAt');
  const completed = parseTime(receipt.completedAt, 'completedAt');
  if (completed.time < started.time) throw new Error('provider attempt receipt completedAt precedes startedAt');
  if (receipt.responseBodyStored !== false || receipt.secretsStored !== false) throw new Error('provider attempt receipt must not store response body or secrets');
  if (receipt.publicRelease !== false || receipt.relayDependency !== false) throw new Error('provider attempt receipt must preserve release/Relay boundaries');

  if (request && packet) {
    validateProviderRequestForAuthorization(request, packet);
    if (receipt.requestId !== request.requestId) throw new Error('provider attempt receipt requestId does not match request');
    if (receipt.requestDigest !== digestProviderRequest(request)) throw new Error('provider attempt receipt requestDigest does not match request');
    if (receipt.providerId !== request.providerId || receipt.model !== request.model) throw new Error('provider attempt receipt provider/model does not match request');
  }

  if (receipt.status === 'SUCCEEDED') {
    if (!receipt.artifact || typeof receipt.artifact !== 'object') throw new Error('successful provider attempt receipt requires artifact metadata');
    requiredString(receipt.artifact.mediaType, 'artifact.mediaType');
    ensureSha256(receipt.artifact.sha256, 'artifact.sha256');
    ensureNonNegativeInteger(receipt.artifact.byteSize, 'artifact.byteSize');
    if (receipt.errorCode !== null) throw new Error('successful provider attempt receipt must have errorCode=null');
  } else {
    if (receipt.artifact !== null) throw new Error('failed provider attempt receipt must have artifact=null');
    requiredString(receipt.errorCode, 'errorCode');
  }

  if (journal) {
    validateExecutionJournal(journal);
    const claim = journal.entries.find((entry) => entry.event === 'CLAIMED' && entry.executionId === receipt.executionId && entry.envelopeId === receipt.envelopeId);
    if (!claim) throw new Error('provider attempt receipt has no matching execution journal claim');
    if (requireTerminalLink) {
      const terminal = journal.entries.find((entry) => entry.executionId === receipt.executionId && entry.event === receipt.status);
      if (!terminal) throw new Error(`provider attempt receipt requires matching ${receipt.status} journal terminal event`);
      if (terminal.providerReceiptHash !== receipt.receiptHash) throw new Error('journal terminal event providerReceiptHash does not match attempt receipt');
    }
  }

  return { valid: true, receiptHash: receipt.receiptHash, status: receipt.status };
}

export function buildQuarantineManifest({ receipt, journal, request, packet, policy, artifactBytes, artifactPath }) {
  validateAssetIntakePolicy(policy);
  validateProviderAttemptReceipt(receipt, { journal, request, packet, requireTerminalLink: true });
  if (receipt.status !== 'SUCCEEDED') throw new Error('only SUCCEEDED provider attempts may enter asset quarantine');
  if (!Buffer.isBuffer(artifactBytes)) throw new Error('quarantine intake requires artifactBytes');
  if (artifactBytes.length > policy.maxArtifactBytes) throw new Error('artifact exceeds maxArtifactBytes');
  if (!policy.allowedMediaTypes.includes(receipt.artifact.mediaType)) throw new Error('artifact mediaType is not allowed by asset intake policy');
  const inspected = inspectImageBytes(artifactBytes, receipt.artifact.mediaType);
  const actualHash = sha256(artifactBytes);
  if (actualHash !== receipt.artifact.sha256) throw new Error('artifact SHA-256 does not match provider attempt receipt');
  if (artifactBytes.length !== receipt.artifact.byteSize) throw new Error('artifact byteSize does not match provider attempt receipt');
  const normalizedPath = normalizeQuarantinePath(artifactPath, receipt.sequenceId);

  return {
    schema: CINESWARM_QUARANTINE_MANIFEST_SCHEMA,
    quarantineId: `${receipt.requestId}_quarantine`,
    intakePolicyId: policy.policyId,
    receiptId: receipt.receiptId,
    receiptHash: receipt.receiptHash,
    executionId: receipt.executionId,
    envelopeId: receipt.envelopeId,
    episodeId: receipt.episodeId,
    sequenceId: receipt.sequenceId,
    requestId: receipt.requestId,
    requestDigest: receipt.requestDigest,
    artifact: {
      path: normalizedPath,
      fileName: basename(normalizedPath),
      mediaType: receipt.artifact.mediaType,
      sha256: actualHash,
      byteSize: artifactBytes.length,
      width: inspected.width,
      height: inspected.height,
    },
    qc: {
      hashVerified: true,
      byteSizeVerified: true,
      mediaSignatureVerified: true,
      decodableHeader: inspected.decodableHeader,
    },
    quarantineState: 'PENDING_HUMAN_REVIEW',
    humanReviewRequired: true,
    autoAccepted: false,
    candidatePoolEligible: false,
    pictureLockEligible: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function validateQuarantineManifest(manifest, { receipt, policy } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('quarantine manifest must be an object');
  if (manifest.schema !== CINESWARM_QUARANTINE_MANIFEST_SCHEMA) throw new Error(`unsupported quarantine manifest schema: ${manifest.schema}`);
  safeToken(manifest.quarantineId, 'quarantineId');
  safeToken(manifest.requestId, 'requestId');
  safeToken(manifest.executionId, 'executionId');
  safeToken(manifest.envelopeId, 'envelopeId');
  ensureSha256(manifest.receiptHash, 'receiptHash');
  ensureSha256(manifest.requestDigest, 'requestDigest');
  normalizeQuarantinePath(manifest.artifact?.path, manifest.sequenceId);
  ensureSha256(manifest.artifact?.sha256, 'artifact.sha256');
  ensureNonNegativeInteger(manifest.artifact?.byteSize, 'artifact.byteSize');
  if (manifest.qc?.hashVerified !== true || manifest.qc?.byteSizeVerified !== true || manifest.qc?.mediaSignatureVerified !== true || manifest.qc?.decodableHeader !== true) throw new Error('quarantine manifest requires successful intake QC');
  if (manifest.humanReviewRequired !== true || manifest.autoAccepted !== false) throw new Error('quarantine manifest must require human review and disable auto-accept');
  if (manifest.candidatePoolEligible !== false) throw new Error('new quarantine manifest must begin candidatePoolEligible=false');
  if ([manifest.pictureLockEligible, manifest.canonEligible, manifest.ledgerPromotionEligible, manifest.publicRelease, manifest.relayDependency].some((value) => value !== false)) throw new Error('quarantine manifest must preserve downstream authority boundaries');
  if (manifest.quarantineState !== 'PENDING_HUMAN_REVIEW') throw new Error('new quarantine manifest must begin PENDING_HUMAN_REVIEW');

  if (policy) {
    validateAssetIntakePolicy(policy);
    if (manifest.intakePolicyId !== policy.policyId) throw new Error('quarantine manifest intakePolicyId does not match policy');
    if (!policy.allowedMediaTypes.includes(manifest.artifact.mediaType)) throw new Error('quarantine manifest mediaType is not allowed by policy');
    if (manifest.artifact.byteSize > policy.maxArtifactBytes) throw new Error('quarantine manifest artifact exceeds policy maxArtifactBytes');
  }
  if (receipt) {
    validateProviderAttemptReceipt(receipt);
    if (manifest.receiptId !== receipt.receiptId || manifest.receiptHash !== receipt.receiptHash) throw new Error('quarantine manifest does not match provider attempt receipt');
    if (manifest.artifact.sha256 !== receipt.artifact?.sha256) throw new Error('quarantine manifest artifact hash does not match provider attempt receipt');
  }
  return { valid: true };
}

export function validateAssetReviewDecision(decision, manifest) {
  validateQuarantineManifest(manifest);
  if (!decision || typeof decision !== 'object') throw new Error('asset review decision must be an object');
  if (decision.schema !== CINESWARM_ASSET_REVIEW_DECISION_SCHEMA) throw new Error(`unsupported asset review decision schema: ${decision.schema}`);
  safeToken(decision.decisionId, 'decisionId');
  if (decision.quarantineId !== manifest.quarantineId) throw new Error('asset review quarantineId does not match manifest');
  if (decision.artifactSha256 !== manifest.artifact.sha256) throw new Error('asset review artifactSha256 does not match manifest');
  if (decision.authority?.kind !== 'human') throw new Error('asset review decision requires human authority');
  safeToken(decision.authority?.id, 'authority.id');
  if (decision.simulated !== false) throw new Error('asset review decision must be real, not simulated');
  if (!C1_8_REVIEW_DECISIONS.includes(decision.decision)) throw new Error('asset review decision must be ACCEPT, REJECT, or HOLD');
  requiredString(decision.reason, 'reason');
  parseTime(decision.recordedAt, 'recordedAt');
  if (decision.publicRelease !== false) throw new Error('asset review decision must preserve publicRelease=false');
  if (decision.pictureLockAuthorized !== false) throw new Error('asset review decision must not authorize Picture Lock');
  if (decision.canonAuthorized !== false) throw new Error('asset review decision must not authorize Canon');
  if (decision.relayDependency !== false) throw new Error('asset review decision must preserve relayDependency=false');
  return { valid: true, decision: decision.decision };
}

export function classifyQuarantinedAsset({ manifest, decision = null }) {
  validateQuarantineManifest(manifest);
  if (!decision) {
    return {
      quarantineState: 'PENDING_HUMAN_REVIEW',
      humanDecision: null,
      candidatePoolEligible: false,
      pictureLockEligible: false,
      canonEligible: false,
      ledgerPromotionEligible: false,
      publicRelease: false,
      relayDependency: false,
    };
  }
  validateAssetReviewDecision(decision, manifest);
  const accepted = decision.decision === 'ACCEPT';
  return {
    quarantineState: accepted ? 'ACCEPTED_CANDIDATE' : decision.decision === 'REJECT' ? 'REJECTED' : 'HOLD',
    humanDecision: decision.decision,
    candidatePoolEligible: accepted,
    pictureLockEligible: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
    note: accepted
      ? 'Human acceptance promotes the asset only to the candidate pool. Picture Lock, Canon, Ledger promotion, and public release remain separate gates.'
      : 'Rejected or held assets remain unavailable to downstream picture planning.',
  };
}
