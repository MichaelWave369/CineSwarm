#!/usr/bin/env node
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeExecutionClaim } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';

const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('Usage: node scripts/cineswarm-finalize-execution-journal.mjs <journal.json> <envelopeId> <executionId> <SUCCEEDED|FAILED|ABORTED> [recordedAt] [providerReceiptHash|null] [note]');
  process.exit(64);
}
const journalPath = resolve(args[0]);
const envelopeId = args[1];
const executionId = args[2];
const event = args[3];
const recordedAt = args[4] || new Date().toISOString();
const providerReceiptHash = args[5] && args[5] !== 'null' ? args[5] : null;
const note = args[6] || null;
const lockPath = `${journalPath}.lock`;
let lockFd;
try {
  lockFd = openSync(lockPath, 'wx', 0o600);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const next = finalizeExecutionClaim({ journal, envelopeId, executionId, event, recordedAt, providerReceiptHash, note });
  const tempPath = `${journalPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, journalPath);
  console.log(JSON.stringify({ finalized: true, envelopeId, executionId, event, journalHead: next.entries.at(-1).entryHash, publicRelease: false, relayDependency: false }, null, 2));
} finally {
  if (lockFd !== undefined) closeSync(lockFd);
  try { unlinkSync(lockPath); } catch {}
}
