import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  appendArchiveRecordToRegister,
  appendCorrectionNoticeToRegister,
  appendRevalidationToRegister,
  buildIntegrityRevalidationReport,
  buildPublicArchiveRecord,
  buildPublicArchiveRegister,
  buildPublicCorrectionNotice,
  classifyPublicArchiveState,
  validateIntegrityRevalidationReport,
  validatePublicArchivePolicy,
  validatePublicArchiveRecord,
  validatePublicArchiveRegister,
  validatePublicCorrectionNotice,
} from '../src/public-archive-integrity.js';
import { buildC1_17ActiveFixture, buildC1_17WithdrawnFixture, c17Policy, c16Policy, c15Policy } from './c1-17-fixture.mjs';

const read = (name) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../fixtures/cineswarm/${name}`), 'utf8'));
const canonicalC15 = read('pn-0001-c1-15-public-release-register.json');
const canonicalC16 = read('pn-0001-c1-16-release-lifecycle-register.json');
const canonicalArchive = read('pn-0001-c1-17-public-archive-register.json');

function recordFor(fx, time = '2026-08-13T20:20:00.000Z') {
  return buildPublicArchiveRecord({
    c17Policy, c16Policy, c15Policy,
    c15PublicReleaseRegister: fx.c15Register,
    c16LifecycleRegister: fx.lifecycle,
    publicReleaseReceipt: fx.original.receipt,
    publicReceiptContext: fx.original.receiptContext,
    archivePath: '/archive/pn-0001/welcome-to-parallax-network/v1',
    recordedAt: time,
  });
}
function observations(record, overrides = {}) {
  const base = [
    ['public-release-receipt', record.publicReleaseReceiptHash],
    ['release-receipt-evidence-root', record.releaseReceiptEvidenceRootHash],
    ['published-master-output', record.outputSha256],
    ['c1-15-public-release-register', record.sourceC15RegisterHash],
    ['c1-16-release-lifecycle-register', record.sourceC16LifecycleRegisterHash],
    ['c1-17-public-archive-record', record.archiveRecordHash],
  ];
  return base.map(([kind, hash]) => {
    const patch = overrides[kind] ?? {};
    return { kind, expectedSha256: hash, available: true, observedSha256: hash, ...patch };
  });
}
function registerContext(fx) {
  return { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, c16LifecycleRegister: fx.lifecycle };
}

test('C1.17 canonical archive policy and revision-0 register validate with no invented public history', () => {
  assert.equal(validatePublicArchivePolicy(c17Policy).valid, true);
  const result = validatePublicArchiveRegister(canonicalArchive, { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: canonicalC15, c16LifecycleRegister: canonicalC16 });
  assert.equal(result.revision, 0);
  assert.equal(canonicalArchive.archivedReleaseCount, 0);
  assert.equal(canonicalArchive.publicRelease, false);
});

test('active historical release becomes an Archive Record without granting new release authority', () => {
  const fx = buildC1_17ActiveFixture();
  const record = recordFor(fx);
  const result = validatePublicArchiveRecord(record, { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, c16LifecycleRegister: fx.lifecycle, publicReleaseReceipt: fx.original.receipt, publicReceiptContext: fx.original.receiptContext });
  assert.equal(result.historicalState, 'ACTIVE');
  assert.equal(record.publicReleaseWasTrue, true);
  assert.equal(record.currentlyPublicAtOriginalRoute, true);
  assert.equal(record.archiveCanAuthorizeRelease, false);
  assert.equal(record.publicRelease, false);
});

test('withdrawn release Archive Record preserves historical truth while current route state becomes false', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  assert.equal(record.historicalState, 'WITHDRAWN');
  assert.equal(record.currentlyPublicAtOriginalRoute, false);
  assert.equal(record.withdrawalReceiptHash, fx.withdrawalReceipt.withdrawalReceiptHash);
  assert.equal(record.publicReleaseWasTrue, true);
});

test('correction notice is rejected for an active release', () => {
  const fx = buildC1_17ActiveFixture();
  const record = recordFor(fx);
  assert.throws(() => buildPublicCorrectionNotice({ c17Policy, archiveRecord: record, noticePath: '/archive/pn-0001/notices/v1', publicSummary: 'Should not exist.', recordedAt: '2026-08-13T20:21:00.000Z' }), /only valid for withdrawn or superseded/);
});

test('withdrawn release gets an audience-visible correction/tombstone notice bound to exact history', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  const notice = buildPublicCorrectionNotice({ c17Policy, archiveRecord: record, noticePath: '/archive/pn-0001/notices/welcome-v1', publicSummary: 'This historical version was withdrawn for correction. Its original release receipt remains preserved.', recordedAt: '2026-08-13T20:21:00.000Z' });
  const result = validatePublicCorrectionNotice(notice, { c17Policy, archiveRecord: record });
  assert.equal(result.historicalState, 'WITHDRAWN');
  assert.equal(notice.historicalReceiptPreserved, true);
  assert.equal(notice.noticeDoesNotAuthorizeRelease, true);
});

test('archive and correction paths reject traversal or query/hash ambiguity', () => {
  const fx = buildC1_17WithdrawnFixture();
  assert.throws(() => buildPublicArchiveRecord({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, c16LifecycleRegister: fx.lifecycle, publicReleaseReceipt: fx.original.receipt, publicReceiptContext: fx.original.receiptContext, archivePath: '/archive/../admin', recordedAt: '2026-08-13T20:20:00.000Z' }), /safe governed archive path/);
  const record = recordFor(fx);
  assert.throws(() => buildPublicCorrectionNotice({ c17Policy, archiveRecord: record, noticePath: '/archive/pn-0001/note?draft=1', publicSummary: 'bad path', recordedAt: '2026-08-13T20:21:00.000Z' }), /safe governed archive path/);
});

test('long-term integrity revalidation PASS requires all six governed evidence observations to match', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: observations(record), verifierId: 'parallax-archive-verifier', verifiedAt: '2026-08-14T00:00:00.000Z' });
  const result = validateIntegrityRevalidationReport(report, { c17Policy, archiveRecord: record });
  assert.equal(result.status, 'PASS');
  assert.equal(report.matchCount, 6);
  assert.equal(report.historicalIntegrityVerified, true);
  assert.equal(report.nextRevalidationDueAt, '2026-11-12T00:00:00.000Z');
});

test('missing evidence produces DEGRADED rather than laundering an incomplete check into PASS', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  const obs = observations(record, { 'published-master-output': { available: false, observedSha256: null } });
  const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: obs, verifierId: 'parallax-archive-verifier', verifiedAt: '2026-08-14T00:00:00.000Z' });
  assert.equal(report.status, 'DEGRADED');
  assert.equal(report.missingCount, 1);
  assert.equal(report.requiresHumanAttention, true);
});

test('hash mismatch produces FAIL even when every artifact is present', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  const obs = observations(record, { 'public-release-receipt': { observedSha256: '0'.repeat(64) } });
  const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: obs, verifierId: 'parallax-archive-verifier', verifiedAt: '2026-08-14T00:00:00.000Z' });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.mismatchCount, 1);
  assert.equal(report.historicalIntegrityVerified, false);
});

test('integrity verifier rejects missing, duplicate, extra, or expected-hash-substituted evidence kinds', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  assert.throws(() => buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: observations(record).slice(0, 5), verifierId: 'v', verifiedAt: '2026-08-14T00:00:00.000Z' }), /exactly one observation/);
  const extra = observations(record); extra.push({ kind: 'ungoverned', expectedSha256: '1'.repeat(64), available: true, observedSha256: '1'.repeat(64) });
  assert.throws(() => buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: extra, verifierId: 'v', verifiedAt: '2026-08-14T00:00:00.000Z' }), /cannot add ungoverned/);
  const drift = observations(record); drift[0].expectedSha256 = '2'.repeat(64);
  assert.throws(() => buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: drift, verifierId: 'v', verifiedAt: '2026-08-14T00:00:00.000Z' }), /expected hash drift/);
});

test('append-only archive register records archive → correction notice → revalidation in hash-chained order', () => {
  const fx = buildC1_17WithdrawnFixture();
  const context = registerContext(fx);
  const record = recordFor(fx);
  const notice = buildPublicCorrectionNotice({ c17Policy, archiveRecord: record, noticePath: '/archive/pn-0001/notices/welcome-v1', publicSummary: 'Historical version withdrawn; receipt preserved.', recordedAt: '2026-08-13T20:21:00.000Z' });
  const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: observations(record), verifierId: 'parallax-archive-verifier', verifiedAt: '2026-08-14T00:00:00.000Z' });
  let register = buildPublicArchiveRegister({ ...context, entries: [], revision: 0, recordedAt: '2026-08-13T20:19:00.000Z' });
  register = appendArchiveRecordToRegister({ register, archiveRecord: record, registerContext: context, recordedAt: '2026-08-13T20:20:30.000Z' });
  register = appendCorrectionNoticeToRegister({ register, notice, archiveRecord: record, registerContext: context, recordedAt: '2026-08-13T20:21:30.000Z' });
  register = appendRevalidationToRegister({ register, report, archiveRecord: record, registerContext: context, recordedAt: '2026-08-14T00:00:30.000Z' });
  assert.equal(register.revision, 3);
  assert.equal(register.archivedReleaseCount, 1);
  assert.equal(register.correctionNoticeCount, 1);
  assert.equal(register.latestIntegrityPassCount, 1);
  assert.equal(register.status, 'ARCHIVE_HISTORY_PRESERVED');
});

test('duplicate archive registration and archive hash-chain edits fail closed', () => {
  const fx = buildC1_17WithdrawnFixture();
  const context = registerContext(fx); const record = recordFor(fx);
  let register = buildPublicArchiveRegister({ ...context, entries: [], revision: 0, recordedAt: '2026-08-13T20:19:00.000Z' });
  register = appendArchiveRecordToRegister({ register, archiveRecord: record, registerContext: context, recordedAt: '2026-08-13T20:20:30.000Z' });
  assert.throws(() => appendArchiveRecordToRegister({ register, archiveRecord: record, registerContext: context, recordedAt: '2026-08-13T20:21:00.000Z' }), /already archived/);
  const tampered = structuredClone(register); tampered.entries[0].outputSha256 = '3'.repeat(64);
  assert.throws(() => validatePublicArchiveRegister(tampered, context), /self-hash mismatch/);
});

test('archive status reports overdue internal revalidation without changing public-release authority', () => {
  const fx = buildC1_17WithdrawnFixture();
  const context = registerContext(fx); const record = recordFor(fx);
  const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: observations(record), verifierId: 'parallax-archive-verifier', verifiedAt: '2026-08-14T00:00:00.000Z' });
  let register = buildPublicArchiveRegister({ ...context, entries: [], revision: 0, recordedAt: '2026-08-13T20:19:00.000Z' });
  register = appendArchiveRecordToRegister({ register, archiveRecord: record, registerContext: context, recordedAt: '2026-08-13T20:20:30.000Z' });
  register = appendRevalidationToRegister({ register, report, archiveRecord: record, registerContext: context, recordedAt: '2026-08-14T00:00:30.000Z' });
  const state = classifyPublicArchiveState({ ...context, archiveRegister: register, now: '2026-11-13T00:00:01.000Z' });
  assert.equal(state.overdueRevalidationCount, 1);
  assert.equal(state.archiveCanAuthorizeRelease, false);
  assert.equal(state.publicRelease, false);
});

test('C1.17 revalidates C1.15 and C1.16 source registers rather than trusting copied source hashes', () => {
  const fx = buildC1_17ActiveFixture();
  const tamperedC15 = structuredClone(fx.c15Register); tamperedC15.registerHash = 'f'.repeat(64);
  assert.throws(() => buildPublicArchiveRegister({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: tamperedC15, c16LifecycleRegister: fx.lifecycle, entries: [], revision: 0, recordedAt: '2026-08-13T20:20:00.000Z' }), /Public Release Register self-hash mismatch/);
  const tamperedC16 = structuredClone(fx.lifecycle); tamperedC16.registerHash = 'e'.repeat(64);
  assert.throws(() => buildPublicArchiveRegister({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: fx.c15Register, c16LifecycleRegister: tamperedC16, entries: [], revision: 0, recordedAt: '2026-08-13T20:20:00.000Z' }), /Release Lifecycle Register self-hash mismatch/);
});

test('archive objects preserve evidence but never substitute for release, Ledger, or Relay authority', () => {
  const fx = buildC1_17WithdrawnFixture();
  const record = recordFor(fx);
  const report = buildIntegrityRevalidationReport({ c17Policy, archiveRecord: record, observations: observations(record), verifierId: 'parallax-archive-verifier', verifiedAt: '2026-08-14T00:00:00.000Z' });
  assert.equal(record.archiveCanAuthorizeRelease, false);
  assert.equal(record.publicRelease, false);
  assert.equal(record.relayDependency, false);
  assert.equal(report.autoRepublish, false);
  assert.equal(report.publicRelease, false);
  assert.equal(report.relayDependency, false);
});
