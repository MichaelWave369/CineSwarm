#!/usr/bin/env node
import { classifyNetworkReleaseState } from '../packages/cineswarm-bridge/src/network-release.js';
import { readJson } from './_cineswarm-c1-15-context.mjs';

const [policyPath, releaseCandidateRegisterPath, publicReleaseRegisterPath] = process.argv.slice(2);
if (!publicReleaseRegisterPath) {
  console.error('Usage: node scripts/cineswarm-network-release-status.mjs <c1-15-policy.json> <c1-14-release-candidate-register.json> <c1-15-public-release-register.json>');
  process.exit(64);
}
const state = classifyNetworkReleaseState({ c15Policy: readJson(policyPath), releaseCandidateRegister: readJson(releaseCandidateRegisterPath), publicReleaseRegister: readJson(publicReleaseRegisterPath) });
console.log(JSON.stringify(state, null, 2));
