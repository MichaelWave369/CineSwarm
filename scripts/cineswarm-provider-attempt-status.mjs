#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAssetIntakePolicy } from '../packages/cineswarm-bridge/src/asset-intake.js';

const policyPath = process.argv[2] || 'fixtures/cineswarm/pn-0001-c1-8-asset-intake-policy.json';
const registerPath = process.argv[3] || 'fixtures/cineswarm/pn-0001-c1-8-quarantine-register.json';
const policy = JSON.parse(readFileSync(resolve(policyPath), 'utf8'));
const register = JSON.parse(readFileSync(resolve(registerPath), 'utf8'));
validateAssetIntakePolicy(policy);
console.log(JSON.stringify({
  phase: 'C1.8',
  policyId: policy.policyId,
  quarantineStatus: register.status,
  providerAttemptReceipts: register.attemptReceiptCount,
  quarantinedAssets: register.quarantinedAssetCount,
  acceptedCandidates: register.acceptedCandidateCount,
  pictureLockEligible: register.pictureLockEligibleCount,
  canonEligible: register.canonEligibleCount,
  publicRelease: false,
  relayDependency: false,
  note: 'No provider attempt or generated asset is inferred from this status record.',
}, null, 2));
