export const CINESWARM_BRIDGE_SCHEMA = 'parallax.network.cineswarm.production-job.v0.1';
export const CINESWARM_DELIVERY_SCHEMA = 'parallax.cineswarm.internal-delivery.v0.1';
export const CINESWARM_PROVIDER_READINESS_SCHEMA = 'parallax.cineswarm.provider-readiness-packet.v0.1';
export const CINESWARM_PROVIDER_GO_NO_GO_SCHEMA = 'parallax.cineswarm.provider-go-no-go.v0.1';
export const CINESWARM_CANDIDATE = 'C0-v0.1';
export const CINESWARM_LOCAL_ORIGIN = 'http://127.0.0.1:3690';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeToken(value, label) {
  const token = requiredString(value, label);
  if (!/^[A-Za-z0-9_.-]+$/.test(token)) throw new Error(`${label} must contain only letters, digits, dot, underscore, or hyphen`);
  return token;
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`);
  return number;
}

function ensureStringArray(value, label, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min) throw new Error(`${label} must be an array with at least ${min} item(s)`);
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

export function totalShotDuration(shots = []) {
  return shots.reduce((total, shot) => total + Number(shot.durationSeconds || 0), 0);
}

export function validateProductionJob(job) {
  if (!job || typeof job !== 'object') throw new Error('production job must be an object');
  if (job.schema !== CINESWARM_BRIDGE_SCHEMA) throw new Error(`unsupported production job schema: ${job.schema}`);
  if (job.targetEngine?.candidate !== CINESWARM_CANDIDATE) throw new Error(`target engine must be ${CINESWARM_CANDIDATE}`);
  if (job.targetEngine?.transport !== 'file-handoff') throw new Error('Candidate C0 bridge transport must remain file-handoff');

  safeToken(job.network?.episodeId, 'episodeId');
  safeToken(job.network?.workspaceId, 'workspaceId');
  safeToken(job.network?.receiptId, 'receiptId');
  safeToken(job.network?.sequenceId, 'sequenceId');
  safeToken(job.project?.humanAuthorityId, 'humanAuthorityId');
  requiredString(job.project?.name, 'project name');
  requiredString(job.project?.brief, 'brief');
  requiredString(job.project?.seed, 'project seed');
  requiredString(job.generation?.seed, 'generation seed');

  const shots = job.generation?.shots;
  if (!Array.isArray(shots) || shots.length < 3 || shots.length > 5) throw new Error('Candidate C0 requires 3–5 shots per sequence');
  for (const [index, shot] of shots.entries()) {
    requiredString(shot.title, `shot ${index + 1} title`);
    requiredString(shot.prompt, `shot ${index + 1} prompt`);
    if (!Number.isFinite(Number(shot.durationSeconds)) || Number(shot.durationSeconds) <= 0) throw new Error(`shot ${index + 1} durationSeconds must be positive`);
  }

  const total = totalShotDuration(shots);
  if (total < 15 || total > 60) throw new Error(`Candidate C0 sequence duration must be 15–60 seconds; got ${total}`);
  if (Number(job.constraints?.expectedDurationSeconds) !== total) throw new Error('expectedDurationSeconds must equal summed shot duration');
  if (Number(job.constraints?.shotCount) !== shots.length) throw new Error('shotCount must equal the actual shot count');

  if (job.constraints?.publicRelease !== false) throw new Error('Candidate C0 production jobs must set publicRelease=false');
  if (job.constraints?.humanBriefApprovalRequired !== true) throw new Error('human brief approval must remain required');
  if (job.constraints?.humanAssetAcceptanceRequired !== true) throw new Error('human asset acceptance must remain required');
  if (job.constraints?.humanDispositionRequired !== true) throw new Error('human disposition must remain required');
  if (job.constraints?.relayDependency !== false) throw new Error('CineSwarm must not depend on Parallax Relay');

  return { valid: true, durationSeconds: total, shotCount: shots.length };
}

export function toCineSwarmCreatePayload(job) {
  validateProductionJob(job);
  return {
    name: job.project.name,
    humanAuthorityId: job.project.humanAuthorityId,
    brief: job.project.brief,
    seed: job.project.seed,
  };
}

export function toCineSwarmShotPayload(job) {
  validateProductionJob(job);
  return job.generation.shots.map(({ title, prompt, durationSeconds }) => ({ title, prompt, durationSeconds }));
}

export function validateDeliveryManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('delivery manifest must be an object');
  if (manifest.schema !== CINESWARM_DELIVERY_SCHEMA) throw new Error(`unsupported delivery schema: ${manifest.schema}`);
  safeToken(manifest.deliveryId, 'deliveryId');
  requiredString(manifest.masterHash, 'masterHash');
  if (manifest.releaseState !== 'Unavailable') throw new Error('Candidate C0 delivery must preserve releaseState=Unavailable');
  if (manifest.publicDestination !== null) throw new Error('Candidate C0 delivery must not contain a public destination');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('delivery manifest must inventory files');
  for (const entry of manifest.files) {
    requiredString(entry.path, 'delivery file path');
    if (!/^[a-f0-9]{64}$/.test(String(entry.sha256 || ''))) throw new Error(`invalid SHA-256 for ${entry.path}`);
    if (!Number.isInteger(entry.size) || entry.size < 0) throw new Error(`invalid size for ${entry.path}`);
  }
  return { valid: true, fileCount: manifest.files.length };
}

export function classifyDeliveryForStudio({ manifest, humanDisposition, qcPacket }) {
  validateDeliveryManifest(manifest);
  const qcPassed = qcPacket?.status === 'Passed' && qcPacket?.data?.durationPass === true;
  const disposition = humanDisposition?.data?.disposition;
  const humanIsReal = humanDisposition?.data?.authority?.kind === 'human' && humanDisposition?.data?.simulated === false;
  const acceptableDisposition = ['Accept for bounded pilot', 'Accept with conditions'].includes(disposition);
  const releaseStillFalse = humanDisposition?.data?.release === false;
  return {
    ingestEligible: Boolean(qcPassed && humanIsReal && acceptableDisposition && releaseStillFalse),
    qcPassed,
    humanIsReal,
    acceptableDisposition,
    releaseStillFalse,
    note: 'Ingest eligibility means Studio may review/use the internal candidate. It never grants public release authority.',
  };
}

export const PROVIDER_READINESS_PREFLIGHT_CHECKS = [
  'modelPinned',
  'requestManifestsFrozen',
  'runnerBuilt',
  'outputPathConstrained',
  'humanAssetAcceptanceRequired',
  'founderCeremonyBuilt',
  'retentionPostureConfirmed',
  'currentPricingConfirmed',
  'externalCredentialProvisioned',
];

export const PROVIDER_READINESS_POST_DECISION_CHECKS = [
  'founderLiveRunDecisionRecorded',
  'requestAuthorizationsRecorded',
];

export const PROVIDER_READINESS_REQUIRED_CHECKS = [
  ...PROVIDER_READINESS_PREFLIGHT_CHECKS,
  ...PROVIDER_READINESS_POST_DECISION_CHECKS,
];

export function validateProviderReadinessPacket(packet) {
  if (!packet || typeof packet !== 'object') throw new Error('provider readiness packet must be an object');
  if (packet.schema !== CINESWARM_PROVIDER_READINESS_SCHEMA) throw new Error(`unsupported provider readiness schema: ${packet.schema}`);
  safeToken(packet.packetId, 'packetId');
  safeToken(packet.episodeId, 'episodeId');
  safeToken(packet.sequenceId, 'sequenceId');
  safeToken(packet.providerId, 'providerId');
  requiredString(packet.providerName, 'providerName');
  requiredString(packet.modelSnapshot, 'modelSnapshot');
  requiredString(packet.status, 'status');
  const requestIds = ensureStringArray(packet.requestIds, 'requestIds', { min: 3 });

  const requestCeilingUsd = requiredPositiveNumber(packet.governanceCeilings?.requestCeilingUsd, 'requestCeilingUsd');
  const batchCeilingUsd = requiredPositiveNumber(packet.governanceCeilings?.batchCeilingUsd, 'batchCeilingUsd');
  if (batchCeilingUsd < requestCeilingUsd) throw new Error('batchCeilingUsd must be greater than or equal to requestCeilingUsd');

  const checklist = packet.checklist;
  if (!checklist || typeof checklist !== 'object') throw new Error('checklist must be an object');
  const checks = {};
  for (const key of PROVIDER_READINESS_REQUIRED_CHECKS) {
    checks[key] = requiredBoolean(checklist[key], `checklist.${key}`);
  }

  const blockers = ensureStringArray(packet.blockers, 'blockers', { min: 0 });
  const preflightBlockers = ensureStringArray(packet.preflightBlockers ?? blockers, 'preflightBlockers', { min: 0 });
  const workflowPending = ensureStringArray(packet.workflowPending ?? [], 'workflowPending', { min: 0 });
  const readyForFounderDecision = PROVIDER_READINESS_PREFLIGHT_CHECKS.every((key) => checks[key] === true);
  const readyForLiveRun = PROVIDER_READINESS_REQUIRED_CHECKS.every((key) => checks[key] === true);

  if (readyForLiveRun && blockers.length) throw new Error('provider readiness packet cannot declare blockers if all required checks are true');
  if (!readyForLiveRun && !blockers.length) throw new Error('provider readiness packet must list blockers while required checks remain false');
  if (readyForFounderDecision && preflightBlockers.length) throw new Error('preflightBlockers must be empty once the packet is ready for founder decision');
  if (!readyForFounderDecision && !preflightBlockers.length) throw new Error('preflightBlockers must list unresolved preflight evidence while founder decision is blocked');

  if (packet.sequenceId === 'pn0001-seq01-cold-open') {
    if (requestIds.length !== 3) throw new Error('PN-0001 Cold Open readiness packet must bind exactly three request IDs');
    if (requestCeilingUsd !== 0.06) throw new Error('PN-0001 Cold Open request ceiling must remain $0.06');
    if (batchCeilingUsd !== 0.18) throw new Error('PN-0001 Cold Open batch ceiling must remain $0.18');
  }

  return {
    valid: true,
    requestIds,
    readyForFounderDecision,
    readyForLiveRun,
    blockerCount: blockers.length,
    preflightBlockerCount: preflightBlockers.length,
    unresolvedChecks: PROVIDER_READINESS_REQUIRED_CHECKS.filter((key) => checks[key] !== true),
    unresolvedPreflightChecks: PROVIDER_READINESS_PREFLIGHT_CHECKS.filter((key) => checks[key] !== true),
    preflightBlockers,
    workflowPending,
  };
}

export function summarizeProviderReadiness(packet) {
  const validated = validateProviderReadinessPacket(packet);
  const checklist = packet.checklist;
  const unresolvedItems = [
    { key: 'retentionPostureConfirmed', label: 'Retention / ZDR posture confirmed' },
    { key: 'currentPricingConfirmed', label: 'Current exact pricing confirmed' },
    { key: 'externalCredentialProvisioned', label: 'External provider credential provisioned' },
    { key: 'founderLiveRunDecisionRecorded', label: 'Founder live-run decision recorded' },
    { key: 'requestAuthorizationsRecorded', label: 'Three request authorization records created' },
  ].filter(({ key }) => checklist[key] !== true).map(({ label }) => label);

  return {
    packetId: packet.packetId,
    sequenceId: packet.sequenceId,
    provider: `${packet.providerName} / ${packet.modelSnapshot}`,
    requestCount: validated.requestIds.length,
    requestCeilingUsd: packet.governanceCeilings.requestCeilingUsd,
    batchCeilingUsd: packet.governanceCeilings.batchCeilingUsd,
    readyForFounderDecision: validated.readyForFounderDecision,
    readyForLiveRun: validated.readyForLiveRun,
    unresolvedChecks: validated.unresolvedChecks,
    unresolvedPreflightChecks: validated.unresolvedPreflightChecks,
    unresolvedItems,
    preflightBlockers: validated.preflightBlockers,
    workflowPending: validated.workflowPending,
    blockers: packet.blockers,
  };
}

export function validateProviderGoNoGoDecision(decision, packet) {
  if (!decision || typeof decision !== 'object') throw new Error('provider go/no-go decision must be an object');
  if (decision.schema !== CINESWARM_PROVIDER_GO_NO_GO_SCHEMA) throw new Error(`unsupported provider go/no-go schema: ${decision.schema}`);
  const summary = summarizeProviderReadiness(packet);
  safeToken(decision.decisionId, 'decisionId');
  if (decision.packetId !== packet.packetId) throw new Error('decision packetId must match the provider readiness packet');
  if (decision.authority?.kind !== 'human') throw new Error('provider go/no-go decision requires human authority');
  safeToken(decision.authority?.id, 'authority.id');
  if (decision.simulated !== false) throw new Error('provider go/no-go decision must be real, not simulated');
  if (!['GO', 'NO_GO', 'DEFER'].includes(decision.decision)) throw new Error('decision must be GO, NO_GO, or DEFER');
  requiredString(decision.reason, 'reason');
  if (typeof decision.liveRunAuthorized !== 'boolean') throw new Error('liveRunAuthorized must be a boolean');
  if (typeof decision.spendAuthorized !== 'boolean') throw new Error('spendAuthorized must be a boolean');

  if (decision.decision === 'GO') {
    if (!summary.readyForFounderDecision) throw new Error('GO decision is not allowed while provider preflight blockers remain');
    if (decision.liveRunAuthorized !== true || decision.spendAuthorized !== true) throw new Error('GO decision must explicitly authorize the bounded live-run lane and spend envelope');
  }

  if (decision.decision !== 'GO') {
    if (decision.liveRunAuthorized !== false || decision.spendAuthorized !== false) throw new Error('NO_GO/DEFER decisions cannot authorize liveRun or spend');
  }

  const acknowledgedBlockers = ensureStringArray(decision.acknowledgedBlockers, 'acknowledgedBlockers', { min: 0 });
  const missingAcknowledgements = summary.preflightBlockers.filter((blocker) => !acknowledgedBlockers.includes(blocker));
  if (summary.preflightBlockers.length && missingAcknowledgements.length) throw new Error('decision must acknowledge all current preflight blockers');

  return {
    valid: true,
    decision: decision.decision,
    readyForFounderDecision: summary.readyForFounderDecision,
    readyForLiveRun: summary.readyForLiveRun,
    preflightBlockerCount: summary.preflightBlockers.length,
  };
}

export function classifyProviderGoNoGo({ packet, decision = null }) {
  const summary = summarizeProviderReadiness(packet);
  const classification = {
    packetId: summary.packetId,
    sequenceId: summary.sequenceId,
    readyForFounderDecision: summary.readyForFounderDecision,
    readyForLiveRun: summary.readyForLiveRun,
    blockerCount: summary.blockers.length,
    preflightBlockerCount: summary.preflightBlockers.length,
    blockers: summary.blockers,
    preflightBlockers: summary.preflightBlockers,
    workflowPending: summary.workflowPending,
    goNoGoState: 'UNDECIDED',
    liveRunAuthorized: false,
    spendAuthorized: false,
    note: 'Provider go/no-go opens only the bounded execution lane. Request-specific human authorizations, asset acceptance, and public release remain separate gates.',
  };
  if (!decision) return classification;

  const validatedDecision = validateProviderGoNoGoDecision(decision, packet);
  return {
    ...classification,
    goNoGoState: validatedDecision.decision,
    liveRunAuthorized: decision.liveRunAuthorized,
    spendAuthorized: decision.spendAuthorized,
  };
}

export * from './locked-render-audio.js';

export * from './canon-ledger-admission.js';

export * from './ledger-release-candidate.js';

export * from './network-release.js';

export * from './release-lifecycle.js';

export * from './public-archive-integrity.js';

export * from './archive-recovery.js';

export * from './replica-maintenance.js';

export * from './preservation-audit-refresh.js';

export * from './format-obsolescence-migration.js';

export * from './decode-environment-access.js';

export * from './reproducible-decode-capsule.js';

export * from './independent-source-rebuild.js';

export * from './independent-rebuild-admission.js';

export * from './offline-human-admission-kit.js';

export * from './human-ceremony-console.js';

export * from './canonical-admission-commit.js';
export * from './resumable-human-ceremony.js';

export * from './challenge-health-handoff.js';

export * from './waveforge-release-reference.js';
