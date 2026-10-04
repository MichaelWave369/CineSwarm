import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson } from '../src/authorization-seal.js';
import {
  appendLockedPictureToRegister,
  buildPictureLockRegister,
  validateLockedPictureManifest,
} from '../src/picture-lock.js';
import {
  appendRenderCandidateToRegister,
  buildAudioConformManifest,
  buildLockedRenderContract,
  buildRenderCandidate,
  buildRenderCandidateRegister,
  buildRenderQcReport,
  classifyLockedRenderState,
  validateActiveLockedPicture,
  validateAudioConformManifest,
  validateAudioConformReview,
  validateLockedRenderContract,
  validateLockedRenderPolicy,
  validateRenderCandidate,
  validateRenderCandidateRegister,
  validateRenderQcReport,
  verifyLockedRenderInputFiles,
} from '../src/locked-render-audio.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const now = '2026-08-13T11:05:00-07:00';
const later = '2026-08-13T11:06:00-07:00';

const c110Policy = {
  schema: 'parallax.cineswarm.picture-lock-policy.c1.10.v0.1',
  policyId: 'pn0001-seq01-picture-lock-policy',
  episodeId: 'episode_pn_0001',
  sequenceId: 'pn0001-seq01-cold-open',
  signatureAlgorithm: 'Ed25519',
  privateKeyCustody: 'external-human-controlled',
  requireApprovedC1_9PlanReview: true,
  requireExactPlanHash: true,
  requireExactReviewHash: true,
  requireExactCandidateRegistryHash: true,
  requireExactShotSelectionDigest: true,
  requireHumanSignature: true,
  requireExplicitUnlockForRevision: true,
  requireExplicitSupersession: true,
  appendOnlyLockRegister: true,
  autoPictureLock: false,
  canonAuthority: false,
  ledgerPromotionAuthority: false,
  publicRelease: false,
  relayDependency: false,
};

const policy = {
  schema: 'parallax.cineswarm.locked-render-policy.c1.11.v0.1',
  policyId: 'pn0001-seq01-locked-render-policy',
  episodeId: 'episode_pn_0001',
  sequenceId: 'pn0001-seq01-cold-open',
  requireActivePictureLock: true,
  requireExactLockedArtifactHashes: true,
  requireHumanAudioConformReview: true,
  requireMeasuredRenderQc: true,
  requireVideoStream: true,
  requireAudioStream: true,
  requireExactTimelineDuration: true,
  output: { width: 1280, height: 720, fps: 24, videoCodec: 'h264', audioCodec: 'aac' },
  audio: { sampleRateHz: 48000, channels: 2, integratedLufsTarget: -16, integratedLufsTolerance: 1, maxTruePeakDbtp: -1.5, standardMeaning: 'internal-parallax-target-not-external-broadcast-compliance' },
  qc: { durationToleranceSeconds: 0.15 },
  autoMasterAcceptance: false,
  audioLockAuthority: false,
  canonAuthority: false,
  ledgerPromotionAuthority: false,
  publicRelease: false,
  relayDependency: false,
};

function buildLockedFixture(artifactHashes = [sha('picture-1'), sha('picture-2'), sha('picture-3')]) {
  const shots = [
    { shotIndex: 1, shotTitle: 'Content Flood', durationSeconds: 7, candidateAssetId: 'asset-1', candidateEntryHash: sha('entry-1'), artifactSha256: artifactHashes[0], requestId: 'req-1', requestDigest: sha('req-1'), continuityVersion: 'visual-world-v1' },
    { shotIndex: 2, shotTitle: 'Meaning Fracture', durationSeconds: 6, candidateAssetId: 'asset-2', candidateEntryHash: sha('entry-2'), artifactSha256: artifactHashes[1], requestId: 'req-2', requestDigest: sha('req-2'), continuityVersion: 'visual-world-v1' },
    { shotIndex: 3, shotTitle: 'Stable Signal', durationSeconds: 7, candidateAssetId: 'asset-3', candidateEntryHash: sha('entry-3'), artifactSha256: artifactHashes[2], requestId: 'req-3', requestDigest: sha('req-3'), continuityVersion: 'visual-world-v1' },
  ];
  const manifest = {
    schema: 'parallax.cineswarm.locked-picture-manifest.c1.10.v0.1',
    manifestId: 'pn0001-seq01-locked-picture-proof',
    policyId: c110Policy.policyId,
    episodeId: c110Policy.episodeId,
    sequenceId: c110Policy.sequenceId,
    state: 'PICTURE_LOCKED',
    lockCeremonyId: 'lock-proof-1',
    lockCeremonyHash: sha('lock-ceremony'),
    lockAuthority: { kind: 'human', id: 'michael-hughes' },
    lockedAt: now,
    planId: 'plan-proof-1',
    planHash: sha('plan-proof-1'),
    reviewId: 'review-proof-1',
    reviewHash: sha('review-proof-1'),
    candidateRegistryId: 'registry-proof-1',
    candidateRegistryRevision: 3,
    candidateRegistryHash: sha('candidate-registry'),
    sequenceJobDigest: sha('sequence-job'),
    continuityVersion: 'visual-world-v1',
    shotSelectionDigest: sha('shot-selection'),
    shotCount: 3,
    totalDurationSeconds: 20,
    shots,
    pictureLocked: true,
    immutableManifest: true,
    changesRequireExplicitUnlock: true,
    supersessionRecordedInRegister: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  manifest.manifestHash = digestJson(manifest);
  validateLockedPictureManifest(manifest);
  let register = buildPictureLockRegister({ policy: c110Policy, entries: [], revision: 0, recordedAt: now });
  register = appendLockedPictureToRegister({ register, manifest, policy: c110Policy, recordedAt: now });
  return { manifest, register };
}

function buildAudio(manifest, mix = {}) {
  const mixAsset = {
    relativePath: 'mix/pn0001-seq01-mix.wav',
    sha256: mix.sha256 ?? sha('audio-mix'),
    sizeBytes: mix.sizeBytes ?? 12345,
    mediaType: 'audio/wav',
    durationSeconds: 20,
    sampleRateHz: 48000,
    channels: 2,
  };
  const audio = buildAudioConformManifest({
    policy,
    lockedPictureManifest: manifest,
    mixAsset,
    tracks: [
      { trackId: 'narration-main', kind: 'narration', sourceSha256: sha('narration'), sourceLineage: 'proof-human-narration', rightsStatus: 'original-user-provided', startSeconds: 0, endSeconds: 20, voiceConsentStatus: 'confirmed-human' },
      { trackId: 'music-bed', kind: 'music', sourceSha256: sha('music'), sourceLineage: 'proof-original-music', rightsStatus: 'original-user-provided', startSeconds: 0, endSeconds: 20 },
    ],
    createdAt: now,
  });
  const review = {
    schema: 'parallax.cineswarm.audio-conform-review.c1.11.v0.1',
    reviewId: 'audio-review-proof-1',
    authority: { kind: 'human', id: 'michael-hughes' },
    simulated: false,
    decision: 'APPROVE_FOR_RENDER',
    audioConformManifestId: audio.manifestId,
    audioConformHash: audio.audioConformHash,
    recordedAt: later,
    notes: 'Proof review: timeline and mix are acceptable for render-contract testing.',
    audioLocked: false,
    masterAccepted: false,
    publicRelease: false,
  };
  return { audio, review };
}

function buildContractFixture({ manifest, register, audio, review, picturePaths = ['shot1.png', 'shot2.png', 'shot3.png'] }) {
  return buildLockedRenderContract({
    policy,
    lockedPictureManifest: manifest,
    pictureLockRegister: register,
    audioConformManifest: audio,
    audioConformReview: review,
    pictureInputs: manifest.shots.map((shot, index) => ({ shotIndex: shot.shotIndex, artifactSha256: shot.artifactSha256, relativePath: picturePaths[index] })),
    createdAt: later,
  });
}

test('C1.11 policy freezes internal render/audio QC targets without claiming downstream authority', () => {
  assert.equal(validateLockedRenderPolicy(policy).valid, true);
  const bad = structuredClone(policy);
  bad.publicRelease = true;
  assert.throws(() => validateLockedRenderPolicy(bad), /publicRelease must remain false/);
  const wrongMeaning = structuredClone(policy);
  wrongMeaning.audio.standardMeaning = 'broadcast-standard';
  assert.throws(() => validateLockedRenderPolicy(wrongMeaning), /internal Parallax target/);
});

test('C1.11 refuses render work unless an exact C1.10 manifest is the current active Picture Lock', () => {
  const { manifest, register } = buildLockedFixture();
  assert.equal(validateActiveLockedPicture({ manifest, pictureLockRegister: register }).valid, true);
  const empty = buildPictureLockRegister({ policy: c110Policy, entries: [], revision: 0, recordedAt: now });
  assert.throws(() => validateActiveLockedPicture({ manifest, pictureLockRegister: empty }), /active C1.10 Picture Lock/);
});

test('audio conform binds the locked timeline, 48 kHz stereo mix, narration lineage, rights, and voice consent', () => {
  const { manifest } = buildLockedFixture();
  const { audio } = buildAudio(manifest);
  assert.equal(validateAudioConformManifest(audio, { policy, lockedPictureManifest: manifest }).valid, true);
  const drift = structuredClone(audio);
  drift.mixAsset.durationSeconds = 19;
  drift.audioConformHash = digestJson({ ...drift, audioConformHash: undefined });
  assert.throws(() => validateAudioConformManifest(drift, { policy, lockedPictureManifest: manifest }), /locked picture drift|self-hash|duration/);
  assert.throws(() => buildAudioConformManifest({
    policy,
    lockedPictureManifest: manifest,
    mixAsset: { relativePath: 'mix.wav', sha256: sha('mix'), sizeBytes: 1, mediaType: 'audio/wav', durationSeconds: 20, sampleRateHz: 48000, channels: 2 },
    tracks: [{ trackId: 'narration', kind: 'narration', sourceSha256: sha('voice'), sourceLineage: 'unknown', rightsStatus: 'original-user-provided', startSeconds: 0, endSeconds: 20, voiceConsentStatus: 'unknown' }],
    createdAt: now,
  }), /voice consent/);
});

test('human audio conform review can approve rendering but cannot create Audio Lock, Master acceptance, or release', () => {
  const { manifest } = buildLockedFixture();
  const { audio, review } = buildAudio(manifest);
  assert.equal(validateAudioConformReview(review, audio).approvedForRender, true);
  const simulated = structuredClone(review);
  simulated.simulated = true;
  assert.throws(() => validateAudioConformReview(simulated, audio), /real, not simulated/);
  const overreach = structuredClone(review);
  overreach.audioLocked = true;
  assert.throws(() => validateAudioConformReview(overreach, audio), /cannot grant Audio Lock/);
});

test('render contract selects only exact Picture-Locked hashes and approved audio conform lineage', () => {
  const { manifest, register } = buildLockedFixture();
  const { audio, review } = buildAudio(manifest);
  const contract = buildContractFixture({ manifest, register, audio, review });
  assert.equal(validateLockedRenderContract(contract, { policy, lockedPictureManifest: manifest, pictureLockRegister: register, audioConformManifest: audio, audioConformReview: review }).valid, true);
  const swapped = structuredClone(contract);
  swapped.shots[1].artifactSha256 = sha('swapped');
  assert.throws(() => validateLockedRenderContract(swapped, { policy, lockedPictureManifest: manifest }), /self-hash|drift/);
});

test('filesystem input verification rejects byte substitution after Picture Lock', () => {
  const base = mkdtempSync(join(tmpdir(), 'c111-inputs-'));
  const pictureRoot = join(base, 'pictures');
  const audioRoot = join(base, 'audio');
  mkdirSync(pictureRoot); mkdirSync(audioRoot); mkdirSync(join(audioRoot, 'mix'));
  const pictureBytes = [Buffer.from('one'), Buffer.from('two'), Buffer.from('three')];
  const paths = ['shot1.png', 'shot2.png', 'shot3.png'];
  paths.forEach((name, i) => writeFileSync(join(pictureRoot, name), pictureBytes[i]));
  const audioBytes = Buffer.from('audio');
  writeFileSync(join(audioRoot, 'mix', 'pn0001-seq01-mix.wav'), audioBytes);
  const hashes = pictureBytes.map((buf) => createHash('sha256').update(buf).digest('hex'));
  const { manifest, register } = buildLockedFixture(hashes);
  const { audio, review } = buildAudio(manifest, { sha256: createHash('sha256').update(audioBytes).digest('hex'), sizeBytes: audioBytes.length });
  const contract = buildContractFixture({ manifest, register, audio, review, picturePaths: paths });
  assert.equal(verifyLockedRenderInputFiles(contract, { pictureRootDir: pictureRoot, audioRootDir: audioRoot }).valid, true);
  writeFileSync(join(pictureRoot, 'shot2.png'), 'tampered');
  assert.throws(() => verifyLockedRenderInputFiles(contract, { pictureRootDir: pictureRoot, audioRootDir: audioRoot }), /does not match Picture Lock/);
});

test('render contract rejects path traversal before FFmpeg can see an input path', () => {
  const { manifest, register } = buildLockedFixture();
  const { audio, review } = buildAudio(manifest);
  assert.throws(() => buildContractFixture({ manifest, register, audio, review, picturePaths: ['shot1.png', '../escape.png', 'shot3.png'] }), /relative path without traversal/);
});

test('measured render QC independently gates duration, streams, dimensions, 48 kHz stereo, loudness and true peak', () => {
  const { manifest, register } = buildLockedFixture();
  const { audio, review } = buildAudio(manifest);
  const contract = buildContractFixture({ manifest, register, audio, review });
  const qc = buildRenderQcReport({
    policy,
    contract,
    outputAsset: { relativePath: 'renders/candidate.mp4', sha256: sha('mp4'), sizeBytes: 5000, mediaType: 'video/mp4' },
    measured: { durationSeconds: 20.02, videoStreamCount: 1, audioStreamCount: 1, width: 1280, height: 720, sampleRateHz: 48000, channels: 2, integratedLufs: -16.2, truePeakDbtp: -2.0 },
    measuredAt: later,
  });
  assert.equal(qc.status, 'PASSED');
  assert.equal(validateRenderQcReport(qc, { policy, contract }).passed, true);
  const bad = buildRenderQcReport({
    policy,
    contract,
    outputAsset: { relativePath: 'renders/bad.mp4', sha256: sha('bad-mp4'), sizeBytes: 5000, mediaType: 'video/mp4' },
    measured: { durationSeconds: 20, videoStreamCount: 1, audioStreamCount: 1, width: 1280, height: 720, sampleRateHz: 48000, channels: 2, integratedLufs: -20, truePeakDbtp: -2.0 },
    measuredAt: later,
  });
  assert.equal(bad.status, 'FAILED');
});

test('Render Candidate requires PASSED measured QC and still cannot become Master, Canon, Ledger promotion, or public release', () => {
  const { manifest, register } = buildLockedFixture();
  const { audio, review } = buildAudio(manifest);
  const contract = buildContractFixture({ manifest, register, audio, review });
  const qc = buildRenderQcReport({ policy, contract, outputAsset: { relativePath: 'renders/candidate.mp4', sha256: sha('mp4'), sizeBytes: 5000, mediaType: 'video/mp4' }, measured: { durationSeconds: 20, videoStreamCount: 1, audioStreamCount: 1, width: 1280, height: 720, sampleRateHz: 48000, channels: 2, integratedLufs: -16, truePeakDbtp: -1.8 }, measuredAt: later });
  const candidate = buildRenderCandidate({ policy, contract, qcReport: qc, createdAt: later });
  assert.equal(validateRenderCandidate(candidate, { policy, contract, qcReport: qc }).valid, true);
  assert.equal(candidate.masterAccepted, false);
  assert.equal(candidate.audioLocked, false);
  assert.equal(candidate.canonEligible, false);
  assert.equal(candidate.ledgerPromotionEligible, false);
  assert.equal(candidate.publicRelease, false);
});

test('Render Candidate Register is append-only and records candidates without laundering them into accepted masters', () => {
  const { manifest, register } = buildLockedFixture();
  const { audio, review } = buildAudio(manifest);
  const contract = buildContractFixture({ manifest, register, audio, review });
  const qc = buildRenderQcReport({ policy, contract, outputAsset: { relativePath: 'renders/candidate.mp4', sha256: sha('mp4'), sizeBytes: 5000, mediaType: 'video/mp4' }, measured: { durationSeconds: 20, videoStreamCount: 1, audioStreamCount: 1, width: 1280, height: 720, sampleRateHz: 48000, channels: 2, integratedLufs: -16, truePeakDbtp: -1.8 }, measuredAt: later });
  const candidate = buildRenderCandidate({ policy, contract, qcReport: qc, createdAt: later });
  let renderRegister = buildRenderCandidateRegister({ policy, entries: [], revision: 0, recordedAt: now });
  renderRegister = appendRenderCandidateToRegister({ register: renderRegister, candidate, policy, recordedAt: later });
  assert.equal(validateRenderCandidateRegister(renderRegister, { policy }).valid, true);
  assert.equal(renderRegister.renderCandidateCount, 1);
  assert.equal(renderRegister.masterAcceptedCount, 0);
  assert.throws(() => appendRenderCandidateToRegister({ register: renderRegister, candidate, policy, recordedAt: later }), /already registered/);
});

test('canonical pre-production state remains blocked when no active Picture Lock exists', () => {
  const emptyPicture = buildPictureLockRegister({ policy: c110Policy, entries: [], revision: 0, recordedAt: now });
  const emptyRender = buildRenderCandidateRegister({ policy, entries: [], revision: 0, recordedAt: now });
  const status = classifyLockedRenderState({ policy, pictureLockRegister: emptyPicture, renderRegister: emptyRender });
  assert.equal(status.status, 'BLOCKED_NO_ACTIVE_PICTURE_LOCK');
  assert.equal(status.renderCandidateCount, 0);
  assert.equal(status.masterAcceptedCount, 0);
  assert.equal(status.canonEligibleCount, 0);
  assert.equal(status.publicRelease, false);
});


test('C1.11 canonical PN-0001 Render Candidate Register remains revision 0 with no Audio Conform, Render Candidate, Master, Canon, or release claim', () => {
  const base = new URL('../../../fixtures/cineswarm/', import.meta.url);
  const canonicalPolicy = JSON.parse(readFileSync(new URL('pn-0001-c1-11-locked-render-policy.json', base), 'utf8'));
  const canonicalPictureRegister = JSON.parse(readFileSync(new URL('pn-0001-c1-10-picture-lock-register.json', base), 'utf8'));
  const canonicalRenderRegister = JSON.parse(readFileSync(new URL('pn-0001-c1-11-render-candidate-register.json', base), 'utf8'));
  assert.equal(validateRenderCandidateRegister(canonicalRenderRegister, { policy: canonicalPolicy }).valid, true);
  const status = classifyLockedRenderState({ policy: canonicalPolicy, pictureLockRegister: canonicalPictureRegister, renderRegister: canonicalRenderRegister });
  assert.equal(canonicalRenderRegister.revision, 0);
  assert.equal(canonicalRenderRegister.renderCandidateCount, 0);
  assert.equal(status.status, 'BLOCKED_NO_ACTIVE_PICTURE_LOCK');
  assert.equal(status.masterAcceptedCount, 0);
  assert.equal(status.audioLockedCount, 0);
  assert.equal(status.canonEligibleCount, 0);
  assert.equal(status.publicRelease, false);
});
