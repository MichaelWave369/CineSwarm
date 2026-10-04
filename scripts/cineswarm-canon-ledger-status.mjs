#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyCanonLedgerReadiness } from '../packages/cineswarm-bridge/src/canon-ledger-admission.js';

const [canonPolicyPath = 'fixtures/cineswarm/pn-0001-c1-13-canon-ledger-policy.json', masterPolicyPath = 'fixtures/cineswarm/pn-0001-c1-12-master-review-policy.json', masterRegisterPath = 'fixtures/cineswarm/pn-0001-c1-12-master-candidate-register.json', canonRegisterPath = 'fixtures/cineswarm/pn-0001-c1-13-canon-register.json', ledgerRegisterPath = 'fixtures/cineswarm/pn-0001-c1-13-ledger-packet-register.json'] = process.argv.slice(2);
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const state = classifyCanonLedgerReadiness({ policy: readJson(canonPolicyPath), masterPolicy: readJson(masterPolicyPath), masterRegister: readJson(masterRegisterPath), canonRegister: readJson(canonRegisterPath), ledgerPacketRegister: readJson(ledgerRegisterPath) });
console.log(JSON.stringify(state, null, 2));
if (state.publicRelease !== false) process.exit(70);
