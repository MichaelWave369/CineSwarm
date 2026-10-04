#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPublicArchiveRecord } from '../packages/cineswarm-bridge/src/public-archive-integrity.js';
if (process.argv.length < 5) {
  console.error('Usage: node scripts/cineswarm-create-public-archive-record.mjs <context-bundle.json> <archive-path> <output.json> [recordedAt]');
  process.exit(64);
}
const bundle = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const record = buildPublicArchiveRecord({ ...bundle, archivePath: process.argv[3], recordedAt: process.argv[5] ?? new Date().toISOString() });
writeFileSync(resolve(process.argv[4]), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ archiveRecordId: record.archiveRecordId, archiveRecordHash: record.archiveRecordHash, historicalState: record.historicalState, currentlyPublicAtOriginalRoute: record.currentlyPublicAtOriginalRoute, publicRelease: record.publicRelease }, null, 2));
