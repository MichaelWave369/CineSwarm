import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildArchiveReplicaManifest,
  buildArchiveReplicaSet,
  buildReplicaVerificationReport,
} from '../src/archive-recovery.js';
import {
  buildReplicaPlacementPlan,
  buildStorageAdapterContract,
  buildStorageAdapterRegistry,
} from '../src/replica-maintenance.js';
import { buildC1_18Fixture, c18Policy } from './c1-18-fixture.mjs';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
export const c19Policy = read('pn-0001-c1-19-replica-maintenance-policy.json');

const caps = { read: true, write: true, verifySha256: true, inventory: true, deleteWithoutHumanApproval: false };

export function buildC1_19Fixture() {
  const c18fx = buildC1_18Fixture();
  const copies = c18fx.recoveryBundle.objects.map(({ kind, relativePath, blobSha256, sizeBytes }) => ({ kind, relativePath, blobSha256, sizeBytes }));
  const replicaC = buildArchiveReplicaManifest({ c18Policy, recoveryBundle: c18fx.recoveryBundle, replicaId: 'replica-c', locationId: 'storage-cold', failureDomain: 'failure-domain-cold', storageKind: 'cold-storage', objectCopies: copies, recordedAt: '2026-08-13T20:28:00.000Z' });
  const replicaManifests = [c18fx.replicaA, c18fx.replicaB, replicaC];
  const replicaSet = buildArchiveReplicaSet({ c18Policy, recoveryBundle: c18fx.recoveryBundle, replicaManifests, createdAt: '2026-08-13T20:29:00.000Z', replicaSetId: 'c1-19-proof-replica-set' });
  const adapterA = buildStorageAdapterContract({ c19Policy, adapterId: 'adapter-fs-west', adapterKind: 'filesystem', locationId: 'storage-west', failureDomain: 'failure-domain-west', storageClass: 'local-disk', retrievalMode: 'immediate', capabilities: caps, implementationStatus: 'LOCAL_PROOF_IMPLEMENTATION', operatorAttestationId: 'proof-west-attestation', createdAt: '2026-08-13T20:29:10.000Z' });
  const adapterB = buildStorageAdapterContract({ c19Policy, adapterId: 'adapter-object-east', adapterKind: 'object-store', locationId: 'storage-east', failureDomain: 'failure-domain-east', storageClass: 'object-standard', retrievalMode: 'immediate', capabilities: caps, implementationStatus: 'CONTRACT_ONLY', operatorAttestationId: 'proof-east-attestation', createdAt: '2026-08-13T20:29:20.000Z' });
  const adapterC = buildStorageAdapterContract({ c19Policy, adapterId: 'adapter-cold', adapterKind: 'cold-storage', locationId: 'storage-cold', failureDomain: 'failure-domain-cold', storageClass: 'deep-archive', retrievalMode: 'delayed', capabilities: caps, implementationStatus: 'CONTRACT_ONLY', operatorAttestationId: 'proof-cold-attestation', createdAt: '2026-08-13T20:29:30.000Z' });
  const adapters = [adapterA, adapterB, adapterC];
  const adapterRegistry = buildStorageAdapterRegistry({ c19Policy, adapters, revision: 3, recordedAt: '2026-08-13T20:30:00.000Z' });
  const placementContext = { c19Policy, c18Policy, recoveryBundle: c18fx.recoveryBundle, bundleValidationContext: c18fx.bundleContext, replicaSet, replicaManifests, adapterRegistry };
  const placementPlan = buildReplicaPlacementPlan({ ...placementContext, placements: [{ replicaId: 'replica-a', adapterId: 'adapter-fs-west' }, { replicaId: 'replica-b', adapterId: 'adapter-object-east' }, { replicaId: 'replica-c', adapterId: 'adapter-cold' }], createdAt: '2026-08-13T20:31:00.000Z' });
  const obs = (replica, overrides = {}) => replica.objects.map((item) => {
    const override = overrides[item.kind];
    if (override === 'MISSING') return { kind: item.kind, expectedBlobSha256: item.blobSha256, expectedSizeBytes: item.sizeBytes, available: false, observedBlobSha256: null, observedSizeBytes: null };
    if (override === 'MISMATCH') return { kind: item.kind, expectedBlobSha256: item.blobSha256, expectedSizeBytes: item.sizeBytes, available: true, observedBlobSha256: '0'.repeat(64), observedSizeBytes: item.sizeBytes };
    return { kind: item.kind, expectedBlobSha256: item.blobSha256, expectedSizeBytes: item.sizeBytes, available: true, observedBlobSha256: item.blobSha256, observedSizeBytes: item.sizeBytes };
  });
  const verify = (replica, at, overrides = {}, id = null) => buildReplicaVerificationReport({ c18Policy, recoveryBundle: c18fx.recoveryBundle, replicaManifest: replica, observations: obs(replica, overrides), verifierId: 'c1-19-proof-verifier', verifiedAt: at, reportId: id });
  const verificationA = verify(c18fx.replicaA, '2026-08-13T20:32:00.000Z', {}, 'verify-a');
  const verificationB = verify(c18fx.replicaB, '2026-08-13T20:33:20.000Z', {}, 'verify-b');
  const verificationC = verify(replicaC, '2026-08-13T20:36:30.000Z', {}, 'verify-c');
  return { c18fx, replicaC, replicaManifests, replicaSet, adapterA, adapterB, adapterC, adapters, adapterRegistry, placementContext, placementPlan, obs, verify, verificationA, verificationB, verificationC };
}
