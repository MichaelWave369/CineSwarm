import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendArchiveRecordToRegister,
  appendRevalidationToRegister,
  buildIntegrityRevalidationReport,
  buildPublicArchiveRecord,
  buildPublicArchiveRegister,
} from '../src/public-archive-integrity.js';
import {
  buildArchiveRecoveryBundleManifest,
  buildArchiveReplicaManifest,
  buildArchiveReplicaSet,
  buildReplicaVerificationReport,
} from '../src/archive-recovery.js';
import { buildC1_17WithdrawnFixture, c17Policy, c16Policy, c15Policy } from './c1-17-fixture.mjs';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
export const c18Policy = read('pn-0001-c1-18-archive-recovery-policy.json');

const sha = (value) => createHash('sha256').update(value).digest('hex');

export function buildC1_18Fixture() {
  const fx = buildC1_17WithdrawnFixture();
  const c17RegisterContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, c16LifecycleRegister: fx.lifecycle };
  const archiveRecord = buildPublicArchiveRecord({
    c17Policy, c16Policy, c15Policy,
    c15PublicReleaseRegister: fx.c15Register,
    c16LifecycleRegister: fx.lifecycle,
    publicReleaseReceipt: fx.original.receipt,
    publicReceiptContext: fx.original.receiptContext,
    archivePath: '/archive/pn-0001/welcome-v1',
    recordedAt: '2026-08-13T20:20:00.000Z',
  });
  const archiveRecordContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, c16LifecycleRegister: fx.lifecycle, publicReleaseReceipt: fx.original.receipt, publicReceiptContext: fx.original.receiptContext };
  const observations = [
    { kind: 'public-release-receipt', expectedSha256: archiveRecord.publicReleaseReceiptHash, available: true, observedSha256: archiveRecord.publicReleaseReceiptHash },
    { kind: 'release-receipt-evidence-root', expectedSha256: archiveRecord.releaseReceiptEvidenceRootHash, available: true, observedSha256: archiveRecord.releaseReceiptEvidenceRootHash },
    { kind: 'published-master-output', expectedSha256: archiveRecord.outputSha256, available: true, observedSha256: archiveRecord.outputSha256 },
    { kind: 'c1-15-public-release-register', expectedSha256: archiveRecord.sourceC15RegisterHash, available: true, observedSha256: archiveRecord.sourceC15RegisterHash },
    { kind: 'c1-16-release-lifecycle-register', expectedSha256: archiveRecord.sourceC16LifecycleRegisterHash, available: true, observedSha256: archiveRecord.sourceC16LifecycleRegisterHash },
    { kind: 'c1-17-public-archive-record', expectedSha256: archiveRecord.archiveRecordHash, available: true, observedSha256: archiveRecord.archiveRecordHash },
  ];
  const integrityReport = buildIntegrityRevalidationReport({ c17Policy, archiveRecord, observations, verifierId: 'c1-18-proof-integrity-verifier', verifiedAt: '2026-08-13T20:22:00.000Z', reportId: 'c1-18-proof-c17-revalidation' });
  let c17ArchiveRegister = buildPublicArchiveRegister({ ...c17RegisterContext, entries: [], revision: 0, recordedAt: '2026-08-13T20:19:00.000Z' });
  c17ArchiveRegister = appendArchiveRecordToRegister({ register: c17ArchiveRegister, archiveRecord, registerContext: c17RegisterContext, recordedAt: '2026-08-13T20:20:30.000Z' });
  c17ArchiveRegister = appendRevalidationToRegister({ register: c17ArchiveRegister, report: integrityReport, archiveRecord, registerContext: c17RegisterContext, recordedAt: '2026-08-13T20:22:30.000Z' });

  const semantic = {
    'public-release-receipt-json': archiveRecord.publicReleaseReceiptHash,
    'release-evidence-root-record': archiveRecord.releaseReceiptEvidenceRootHash,
    'published-master-media': archiveRecord.outputSha256,
    'c1-15-public-release-register-json': archiveRecord.sourceC15RegisterHash,
    'c1-16-release-lifecycle-register-json': archiveRecord.sourceC16LifecycleRegisterHash,
    'c1-17-public-archive-record-json': archiveRecord.archiveRecordHash,
    'c1-17-integrity-revalidation-json': integrityReport.revalidationReportHash,
    'c1-17-public-archive-register-json': c17ArchiveRegister.registerHash,
  };
  const objects = c18Policy.requiredBundleKinds.map((kind, index) => ({
    kind,
    relativePath: kind === 'published-master-media' ? 'media/master.mp4' : `evidence/${String(index + 1).padStart(2, '0')}-${kind}.bin`,
    semanticSha256: semantic[kind],
    blobSha256: kind === 'published-master-media' ? semantic[kind] : sha(`c1-18-blob:${kind}`),
    sizeBytes: kind === 'published-master-media' ? 5000 : Buffer.byteLength(`c1-18-blob:${kind}`),
    storageEncoding: kind === 'published-master-media' ? 'verbatim' : (kind === 'release-evidence-root-record' ? 'hash-record' : 'canonical-json'),
  }));
  const bundleContext = { c18Policy, c17Policy, c17ArchiveRegister, archiveRecord, archiveRecordContext, integrityReport, c17RegisterContext };
  const recoveryBundle = buildArchiveRecoveryBundleManifest({ ...bundleContext, objects, createdAt: '2026-08-13T20:23:00.000Z' });
  const copies = recoveryBundle.objects.map(({ kind, relativePath, blobSha256, sizeBytes }) => ({ kind, relativePath, blobSha256, sizeBytes }));
  const replicaA = buildArchiveReplicaManifest({ c18Policy, recoveryBundle, replicaId: 'replica-a', locationId: 'storage-west', failureDomain: 'failure-domain-west', storageKind: 'filesystem', objectCopies: copies, recordedAt: '2026-08-13T20:24:00.000Z' });
  const replicaB = buildArchiveReplicaManifest({ c18Policy, recoveryBundle, replicaId: 'replica-b', locationId: 'storage-east', failureDomain: 'failure-domain-east', storageKind: 'object-store', objectCopies: copies, recordedAt: '2026-08-13T20:25:00.000Z' });
  const replicaManifests = [replicaA, replicaB];
  const replicaSet = buildArchiveReplicaSet({ c18Policy, recoveryBundle, replicaManifests, createdAt: '2026-08-13T20:26:00.000Z' });
  const healthyObservations = (replica) => replica.objects.map((item) => ({ kind: item.kind, expectedBlobSha256: item.blobSha256, expectedSizeBytes: item.sizeBytes, available: true, observedBlobSha256: item.blobSha256, observedSizeBytes: item.sizeBytes }));
  const verificationA = buildReplicaVerificationReport({ c18Policy, recoveryBundle, replicaManifest: replicaA, observations: healthyObservations(replicaA), verifierId: 'c1-18-replica-verifier', verifiedAt: '2026-08-13T20:27:00.000Z' });
  return { fx, c17RegisterContext, archiveRecord, archiveRecordContext, integrityReport, c17ArchiveRegister, bundleContext, recoveryBundle, replicaA, replicaB, replicaManifests, replicaSet, healthyObservations, verificationA };
}
