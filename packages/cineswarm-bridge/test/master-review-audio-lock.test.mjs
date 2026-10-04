import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestJson } from '../src/authorization-seal.js';
import {
  appendAudioLockTransitionToRegister,
  appendLockedAudioToRegister,
  appendMasterCandidateToRegister,
  buildAudioLockCeremonyPayload,
  buildAudioLockRegister,
  buildAudioLockTransitionPayload,
  buildLockedAudioManifest,
  buildMasterAcceptanceCeremonyPayload,
  buildMasterCandidate,
  buildMasterCandidateRegister,
  buildMasterReview,
  classifyMasterReadiness,
  signAudioLockCeremony,
  signAudioLockTransition,
  signMasterAcceptanceCeremony,
  validateAudioLockRegister,
  validateLockedAudioManifest,
  validateMasterCandidate,
  validateMasterCandidateRegister,
  validateMasterReview,
  validateMasterReviewPolicy,
  verifyAudioLockCeremony,
  verifyAudioLockTransition,
  verifyMasterAcceptanceCeremony,
} from '../src/master-review-audio-lock.js';
import { validateAudioConformManifest, validateRenderCandidate } from '../src/locked-render-audio.js';

const base = resolve(import.meta.dirname, '../../..');
const policy = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-12-master-review-policy.json'), 'utf8'));
const canonicalAudioRegister = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-12-audio-lock-register.json'), 'utf8'));
const canonicalMasterRegister = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-12-master-candidate-register.json'), 'utf8'));
const now = '2026-08-13T18:20:00.000Z';
const later = '2026-08-13T18:21:00.000Z';
const later2 = '2026-08-13T18:22:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');

function makeKeyMaterial({ status = 'active', keyId = 'michael_hughes_master_001' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    privateKeyPem,
    keyRegistry: {
      schema: 'parallax.cineswarm.signing-key-registry.c1.6.v0.1',
      keys: [{
        keyId,
        algorithm: 'Ed25519',
        status,
        authority: { kind: 'human', id: 'michael-hughes' },
        publicKeyPem,
        validFrom: '2026-08-13T18:00:00.000Z',
        validUntil: null,
      }],
      status: status === 'active' ? 'ACTIVE' : 'TEST',
    },
  };
}

function buildAudioConform({ seed = 'base', mixSha = sha(`mix-${seed}`) } = {}) {
  const manifest = {
    schema: 'parallax.cineswarm.audio-conform-manifest.c1.11.v0.1',
    manifestId: `audio-conform-${seed}`,
    policyId: 'pn0001-seq01-locked-render-policy',
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    lockedPictureManifestId: 'locked-picture-proof',
    lockedPictureManifestHash: sha('locked-picture-proof'),
    timelineDurationSeconds: 20,
    tracks: [{
      trackId: 'narration-main',
      kind: 'narration',
      sourceSha256: sha(`narration-${seed}`),
      sourceLineage: 'proof-only-human-narration',
      rightsStatus: 'proof-only-original',
      startSeconds: 0,
      endSeconds: 20,
      voiceConsentStatus: 'confirmed-human',
    }],
    mixAsset: {
      relativePath: `mix/${seed}.wav`,
      sha256: mixSha,
      sizeBytes: 3840000,
      mediaType: 'audio/wav',
      durationSeconds: 20,
      sampleRateHz: 48000,
      channels: 2,
    },
    createdAt: now,
    humanReviewRequired: true,
    audioLocked: false,
    masterAccepted: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  manifest.audioConformHash = digestJson(manifest);
  validateAudioConformManifest(manifest);
  return manifest;
}

function buildRenderCandidateFixture(audioConform) {
  const candidate = {
    schema: 'parallax.cineswarm.render-candidate.c1.11.v0.1',
    candidateId: 'render-candidate-proof',
    policyId: 'pn0001-seq01-locked-render-policy',
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    lockedPictureManifestHash: audioConform.lockedPictureManifestHash,
    renderContractId: 'render-contract-proof',
    renderContractHash: sha('render-contract-proof'),
    audioConformHash: audioConform.audioConformHash,
    audioConformReviewHash: sha('audio-conform-review-proof'),
    qcReportId: 'qc-proof',
    qcHash: sha('qc-proof'),
    outputAsset: {
      relativePath: 'renders/proof.mp4',
      sha256: sha('proof-mp4'),
      sizeBytes: 444444,
      mediaType: 'video/mp4',
    },
    createdAt: now,
    state: 'RENDER_CANDIDATE',
    pictureLockedAtRender: true,
    measuredQcPassed: true,
    humanMasterAcceptanceRequired: true,
    masterAccepted: false,
    audioLocked: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  candidate.renderCandidateHash = digestJson(candidate);
  validateRenderCandidate(candidate);
  return candidate;
}

function buildLockedAudioFixture({ audioConform = buildAudioConform(), keyMaterial = makeKeyMaterial(), recordedAt = now } = {}) {
  const payload = buildAudioLockCeremonyPayload({ policy, audioConformManifest: audioConform, authorityId: 'michael-hughes', keyId: keyMaterial.keyRegistry.keys[0].keyId, recordedAt });
  const ceremony = signAudioLockCeremony(payload, { privateKeyPem: keyMaterial.privateKeyPem, keyRegistry: keyMaterial.keyRegistry });
  const manifest = buildLockedAudioManifest({ ceremony, audioConformManifest: audioConform, policy, keyRegistry: keyMaterial.keyRegistry });
  let register = buildAudioLockRegister({ policy, entries: [], revision: 0, recordedAt });
  register = appendLockedAudioToRegister({ register, manifest, policy, recordedAt });
  return { audioConform, keyMaterial, payload, ceremony, manifest, register };
}

test('C1.12 policy requires separate human Audio Lock and Master acceptance while preserving downstream boundaries', () => {
  assert.equal(validateMasterReviewPolicy(policy).valid, true);
  const bad = structuredClone(policy);
  bad.autoMasterAcceptance = true;
  assert.throws(() => validateMasterReviewPolicy(bad), /autoMasterAcceptance must remain false/);
  const release = structuredClone(policy);
  release.publicRelease = true;
  assert.throws(() => validateMasterReviewPolicy(release), /publicRelease must remain false/);
});

test('Audio Lock signs the exact C1.11 conform manifest and exact mix bytes in a dedicated Ed25519 domain', () => {
  const audio = buildAudioConform();
  const keys = makeKeyMaterial();
  const payload = buildAudioLockCeremonyPayload({ policy, audioConformManifest: audio, authorityId: 'michael-hughes', keyId: keys.keyRegistry.keys[0].keyId, recordedAt: now });
  const ceremony = signAudioLockCeremony(payload, { privateKeyPem: keys.privateKeyPem, keyRegistry: keys.keyRegistry });
  const verified = verifyAudioLockCeremony({ ceremony, audioConformManifest: audio, policy, keyRegistry: keys.keyRegistry });
  assert.equal(verified.valid, true);
  assert.equal(verified.audioLocked, true);
  assert.equal(ceremony.masterAcceptanceAuthorized, false);
});

test('Audio Lock rejects post-signing audio conform/mix drift even if the surrounding object is rehashed', () => {
  const { audioConform: audio, keyMaterial: keys, ceremony } = buildLockedAudioFixture();
  const tamperedAudio = structuredClone(audio);
  tamperedAudio.mixAsset.sha256 = sha('replacement-mix');
  const { audioConformHash, ...rest } = tamperedAudio;
  tamperedAudio.audioConformHash = digestJson(rest);
  assert.throws(() => verifyAudioLockCeremony({ ceremony, audioConformManifest: tamperedAudio, policy, keyRegistry: keys.keyRegistry }), /exact Audio Conform|mix|drift/);
});

test('new Audio Lock cannot be created or historically trusted with a revoked key', () => {
  const audio = buildAudioConform();
  const keys = makeKeyMaterial({ status: 'revoked' });
  const payload = buildAudioLockCeremonyPayload({ policy, audioConformManifest: audio, authorityId: 'michael-hughes', keyId: keys.keyRegistry.keys[0].keyId, recordedAt: now });
  assert.throws(() => signAudioLockCeremony(payload, { privateKeyPem: keys.privateKeyPem, keyRegistry: keys.keyRegistry }), /must be active/);
});

test('Locked Audio Manifest is immutable and never grants Master, Canon, Ledger, or release authority', () => {
  const { manifest, ceremony, audioConform, keyMaterial } = buildLockedAudioFixture();
  assert.equal(validateLockedAudioManifest(manifest, { ceremony, audioConformManifest: audioConform, policy, keyRegistry: keyMaterial.keyRegistry }).valid, true);
  assert.equal(manifest.audioLocked, true);
  assert.equal(manifest.masterAccepted, false);
  assert.equal(manifest.canonEligible, false);
  assert.equal(manifest.publicRelease, false);
  const tampered = structuredClone(manifest);
  tampered.masterAccepted = true;
  assert.throws(() => validateLockedAudioManifest(tampered, { policy }), /authority boundaries|self-hash/);
});

test('Audio Lock Register is append-only and forces explicit unlock before a replacement lock', () => {
  const first = buildLockedAudioFixture();
  const secondAudio = buildAudioConform({ seed: 'second' });
  const secondPayload = buildAudioLockCeremonyPayload({ policy, audioConformManifest: secondAudio, authorityId: 'michael-hughes', keyId: first.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later });
  const secondCeremony = signAudioLockCeremony(secondPayload, { privateKeyPem: first.keyMaterial.privateKeyPem, keyRegistry: first.keyMaterial.keyRegistry });
  const secondManifest = buildLockedAudioManifest({ ceremony: secondCeremony, audioConformManifest: secondAudio, policy, keyRegistry: first.keyMaterial.keyRegistry });
  assert.throws(() => appendLockedAudioToRegister({ register: first.register, manifest: secondManifest, policy, recordedAt: later }), /unlock first/);
  assert.equal(validateAudioLockRegister(first.register, { policy }).audioLocked, true);
});

test('Audio Lock unlock/remix/supersession preserves the old immutable lock in history', () => {
  const first = buildLockedAudioFixture();
  const unlockPayload = buildAudioLockTransitionPayload({ policy, manifest: first.manifest, decision: 'UNLOCK_FOR_REMIX', authorityId: 'michael-hughes', keyId: first.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later, reason: 'Proof-only remix revision.' });
  const unlock = signAudioLockTransition(unlockPayload, { privateKeyPem: first.keyMaterial.privateKeyPem, keyRegistry: first.keyMaterial.keyRegistry });
  assert.equal(verifyAudioLockTransition({ transition: unlock, manifest: first.manifest, policy, keyRegistry: first.keyMaterial.keyRegistry }).valid, true);
  let register = appendAudioLockTransitionToRegister({ register: first.register, transition: unlock, manifest: first.manifest, policy, keyRegistry: first.keyMaterial.keyRegistry, recordedAt: later });
  assert.equal(register.audioLocked, false);

  const secondAudio = buildAudioConform({ seed: 'replacement' });
  const secondPayload = buildAudioLockCeremonyPayload({ policy, audioConformManifest: secondAudio, authorityId: 'michael-hughes', keyId: first.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later2 });
  const secondCeremony = signAudioLockCeremony(secondPayload, { privateKeyPem: first.keyMaterial.privateKeyPem, keyRegistry: first.keyMaterial.keyRegistry });
  const secondManifest = buildLockedAudioManifest({ ceremony: secondCeremony, audioConformManifest: secondAudio, policy, keyRegistry: first.keyMaterial.keyRegistry });
  register = appendLockedAudioToRegister({ register, manifest: secondManifest, policy, recordedAt: later2 });
  const supersedePayload = buildAudioLockTransitionPayload({ policy, manifest: first.manifest, replacementManifest: secondManifest, decision: 'SUPERSEDE', authorityId: 'michael-hughes', keyId: first.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: '2026-08-13T18:23:00.000Z', reason: 'Proof-only replacement Audio Lock.' });
  const supersede = signAudioLockTransition(supersedePayload, { privateKeyPem: first.keyMaterial.privateKeyPem, keyRegistry: first.keyMaterial.keyRegistry });
  register = appendAudioLockTransitionToRegister({ register, transition: supersede, manifest: first.manifest, replacementManifest: secondManifest, policy, keyRegistry: first.keyMaterial.keyRegistry, recordedAt: '2026-08-13T18:23:00.000Z' });
  assert.equal(register.audioLocked, true);
  assert.equal(register.currentManifestHash, secondManifest.manifestHash);
  assert.equal(register.unlockEventCount, 1);
  assert.equal(register.supersededManifestCount, 1);
  assert.equal(first.manifest.supersessionRecordedInRegister, false);
});

test('Master Review requires the exact active Audio Lock and separate creative + technical approval', () => {
  const locked = buildLockedAudioFixture();
  const render = buildRenderCandidateFixture(locked.audioConform);
  assert.throws(() => buildMasterReview({ policy, renderCandidate: render, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', decision: 'ACCEPT_MASTER_CANDIDATE', creativeApproved: true, technicalApproved: false, recordedAt: later, notes: 'Should fail.' }), /creative and technical approval/);
  const review = buildMasterReview({ policy, renderCandidate: render, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', decision: 'ACCEPT_MASTER_CANDIDATE', creativeApproved: true, technicalApproved: true, recordedAt: later, notes: 'Proof-only creative and technical acceptance.' });
  const validated = validateMasterReview(review, { policy, renderCandidate: render, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register });
  assert.equal(validated.acceptedForMasterCeremony, true);
  assert.equal(review.masterAccepted, false);
});

test('Master Acceptance Ceremony cryptographically binds review, exact MP4, QC, Picture Lock, and Audio Lock hashes', () => {
  const locked = buildLockedAudioFixture();
  const render = buildRenderCandidateFixture(locked.audioConform);
  const review = buildMasterReview({ policy, renderCandidate: render, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', decision: 'ACCEPT_MASTER_CANDIDATE', creativeApproved: true, technicalApproved: true, recordedAt: later, notes: 'Proof-only review.' });
  const payload = buildMasterAcceptanceCeremonyPayload({ policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', keyId: locked.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later2 });
  const ceremony = signMasterAcceptanceCeremony(payload, { privateKeyPem: locked.keyMaterial.privateKeyPem, keyRegistry: locked.keyMaterial.keyRegistry });
  assert.equal(verifyMasterAcceptanceCeremony({ ceremony, policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, keyRegistry: locked.keyMaterial.keyRegistry }).valid, true);
  const changedRender = structuredClone(render);
  changedRender.outputAsset.sha256 = sha('changed-mp4');
  assert.throws(() => verifyMasterAcceptanceCeremony({ ceremony, policy, renderCandidate: changedRender, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, keyRegistry: locked.keyMaterial.keyRegistry }));
});

test('Master Candidate is exact and accepted, but Canon, Ledger promotion, and Network release remain later gates', () => {
  const locked = buildLockedAudioFixture();
  const render = buildRenderCandidateFixture(locked.audioConform);
  const review = buildMasterReview({ policy, renderCandidate: render, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', decision: 'ACCEPT_MASTER_CANDIDATE', creativeApproved: true, technicalApproved: true, recordedAt: later, notes: 'Proof-only review.' });
  const payload = buildMasterAcceptanceCeremonyPayload({ policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', keyId: locked.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later2 });
  const ceremony = signMasterAcceptanceCeremony(payload, { privateKeyPem: locked.keyMaterial.privateKeyPem, keyRegistry: locked.keyMaterial.keyRegistry });
  const candidate = buildMasterCandidate({ policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, acceptanceCeremony: ceremony, keyRegistry: locked.keyMaterial.keyRegistry, createdAt: later2 });
  const validated = validateMasterCandidate(candidate, { policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, acceptanceCeremony: ceremony, keyRegistry: locked.keyMaterial.keyRegistry });
  assert.equal(validated.valid, true);
  assert.equal(candidate.masterAccepted, true);
  assert.equal(candidate.audioLocked, true);
  assert.equal(candidate.canonEligible, false);
  assert.equal(candidate.ledgerPromotionEligible, false);
  assert.equal(candidate.publicRelease, false);
});

test('Master Candidate Register is append-only and cannot duplicate the same accepted exact master', () => {
  const locked = buildLockedAudioFixture();
  const render = buildRenderCandidateFixture(locked.audioConform);
  const review = buildMasterReview({ policy, renderCandidate: render, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', decision: 'ACCEPT_MASTER_CANDIDATE', creativeApproved: true, technicalApproved: true, recordedAt: later, notes: 'Proof-only review.' });
  const payload = buildMasterAcceptanceCeremonyPayload({ policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, authorityId: 'michael-hughes', keyId: locked.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later2 });
  const ceremony = signMasterAcceptanceCeremony(payload, { privateKeyPem: locked.keyMaterial.privateKeyPem, keyRegistry: locked.keyMaterial.keyRegistry });
  const candidate = buildMasterCandidate({ policy, renderCandidate: render, masterReview: review, lockedAudioManifest: locked.manifest, audioLockRegister: locked.register, acceptanceCeremony: ceremony, keyRegistry: locked.keyMaterial.keyRegistry, createdAt: later2 });
  let register = buildMasterCandidateRegister({ policy, entries: [], revision: 0, recordedAt: now });
  register = appendMasterCandidateToRegister({ register, candidate, policy, recordedAt: later2 });
  assert.equal(validateMasterCandidateRegister(register, { policy }).masterCandidateCount, 1);
  assert.throws(() => appendMasterCandidateToRegister({ register, candidate, policy, recordedAt: '2026-08-13T18:24:00.000Z' }), /already registered/);
});

test('canonical C1.12 registers truthfully remain empty because no real Audio Lock or Master acceptance exists', () => {
  assert.equal(validateAudioLockRegister(canonicalAudioRegister, { policy }).revision, 0);
  assert.equal(validateMasterCandidateRegister(canonicalMasterRegister, { policy }).revision, 0);
  const state = classifyMasterReadiness({ policy, renderCandidate: null, audioLockRegister: canonicalAudioRegister, masterRegister: canonicalMasterRegister });
  assert.equal(state.status, 'BLOCKED_NO_RENDER_CANDIDATE');
  assert.equal(state.activeAudioLock, false);
  assert.equal(state.masterCandidateCount, 0);
  assert.equal(state.publicRelease, false);
});
