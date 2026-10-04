#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendReleaseCandidatePackageToRegister,
  buildReleaseCandidatePackage,
} from '../packages/cineswarm-bridge/src/ledger-release-candidate.js';

const [c14PolicyPath, contextDir, ledgerOutputDir, keyRegistryPath, releaseRegisterPath, recordedAt, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('Usage: node scripts/cineswarm-build-release-candidate-package.mjs <c1-14-policy.json> <c1-13-context-dir> <c1-14-ledger-output-dir> <combined-key-registry.json> <release-candidate-register.json> <recorded-at> <output-dir>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const ctx = (name) => readJson(resolve(contextDir, name));
const c14Policy = readJson(c14PolicyPath);
const c13Policy = ctx('canon-policy.json');
const masterPolicy = ctx('master-policy.json');
const packet = ctx('ledger-admission-packet.json');
const packetRegister = ctx('ledger-packet-register.json');
const keyRegistry = readJson(keyRegistryPath);
const lineage = {
  masterCandidate: ctx('master-candidate.json'), masterRegister: ctx('master-register.json'), canonReview: ctx('canon-review.json'),
  promotionCeremony: ctx('canon-promotion-ceremony.json'), canonRecord: ctx('canon-record.json'), canonRegister: ctx('canon-register.json'), keyRegistry,
};
const verificationReport = readJson(resolve(ledgerOutputDir, 'ledger-verification-report.json'));
const admissionCeremony = readJson(resolve(ledgerOutputDir, 'ledger-admission-ceremony.json'));
const admissionReceipt = readJson(resolve(ledgerOutputDir, 'ledger-admission-receipt.json'));
const admissionRegister = readJson(resolve(ledgerOutputDir, 'ledger-admission-register.json'));
const receiptContext = { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, admissionCeremony, keyRegistry };
const packageContext = { c14Policy, packet, verificationReport, admissionCeremony, admissionReceipt, admissionRegister, receiptContext };
const pkg = buildReleaseCandidatePackage({ ...packageContext, createdAt: recordedAt });
let releaseRegister = readJson(releaseRegisterPath);
releaseRegister = appendReleaseCandidatePackageToRegister({ register: releaseRegister, pkg, c14Policy, packageContext, recordedAt });
mkdirSync(resolve(outputDir), { recursive: true });
writeFileSync(resolve(outputDir, 'release-candidate-package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'release-candidate-register.json'), `${JSON.stringify(releaseRegister, null, 2)}\n`);
console.log(JSON.stringify({
  assembled: true,
  releaseCandidatePackageHash: pkg.releaseCandidatePackageHash,
  releaseEvidenceRootHash: pkg.releaseEvidenceRootHash,
  releaseCandidateRegisterRevision: releaseRegister.revision,
  ledgerAdmitted: true,
  releaseCeremonyEligible: true,
  networkReleaseAuthorized: false,
  networkReleased: false,
  publicRelease: false,
}, null, 2));
