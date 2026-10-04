#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildBuildInputAcquisitionStatus,
  validateBuildInputAcquisitionStatus,
  validateIndependentBuildPolicy,
} from '../packages/cineswarm-bridge/src/independent-source-rebuild.js';
import { digestJson } from '../packages/cineswarm-bridge/src/authorization-seal.js';

const EXPECTED_SOURCE_SHA256 = 'de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f';
const EXPECTED_SOURCE_SIZE = 11050340;
const EXPECTED_SIGNATURE_SHA256 = '7ce4b9d56e3ef0cd4c3a9c0b2c8a034ac91e6c4c011c1f10b05a8aa7292fca35';

function die(message, code = 65) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(code);
}
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.error) throw result.error;
  return result;
}

const sourceArg = process.argv[2];
const root = resolve(process.argv[3] || '.');
if (!sourceArg) {
  console.error('Usage: node scripts/cineswarm-c1-24-ingest-source-artifact.mjs <local-ffmpeg-7.1.5.tar.xz> [repo-root]');
  process.exit(64);
}
const sourcePath = resolve(sourceArg);
if (!existsSync(sourcePath)) die(`source artifact not found: ${sourcePath}`, 66);

const fixtureDir = resolve(root, 'fixtures/cineswarm');
const evidenceDir = resolve(root, 'proof/c1-24/real-input-acquisition');
const policyPath = resolve(fixtureDir, 'pn-0001-c1-24-independent-build-policy.json');
const statusPath = resolve(fixtureDir, 'pn-0001-c1-24-build-input-status.json');
const signaturePath = resolve(evidenceDir, 'ffmpeg-7.1.5.tar.xz.asc');
const publicKeyPath = resolve(evidenceDir, 'ffmpeg-devel.asc');
const destinationPath = resolve(evidenceDir, 'ffmpeg-7.1.5.tar.xz');
const receiptPath = resolve(evidenceDir, 'C1_24_SOURCE_INGEST_RECEIPT.json');

const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const status = JSON.parse(readFileSync(statusPath, 'utf8'));
validateIndependentBuildPolicy(policy);
validateBuildInputAcquisitionStatus(status, { policy });

if (!existsSync(signaturePath) || !existsSync(publicKeyPath)) die('preserved detached signature/public key evidence is missing');
const observedSize = statSync(sourcePath).size;
const observedSha256 = sha256File(sourcePath);
if (observedSize !== EXPECTED_SOURCE_SIZE) die(`source artifact size mismatch: expected ${EXPECTED_SOURCE_SIZE}, got ${observedSize}`);
if (observedSha256 !== EXPECTED_SOURCE_SHA256) die(`source artifact SHA-256 mismatch: expected ${EXPECTED_SOURCE_SHA256}, got ${observedSha256}`);
const signatureSha256 = sha256File(signaturePath);
if (signatureSha256 !== EXPECTED_SIGNATURE_SHA256) die(`detached signature SHA-256 drift: ${signatureSha256}`);

const gpgHome = mkdtempSync(resolve(tmpdir(), 'c124-gpg-'));
try {
  const imported = run('gpg', ['--homedir', gpgHome, '--batch', '--import', publicKeyPath]);
  if (imported.status !== 0) die(`release signing key import failed: ${imported.stderr.trim()}`);
  const fingerprints = run('gpg', ['--homedir', gpgHome, '--batch', '--with-colons', '--fingerprint']);
  if (fingerprints.status !== 0) die(`release key fingerprint check failed: ${fingerprints.stderr.trim()}`);
  const observedFingerprints = fingerprints.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('fpr:'))
    .map((line) => line.split(':')[9])
    .filter(Boolean);
  if (!observedFingerprints.includes(policy.releaseSigningKeyFingerprint)) {
    die(`release signing fingerprint mismatch; expected ${policy.releaseSigningKeyFingerprint}`);
  }
  const verified = run('gpg', ['--homedir', gpgHome, '--batch', '--verify', signaturePath, sourcePath]);
  if (verified.status !== 0) die(`detached signature verification failed: ${verified.stderr.trim()}`);

  if (existsSync(destinationPath)) {
    const existingSha = sha256File(destinationPath);
    const existingSize = statSync(destinationPath).size;
    if (existingSha !== EXPECTED_SOURCE_SHA256 || existingSize !== EXPECTED_SOURCE_SIZE) {
      die('governed source destination already exists with unexpected bytes');
    }
  } else {
    const stagingPath = `${destinationPath}.staging-${process.pid}`;
    copyFileSync(sourcePath, stagingPath);
    if (sha256File(stagingPath) !== EXPECTED_SOURCE_SHA256 || statSync(stagingPath).size !== EXPECTED_SOURCE_SIZE) {
      rmSync(stagingPath, { force: true });
      die('staged source artifact failed post-copy verification');
    }
    renameSync(stagingPath, destinationPath);
  }

  const artifacts = status.artifacts.map((artifact) => artifact.kind === 'UPSTREAM_SOURCE_TARBALL'
    ? {
        ...artifact,
        artifactId: 'pn0001-c1-24-preserved-input-01',
        present: true,
        path: 'proof/c1-24/real-input-acquisition/ffmpeg-7.1.5.tar.xz',
        sha256: EXPECTED_SOURCE_SHA256,
        size: EXPECTED_SOURCE_SIZE,
      }
    : artifact);
  const checkedAt = new Date().toISOString();
  const nextStatus = buildBuildInputAcquisitionStatus({
    policy,
    artifacts,
    checkedAt,
    statusId: status.statusId,
  });
  validateBuildInputAcquisitionStatus(nextStatus, { policy });
  if (nextStatus.status !== 'READY_TO_BUILD_INPUT_ARCHIVE' || nextStatus.missingKinds.length !== 0) {
    die('verified source did not produce READY_TO_BUILD_INPUT_ARCHIVE');
  }

  const receipt = {
    schema: 'parallax.cineswarm.source-artifact-ingest-receipt.c1.24.v0.1',
    receiptId: 'pn0001-c1-24-source-ingest-receipt',
    policyId: policy.policyId,
    sourceProject: policy.sourceProject,
    sourceVersion: policy.sourceVersion,
    sourceFileName: basename(destinationPath),
    sourceArtifactSha256: EXPECTED_SOURCE_SHA256,
    sourceArtifactSize: EXPECTED_SOURCE_SIZE,
    detachedSignatureSha256: EXPECTED_SIGNATURE_SHA256,
    releaseSigningKeyFingerprint: policy.releaseSigningKeyFingerprint,
    signatureVerified: true,
    verificationTool: 'gpg',
    verifiedAt: checkedAt,
    acquisitionStatusHash: nextStatus.statusHash,
    fullIndependentSourceRebuildProven: false,
    publicRelease: false,
    relayDependency: false,
  };
  receipt.receiptHash = digestJson(receipt);

  const statusTmp = `${statusPath}.tmp-${process.pid}`;
  const receiptTmp = `${receiptPath}.tmp-${process.pid}`;
  writeFileSync(statusTmp, `${JSON.stringify(nextStatus, null, 2)}\n`);
  writeFileSync(receiptTmp, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(statusTmp, statusPath);
  renameSync(receiptTmp, receiptPath);

  console.log(JSON.stringify({
    ok: true,
    sourceArtifactSha256: EXPECTED_SOURCE_SHA256,
    sourceArtifactSize: EXPECTED_SOURCE_SIZE,
    signatureVerified: true,
    releaseSigningKeyFingerprint: policy.releaseSigningKeyFingerprint,
    acquisitionStatus: nextStatus.status,
    missingKinds: nextStatus.missingKinds,
    receiptHash: receipt.receiptHash,
    nextStep: 'Run scripts/cineswarm-c1-24-run-source-build.mjs only after this status is READY_TO_BUILD_INPUT_ARCHIVE.',
  }, null, 2));
} finally {
  rmSync(gpgHome, { recursive: true, force: true });
}
