import test from 'node:test';
import assert from 'node:assert/strict';

import { digestJson } from '../src/authorization-seal.js';
import {
  WAVEFORGE_RELEASE_REFERENCE_STATUS,
  classifyWaveForgeReleaseReference,
  createWaveForgeReleaseReferenceReceipt,
  validateWaveForgeReleaseReference,
  validateWaveForgeReleaseReferenceReceipt,
} from '../src/waveforge-release-reference.js';

function packet({ status = WAVEFORGE_RELEASE_REFERENCE_STATUS } = {}) {
  const native = {
    schema: 'waveforge.cineswarm_release_reference.v1_alpha',
    releaseSchema: 'waveforge.final_release_manifest.v2_alpha',
    title: 'Harbor Bridge Final',
    finalReleaseHash: 'sha256:' + 'a'.repeat(64),
    verificationPassed: true,
    certificateStatus: 'passed',
    outputs: {
      index: 'final_release/index.html',
      releaseBuildZip: 'final_release/release_build.zip',
      certificateBundleZip: 'final_release/certificate_bundle/certificate_bundle.zip',
      manifest: 'final_release/final_release_manifest.json',
      receipt: 'final_release/final_release_receipt.json',
    },
    creativeLineage: {
      profile: 'parallax.creative-interop.v2',
      sourceBridgeSchema: 'parallax.bridge.v2',
      sourceTransferId: 'creative-v2:harbor-bridge-v3',
      creativeManifestHash: 'sha256:' + '1'.repeat(64),
      baseContentHash: 'sha256:' + '2'.repeat(64),
      overlayContentHashes: ['sha256:' + '3'.repeat(64)],
      semanticOverlayCount: 1,
    },
  };
  return {
    schema: 'parallax.bridge.v2',
    protocol: 'parallax-bridge',
    version: 2,
    interopProfile: 'parallax.creative-interop.v2',
    extensionProfile: 'parallax.creative-interop.v2.cineswarm-reference',
    extensionStatus: status,
    transferId: 'waveforge-cineswarm:' + 'a'.repeat(64),
    source: 'WaveForgeStudio',
    target: 'CineSwarm',
    createdAt: '2026-10-04T00:00:00-07:00',
    localOnly: true,
    payloadType: 'application/vnd.waveforge.final-release-reference+json',
    payloadRefOrInline: { native },
    contentHash: 'sha256:' + digestJson(native),
    trustLabels: ['reference-only', 'release-lineage-bound'],
    warnings: [],
    compatibilityNotes: [],
    lineageRef: native.creativeLineage.creativeManifestHash,
    requiresUserAction: true,
    authority: {
      automaticImportAuthorized: false,
      networkAuthorized: false,
      subprocessAuthorized: false,
      renderAuthorized: false,
      publishAuthorized: false,
      mediaAcquisitionAuthorized: false,
    },
  };
}

test('ratified WaveForge release reference validates without granting authority', () => {
  const input = packet();
  const result = validateWaveForgeReleaseReference(input);
  assert.equal(result.valid, true);
  assert.equal(result.ratified, true);
  const classification = classifyWaveForgeReleaseReference(input);
  assert.equal(classification.state, 'RATIFIED_REFERENCE_PENDING_HUMAN_ACCEPTANCE');
  assert.equal(classification.humanAcceptanceRequired, true);
  assert.equal(classification.automaticImportAuthorized, false);
  assert.equal(classification.renderAuthorized, false);
  assert.equal(classification.publishAuthorized, false);
  assert.equal(classification.networkAuthorized, false);
  assert.equal(classification.subprocessAuthorized, false);
  assert.equal(classification.mediaAcquisitionAuthorized, false);
});

test('legacy unratified packet is recognizable but cannot create receiver receipt', () => {
  const legacy = packet({ status: 'unratified_receiver' });
  const classification = classifyWaveForgeReleaseReference(legacy);
  assert.equal(classification.recognized, true);
  assert.equal(classification.ratified, false);
  assert.equal(classification.state, 'LEGACY_UNRATIFIED_REFERENCE');
  assert.throws(
    () => createWaveForgeReleaseReferenceReceipt({ packet: legacy, receivedAt: '2026-10-04T00:10:00-07:00' }),
    /extensionStatus is not recognized/,
  );
});

test('receiver rejects post-hash native mutation', () => {
  const tampered = packet();
  tampered.payloadRefOrInline.native.title = 'Changed after hashing';
  assert.throws(() => validateWaveForgeReleaseReference(tampered), /contentHash does not match/);
});

test('receiver rejects authority escalation', () => {
  const tampered = packet();
  tampered.authority.renderAuthorized = true;
  assert.throws(() => validateWaveForgeReleaseReference(tampered), /authority.renderAuthorized must remain false/);
});

test('receiver binds transferId to final release hash', () => {
  const tampered = packet();
  tampered.transferId = 'waveforge-cineswarm:' + 'b'.repeat(64);
  assert.throws(() => validateWaveForgeReleaseReference(tampered), /transferId does not match/);
});

test('ratified packet creates a self-hashed reference-only receiver receipt', () => {
  const input = packet();
  const receipt = createWaveForgeReleaseReferenceReceipt({
    packet: input,
    receivedAt: '2026-10-04T00:10:00-07:00',
  });
  const result = validateWaveForgeReleaseReferenceReceipt(receipt, input);
  assert.equal(result.valid, true);
  assert.equal(receipt.state, 'REFERENCE_RECEIVED_PENDING_HUMAN_ACCEPTANCE');
  assert.equal(receipt.referenceOnly, true);
  assert.equal(receipt.humanAcceptanceRequired, true);
  assert.equal(receipt.publicRelease, false);
  assert.equal(receipt.relayDependency, false);
  assert.equal(receipt.automaticImportAuthorized, false);
  assert.equal(receipt.renderAuthorized, false);
  assert.equal(receipt.publishAuthorized, false);
  assert.equal(receipt.networkAuthorized, false);
  assert.equal(receipt.subprocessAuthorized, false);
  assert.equal(receipt.mediaAcquisitionAuthorized, false);
});

test('receiver receipt detects mutation after receipt hashing', () => {
  const input = packet();
  const receipt = createWaveForgeReleaseReferenceReceipt({
    packet: input,
    receivedAt: '2026-10-04T00:10:00-07:00',
  });
  receipt.state = 'IMPORTED';
  assert.throws(() => validateWaveForgeReleaseReferenceReceipt(receipt, input), /state invalid/);
});
