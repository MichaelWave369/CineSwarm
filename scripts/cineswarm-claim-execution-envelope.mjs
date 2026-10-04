#!/usr/bin/env node
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyExecutionEnvelope } from '../packages/cineswarm-bridge/src/authorization-seal.js';
import { claimExecutionEnvelope } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';

const args = process.argv.slice(2);
if (args.length < 9) {
  console.error('Usage: node scripts/cineswarm-claim-execution-envelope.mjs <envelope.json> <packet.json> <requests.json> <authorization-batch.json> <founder-decision.json> <founder-seal.json> <authorization-seals.json> <key-registry.json> <revocations.json> [journal.json] [executionId] [now]');
  process.exit(64);
}
const [envelopePath, packetPath, requestsPath, authBatchPath, founderDecisionPath, founderSealPath, authorizationSealsPath, keyRegistryPath, revocationsPath] = args;
const journalPath = resolve(args[9] || 'fixtures/cineswarm/pn-0001-c1-7-execution-journal.json');
const executionId = args[10] || `exec_${Date.now()}`;
const now = args[11] || new Date().toISOString();
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const envelope = readJson(envelopePath);
const packet = readJson(packetPath);
const requests = readJson(requestsPath);
const authorizationBatch = readJson(authBatchPath);
const founderDecision = readJson(founderDecisionPath);
const founderSeal = readJson(founderSealPath);
const authorizationSeals = readJson(authorizationSealsPath);
const keyRegistry = readJson(keyRegistryPath);
const revocationRegistry = readJson(revocationsPath);
const verification = verifyExecutionEnvelope({ envelope, packet, requests, authorizationBatch, founderDecision, founderSeal, authorizationSeals, keyRegistry, revocationRegistry, now });

const lockPath = `${journalPath}.lock`;
let lockFd;
try {
  lockFd = openSync(lockPath, 'wx', 0o600);
  const journal = readJson(journalPath);
  const next = claimExecutionEnvelope({ journal, envelope, envelopeVerification: verification, now, executionId });
  const tempPath = `${journalPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, journalPath);
  console.log(JSON.stringify({ claimed: true, executionId, envelopeId: envelope.envelopeId, journalHead: next.entries.at(-1).entryHash, publicRelease: false, relayDependency: false }, null, 2));
} finally {
  if (lockFd !== undefined) closeSync(lockFd);
  try { unlinkSync(lockPath); } catch {}
}
