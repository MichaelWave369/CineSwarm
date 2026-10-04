import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import { digestJson } from './authorization-seal.js';
import {
  classifyPictureLockRegister,
  validateLockedPictureManifest,
  validatePictureLockRegister,
} from './picture-lock.js';

export const CINESWARM_LOCKED_RENDER_POLICY_SCHEMA = 'parallax.cineswarm.locked-render-policy.c1.11.v0.1';
export const CINESWARM_AUDIO_CONFORM_MANIFEST_SCHEMA = 'parallax.cineswarm.audio-conform-manifest.c1.11.v0.1';
export const CINESWARM_AUDIO_CONFORM_REVIEW_SCHEMA = 'parallax.cineswarm.audio-conform-review.c1.11.v0.1';
export const CINESWARM_LOCKED_RENDER_CONTRACT_SCHEMA = 'parallax.cineswarm.locked-render-contract.c1.11.v0.1';
export const CINESWARM_RENDER_QC_REPORT_SCHEMA = 'parallax.cineswarm.render-qc-report.c1.11.v0.1';
export const CINESWARM_RENDER_CANDIDATE_SCHEMA = 'parallax.cineswarm.render-candidate.c1.11.v0.1';
export const CINESWARM_RENDER_CANDIDATE_REGISTER_SCHEMA = 'parallax.cineswarm.render-candidate-register.c1.11.v0.1';
export const C1_11_AUDIO_REVIEW_DECISIONS = Object.freeze(['APPROVE_FOR_RENDER', 'REVISE', 'HOLD']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeToken(value, label) {
  const text = requiredString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`${label} contains unsupported characters`);
  return text;
}

function ensureSha256(value, label) {
  const text = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}

function parseTime(value, label) {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  return text;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`);
  return number;
}

function integer(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value;
}

function withoutField(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return copy;
}

function hashFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function ensureRelativePath(value, label) {
  const text = requiredString(value, label).replaceAll('\\', '/');
  if (isAbsolute(text) || text.startsWith('/') || text.split('/').includes('..')) throw new Error(`${label} must remain a relative path without traversal`);
  const cleaned = normalize(text).replaceAll('\\', '/');
  if (cleaned === '.' || cleaned.startsWith('../')) throw new Error(`${label} escapes its governed root`);
  return cleaned;
}

function resolveInside(rootDir, relativePath, label) {
  const root = resolve(rootDir);
  const target = resolve(root, ensureRelativePath(relativePath, label));
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    if (target !== root) throw new Error(`${label} escapes its governed root`);
  }
  return target;
}

export function validateLockedRenderPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('locked render policy must be an object');
  if (policy.schema !== CINESWARM_LOCKED_RENDER_POLICY_SCHEMA) throw new Error(`unsupported locked render policy schema: ${policy.schema}`);
  safeToken(policy.policyId, 'policyId');
  safeToken(policy.episodeId, 'episodeId');
  safeToken(policy.sequenceId, 'sequenceId');
  const mustTrue = [
    'requireActivePictureLock',
    'requireExactLockedArtifactHashes',
    'requireHumanAudioConformReview',
    'requireMeasuredRenderQc',
    'requireVideoStream',
    'requireAudioStream',
    'requireExactTimelineDuration',
  ];
  for (const key of mustTrue) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  const mustFalse = ['autoMasterAcceptance', 'audioLockAuthority', 'canonAuthority', 'ledgerPromotionAuthority', 'publicRelease', 'relayDependency'];
  for (const key of mustFalse) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  integer(policy.output?.width, 'output.width');
  integer(policy.output?.height, 'output.height');
  positiveNumber(policy.output?.fps, 'output.fps');
  if (policy.output.width < 640 || policy.output.height < 360) throw new Error('render output dimensions are below policy minimum');
  if (policy.output.videoCodec !== 'h264') throw new Error('C1.11 video codec must remain h264');
  if (policy.output.audioCodec !== 'aac') throw new Error('C1.11 audio codec must remain aac');
  if (policy.audio?.sampleRateHz !== 48000) throw new Error('C1.11 audio sample rate must remain 48000 Hz');
  if (policy.audio?.channels !== 2) throw new Error('C1.11 audio channels must remain stereo');
  if (Number(policy.audio?.integratedLufsTarget) !== -16) throw new Error('C1.11 internal integrated loudness target must remain -16 LUFS');
  if (Number(policy.audio?.integratedLufsTolerance) !== 1) throw new Error('C1.11 integrated loudness tolerance must remain ±1 LU');
  if (Number(policy.audio?.maxTruePeakDbtp) !== -1.5) throw new Error('C1.11 true-peak ceiling must remain -1.5 dBTP');
  if (policy.audio?.standardMeaning !== 'internal-parallax-target-not-external-broadcast-compliance') throw new Error('audio target must be labeled as an internal Parallax target');
  return { valid: true };
}

export function validateActiveLockedPicture({ manifest, pictureLockRegister }) {
  validateLockedPictureManifest(manifest);
  validatePictureLockRegister(pictureLockRegister);
  const state = classifyPictureLockRegister(pictureLockRegister);
  if (!state.pictureLocked) throw new Error('C1.11 requires an active C1.10 Picture Lock');
  if (pictureLockRegister.currentManifestHash !== manifest.manifestHash) throw new Error('active Picture Lock manifest hash mismatch');
  if (manifest.pictureLocked !== true || manifest.state !== 'PICTURE_LOCKED') throw new Error('Locked Picture Manifest is not in PICTURE_LOCKED state');
  return { valid: true, manifestHash: manifest.manifestHash, registerRevision: pictureLockRegister.revision };
}

function audioConformHashPayload(manifest) {
  return withoutField(manifest, 'audioConformHash');
}

export function buildAudioConformManifest({ policy, lockedPictureManifest, mixAsset, tracks, createdAt, manifestId = null }) {
  validateLockedRenderPolicy(policy);
  validateLockedPictureManifest(lockedPictureManifest);
  if (lockedPictureManifest.episodeId !== policy.episodeId || lockedPictureManifest.sequenceId !== policy.sequenceId) throw new Error('audio conform scope does not match render policy');
  if (!mixAsset || typeof mixAsset !== 'object') throw new Error('mixAsset must be an object');
  const normalizedTracks = Array.isArray(tracks) ? tracks.map((track, index) => ({
    trackId: safeToken(track.trackId, `tracks[${index}].trackId`),
    kind: requiredString(track.kind, `tracks[${index}].kind`),
    sourceSha256: ensureSha256(track.sourceSha256, `tracks[${index}].sourceSha256`),
    sourceLineage: requiredString(track.sourceLineage, `tracks[${index}].sourceLineage`),
    rightsStatus: requiredString(track.rightsStatus, `tracks[${index}].rightsStatus`),
    startSeconds: nonNegativeNumber(track.startSeconds, `tracks[${index}].startSeconds`),
    endSeconds: positiveNumber(track.endSeconds, `tracks[${index}].endSeconds`),
    voiceConsentStatus: track.kind === 'narration' ? requiredString(track.voiceConsentStatus, `tracks[${index}].voiceConsentStatus`) : null,
  })) : [];
  if (!normalizedTracks.some((track) => track.kind === 'narration')) throw new Error('audio conform requires a narration track');
  for (const track of normalizedTracks) {
    if (track.endSeconds <= track.startSeconds) throw new Error(`audio track ${track.trackId} endSeconds must be after startSeconds`);
    if (track.endSeconds > lockedPictureManifest.totalDurationSeconds + 0.001) throw new Error(`audio track ${track.trackId} exceeds locked picture duration`);
    if (track.kind === 'narration' && !['confirmed-human', 'confirmed-synthetic-with-authorized-voice'].includes(track.voiceConsentStatus)) throw new Error('narration voice consent posture is not sufficient');
  }
  const id = manifestId ?? `${policy.sequenceId}-audio-conform-${lockedPictureManifest.manifestHash.slice(0, 12)}`;
  const manifest = {
    schema: CINESWARM_AUDIO_CONFORM_MANIFEST_SCHEMA,
    manifestId: safeToken(id, 'manifestId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    lockedPictureManifestId: lockedPictureManifest.manifestId,
    lockedPictureManifestHash: lockedPictureManifest.manifestHash,
    timelineDurationSeconds: lockedPictureManifest.totalDurationSeconds,
    tracks: normalizedTracks,
    mixAsset: {
      relativePath: ensureRelativePath(mixAsset.relativePath, 'mixAsset.relativePath'),
      sha256: ensureSha256(mixAsset.sha256, 'mixAsset.sha256'),
      sizeBytes: integer(mixAsset.sizeBytes, 'mixAsset.sizeBytes'),
      mediaType: requiredString(mixAsset.mediaType, 'mixAsset.mediaType'),
      durationSeconds: positiveNumber(mixAsset.durationSeconds, 'mixAsset.durationSeconds'),
      sampleRateHz: integer(mixAsset.sampleRateHz, 'mixAsset.sampleRateHz'),
      channels: integer(mixAsset.channels, 'mixAsset.channels'),
    },
    createdAt: parseTime(createdAt, 'createdAt'),
    humanReviewRequired: true,
    audioLocked: false,
    masterAccepted: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  if (Math.abs(manifest.mixAsset.durationSeconds - manifest.timelineDurationSeconds) > 0.05) throw new Error('audio mix duration does not conform to locked picture timeline');
  if (manifest.mixAsset.sampleRateHz !== policy.audio.sampleRateHz || manifest.mixAsset.channels !== policy.audio.channels) throw new Error('audio mix sample-rate/channel conform failed');
  manifest.audioConformHash = digestJson(audioConformHashPayload(manifest));
  return manifest;
}

export function validateAudioConformManifest(manifest, { policy = null, lockedPictureManifest = null } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('audio conform manifest must be an object');
  if (manifest.schema !== CINESWARM_AUDIO_CONFORM_MANIFEST_SCHEMA) throw new Error(`unsupported audio conform manifest schema: ${manifest.schema}`);
  safeToken(manifest.manifestId, 'manifestId');
  safeToken(manifest.policyId, 'policyId');
  safeToken(manifest.episodeId, 'episodeId');
  safeToken(manifest.sequenceId, 'sequenceId');
  safeToken(manifest.lockedPictureManifestId, 'lockedPictureManifestId');
  ensureSha256(manifest.lockedPictureManifestHash, 'lockedPictureManifestHash');
  positiveNumber(manifest.timelineDurationSeconds, 'timelineDurationSeconds');
  if (!Array.isArray(manifest.tracks) || !manifest.tracks.some((track) => track.kind === 'narration')) throw new Error('audio conform manifest requires narration lineage');
  for (const track of manifest.tracks) {
    safeToken(track.trackId, 'trackId');
    requiredString(track.kind, 'track.kind');
    ensureSha256(track.sourceSha256, 'track.sourceSha256');
    requiredString(track.sourceLineage, 'track.sourceLineage');
    requiredString(track.rightsStatus, 'track.rightsStatus');
    const start = nonNegativeNumber(track.startSeconds, 'track.startSeconds');
    const end = positiveNumber(track.endSeconds, 'track.endSeconds');
    if (end <= start || end > Number(manifest.timelineDurationSeconds) + 0.001) throw new Error(`audio track ${track.trackId} timeline conform failed`);
    if (track.kind === 'narration' && !['confirmed-human', 'confirmed-synthetic-with-authorized-voice'].includes(track.voiceConsentStatus)) throw new Error('narration voice consent posture is not sufficient');
  }
  ensureRelativePath(manifest.mixAsset?.relativePath, 'mixAsset.relativePath');
  ensureSha256(manifest.mixAsset?.sha256, 'mixAsset.sha256');
  integer(manifest.mixAsset?.sizeBytes, 'mixAsset.sizeBytes');
  positiveNumber(manifest.mixAsset?.durationSeconds, 'mixAsset.durationSeconds');
  if (Math.abs(Number(manifest.mixAsset.durationSeconds) - Number(manifest.timelineDurationSeconds)) > 0.05) throw new Error('audio mix duration does not conform to locked picture timeline');
  integer(manifest.mixAsset?.sampleRateHz, 'mixAsset.sampleRateHz');
  integer(manifest.mixAsset?.channels, 'mixAsset.channels');
  parseTime(manifest.createdAt, 'createdAt');
  if (manifest.humanReviewRequired !== true || manifest.audioLocked !== false || manifest.masterAccepted !== false || manifest.canonEligible !== false || manifest.ledgerPromotionEligible !== false || manifest.publicRelease !== false || manifest.relayDependency !== false) throw new Error('audio conform manifest violates downstream authority boundaries');
  ensureSha256(manifest.audioConformHash, 'audioConformHash');
  if (manifest.audioConformHash !== digestJson(audioConformHashPayload(manifest))) throw new Error('audio conform manifest self-hash mismatch');
  if (policy) {
    validateLockedRenderPolicy(policy);
    if (manifest.policyId !== policy.policyId || manifest.episodeId !== policy.episodeId || manifest.sequenceId !== policy.sequenceId) throw new Error('audio conform policy scope mismatch');
    if (manifest.mixAsset.sampleRateHz !== policy.audio.sampleRateHz || manifest.mixAsset.channels !== policy.audio.channels) throw new Error('audio conform format violates policy');
  }
  if (lockedPictureManifest) {
    validateLockedPictureManifest(lockedPictureManifest);
    if (manifest.lockedPictureManifestHash !== lockedPictureManifest.manifestHash || manifest.timelineDurationSeconds !== lockedPictureManifest.totalDurationSeconds) throw new Error('audio conform locked picture drift detected');
  }
  return { valid: true, audioConformHash: manifest.audioConformHash };
}

export function validateAudioConformReview(review, audioConformManifest) {
  validateAudioConformManifest(audioConformManifest);
  if (!review || typeof review !== 'object') throw new Error('audio conform review must be an object');
  if (review.schema !== CINESWARM_AUDIO_CONFORM_REVIEW_SCHEMA) throw new Error(`unsupported audio conform review schema: ${review.schema}`);
  safeToken(review.reviewId, 'reviewId');
  if (review.authority?.kind !== 'human') throw new Error('audio conform review requires human authority');
  safeToken(review.authority?.id, 'authority.id');
  if (review.simulated !== false) throw new Error('audio conform review must be real, not simulated');
  if (!C1_11_AUDIO_REVIEW_DECISIONS.includes(review.decision)) throw new Error('unsupported audio conform review decision');
  if (review.audioConformManifestId !== audioConformManifest.manifestId || review.audioConformHash !== audioConformManifest.audioConformHash) throw new Error('audio conform review manifest/hash mismatch');
  parseTime(review.recordedAt, 'recordedAt');
  requiredString(review.notes, 'notes');
  if (review.audioLocked !== false || review.masterAccepted !== false || review.publicRelease !== false) throw new Error('audio conform review cannot grant Audio Lock, Master acceptance, or public release');
  return { valid: true, approvedForRender: review.decision === 'APPROVE_FOR_RENDER' };
}

function renderContractHashPayload(contract) {
  return withoutField(contract, 'contractHash');
}

export function buildLockedRenderContract({
  policy,
  lockedPictureManifest,
  pictureLockRegister,
  audioConformManifest,
  audioConformReview,
  pictureInputs,
  createdAt,
  contractId = null,
}) {
  validateLockedRenderPolicy(policy);
  validateActiveLockedPicture({ manifest: lockedPictureManifest, pictureLockRegister });
  validateAudioConformManifest(audioConformManifest, { policy, lockedPictureManifest });
  const review = validateAudioConformReview(audioConformReview, audioConformManifest);
  if (!review.approvedForRender) throw new Error('render contract requires human APPROVE_FOR_RENDER audio conform review');
  if (!Array.isArray(pictureInputs) || pictureInputs.length !== lockedPictureManifest.shots.length) throw new Error('pictureInputs must match every locked shot exactly');
  const byShot = new Map(pictureInputs.map((item) => [item.shotIndex, item]));
  if (byShot.size !== pictureInputs.length) throw new Error('pictureInputs contains duplicate shotIndex');
  const shots = lockedPictureManifest.shots.map((shot) => {
    const input = byShot.get(shot.shotIndex);
    if (!input) throw new Error(`missing render input for locked shot ${shot.shotIndex}`);
    if (input.artifactSha256 !== shot.artifactSha256) throw new Error(`render input hash drift for shot ${shot.shotIndex}`);
    return {
      shotIndex: shot.shotIndex,
      shotTitle: shot.shotTitle,
      durationSeconds: shot.durationSeconds,
      artifactSha256: shot.artifactSha256,
      candidateEntryHash: shot.candidateEntryHash,
      relativePath: ensureRelativePath(input.relativePath, `pictureInputs[${shot.shotIndex}].relativePath`),
    };
  });
  const id = contractId ?? `${policy.sequenceId}-render-${lockedPictureManifest.manifestHash.slice(0, 12)}`;
  const contract = {
    schema: CINESWARM_LOCKED_RENDER_CONTRACT_SCHEMA,
    contractId: safeToken(id, 'contractId'),
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    pictureLockRegisterRevision: pictureLockRegister.revision,
    lockedPictureManifestId: lockedPictureManifest.manifestId,
    lockedPictureManifestHash: lockedPictureManifest.manifestHash,
    pictureLockCeremonyHash: lockedPictureManifest.lockCeremonyHash,
    shotSelectionDigest: lockedPictureManifest.shotSelectionDigest,
    totalDurationSeconds: lockedPictureManifest.totalDurationSeconds,
    shots,
    audioConformManifestId: audioConformManifest.manifestId,
    audioConformHash: audioConformManifest.audioConformHash,
    audioConformReviewId: audioConformReview.reviewId,
    audioConformReviewHash: digestJson(audioConformReview),
    audioMix: structuredClone(audioConformManifest.mixAsset),
    output: structuredClone(policy.output),
    createdAt: parseTime(createdAt, 'createdAt'),
    renderCandidateOnly: true,
    masterAcceptanceRequired: true,
    masterAccepted: false,
    audioLocked: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  contract.contractHash = digestJson(renderContractHashPayload(contract));
  return contract;
}

export function validateLockedRenderContract(contract, { policy = null, lockedPictureManifest = null, pictureLockRegister = null, audioConformManifest = null, audioConformReview = null } = {}) {
  if (!contract || typeof contract !== 'object') throw new Error('locked render contract must be an object');
  if (contract.schema !== CINESWARM_LOCKED_RENDER_CONTRACT_SCHEMA) throw new Error(`unsupported locked render contract schema: ${contract.schema}`);
  safeToken(contract.contractId, 'contractId');
  safeToken(contract.policyId, 'policyId');
  safeToken(contract.episodeId, 'episodeId');
  safeToken(contract.sequenceId, 'sequenceId');
  integer(contract.pictureLockRegisterRevision, 'pictureLockRegisterRevision');
  safeToken(contract.lockedPictureManifestId, 'lockedPictureManifestId');
  ensureSha256(contract.lockedPictureManifestHash, 'lockedPictureManifestHash');
  ensureSha256(contract.pictureLockCeremonyHash, 'pictureLockCeremonyHash');
  ensureSha256(contract.shotSelectionDigest, 'shotSelectionDigest');
  positiveNumber(contract.totalDurationSeconds, 'totalDurationSeconds');
  if (!Array.isArray(contract.shots) || !contract.shots.length) throw new Error('locked render contract requires shots');
  if (new Set(contract.shots.map((shot) => shot.shotIndex)).size !== contract.shots.length) throw new Error('locked render contract contains duplicate shotIndex');
  if (new Set(contract.shots.map((shot) => shot.artifactSha256)).size !== contract.shots.length) throw new Error('locked render contract contains duplicate artifact hashes');
  let duration = 0;
  for (const shot of contract.shots) {
    if (!Number.isInteger(shot.shotIndex) || shot.shotIndex <= 0) throw new Error('contract shotIndex must be positive integer');
    requiredString(shot.shotTitle, 'shotTitle');
    duration += positiveNumber(shot.durationSeconds, 'shot.durationSeconds');
    ensureSha256(shot.artifactSha256, 'shot.artifactSha256');
    ensureSha256(shot.candidateEntryHash, 'shot.candidateEntryHash');
    ensureRelativePath(shot.relativePath, 'shot.relativePath');
  }
  if (Math.abs(duration - Number(contract.totalDurationSeconds)) > 0.001) throw new Error('locked render contract duration mismatch');
  safeToken(contract.audioConformManifestId, 'audioConformManifestId');
  ensureSha256(contract.audioConformHash, 'audioConformHash');
  safeToken(contract.audioConformReviewId, 'audioConformReviewId');
  ensureSha256(contract.audioConformReviewHash, 'audioConformReviewHash');
  ensureRelativePath(contract.audioMix?.relativePath, 'audioMix.relativePath');
  ensureSha256(contract.audioMix?.sha256, 'audioMix.sha256');
  integer(contract.audioMix?.sizeBytes, 'audioMix.sizeBytes');
  positiveNumber(contract.audioMix?.durationSeconds, 'audioMix.durationSeconds');
  parseTime(contract.createdAt, 'createdAt');
  if (contract.renderCandidateOnly !== true || contract.masterAcceptanceRequired !== true || contract.masterAccepted !== false || contract.audioLocked !== false || contract.canonEligible !== false || contract.ledgerPromotionEligible !== false || contract.publicRelease !== false || contract.relayDependency !== false) throw new Error('locked render contract violates downstream authority boundaries');
  ensureSha256(contract.contractHash, 'contractHash');
  if (contract.contractHash !== digestJson(renderContractHashPayload(contract))) throw new Error('locked render contract self-hash mismatch');
  if (policy) {
    validateLockedRenderPolicy(policy);
    if (contract.policyId !== policy.policyId || contract.episodeId !== policy.episodeId || contract.sequenceId !== policy.sequenceId) throw new Error('render contract policy scope mismatch');
    if (digestJson(contract.output) !== digestJson(policy.output)) throw new Error('render contract output profile drift detected');
  }
  if (lockedPictureManifest) {
    validateLockedPictureManifest(lockedPictureManifest);
    if (contract.lockedPictureManifestHash !== lockedPictureManifest.manifestHash || contract.shotSelectionDigest !== lockedPictureManifest.shotSelectionDigest || contract.totalDurationSeconds !== lockedPictureManifest.totalDurationSeconds) throw new Error('render contract Locked Picture Manifest drift detected');
    if (digestJson(contract.shots.map(({ relativePath, ...shot }) => shot)) !== digestJson(lockedPictureManifest.shots.map((shot) => ({
      shotIndex: shot.shotIndex,
      shotTitle: shot.shotTitle,
      durationSeconds: shot.durationSeconds,
      artifactSha256: shot.artifactSha256,
      candidateEntryHash: shot.candidateEntryHash,
    })))) throw new Error('render contract shot selection drift detected');
  }
  if (pictureLockRegister) validateActiveLockedPicture({ manifest: lockedPictureManifest, pictureLockRegister });
  if (audioConformManifest) {
    validateAudioConformManifest(audioConformManifest, policy && lockedPictureManifest ? { policy, lockedPictureManifest } : {});
    if (contract.audioConformHash !== audioConformManifest.audioConformHash || contract.audioMix.sha256 !== audioConformManifest.mixAsset.sha256) throw new Error('render contract audio conform drift detected');
  }
  if (audioConformReview) {
    if (!audioConformManifest) throw new Error('audioConformManifest is required to validate audio review linkage');
    const review = validateAudioConformReview(audioConformReview, audioConformManifest);
    if (!review.approvedForRender || contract.audioConformReviewHash !== digestJson(audioConformReview)) throw new Error('render contract audio review drift detected');
  }
  return { valid: true, contractHash: contract.contractHash };
}

export function verifyLockedRenderInputFiles(contract, { pictureRootDir, audioRootDir }) {
  validateLockedRenderContract(contract);
  const verifiedShots = contract.shots.map((shot) => {
    const path = resolveInside(pictureRootDir, shot.relativePath, `shot ${shot.shotIndex} relativePath`);
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error(`shot ${shot.shotIndex} input is not a file`);
    const sha256 = hashFile(path);
    if (sha256 !== shot.artifactSha256) throw new Error(`shot ${shot.shotIndex} file SHA-256 does not match Picture Lock`);
    return { shotIndex: shot.shotIndex, path, sha256, sizeBytes: stat.size };
  });
  const audioPath = resolveInside(audioRootDir, contract.audioMix.relativePath, 'audioMix.relativePath');
  const audioStat = statSync(audioPath);
  if (!audioStat.isFile()) throw new Error('audio mix input is not a file');
  const audioSha256 = hashFile(audioPath);
  if (audioSha256 !== contract.audioMix.sha256 || audioStat.size !== contract.audioMix.sizeBytes) throw new Error('audio mix file does not match audio conform manifest');
  return { valid: true, verifiedShots, audio: { path: audioPath, sha256: audioSha256, sizeBytes: audioStat.size } };
}

export function buildFfmpegRenderArgs(contract, { pictureRootDir, audioRootDir, outputPath }) {
  const verified = verifyLockedRenderInputFiles(contract, { pictureRootDir, audioRootDir });
  const args = ['-y'];
  for (let i = 0; i < verified.verifiedShots.length; i += 1) {
    const shot = contract.shots[i];
    args.push('-loop', '1', '-t', String(shot.durationSeconds), '-i', verified.verifiedShots[i].path);
  }
  args.push('-i', verified.audio.path);
  const filters = contract.shots.map((shot, index) => `[${index}:v]scale=${contract.output.width}:${contract.output.height}:force_original_aspect_ratio=decrease,pad=${contract.output.width}:${contract.output.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${contract.output.fps},format=yuv420p[v${index}]`);
  filters.push(`${contract.shots.map((_, index) => `[v${index}]`).join('')}concat=n=${contract.shots.length}:v=1:a=0[vout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', `${contract.shots.length}:a:0`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(contract.output.fps),
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-t', String(contract.totalDurationSeconds),
    '-movflags', '+faststart',
    outputPath,
  );
  return args;
}

function qcHashPayload(report) {
  return withoutField(report, 'qcHash');
}

export function buildRenderQcReport({ policy, contract, outputAsset, measured, measuredAt, reportId = null }) {
  validateLockedRenderPolicy(policy);
  validateLockedRenderContract(contract, { policy });
  const id = reportId ?? `${contract.sequenceId}-render-qc-${contract.contractHash.slice(0, 12)}`;
  const durationSeconds = positiveNumber(measured.durationSeconds, 'measured.durationSeconds');
  const integratedLufs = Number(measured.integratedLufs);
  const truePeakDbtp = Number(measured.truePeakDbtp);
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) throw new Error('measured loudness values must be finite numbers');
  const durationPass = Math.abs(durationSeconds - contract.totalDurationSeconds) <= Number(policy.qc.durationToleranceSeconds);
  const videoPass = integer(measured.videoStreamCount, 'measured.videoStreamCount') >= 1 && integer(measured.width, 'measured.width') === policy.output.width && integer(measured.height, 'measured.height') === policy.output.height;
  const audioStreamPass = integer(measured.audioStreamCount, 'measured.audioStreamCount') >= 1 && integer(measured.sampleRateHz, 'measured.sampleRateHz') === policy.audio.sampleRateHz && integer(measured.channels, 'measured.channels') === policy.audio.channels;
  const loudnessPass = Math.abs(integratedLufs - policy.audio.integratedLufsTarget) <= policy.audio.integratedLufsTolerance;
  const truePeakPass = truePeakDbtp <= policy.audio.maxTruePeakDbtp;
  const report = {
    schema: CINESWARM_RENDER_QC_REPORT_SCHEMA,
    reportId: safeToken(id, 'reportId'),
    policyId: policy.policyId,
    episodeId: contract.episodeId,
    sequenceId: contract.sequenceId,
    renderContractId: contract.contractId,
    renderContractHash: contract.contractHash,
    lockedPictureManifestHash: contract.lockedPictureManifestHash,
    audioConformHash: contract.audioConformHash,
    outputAsset: {
      relativePath: ensureRelativePath(outputAsset.relativePath, 'outputAsset.relativePath'),
      sha256: ensureSha256(outputAsset.sha256, 'outputAsset.sha256'),
      sizeBytes: integer(outputAsset.sizeBytes, 'outputAsset.sizeBytes'),
      mediaType: requiredString(outputAsset.mediaType, 'outputAsset.mediaType'),
    },
    measured: {
      durationSeconds,
      videoStreamCount: measured.videoStreamCount,
      audioStreamCount: measured.audioStreamCount,
      width: measured.width,
      height: measured.height,
      sampleRateHz: measured.sampleRateHz,
      channels: measured.channels,
      integratedLufs,
      truePeakDbtp,
    },
    checks: { durationPass, videoPass, audioStreamPass, loudnessPass, truePeakPass },
    status: durationPass && videoPass && audioStreamPass && loudnessPass && truePeakPass ? 'PASSED' : 'FAILED',
    measuredAt: parseTime(measuredAt, 'measuredAt'),
    audioTargetMeaning: policy.audio.standardMeaning,
    masterAccepted: false,
    canonEligible: false,
    ledgerPromotionEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  report.qcHash = digestJson(qcHashPayload(report));
  return report;
}

export function validateRenderQcReport(report, { policy = null, contract = null } = {}) {
  if (!report || typeof report !== 'object') throw new Error('render QC report must be an object');
  if (report.schema !== CINESWARM_RENDER_QC_REPORT_SCHEMA) throw new Error(`unsupported render QC report schema: ${report.schema}`);
  safeToken(report.reportId, 'reportId');
  ensureSha256(report.renderContractHash, 'renderContractHash');
  ensureSha256(report.lockedPictureManifestHash, 'lockedPictureManifestHash');
  ensureSha256(report.audioConformHash, 'audioConformHash');
  ensureRelativePath(report.outputAsset?.relativePath, 'outputAsset.relativePath');
  ensureSha256(report.outputAsset?.sha256, 'outputAsset.sha256');
  integer(report.outputAsset?.sizeBytes, 'outputAsset.sizeBytes');
  parseTime(report.measuredAt, 'measuredAt');
  if (!['PASSED', 'FAILED'].includes(report.status)) throw new Error('render QC status must be PASSED or FAILED');
  const calculatedPass = Object.values(report.checks ?? {}).length === 5 && Object.values(report.checks).every((value) => value === true);
  if ((report.status === 'PASSED') !== calculatedPass) throw new Error('render QC status/check mismatch');
  if (report.masterAccepted !== false || report.canonEligible !== false || report.ledgerPromotionEligible !== false || report.publicRelease !== false || report.relayDependency !== false) throw new Error('render QC cannot grant downstream authority');
  ensureSha256(report.qcHash, 'qcHash');
  if (report.qcHash !== digestJson(qcHashPayload(report))) throw new Error('render QC report self-hash mismatch');
  if (policy) {
    validateLockedRenderPolicy(policy);
    if (report.policyId !== policy.policyId || report.audioTargetMeaning !== policy.audio.standardMeaning) throw new Error('render QC policy mismatch');
  }
  if (contract) {
    validateLockedRenderContract(contract, policy ? { policy } : {});
    if (report.renderContractId !== contract.contractId || report.renderContractHash !== contract.contractHash || report.lockedPictureManifestHash !== contract.lockedPictureManifestHash || report.audioConformHash !== contract.audioConformHash) throw new Error('render QC contract lineage drift detected');
  }
  return { valid: true, passed: report.status === 'PASSED', qcHash: report.qcHash };
}

function renderCandidateHashPayload(candidate) {
  return withoutField(candidate, 'renderCandidateHash');
}

export function buildRenderCandidate({ policy, contract, qcReport, createdAt, candidateId = null }) {
  validateLockedRenderPolicy(policy);
  validateLockedRenderContract(contract, { policy });
  const qc = validateRenderQcReport(qcReport, { policy, contract });
  if (!qc.passed) throw new Error('Render Candidate requires PASSED measured QC');
  const id = candidateId ?? `${contract.sequenceId}-render-candidate-${qcReport.outputAsset.sha256.slice(0, 12)}`;
  const candidate = {
    schema: CINESWARM_RENDER_CANDIDATE_SCHEMA,
    candidateId: safeToken(id, 'candidateId'),
    policyId: policy.policyId,
    episodeId: contract.episodeId,
    sequenceId: contract.sequenceId,
    lockedPictureManifestHash: contract.lockedPictureManifestHash,
    renderContractId: contract.contractId,
    renderContractHash: contract.contractHash,
    audioConformHash: contract.audioConformHash,
    audioConformReviewHash: contract.audioConformReviewHash,
    qcReportId: qcReport.reportId,
    qcHash: qcReport.qcHash,
    outputAsset: structuredClone(qcReport.outputAsset),
    createdAt: parseTime(createdAt, 'createdAt'),
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
  candidate.renderCandidateHash = digestJson(renderCandidateHashPayload(candidate));
  return candidate;
}

export function validateRenderCandidate(candidate, { policy = null, contract = null, qcReport = null } = {}) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Render Candidate must be an object');
  if (candidate.schema !== CINESWARM_RENDER_CANDIDATE_SCHEMA) throw new Error(`unsupported Render Candidate schema: ${candidate.schema}`);
  safeToken(candidate.candidateId, 'candidateId');
  ensureSha256(candidate.lockedPictureManifestHash, 'lockedPictureManifestHash');
  ensureSha256(candidate.renderContractHash, 'renderContractHash');
  ensureSha256(candidate.audioConformHash, 'audioConformHash');
  ensureSha256(candidate.audioConformReviewHash, 'audioConformReviewHash');
  ensureSha256(candidate.qcHash, 'qcHash');
  ensureSha256(candidate.outputAsset?.sha256, 'outputAsset.sha256');
  if (candidate.state !== 'RENDER_CANDIDATE' || candidate.pictureLockedAtRender !== true || candidate.measuredQcPassed !== true || candidate.humanMasterAcceptanceRequired !== true || candidate.masterAccepted !== false || candidate.audioLocked !== false || candidate.canonEligible !== false || candidate.ledgerPromotionEligible !== false || candidate.publicRelease !== false || candidate.relayDependency !== false) throw new Error('Render Candidate violates authority/state boundaries');
  parseTime(candidate.createdAt, 'createdAt');
  ensureSha256(candidate.renderCandidateHash, 'renderCandidateHash');
  if (candidate.renderCandidateHash !== digestJson(renderCandidateHashPayload(candidate))) throw new Error('Render Candidate self-hash mismatch');
  if (contract) {
    validateLockedRenderContract(contract, policy ? { policy } : {});
    if (candidate.renderContractHash !== contract.contractHash || candidate.lockedPictureManifestHash !== contract.lockedPictureManifestHash || candidate.audioConformHash !== contract.audioConformHash || candidate.audioConformReviewHash !== contract.audioConformReviewHash) throw new Error('Render Candidate contract lineage drift detected');
  }
  if (qcReport) {
    validateRenderQcReport(qcReport, { policy, contract });
    if (qcReport.status !== 'PASSED' || candidate.qcHash !== qcReport.qcHash || candidate.outputAsset.sha256 !== qcReport.outputAsset.sha256) throw new Error('Render Candidate QC linkage drift detected');
  }
  return { valid: true, renderCandidateHash: candidate.renderCandidateHash, masterAccepted: false, publicRelease: false };
}

export function classifyLockedRenderState({ policy, pictureLockRegister, renderRegister = null }) {
  validateLockedRenderPolicy(policy);
  validatePictureLockRegister(pictureLockRegister);
  const lockState = classifyPictureLockRegister(pictureLockRegister);
  const candidates = Array.isArray(renderRegister?.renderCandidates) ? renderRegister.renderCandidates : [];
  return {
    activePictureLock: lockState.pictureLocked,
    currentLockedManifestHash: pictureLockRegister.currentManifestHash,
    renderCandidateCount: candidates.length,
    masterAcceptedCount: 0,
    audioLockedCount: 0,
    canonEligibleCount: 0,
    publicRelease: false,
    relayDependency: false,
    status: lockState.pictureLocked ? (candidates.length ? 'RENDER_CANDIDATE_AVAILABLE' : 'READY_FOR_AUDIO_CONFORM') : 'BLOCKED_NO_ACTIVE_PICTURE_LOCK',
  };
}


function renderRegisterEntryHashPayload(entry) {
  return withoutField(entry, 'entryHash');
}

function renderRegisterHashPayload(register) {
  return withoutField(register, 'registerHash');
}

export function buildRenderCandidateRegister({ policy, entries = [], revision = 0, recordedAt }) {
  validateLockedRenderPolicy(policy);
  if (!Array.isArray(entries) || revision !== entries.length || !Number.isInteger(revision) || revision < 0) throw new Error('Render Candidate register revision must equal entry count');
  parseTime(recordedAt, 'recordedAt');
  let previous = null;
  const candidateHashes = new Set();
  for (const entry of entries) {
    safeToken(entry.entryId, 'entryId');
    safeToken(entry.candidateId, 'candidateId');
    ensureSha256(entry.renderCandidateHash, 'renderCandidateHash');
    ensureSha256(entry.outputSha256, 'outputSha256');
    if (entry.previousEntryHash !== previous) throw new Error('Render Candidate register previousEntryHash mismatch');
    if (entry.masterAccepted !== false || entry.canonEligible !== false || entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Render Candidate register entry violates authority boundaries');
    ensureSha256(entry.entryHash, 'entryHash');
    if (entry.entryHash !== digestJson(renderRegisterEntryHashPayload(entry))) throw new Error('Render Candidate register entry self-hash mismatch');
    if (candidateHashes.has(entry.renderCandidateHash)) throw new Error('Render Candidate register contains duplicate candidate hash');
    candidateHashes.add(entry.renderCandidateHash);
    previous = entry.entryHash;
  }
  const register = {
    schema: CINESWARM_RENDER_CANDIDATE_REGISTER_SCHEMA,
    registerId: `${policy.sequenceId}-render-candidate-register`,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    revision,
    recordedAt,
    status: entries.length ? 'RENDER_CANDIDATE_AVAILABLE' : 'EMPTY_NO_RENDER_CANDIDATES',
    entryCount: entries.length,
    entries: structuredClone(entries),
    headHash: entries.length ? entries.at(-1).entryHash : null,
    renderCandidateCount: entries.length,
    masterAcceptedCount: 0,
    canonEligibleCount: 0,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(renderRegisterHashPayload(register));
  return register;
}

export function validateRenderCandidateRegister(register, { policy = null } = {}) {
  if (!register || typeof register !== 'object') throw new Error('Render Candidate register must be an object');
  if (register.schema !== CINESWARM_RENDER_CANDIDATE_REGISTER_SCHEMA) throw new Error(`unsupported Render Candidate register schema: ${register.schema}`);
  safeToken(register.registerId, 'registerId');
  safeToken(register.policyId, 'policyId');
  safeToken(register.episodeId, 'episodeId');
  safeToken(register.sequenceId, 'sequenceId');
  if (!Array.isArray(register.entries) || register.entryCount !== register.entries.length || register.revision !== register.entries.length) throw new Error('Render Candidate register entries/revision mismatch');
  const effectivePolicy = policy ?? {
    schema: CINESWARM_LOCKED_RENDER_POLICY_SCHEMA,
    policyId: register.policyId,
    episodeId: register.episodeId,
    sequenceId: register.sequenceId,
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
  const rebuilt = buildRenderCandidateRegister({ policy: effectivePolicy, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['status', 'headHash', 'renderCandidateCount', 'masterAcceptedCount', 'canonEligibleCount']) if (register[key] !== rebuilt[key]) throw new Error(`Render Candidate register ${key} mismatch`);
  if (register.publicRelease !== false || register.relayDependency !== false) throw new Error('Render Candidate register violates authority boundaries');
  ensureSha256(register.registerHash, 'registerHash');
  if (register.registerHash !== digestJson(renderRegisterHashPayload(register))) throw new Error('Render Candidate register self-hash mismatch');
  if (policy) {
    validateLockedRenderPolicy(policy);
    if (register.policyId !== policy.policyId || register.episodeId !== policy.episodeId || register.sequenceId !== policy.sequenceId) throw new Error('Render Candidate register policy scope mismatch');
  }
  return { valid: true, registerHash: register.registerHash, renderCandidateCount: register.renderCandidateCount };
}

export function appendRenderCandidateToRegister({ register, candidate, policy, recordedAt }) {
  validateRenderCandidateRegister(register, { policy });
  validateRenderCandidate(candidate, { policy });
  if (candidate.episodeId !== register.episodeId || candidate.sequenceId !== register.sequenceId) throw new Error('Render Candidate does not match register scope');
  if (register.entries.some((entry) => entry.renderCandidateHash === candidate.renderCandidateHash)) throw new Error('Render Candidate is already registered');
  const entry = {
    entryId: `${candidate.candidateId}-entry-${register.revision + 1}`,
    candidateId: candidate.candidateId,
    renderCandidateHash: candidate.renderCandidateHash,
    outputSha256: candidate.outputAsset.sha256,
    recordedAt: parseTime(recordedAt, 'recordedAt'),
    previousEntryHash: register.headHash,
    masterAccepted: false,
    canonEligible: false,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(renderRegisterEntryHashPayload(entry));
  return buildRenderCandidateRegister({ policy, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt });
}
