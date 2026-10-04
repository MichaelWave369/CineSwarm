import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyDeliveryForStudio,
  classifyProviderGoNoGo,
  summarizeProviderReadiness,
  toCineSwarmCreatePayload,
  totalShotDuration,
  validateDeliveryManifest,
  validateProductionJob,
  validateProviderGoNoGoDecision,
  validateProviderReadinessPacket,
} from '../src/index.js';

const jobs = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-sequence-jobs.json'), 'utf8'));
const readinessPacket = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-seq01-provider-readiness-packet.json'), 'utf8'));
const goNoGoDraft = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-seq01-provider-go-no-go-draft.json'), 'utf8'));

test('Pilot 001 is split into six valid Candidate C0 production jobs totaling 180 seconds', () => {
  assert.equal(jobs.length, 6);
  let total = 0;
  for (const job of jobs) {
    const result = validateProductionJob(job);
    assert.equal(result.valid, true);
    assert.equal(toCineSwarmCreatePayload(job).humanAuthorityId, 'michael-hughes');
    total += totalShotDuration(job.generation.shots);
  }
  assert.equal(total, 180);
});

test('bridge refuses to delegate public release or Relay dependency', () => {
  const badRelease = structuredClone(jobs[0]);
  badRelease.constraints.publicRelease = true;
  assert.throws(() => validateProductionJob(badRelease), /publicRelease=false/);
  const badRelay = structuredClone(jobs[0]);
  badRelay.constraints.relayDependency = true;
  assert.throws(() => validateProductionJob(badRelay), /must not depend on Parallax Relay/);
});

test('Candidate C0 delivery stays internal-only and requires real human disposition for Studio ingest', () => {
  const manifest = {
    schema: 'parallax.cineswarm.internal-delivery.v0.1', deliveryId: 'delivery_demo', masterHash: 'abc123', publicDestination: null,
    releaseState: 'Unavailable', files: [{ path: 'master.mp4', sha256: '0'.repeat(64), size: 12 }],
  };
  assert.equal(validateDeliveryManifest(manifest).valid, true);
  const eligible = classifyDeliveryForStudio({
    manifest,
    qcPacket: { status: 'Passed', data: { durationPass: true } },
    humanDisposition: { data: { disposition: 'Accept with conditions', authority: { kind: 'human' }, simulated: false, release: false } },
  });
  assert.equal(eligible.ingestEligible, true);
  const simulated = classifyDeliveryForStudio({
    manifest,
    qcPacket: { status: 'Passed', data: { durationPass: true } },
    humanDisposition: { data: { disposition: 'Accept with conditions', authority: { kind: 'human' }, simulated: true, release: false } },
  });
  assert.equal(simulated.ingestEligible, false);
});

test('provider readiness packet binds the first Cold Open run to exactly three requests and preserves the fail-closed blockers', () => {
  const validated = validateProviderReadinessPacket(readinessPacket);
  assert.equal(validated.valid, true);
  assert.equal(validated.readyForLiveRun, false);
  assert.equal(validated.requestIds.length, 3);
  assert.equal(validated.blockerCount, 5);
  assert.deepEqual(validated.unresolvedChecks, [
    'retentionPostureConfirmed',
    'currentPricingConfirmed',
    'externalCredentialProvisioned',
    'founderLiveRunDecisionRecorded',
    'requestAuthorizationsRecorded',
  ]);
  const summary = summarizeProviderReadiness(readinessPacket);
  assert.equal(summary.requestCeilingUsd, 0.06);
  assert.equal(summary.batchCeilingUsd, 0.18);
});

test('founder NO_GO draft is valid while blockers remain, but GO is rejected until the packet is truly ready', () => {
  assert.equal(validateProviderGoNoGoDecision(goNoGoDraft, readinessPacket).valid, true);
  const go = structuredClone(goNoGoDraft);
  go.decision = 'GO';
  go.liveRunAuthorized = true;
  go.spendAuthorized = true;
  go.reason = 'Trying to force a go early';
  assert.throws(() => validateProviderGoNoGoDecision(go, readinessPacket), /GO decision is not allowed while provider preflight blockers remain/);
});

test('provider go/no-go classification never turns readiness into release authority', () => {
  const classified = classifyProviderGoNoGo({ packet: readinessPacket, decision: goNoGoDraft });
  assert.equal(classified.goNoGoState, 'NO_GO');
  assert.equal(classified.readyForLiveRun, false);
  assert.equal(classified.liveRunAuthorized, false);
  assert.equal(classified.spendAuthorized, false);
  assert.match(classified.note, /public release remain separate gates/);
});
