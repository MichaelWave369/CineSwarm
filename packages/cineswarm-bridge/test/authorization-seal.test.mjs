import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRequestAuthorizationBatchDraft } from '../src/execution-authorization.js';
import {
  buildExecutionEnvelope,
  classifyCurrentSealReadiness,
  digestJson,
  sealAuthorizationPayload,
  validateRevocationRegistry,
  validateSigningKeyRegistry,
  validateSigningPolicy,
  verifyExecutionEnvelope,
  verifyReceiptSeal,
} from '../src/authorization-seal.js';

const fixture = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const packet = fixture('pn-0001-seq01-provider-readiness-packet.json');
const requests = fixture('pn-0001-seq01-provider-requests.json');
const drafts = fixture('pn-0001-seq01-request-authorization-drafts.json');
const noGo = fixture('pn-0001-seq01-provider-go-no-go-draft.json');
const signingPolicy = fixture('pn-0001-c1-6-signing-policy.json');
const emptyKeyRegistry = fixture('pn-0001-c1-6-signing-key-registry.json');
const emptyRevocations = fixture('pn-0001-c1-6-revocations.json');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keyRegistry = {
  schema: 'parallax.cineswarm.signing-key-registry.c1.6.v0.1',
  keys: [{
    keyId: 'michael-cineswarm-ed25519-test-001',
    algorithm: 'Ed25519',
    status: 'active',
    authority: { kind: 'human', id: 'michael-hughes' },
    publicKeyPem,
    validFrom: '2026-08-12T22:00:00-07:00',
    validUntil: '2026-08-14T00:00:00-07:00',
  }],
};

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
    decisionId: 'pn0001-seq01-founder-go-c1-6-test',
    packetId: ready.packetId,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'GO',
    liveRunAuthorized: true,
    spendAuthorized: true,
    reason: 'Synthetic C1.6 cryptographic happy-path test only.',
    acknowledgedBlockers: [],
  };
}

function authorizedBatch(ready) {
  const batch = buildRequestAuthorizationBatchDraft(requests, ready);
  batch.records = batch.records.map((record, index) => ({
    ...record,
    authorizationId: `${requests[index].requestId}_authorization_c1_6_test`,
    decision: 'AUTHORIZE',
    liveGenerationAuthorized: true,
    spendAuthorized: true,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decidedAt: `2026-08-12T23:0${index}:00-07:00`,
    expiresAt: '2026-08-13T00:30:00-07:00',
  }));
  return batch;
}

function sealPayload(payload, payloadType, payloadId, signedAt = '2026-08-12T23:10:00-07:00', expiresAt = '2026-08-13T00:10:00-07:00') {
  return sealAuthorizationPayload(payload, {
    payloadType,
    payloadId,
    keyId: 'michael-cineswarm-ed25519-test-001',
    authorityId: 'michael-hughes',
    privateKeyPem,
    signedAt,
    expiresAt,
  });
}

test('C1.6 signing policy and current empty public-key/revocation registries validate without fabricating a human key', () => {
  assert.equal(validateSigningPolicy(signingPolicy).valid, true);
  assert.equal(validateSigningKeyRegistry(emptyKeyRegistry).keyCount, 0);
  assert.equal(validateRevocationRegistry(emptyRevocations).entryCount, 0);
});

test('C1.6 Ed25519 receipt seal verifies the exact payload and rejects tampering', () => {
  const ready = readyPacket();
  const go = founderGo(ready);
  const seal = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const verified = verifyReceiptSeal({ payload: go, seal, keyRegistry, revocationRegistry: emptyRevocations, now: '2026-08-12T23:20:00-07:00' });
  assert.equal(verified.valid, true);
  assert.equal(verified.payloadDigest, digestJson(go));
  const tampered = structuredClone(go);
  tampered.reason = 'Changed after signing';
  assert.throws(() => verifyReceiptSeal({ payload: tampered, seal, keyRegistry, revocationRegistry: emptyRevocations, now: '2026-08-12T23:20:00-07:00' }), /payload digest does not match/);
});

test('C1.6 expired or revoked receipt seals fail verification', () => {
  const ready = readyPacket();
  const go = founderGo(ready);
  const seal = sealPayload(go, 'founder-go-no-go', go.decisionId, '2026-08-12T22:00:00-07:00', '2026-08-12T23:00:00-07:00');
  assert.throws(() => verifyReceiptSeal({ payload: go, seal, keyRegistry, revocationRegistry: emptyRevocations, now: '2026-08-12T23:30:00-07:00' }), /has expired/);

  const fresh = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const revoked = {
    schema: 'parallax.cineswarm.revocation-registry.c1.6.v0.1',
    entries: [{
      sealId: fresh.sealId,
      revokedAt: '2026-08-12T23:15:00-07:00',
      reason: 'Synthetic revocation test',
      authority: { kind: 'human', id: 'michael-hughes' },
      simulated: false,
    }],
  };
  assert.throws(() => verifyReceiptSeal({ payload: go, seal: fresh, keyRegistry, revocationRegistry: revoked, now: '2026-08-12T23:20:00-07:00' }), /was revoked/);
});

test('C1.6 inactive signing keys cannot validate executable receipts', () => {
  const ready = readyPacket();
  const go = founderGo(ready);
  const seal = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const inactive = structuredClone(keyRegistry);
  inactive.keys[0].status = 'retired';
  assert.throws(() => verifyReceiptSeal({ payload: go, seal, keyRegistry: inactive, revocationRegistry: emptyRevocations, now: '2026-08-12T23:20:00-07:00' }), /is not active/);
});

test('C1.6 happy path builds and verifies a ten-minute-or-less single-use execution envelope from four valid human receipt seals', () => {
  const ready = readyPacket();
  const go = founderGo(ready);
  const batch = authorizedBatch(ready);
  const founderSeal = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const authorizationSeals = batch.records.map((auth) => sealPayload(auth, 'request-execution-authorization', auth.authorizationId));

  const envelope = buildExecutionEnvelope({
    packet: ready,
    requests,
    authorizationBatch: batch,
    founderDecision: go,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry: emptyRevocations,
    issuedAt: '2026-08-12T23:30:00-07:00',
    expiresAt: '2026-08-12T23:38:00-07:00',
    nonce: 'c1-6-test-nonce-001',
  });
  assert.equal(envelope.singleUse, true);
  assert.equal(envelope.publicRelease, false);
  assert.equal(envelope.relayDependency, false);
  assert.equal(envelope.maxBatchSpendUsd, 0.18);

  const verified = verifyExecutionEnvelope({
    envelope,
    packet: ready,
    requests,
    authorizationBatch: batch,
    founderDecision: go,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry: emptyRevocations,
    now: '2026-08-12T23:31:00-07:00',
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.runnerMayExecute, true);
  assert.equal(verified.publicRelease, false);
});

test('C1.6 execution envelope fails if a signed request authorization payload changes or a seal is revoked', () => {
  const ready = readyPacket();
  const go = founderGo(ready);
  const batch = authorizedBatch(ready);
  const founderSeal = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const authorizationSeals = batch.records.map((auth) => sealPayload(auth, 'request-execution-authorization', auth.authorizationId));
  const envelope = buildExecutionEnvelope({
    packet: ready,
    requests,
    authorizationBatch: batch,
    founderDecision: go,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry: emptyRevocations,
    issuedAt: '2026-08-12T23:30:00-07:00',
    expiresAt: '2026-08-12T23:38:00-07:00',
    nonce: 'c1-6-test-nonce-002',
  });

  const tamperedBatch = structuredClone(batch);
  tamperedBatch.records[0].maxSpendUsd = 0.05;
  assert.throws(() => verifyExecutionEnvelope({
    envelope,
    packet: ready,
    requests,
    authorizationBatch: tamperedBatch,
    founderDecision: go,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry: emptyRevocations,
    now: '2026-08-12T23:31:00-07:00',
  }), /authorizationBatchDigest mismatch/);

  const revoked = {
    schema: 'parallax.cineswarm.revocation-registry.c1.6.v0.1',
    entries: [{
      sealId: authorizationSeals[1].sealId,
      revokedAt: '2026-08-12T23:30:30-07:00',
      reason: 'Synthetic revoke after envelope creation',
      authority: { kind: 'human', id: 'michael-hughes' },
      simulated: false,
    }],
  };
  assert.throws(() => verifyExecutionEnvelope({
    envelope,
    packet: ready,
    requests,
    authorizationBatch: batch,
    founderDecision: go,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry: revoked,
    now: '2026-08-12T23:31:00-07:00',
  }), /was revoked/);
});

test('C1.6 execution envelope cannot exceed ten minutes or outlive request authorization/seal expiry', () => {
  const ready = readyPacket();
  const go = founderGo(ready);
  const batch = authorizedBatch(ready);
  const founderSeal = sealPayload(go, 'founder-go-no-go', go.decisionId);
  const authorizationSeals = batch.records.map((auth) => sealPayload(auth, 'request-execution-authorization', auth.authorizationId));
  assert.throws(() => buildExecutionEnvelope({
    packet: ready,
    requests,
    authorizationBatch: batch,
    founderDecision: go,
    founderSeal,
    authorizationSeals,
    keyRegistry,
    revocationRegistry: emptyRevocations,
    issuedAt: '2026-08-12T23:30:00-07:00',
    expiresAt: '2026-08-12T23:41:00-07:00',
    nonce: 'c1-6-test-nonce-003',
  }), /lifetime exceeds the C1.6 maximum/);
});

test('C1.6 current canonical state remains unsealed and non-executable', () => {
  const status = classifyCurrentSealReadiness({
    packet,
    founderDecision: noGo,
    authorizationBatch: drafts,
    keyRegistry: emptyKeyRegistry,
    seals: [],
    revocationRegistry: emptyRevocations,
  });
  assert.equal(status.sealReady, false);
  assert.equal(status.expectedSealCount, 4);
  assert.equal(status.presentSealCount, 0);
  assert.ok(status.blockers.some((item) => item.includes('Founder GO')));
  assert.ok(status.blockers.some((item) => item.includes('not AUTHORIZE')));
  assert.ok(status.blockers.some((item) => item.includes('No active human signing public key')));
  assert.equal(status.publicRelease, false);
  assert.equal(status.relayDependency, false);
});
