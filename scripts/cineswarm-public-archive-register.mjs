#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendArchiveRecordToRegister,
  appendCorrectionNoticeToRegister,
  appendRevalidationToRegister,
  buildPublicArchiveRegister,
} from '../packages/cineswarm-bridge/src/public-archive-integrity.js';
if (process.argv.length < 7) {
  console.error('Usage: node scripts/cineswarm-public-archive-register.mjs <context-bundle.json> <register.json|NEW> <ARCHIVE|NOTICE|REVALIDATION> <object.json> <output.json> [archive-record.json] [recordedAt]');
  process.exit(64);
}
const bundle = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const registerContext = { c17Policy: bundle.c17Policy, c16Policy: bundle.c16Policy, c15Policy: bundle.c15Policy, c15PublicReleaseRegister: bundle.c15PublicReleaseRegister, c16LifecycleRegister: bundle.c16LifecycleRegister };
const recordedAt = process.argv[8] ?? new Date().toISOString();
let register = process.argv[3] === 'NEW'
  ? buildPublicArchiveRegister({ ...registerContext, entries: [], revision: 0, recordedAt })
  : JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'));
const kind = process.argv[4];
const object = JSON.parse(readFileSync(resolve(process.argv[5]), 'utf8'));
const archiveRecord = process.argv[7] ? JSON.parse(readFileSync(resolve(process.argv[7]), 'utf8')) : null;
if (kind === 'ARCHIVE') register = appendArchiveRecordToRegister({ register, archiveRecord: object, registerContext, recordedAt });
else if (kind === 'NOTICE') register = appendCorrectionNoticeToRegister({ register, notice: object, archiveRecord, registerContext, recordedAt });
else if (kind === 'REVALIDATION') register = appendRevalidationToRegister({ register, report: object, archiveRecord, registerContext, recordedAt });
else throw new Error('kind must be ARCHIVE, NOTICE, or REVALIDATION');
writeFileSync(resolve(process.argv[6]), `${JSON.stringify(register, null, 2)}\n`);
console.log(JSON.stringify({ revision: register.revision, registerHash: register.registerHash, status: register.status, archivedReleaseCount: register.archivedReleaseCount, correctionNoticeCount: register.correctionNoticeCount, revalidatedReleaseCount: register.revalidatedReleaseCount, latestIntegrityPassCount: register.latestIntegrityPassCount, publicRelease: register.publicRelease }, null, 2));
