import {
  createHash,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  classifyRequestAuthorizationBatch,
  CINESWARM_REQUEST_AUTH_SCHEMA,
} from './execution-authorization.js';
import {
  CINESWARM_PROVIDER_GO_NO_GO_SCHEMA,
  validateProviderGoNoGoDecision,
  validateProviderReadinessPacket,
} from './index.js';

export const CINESWARM_SIGNING_POLICY_SCHEMA = 'parallax.cineswarm.signing-policy.c1.6.v0.1';
export const CINESWARM_SIGNING_KEY_REGISTRY_SCHEMA = 'parallax.cineswarm.signing-key-registry.c1.6.v0.1';
export const CINESWARM_REVOCATION_REGISTRY_SCHEMA = 'parallax.cineswarm.revocation-registry.c1.6.v0.1';
export const CINESWARM_RECEIPT_SEAL_SCHEMA = 'parallax.cineswarm.receipt-seal.c1.6.v0.1';
export const CINESWARM_EXECUTION_ENVELOPE_SCHEMA = 'parallax.cineswarm.execution-envelope.c1.6.v0.1';
export const C1_6_SIGNATURE_ALGORITHM = 'Ed25519';
export const C1_6_MAX_SEAL_TTL_MS = 24 * 60 * 60 * 1000;
export const C1_6_MAX_EXECUTION_ENVELOPE_TTL_MS = 10 * 60 * 1000;

const PAYLOAD_TYPES = new Set(['founder-go-no-go', 'request-execution-authorization']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeToken(value, label) {
  const token = requiredString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error(`${label} contains unsupported characters`);
  return token;
}

function parseTime(value, label) {
  const text = requiredString(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  return { text, time };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestJson(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sealMessage({ payloadType, payloadId, payloadDigest, keyId, authorityId, signedAt, expiresAt }) {
  return [
    'PARALLAX-CINESWARM-C1.6-RECEIPT-SEAL',
    payloadType,
    payloadId,
    payloadDigest,
    keyId,
    authorityId,
    signedAt,
    expiresAt,
  ].join('\n');
}

export function validateSigningPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('signing policy must be an object');
  if (policy.schema !== CINESWARM_SIGNING_POLICY_SCHEMA) throw new Error(`unsupported signing policy schema: ${policy.schema}`);
  if (policy.algorithm !== C1_6_SIGNATURE_ALGORITHM) throw new Error(`signing policy algorithm must be ${C1_6_SIGNATURE_ALGORITHM}`);
  if (policy.privateKeyCustody !== 'external-human-controlled') throw new Error('private key custody must remain external-human-controlled');
  if (policy.repositoryPrivateKeyStorageProhibited !== true) throw new Error('repository private-key storage must remain prohibited');
  if (Number(policy.maxSealTtlSeconds) !== C1_6_MAX_SEAL_TTL_MS / 1000) throw new Error('maxSealTtlSeconds drifted from C1.6 policy');
  if (Number(policy.maxExecutionEnvelopeTtlSeconds) !== C1_6_MAX_EXECUTION_ENVELOPE_TTL_MS / 1000) throw new Error('maxExecutionEnvelopeTtlSeconds drifted from C1.6 policy');
  if (policy.publicRelease !== false) throw new Error('signing policy must preserve publicRelease=false');
  if (policy.relayDependency !== false) throw new Error('signing policy must preserve relayDependency=false');
  return { valid: true };
}

export function validateSigningKeyRegistry(registry) {
  if (!registry || typeof registry !== 'object') throw new Error('signing key registry must be an object');
  if (registry.schema !== CINESWARM_SIGNING_KEY_REGISTRY_SCHEMA) throw new Error(`unsupported signing key registry schema: ${registry.schema}`);
  if (!Array.isArray(registry.keys)) throw new Error('signing key registry keys must be an array');
  const seen = new Set();
  for (const key of registry.keys) {
    safeToken(key.keyId, 'keyId');
    if (seen.has(key.keyId)) throw new Error(`duplicate signing key ${key.keyId}`);
    seen.add(key.keyId);
    if (key.algorithm !== C1_6_SIGNATURE_ALGORITHM) throw new Error(`signing key ${key.keyId} must use ${C1_6_SIGNATURE_ALGORITHM}`);
    if (!['active', 'retired', 'revoked'].includes(key.status)) throw new Error(`signing key ${key.keyId} has invalid status`);
    if (key.authority?.kind !== 'human') throw new Error(`signing key ${key.keyId} must belong to human authority`);
    safeToken(key.authority?.id, 'authority.id');
    requiredString(key.publicKeyPem, 'publicKeyPem');
    if (!key.publicKeyPem.includes('BEGIN PUBLIC KEY')) throw new Error(`signing key ${key.keyId} publicKeyPem is not a public key`);
    parseTime(key.validFrom, 'validFrom');
    if (key.validUntil !== null && key.validUntil !== undefined) parseTime(key.validUntil, 'validUntil');
  }
  return { valid: true, keyCount: registry.keys.length };
}

export function validateRevocationRegistry(registry) {
  if (!registry || typeof registry !== 'object') throw new Error('revocation registry must be an object');
  if (registry.schema !== CINESWARM_REVOCATION_REGISTRY_SCHEMA) throw new Error(`unsupported revocation registry schema: ${registry.schema}`);
  if (!Array.isArray(registry.entries)) throw new Error('revocation registry entries must be an array');
  const seen = new Set();
  for (const entry of registry.entries) {
    safeToken(entry.sealId, 'sealId');
    if (seen.has(entry.sealId)) throw new Error(`duplicate seal revocation ${entry.sealId}`);
    seen.add(entry.sealId);
    parseTime(entry.revokedAt, 'revokedAt');
    requiredString(entry.reason, 'revocation reason');
    if (entry.authority?.kind !== 'human') throw new Error('receipt revocation requires human authority');
    safeToken(entry.authority?.id, 'revocation authority.id');
    if (entry.simulated !== false) throw new Error('receipt revocation must be real, not simulated');
  }
  return { valid: true, entryCount: registry.entries.length };
}

function findSigningKey(registry, keyId) {
  validateSigningKeyRegistry(registry);
  const key = registry.keys.find((entry) => entry.keyId === keyId);
  if (!key) throw new Error(`signing key ${keyId} is not registered`);
  return key;
}

export function sealAuthorizationPayload(payload, {
  payloadType,
  payloadId,
  keyId,
  authorityId,
  privateKeyPem,
  signedAt,
  expiresAt,
}) {
  if (!PAYLOAD_TYPES.has(payloadType)) throw new Error('unsupported receipt-seal payloadType');
  safeToken(payloadId, 'payloadId');
  safeToken(keyId, 'keyId');
  safeToken(authorityId, 'authorityId');
  requiredString(privateKeyPem, 'privateKeyPem');
  if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('privateKeyPem is not an Ed25519 private key');
  const signed = parseTime(signedAt, 'signedAt');
  const expires = parseTime(expiresAt, 'expiresAt');
  if (expires.time <= signed.time) throw new Error('receipt seal expiresAt must be after signedAt');
  if (expires.time - signed.time > C1_6_MAX_SEAL_TTL_MS) throw new Error('receipt seal lifetime exceeds the C1.6 maximum');
  const payloadDigest = digestJson(payload);
  const message = sealMessage({ payloadType, payloadId, payloadDigest, keyId, authorityId, signedAt: signed.text, expiresAt: expires.text });
  const signature = cryptoSign(null, Buffer.from(message), privateKeyPem).toString('base64');
  return {
    schema: CINESWARM_RECEIPT_SEAL_SCHEMA,
    sealId: `${payloadId}_seal_${payloadDigest.slice(0, 16)}`,
    payloadType,
    payloadId,
    payloadDigest,
    algorithm: C1_6_SIGNATURE_ALGORITHM,
    keyId,
    authority: { kind: 'human', id: authorityId },
    signedAt: signed.text,
    expiresAt: expires.text,
    signatureBase64: signature,
    publicRelease: false,
  };
}

export function verifyReceiptSeal({ payload, seal, keyRegistry, revocationRegistry, now }) {
  if (!seal || typeof seal !== 'object') throw new Error('receipt seal must be an object');
  if (seal.schema !== CINESWARM_RECEIPT_SEAL_SCHEMA) throw new Error(`unsupported receipt seal schema: ${seal.schema}`);
  if (!PAYLOAD_TYPES.has(seal.payloadType)) throw new Error('unsupported receipt-seal payloadType');
  safeToken(seal.sealId, 'sealId');
  safeToken(seal.payloadId, 'payloadId');
  safeToken(seal.keyId, 'keyId');
  if (seal.algorithm !== C1_6_SIGNATURE_ALGORITHM) throw new Error(`receipt seal algorithm must be ${C1_6_SIGNATURE_ALGORITHM}`);
  if (seal.authority?.kind !== 'human') throw new Error('receipt seal authority must be human');
  safeToken(seal.authority?.id, 'authority.id');
  if (seal.publicRelease !== false) throw new Error('receipt seal must preserve publicRelease=false');
  if (!/^[a-f0-9]{64}$/.test(String(seal.payloadDigest || ''))) throw new Error('receipt seal payloadDigest is invalid');
  requiredString(seal.signatureBase64, 'signatureBase64');

  validateRevocationRegistry(revocationRegistry);
  const revocation = revocationRegistry.entries.find((entry) => entry.sealId === seal.sealId);
  if (revocation) throw new Error(`receipt seal ${seal.sealId} was revoked: ${revocation.reason}`);

  const key = findSigningKey(keyRegistry, seal.keyId);
  if (key.status !== 'active') throw new Error(`signing key ${seal.keyId} is not active`);
  if (key.authority.id !== seal.authority.id) throw new Error('receipt seal authority does not match signing key authority');

  const signed = parseTime(seal.signedAt, 'signedAt');
  const expires = parseTime(seal.expiresAt, 'expiresAt');
  const current = parseTime(now, 'now');
  const keyValidFrom = parseTime(key.validFrom, 'key.validFrom');
  const keyValidUntil = key.validUntil ? parseTime(key.validUntil, 'key.validUntil') : null;
  if (expires.time <= signed.time) throw new Error('receipt seal expiresAt must be after signedAt');
  if (expires.time - signed.time > C1_6_MAX_SEAL_TTL_MS) throw new Error('receipt seal lifetime exceeds the C1.6 maximum');
  if (current.time < signed.time) throw new Error('receipt seal is not valid before signedAt');
  if (current.time >= expires.time) throw new Error('receipt seal has expired');
  if (signed.time < keyValidFrom.time) throw new Error('receipt seal was signed before the key became valid');
  if (keyValidUntil && signed.time >= keyValidUntil.time) throw new Error('receipt seal was signed after the key validity window');

  const computedDigest = digestJson(payload);
  if (computedDigest !== seal.payloadDigest) throw new Error('receipt seal payload digest does not match the exact payload');
  const message = sealMessage({
    payloadType: seal.payloadType,
    payloadId: seal.payloadId,
    payloadDigest: seal.payloadDigest,
    keyId: seal.keyId,
    authorityId: seal.authority.id,
    signedAt: seal.signedAt,
    expiresAt: seal.expiresAt,
  });
  const signatureValid = cryptoVerify(null, Buffer.from(message), key.publicKeyPem, Buffer.from(seal.signatureBase64, 'base64'));
  if (!signatureValid) throw new Error('receipt seal signature verification failed');

  return {
    valid: true,
    sealId: seal.sealId,
    payloadDigest: seal.payloadDigest,
    authorityId: seal.authority.id,
    keyId: seal.keyId,
    expiresAt: seal.expiresAt,
  };
}

function requireAuthorizationExpiry(auth, seal, now) {
  const authExpires = parseTime(auth.expiresAt, 'authorization.expiresAt');
  const current = parseTime(now, 'now');
  const sealExpires = parseTime(seal.expiresAt, 'seal.expiresAt');
  if (current.time >= authExpires.time) throw new Error(`request authorization ${auth.authorizationId} has expired`);
  if (sealExpires.time > authExpires.time) throw new Error(`receipt seal ${seal.sealId} outlives request authorization ${auth.authorizationId}`);
}

export function buildExecutionEnvelope({
  packet,
  requests,
  authorizationBatch,
  founderDecision,
  founderSeal,
  authorizationSeals,
  keyRegistry,
  revocationRegistry,
  issuedAt,
  expiresAt,
  nonce = null,
}) {
  const current = parseTime(issuedAt, 'issuedAt');
  const envelopeExpiry = parseTime(expiresAt, 'expiresAt');
  if (envelopeExpiry.time <= current.time) throw new Error('execution envelope expiresAt must be after issuedAt');
  if (envelopeExpiry.time - current.time > C1_6_MAX_EXECUTION_ENVELOPE_TTL_MS) throw new Error('execution envelope lifetime exceeds the C1.6 maximum');

  validateProviderReadinessPacket(packet);
  if (founderDecision?.schema !== CINESWARM_PROVIDER_GO_NO_GO_SCHEMA) throw new Error('founder decision schema is invalid');
  const founderValidation = validateProviderGoNoGoDecision(founderDecision, packet);
  if (founderValidation.decision !== 'GO') throw new Error('execution envelope requires a founder GO decision');
  const authClassification = classifyRequestAuthorizationBatch({ packet, requests, authorizationBatch, founderDecision });
  if (!authClassification.executionEligible) throw new Error('execution envelope requires a fully execution-eligible request authorization batch');

  const founderSealResult = verifyReceiptSeal({ payload: founderDecision, seal: founderSeal, keyRegistry, revocationRegistry, now: issuedAt });
  if (founderSeal.payloadType !== 'founder-go-no-go' || founderSeal.payloadId !== founderDecision.decisionId) throw new Error('founder receipt seal does not bind the founder decision');

  if (!Array.isArray(authorizationSeals) || authorizationSeals.length !== authorizationBatch.records.length) {
    throw new Error('execution envelope requires exactly one seal per request authorization');
  }
  const sealResults = [];
  for (const auth of authorizationBatch.records) {
    if (auth.schema !== CINESWARM_REQUEST_AUTH_SCHEMA) throw new Error('authorization batch contains unsupported authorization schema');
    const seal = authorizationSeals.find((entry) => entry.payloadId === auth.authorizationId);
    if (!seal) throw new Error(`missing receipt seal for ${auth.authorizationId}`);
    if (seal.payloadType !== 'request-execution-authorization') throw new Error(`receipt seal for ${auth.authorizationId} has wrong payloadType`);
    const result = verifyReceiptSeal({ payload: auth, seal, keyRegistry, revocationRegistry, now: issuedAt });
    requireAuthorizationExpiry(auth, seal, issuedAt);
    sealResults.push(result);
  }

  const earliestSealExpiry = Math.min(
    Date.parse(founderSeal.expiresAt),
    ...authorizationSeals.map((seal) => Date.parse(seal.expiresAt)),
  );
  if (envelopeExpiry.time > earliestSealExpiry) throw new Error('execution envelope may not outlive its receipt seals');

  const requestDigests = Object.fromEntries(requests.map((request) => [request.requestId, digestJson(request)]));
  const executionNonce = nonce ? safeToken(nonce, 'nonce') : randomBytes(16).toString('hex');
  return {
    schema: CINESWARM_EXECUTION_ENVELOPE_SCHEMA,
    envelopeId: `${packet.sequenceId}_execution_${executionNonce.slice(0, 12)}`,
    packetId: packet.packetId,
    episodeId: packet.episodeId,
    sequenceId: packet.sequenceId,
    providerId: packet.providerId,
    modelSnapshot: packet.modelSnapshot,
    packetDigest: digestJson(packet),
    founderDecisionDigest: digestJson(founderDecision),
    authorizationBatchDigest: digestJson(authorizationBatch),
    requestDigests,
    sealIds: {
      founder: founderSealResult.sealId,
      requests: sealResults.map((result) => result.sealId),
    },
    issuedAt,
    expiresAt,
    nonce: executionNonce,
    singleUse: true,
    liveRunAuthorized: true,
    spendAuthorized: true,
    maxBatchSpendUsd: authClassification.totalMaxSpendUsd,
    publicRelease: false,
    humanAssetAcceptanceRequired: true,
    relayDependency: false,
  };
}

export function verifyExecutionEnvelope({
  envelope,
  packet,
  requests,
  authorizationBatch,
  founderDecision,
  founderSeal,
  authorizationSeals,
  keyRegistry,
  revocationRegistry,
  now,
}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('execution envelope must be an object');
  if (envelope.schema !== CINESWARM_EXECUTION_ENVELOPE_SCHEMA) throw new Error(`unsupported execution envelope schema: ${envelope.schema}`);
  safeToken(envelope.envelopeId, 'envelopeId');
  safeToken(envelope.nonce, 'nonce');
  if (envelope.singleUse !== true) throw new Error('execution envelope must be singleUse=true');
  if (envelope.publicRelease !== false) throw new Error('execution envelope must preserve publicRelease=false');
  if (envelope.humanAssetAcceptanceRequired !== true) throw new Error('execution envelope must preserve human asset acceptance');
  if (envelope.relayDependency !== false) throw new Error('execution envelope must preserve relayDependency=false');
  if (envelope.liveRunAuthorized !== true || envelope.spendAuthorized !== true) throw new Error('execution envelope must explicitly authorize live run and spend');

  const issued = parseTime(envelope.issuedAt, 'envelope.issuedAt');
  const expires = parseTime(envelope.expiresAt, 'envelope.expiresAt');
  const current = parseTime(now, 'now');
  if (expires.time <= issued.time) throw new Error('execution envelope expiresAt must be after issuedAt');
  if (expires.time - issued.time > C1_6_MAX_EXECUTION_ENVELOPE_TTL_MS) throw new Error('execution envelope lifetime exceeds the C1.6 maximum');
  if (current.time < issued.time) throw new Error('execution envelope is not valid before issuedAt');
  if (current.time >= expires.time) throw new Error('execution envelope has expired');

  if (envelope.packetId !== packet.packetId || envelope.episodeId !== packet.episodeId || envelope.sequenceId !== packet.sequenceId) throw new Error('execution envelope packet identity mismatch');
  if (envelope.providerId !== packet.providerId || envelope.modelSnapshot !== packet.modelSnapshot) throw new Error('execution envelope provider/model mismatch');
  if (envelope.packetDigest !== digestJson(packet)) throw new Error('execution envelope packetDigest mismatch');
  if (envelope.founderDecisionDigest !== digestJson(founderDecision)) throw new Error('execution envelope founderDecisionDigest mismatch');
  if (envelope.authorizationBatchDigest !== digestJson(authorizationBatch)) throw new Error('execution envelope authorizationBatchDigest mismatch');

  for (const request of requests) {
    if (envelope.requestDigests?.[request.requestId] !== digestJson(request)) throw new Error(`execution envelope request digest mismatch for ${request.requestId}`);
  }

  const rebuilt = buildExecutionEnvelope({
    packet,
    requests,
    authorizationBatch,
    founderDecision,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    nonce: envelope.nonce,
  });
  if (rebuilt.envelopeId !== envelope.envelopeId) throw new Error('execution envelope ID does not match reconstructed envelope');
  if (digestJson(rebuilt) !== digestJson(envelope)) throw new Error('execution envelope does not match the verified reconstructed envelope');

  return {
    valid: true,
    runnerMayExecute: true,
    envelopeId: envelope.envelopeId,
    expiresAt: envelope.expiresAt,
    maxBatchSpendUsd: envelope.maxBatchSpendUsd,
    publicRelease: false,
    relayDependency: false,
    note: 'Runner execution eligibility is single-use and short-lived. Asset acceptance and public release remain separate human gates.',
  };
}

export function classifyCurrentSealReadiness({ packet, founderDecision, authorizationBatch, keyRegistry, seals = [], revocationRegistry }) {
  validateProviderReadinessPacket(packet);
  validateSigningKeyRegistry(keyRegistry);
  validateRevocationRegistry(revocationRegistry);
  const blockers = [];
  if (founderDecision?.decision !== 'GO') blockers.push('Founder GO is not recorded.');
  const pending = authorizationBatch?.records?.filter((record) => record.decision !== 'AUTHORIZE') ?? [];
  if (pending.length) blockers.push(`${pending.length} request authorization record(s) are not AUTHORIZE.`);
  if (!keyRegistry.keys.some((key) => key.status === 'active')) blockers.push('No active human signing public key is registered.');
  const expectedSeals = 1 + (authorizationBatch?.records?.length ?? 0);
  if (seals.length !== expectedSeals) blockers.push(`Receipt seals incomplete: expected ${expectedSeals}, found ${seals.length}.`);
  if (revocationRegistry.entries.length) blockers.push('One or more seal revocations exist and must be evaluated before execution.');
  return {
    sealReady: blockers.length === 0,
    blockers,
    expectedSealCount: expectedSeals,
    presentSealCount: seals.length,
    publicRelease: false,
    relayDependency: false,
  };
}
