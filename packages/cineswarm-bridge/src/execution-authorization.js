import { createHash } from 'node:crypto';
import {
  CINESWARM_PROVIDER_GO_NO_GO_SCHEMA,
  summarizeProviderReadiness,
  validateProviderGoNoGoDecision,
  validateProviderReadinessPacket,
} from './index.js';

export const CINESWARM_PROVIDER_REQUEST_SCHEMA = 'parallax.cineswarm.provider-request.c1.v0.1';
export const CINESWARM_REQUEST_AUTH_SCHEMA = 'parallax.cineswarm.provider-execution-authorization.c1.5.v0.1';
export const CINESWARM_REQUEST_AUTH_BATCH_SCHEMA = 'parallax.cineswarm.provider-execution-authorization-batch.c1.5.v0.1';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeToken(value, label) {
  const token = requiredString(value, label);
  if (!/^[A-Za-z0-9_.-]+$/.test(token)) throw new Error(`${label} must contain only letters, digits, dot, underscore, or hyphen`);
  return token;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function canonicalRequestJson(request) {
  return JSON.stringify(stable(request));
}

export function digestProviderRequest(request) {
  return createHash('sha256').update(canonicalRequestJson(request)).digest('hex');
}

export function validateProviderRequestForAuthorization(request, packet) {
  validateProviderReadinessPacket(packet);
  if (!request || typeof request !== 'object') throw new Error('provider request must be an object');
  if (request.schema !== CINESWARM_PROVIDER_REQUEST_SCHEMA) throw new Error(`unsupported provider request schema: ${request.schema}`);
  safeToken(request.requestId, 'requestId');
  safeToken(request.taskId, 'taskId');
  if (!packet.requestIds.includes(request.requestId)) throw new Error('provider request is not bound to the readiness packet');
  if (request.episodeId !== packet.episodeId || request.sequenceId !== packet.sequenceId) throw new Error('provider request episode/sequence does not match the readiness packet');
  if (request.providerId !== packet.providerId || request.model !== packet.modelSnapshot) throw new Error('provider request provider/model does not match the readiness packet');
  requiredString(request.termsReviewId, 'termsReviewId');
  requiredString(request.prompt, 'prompt');
  if (request.transport !== 'filesystem-drop') throw new Error('provider request transport must remain filesystem-drop');
  if (request.externalTransferScope !== 'prompt-and-generation-parameters-only') throw new Error('provider request external transfer scope drifted');
  if (request.publicRelease !== false) throw new Error('provider request must preserve publicRelease=false');
  if (request.humanAssetAcceptanceRequired !== true) throw new Error('provider request must require human asset acceptance');
  const maxCostUsd = Number(request.maxCostUsd);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error('provider request maxCostUsd must be positive');
  if (maxCostUsd > Number(packet.governanceCeilings.requestCeilingUsd)) throw new Error('provider request maxCostUsd exceeds the readiness packet request ceiling');
  return { valid: true, requestId: request.requestId, requestDigest: digestProviderRequest(request), maxCostUsd };
}

export function buildRequestAuthorizationDraft(request, packet) {
  const validated = validateProviderRequestForAuthorization(request, packet);
  return {
    schema: CINESWARM_REQUEST_AUTH_SCHEMA,
    authorizationId: `${request.requestId}_authorization_draft`,
    packetId: packet.packetId,
    requestId: request.requestId,
    requestDigest: validated.requestDigest,
    episodeId: request.episodeId,
    sequenceId: request.sequenceId,
    providerId: request.providerId,
    model: request.model,
    termsReviewId: request.termsReviewId,
    decision: 'PENDING',
    liveGenerationAuthorized: false,
    spendAuthorized: false,
    maxSpendUsd: validated.maxCostUsd,
    authority: null,
    simulated: null,
    decidedAt: null,
    expiresAt: null,
    publicRelease: false,
    humanAssetAcceptanceRequired: true,
    note: 'Draft only. A human must make a request-specific decision after provider preflight and founder GO are valid.',
  };
}

export function buildRequestAuthorizationBatchDraft(requests, packet) {
  validateProviderReadinessPacket(packet);
  if (!Array.isArray(requests) || requests.length !== packet.requestIds.length) throw new Error('provider request batch must match readiness packet request count');
  const records = packet.requestIds.map((requestId) => {
    const request = requests.find((item) => item.requestId === requestId);
    if (!request) throw new Error(`missing provider request ${requestId}`);
    return buildRequestAuthorizationDraft(request, packet);
  });
  return {
    schema: CINESWARM_REQUEST_AUTH_BATCH_SCHEMA,
    batchId: `${packet.packetId}_request_authorizations`,
    packetId: packet.packetId,
    sequenceId: packet.sequenceId,
    records,
    totalMaxSpendUsd: Number(records.reduce((sum, record) => sum + Number(record.maxSpendUsd), 0).toFixed(6)),
    publicRelease: false,
    relayDependency: false,
  };
}

export function validateRequestExecutionAuthorization(auth, request, packet, founderDecision) {
  const requestValidation = validateProviderRequestForAuthorization(request, packet);
  if (!auth || typeof auth !== 'object') throw new Error('request execution authorization must be an object');
  if (auth.schema !== CINESWARM_REQUEST_AUTH_SCHEMA) throw new Error(`unsupported request authorization schema: ${auth.schema}`);
  safeToken(auth.authorizationId, 'authorizationId');
  if (auth.packetId !== packet.packetId || auth.requestId !== request.requestId) throw new Error('request authorization identity does not match packet/request');
  if (auth.requestDigest !== requestValidation.requestDigest) throw new Error('request authorization digest does not match the exact provider request payload');
  if (auth.episodeId !== request.episodeId || auth.sequenceId !== request.sequenceId) throw new Error('request authorization episode/sequence mismatch');
  if (auth.providerId !== request.providerId || auth.model !== request.model) throw new Error('request authorization provider/model mismatch');
  if (auth.termsReviewId !== request.termsReviewId) throw new Error('request authorization termsReviewId mismatch');
  if (auth.publicRelease !== false) throw new Error('request authorization must preserve publicRelease=false');
  if (auth.humanAssetAcceptanceRequired !== true) throw new Error('request authorization must preserve human asset acceptance');
  if (!['PENDING', 'AUTHORIZE', 'DENY'].includes(auth.decision)) throw new Error('request authorization decision must be PENDING, AUTHORIZE, or DENY');
  const maxSpendUsd = Number(auth.maxSpendUsd);
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) throw new Error('maxSpendUsd must be positive');
  if (maxSpendUsd > requestValidation.maxCostUsd) throw new Error('authorization spend cap exceeds the provider request ceiling');

  if (auth.decision === 'PENDING') {
    if (auth.liveGenerationAuthorized !== false || auth.spendAuthorized !== false) throw new Error('PENDING authorization cannot grant live generation or spend');
    if (auth.authority !== null || auth.decidedAt !== null) throw new Error('PENDING authorization must not claim a human decision');
    return { valid: true, decision: auth.decision, executable: false, maxSpendUsd };
  }

  if (auth.authority?.kind !== 'human') throw new Error('request authorization decision requires human authority');
  safeToken(auth.authority?.id, 'authority.id');
  if (auth.simulated !== false) throw new Error('request authorization decision must be real, not simulated');
  requiredString(auth.decidedAt, 'decidedAt');

  if (auth.decision === 'DENY') {
    if (auth.liveGenerationAuthorized !== false || auth.spendAuthorized !== false) throw new Error('DENY authorization cannot grant live generation or spend');
    return { valid: true, decision: auth.decision, executable: false, maxSpendUsd, authorityId: auth.authority.id };
  }

  const readiness = summarizeProviderReadiness(packet);
  if (!readiness.readyForFounderDecision) throw new Error('request cannot be authorized while provider preflight blockers remain');
  if (!founderDecision) throw new Error('AUTHORIZE decision requires a founder GO record');
  if (founderDecision.schema !== CINESWARM_PROVIDER_GO_NO_GO_SCHEMA) throw new Error('founder decision schema is invalid');
  const founderValidation = validateProviderGoNoGoDecision(founderDecision, packet);
  if (founderValidation.decision !== 'GO' || founderDecision.liveRunAuthorized !== true || founderDecision.spendAuthorized !== true) {
    throw new Error('request authorization requires a valid founder GO with live-run and spend authority');
  }
  if (auth.liveGenerationAuthorized !== true || auth.spendAuthorized !== true) throw new Error('AUTHORIZE decision must explicitly authorize live generation and spend for this request');
  return { valid: true, decision: auth.decision, executable: true, maxSpendUsd, authorityId: auth.authority.id };
}

export function classifyRequestAuthorizationBatch({ packet, requests, authorizationBatch, founderDecision = null }) {
  const readiness = summarizeProviderReadiness(packet);
  if (!authorizationBatch || authorizationBatch.schema !== CINESWARM_REQUEST_AUTH_BATCH_SCHEMA) throw new Error('request authorization batch schema is invalid');
  if (authorizationBatch.packetId !== packet.packetId || authorizationBatch.sequenceId !== packet.sequenceId) throw new Error('request authorization batch identity mismatch');
  if (authorizationBatch.publicRelease !== false) throw new Error('request authorization batch must preserve publicRelease=false');
  if (authorizationBatch.relayDependency !== false) throw new Error('request authorization batch must preserve relayDependency=false');
  if (!Array.isArray(requests) || requests.length !== packet.requestIds.length) throw new Error('provider request catalog does not match packet request count');
  if (!Array.isArray(authorizationBatch.records) || authorizationBatch.records.length !== packet.requestIds.length) throw new Error('authorization batch must contain exactly one record per provider request');

  const seen = new Set();
  const results = [];
  for (const requestId of packet.requestIds) {
    const request = requests.find((item) => item.requestId === requestId);
    const auth = authorizationBatch.records.find((item) => item.requestId === requestId);
    if (!request || !auth) throw new Error(`missing request or authorization for ${requestId}`);
    if (seen.has(auth.requestId)) throw new Error(`duplicate request authorization ${auth.requestId}`);
    seen.add(auth.requestId);
    results.push(validateRequestExecutionAuthorization(auth, request, packet, founderDecision));
  }

  const totalMaxSpendUsd = Number(results.reduce((sum, result) => sum + result.maxSpendUsd, 0).toFixed(6));
  if (totalMaxSpendUsd > Number(packet.governanceCeilings.batchCeilingUsd)) throw new Error('authorization batch spend cap exceeds the readiness packet batch ceiling');
  const allAuthorized = results.every((result) => result.decision === 'AUTHORIZE' && result.executable === true);
  const founderGo = founderDecision?.decision === 'GO' && founderDecision?.liveRunAuthorized === true && founderDecision?.spendAuthorized === true;
  const executionEligible = Boolean(readiness.readyForFounderDecision && founderGo && allAuthorized);

  return {
    valid: true,
    packetId: packet.packetId,
    sequenceId: packet.sequenceId,
    executionEligible,
    readyForFounderDecision: readiness.readyForFounderDecision,
    founderGo,
    allAuthorized,
    authorizationStates: results.map((result) => result.decision),
    totalMaxSpendUsd,
    batchCeilingUsd: packet.governanceCeilings.batchCeilingUsd,
    publicRelease: false,
    relayDependency: false,
    completionProjection: executionEligible ? {
      founderLiveRunDecisionRecorded: true,
      requestAuthorizationsRecorded: true,
    } : null,
    note: 'Execution eligibility is request-scoped only. Generated assets still require human acceptance, and public release remains unavailable here.',
  };
}
