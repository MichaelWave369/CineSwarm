import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateProviderGoNoGoDecision } from '../src/index.js';
import {
  buildRequestAuthorizationBatchDraft,
  classifyRequestAuthorizationBatch,
  digestProviderRequest,
  validateProviderRequestForAuthorization,
  validateRequestExecutionAuthorization,
} from '../src/execution-authorization.js';

const fixture = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const packet = fixture('pn-0001-seq01-provider-readiness-packet.json');
const requests = fixture('pn-0001-seq01-provider-requests.json');
const drafts = fixture('pn-0001-seq01-request-authorization-drafts.json');
const noGo = fixture('pn-0001-seq01-provider-go-no-go-draft.json');

function readyPreflightPacket() {
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

function founderGo(readyPacket) {
  return {
    schema: 'parallax.cineswarm.provider-go-no-go.v0.1',
    decisionId: 'pn0001-seq01-founder-go-test',
    packetId: readyPacket.packetId,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'GO',
    liveRunAuthorized: true,
    spendAuthorized: true,
    reason: 'Synthetic happy-path test after provider preflight is fully ready.',
    acknowledgedBlockers: [],
  };
}

test('C1.5 binds three canonical provider requests to the readiness packet and exact SHA-256 payload digests', () => {
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.requestId), packet.requestIds);
  for (const request of requests) {
    const validated = validateProviderRequestForAuthorization(request, packet);
    assert.equal(validated.valid, true);
    assert.match(validated.requestDigest, /^[a-f0-9]{64}$/);
    assert.equal(validated.requestDigest, digestProviderRequest(request));
    assert.equal(validated.maxCostUsd, 0.06);
  }
});

test('C1.5 draft generator creates only three PENDING non-authorizing records within the $0.18 batch ceiling', () => {
  const generated = buildRequestAuthorizationBatchDraft(requests, packet);
  assert.deepEqual(generated, drafts);
  assert.equal(generated.records.length, 3);
  assert.equal(generated.totalMaxSpendUsd, 0.18);
  assert.equal(generated.publicRelease, false);
  assert.equal(generated.relayDependency, false);
  for (const record of generated.records) {
    assert.equal(record.decision, 'PENDING');
    assert.equal(record.liveGenerationAuthorized, false);
    assert.equal(record.spendAuthorized, false);
    assert.equal(record.authority, null);
    assert.equal(record.decidedAt, null);
  }
});

test('C1.5 request tampering invalidates an existing authorization digest', () => {
  const tampered = structuredClone(requests[0]);
  tampered.prompt += ' altered after authorization';
  assert.throws(
    () => validateRequestExecutionAuthorization(drafts.records[0], tampered, packet, noGo),
    /digest does not match the exact provider request payload/,
  );
});

test('C1.5 cannot authorize a request while provider preflight is blocked or founder decision is not GO', () => {
  const record = structuredClone(drafts.records[0]);
  record.decision = 'AUTHORIZE';
  record.liveGenerationAuthorized = true;
  record.spendAuthorized = true;
  record.authority = { kind: 'human', id: 'michael-hughes' };
  record.simulated = false;
  record.decidedAt = '2026-08-12T23:00:00-07:00';
  assert.throws(
    () => validateRequestExecutionAuthorization(record, requests[0], packet, noGo),
    /provider preflight blockers remain/,
  );

  const readyPacket = readyPreflightPacket();
  assert.throws(
    () => validateRequestExecutionAuthorization(record, requests[0], readyPacket, noGo),
    /valid founder GO/,
  );
});

test('C1.5 happy path is one-way: ready preflight -> founder GO -> three request AUTHORIZE records -> execution eligible', () => {
  const readyPacket = readyPreflightPacket();
  const go = founderGo(readyPacket);
  assert.equal(validateProviderGoNoGoDecision(go, readyPacket).valid, true);

  const authorizedBatch = buildRequestAuthorizationBatchDraft(requests, readyPacket);
  authorizedBatch.records = authorizedBatch.records.map((record, index) => ({
    ...record,
    authorizationId: `${requests[index].requestId}_authorization_test`,
    decision: 'AUTHORIZE',
    liveGenerationAuthorized: true,
    spendAuthorized: true,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decidedAt: `2026-08-12T23:0${index}:00-07:00`,
  }));

  const classified = classifyRequestAuthorizationBatch({
    packet: readyPacket,
    requests,
    authorizationBatch: authorizedBatch,
    founderDecision: go,
  });
  assert.equal(classified.executionEligible, true);
  assert.equal(classified.founderGo, true);
  assert.equal(classified.allAuthorized, true);
  assert.deepEqual(classified.authorizationStates, ['AUTHORIZE', 'AUTHORIZE', 'AUTHORIZE']);
  assert.equal(classified.totalMaxSpendUsd, 0.18);
  assert.equal(classified.publicRelease, false);
  assert.equal(classified.relayDependency, false);
  assert.deepEqual(classified.completionProjection, {
    founderLiveRunDecisionRecorded: true,
    requestAuthorizationsRecorded: true,
  });
});

test('C1.5 current canonical drafts remain execution-ineligible and preserve later human asset/release gates', () => {
  const classified = classifyRequestAuthorizationBatch({
    packet,
    requests,
    authorizationBatch: drafts,
    founderDecision: noGo,
  });
  assert.equal(classified.executionEligible, false);
  assert.equal(classified.allAuthorized, false);
  assert.deepEqual(classified.authorizationStates, ['PENDING', 'PENDING', 'PENDING']);
  assert.equal(classified.publicRelease, false);
  assert.match(classified.note, /Generated assets still require human acceptance/);
});
