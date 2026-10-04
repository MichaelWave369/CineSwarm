#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPublicCorrectionNotice } from '../packages/cineswarm-bridge/src/public-archive-integrity.js';
if (process.argv.length < 7) {
  console.error('Usage: node scripts/cineswarm-create-public-correction-notice.mjs <policy.json> <archive-record.json> <notice-path> <public-summary> <output.json> [recordedAt]');
  process.exit(64);
}
const c17Policy = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const archiveRecord = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
const notice = buildPublicCorrectionNotice({ c17Policy, archiveRecord, noticePath: process.argv[4], publicSummary: process.argv[5], recordedAt: process.argv[7] ?? new Date().toISOString() });
writeFileSync(resolve(process.argv[6]), `${JSON.stringify(notice, null, 2)}\n`);
console.log(JSON.stringify({ noticeId: notice.noticeId, correctionNoticeHash: notice.correctionNoticeHash, historicalState: notice.historicalState, publicRelease: notice.publicRelease }, null, 2));
