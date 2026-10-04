import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestProviderRequest } from '../src/execution-authorization.js';
import {
  appendCandidateAssetToRegistry,
  buildCandidateAssetEntry,
  buildCandidateAssetRegistry,
  buildPicturePlanCandidate,
  validatePicturePlanReview,
} from '../src/candidate-picture-plan.js';
import {
  appendLockedPictureToRegister,
  appendPictureLockTransitionToRegister,
  buildLockedPictureManifest,
  buildPictureLockCeremonyPayload,
  buildPictureLockRegister,
  buildPictureLockTransitionPayload,
  classifyPictureLockRegister,
  signPictureLockCeremony,
  signPictureLockTransition,
  validateLockedPictureManifest,
  validatePictureLockPolicy,
  validatePictureLockRegister,
  verifyPictureLockCeremony,
  verifyPictureLockTransition,
} from '../src/picture-lock.js';

const base = resolve(import.meta.dirname, '../../..');
const policy = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-10-picture-lock-policy.json'), 'utf8'));
const candidatePolicy = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-9-candidate-registry-policy.json'), 'utf8'));
const requests = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-seq01-provider-requests.json'), 'utf8'));
const jobs = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-sequence-jobs.json'), 'utf8'));
const sequenceJob = jobs.find((job) => job.network.sequenceId === policy.sequenceId);
const canonicalRegister = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-10-picture-lock-register.json'), 'utf8'));

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

function makeKeyMaterial({ status = 'active' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keyRegistry = {
    schema: 'parallax.cineswarm.signing-key-registry.c1.6.v0.1',
    keys: [{
      keyId: 'michael_hughes_picture_lock_001',
      algorithm: 'Ed25519',
      status,
      authority: { kind: 'human', id: 'michael-hughes' },
      publicKeyPem,
      validFrom: '2026-08-13T06:00:00.000Z',
      validUntil: null,
    }],
    status: status === 'active' ? 'ACTIVE' : 'TEST',
  };
  return { privateKeyPem, keyRegistry };
}

function acceptedInput(shotIndex, { artifactSeed = `base-${shotIndex}`, candidateAssetId = null } = {}) {
  const request = structuredClone(requests[shotIndex - 1]);
  const artifactSha256 = sha(`c1.10-proof-artifact-${artifactSeed}`);
  const manifest = {
    schema: 'parallax.cineswarm.asset-quarantine-manifest.c1.8.v0.1',
    quarantineId: `${request.requestId}_quarantine_${artifactSeed.replace(/[^A-Za-z0-9_.:-]/g, '_')}`,
    intakePolicyId: 'pn0001-seq01-provider-asset-intake',
    receiptId: `${request.requestId}_attempt_receipt_${artifactSeed.replace(/[^A-Za-z0-9_.:-]/g, '_')}`,
    receiptHash: sha(`receipt-${artifactSeed}`),
    executionId: `exec_c1_10_${artifactSeed.replace(/[^A-Za-z0-9_.:-]/g, '_')}`,
    envelopeId: `env_c1_10_${artifactSeed.replace(/[^A-Za-z0-9_.:-]/g, '_')}`,
    episodeId: request.episodeId,
    sequenceId: request.sequenceId,
    requestId: request.requestId,
    requestDigest: digestProviderRequest(request),
    artifact: {
      path: `production/provider-quarantine/${request.sequenceId}/${request.requestId}-${artifactSeed}.png`,
      fileName: `${request.requestId}-${artifactSeed}.png`,
      mediaType: 'image/png',
      sha256: artifactSha256,
      byteSize: 2048 + shotIndex,
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
    decisionId: `${request.requestId}_review_${artifactSeed.replace(/[^A-Za-z0-9_.:-]/g, '_')}`,
    quarantineId: manifest.quarantineId,
    artifactSha256,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'ACCEPT',
    reason: 'Proof-only accepted candidate for C1.10 contract verification.',
    recordedAt: `2026-08-13T07:0${shotIndex}:00.000Z`,
    publicRelease: false,
    pictureLockAuthorized: false,
    canonAuthorized: false,
    relayDependency: false,
  };
  return { request, manifest, reviewDecision, continuityVersion: 'pn0001_seq01_visual_world_v1', candidateAssetId };
}

function buildWorld({ replacement = false } = {}) {
  let registry = buildCandidateAssetRegistry({ policy: candidatePolicy, entries: [], revision: 0, previousRegistryHash: null, recordedAt: '2026-08-13T07:20:00.000Z' });
  const baseEntries = [1, 2, 3].map((shotIndex) => buildCandidateAssetEntry({
    ...acceptedInput(shotIndex),
    sequenceJob,
    policy: candidatePolicy,
    registeredAt: `2026-08-13T07:1${shotIndex}:00.000Z`,
  }));
  for (const [index, entry] of baseEntries.entries()) {
    registry = appendCandidateAssetToRegistry({ registry, entry, policy: candidatePolicy, recordedAt: `2026-08-13T07:2${index + 1}:00.000Z` });
  }
  let selections = baseEntries.map((entry) => entry.candidateAssetId);
  if (replacement) {
    const replacementEntry = buildCandidateAssetEntry({
      ...acceptedInput(1, { artifactSeed: 'replacement-shot-1', candidateAssetId: 'cand_pn0001_seq01_replacement_shot01' }),
      sequenceJob,
      policy: candidatePolicy,
      registeredAt: '2026-08-13T08:10:00.000Z',
      candidateAssetId: 'cand_pn0001_seq01_replacement_shot01',
    });
    registry = appendCandidateAssetToRegistry({ registry, entry: replacementEntry, policy: candidatePolicy, recordedAt: '2026-08-13T08:11:00.000Z' });
    selections = [replacementEntry.candidateAssetId, baseEntries[1].candidateAssetId, baseEntries[2].candidateAssetId];
  }
  const plan = buildPicturePlanCandidate({
    policy: candidatePolicy,
    registry,
    sequenceJob,
    requests,
    selections,
    createdAt: replacement ? '2026-08-13T08:20:00.000Z' : '2026-08-13T07:30:00.000Z',
    planId: replacement ? 'pn0001-seq01-picture-plan-replacement-r04' : 'pn0001-seq01-picture-plan-proof-r03',
  });
  const review = {
    schema: 'parallax.cineswarm.picture-plan-review.c1.9.v0.1',
    reviewId: replacement ? 'pn0001_seq01_picture_plan_review_replacement' : 'pn0001_seq01_picture_plan_review_proof',
    planId: plan.planId,
    planHash: plan.planHash,
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'APPROVE_FOR_LOCK_CEREMONY',
    reason: replacement ? 'Proof-only human review approves replacement Picture Plan for lock ceremony.' : 'Proof-only human review approves exact Picture Plan for lock ceremony.',
    recordedAt: replacement ? '2026-08-13T08:25:00.000Z' : '2026-08-13T07:35:00.000Z',
    pictureLockAuthorized: false,
    canonAuthorized: false,
    ledgerPromotionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  validatePicturePlanReview(review, plan);
  return { registry, plan, review };
}

function lockWorld({ replacement = false, keyMaterial = makeKeyMaterial() } = {}) {
  const world = buildWorld({ replacement });
  const recordedAt = replacement ? '2026-08-13T08:30:00.000Z' : '2026-08-13T07:40:00.000Z';
  const payload = buildPictureLockCeremonyPayload({
    policy,
    plan: world.plan,
    review: world.review,
    candidateRegistry: world.registry,
    authorityId: 'michael-hughes',
    keyId: keyMaterial.keyRegistry.keys[0].keyId,
    recordedAt,
  });
  const ceremony = signPictureLockCeremony(payload, { privateKeyPem: keyMaterial.privateKeyPem, keyRegistry: keyMaterial.keyRegistry });
  const manifest = buildLockedPictureManifest({
    ceremony,
    plan: world.plan,
    review: world.review,
    candidateRegistry: world.registry,
    policy,
    keyRegistry: keyMaterial.keyRegistry,
  });
  return { ...world, ...keyMaterial, payload, ceremony, manifest };
}

test('C1.10 policy makes Picture Lock human-signed, exact-hash-bound, explicitly unlockable, and preserves downstream boundaries', () => {
  assert.equal(validatePictureLockPolicy(policy).valid, true);
  assert.equal(policy.requireExactPlanHash, true);
  assert.equal(policy.requireExactReviewHash, true);
  assert.equal(policy.requireExactCandidateRegistryHash, true);
  assert.equal(policy.requireHumanSignature, true);
  assert.equal(policy.requireExplicitUnlockForRevision, true);
  assert.equal(policy.requireExplicitSupersession, true);
  assert.equal(policy.autoPictureLock, false);
  assert.equal(policy.publicRelease, false);
  assert.equal(policy.relayDependency, false);
});

test('C1.10 signs and verifies an exact approved Picture Plan under a distinct Ed25519 Picture Lock signature domain', () => {
  const proof = lockWorld();
  const verified = verifyPictureLockCeremony({
    ceremony: proof.ceremony,
    plan: proof.plan,
    review: proof.review,
    candidateRegistry: proof.registry,
    policy,
    keyRegistry: proof.keyRegistry,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.planHash, proof.plan.planHash);
  assert.equal(verified.pictureLocked, true);
  assert.equal(proof.ceremony.pictureLockAuthorized, true);
  assert.equal(proof.ceremony.canonAuthorized, false);
  assert.equal(proof.ceremony.publicRelease, false);
});

test('C1.10 rejects Picture Lock when the C1.9 human review has not approved the exact plan for a lock ceremony', () => {
  const world = buildWorld();
  const heldReview = { ...world.review, decision: 'HOLD', reason: 'Proof-only hold.' };
  assert.throws(() => buildPictureLockCeremonyPayload({
    policy,
    plan: world.plan,
    review: heldReview,
    candidateRegistry: world.registry,
    authorityId: 'michael-hughes',
    keyId: 'michael_hughes_picture_lock_001',
    recordedAt: '2026-08-13T07:40:00.000Z',
  }), /requires an exact human-approved C1\.9 plan review/);
});

test('C1.10 detects plan/review/registry or signature tampering after the human Picture Lock signature', () => {
  const proof = lockWorld();
  const tamperedPlan = structuredClone(proof.plan);
  tamperedPlan.totalDurationSeconds += 1;
  assert.throws(() => verifyPictureLockCeremony({ ceremony: proof.ceremony, plan: tamperedPlan, review: proof.review, candidateRegistry: proof.registry, policy, keyRegistry: proof.keyRegistry }), /totalDurationSeconds mismatch|self-hash mismatch/);
  const tamperedCeremony = structuredClone(proof.ceremony);
  tamperedCeremony.signatureBase64 = Buffer.from('tampered').toString('base64');
  tamperedCeremony.ceremonyHash = sha('fake');
  assert.throws(() => verifyPictureLockCeremony({ ceremony: tamperedCeremony, plan: proof.plan, review: proof.review, candidateRegistry: proof.registry, policy, keyRegistry: proof.keyRegistry }), /signature verification failed|self-hash mismatch/);
});

test('C1.10 Locked Picture Manifest freezes exact shot selections and remains outside Canon, Ledger promotion, and public release', () => {
  const proof = lockWorld();
  const verified = validateLockedPictureManifest(proof.manifest, {
    ceremony: proof.ceremony,
    plan: proof.plan,
    review: proof.review,
    candidateRegistry: proof.registry,
    policy,
    keyRegistry: proof.keyRegistry,
  });
  assert.equal(verified.valid, true);
  assert.equal(proof.manifest.pictureLocked, true);
  assert.equal(proof.manifest.shotCount, 3);
  assert.equal(proof.manifest.totalDurationSeconds, 20);
  assert.equal(proof.manifest.canonEligible, false);
  assert.equal(proof.manifest.ledgerPromotionEligible, false);
  assert.equal(proof.manifest.publicRelease, false);
});

test('C1.10 Locked Picture Manifest is immutable: silent artifact replacement invalidates the manifest hash', () => {
  const proof = lockWorld();
  const tampered = structuredClone(proof.manifest);
  tampered.shots[0].artifactSha256 = sha('silent-replacement');
  assert.throws(() => validateLockedPictureManifest(tampered), /self-hash mismatch/);
});

test('C1.10 canonical PN-0001 Picture Lock register remains empty and claims no real lock', () => {
  const result = validatePictureLockRegister(canonicalRegister, { policy });
  assert.equal(result.valid, true);
  assert.equal(canonicalRegister.status, 'EMPTY_NO_PICTURE_LOCKS');
  assert.equal(canonicalRegister.entryCount, 0);
  assert.equal(canonicalRegister.currentManifestHash, null);
  assert.equal(canonicalRegister.pictureLocked, false);
  assert.equal(canonicalRegister.publicRelease, false);
});

test('C1.10 append-only register activates one exact locked manifest and refuses a second active lock without explicit unlock', () => {
  const first = lockWorld();
  let register = buildPictureLockRegister({ policy, entries: [], revision: 0, recordedAt: '2026-08-13T07:41:00.000Z' });
  register = appendLockedPictureToRegister({ register, manifest: first.manifest, policy, recordedAt: '2026-08-13T07:42:00.000Z' });
  assert.equal(register.pictureLocked, true);
  assert.equal(register.currentManifestHash, first.manifest.manifestHash);
  const second = lockWorld({ replacement: true, keyMaterial: { privateKeyPem: first.privateKeyPem, keyRegistry: first.keyRegistry } });
  assert.throws(() => appendLockedPictureToRegister({ register, manifest: second.manifest, policy, recordedAt: '2026-08-13T08:31:00.000Z' }), /explicit UNLOCK_FOR_REVISION is required/);
});

test('C1.10 signed UNLOCK_FOR_REVISION preserves the old immutable lock as history while removing active Picture Lock state', () => {
  const first = lockWorld();
  let register = buildPictureLockRegister({ policy, entries: [], revision: 0, recordedAt: '2026-08-13T07:41:00.000Z' });
  register = appendLockedPictureToRegister({ register, manifest: first.manifest, policy, recordedAt: '2026-08-13T07:42:00.000Z' });
  const payload = buildPictureLockTransitionPayload({
    policy,
    manifest: first.manifest,
    decision: 'UNLOCK_FOR_REVISION',
    reason: 'Proof-only editorial revision requested.',
    authorityId: 'michael-hughes',
    keyId: first.keyRegistry.keys[0].keyId,
    recordedAt: '2026-08-13T08:00:00.000Z',
  });
  const transition = signPictureLockTransition(payload, { privateKeyPem: first.privateKeyPem, keyRegistry: first.keyRegistry });
  assert.equal(verifyPictureLockTransition({ transition, manifest: first.manifest, policy, keyRegistry: first.keyRegistry }).valid, true);
  register = appendPictureLockTransitionToRegister({ register, transition, manifest: first.manifest, policy, keyRegistry: first.keyRegistry, recordedAt: '2026-08-13T08:00:00.000Z' });
  const classified = classifyPictureLockRegister(register);
  assert.equal(classified.state, 'UNLOCKED_FOR_REVISION');
  assert.equal(classified.pictureLocked, false);
  assert.equal(classified.unlockEventCount, 1);
  assert.equal(first.manifest.pictureLocked, true);
});

test('C1.10 replacement requires unlock, a separately signed new lock, then explicit signed SUPERSEDE to complete history', () => {
  const first = lockWorld();
  let register = buildPictureLockRegister({ policy, entries: [], revision: 0, recordedAt: '2026-08-13T07:41:00.000Z' });
  register = appendLockedPictureToRegister({ register, manifest: first.manifest, policy, recordedAt: '2026-08-13T07:42:00.000Z' });
  const unlockPayload = buildPictureLockTransitionPayload({ policy, manifest: first.manifest, decision: 'UNLOCK_FOR_REVISION', reason: 'Proof-only revision.', authorityId: 'michael-hughes', keyId: first.keyRegistry.keys[0].keyId, recordedAt: '2026-08-13T08:00:00.000Z' });
  const unlock = signPictureLockTransition(unlockPayload, { privateKeyPem: first.privateKeyPem, keyRegistry: first.keyRegistry });
  register = appendPictureLockTransitionToRegister({ register, transition: unlock, manifest: first.manifest, policy, keyRegistry: first.keyRegistry, recordedAt: '2026-08-13T08:00:00.000Z' });

  const replacement = lockWorld({ replacement: true, keyMaterial: { privateKeyPem: first.privateKeyPem, keyRegistry: first.keyRegistry } });
  register = appendLockedPictureToRegister({ register, manifest: replacement.manifest, policy, recordedAt: '2026-08-13T08:31:00.000Z' });
  assert.equal(register.currentManifestHash, replacement.manifest.manifestHash);

  const supersedePayload = buildPictureLockTransitionPayload({
    policy,
    manifest: first.manifest,
    decision: 'SUPERSEDE',
    reason: 'Proof-only replacement lock supersedes the prior unlocked picture.',
    authorityId: 'michael-hughes',
    keyId: first.keyRegistry.keys[0].keyId,
    recordedAt: '2026-08-13T08:35:00.000Z',
    replacementManifest: replacement.manifest,
  });
  const supersede = signPictureLockTransition(supersedePayload, { privateKeyPem: first.privateKeyPem, keyRegistry: first.keyRegistry });
  register = appendPictureLockTransitionToRegister({
    register,
    transition: supersede,
    manifest: first.manifest,
    replacementManifest: replacement.manifest,
    policy,
    keyRegistry: first.keyRegistry,
    recordedAt: '2026-08-13T08:35:00.000Z',
  });
  const classified = classifyPictureLockRegister(register);
  assert.equal(classified.state, 'PICTURE_LOCKED');
  assert.equal(classified.currentManifestHash, replacement.manifest.manifestHash);
  assert.equal(classified.lockedManifestCount, 2);
  assert.equal(classified.unlockEventCount, 1);
  assert.equal(classified.supersededManifestCount, 1);
  assert.equal(classified.publicRelease, false);
});

test('C1.10 transition signatures reject tampering and revoked signing keys invalidate lock-state mutations', () => {
  const first = lockWorld();
  const payload = buildPictureLockTransitionPayload({ policy, manifest: first.manifest, decision: 'UNLOCK_FOR_REVISION', reason: 'Proof-only revision.', authorityId: 'michael-hughes', keyId: first.keyRegistry.keys[0].keyId, recordedAt: '2026-08-13T08:00:00.000Z' });
  const transition = signPictureLockTransition(payload, { privateKeyPem: first.privateKeyPem, keyRegistry: first.keyRegistry });
  const tampered = structuredClone(transition);
  tampered.reason = 'Changed after signature';
  assert.throws(() => verifyPictureLockTransition({ transition: tampered, manifest: first.manifest, policy, keyRegistry: first.keyRegistry }), /payload digest mismatch/);
  const revokedRegistry = structuredClone(first.keyRegistry);
  revokedRegistry.keys[0].status = 'revoked';
  assert.throws(() => verifyPictureLockTransition({ transition, manifest: first.manifest, policy, keyRegistry: revokedRegistry }), /revoked/);
});

test('C1.10 retired keys may verify historical lock signatures but cannot create new Picture Lock signatures', () => {
  const first = lockWorld();
  const retiredRegistry = structuredClone(first.keyRegistry);
  retiredRegistry.keys[0].status = 'retired';
  assert.equal(verifyPictureLockCeremony({ ceremony: first.ceremony, plan: first.plan, review: first.review, candidateRegistry: first.registry, policy, keyRegistry: retiredRegistry }).valid, true);
  const world = buildWorld({ replacement: true });
  const payload = buildPictureLockCeremonyPayload({ policy, plan: world.plan, review: world.review, candidateRegistry: world.registry, authorityId: 'michael-hughes', keyId: retiredRegistry.keys[0].keyId, recordedAt: '2026-08-13T08:30:00.000Z' });
  assert.throws(() => signPictureLockCeremony(payload, { privateKeyPem: first.privateKeyPem, keyRegistry: retiredRegistry }), /must be active/);
});
