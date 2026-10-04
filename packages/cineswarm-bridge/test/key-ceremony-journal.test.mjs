import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildExecutionEnvelope,
  sealAuthorizationPayload,
  verifyExecutionEnvelope,
} from '../src/authorization-seal.js';
import { buildRequestAuthorizationBatchDraft } from '../src/execution-authorization.js';
import {
  applyHumanKeyCeremony,
  assertExecutionEnvelopeUnused,
  buildKeyPossessionMessage,
  claimExecutionEnvelope,
  classifyExecutionJournal,
  classifyKeyCeremonyReadiness,
  finalizeExecutionClaim,
  publicKeyFingerprintSha256,
  validateExecutionJournal,
  validateHumanKeyCeremony,
  validateKeyCeremonyPlan,
  validateKeyCeremonyPolicy,
} from '../src/key-ceremony-journal.js';

const fixture = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const policy = fixture('pn-0001-c1-7-key-ceremony-policy.json');
const plan = fixture('pn-0001-c1-7-key-ceremony-plan.json');
const emptyRegistry = fixture('pn-0001-c1-6-signing-key-registry.json');
const emptyJournal = fixture('pn-0001-c1-7-execution-journal.json');
const revocations = fixture('pn-0001-c1-6-revocations.json');
const packet = fixture('pn-0001-seq01-provider-readiness-packet.json');
const requests = fixture('pn-0001-seq01-provider-requests.json');

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function makeCeremony({ action, key, keyId, previousKeyId = null, ceremonyId, recordedAt = '2026-08-12T23:20:00-07:00', recovery = null, reason = null }) {
  const authorityId = 'michael-hughes';
  const newKey = key ? {
    keyId,
    algorithm: 'Ed25519',
    publicKeyPem: key.publicKeyPem,
    fingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
    possessionProof: {
      challengeNonce: `${ceremonyId}-nonce`,
      signatureBase64: '',
    },
  } : null;
  if (newKey) {
    const message = buildKeyPossessionMessage({ ceremonyId, authorityId, keyId, publicKeyPem: key.publicKeyPem, challengeNonce: newKey.possessionProof.challengeNonce });
    newKey.possessionProof.signatureBase64 = cryptoSign(null, Buffer.from(message), key.privateKeyPem).toString('base64');
  }
  return {
    schema: 'parallax.cineswarm.human-key-ceremony.c1.7.v0.1',
    ceremonyId,
    action,
    authority: { kind: 'human', id: authorityId },
    simulated: false,
    recordedAt,
    previousKeyId,
    newKey,
    recovery,
    reason,
    acknowledgements: {
      privateKeyHeldExternally: true,
      privateKeyNotStoredInRepository: true,
      fingerprintVerifiedByHuman: true,
    },
    publicRelease: false,
    relayDependency: false,
  };
}

function readyPacket() {
  const ready = structuredClone(packet);
  ready.checklist.retentionPostureConfirmed = true;
  ready.checklist.currentPricingConfirmed = true;
  ready.checklist.externalCredentialProvisioned = true;
  ready.preflightBlockers = [];
  ready.blockers = [
    'Founder has not yet recorded a GO / NO_GO decision for this first provider-backed execution.',
    'Three request-specific live execution authorization records have not yet been created.',
  ];
  ready.status = 'preflight-ready-founder-decision-pending';
  return ready;
}

function founderGo(ready) {
  return {
    schema: 'parallax.cineswarm.provider-go-no-go.v0.1',
    decisionId: 'pn0001-seq01-founder-go-c1-7-test',
    packetId: ready.packetId,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'GO',
    liveRunAuthorized: true,
    spendAuthorized: true,
    reason: 'Synthetic C1.7 journal integration test only.',
    acknowledgedBlockers: [],
  };
}

function authorizedBatch(ready) {
  const batch = buildRequestAuthorizationBatchDraft(requests, ready);
  batch.records = batch.records.map((record, index) => ({
    ...record,
    authorizationId: `${requests[index].requestId}_authorization_c1_7_test`,
    decision: 'AUTHORIZE',
    liveGenerationAuthorized: true,
    spendAuthorized: true,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decidedAt: `2026-08-12T23:2${index}:00-07:00`,
    expiresAt: '2026-08-13T00:30:00-07:00',
  }));
  return batch;
}

test('C1.7 policy, pending human key plan, and empty execution journal validate without fabricating an identity', () => {
  assert.equal(validateKeyCeremonyPolicy(policy).valid, true);
  assert.equal(validateKeyCeremonyPlan(plan).status, 'PENDING_KEY_GENERATION');
  assert.equal(validateExecutionJournal(emptyJournal).entryCount, 0);
  const readiness = classifyKeyCeremonyReadiness({ plan, keyRegistry: emptyRegistry });
  assert.equal(readiness.keyReady, false);
  assert.equal(readiness.activeKeyCount, 0);
  assert.match(readiness.blockers.join(' '), /No active human signing public key/);
});

test('C1.7 ENROLL verifies Ed25519 proof of possession and derives a C1.6-compatible active public-key registry entry', () => {
  const key = makeKey();
  const ceremony = makeCeremony({ action: 'ENROLL', key, keyId: 'michael-c1-7-key-001', ceremonyId: 'c1-7-enroll-001' });
  const validated = validateHumanKeyCeremony(ceremony, { keyRegistry: emptyRegistry, policy, now: ceremony.recordedAt });
  assert.equal(validated.valid, true);
  assert.equal(validated.newKeyFingerprintSha256, publicKeyFingerprintSha256(key.publicKeyPem));
  const next = applyHumanKeyCeremony(ceremony, { keyRegistry: emptyRegistry, policy, now: ceremony.recordedAt });
  assert.equal(next.keys.length, 1);
  assert.equal(next.keys[0].status, 'active');
  assert.equal(next.keys[0].authority.id, 'michael-hughes');
  assert.equal('privateKeyPem' in next.keys[0], false);
});

test('C1.7 key enrollment rejects tampered possession proof or fingerprint', () => {
  const key = makeKey();
  const ceremony = makeCeremony({ action: 'ENROLL', key, keyId: 'michael-c1-7-key-002', ceremonyId: 'c1-7-enroll-002' });
  const badFingerprint = structuredClone(ceremony);
  badFingerprint.newKey.fingerprintSha256 = '0'.repeat(64);
  assert.throws(() => validateHumanKeyCeremony(badFingerprint, { keyRegistry: emptyRegistry, policy, now: ceremony.recordedAt }), /fingerprint does not match/);
  const badProof = structuredClone(ceremony);
  badProof.newKey.possessionProof.signatureBase64 = Buffer.alloc(64).toString('base64');
  assert.throws(() => validateHumanKeyCeremony(badProof, { keyRegistry: emptyRegistry, policy, now: ceremony.recordedAt }), /proof-of-possession signature is invalid/);
});

test('C1.7 ROTATE retires the previous key and activates a new proven key', () => {
  const firstKey = makeKey();
  const enroll = makeCeremony({ action: 'ENROLL', key: firstKey, keyId: 'michael-c1-7-rotate-old', ceremonyId: 'c1-7-rotate-enroll' });
  const enrolled = applyHumanKeyCeremony(enroll, { keyRegistry: emptyRegistry, policy, now: enroll.recordedAt });
  const secondKey = makeKey();
  const rotate = makeCeremony({ action: 'ROTATE', key: secondKey, keyId: 'michael-c1-7-rotate-new', previousKeyId: 'michael-c1-7-rotate-old', ceremonyId: 'c1-7-rotate-001', recordedAt: '2026-08-12T23:30:00-07:00' });
  const rotated = applyHumanKeyCeremony(rotate, { keyRegistry: enrolled, policy, now: rotate.recordedAt });
  assert.equal(rotated.keys.find((entry) => entry.keyId === 'michael-c1-7-rotate-old').status, 'retired');
  assert.equal(rotated.keys.find((entry) => entry.keyId === 'michael-c1-7-rotate-new').status, 'active');
});

test('C1.7 RECOVER revokes the previous key and requires multiple recovery evidence references', () => {
  const firstKey = makeKey();
  const enroll = makeCeremony({ action: 'ENROLL', key: firstKey, keyId: 'michael-c1-7-recovery-old', ceremonyId: 'c1-7-recovery-enroll' });
  const enrolled = applyHumanKeyCeremony(enroll, { keyRegistry: emptyRegistry, policy, now: enroll.recordedAt });
  const recoveryKey = makeKey();
  const recover = makeCeremony({
    action: 'RECOVER', key: recoveryKey, keyId: 'michael-c1-7-recovery-new', previousKeyId: 'michael-c1-7-recovery-old', ceremonyId: 'c1-7-recover-001', recordedAt: '2026-08-12T23:40:00-07:00',
    recovery: { reason: 'Synthetic lost-key recovery test', evidenceRefs: ['evidence-a', 'evidence-b'], riskAcknowledgedByHuman: true },
  });
  const recovered = applyHumanKeyCeremony(recover, { keyRegistry: enrolled, policy, now: recover.recordedAt });
  assert.equal(recovered.keys.find((entry) => entry.keyId === 'michael-c1-7-recovery-old').status, 'revoked');
  assert.equal(recovered.keys.find((entry) => entry.keyId === 'michael-c1-7-recovery-new').status, 'active');
  const weak = structuredClone(recover);
  weak.recovery.evidenceRefs = ['only-one'];
  assert.throws(() => validateHumanKeyCeremony(weak, { keyRegistry: enrolled, policy, now: recover.recordedAt }), /at least 2/);
});

test('C1.7 REVOKE removes active signing eligibility without inventing a replacement key', () => {
  const key = makeKey();
  const enroll = makeCeremony({ action: 'ENROLL', key, keyId: 'michael-c1-7-revoke-key', ceremonyId: 'c1-7-revoke-enroll' });
  const enrolled = applyHumanKeyCeremony(enroll, { keyRegistry: emptyRegistry, policy, now: enroll.recordedAt });
  const revoke = makeCeremony({ action: 'REVOKE', key: null, keyId: null, previousKeyId: 'michael-c1-7-revoke-key', ceremonyId: 'c1-7-revoke-001', recordedAt: '2026-08-12T23:45:00-07:00', reason: 'Synthetic compromise response test' });
  const revoked = applyHumanKeyCeremony(revoke, { keyRegistry: enrolled, policy, now: revoke.recordedAt });
  assert.equal(revoked.keys[0].status, 'revoked');
  assert.equal(revoked.keys.filter((entry) => entry.status === 'active').length, 0);
});

test('C1.7 journal claims a verified single-use envelope exactly once and blocks replay by ID/digest/nonce', () => {
  const envelope = {
    schema: 'parallax.cineswarm.execution-envelope.c1.6.v0.1',
    envelopeId: 'pn0001_test_execution_001',
    nonce: 'nonce-001',
    issuedAt: '2026-08-12T23:30:00-07:00',
    expiresAt: '2026-08-12T23:38:00-07:00',
    singleUse: true,
    liveRunAuthorized: true,
    spendAuthorized: true,
    maxBatchSpendUsd: 0.18,
    publicRelease: false,
    humanAssetAcceptanceRequired: true,
    relayDependency: false,
  };
  const verification = { valid: true, runnerMayExecute: true, envelopeId: envelope.envelopeId };
  const claimed = claimExecutionEnvelope({ journal: emptyJournal, envelope, envelopeVerification: verification, now: '2026-08-12T23:31:00-07:00', executionId: 'exec-c1-7-001' });
  assert.equal(validateExecutionJournal(claimed).claimCount, 1);
  assert.throws(() => assertExecutionEnvelopeUnused(claimed, envelope), /replay blocked/);
  assert.throws(() => claimExecutionEnvelope({ journal: claimed, envelope, envelopeVerification: verification, now: '2026-08-12T23:32:00-07:00', executionId: 'exec-c1-7-002' }), /replay blocked/);
});

test('C1.7 terminal execution events hash-chain after CLAIMED and a consumed envelope stays consumed after failure', () => {
  const envelope = {
    schema: 'parallax.cineswarm.execution-envelope.c1.6.v0.1', envelopeId: 'pn0001_test_execution_002', nonce: 'nonce-002', issuedAt: '2026-08-12T23:30:00-07:00', expiresAt: '2026-08-12T23:38:00-07:00', singleUse: true, liveRunAuthorized: true, spendAuthorized: true, maxBatchSpendUsd: 0.18, publicRelease: false, humanAssetAcceptanceRequired: true, relayDependency: false,
  };
  const verification = { valid: true, runnerMayExecute: true, envelopeId: envelope.envelopeId };
  const claimed = claimExecutionEnvelope({ journal: emptyJournal, envelope, envelopeVerification: verification, now: '2026-08-12T23:31:00-07:00', executionId: 'exec-c1-7-003' });
  const failed = finalizeExecutionClaim({ journal: claimed, envelopeId: envelope.envelopeId, executionId: 'exec-c1-7-003', event: 'FAILED', recordedAt: '2026-08-12T23:32:00-07:00', note: 'Synthetic provider failure' });
  const classified = classifyExecutionJournal(failed);
  assert.equal(classified.claimedEnvelopeCount, 1);
  assert.equal(classified.terminalEventCount, 1);
  assert.equal(classified.activeExecutionCount, 0);
  assert.throws(() => assertExecutionEnvelopeUnused(failed, envelope), /replay blocked/);
  assert.throws(() => finalizeExecutionClaim({ journal: failed, envelopeId: envelope.envelopeId, executionId: 'exec-c1-7-003', event: 'ABORTED', recordedAt: '2026-08-12T23:33:00-07:00' }), /already has a terminal/);
});

test('C1.7 journal hash chain detects retroactive entry tampering', () => {
  const envelope = {
    schema: 'parallax.cineswarm.execution-envelope.c1.6.v0.1', envelopeId: 'pn0001_test_execution_003', nonce: 'nonce-003', issuedAt: '2026-08-12T23:30:00-07:00', expiresAt: '2026-08-12T23:38:00-07:00', singleUse: true, liveRunAuthorized: true, spendAuthorized: true, maxBatchSpendUsd: 0.18, publicRelease: false, humanAssetAcceptanceRequired: true, relayDependency: false,
  };
  const verification = { valid: true, runnerMayExecute: true, envelopeId: envelope.envelopeId };
  const claimed = claimExecutionEnvelope({ journal: emptyJournal, envelope, envelopeVerification: verification, now: '2026-08-12T23:31:00-07:00', executionId: 'exec-c1-7-004' });
  const tampered = structuredClone(claimed);
  tampered.entries[0].maxBatchSpendUsd = 0.19;
  assert.throws(() => validateExecutionJournal(tampered), /entry hash mismatch/);
});

test('C1.7 integrates with a fully verified C1.6 envelope, then journal claim becomes the replay-protection handoff', () => {
  const key = makeKey();
  const enroll = makeCeremony({ action: 'ENROLL', key, keyId: 'michael-c1-7-envelope-key', ceremonyId: 'c1-7-envelope-enroll', recordedAt: '2026-08-12T23:10:00-07:00' });
  const keyRegistry = applyHumanKeyCeremony(enroll, { keyRegistry: emptyRegistry, policy, now: enroll.recordedAt });
  const ready = readyPacket();
  const go = founderGo(ready);
  const batch = authorizedBatch(ready);
  const sealPayload = (payload, payloadType, payloadId) => sealAuthorizationPayload(payload, {
    payloadType, payloadId, keyId: 'michael-c1-7-envelope-key', authorityId: 'michael-hughes', privateKeyPem: key.privateKeyPem, signedAt: '2026-08-12T23:30:00-07:00', expiresAt: '2026-08-13T00:00:00-07:00',
  });
  const founderSeal = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const authorizationSeals = batch.records.map((auth) => sealPayload(auth, 'request-execution-authorization', auth.authorizationId));
  const envelope = buildExecutionEnvelope({ packet: ready, requests, authorizationBatch: batch, founderDecision: go, founderSeal, authorizationSeals, keyRegistry, revocationRegistry: revocations, issuedAt: '2026-08-12T23:35:00-07:00', expiresAt: '2026-08-12T23:43:00-07:00', nonce: 'c1-7-integrated-nonce-001' });
  const verification = verifyExecutionEnvelope({ envelope, packet: ready, requests, authorizationBatch: batch, founderDecision: go, founderSeal, authorizationSeals, keyRegistry, revocationRegistry: revocations, now: '2026-08-12T23:36:00-07:00' });
  assert.equal(verification.runnerMayExecute, true);
  const journal = claimExecutionEnvelope({ journal: emptyJournal, envelope, envelopeVerification: verification, now: '2026-08-12T23:36:00-07:00', executionId: 'exec-c1-7-integrated-001' });
  assert.equal(classifyExecutionJournal(journal).claimedEnvelopeCount, 1);
  assert.equal(journal.entries[0].publicRelease, false);
  assert.equal(journal.entries[0].relayDependency, false);
});
