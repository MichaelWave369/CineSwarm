#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyLedgerReleaseReadiness } from '../packages/cineswarm-bridge/src/ledger-release-candidate.js';
const [policyPath = 'fixtures/cineswarm/pn-0001-c1-14-ledger-release-policy.json', packetRegisterPath = 'fixtures/cineswarm/pn-0001-c1-13-ledger-packet-register.json', admissionRegisterPath = 'fixtures/cineswarm/pn-0001-c1-14-ledger-admission-register.json', releaseRegisterPath = 'fixtures/cineswarm/pn-0001-c1-14-release-candidate-register.json'] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const state = classifyLedgerReleaseReadiness({ c14Policy: readJson(policyPath), c13PacketRegister: readJson(packetRegisterPath), admissionRegister: readJson(admissionRegisterPath), releaseCandidateRegister: readJson(releaseRegisterPath) });
console.log(JSON.stringify(state, null, 2));
if (state.publicRelease !== false || state.networkReleaseAuthorized !== false) process.exit(70);
