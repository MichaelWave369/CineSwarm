#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProviderAttemptReceipt } from '../packages/cineswarm-bridge/src/asset-intake.js';

const [journalPath, executionId, requestPath, packetPath, providerResultPath, artifactPath, receiptOutput, startedAtArg, completedAtArg] = process.argv.slice(2);
if (!receiptOutput) {
  console.error('Usage: node scripts/cineswarm-create-provider-attempt-receipt.mjs <journal.json> <executionId> <request.json> <packet.json> <provider-result.json> <artifact-or-null> <receipt-output.json> [startedAt] [completedAt]');
  process.exit(64);
}
const journal = JSON.parse(readFileSync(resolve(journalPath), 'utf8'));
const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
const packet = JSON.parse(readFileSync(resolve(packetPath), 'utf8'));
const providerResult = JSON.parse(readFileSync(resolve(providerResultPath), 'utf8'));
const artifactBytes = artifactPath === 'null' ? null : readFileSync(resolve(artifactPath));
const startedAt = startedAtArg || new Date().toISOString();
const completedAt = completedAtArg || new Date().toISOString();
const receipt = buildProviderAttemptReceipt({ journal, executionId, request, packet, providerResult, artifactBytes, startedAt, completedAt });
writeFileSync(resolve(receiptOutput), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ receiptId: receipt.receiptId, receiptHash: receipt.receiptHash, status: receipt.status, artifactSha256: receipt.artifact?.sha256 ?? null, publicRelease: false }, null, 2));
