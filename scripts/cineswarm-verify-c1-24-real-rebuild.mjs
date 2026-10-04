#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyIndependentRebuildState,
  validateBuildInputAcquisitionStatus,
  validateBuildInputArchive,
  validateHermeticDecoderRecipe,
  validateIndependentBuildPolicy,
  validateIndependentRebuildReceipt,
  validateIndependentRebuildRegister,
  validateIndependentRebuildReport,
} from '../packages/cineswarm-bridge/src/independent-source-rebuild.js';
import { digestJson } from '../packages/cineswarm-bridge/src/authorization-seal.js';

const root = resolve(process.argv[2] || '.');
const fixture = resolve(root, 'fixtures/cineswarm');
const acquisition = resolve(root, 'proof/c1-24/real-input-acquisition');
const proof = resolve(root, 'proof/c1-24/real-independent-rebuild');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

try {
  const policy = readJson(resolve(fixture, 'pn-0001-c1-24-independent-build-policy.json'));
  const status = readJson(resolve(fixture, 'pn-0001-c1-24-build-input-status.json'));
  const canonical = readJson(resolve(fixture, 'pn-0001-c1-24-independent-rebuild-register.json'));
  const ingest = readJson(resolve(acquisition, 'C1_24_SOURCE_INGEST_RECEIPT.json'));
  const archive = readJson(resolve(proof, 'BUILD_INPUT_ARCHIVE.json'));
  const recipe = readJson(resolve(proof, 'HERMETIC_BUILD_RECIPE.json'));
  const report = readJson(resolve(proof, 'INDEPENDENT_REBUILD_REPORT.json'));
  const receipt = readJson(resolve(proof, 'INDEPENDENT_REBUILD_RECEIPT.json'));
  const proofRegister = readJson(resolve(proof, 'PROOF_REGISTER.json'));

  validateIndependentBuildPolicy(policy);
  validateBuildInputAcquisitionStatus(status, { policy });
  if (status.status !== 'READY_TO_BUILD_INPUT_ARCHIVE' || status.missingKinds.length !== 0) throw new Error('physical build-input closure is not 7/7 ready');
  for (const descriptor of status.artifacts) {
    const path = resolve(root, descriptor.path);
    if (!existsSync(path)) throw new Error(`${descriptor.kind} evidence file missing`);
    if (statSync(path).size !== descriptor.size) throw new Error(`${descriptor.kind} byte-size drift`);
    if (sha256File(path) !== descriptor.sha256) throw new Error(`${descriptor.kind} SHA-256 drift`);
  }

  const ingestPayload = structuredClone(ingest); delete ingestPayload.receiptHash;
  if (digestJson(ingestPayload) !== ingest.receiptHash || ingest.signatureVerified !== true) throw new Error('source-ingest receipt invalid');
  if (ingest.sourceArtifactSha256 !== status.artifacts.find((a) => a.kind === 'UPSTREAM_SOURCE_TARBALL').sha256) throw new Error('source-ingest/status lineage drift');

  validateBuildInputArchive(archive, { policy });
  validateHermeticDecoderRecipe(recipe, { policy, buildInputArchive: archive });
  validateIndependentRebuildReport(report, { policy, buildInputArchive: archive, recipe });
  validateIndependentRebuildReceipt(receipt, { policy, report, reportContext: { policy, buildInputArchive: archive, recipe } });
  validateIndependentRebuildRegister(proofRegister, { policy, sourceC23ReproDecodeRegisterHash: policy.sourceC23ReproDecodeRegisterHash });
  validateIndependentRebuildRegister(canonical, { policy, sourceC23ReproDecodeRegisterHash: policy.sourceC23ReproDecodeRegisterHash });

  const buildLogSha256 = sha256File(resolve(proof, 'BUILD.log'));
  if (buildLogSha256 !== report.buildResult.buildLogSha256) throw new Error('saved build log SHA-256 drift');
  if (report.status !== 'PASS_INDEPENDENT_SOURCE_REBUILD' || receipt.fullIndependentSourceRebuildProven !== true || proofRegister.fullIndependentSourceRebuildProven !== true) throw new Error('saved real proof does not establish independent source rebuild');
  if (receipt.fullOsIsolationProven !== false) throw new Error('C1.24B must not overclaim full OS isolation');
  if (canonical.revision !== 0 || canonical.entryCount !== 0 || canonical.fullIndependentSourceRebuildProven !== false) throw new Error('canonical C1.24 register was silently promoted');

  const canonicalState = classifyIndependentRebuildState({
    policy,
    register: canonical,
    sourceC23ReproDecodeRegisterHash: policy.sourceC23ReproDecodeRegisterHash,
    acquisitionStatus: status,
  });

  console.log(JSON.stringify({
    ok: true,
    phase: 'C1.24B',
    physicalInputClosure: '7/7',
    sourceAuthenticityVerified: true,
    proofStatus: report.status,
    proofFullIndependentSourceRebuildProven: true,
    fullOsIsolationProven: false,
    buildInputArchiveHash: archive.archiveHash,
    recipeHash: recipe.recipeHash,
    reportHash: report.reportHash,
    receiptHash: receipt.receiptHash,
    proofRegisterHash: proofRegister.registerHash,
    buildLogSha256,
    canonicalRegisterRevision: canonical.revision,
    canonicalFullIndependentSourceRebuildProven: canonical.fullIndependentSourceRebuildProven,
    canonicalAdmissionPending: true,
    buildInputsReady: canonicalState.buildInputsReady,
    publicRelease: false,
    relayDependency: false,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, phase: 'C1.24B', error: error.message }, null, 2));
  process.exit(65);
}
