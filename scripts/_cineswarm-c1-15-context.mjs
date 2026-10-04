import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readJson(path) { return JSON.parse(readFileSync(resolve(path), 'utf8')); }

export function loadC15ReleaseContext({ c14PolicyPath, contextDir, keyRegistryPath }) {
  const c14Policy = readJson(c14PolicyPath);
  const keyRegistry = readJson(keyRegistryPath);
  const ctx = (name) => readJson(resolve(contextDir, name));
  const c13Policy = ctx('canon-policy.json');
  const masterPolicy = ctx('master-policy.json');
  const packet = ctx('ledger-admission-packet.json');
  const packetRegister = ctx('ledger-packet-register.json');
  const verificationReport = ctx('ledger-verification-report.json');
  const admissionCeremony = ctx('ledger-admission-ceremony.json');
  const admissionReceipt = ctx('ledger-admission-receipt.json');
  const admissionRegister = ctx('ledger-admission-register.json');
  const releasePackage = ctx('release-candidate-package.json');
  const releaseRegister = ctx('release-candidate-register.json');
  const lineage = {
    masterCandidate: ctx('master-candidate.json'),
    masterRegister: ctx('master-register.json'),
    canonReview: ctx('canon-review.json'),
    promotionCeremony: ctx('canon-promotion-ceremony.json'),
    canonRecord: ctx('canon-record.json'),
    canonRegister: ctx('canon-register.json'),
    keyRegistry,
  };
  const receiptContext = { c14Policy, c13Policy, masterPolicy, packet, packetRegister, lineage, verificationReport, admissionCeremony, keyRegistry };
  const releasePackageContext = { c14Policy, packet, verificationReport, admissionCeremony, admissionReceipt, admissionRegister, receiptContext };
  return { c14Policy, keyRegistry, releasePackage, releaseRegister, releasePackageContext };
}
