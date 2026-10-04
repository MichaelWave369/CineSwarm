import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestJson } from '../src/authorization-seal.js';
import {
  appendLockedAudioToRegister,
  appendMasterCandidateToRegister,
  buildAudioLockCeremonyPayload,
  buildAudioLockRegister,
  buildLockedAudioManifest,
  buildMasterAcceptanceCeremonyPayload,
  buildMasterCandidate,
  buildMasterCandidateRegister,
  buildMasterReview,
  signAudioLockCeremony,
  signMasterAcceptanceCeremony,
} from '../src/master-review-audio-lock.js';
import { validateAudioConformManifest, validateRenderCandidate } from '../src/locked-render-audio.js';
import {
  appendCanonRecordToRegister,
  appendLedgerAdmissionPacketToRegister,
  buildCanonPromotionCeremonyPayload,
  buildCanonRecord,
  buildCanonRegister,
  buildCanonReview,
  buildLedgerAdmissionPacket,
  buildLedgerPacketRegister,
  classifyCanonLedgerReadiness,
  signCanonPromotionCeremony,
  validateCanonLedgerPolicy,
  validateCanonRecord,
  validateCanonRegister,
  validateCanonReview,
  validateLedgerAdmissionPacket,
  validateLedgerPacketRegister,
  verifyCanonPromotionCeremony,
} from '../src/canon-ledger-admission.js';

const base = resolve(import.meta.dirname, '../../..');
const masterPolicy = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-12-master-review-policy.json'), 'utf8'));
const canonPolicy = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-13-canon-ledger-policy.json'), 'utf8'));
const canonicalMasterRegister = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-12-master-candidate-register.json'), 'utf8'));
const canonicalCanonRegister = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-13-canon-register.json'), 'utf8'));
const canonicalLedgerRegister = JSON.parse(readFileSync(resolve(base, 'fixtures/cineswarm/pn-0001-c1-13-ledger-packet-register.json'), 'utf8'));

const now = '2026-08-13T19:20:00.000Z';
const later = '2026-08-13T19:21:00.000Z';
const later2 = '2026-08-13T19:22:00.000Z';
const later3 = '2026-08-13T19:23:00.000Z';
const later4 = '2026-08-13T19:24:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');

function makeKeyMaterial({ status = 'active', keyId = 'michael_hughes_canon_001' } = {}) {
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
        validFrom: '2026-08-13T19:00:00.000Z',
        validUntil: null,
      }],
      status: status === 'active' ? 'ACTIVE' : 'TEST',
    },
  };
}

function buildAudioConform() {
  const manifest = {
    schema: 'parallax.cineswarm.audio-conform-manifest.c1.11.v0.1',
    manifestId: 'audio-conform-c1-13-proof',
    policyId: 'pn0001-seq01-locked-render-policy',
    episodeId: masterPolicy.episodeId,
    sequenceId: masterPolicy.sequenceId,
    lockedPictureManifestId: 'locked-picture-c1-13-proof',
    lockedPictureManifestHash: sha('locked-picture-c1-13-proof'),
    timelineDurationSeconds: 20,
    tracks: [{
      trackId: 'narration-main',
      kind: 'narration',
      sourceSha256: sha('c1-13-narration'),
      sourceLineage: 'proof-only-human-narration',
      rightsStatus: 'proof-only-original',
      startSeconds: 0,
      endSeconds: 20,
      voiceConsentStatus: 'confirmed-human',
    }],
    mixAsset: {
      relativePath: 'mix/c1-13-proof.wav',
      sha256: sha('c1-13-mix'),
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

function buildRenderCandidate(audioConform) {
  const candidate = {
    schema: 'parallax.cineswarm.render-candidate.c1.11.v0.1',
    candidateId: 'render-candidate-c1-13-proof',
    policyId: 'pn0001-seq01-locked-render-policy',
    episodeId: masterPolicy.episodeId,
    sequenceId: masterPolicy.sequenceId,
    lockedPictureManifestHash: audioConform.lockedPictureManifestHash,
    renderContractId: 'render-contract-c1-13-proof',
    renderContractHash: sha('render-contract-c1-13-proof'),
    audioConformHash: audioConform.audioConformHash,
    audioConformReviewHash: sha('audio-conform-review-c1-13-proof'),
    qcReportId: 'qc-c1-13-proof',
    qcHash: sha('qc-c1-13-proof'),
    outputAsset: {
      relativePath: 'renders/c1-13-proof.mp4',
      sha256: sha('c1-13-proof-mp4'),
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

function buildMasterFixture({ keyStatus = 'active' } = {}) {
  const keyMaterial = makeKeyMaterial({ status: keyStatus });
  const audioConform = buildAudioConform();
  const renderCandidate = buildRenderCandidate(audioConform);
  const audioPayload = buildAudioLockCeremonyPayload({ policy: masterPolicy, audioConformManifest: audioConform, authorityId: 'michael-hughes', keyId: keyMaterial.keyRegistry.keys[0].keyId, recordedAt: now });
  const audioCeremony = signAudioLockCeremony(audioPayload, { privateKeyPem: keyMaterial.privateKeyPem, keyRegistry: keyMaterial.keyRegistry });
  const lockedAudioManifest = buildLockedAudioManifest({ ceremony: audioCeremony, audioConformManifest: audioConform, policy: masterPolicy, keyRegistry: keyMaterial.keyRegistry });
  let audioRegister = buildAudioLockRegister({ policy: masterPolicy, entries: [], revision: 0, recordedAt: now });
  audioRegister = appendLockedAudioToRegister({ register: audioRegister, manifest: lockedAudioManifest, policy: masterPolicy, recordedAt: now });
  const masterReview = buildMasterReview({ policy: masterPolicy, renderCandidate, lockedAudioManifest, audioLockRegister: audioRegister, authorityId: 'michael-hughes', decision: 'ACCEPT_MASTER_CANDIDATE', creativeApproved: true, technicalApproved: true, recordedAt: later, notes: 'Proof-only C1.13 Master Review lineage.' });
  const acceptancePayload = buildMasterAcceptanceCeremonyPayload({ policy: masterPolicy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister: audioRegister, authorityId: 'michael-hughes', keyId: keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later2 });
  const acceptanceCeremony = signMasterAcceptanceCeremony(acceptancePayload, { privateKeyPem: keyMaterial.privateKeyPem, keyRegistry: keyMaterial.keyRegistry });
  const masterCandidate = buildMasterCandidate({ policy: masterPolicy, renderCandidate, masterReview, lockedAudioManifest, audioLockRegister: audioRegister, acceptanceCeremony, keyRegistry: keyMaterial.keyRegistry, createdAt: later2 });
  let masterRegister = buildMasterCandidateRegister({ policy: masterPolicy, entries: [], revision: 0, recordedAt: now });
  masterRegister = appendMasterCandidateToRegister({ register: masterRegister, candidate: masterCandidate, policy: masterPolicy, recordedAt: later2 });
  return { keyMaterial, audioConform, renderCandidate, lockedAudioManifest, audioRegister, masterReview, acceptanceCeremony, masterCandidate, masterRegister };
}

function buildCanonFixture() {
  const master = buildMasterFixture();
  const canonReview = buildCanonReview({
    policy: canonPolicy,
    masterPolicy,
    masterCandidate: master.masterCandidate,
    masterRegister: master.masterRegister,
    authorityId: 'michael-hughes',
    decision: 'APPROVE_FOR_CANON_PROMOTION',
    masterLineageApproved: true,
    provenanceCompleteForCanon: true,
    promotionBoundaryUnderstood: true,
    recordedAt: later3,
    notes: 'Proof-only C1.13 independent Canon Review.',
  });
  const promotionPayload = buildCanonPromotionCeremonyPayload({ policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister, canonReview, authorityId: 'michael-hughes', keyId: master.keyMaterial.keyRegistry.keys[0].keyId, recordedAt: later4 });
  const promotionCeremony = signCanonPromotionCeremony(promotionPayload, { privateKeyPem: master.keyMaterial.privateKeyPem, keyRegistry: master.keyMaterial.keyRegistry });
  const canonRecord = buildCanonRecord({ policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister, canonReview, promotionCeremony, keyRegistry: master.keyMaterial.keyRegistry, createdAt: later4 });
  let canonRegister = buildCanonRegister({ policy: canonPolicy, entries: [], revision: 0, recordedAt: later3 });
  canonRegister = appendCanonRecordToRegister({ register: canonRegister, canonRecord, policy: canonPolicy, masterPolicy, recordedAt: later4 });
  return { ...master, canonReview, promotionPayload, promotionCeremony, canonRecord, canonRegister };
}

test('C1.13 policy requires registered exact Master Candidate, independent Canon Review, signed promotion, complete evidence, and no auto release', () => {
  assert.equal(validateCanonLedgerPolicy(canonPolicy).valid, true);
  const bad = structuredClone(canonPolicy);
  bad.autoCanonPromotion = true;
  assert.throws(() => validateCanonLedgerPolicy(bad), /autoCanonPromotion must remain false/);
  const release = structuredClone(canonPolicy);
  release.networkReleaseAuthority = true;
  assert.throws(() => validateCanonLedgerPolicy(release), /networkReleaseAuthority must remain false/);
});

test('Canon Review refuses an unregistered Master Candidate', () => {
  const master = buildMasterFixture();
  assert.throws(() => buildCanonReview({ policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: canonicalMasterRegister, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_CANON_PROMOTION', masterLineageApproved: true, provenanceCompleteForCanon: true, promotionBoundaryUnderstood: true, recordedAt: later3, notes: 'Must fail.' }), /must be present in the C1.12 append-only Master Candidate Register/);
});

test('Canon approval requires lineage, provenance, and promotion-boundary approval in a separate real human record', () => {
  const master = buildMasterFixture();
  assert.throws(() => buildCanonReview({ policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_CANON_PROMOTION', masterLineageApproved: true, provenanceCompleteForCanon: false, promotionBoundaryUnderstood: true, recordedAt: later3, notes: 'Must fail.' }), /requires lineage, provenance, and boundary approval/);
  const review = buildCanonReview({ policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_CANON_PROMOTION', masterLineageApproved: true, provenanceCompleteForCanon: true, promotionBoundaryUnderstood: true, recordedAt: later3, notes: 'Proof review.' });
  assert.equal(validateCanonReview(review, { policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister }).eligibleForCanonPromotionCeremony, true);
  assert.equal(review.canonPromoted, false);
});

test('Canon Review is exact/self-hashed and rejects post-review Master Candidate or register drift', () => {
  const master = buildMasterFixture();
  const review = buildCanonReview({ policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister, authorityId: 'michael-hughes', decision: 'APPROVE_FOR_CANON_PROMOTION', masterLineageApproved: true, provenanceCompleteForCanon: true, promotionBoundaryUnderstood: true, recordedAt: later3, notes: 'Proof review.' });
  const tampered = structuredClone(review);
  tampered.outputAssetSha256 = sha('different-output');
  { const { reviewHash: _oldReviewHash, ...tamperedBody } = tampered; tampered.reviewHash = digestJson(tamperedBody); }
  assert.throws(() => validateCanonReview(tampered, { policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: master.masterRegister }));
  const changedRegister = structuredClone(master.masterRegister);
  changedRegister.registerHash = sha('different-master-register');
  assert.throws(() => validateCanonReview(review, { policy: canonPolicy, masterPolicy, masterCandidate: master.masterCandidate, masterRegister: changedRegister }));
});

test('Canon Promotion Ceremony signs the exact Master/Review lineage in a dedicated Ed25519 domain and grants no Ledger or release authority', () => {
  const proof = buildCanonFixture();
  const result = verifyCanonPromotionCeremony({ ceremony: proof.promotionCeremony, policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, keyRegistry: proof.keyMaterial.keyRegistry });
  assert.equal(result.valid, true);
  assert.equal(result.canonPromotionAuthorized, true);
  assert.equal(result.ledgerAdmissionAuthorized, false);
  assert.equal(result.networkReleaseAuthorized, false);
  assert.equal(proof.promotionCeremony.publicRelease, false);
});

test('Canon Promotion signature rejects output/review drift and revoked signing keys', () => {
  const proof = buildCanonFixture();
  const changedReview = structuredClone(proof.canonReview);
  changedReview.notes = 'Changed after signature';
  const { reviewHash, ...reviewBody } = changedReview;
  changedReview.reviewHash = digestJson(reviewBody);
  assert.throws(() => verifyCanonPromotionCeremony({ ceremony: proof.promotionCeremony, policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: changedReview, keyRegistry: proof.keyMaterial.keyRegistry }), /drift|review/);
  const revokedRegistry = structuredClone(proof.keyMaterial.keyRegistry);
  revokedRegistry.keys[0].status = 'revoked';
  assert.throws(() => verifyCanonPromotionCeremony({ ceremony: proof.promotionCeremony, policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, keyRegistry: revokedRegistry }), /revoked/);
});

test('Canon Record is immutable, exact, promoted, and still not Ledger-admitted or Network-released', () => {
  const proof = buildCanonFixture();
  const validated = validateCanonRecord(proof.canonRecord, { policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, keyRegistry: proof.keyMaterial.keyRegistry });
  assert.equal(validated.canonPromoted, true);
  assert.equal(proof.canonRecord.ledgerAdmitted, false);
  assert.equal(proof.canonRecord.networkReleaseEligible, false);
  assert.equal(proof.canonRecord.publicRelease, false);
  const tampered = structuredClone(proof.canonRecord);
  tampered.ledgerAdmitted = true;
  assert.throws(() => validateCanonRecord(tampered, { policy: canonPolicy, masterPolicy }), /authority\/state|self-hash/);
});

test('Canon Register is append-only and refuses silent replacement of an existing Canon record', () => {
  const proof = buildCanonFixture();
  assert.equal(validateCanonRegister(proof.canonRegister, { policy: canonPolicy }).canonRecordCount, 1);
  assert.throws(() => appendCanonRecordToRegister({ register: proof.canonRegister, canonRecord: proof.canonRecord, policy: canonPolicy, masterPolicy, recordedAt: '2026-08-13T19:25:00.000Z' }), /explicit signed supersession ceremony/);
});

test('Ledger Admission Packet inventories the full 14-link provenance chain and stays admission/release pending', () => {
  const proof = buildCanonFixture();
  const packet = buildLedgerAdmissionPacket({ policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, createdAt: '2026-08-13T19:25:00.000Z' });
  const validated = validateLedgerAdmissionPacket(packet, { policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry });
  assert.equal(validated.valid, true);
  assert.equal(packet.evidenceItemCount, 14);
  assert.equal(packet.ledgerAdmissionEligible, true);
  assert.equal(packet.ledgerAdmitted, false);
  assert.equal(packet.networkReleaseEligible, false);
  assert.equal(packet.publicRelease, false);
});

test('Ledger Admission Packet rejects evidence inventory or root tampering', () => {
  const proof = buildCanonFixture();
  const packet = buildLedgerAdmissionPacket({ policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, createdAt: '2026-08-13T19:25:00.000Z' });
  const tampered = structuredClone(packet);
  tampered.evidenceInventory[0].sha256 = sha('replacement-output');
  const { ledgerPacketHash, ...body } = tampered;
  tampered.ledgerPacketHash = digestJson(body);
  assert.throws(() => validateLedgerAdmissionPacket(tampered, { policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry }), /lineage\/evidence drift/);
});

test('Ledger Packet Register is hash-chained, append-only, and refuses a duplicate packet for the same Canon record', () => {
  const proof = buildCanonFixture();
  const packet = buildLedgerAdmissionPacket({ policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, createdAt: '2026-08-13T19:25:00.000Z' });
  let register = buildLedgerPacketRegister({ policy: canonPolicy, entries: [], revision: 0, recordedAt: later4 });
  register = appendLedgerAdmissionPacketToRegister({ register, packet, policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, recordedAt: '2026-08-13T19:25:00.000Z' });
  assert.equal(validateLedgerPacketRegister(register, { policy: canonPolicy }).packetCount, 1);
  assert.throws(() => appendLedgerAdmissionPacketToRegister({ register, packet, policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, recordedAt: '2026-08-13T19:26:00.000Z' }), /already registered/);
});

test('synthetic full C1.12 → C1.13 path reaches Ledger Admission Packet ready, never Ledger admitted or Network released', () => {
  const proof = buildCanonFixture();
  const packet = buildLedgerAdmissionPacket({ policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, createdAt: '2026-08-13T19:25:00.000Z' });
  let ledgerRegister = buildLedgerPacketRegister({ policy: canonPolicy, entries: [], revision: 0, recordedAt: later4 });
  ledgerRegister = appendLedgerAdmissionPacketToRegister({ register: ledgerRegister, packet, policy: canonPolicy, masterPolicy, masterCandidate: proof.masterCandidate, masterRegister: proof.masterRegister, canonReview: proof.canonReview, promotionCeremony: proof.promotionCeremony, canonRecord: proof.canonRecord, canonRegister: proof.canonRegister, keyRegistry: proof.keyMaterial.keyRegistry, recordedAt: '2026-08-13T19:25:00.000Z' });
  const state = classifyCanonLedgerReadiness({ policy: canonPolicy, masterPolicy, masterRegister: proof.masterRegister, canonRegister: proof.canonRegister, ledgerPacketRegister: ledgerRegister });
  assert.equal(state.status, 'LEDGER_ADMISSION_PACKET_READY_LEDGER_DECISION_PENDING');
  assert.equal(state.masterCandidateAvailable, true);
  assert.equal(state.canonPromoted, true);
  assert.equal(state.ledgerAdmissionPacketReady, true);
  assert.equal(state.ledgerAdmittedCount, 0);
  assert.equal(state.networkReleaseEligible, false);
  assert.equal(state.publicRelease, false);
});

test('canonical C1.13 truth remains empty because no real Master Candidate, Canon Promotion, or Ledger packet exists', () => {
  assert.equal(validateCanonRegister(canonicalCanonRegister, { policy: canonPolicy }).revision, 0);
  assert.equal(validateLedgerPacketRegister(canonicalLedgerRegister, { policy: canonPolicy }).revision, 0);
  const state = classifyCanonLedgerReadiness({ policy: canonPolicy, masterPolicy, masterRegister: canonicalMasterRegister, canonRegister: canonicalCanonRegister, ledgerPacketRegister: canonicalLedgerRegister });
  assert.equal(state.status, 'BLOCKED_NO_MASTER_CANDIDATE');
  assert.equal(state.masterCandidateCount, 0);
  assert.equal(state.canonRecordCount, 0);
  assert.equal(state.ledgerAdmissionPacketCount, 0);
  assert.equal(state.publicRelease, false);
});
