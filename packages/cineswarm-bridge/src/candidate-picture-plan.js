import { digestJson } from './authorization-seal.js';
import { CINESWARM_PROVIDER_REQUEST_SCHEMA, digestProviderRequest } from './execution-authorization.js';
import {
  classifyQuarantinedAsset,
  validateAssetReviewDecision,
  validateQuarantineManifest,
} from './asset-intake.js';

export const CINESWARM_CANDIDATE_REGISTRY_POLICY_SCHEMA = 'parallax.cineswarm.candidate-registry-policy.c1.9.v0.1';
export const CINESWARM_CANDIDATE_ASSET_ENTRY_SCHEMA = 'parallax.cineswarm.candidate-asset-entry.c1.9.v0.1';
export const CINESWARM_CANDIDATE_ASSET_REGISTRY_SCHEMA = 'parallax.cineswarm.candidate-asset-registry.c1.9.v0.1';
export const CINESWARM_PICTURE_PLAN_CANDIDATE_SCHEMA = 'parallax.cineswarm.picture-plan-candidate.c1.9.v0.1';
export const CINESWARM_PICTURE_PLAN_REVIEW_SCHEMA = 'parallax.cineswarm.picture-plan-review.c1.9.v0.1';
export const C1_9_PICTURE_PLAN_REVIEW_DECISIONS = Object.freeze(['APPROVE_FOR_LOCK_CEREMONY', 'REVISE', 'HOLD']);

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

function ensureSha256(value, label) {
  const text = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}

function withoutField(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return copy;
}


function validateProviderRequestShape(request) {
  if (!request || typeof request !== 'object') throw new Error('provider request must be an object');
  if (request.schema !== CINESWARM_PROVIDER_REQUEST_SCHEMA) throw new Error(`unsupported provider request schema: ${request.schema}`);
  safeToken(request.requestId, 'requestId');
  safeToken(request.taskId, 'taskId');
  safeToken(request.episodeId, 'request.episodeId');
  safeToken(request.sequenceId, 'request.sequenceId');
  if (!Number.isInteger(request.shotIndex) || request.shotIndex <= 0) throw new Error('request shotIndex must be a positive integer');
  requiredString(request.shotTitle, 'request.shotTitle');
  safeToken(request.providerId, 'request.providerId');
  requiredString(request.model, 'request.model');
  requiredString(request.termsReviewId, 'request.termsReviewId');
  requiredString(request.prompt, 'request.prompt');
  if (request.transport !== 'filesystem-drop') throw new Error('provider request transport must remain filesystem-drop');
  if (request.externalTransferScope !== 'prompt-and-generation-parameters-only') throw new Error('provider request external transfer scope drifted');
  if (request.publicRelease !== false) throw new Error('provider request must preserve publicRelease=false');
  if (request.humanAssetAcceptanceRequired !== true) throw new Error('provider request must preserve human asset acceptance');
  if (!Number.isFinite(Number(request.maxCostUsd)) || Number(request.maxCostUsd) <= 0) throw new Error('provider request maxCostUsd must be positive');
  return { valid: true, requestDigest: digestProviderRequest(request) };
}

function findSequenceJob(sequenceJob, sequenceId) {
  if (Array.isArray(sequenceJob)) {
    const found = sequenceJob.find((job) => job?.network?.sequenceId === sequenceId);
    if (!found) throw new Error(`sequence job ${sequenceId} not found`);
    return found;
  }
  if (!sequenceJob || typeof sequenceJob !== 'object') throw new Error('sequenceJob must be an object or array');
  return sequenceJob;
}

function validateSequenceJobShape(sequenceJob) {
  const job = findSequenceJob(sequenceJob, sequenceJob?.network?.sequenceId);
  safeToken(job.network?.episodeId, 'sequenceJob.network.episodeId');
  safeToken(job.network?.sequenceId, 'sequenceJob.network.sequenceId');
  if (!Array.isArray(job.generation?.shots) || !job.generation.shots.length) throw new Error('sequenceJob must contain generation.shots');
  job.generation.shots.forEach((shot, index) => {
    requiredString(shot.title, `sequenceJob shot ${index + 1} title`);
    requiredString(shot.prompt, `sequenceJob shot ${index + 1} prompt`);
    if (!Number.isFinite(Number(shot.durationSeconds)) || Number(shot.durationSeconds) <= 0) throw new Error(`sequenceJob shot ${index + 1} durationSeconds must be positive`);
  });
  if (job.constraints?.publicRelease !== false) throw new Error('sequenceJob must preserve publicRelease=false');
  if (job.constraints?.relayDependency !== false) throw new Error('sequenceJob must preserve relayDependency=false');
  return job;
}

export function digestSequenceJob(sequenceJob) {
  return digestJson(validateSequenceJobShape(sequenceJob));
}

export function validateCandidateRegistryPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('candidate registry policy must be an object');
  if (policy.schema !== CINESWARM_CANDIDATE_REGISTRY_POLICY_SCHEMA) throw new Error(`unsupported candidate registry policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  if (!Number.isInteger(policy.requiredShotCount) || policy.requiredShotCount <= 0) throw new Error('requiredShotCount must be a positive integer');
  const mustBeTrue = [
    'requireAcceptedC1_8Asset',
    'requireExactRequestDigest',
    'requireExactSequenceJobDigest',
    'requireDistinctArtifactPerShot',
    'requireSingleContinuityVersion',
    'requireHumanPicturePlanReview',
  ];
  for (const key of mustBeTrue) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  const mustBeFalse = ['autoPictureLock', 'pictureLockAuthority', 'canonAuthority', 'ledgerPromotionAuthority', 'publicRelease', 'relayDependency'];
  for (const key of mustBeFalse) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function findShot(job, request) {
  const shotIndex = Number(request.shotIndex);
  if (!Number.isInteger(shotIndex) || shotIndex < 1 || shotIndex > job.generation.shots.length) throw new Error('request shotIndex is outside sequence job');
  const shot = job.generation.shots[shotIndex - 1];
  if (shot.title !== request.shotTitle) throw new Error('request shotTitle drifted from sequence job');
  if (shot.prompt !== request.prompt) throw new Error('request prompt drifted from sequence job');
  return { shot, shotIndex };
}

function candidateEntryHashPayload(entry) {
  return withoutField(entry, 'entryHash');
}

export function buildCandidateAssetEntry({
  manifest,
  reviewDecision,
  request,
  sequenceJob,
  policy,
  continuityVersion,
  registeredAt,
  candidateAssetId = null,
}) {
  validateCandidateRegistryPolicy(policy);
  validateQuarantineManifest(manifest);
  validateAssetReviewDecision(reviewDecision, manifest);
  const classification = classifyQuarantinedAsset({ manifest, decision: reviewDecision });
  if (!classification.candidatePoolEligible || reviewDecision.decision !== 'ACCEPT') throw new Error('only a human-accepted C1.8 asset may enter the candidate registry');
  validateProviderRequestShape(request);
  const job = validateSequenceJobShape(findSequenceJob(sequenceJob, request.sequenceId));
  const { shot, shotIndex } = findShot(job, request);

  if (request.episodeId !== policy.episodeId || request.sequenceId !== policy.sequenceId) throw new Error('request does not match candidate registry policy scope');
  if (manifest.episodeId !== request.episodeId || manifest.sequenceId !== request.sequenceId || manifest.requestId !== request.requestId) throw new Error('quarantine manifest/request scope mismatch');
  if (job.network.episodeId !== request.episodeId || job.network.sequenceId !== request.sequenceId) throw new Error('sequence job/request scope mismatch');
  if (manifest.artifact?.sha256 !== reviewDecision.artifactSha256) throw new Error('accepted review does not match quarantine artifact hash');
  const continuity = safeToken(continuityVersion, 'continuityVersion');
  const registered = parseTime(registeredAt, 'registeredAt').text;
  const requestDigest = digestProviderRequest(request);
  if (manifest.requestDigest !== requestDigest) throw new Error('quarantine manifest request digest drift detected');
  const sequenceJobDigest = digestSequenceJob(job);
  const candidateId = candidateAssetId ?? `cand_${request.sequenceId}_shot${String(shotIndex).padStart(2, '0')}_${manifest.artifact.sha256.slice(0, 12)}`;
  safeToken(candidateId, 'candidateAssetId');

  const entry = {
    schema: CINESWARM_CANDIDATE_ASSET_ENTRY_SCHEMA,
    candidateAssetId: candidateId,
    episodeId: request.episodeId,
    sequenceId: request.sequenceId,
    shotIndex,
    shotTitle: request.shotTitle,
    requestId: request.requestId,
    requestDigest,
    sequenceJobDigest,
    quarantineId: manifest.quarantineId,
    reviewDecisionId: reviewDecision.decisionId,
    providerReceiptHash: manifest.receiptHash,
    continuityVersion: continuity,
    artifact: {
      sha256: manifest.artifact.sha256,
      mediaType: manifest.artifact.mediaType,
      byteSize: manifest.artifact.byteSize,
      width: manifest.artifact.width ?? null,
      height: manifest.artifact.height ?? null,
      sourcePath: manifest.artifact.path,
    },
    shotContract: {
      promptDigest: digestJson({ prompt: shot.prompt }),
      durationSeconds: Number(shot.durationSeconds),
    },
    humanAcceptance: {
      authorityId: reviewDecision.authority.id,
      decision: reviewDecision.decision,
      recordedAt: reviewDecision.recordedAt,
    },
    registeredAt: registered,
    candidatePoolEligible: true,
    pictureLockEligible: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(candidateEntryHashPayload(entry));
  return entry;
}

export function validateCandidateAssetEntry(entry, { manifest = null, reviewDecision = null, request = null, sequenceJob = null, policy = null } = {}) {
  if (!entry || typeof entry !== 'object') throw new Error('candidate asset entry must be an object');
  if (entry.schema !== CINESWARM_CANDIDATE_ASSET_ENTRY_SCHEMA) throw new Error(`unsupported candidate asset entry schema: ${entry.schema}`);
  safeToken(entry.candidateAssetId, 'candidateAssetId');
  safeToken(entry.episodeId, 'episodeId');
  safeToken(entry.sequenceId, 'sequenceId');
  if (!Number.isInteger(entry.shotIndex) || entry.shotIndex <= 0) throw new Error('shotIndex must be a positive integer');
  requiredString(entry.shotTitle, 'shotTitle');
  safeToken(entry.requestId, 'requestId');
  ensureSha256(entry.requestDigest, 'requestDigest');
  ensureSha256(entry.sequenceJobDigest, 'sequenceJobDigest');
  safeToken(entry.quarantineId, 'quarantineId');
  safeToken(entry.reviewDecisionId, 'reviewDecisionId');
  ensureSha256(entry.providerReceiptHash, 'providerReceiptHash');
  safeToken(entry.continuityVersion, 'continuityVersion');
  ensureSha256(entry.artifact?.sha256, 'artifact.sha256');
  requiredString(entry.artifact?.mediaType, 'artifact.mediaType');
  if (!Number.isInteger(entry.artifact?.byteSize) || entry.artifact.byteSize < 0) throw new Error('artifact.byteSize must be a non-negative integer');
  requiredString(entry.artifact?.sourcePath, 'artifact.sourcePath');
  ensureSha256(entry.shotContract?.promptDigest, 'shotContract.promptDigest');
  if (!Number.isFinite(Number(entry.shotContract?.durationSeconds)) || Number(entry.shotContract.durationSeconds) <= 0) throw new Error('shotContract.durationSeconds must be positive');
  safeToken(entry.humanAcceptance?.authorityId, 'humanAcceptance.authorityId');
  if (entry.humanAcceptance?.decision !== 'ACCEPT') throw new Error('candidate asset entry must derive from ACCEPT');
  parseTime(entry.humanAcceptance?.recordedAt, 'humanAcceptance.recordedAt');
  parseTime(entry.registeredAt, 'registeredAt');
  if (entry.candidatePoolEligible !== true) throw new Error('candidate asset entry must be candidatePoolEligible=true');
  for (const key of ['pictureLockEligible', 'canonEligible', 'ledgerPromotionEligible', 'publicRelease', 'relayDependency']) {
    if (entry[key] !== false) throw new Error(`candidate asset entry must preserve ${key}=false`);
  }
  ensureSha256(entry.entryHash, 'entryHash');
  const expectedHash = digestJson(candidateEntryHashPayload(entry));
  if (entry.entryHash !== expectedHash) throw new Error('candidate asset entry self-hash mismatch');

  if (policy) {
    validateCandidateRegistryPolicy(policy);
    if (entry.episodeId !== policy.episodeId || entry.sequenceId !== policy.sequenceId) throw new Error('candidate entry does not match registry policy scope');
  }
  if (manifest) {
    validateQuarantineManifest(manifest);
    if (entry.quarantineId !== manifest.quarantineId || entry.artifact.sha256 !== manifest.artifact.sha256 || entry.providerReceiptHash !== manifest.receiptHash) throw new Error('candidate entry does not match quarantine manifest');
  }
  if (reviewDecision) {
    if (!manifest) throw new Error('manifest is required when validating reviewDecision linkage');
    validateAssetReviewDecision(reviewDecision, manifest);
    if (reviewDecision.decision !== 'ACCEPT' || entry.reviewDecisionId !== reviewDecision.decisionId || entry.artifact.sha256 !== reviewDecision.artifactSha256) throw new Error('candidate entry does not match accepted human review');
  }
  if (request) {
    validateProviderRequestShape(request);
    if (entry.requestId !== request.requestId || entry.requestDigest !== digestProviderRequest(request)) throw new Error('candidate entry request digest drift detected');
    if (manifest && manifest.requestDigest !== entry.requestDigest) throw new Error('candidate entry/quarantine request digest drift detected');
  }
  if (sequenceJob) {
    const job = validateSequenceJobShape(findSequenceJob(sequenceJob, entry.sequenceId));
    if (entry.sequenceJobDigest !== digestSequenceJob(job)) throw new Error('candidate entry sequence job digest drift detected');
    const shot = job.generation.shots[entry.shotIndex - 1];
    if (!shot || shot.title !== entry.shotTitle) throw new Error('candidate entry shot mapping drift detected');
    if (entry.shotContract.promptDigest !== digestJson({ prompt: shot.prompt }) || Number(entry.shotContract.durationSeconds) !== Number(shot.durationSeconds)) throw new Error('candidate entry shot contract drift detected');
  }
  return { valid: true, entryHash: entry.entryHash };
}

function registryHashPayload(registry) {
  return withoutField(registry, 'registryHash');
}

export function buildCandidateAssetRegistry({ policy, entries = [], revision = 0, previousRegistryHash = null, recordedAt }) {
  validateCandidateRegistryPolicy(policy);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('registry revision must be a non-negative integer');
  if (revision === 0 && previousRegistryHash !== null) throw new Error('revision 0 registry must have previousRegistryHash=null');
  if (revision > 0) ensureSha256(previousRegistryHash, 'previousRegistryHash');
  parseTime(recordedAt, 'recordedAt');
  if (!Array.isArray(entries)) throw new Error('registry entries must be an array');
  entries.forEach((entry) => validateCandidateAssetEntry(entry, { policy }));
  const candidateIds = entries.map((entry) => entry.candidateAssetId);
  const artifactHashes = entries.map((entry) => entry.artifact.sha256);
  const entryHashes = entries.map((entry) => entry.entryHash);
  if (new Set(candidateIds).size !== candidateIds.length) throw new Error('candidate registry contains duplicate candidateAssetId');
  if (new Set(artifactHashes).size !== artifactHashes.length) throw new Error('candidate registry contains duplicate artifact SHA-256');
  if (new Set(entryHashes).size !== entryHashes.length) throw new Error('candidate registry contains duplicate entryHash');

  const registry = {
    schema: CINESWARM_CANDIDATE_ASSET_REGISTRY_SCHEMA,
    registryId: `${policy.sequenceId}-candidate-registry`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    previousRegistryHash,
    recordedAt,
    status: entries.length ? 'HAS_ACCEPTED_CANDIDATES' : 'EMPTY_NO_ACCEPTED_CANDIDATES',
    entryCount: entries.length,
    entries: structuredClone(entries),
    picturePlanCandidateCount: 0,
    pictureLockEligibleCount: 0,
    canonEligibleCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  registry.registryHash = digestJson(registryHashPayload(registry));
  return registry;
}

export function validateCandidateAssetRegistry(registry, { policy = null } = {}) {
  if (!registry || typeof registry !== 'object') throw new Error('candidate asset registry must be an object');
  if (registry.schema !== CINESWARM_CANDIDATE_ASSET_REGISTRY_SCHEMA) throw new Error(`unsupported candidate registry schema: ${registry.schema}`);
  safeToken(registry.registryId, 'registryId');
  safeToken(registry.policyId, 'policyId');
  safeToken(registry.episodeId, 'episodeId');
  safeToken(registry.sequenceId, 'sequenceId');
  if (!Number.isInteger(registry.revision) || registry.revision < 0) throw new Error('registry revision must be a non-negative integer');
  if (registry.revision === 0 && registry.previousRegistryHash !== null) throw new Error('revision 0 registry must have previousRegistryHash=null');
  if (registry.revision > 0) ensureSha256(registry.previousRegistryHash, 'previousRegistryHash');
  parseTime(registry.recordedAt, 'recordedAt');
  if (!Array.isArray(registry.entries)) throw new Error('registry entries must be an array');
  if (registry.entryCount !== registry.entries.length) throw new Error('registry entryCount mismatch');
  registry.entries.forEach((entry) => validateCandidateAssetEntry(entry, policy ? { policy } : {}));
  const candidateIds = registry.entries.map((entry) => entry.candidateAssetId);
  const artifactHashes = registry.entries.map((entry) => entry.artifact.sha256);
  if (new Set(candidateIds).size !== candidateIds.length) throw new Error('candidate registry contains duplicate candidateAssetId');
  if (new Set(artifactHashes).size !== artifactHashes.length) throw new Error('candidate registry contains duplicate artifact SHA-256');
  const expectedStatus = registry.entries.length ? 'HAS_ACCEPTED_CANDIDATES' : 'EMPTY_NO_ACCEPTED_CANDIDATES';
  if (registry.status !== expectedStatus) throw new Error('candidate registry status does not match entries');
  if (registry.picturePlanCandidateCount !== 0 || registry.pictureLockEligibleCount !== 0 || registry.canonEligibleCount !== 0) throw new Error('C1.9 registry cannot claim downstream plan/lock/canon promotion');
  if (registry.publicRelease !== false || registry.relayDependency !== false) throw new Error('candidate registry must preserve release/Relay boundaries');
  ensureSha256(registry.registryHash, 'registryHash');
  if (registry.registryHash !== digestJson(registryHashPayload(registry))) throw new Error('candidate registry self-hash mismatch');
  if (policy) {
    validateCandidateRegistryPolicy(policy);
    if (registry.policyId !== policy.policyId || registry.episodeId !== policy.episodeId || registry.sequenceId !== policy.sequenceId) throw new Error('candidate registry does not match policy scope');
  }
  return { valid: true, registryHash: registry.registryHash, entryCount: registry.entryCount };
}

export function appendCandidateAssetToRegistry({ registry, entry, policy, recordedAt }) {
  validateCandidateAssetRegistry(registry, { policy });
  validateCandidateAssetEntry(entry, { policy });
  return buildCandidateAssetRegistry({
    policy,
    entries: [...registry.entries, entry],
    revision: registry.revision + 1,
    previousRegistryHash: registry.registryHash,
    recordedAt,
  });
}

function picturePlanHashPayload(plan) {
  return withoutField(plan, 'planHash');
}

function requestMapForSequence(requests, sequenceId) {
  if (!Array.isArray(requests)) throw new Error('requests must be an array');
  const relevant = requests.filter((request) => request.sequenceId === sequenceId);
  const map = new Map();
  for (const request of relevant) {
    validateProviderRequestShape(request);
    if (map.has(request.shotIndex)) throw new Error(`multiple provider requests supplied for shot ${request.shotIndex}`);
    map.set(request.shotIndex, request);
  }
  return map;
}

export function buildPicturePlanCandidate({ policy, registry, sequenceJob, requests, selections, createdAt, planId = null }) {
  validateCandidateRegistryPolicy(policy);
  validateCandidateAssetRegistry(registry, { policy });
  const job = validateSequenceJobShape(findSequenceJob(sequenceJob, policy.sequenceId));
  if (job.network.episodeId !== policy.episodeId || job.network.sequenceId !== policy.sequenceId) throw new Error('sequence job does not match policy scope');
  if (job.generation.shots.length !== policy.requiredShotCount) throw new Error('sequence job shot count does not match policy requiredShotCount');
  if (!Array.isArray(selections) || selections.length !== policy.requiredShotCount) throw new Error('picture plan must select exactly one candidate for every governed shot');
  const requestMap = requestMapForSequence(requests, policy.sequenceId);
  if (requestMap.size !== policy.requiredShotCount) throw new Error('picture plan requires exactly one current provider request per governed shot');

  const selectedEntries = selections.map((selection, index) => {
    const candidateAssetId = typeof selection === 'string' ? selection : selection?.candidateAssetId;
    safeToken(candidateAssetId, `selection ${index + 1} candidateAssetId`);
    const entry = registry.entries.find((candidate) => candidate.candidateAssetId === candidateAssetId);
    if (!entry) throw new Error(`candidate asset ${candidateAssetId} not found in registry`);
    return entry;
  });
  const shotIndices = selectedEntries.map((entry) => entry.shotIndex);
  if (new Set(shotIndices).size !== selectedEntries.length) throw new Error('picture plan must select exactly one candidate per shot');
  const expectedShotIndices = Array.from({ length: policy.requiredShotCount }, (_, index) => index + 1);
  if (shotIndices.slice().sort((a, b) => a - b).join(',') !== expectedShotIndices.join(',')) throw new Error('picture plan does not cover every governed shot');
  if (new Set(selectedEntries.map((entry) => entry.artifact.sha256)).size !== selectedEntries.length) throw new Error('picture plan cannot reuse the same artifact for multiple shots');
  const continuityVersions = [...new Set(selectedEntries.map((entry) => entry.continuityVersion))];
  if (continuityVersions.length !== 1) throw new Error('picture plan metadata continuity/version drift detected');

  const sequenceJobDigest = digestSequenceJob(job);
  const shotSelections = selectedEntries.slice().sort((a, b) => a.shotIndex - b.shotIndex).map((entry) => {
    validateCandidateAssetEntry(entry, { policy, sequenceJob: job });
    const request = requestMap.get(entry.shotIndex);
    if (!request) throw new Error(`no current provider request for shot ${entry.shotIndex}`);
    if (entry.requestId !== request.requestId || entry.requestDigest !== digestProviderRequest(request)) throw new Error(`picture plan request/version drift detected for shot ${entry.shotIndex}`);
    if (entry.sequenceJobDigest !== sequenceJobDigest) throw new Error(`picture plan sequence job/version drift detected for shot ${entry.shotIndex}`);
    return {
      shotIndex: entry.shotIndex,
      shotTitle: entry.shotTitle,
      durationSeconds: Number(job.generation.shots[entry.shotIndex - 1].durationSeconds),
      candidateAssetId: entry.candidateAssetId,
      candidateEntryHash: entry.entryHash,
      artifactSha256: entry.artifact.sha256,
      requestId: entry.requestId,
      requestDigest: entry.requestDigest,
      continuityVersion: entry.continuityVersion,
    };
  });
  const totalDurationSeconds = shotSelections.reduce((total, shot) => total + shot.durationSeconds, 0);
  const id = planId ?? `${policy.sequenceId}-picture-plan-r${String(registry.revision).padStart(2, '0')}`;
  safeToken(id, 'planId');
  parseTime(createdAt, 'createdAt');
  const plan = {
    schema: CINESWARM_PICTURE_PLAN_CANDIDATE_SCHEMA,
    planId: id,
    policyId: policy.policyId,
    registryId: registry.registryId,
    registryRevision: registry.revision,
    registryHash: registry.registryHash,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    sequenceJobDigest,
    continuityVersion: continuityVersions[0],
    createdAt,
    state: 'PICTURE_PLAN_CANDIDATE',
    shotCount: shotSelections.length,
    totalDurationSeconds,
    shotSelections,
    qc: {
      completeShotCoverage: true,
      orderedShotMapping: true,
      distinctArtifacts: true,
      exactRequestDigests: true,
      exactSequenceJobDigest: true,
      metadataContinuityVersionMatch: true,
      perceptualContinuityReviewRequired: true,
    },
    picturePlanHumanReviewRequired: true,
    autoPictureLock: false,
    pictureLockCeremonyEligible: false,
    pictureLocked: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  plan.planHash = digestJson(picturePlanHashPayload(plan));
  return plan;
}

export function validatePicturePlanCandidate(plan, { policy = null, registry = null, sequenceJob = null, requests = null } = {}) {
  if (!plan || typeof plan !== 'object') throw new Error('picture plan candidate must be an object');
  if (plan.schema !== CINESWARM_PICTURE_PLAN_CANDIDATE_SCHEMA) throw new Error(`unsupported picture plan schema: ${plan.schema}`);
  safeToken(plan.planId, 'planId');
  safeToken(plan.policyId, 'policyId');
  safeToken(plan.registryId, 'registryId');
  ensureSha256(plan.registryHash, 'registryHash');
  safeToken(plan.episodeId, 'episodeId');
  safeToken(plan.sequenceId, 'sequenceId');
  ensureSha256(plan.sequenceJobDigest, 'sequenceJobDigest');
  safeToken(plan.continuityVersion, 'continuityVersion');
  parseTime(plan.createdAt, 'createdAt');
  if (plan.state !== 'PICTURE_PLAN_CANDIDATE') throw new Error('C1.9 plan state must remain PICTURE_PLAN_CANDIDATE');
  if (!Array.isArray(plan.shotSelections) || plan.shotSelections.length !== plan.shotCount || !plan.shotSelections.length) throw new Error('picture plan shotSelections/shotCount mismatch');
  const shotIndices = plan.shotSelections.map((shot) => shot.shotIndex);
  if (new Set(shotIndices).size !== shotIndices.length) throw new Error('picture plan contains duplicate shotIndex');
  if (new Set(plan.shotSelections.map((shot) => shot.candidateAssetId)).size !== plan.shotSelections.length) throw new Error('picture plan contains duplicate candidateAssetId');
  if (new Set(plan.shotSelections.map((shot) => shot.artifactSha256)).size !== plan.shotSelections.length) throw new Error('picture plan contains duplicate artifactSha256');
  for (const shot of plan.shotSelections) {
    if (!Number.isInteger(shot.shotIndex) || shot.shotIndex <= 0) throw new Error('picture plan shotIndex must be positive');
    requiredString(shot.shotTitle, 'picture plan shotTitle');
    if (!Number.isFinite(Number(shot.durationSeconds)) || Number(shot.durationSeconds) <= 0) throw new Error('picture plan shot duration must be positive');
    safeToken(shot.candidateAssetId, 'picture plan candidateAssetId');
    ensureSha256(shot.candidateEntryHash, 'picture plan candidateEntryHash');
    ensureSha256(shot.artifactSha256, 'picture plan artifactSha256');
    safeToken(shot.requestId, 'picture plan requestId');
    ensureSha256(shot.requestDigest, 'picture plan requestDigest');
    if (shot.continuityVersion !== plan.continuityVersion) throw new Error('picture plan continuityVersion drift detected');
  }
  const total = plan.shotSelections.reduce((sum, shot) => sum + Number(shot.durationSeconds), 0);
  if (Number(plan.totalDurationSeconds) !== total) throw new Error('picture plan totalDurationSeconds mismatch');
  const qc = plan.qc || {};
  for (const key of ['completeShotCoverage', 'orderedShotMapping', 'distinctArtifacts', 'exactRequestDigests', 'exactSequenceJobDigest', 'metadataContinuityVersionMatch', 'perceptualContinuityReviewRequired']) {
    if (qc[key] !== true) throw new Error(`picture plan qc.${key} must remain true`);
  }
  if (plan.picturePlanHumanReviewRequired !== true || plan.autoPictureLock !== false) throw new Error('picture plan must require human review and disable auto Picture Lock');
  for (const key of ['pictureLockCeremonyEligible', 'pictureLocked', 'canonEligible', 'ledgerPromotionEligible', 'publicRelease', 'relayDependency']) {
    if (plan[key] !== false) throw new Error(`new C1.9 picture plan must preserve ${key}=false`);
  }
  ensureSha256(plan.planHash, 'planHash');
  if (plan.planHash !== digestJson(picturePlanHashPayload(plan))) throw new Error('picture plan candidate self-hash mismatch');

  if (policy) {
    validateCandidateRegistryPolicy(policy);
    if (plan.policyId !== policy.policyId || plan.episodeId !== policy.episodeId || plan.sequenceId !== policy.sequenceId || plan.shotCount !== policy.requiredShotCount) throw new Error('picture plan does not match policy scope');
  }
  if (registry) {
    validateCandidateAssetRegistry(registry, policy ? { policy } : {});
    if (plan.registryId !== registry.registryId || plan.registryRevision !== registry.revision || plan.registryHash !== registry.registryHash) throw new Error('picture plan registry/version drift detected');
    for (const selection of plan.shotSelections) {
      const entry = registry.entries.find((candidate) => candidate.candidateAssetId === selection.candidateAssetId);
      if (!entry || entry.entryHash !== selection.candidateEntryHash || entry.artifact.sha256 !== selection.artifactSha256) throw new Error(`picture plan candidate registry linkage drift detected for shot ${selection.shotIndex}`);
    }
  }
  let job = null;
  if (sequenceJob) {
    job = validateSequenceJobShape(findSequenceJob(sequenceJob, plan.sequenceId));
    if (plan.sequenceJobDigest !== digestSequenceJob(job)) throw new Error('picture plan sequence job/version drift detected');
    if (job.generation.shots.length !== plan.shotCount) throw new Error('picture plan shot count drifted from sequence job');
    for (const selection of plan.shotSelections) {
      const shot = job.generation.shots[selection.shotIndex - 1];
      if (!shot || shot.title !== selection.shotTitle || Number(shot.durationSeconds) !== Number(selection.durationSeconds)) throw new Error(`picture plan shot contract drift detected for shot ${selection.shotIndex}`);
    }
  }
  if (requests) {
    const requestMap = requestMapForSequence(requests, plan.sequenceId);
    for (const selection of plan.shotSelections) {
      const request = requestMap.get(selection.shotIndex);
      if (!request || selection.requestId !== request.requestId || selection.requestDigest !== digestProviderRequest(request)) throw new Error(`picture plan request/version drift detected for shot ${selection.shotIndex}`);
    }
  }
  return { valid: true, planHash: plan.planHash, shotCount: plan.shotCount };
}

export function validatePicturePlanReview(review, plan) {
  validatePicturePlanCandidate(plan);
  if (!review || typeof review !== 'object') throw new Error('picture plan review must be an object');
  if (review.schema !== CINESWARM_PICTURE_PLAN_REVIEW_SCHEMA) throw new Error(`unsupported picture plan review schema: ${review.schema}`);
  safeToken(review.reviewId, 'reviewId');
  if (review.planId !== plan.planId || review.planHash !== plan.planHash) throw new Error('picture plan review does not match exact plan candidate');
  if (review.authority?.kind !== 'human') throw new Error('picture plan review requires human authority');
  safeToken(review.authority?.id, 'authority.id');
  if (review.simulated !== false) throw new Error('picture plan review must be real, not simulated');
  if (!C1_9_PICTURE_PLAN_REVIEW_DECISIONS.includes(review.decision)) throw new Error('picture plan review decision must be APPROVE_FOR_LOCK_CEREMONY, REVISE, or HOLD');
  requiredString(review.reason, 'reason');
  parseTime(review.recordedAt, 'recordedAt');
  if (review.pictureLockAuthorized !== false) throw new Error('C1.9 picture plan review must not authorize Picture Lock');
  if (review.canonAuthorized !== false || review.ledgerPromotionAuthorized !== false || review.publicRelease !== false || review.relayDependency !== false) throw new Error('picture plan review must preserve downstream authority boundaries');
  return { valid: true, decision: review.decision };
}

export function classifyPicturePlan({ plan, review = null }) {
  validatePicturePlanCandidate(plan);
  if (!review) {
    return {
      state: 'PICTURE_PLAN_CANDIDATE',
      humanReview: null,
      pictureLockCeremonyEligible: false,
      pictureLocked: false,
      canonEligible: false,
      ledgerPromotionEligible: false,
      publicRelease: false,
      relayDependency: false,
    };
  }
  validatePicturePlanReview(review, plan);
  const approved = review.decision === 'APPROVE_FOR_LOCK_CEREMONY';
  return {
    state: approved ? 'APPROVED_FOR_PICTURE_LOCK_CEREMONY' : review.decision === 'REVISE' ? 'REVISION_REQUIRED' : 'HOLD',
    humanReview: review.decision,
    pictureLockCeremonyEligible: approved,
    pictureLocked: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
    note: approved
      ? 'Human approval makes this exact plan eligible for a separate Picture Lock ceremony. C1.9 does not lock picture.'
      : 'The Picture Plan remains unlocked and unavailable to a Picture Lock ceremony until a later approved review exists.',
  };
}
