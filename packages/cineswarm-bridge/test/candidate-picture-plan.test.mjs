import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestProviderRequest } from '../src/execution-authorization.js';
import {
  appendCandidateAssetToRegistry,
  buildCandidateAssetEntry,
  buildCandidateAssetRegistry,
  buildPicturePlanCandidate,
  classifyPicturePlan,
  validateCandidateAssetEntry,
  validateCandidateAssetRegistry,
  validateCandidateRegistryPolicy,
  validatePicturePlanCandidate,
  validatePicturePlanReview,
} from '../src/candidate-picture-plan.js';

const policy = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-c1-9-candidate-registry-policy.json'), 'utf8'));
const requests = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-seq01-provider-requests.json'), 'utf8'));
const jobs = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-sequence-jobs.json'), 'utf8'));
const sequenceJob = jobs.find((job) => job.network.sequenceId === policy.sequenceId);

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function acceptedInput(shotIndex, { continuityVersion = 'pn0001_seq01_visual_world_v1', decision = 'ACCEPT' } = {}) {
  const request = structuredClone(requests[shotIndex - 1]);
  const artifactSha256 = hash(`c1.9-proof-artifact-${shotIndex}`);
  const manifest = {
    schema: 'parallax.cineswarm.asset-quarantine-manifest.c1.8.v0.1',
    quarantineId: `${request.requestId}_quarantine`,
    intakePolicyId: 'pn0001-seq01-provider-asset-intake',
    receiptId: `${request.requestId}_attempt_receipt`,
    receiptHash: hash(`receipt-${shotIndex}`),
    executionId: `exec_c1_9_shot_${shotIndex}`,
    envelopeId: `env_c1_9_shot_${shotIndex}`,
    episodeId: request.episodeId,
    sequenceId: request.sequenceId,
    requestId: request.requestId,
    requestDigest: digestProviderRequest(request),
    artifact: {
      path: `production/provider-quarantine/${request.sequenceId}/${request.requestId}.png`,
      fileName: `${request.requestId}.png`,
      mediaType: 'image/png',
      sha256: artifactSha256,
      byteSize: 1024 + shotIndex,
      width: 1536,
      height: 1024,
    },
    qc: {
      hashVerified: true,
      byteSizeVerified: true,
      mediaSignatureVerified: true,
      decodableHeader: true,
    },
    quarantineState: 'PENDING_HUMAN_REVIEW',
    humanReviewRequired: true,
    autoAccepted: false,
    candidatePoolEligible: false,
    pictureLockEligible: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  const reviewDecision = {
    schema: 'parallax.cineswarm.asset-review-decision.c1.8.v0.1',
    decisionId: `${request.requestId}_human_review`,
    quarantineId: manifest.quarantineId,
    artifactSha256,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision,
    reason: decision === 'ACCEPT' ? 'Proof-only accepted candidate for C1.9 contract verification.' : 'Proof-only non-accept decision.',
    recordedAt: `2026-08-13T07:0${shotIndex}:00.000Z`,
    publicRelease: false,
    pictureLockAuthorized: false,
    canonAuthorized: false,
    relayDependency: false,
  };
  return { request, manifest, reviewDecision, continuityVersion };
}

function candidate(shotIndex, options = {}) {
  const input = acceptedInput(shotIndex, options);
  return buildCandidateAssetEntry({
    ...input,
    sequenceJob,
    policy,
    registeredAt: `2026-08-13T07:1${shotIndex}:00.000Z`,
  });
}

function registryWithThree({ continuityVersions = ['pn0001_seq01_visual_world_v1', 'pn0001_seq01_visual_world_v1', 'pn0001_seq01_visual_world_v1'] } = {}) {
  let registry = buildCandidateAssetRegistry({ policy, entries: [], revision: 0, previousRegistryHash: null, recordedAt: '2026-08-13T07:20:00.000Z' });
  const entries = continuityVersions.map((continuityVersion, index) => candidate(index + 1, { continuityVersion }));
  for (const [index, entry] of entries.entries()) {
    registry = appendCandidateAssetToRegistry({ registry, entry, policy, recordedAt: `2026-08-13T07:2${index + 1}:00.000Z` });
  }
  return { registry, entries };
}

function completePlan() {
  const { registry, entries } = registryWithThree();
  const plan = buildPicturePlanCandidate({
    policy,
    registry,
    sequenceJob,
    requests,
    selections: entries.map((entry) => entry.candidateAssetId),
    createdAt: '2026-08-13T07:30:00.000Z',
  });
  return { registry, entries, plan };
}

test('C1.9 registry policy requires accepted assets, exact lineage, human review, and preserves all later authority boundaries', () => {
  assert.equal(validateCandidateRegistryPolicy(policy).valid, true);
  assert.equal(policy.requireAcceptedC1_8Asset, true);
  assert.equal(policy.requireExactRequestDigest, true);
  assert.equal(policy.requireExactSequenceJobDigest, true);
  assert.equal(policy.requireHumanPicturePlanReview, true);
  assert.equal(policy.autoPictureLock, false);
  assert.equal(policy.pictureLockAuthority, false);
  assert.equal(policy.canonAuthority, false);
  assert.equal(policy.publicRelease, false);
  assert.equal(policy.relayDependency, false);
});

test('C1.9 admits only real-human ACCEPTED C1.8 assets into the candidate registry layer', () => {
  const entry = candidate(1);
  assert.equal(validateCandidateAssetEntry(entry, { policy, request: requests[0], sequenceJob }).valid, true);
  assert.equal(entry.candidatePoolEligible, true);
  assert.equal(entry.pictureLockEligible, false);
  const held = acceptedInput(1, { decision: 'HOLD' });
  assert.throws(() => buildCandidateAssetEntry({ ...held, sequenceJob, policy, registeredAt: '2026-08-13T07:10:00.000Z' }), /only a human-accepted C1.8 asset/);
});

test('C1.9 candidate entries are self-hashed and exact request/sequence drift invalidates them', () => {
  const input = acceptedInput(1);
  const entry = buildCandidateAssetEntry({ ...input, sequenceJob, policy, registeredAt: '2026-08-13T07:11:00.000Z' });
  const tampered = structuredClone(entry);
  tampered.artifact.byteSize += 1;
  assert.throws(() => validateCandidateAssetEntry(tampered), /self-hash mismatch/);
  const driftedRequest = structuredClone(input.request);
  driftedRequest.prompt += ' drift';
  assert.throws(() => validateCandidateAssetEntry(entry, { request: driftedRequest }), /request digest drift detected/);
  const driftedJob = structuredClone(sequenceJob);
  driftedJob.generation.shots[0].durationSeconds += 1;
  assert.throws(() => validateCandidateAssetEntry(entry, { sequenceJob: driftedJob }), /sequence job digest drift detected/);
});

test('C1.9 candidate registry revisions hash-chain accepted assets and reject duplicate artifact registration', () => {
  const empty = buildCandidateAssetRegistry({ policy, entries: [], revision: 0, previousRegistryHash: null, recordedAt: '2026-08-13T07:20:00.000Z' });
  assert.equal(validateCandidateAssetRegistry(empty, { policy }).valid, true);
  const entry = candidate(1);
  const revision1 = appendCandidateAssetToRegistry({ registry: empty, entry, policy, recordedAt: '2026-08-13T07:21:00.000Z' });
  assert.equal(revision1.revision, 1);
  assert.equal(revision1.previousRegistryHash, empty.registryHash);
  assert.equal(revision1.entryCount, 1);
  assert.throws(() => appendCandidateAssetToRegistry({ registry: revision1, entry, policy, recordedAt: '2026-08-13T07:22:00.000Z' }), /duplicate candidateAssetId|duplicate artifact/);
});

test('C1.9 assembles exactly one accepted candidate per governed shot into a self-hashed Picture Plan Candidate', () => {
  const { registry, entries, plan } = completePlan();
  assert.equal(validatePicturePlanCandidate(plan, { policy, registry, sequenceJob, requests }).valid, true);
  assert.equal(plan.shotCount, 3);
  assert.equal(plan.totalDurationSeconds, 20);
  assert.deepEqual(plan.shotSelections.map((shot) => shot.shotIndex), [1, 2, 3]);
  assert.deepEqual(plan.shotSelections.map((shot) => shot.candidateAssetId), entries.map((entry) => entry.candidateAssetId));
  assert.equal(plan.pictureLockCeremonyEligible, false);
  assert.equal(plan.pictureLocked, false);
  assert.equal(plan.publicRelease, false);
});

test('C1.9 refuses Picture Plan assembly when metadata continuity versions drift across selected shots', () => {
  const { registry, entries } = registryWithThree({ continuityVersions: ['pn0001_seq01_visual_world_v1', 'pn0001_seq01_visual_world_v2', 'pn0001_seq01_visual_world_v1'] });
  assert.throws(() => buildPicturePlanCandidate({
    policy,
    registry,
    sequenceJob,
    requests,
    selections: entries.map((entry) => entry.candidateAssetId),
    createdAt: '2026-08-13T07:30:00.000Z',
  }), /continuity\/version drift detected/);
});

test('C1.9 detects provider request version drift after a Picture Plan Candidate has been assembled', () => {
  const { registry, plan } = completePlan();
  const driftedRequests = structuredClone(requests);
  driftedRequests[1].prompt += ' post-plan drift';
  assert.throws(() => validatePicturePlanCandidate(plan, { policy, registry, sequenceJob, requests: driftedRequests }), /request\/version drift detected/);
});

test('C1.9 detects production job version drift after a Picture Plan Candidate has been assembled', () => {
  const { registry, plan } = completePlan();
  const driftedJob = structuredClone(sequenceJob);
  driftedJob.generation.shots[2].durationSeconds += 2;
  assert.throws(() => validatePicturePlanCandidate(plan, { policy, registry, sequenceJob: driftedJob, requests }), /sequence job\/version drift detected/);
});

test('C1.9 human Picture Plan approval grants only eligibility for a later Picture Lock ceremony, never Picture Lock itself', () => {
  const { plan } = completePlan();
  const review = {
    schema: 'parallax.cineswarm.picture-plan-review.c1.9.v0.1',
    reviewId: 'pn0001_seq01_picture_plan_review_001',
    planId: plan.planId,
    planHash: plan.planHash,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'APPROVE_FOR_LOCK_CEREMONY',
    reason: 'Proof-only review confirms shot order and metadata continuity contract for C1.9.',
    recordedAt: '2026-08-13T07:35:00.000Z',
    pictureLockAuthorized: false,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  assert.equal(validatePicturePlanReview(review, plan).valid, true);
  const classified = classifyPicturePlan({ plan, review });
  assert.equal(classified.pictureLockCeremonyEligible, true);
  assert.equal(classified.pictureLocked, false);
  assert.equal(classified.canonEligible, false);
  assert.equal(classified.publicRelease, false);
});

test('C1.9 rejects simulated or plan-hash-mismatched reviews and an unreviewed plan stays unlocked', () => {
  const { plan } = completePlan();
  const pending = classifyPicturePlan({ plan });
  assert.equal(pending.pictureLockCeremonyEligible, false);
  assert.equal(pending.pictureLocked, false);
  const bad = {
    schema: 'parallax.cineswarm.picture-plan-review.c1.9.v0.1',
    reviewId: 'pn0001_seq01_picture_plan_review_bad',
    planId: plan.planId,
    planHash: '0'.repeat(64),
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: true,
    decision: 'APPROVE_FOR_LOCK_CEREMONY',
    reason: 'Invalid proof-only review.',
    recordedAt: '2026-08-13T07:35:00.000Z',
    pictureLockAuthorized: false,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  assert.throws(() => validatePicturePlanReview(bad, plan), /does not match exact plan candidate|must be real/);
});

test('C1.9 canonical PN-0001 registry remains empty and claims no Picture Plan, Picture Lock, Canon, or public release', () => {
  const registry = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-c1-9-candidate-asset-registry.json'), 'utf8'));
  const pictureRegister = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../fixtures/cineswarm/pn-0001-c1-9-picture-plan-register.json'), 'utf8'));
  assert.equal(validateCandidateAssetRegistry(registry, { policy }).valid, true);
  assert.equal(registry.status, 'EMPTY_NO_ACCEPTED_CANDIDATES');
  assert.equal(registry.entryCount, 0);
  assert.equal(pictureRegister.picturePlanCandidateCount, 0);
  assert.equal(pictureRegister.pictureLockCeremonyEligibleCount, 0);
  assert.equal(pictureRegister.pictureLockedCount, 0);
  assert.equal(pictureRegister.canonEligibleCount, 0);
  assert.equal(pictureRegister.publicRelease, false);
  assert.equal(pictureRegister.relayDependency, false);
});
