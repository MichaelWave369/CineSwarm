import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  CINESWARM_EXECUTION_ENVELOPE_SCHEMA,
  CINESWARM_SIGNING_KEY_REGISTRY_SCHEMA,
  canonicalJson,
  digestJson,
  validateSigningKeyRegistry,
} from './authorization-seal.js';

export const CINESWARM_KEY_CEREMONY_POLICY_SCHEMA = 'parallax.cineswarm.key-ceremony-policy.c1.7.v0.1';
export const CINESWARM_HUMAN_KEY_CEREMONY_SCHEMA = 'parallax.cineswarm.human-key-ceremony.c1.7.v0.1';
export const CINESWARM_KEY_CEREMONY_PLAN_SCHEMA = 'parallax.cineswarm.key-ceremony-plan.c1.7.v0.1';
export const CINESWARM_EXECUTION_JOURNAL_SCHEMA = 'parallax.cineswarm.execution-journal.c1.7.v0.1';
export const CINESWARM_EXECUTION_JOURNAL_ENTRY_SCHEMA = 'parallax.cineswarm.execution-journal-entry.c1.7.v0.1';
export const C1_7_KEY_ALGORITHM = 'Ed25519';
export const C1_7_JOURNAL_EVENTS = Object.freeze(['CLAIMED', 'SUCCEEDED', 'FAILED', 'ABORTED']);

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

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function ensureStringArray(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) throw new Error(`${label} must contain at least ${min} item(s)`);
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

function validatePublicKeyPem(publicKeyPem) {
  const pem = requiredString(publicKeyPem, 'publicKeyPem');
  if (!pem.includes('BEGIN PUBLIC KEY')) throw new Error('publicKeyPem must be a public key');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key must be Ed25519');
  return key;
}

export function publicKeyFingerprintSha256(publicKeyPem) {
  const key = validatePublicKeyPem(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function buildKeyPossessionMessage({ ceremonyId, authorityId, keyId, publicKeyPem, challengeNonce }) {
  safeToken(ceremonyId, 'ceremonyId');
  safeToken(authorityId, 'authorityId');
  safeToken(keyId, 'keyId');
  safeToken(challengeNonce, 'challengeNonce');
  const fingerprint = publicKeyFingerprintSha256(publicKeyPem);
  return [
    'PARALLAX-CINESWARM-C1.7-KEY-POSSESSION',
    ceremonyId,
    authorityId,
    keyId,
    fingerprint,
    challengeNonce,
  ].join('\n');
}

export function validateKeyCeremonyPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('key ceremony policy must be an object');
  if (policy.schema !== CINESWARM_KEY_CEREMONY_POLICY_SCHEMA) throw new Error(`unsupported key ceremony policy schema: ${policy.schema}`);
  if (policy.algorithm !== C1_7_KEY_ALGORITHM) throw new Error(`key ceremony policy must require ${C1_7_KEY_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('private key custody must remain external-human-controlled');
  if (policy.repositoryPrivateKeyStorageProhibited !== true) throw new Error('repository private-key storage must remain prohibited');
  if (policy.proofOfPossessionRequired !== true) throw new Error('proof of possession must remain required');
  if (policy.rotationRetiresPreviousKey !== true) throw new Error('rotation must retire the previous key');
  if (policy.recoveryRevokesPreviousKey !== true) throw new Error('recovery must revoke the previous key');
  if (Number(policy.minimumRecoveryEvidenceRefs) < 2) throw new Error('recovery policy must require at least two evidence references');
  if (policy.publicRelease !== false) throw new Error('key ceremony policy must preserve publicRelease=false');
  if (policy.relayDependency !== false) throw new Error('key ceremony policy must preserve relayDependency=false');
  return { valid: true };
}

export function validateKeyCeremonyPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('key ceremony plan must be an object');
  if (plan.schema !== CINESWARM_KEY_CEREMONY_PLAN_SCHEMA) throw new Error(`unsupported key ceremony plan schema: ${plan.schema}`);
  safeToken(plan.planId, 'planId');
  if (plan.authority?.kind !== 'human') throw new Error('key ceremony plan authority must be human');
  safeToken(plan.authority?.id, 'authority.id');
  if (!['PENDING_KEY_GENERATION', 'READY_FOR_CEREMONY', 'COMPLETE'].includes(plan.status)) throw new Error('key ceremony plan status is invalid');
  requiredBoolean(plan.privateKeyMustRemainExternal, 'privateKeyMustRemainExternal');
  if (plan.privateKeyMustRemainExternal !== true) throw new Error('key ceremony plan must keep private key external');
  requiredBoolean(plan.publicRelease, 'publicRelease');
  if (plan.publicRelease !== false) throw new Error('key ceremony plan must preserve publicRelease=false');
  requiredBoolean(plan.relayDependency, 'relayDependency');
  if (plan.relayDependency !== false) throw new Error('key ceremony plan must preserve relayDependency=false');
  return { valid: true, status: plan.status };
}

function validateNewKeyBlock(ceremony) {
  const newKey = ceremony.newKey;
  if (!newKey || typeof newKey !== 'object') throw new Error(`${ceremony.action} ceremony requires newKey`);
  safeToken(newKey.keyId, 'newKey.keyId');
  if (newKey.algorithm !== C1_7_KEY_ALGORITHM) throw new Error(`newKey.algorithm must be ${C1_7_KEY_ALGORITHM}`);
  const fingerprint = publicKeyFingerprintSha256(newKey.publicKeyPem);
  if (newKey.fingerprintSha256 !== fingerprint) throw new Error('newKey fingerprint does not match publicKeyPem');
  safeToken(newKey.possessionProof?.challengeNonce, 'possessionProof.challengeNonce');
  const signatureBase64 = requiredString(newKey.possessionProof?.signatureBase64, 'possessionProof.signatureBase64');
  const message = buildKeyPossessionMessage({
    ceremonyId: ceremony.ceremonyId,
    authorityId: ceremony.authority.id,
    keyId: newKey.keyId,
    publicKeyPem: newKey.publicKeyPem,
    challengeNonce: newKey.possessionProof.challengeNonce,
  });
  const verified = cryptoVerify(null, Buffer.from(message), newKey.publicKeyPem, Buffer.from(signatureBase64, 'base64'));
  if (!verified) throw new Error('newKey proof-of-possession signature is invalid');
  return { fingerprint };
}

function findRegistryKey(registry, keyId) {
  const key = registry.keys.find((entry) => entry.keyId === keyId);
  if (!key) throw new Error(`previous signing key ${keyId} is not registered`);
  return key;
}

export function validateHumanKeyCeremony(ceremony, { keyRegistry, policy, now = ceremony?.recordedAt } = {}) {
  validateSigningKeyRegistry(keyRegistry);
  validateKeyCeremonyPolicy(policy);
  if (!ceremony || typeof ceremony !== 'object') throw new Error('human key ceremony must be an object');
  if (ceremony.schema !== CINESWARM_HUMAN_KEY_CEREMONY_SCHEMA) throw new Error(`unsupported human key ceremony schema: ${ceremony.schema}`);
  safeToken(ceremony.ceremonyId, 'ceremonyId');
  if (!['ENROLL', 'ROTATE', 'RECOVER', 'REVOKE'].includes(ceremony.action)) throw new Error('key ceremony action must be ENROLL, ROTATE, RECOVER, or REVOKE');
  if (ceremony.authority?.kind !== 'human') throw new Error('key ceremony authority must be human');
  safeToken(ceremony.authority?.id, 'authority.id');
  if (ceremony.simulated !== false) throw new Error('human key ceremony must be real, not simulated');
  const recorded = parseTime(ceremony.recordedAt, 'recordedAt');
  const current = parseTime(now, 'now');
  if (current.time < recorded.time) throw new Error('key ceremony is not valid before recordedAt');
  if (ceremony.publicRelease !== false) throw new Error('key ceremony must preserve publicRelease=false');
  if (ceremony.relayDependency !== false) throw new Error('key ceremony must preserve relayDependency=false');
  if (ceremony.acknowledgements?.privateKeyHeldExternally !== true) throw new Error('ceremony must acknowledge external private-key custody');
  if (ceremony.acknowledgements?.privateKeyNotStoredInRepository !== true) throw new Error('ceremony must acknowledge repository private-key prohibition');
  if (ceremony.acknowledgements?.fingerprintVerifiedByHuman !== true) throw new Error('ceremony must record human fingerprint verification');

  const activeKeys = keyRegistry.keys.filter((key) => key.authority?.id === ceremony.authority.id && key.status === 'active');
  let previousKey = null;
  let newKeyResult = null;

  if (ceremony.action === 'ENROLL') {
    if (activeKeys.length) throw new Error('ENROLL is not allowed while an active key already exists for this authority');
    if (ceremony.previousKeyId !== null && ceremony.previousKeyId !== undefined) throw new Error('ENROLL must not specify previousKeyId');
    newKeyResult = validateNewKeyBlock(ceremony);
  }

  if (ceremony.action === 'ROTATE') {
    safeToken(ceremony.previousKeyId, 'previousKeyId');
    previousKey = findRegistryKey(keyRegistry, ceremony.previousKeyId);
    if (previousKey.authority.id !== ceremony.authority.id) throw new Error('previous signing key belongs to a different authority');
    if (previousKey.status !== 'active') throw new Error('ROTATE requires an active previous signing key');
    newKeyResult = validateNewKeyBlock(ceremony);
  }

  if (ceremony.action === 'RECOVER') {
    safeToken(ceremony.previousKeyId, 'previousKeyId');
    previousKey = findRegistryKey(keyRegistry, ceremony.previousKeyId);
    if (previousKey.authority.id !== ceremony.authority.id) throw new Error('previous signing key belongs to a different authority');
    newKeyResult = validateNewKeyBlock(ceremony);
    const evidenceRefs = ensureStringArray(ceremony.recovery?.evidenceRefs, 'recovery.evidenceRefs', { min: Number(policy.minimumRecoveryEvidenceRefs) });
    requiredString(ceremony.recovery?.reason, 'recovery.reason');
    if (ceremony.recovery?.riskAcknowledgedByHuman !== true) throw new Error('RECOVER requires explicit human risk acknowledgement');
    if (evidenceRefs.length < Number(policy.minimumRecoveryEvidenceRefs)) throw new Error('RECOVER does not meet minimum recovery evidence requirement');
  }

  if (ceremony.action === 'REVOKE') {
    safeToken(ceremony.previousKeyId, 'previousKeyId');
    previousKey = findRegistryKey(keyRegistry, ceremony.previousKeyId);
    if (previousKey.authority.id !== ceremony.authority.id) throw new Error('previous signing key belongs to a different authority');
    if (previousKey.status === 'revoked') throw new Error('signing key is already revoked');
    if (ceremony.newKey !== null && ceremony.newKey !== undefined) throw new Error('REVOKE must not include newKey');
    requiredString(ceremony.reason, 'reason');
  }

  if (ceremony.newKey && keyRegistry.keys.some((entry) => entry.keyId === ceremony.newKey.keyId)) throw new Error(`new signing key ${ceremony.newKey.keyId} is already registered`);

  return {
    valid: true,
    action: ceremony.action,
    authorityId: ceremony.authority.id,
    previousKeyId: previousKey?.keyId ?? null,
    newKeyId: ceremony.newKey?.keyId ?? null,
    newKeyFingerprintSha256: newKeyResult?.fingerprint ?? null,
  };
}

export function applyHumanKeyCeremony(ceremony, { keyRegistry, policy, now = ceremony?.recordedAt } = {}) {
  const validated = validateHumanKeyCeremony(ceremony, { keyRegistry, policy, now });
  const next = structuredClone(keyRegistry);
  const recordedAt = ceremony.recordedAt;

  if (validated.previousKeyId) {
    const previous = next.keys.find((entry) => entry.keyId === validated.previousKeyId);
    if (ceremony.action === 'ROTATE') previous.status = 'retired';
    if (ceremony.action === 'RECOVER' || ceremony.action === 'REVOKE') previous.status = 'revoked';
    previous.validUntil = recordedAt;
    previous.lastCeremonyId = ceremony.ceremonyId;
  }

  if (ceremony.newKey) {
    next.keys.push({
      keyId: ceremony.newKey.keyId,
      algorithm: C1_7_KEY_ALGORITHM,
      status: 'active',
      authority: { kind: 'human', id: ceremony.authority.id },
      publicKeyPem: ceremony.newKey.publicKeyPem,
      fingerprintSha256: ceremony.newKey.fingerprintSha256,
      validFrom: recordedAt,
      validUntil: null,
      enrolledByCeremonyId: ceremony.ceremonyId,
    });
  }

  next.status = next.keys.some((entry) => entry.status === 'active') ? 'PROVISIONED' : 'NO_ACTIVE_KEY';
  validateSigningKeyRegistry(next);
  return next;
}

export function classifyKeyCeremonyReadiness({ plan, keyRegistry }) {
  validateKeyCeremonyPlan(plan);
  validateSigningKeyRegistry(keyRegistry);
  const activeKeys = keyRegistry.keys.filter((key) => key.authority?.id === plan.authority.id && key.status === 'active');
  const blockers = [];
  if (!activeKeys.length) blockers.push('No active human signing public key is enrolled.');
  if (plan.status !== 'COMPLETE') blockers.push(`Human key ceremony plan is ${plan.status}.`);
  return {
    keyReady: blockers.length === 0,
    activeKeyCount: activeKeys.length,
    activeKeyIds: activeKeys.map((key) => key.keyId),
    blockers,
    privateKeyCustody: 'external-human-controlled',
    publicRelease: false,
    relayDependency: false,
  };
}

function journalEntryHash(entry) {
  const copy = { ...entry };
  delete copy.entryHash;
  return digestJson(copy);
}

export function validateExecutionJournal(journal) {
  if (!journal || typeof journal !== 'object') throw new Error('execution journal must be an object');
  if (journal.schema !== CINESWARM_EXECUTION_JOURNAL_SCHEMA) throw new Error(`unsupported execution journal schema: ${journal.schema}`);
  safeToken(journal.journalId, 'journalId');
  safeToken(journal.episodeId, 'episodeId');
  safeToken(journal.sequenceId, 'sequenceId');
  if (journal.appendOnly !== true) throw new Error('execution journal must be appendOnly=true');
  if (journal.singleUseEnvelopes !== true) throw new Error('execution journal must enforce singleUseEnvelopes=true');
  if (journal.publicRelease !== false) throw new Error('execution journal must preserve publicRelease=false');
  if (journal.relayDependency !== false) throw new Error('execution journal must preserve relayDependency=false');
  if (!Array.isArray(journal.entries)) throw new Error('execution journal entries must be an array');

  let previousHash = null;
  const claimsByEnvelope = new Map();
  const terminalByExecution = new Set();
  const seenEntryIds = new Set();
  const seenEnvelopeDigests = new Set();
  const seenNonces = new Set();
  const seenExecutionIds = new Set();

  for (const [index, entry] of journal.entries.entries()) {
    if (entry.schema !== CINESWARM_EXECUTION_JOURNAL_ENTRY_SCHEMA) throw new Error(`unsupported execution journal entry schema at index ${index}`);
    if (entry.index !== index + 1) throw new Error(`execution journal entry index drift at ${index}`);
    safeToken(entry.entryId, 'entryId');
    if (seenEntryIds.has(entry.entryId)) throw new Error(`duplicate execution journal entryId ${entry.entryId}`);
    seenEntryIds.add(entry.entryId);
    if (!C1_7_JOURNAL_EVENTS.includes(entry.event)) throw new Error(`execution journal event ${entry.event} is invalid`);
    safeToken(entry.envelopeId, 'envelopeId');
    safeToken(entry.executionId, 'executionId');
    safeToken(entry.nonce, 'nonce');
    if (!/^[a-f0-9]{64}$/.test(String(entry.envelopeDigest || ''))) throw new Error('execution journal envelopeDigest is invalid');
    parseTime(entry.recordedAt, 'recordedAt');
    if (entry.previousEntryHash !== previousHash) throw new Error(`execution journal hash-chain predecessor mismatch at entry ${entry.index}`);
    if (!/^[a-f0-9]{64}$/.test(String(entry.entryHash || ''))) throw new Error(`execution journal entryHash is invalid at entry ${entry.index}`);
    const expectedHash = journalEntryHash(entry);
    if (entry.entryHash !== expectedHash) throw new Error(`execution journal entry hash mismatch at entry ${entry.index}`);

    if (entry.event === 'CLAIMED') {
      if (claimsByEnvelope.has(entry.envelopeId)) throw new Error(`execution envelope ${entry.envelopeId} was claimed more than once`);
      if (seenEnvelopeDigests.has(entry.envelopeDigest)) throw new Error(`execution envelope digest ${entry.envelopeDigest} was claimed more than once`);
      if (seenNonces.has(entry.nonce)) throw new Error(`execution envelope nonce ${entry.nonce} was claimed more than once`);
      if (seenExecutionIds.has(entry.executionId)) throw new Error(`executionId ${entry.executionId} was claimed more than once`);
      claimsByEnvelope.set(entry.envelopeId, entry);
      seenEnvelopeDigests.add(entry.envelopeDigest);
      seenNonces.add(entry.nonce);
      seenExecutionIds.add(entry.executionId);
      if (entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('CLAIMED journal entry must preserve release/Relay boundaries');
    } else {
      const claim = claimsByEnvelope.get(entry.envelopeId);
      if (!claim || claim.executionId !== entry.executionId || claim.envelopeDigest !== entry.envelopeDigest) throw new Error(`terminal journal entry ${entry.entryId} has no matching CLAIMED entry`);
      if (terminalByExecution.has(entry.executionId)) throw new Error(`execution ${entry.executionId} already has a terminal journal event`);
      terminalByExecution.add(entry.executionId);
    }
    previousHash = entry.entryHash;
  }

  return {
    valid: true,
    entryCount: journal.entries.length,
    claimCount: claimsByEnvelope.size,
    terminalCount: terminalByExecution.size,
    headHash: previousHash,
  };
}

function appendJournalEntry(journal, entryBase) {
  validateExecutionJournal(journal);
  const next = structuredClone(journal);
  const previousEntryHash = next.entries.length ? next.entries.at(-1).entryHash : null;
  const entry = {
    schema: CINESWARM_EXECUTION_JOURNAL_ENTRY_SCHEMA,
    index: next.entries.length + 1,
    previousEntryHash,
    ...entryBase,
  };
  entry.entryHash = journalEntryHash(entry);
  next.entries.push(entry);
  validateExecutionJournal(next);
  return next;
}

export function assertExecutionEnvelopeUnused(journal, envelope) {
  validateExecutionJournal(journal);
  if (!envelope || envelope.schema !== CINESWARM_EXECUTION_ENVELOPE_SCHEMA) throw new Error('execution envelope schema is invalid for journal claim');
  safeToken(envelope.envelopeId, 'envelopeId');
  safeToken(envelope.nonce, 'nonce');
  const envelopeDigest = digestJson(envelope);
  const replay = journal.entries.find((entry) => entry.event === 'CLAIMED' && (
    entry.envelopeId === envelope.envelopeId ||
    entry.envelopeDigest === envelopeDigest ||
    entry.nonce === envelope.nonce
  ));
  if (replay) throw new Error(`execution envelope replay blocked by journal entry ${replay.entryId}`);
  return { unused: true, envelopeDigest };
}

export function claimExecutionEnvelope({ journal, envelope, envelopeVerification, now, executionId }) {
  const current = parseTime(now, 'now');
  if (!envelopeVerification || envelopeVerification.valid !== true || envelopeVerification.runnerMayExecute !== true) throw new Error('execution envelope must pass C1.6 verification before journal claim');
  if (envelopeVerification.envelopeId !== envelope.envelopeId) throw new Error('execution envelope verification does not match envelopeId');
  if (envelope.singleUse !== true) throw new Error('journal claim requires singleUse=true envelope');
  if (envelope.publicRelease !== false || envelope.relayDependency !== false) throw new Error('journal claim requires release/Relay boundaries to remain false');
  const issuedAt = parseTime(envelope.issuedAt, 'envelope.issuedAt');
  const expiresAt = parseTime(envelope.expiresAt, 'envelope.expiresAt');
  if (current.time < issuedAt.time || current.time >= expiresAt.time) throw new Error('execution envelope is not currently valid for journal claim');
  safeToken(executionId, 'executionId');
  const { envelopeDigest } = assertExecutionEnvelopeUnused(journal, envelope);
  if (journal.entries.some((entry) => entry.executionId === executionId)) throw new Error(`executionId ${executionId} already exists in journal`);

  return appendJournalEntry(journal, {
    entryId: `${executionId}_claimed`,
    event: 'CLAIMED',
    envelopeId: envelope.envelopeId,
    envelopeDigest,
    nonce: envelope.nonce,
    executionId,
    recordedAt: current.text,
    maxBatchSpendUsd: Number(envelope.maxBatchSpendUsd),
    publicRelease: false,
    relayDependency: false,
  });
}

export function finalizeExecutionClaim({ journal, envelopeId, executionId, event, recordedAt, providerReceiptHash = null, note = null }) {
  validateExecutionJournal(journal);
  if (!['SUCCEEDED', 'FAILED', 'ABORTED'].includes(event)) throw new Error('terminal execution event must be SUCCEEDED, FAILED, or ABORTED');
  safeToken(envelopeId, 'envelopeId');
  safeToken(executionId, 'executionId');
  const time = parseTime(recordedAt, 'recordedAt');
  const claim = journal.entries.find((entry) => entry.event === 'CLAIMED' && entry.envelopeId === envelopeId && entry.executionId === executionId);
  if (!claim) throw new Error('cannot finalize execution without matching CLAIMED journal entry');
  if (journal.entries.some((entry) => entry.event !== 'CLAIMED' && entry.executionId === executionId)) throw new Error(`execution ${executionId} already has a terminal journal event`);
  if (time.time < Date.parse(claim.recordedAt)) throw new Error('terminal execution event cannot precede its claim');
  if (providerReceiptHash !== null && !/^[a-f0-9]{64}$/.test(String(providerReceiptHash))) throw new Error('providerReceiptHash must be null or SHA-256');
  if (note !== null) requiredString(note, 'note');

  return appendJournalEntry(journal, {
    entryId: `${executionId}_${event.toLowerCase()}`,
    event,
    envelopeId: claim.envelopeId,
    envelopeDigest: claim.envelopeDigest,
    nonce: claim.nonce,
    executionId,
    recordedAt: time.text,
    providerReceiptHash,
    note,
    publicRelease: false,
    relayDependency: false,
  });
}

export function classifyExecutionJournal(journal) {
  const validated = validateExecutionJournal(journal);
  const claims = journal.entries.filter((entry) => entry.event === 'CLAIMED');
  const terminals = journal.entries.filter((entry) => entry.event !== 'CLAIMED');
  return {
    journalId: journal.journalId,
    sequenceId: journal.sequenceId,
    entryCount: validated.entryCount,
    claimedEnvelopeCount: claims.length,
    terminalEventCount: terminals.length,
    activeExecutionCount: claims.filter((claim) => !terminals.some((entry) => entry.executionId === claim.executionId)).length,
    headHash: validated.headHash,
    replayProtectionReady: true,
    publicRelease: false,
    relayDependency: false,
    note: 'A CLAIMED single-use execution envelope remains permanently consumed even if the execution later fails or aborts.',
  };
}
