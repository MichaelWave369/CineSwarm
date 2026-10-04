#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIntegrityRevalidationReport } from '../packages/cineswarm-bridge/src/public-archive-integrity.js';
if (process.argv.length < 7) {
  console.error('Usage: node scripts/cineswarm-revalidate-public-archive.mjs <policy.json> <archive-record.json> <observations.json> <verifier-id> <output.json> [verifiedAt]');
  process.exit(64);
}
const c17Policy = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const archiveRecord = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
const observations = JSON.parse(readFileSync(resolve(process.argv[4]), 'utf8'));
const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord, observations, verifierId: process.argv[5], verifiedAt: process.argv[7] ?? new Date().toISOString() });
writeFileSync(resolve(process.argv[6]), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportId: report.reportId, revalidationReportHash: report.revalidationReportHash, status: report.status, matchCount: report.matchCount, missingCount: report.missingCount, mismatchCount: report.mismatchCount, nextRevalidationDueAt: report.nextRevalidationDueAt, publicRelease: report.publicRelease }, null, 2));
process.exit(report.status === 'FAIL' ? 2 : (report.status === 'DEGRADED' ? 1 : 0));
