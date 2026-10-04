import { digestJson } from './authorization-seal.js';

export const WAVEFORGE_RELEASE_REFERENCE_PACKET_SCHEMA = 'parallax.bridge.v2';
export const WAVEFORGE_RELEASE_REFERENCE_PROFILE = 'parallax.creative-interop.v2';
export const WAVEFORGE_RELEASE_REFERENCE_EXTENSION = 'parallax.creative-interop.v2.cineswarm-reference';
export const WAVEFORGE_RELEASE_REFERENCE_STATUS = 'ratified_receiver';
export const WAVEFORGE_RELEASE_REFERENCE_RECEIPT_SCHEMA = 'parallax.cineswarm.waveforge-release-reference-receipt.v1';

const AUTHORITY_KEYS = Object.freeze([
  'automaticImportAuthorized',
  'networkAuthorized',
  'subprocessAuthorized',
  'renderAuthorized',
  'publishAuthorized',
  'mediaAcquisitionAuthorized',
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function shaRef(value, label) {
  const text = requiredString(value, label).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be sha256:<64 hex>`);
  return text;
}

function parseTime(value, label) {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be ISO-8601`);
  return text;
}

function requireNoAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw new Error('authority must be an object');
  }
  for (const key of AUTHORITY_KEYS) {
    if (authority[key] !== false) throw new Error(`authority.${key} must remain false`);
  }
}

function receiptPayload(receipt) {
  const value = structuredClone(receipt);
  delete value.receiptHash;
  return value;
}

export function validateWaveForgeReleaseReference(packet, { allowLegacyUnratified = true } = {}) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('WaveForge release reference must be an object');
  if (packet.schema !== WAVEFORGE_RELEASE_REFERENCE_PACKET_SCHEMA) throw new Error('unsupported WaveForge bridge schema');
  if (packet.protocol !== 'parallax-bridge' || packet.version !== 2) throw new Error('WaveForge bridge protocol/version invalid');
  if (packet.interopProfile !== WAVEFORGE_RELEASE_REFERENCE_PROFILE) throw new Error('WaveForge interopProfile invalid');
  if (packet.extensionProfile !== WAVEFORGE_RELEASE_REFERENCE_EXTENSION) throw new Error('WaveForge extensionProfile invalid');
  if (packet.source !== 'WaveForgeStudio' || packet.target !== 'CineSwarm') throw new Error('WaveForge release-reference route invalid');
  if (packet.localOnly !== true) throw new Error('WaveForge release reference must remain localOnly=true');
  if (packet.requiresUserAction !== true) throw new Error('WaveForge release reference must require explicit user action');
  if (packet.payloadType !== 'application/vnd.waveforge.final-release-reference+json') throw new Error('WaveForge payloadType invalid');

  const status = requiredString(packet.extensionStatus, 'extensionStatus');
  if (status !== WAVEFORGE_RELEASE_REFERENCE_STATUS && !(allowLegacyUnratified && status === 'unratified_receiver')) {
    throw new Error('WaveForge extensionStatus is not recognized');
  }

  const native = packet.payloadRefOrInline?.native;
  if (!native || typeof native !== 'object' || Array.isArray(native)) throw new Error('native WaveForge release reference required');
  if (native.schema !== 'waveforge.cineswarm_release_reference.v1_alpha') throw new Error('native WaveForge release-reference schema invalid');
  if (native.releaseSchema !== 'waveforge.final_release_manifest.v2_alpha') throw new Error('WaveForge release schema invalid');

  const finalReleaseHash = shaRef(native.finalReleaseHash, 'native.finalReleaseHash');
  const expectedTransferId = `waveforge-cineswarm:${finalReleaseHash.slice('sha256:'.length)}`;
  if (packet.transferId !== expectedTransferId) throw new Error('transferId does not match native.finalReleaseHash');

  const expectedContentHash = `sha256:${digestJson(native)}`;
  if (shaRef(packet.contentHash, 'contentHash') !== expectedContentHash) throw new Error('contentHash does not match canonical native payload');

  if (native.creativeLineage !== undefined) {
    if (!native.creativeLineage || typeof native.creativeLineage !== 'object' || Array.isArray(native.creativeLineage)) {
      throw new Error('native.creativeLineage must be an object');
    }
    if (native.creativeLineage.profile !== WAVEFORGE_RELEASE_REFERENCE_PROFILE) throw new Error('creative lineage profile invalid');
    const creativeManifestHash = shaRef(native.creativeLineage.creativeManifestHash, 'creativeLineage.creativeManifestHash');
    if (packet.lineageRef !== creativeManifestHash) throw new Error('lineageRef does not match creativeManifestHash');
  } else if (packet.lineageRef !== null && packet.lineageRef !== undefined) {
    throw new Error('lineageRef requires native creativeLineage');
  }

  if (!Array.isArray(packet.trustLabels) || !packet.trustLabels.includes('reference-only') || !packet.trustLabels.includes('release-lineage-bound')) {
    throw new Error('WaveForge release reference must preserve reference-only trust labels');
  }

  requireNoAuthority(packet.authority);

  return {
    valid: true,
    extensionStatus: status,
    ratified: status === WAVEFORGE_RELEASE_REFERENCE_STATUS,
    contentHash: expectedContentHash,
    finalReleaseHash,
  };
}

export function classifyWaveForgeReleaseReference(packet) {
  const validated = validateWaveForgeReleaseReference(packet, { allowLegacyUnratified: true });
  return {
    recognized: true,
    ratified: validated.ratified,
    state: validated.ratified ? 'RATIFIED_REFERENCE_PENDING_HUMAN_ACCEPTANCE' : 'LEGACY_UNRATIFIED_REFERENCE',
    automaticImportAuthorized: false,
    renderAuthorized: false,
    publishAuthorized: false,
    networkAuthorized: false,
    subprocessAuthorized: false,
    mediaAcquisitionAuthorized: false,
    humanAcceptanceRequired: true,
    note: validated.ratified
      ? 'Receiver ratification recognizes the reference packet only. Local import/use still requires a separate explicit human acceptance action.'
      : 'Historical unratified packets may be inspected but cannot produce a receiver acceptance receipt.',
  };
}

export function createWaveForgeReleaseReferenceReceipt({ packet, receivedAt }) {
  const validated = validateWaveForgeReleaseReference(packet, { allowLegacyUnratified: false });
  const timestamp = parseTime(receivedAt, 'receivedAt');
  const receipt = {
    schema: WAVEFORGE_RELEASE_REFERENCE_RECEIPT_SCHEMA,
    transferId: packet.transferId,
    source: 'WaveForgeStudio',
    target: 'CineSwarm',
    extensionProfile: WAVEFORGE_RELEASE_REFERENCE_EXTENSION,
    extensionStatus: WAVEFORGE_RELEASE_REFERENCE_STATUS,
    sourceContentHash: validated.contentHash,
    finalReleaseHash: validated.finalReleaseHash,
    lineageRef: packet.lineageRef ?? null,
    receivedAt: timestamp,
    state: 'REFERENCE_RECEIVED_PENDING_HUMAN_ACCEPTANCE',
    referenceOnly: true,
    humanAcceptanceRequired: true,
    automaticImportAuthorized: false,
    renderAuthorized: false,
    publishAuthorized: false,
    networkAuthorized: false,
    subprocessAuthorized: false,
    mediaAcquisitionAuthorized: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.receiptHash = digestJson(receipt);
  return receipt;
}

export function validateWaveForgeReleaseReferenceReceipt(receipt, packet) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('WaveForge receiver receipt must be an object');
  if (receipt.schema !== WAVEFORGE_RELEASE_REFERENCE_RECEIPT_SCHEMA) throw new Error('WaveForge receiver receipt schema invalid');
  const validated = validateWaveForgeReleaseReference(packet, { allowLegacyUnratified: false });
  if (receipt.transferId !== packet.transferId) throw new Error('receiver receipt transferId mismatch');
  if (receipt.source !== 'WaveForgeStudio' || receipt.target !== 'CineSwarm') throw new Error('receiver receipt route invalid');
  if (receipt.extensionProfile !== WAVEFORGE_RELEASE_REFERENCE_EXTENSION || receipt.extensionStatus !== WAVEFORGE_RELEASE_REFERENCE_STATUS) {
    throw new Error('receiver receipt extension identity invalid');
  }
  if (shaRef(receipt.sourceContentHash, 'sourceContentHash') !== validated.contentHash) throw new Error('receiver receipt sourceContentHash mismatch');
  if (shaRef(receipt.finalReleaseHash, 'finalReleaseHash') !== validated.finalReleaseHash) throw new Error('receiver receipt finalReleaseHash mismatch');
  if ((receipt.lineageRef ?? null) !== (packet.lineageRef ?? null)) throw new Error('receiver receipt lineageRef mismatch');
  parseTime(receipt.receivedAt, 'receivedAt');
  if (receipt.state !== 'REFERENCE_RECEIVED_PENDING_HUMAN_ACCEPTANCE') throw new Error('receiver receipt state invalid');
  if (receipt.referenceOnly !== true || receipt.humanAcceptanceRequired !== true) throw new Error('receiver receipt must remain reference-only and human-gated');
  for (const key of [
    'automaticImportAuthorized',
    'renderAuthorized',
    'publishAuthorized',
    'networkAuthorized',
    'subprocessAuthorized',
    'mediaAcquisitionAuthorized',
    'publicRelease',
    'relayDependency',
  ]) {
    if (receipt[key] !== false) throw new Error(`receiver receipt ${key} must remain false`);
  }
  const hash = requiredString(receipt.receiptHash, 'receiptHash');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('receiptHash must be SHA-256');
  if (digestJson(receiptPayload(receipt)) !== hash) throw new Error('receiver receipt self-hash mismatch');
  return { valid: true, receiptHash: hash };
}
