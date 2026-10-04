import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const readJson = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));
export function loadC124DContext() {
  const c24Policy = readJson('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
  const admissionPolicy = readJson('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
  const kitPolicy = readJson('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json');
  const keyCeremonyPolicy = readJson('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json');
  const keyCeremonyPlan = readJson('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-plan.json');
  const c24CanonicalRegister = readJson('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
  const admissionRegister = readJson('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
  const keyRegistry = readJson('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
  const proofDir = 'proof/c1-24/real-independent-rebuild';
  const proofContext = {
    c24Policy,
    buildInputArchive: readJson(`${proofDir}/BUILD_INPUT_ARCHIVE.json`),
    recipe: readJson(`${proofDir}/HERMETIC_BUILD_RECIPE.json`),
    report: readJson(`${proofDir}/INDEPENDENT_REBUILD_REPORT.json`),
    rebuildReceipt: readJson(`${proofDir}/INDEPENDENT_REBUILD_RECEIPT.json`),
    proofRegister: readJson(`${proofDir}/PROOF_REGISTER.json`),
    buildLogSha256: createHash('sha256').update(readFileSync(resolve(repoRoot, `${proofDir}/BUILD.log`))).digest('hex'),
  };
  return { c24Policy, admissionPolicy, kitPolicy, keyCeremonyPolicy, keyCeremonyPlan, c24CanonicalRegister, admissionRegister, keyRegistry, proofContext };
}
