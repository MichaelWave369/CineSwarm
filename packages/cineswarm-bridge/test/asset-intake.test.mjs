import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildProviderAttemptReceipt,
  buildQuarantineManifest,
  classifyQuarantinedAsset,
  validateAssetIntakePolicy,
  validateAssetReviewDecision,
  validateProviderAttemptReceipt,
  validateQuarantineManifest,
} from '../src/asset-intake.js';
import { claimExecutionEnvelope, finalizeExecutionClaim } from '../src/key-ceremony-journal.js';

const packet = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-seq01-provider-readiness-packet.json'), 'utf8'));
const requests = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-seq01-provider-requests.json'), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-c1-8-asset-intake-policy.json'), 'utf8'));
const baseJournal = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-c1-7-execution-journal.json'), 'utf8'));
const request = requests[0];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4X8AAAAASUVORK5CYII=', 'base64');

function claimedJournal() {
  const envelope = {
    schema: 'parallax.cineswarm.execution-envelope.c1.6.v0.1',
    envelopeId: 'env_c1_8_test_001',
    nonce: 'nonce_c1_8_test_001',
    issuedAt: '2026-08-13T06:00:00.000Z',
    expiresAt: '2026-08-13T06:10:00.000Z',
    maxBatchSpendUsd: 0.18,
    singleUse: true,
    publicRelease: false,
    relayDependency: false,
  };
  const verification = { valid: true, runnerMayExecute: true, envelopeId: envelope.envelopeId };
  return claimExecutionEnvelope({ journal: baseJournal, envelope, envelopeVerification: verification, now: '2026-08-13T06:01:00.000Z', executionId: 'exec_c1_8_test_001' });
}

function successfulReceipt(journal = claimedJournal()) {
  return buildProviderAttemptReceipt({
    journal,
    executionId: 'exec_c1_8_test_001',
    request,
    packet,
    providerResult: {
      status: 'SUCCEEDED',
      providerId: request.providerId,
      model: request.model,
      providerJobId: 'provider_job_demo_001',
      httpStatus: 200,
      costUsd: 0.041,
      mediaType: 'image/png',
      publicRelease: false,
      relayDependency: false,
    },
    artifactBytes: png,
    startedAt: '2026-08-13T06:01:05.000Z',
    completedAt: '2026-08-13T06:01:08.000Z',
  });
}

function succeededJournalAndReceipt() {
  const journal = claimedJournal();
  const receipt = successfulReceipt(journal);
  const finalized = finalizeExecutionClaim({
    journal,
    envelopeId: receipt.envelopeId,
    executionId: receipt.executionId,
    event: 'SUCCEEDED',
    recordedAt: '2026-08-13T06:01:09.000Z',
    providerReceiptHash: receipt.receiptHash,
    note: 'Synthetic provider attempt completed for C1.8 proof.',
  });
  return { journal: finalized, receipt };
}

test('C1.8 asset intake policy preserves human review and all downstream authority boundaries', () => {
  assert.equal(validateAssetIntakePolicy(policy).valid, true);
  assert.equal(policy.autoAccept, false);
  assert.equal(policy.pictureLockAuthority, false);
  assert.equal(policy.canonAuthority, false);
  assert.equal(policy.publicRelease, false);
  assert.equal(policy.relayDependency, false);
});

test('successful provider attempt receipt is self-hashed and bound to the exact request and execution claim', () => {
  const journal = claimedJournal();
  const receipt = successfulReceipt(journal);
  const validated = validateProviderAttemptReceipt(receipt, { journal, request, packet });
  assert.equal(validated.valid, true);
  assert.match(validated.receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(receipt.artifact.byteSize, png.length);
  assert.equal(receipt.responseBodyStored, false);
  assert.equal(receipt.secretsStored, false);
});

test('provider attempt receipt self-hash detects metadata tampering', () => {
  const receipt = successfulReceipt();
  const tampered = structuredClone(receipt);
  tampered.costUsd = 0.001;
  assert.throws(() => validateProviderAttemptReceipt(tampered), /self-hash mismatch/);
});

test('quarantine intake requires matching SUCCEEDED journal terminal receipt hash', () => {
  const activeJournal = claimedJournal();
  const receipt = successfulReceipt(activeJournal);
  assert.throws(() => buildQuarantineManifest({
    receipt,
    journal: activeJournal,
    request,
    packet,
    policy,
    artifactBytes: png,
    artifactPath: 'production/provider-quarantine/pn0001-seq01-cold-open/shot01.png',
  }), /matching SUCCEEDED journal terminal event/);

  const { journal, receipt: linkedReceipt } = succeededJournalAndReceipt();
  const manifest = buildQuarantineManifest({
    receipt: linkedReceipt,
    journal,
    request,
    packet,
    policy,
    artifactBytes: png,
    artifactPath: 'production/provider-quarantine/pn0001-seq01-cold-open/shot01.png',
  });
  assert.equal(validateQuarantineManifest(manifest, { receipt: linkedReceipt, policy }).valid, true);
  assert.equal(manifest.quarantineState, 'PENDING_HUMAN_REVIEW');
});

test('quarantine intake rejects byte tamper and path escape', () => {
  const { journal, receipt } = succeededJournalAndReceipt();
  const changed = Buffer.concat([png, Buffer.from([0])]);
  assert.throws(() => buildQuarantineManifest({ receipt, journal, request, packet, policy, artifactBytes: changed, artifactPath: 'production/provider-quarantine/pn0001-seq01-cold-open/shot01.png' }), /SHA-256|byteSize/);
  assert.throws(() => buildQuarantineManifest({ receipt, journal, request, packet, policy, artifactBytes: png, artifactPath: '../../escaped.png' }), /relative and traversal-free/);
});

test('failed provider attempts produce receipts but can never enter asset quarantine', () => {
  const journal = claimedJournal();
  const receipt = buildProviderAttemptReceipt({
    journal,
    executionId: 'exec_c1_8_test_001',
    request,
    packet,
    providerResult: {
      status: 'FAILED', providerId: request.providerId, model: request.model, providerJobId: null, httpStatus: 500, costUsd: 0,
      errorCode: 'UPSTREAM_ERROR', publicRelease: false, relayDependency: false,
    },
    artifactBytes: null,
    startedAt: '2026-08-13T06:01:05.000Z',
    completedAt: '2026-08-13T06:01:06.000Z',
  });
  const finalized = finalizeExecutionClaim({ journal, envelopeId: receipt.envelopeId, executionId: receipt.executionId, event: 'FAILED', recordedAt: '2026-08-13T06:01:07.000Z', providerReceiptHash: receipt.receiptHash });
  assert.equal(validateProviderAttemptReceipt(receipt, { journal: finalized, request, packet, requireTerminalLink: true }).valid, true);
  assert.throws(() => buildQuarantineManifest({ receipt, journal: finalized, request, packet, policy, artifactBytes: png, artifactPath: 'production/provider-quarantine/pn0001-seq01-cold-open/fail.png' }), /only SUCCEEDED provider attempts/);
});

test('real human ACCEPT promotes only to candidate pool and never Picture Lock, Canon, Ledger, or release', () => {
  const { journal, receipt } = succeededJournalAndReceipt();
  const manifest = buildQuarantineManifest({ receipt, journal, request, packet, policy, artifactBytes: png, artifactPath: 'production/provider-quarantine/pn0001-seq01-cold-open/shot01.png' });
  const decision = {
    schema: 'parallax.cineswarm.asset-review-decision.c1.8.v0.1',
    decisionId: 'review_c1_8_accept_001',
    quarantineId: manifest.quarantineId,
    artifactSha256: manifest.artifact.sha256,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'ACCEPT',
    reason: 'Synthetic proof asset accepted only into candidate pool.',
    recordedAt: '2026-08-13T06:02:00.000Z',
    pictureLockAuthorized: false,
    canonAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  assert.equal(validateAssetReviewDecision(decision, manifest).valid, true);
  const classified = classifyQuarantinedAsset({ manifest, decision });
  assert.equal(classified.candidatePoolEligible, true);
  assert.equal(classified.pictureLockEligible, false);
  assert.equal(classified.canonEligible, false);
  assert.equal(classified.ledgerPromotionEligible, false);
  assert.equal(classified.publicRelease, false);
});

test('simulated or hash-mismatched human review is rejected and pending intake never auto-promotes', () => {
  const { journal, receipt } = succeededJournalAndReceipt();
  const manifest = buildQuarantineManifest({ receipt, journal, request, packet, policy, artifactBytes: png, artifactPath: 'production/provider-quarantine/pn0001-seq01-cold-open/shot01.png' });
  const pending = classifyQuarantinedAsset({ manifest });
  assert.equal(pending.candidatePoolEligible, false);
  const simulated = {
    schema: 'parallax.cineswarm.asset-review-decision.c1.8.v0.1', decisionId: 'review_bad_001', quarantineId: manifest.quarantineId,
    artifactSha256: manifest.artifact.sha256, authority: { kind: 'human', id: 'michael-hughes' }, simulated: true, decision: 'ACCEPT',
    reason: 'Should fail.', recordedAt: '2026-08-13T06:02:00.000Z', pictureLockAuthorized: false, canonAuthorized: false, publicRelease: false, relayDependency: false,
  };
  assert.throws(() => validateAssetReviewDecision(simulated, manifest), /real, not simulated/);
  const wrongHash = { ...simulated, simulated: false, artifactSha256: '0'.repeat(64) };
  assert.throws(() => validateAssetReviewDecision(wrongHash, manifest), /artifactSha256 does not match/);
});
