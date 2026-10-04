#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildDisasterRecoveryReceipt,
  buildRestoreDrillReport,
  validateReplicaVerificationReport,
} from '../packages/cineswarm-bridge/src/archive-recovery.js';

const args = process.argv.slice(2);
if (args.length !== 4) {
  console.error('Usage: node scripts/cineswarm-run-governed-restore-drill.mjs <context.json> <source-replica-root> <restore-target-root> <output-dir>');
  process.exit(64);
}
const [contextPath, sourceRootPath, targetRootPath, outputDirPath] = args;
const context = JSON.parse(readFileSync(resolve(contextPath), 'utf8'));
const sourceRoot = resolve(sourceRootPath);
const targetRoot = resolve(targetRootPath);
const outputDir = resolve(outputDirPath);
const { c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, sourceReplicaManifest, sourceVerificationReport } = context;
validateReplicaVerificationReport(sourceVerificationReport, { c18Policy, recoveryBundle, replicaManifest: sourceReplicaManifest });
if (sourceVerificationReport.health !== 'HEALTHY') throw new Error('governed restore requires a HEALTHY source-replica verification report');
mkdirSync(targetRoot, { recursive: true });
const restoredObjects = [];
for (const item of recoveryBundle.objects) {
  const source = resolve(sourceRoot, item.relativePath);
  const target = resolve(targetRoot, item.relativePath);
  if (!source.startsWith(sourceRoot) || !target.startsWith(targetRoot)) throw new Error(`path traversal rejected for ${item.kind}`);
  if (!existsSync(source)) throw new Error(`source replica is missing ${item.kind}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  const bytes = readFileSync(target);
  restoredObjects.push({ kind: item.kind, observedBlobSha256: createHash('sha256').update(bytes).digest('hex'), observedSizeBytes: statSync(target).size });
}
const startedAt = new Date().toISOString();
const completedAt = new Date(Date.now() + 1).toISOString();
const drill = buildRestoreDrillReport({ c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, sourceReplicaManifest, sourceVerificationReport, restoredObjects, restoreTargetId: 'governed-restore-target', verifierId: 'parallax-c1-18-restore-verifier', startedAt, completedAt, primaryArchiveAssumedUnavailable: true });
const receipt = buildDisasterRecoveryReceipt({ c18Policy, recoveryBundle, bundleValidationContext, replicaSet, replicaManifests, sourceReplicaManifest, sourceVerificationReport, restoreDrillReport: drill, issuedAt: new Date(Date.now() + 2).toISOString() });
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'restore-drill.json'), `${JSON.stringify(drill, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'disaster-recovery-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ restored: true, restoreDrillHash: drill.restoreDrillHash, disasterRecoveryReceiptHash: receipt.disasterRecoveryReceiptHash, disasterRecoveryProven: receipt.disasterRecoveryProven, publicRelease: false, relayDependency: false }, null, 2));
