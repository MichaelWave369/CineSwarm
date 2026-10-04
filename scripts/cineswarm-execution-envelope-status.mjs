#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyCurrentSealReadiness } from '../packages/cineswarm-bridge/src/authorization-seal.js';

const fixture = (name) => JSON.parse(readFileSync(resolve('fixtures/cineswarm', name), 'utf8'));
const packet = fixture('pn-0001-seq01-provider-readiness-packet.json');
const founderDecision = fixture('pn-0001-seq01-provider-go-no-go-draft.json');
const authorizationBatch = fixture('pn-0001-seq01-request-authorization-drafts.json');
const keyRegistry = fixture('pn-0001-c1-6-signing-key-registry.json');
const revocationRegistry = fixture('pn-0001-c1-6-revocations.json');
const status = classifyCurrentSealReadiness({
  packet,
  founderDecision,
  authorizationBatch,
  keyRegistry,
  seals: [],
  revocationRegistry,
});
console.log(JSON.stringify(status, null, 2));
process.exit(status.sealReady ? 0 : 3);
