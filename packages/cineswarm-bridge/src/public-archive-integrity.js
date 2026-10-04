import { digestJson } from './authorization-seal.js';
import {
  validateNetworkReleasePolicy,
  validatePublicReleaseReceipt,
  validatePublicReleaseRegister,
} from './network-release.js';
import {
  validateReleaseLifecyclePolicy,
  validateReleaseLifecycleRegister,
} from './release-lifecycle.js';

export const CINESWARM_PUBLIC_ARCHIVE_POLICY_SCHEMA = 'parallax.cineswarm.public-archive-policy.c1.17.v0.1';
export const CINESWARM_ARCHIVE_RECORD_SCHEMA = 'parallax.cineswarm.public-archive-record.c1.17.v0.1';
export const CINESWARM_CORRECTION_NOTICE_SCHEMA = 'parallax.cineswarm.public-correction-notice.c1.17.v0.1';
export const CINESWARM_INTEGRITY_REVALIDATION_SCHEMA = 'parallax.cineswarm.integrity-revalidation.c1.17.v0.1';
export const CINESWARM_PUBLIC_ARCHIVE_REGISTER_SCHEMA = 'parallax.cineswarm.public-archive-register.c1.17.v0.1';

export const C1_17_ARCHIVE_STATES = ['ACTIVE', 'WITHDRAWN', 'SUPERSEDED'];
export const C1_17_INTEGRITY_STATES = ['PASS', 'DEGRADED', 'FAIL'];

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function safeToken(value, label) {
  const text = requiredString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`${label} contains unsupported characters`);
  return text;
}
function ensureSha256(value, label) {
  const text = requiredString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be SHA-256`);
  return text;
}
function parseTime(value, label) {
  const text = requiredString(value, label);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid ISO-8601 timestamp`);
  return { text, time };
}
function withoutFields(value, fields) {
  const copy = structuredClone(value);
  for (const field of fields) delete copy[field];
  return copy;
}
function safeArchivePath(value, prefix, label) {
  const path = requiredString(value, label);
  if (!path.startsWith(prefix) || path.includes('..') || path.includes('\\') || path.includes('?') || path.includes('#')) throw new Error(`${label} is not a safe governed archive path`);
  return path;
}
function plusDays(iso, days) {
  const date = new Date(parseTime(iso, 'verifiedAt').time);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function validatePublicArchivePolicy(policy) {
  if (!policy || policy.schema !== CINESWARM_PUBLIC_ARCHIVE_POLICY_SCHEMA) throw new Error('invalid C1.17 Public Archive policy schema');
  for (const [value, label] of [[policy.policyId, 'policyId'], [policy.c16PolicyId, 'c16PolicyId'], [policy.c15PolicyId, 'c15PolicyId'], [policy.episodeId, 'episodeId'], [policy.sequenceId, 'sequenceId'], [policy.networkId, 'networkId']]) safeToken(value, label);
  const prefix = requiredString(policy.publicArchivePathPrefix, 'publicArchivePathPrefix');
  if (!prefix.startsWith('/') || !prefix.endsWith('/') || prefix.includes('..') || prefix.includes('\\')) throw new Error('publicArchivePathPrefix must be a safe absolute path prefix ending in /');
  if (!Number.isInteger(policy.maxRevalidationAgeDays) || policy.maxRevalidationAgeDays < 1 || policy.maxRevalidationAgeDays > 365) throw new Error('maxRevalidationAgeDays must be an internal 1-365 day policy');
  for (const key of [
    'requireValidC15HistoricalRegister',
    'requireValidC16LifecycleRegister',
    'preserveHistoricalPublicReceipt',
    'requireCorrectionNoticeForWithdrawnOrSuperseded',
    'requireAudienceVisibleHistoricalState',
    'requireExactPublishedMasterHash',
    'requireReceiptEvidenceRevalidation',
    'requireSourceRegisterRevalidation',
    'appendOnlyArchiveRegister',
    'publicArchiveNeverSubstitutesForLiveRoute',
  ]) if (policy[key] !== true) throw new Error(`${key} must remain true`);
  for (const key of ['autoRepublish', 'historyDeletionAllowed', 'archiveCanAuthorizeRelease', 'relayDependency']) if (policy[key] !== false) throw new Error(`${key} must remain false`);
  return { valid: true };
}

function validateSourceRegisters({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister }) {
  validatePublicArchivePolicy(c17Policy);
  validateReleaseLifecyclePolicy(c16Policy);
  validateNetworkReleasePolicy(c15Policy);
  if (c17Policy.c16PolicyId !== c16Policy.policyId || c17Policy.c15PolicyId !== c15Policy.policyId) throw new Error('C1.17 policy is not bound to supplied C1.16/C1.15 policies');
  for (const key of ['episodeId', 'sequenceId', 'networkId']) {
    if (c17Policy[key] !== c16Policy[key] || c17Policy[key] !== c15Policy[key]) throw new Error(`C1.17 policy ${key} scope drift detected`);
  }
  validatePublicReleaseRegister(c15PublicReleaseRegister, { c15Policy });
  validateReleaseLifecycleRegister(c16LifecycleRegister, { c16Policy, c15Policy, c15PublicReleaseRegister });
  if (c16LifecycleRegister.sourceC15PublicReleaseRegisterHash !== c15PublicReleaseRegister.registerHash) throw new Error('C1.17 C1.16/C1.15 historical register binding mismatch');
  return { valid: true };
}

function deriveHistoricalReleaseState({ publicReleaseReceipt, c15PublicReleaseRegister, c16LifecycleRegister }) {
  const receiptHash = publicReleaseReceipt.publicReleaseReceiptHash;
  const c15Entry = c15PublicReleaseRegister.entries.find((entry) => entry.publicReleaseReceiptHash === receiptHash) ?? null;
  const replacementEntry = c16LifecycleRegister.entries.find((entry) => entry.eventType === 'SUPERSEDED' && entry.replacementPublicReleaseReceiptHash === receiptHash) ?? null;
  if (!c15Entry && !replacementEntry) throw new Error('Public Release Receipt is not present in C1.15/C1.16 historical release lineage');

  const withdrawnEntry = c16LifecycleRegister.entries.find((entry) => entry.eventType === 'WITHDRAWN' && entry.publicReleaseReceiptHash === receiptHash) ?? null;
  const supersededEntry = c16LifecycleRegister.entries.find((entry) => entry.eventType === 'SUPERSEDED' && entry.withdrawnPublicReleaseReceiptHash === receiptHash) ?? null;
  let state = 'ACTIVE';
  if (withdrawnEntry) state = 'WITHDRAWN';
  if (supersededEntry) state = 'SUPERSEDED';

  const sourceEntry = c15Entry ?? replacementEntry;
  return {
    state,
    source: c15Entry ? 'C1.15_PUBLIC_RELEASE_REGISTER' : 'C1.16_REPLACEMENT_HISTORY',
    sourceEntryHash: c15Entry?.entryHash ?? replacementEntry.entryHash,
    withdrawalReceiptHash: withdrawnEntry?.withdrawalReceiptHash ?? supersededEntry?.withdrawalReceiptHash ?? null,
    supersessionReceiptHash: supersededEntry?.supersessionReceiptHash ?? null,
    replacementPublicReleaseReceiptHash: supersededEntry?.replacementPublicReleaseReceiptHash ?? null,
    replacementRouteHash: supersededEntry?.replacementRouteHash ?? null,
  };
}

function archiveRecordPayload(record) { return withoutFields(record, ['archiveRecordHash']); }
export function buildPublicArchiveRecord({
  c17Policy,
  c16Policy,
  c15Policy,
  c15PublicReleaseRegister,
  c16LifecycleRegister,
  publicReleaseReceipt,
  publicReceiptContext,
  archivePath,
  recordedAt,
  archiveRecordId = null,
}) {
  validateSourceRegisters({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister });
  validatePublicReleaseReceipt(publicReleaseReceipt, publicReceiptContext);
  const state = deriveHistoricalReleaseState({ publicReleaseReceipt, c15PublicReleaseRegister, c16LifecycleRegister });
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(publicReleaseReceipt.issuedAt, 'publicReleaseReceipt.issuedAt').time) throw new Error('Archive Record cannot predate Public Release Receipt');
  const record = {
    schema: CINESWARM_ARCHIVE_RECORD_SCHEMA,
    archiveRecordId: safeToken(archiveRecordId ?? `${c17Policy.sequenceId}-archive-${publicReleaseReceipt.publicReleaseReceiptHash.slice(0, 12)}`, 'archiveRecordId'),
    policyId: c17Policy.policyId,
    c16PolicyId: c16Policy.policyId,
    c15PolicyId: c15Policy.policyId,
    episodeId: c17Policy.episodeId,
    sequenceId: c17Policy.sequenceId,
    networkId: c17Policy.networkId,
    publicReleaseReceiptHash: publicReleaseReceipt.publicReleaseReceiptHash,
    releaseCandidatePackageHash: publicReleaseReceipt.releaseCandidatePackageHash,
    releaseReceiptEvidenceRootHash: publicReleaseReceipt.releaseReceiptEvidenceRootHash,
    routeHash: publicReleaseReceipt.routeHash,
    originalPublicPath: publicReleaseReceipt.route.publicPath,
    outputSha256: publicReleaseReceipt.outputSha256,
    archivePath: safeArchivePath(archivePath, c17Policy.publicArchivePathPrefix, 'archivePath'),
    historicalState: state.state,
    historicalSource: state.source,
    historicalSourceEntryHash: state.sourceEntryHash,
    withdrawalReceiptHash: state.withdrawalReceiptHash,
    supersessionReceiptHash: state.supersessionReceiptHash,
    replacementPublicReleaseReceiptHash: state.replacementPublicReleaseReceiptHash,
    replacementRouteHash: state.replacementRouteHash,
    sourceC15RegisterHash: c15PublicReleaseRegister.registerHash,
    sourceC16LifecycleRegisterHash: c16LifecycleRegister.registerHash,
    publicReleaseWasTrue: true,
    currentlyPublicAtOriginalRoute: state.state === 'ACTIVE',
    archivedHistoricalEvidence: true,
    archiveCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
    recordedAt: time.text,
  };
  record.archiveRecordHash = digestJson(archiveRecordPayload(record));
  return record;
}

export function validatePublicArchiveRecord(record, context) {
  const expected = buildPublicArchiveRecord({ ...context, archivePath: record.archivePath, recordedAt: record.recordedAt, archiveRecordId: record.archiveRecordId });
  if (!record || record.schema !== CINESWARM_ARCHIVE_RECORD_SCHEMA) throw new Error('invalid Public Archive Record schema');
  for (const key of ['policyId','c16PolicyId','c15PolicyId','episodeId','sequenceId','networkId','publicReleaseReceiptHash','releaseCandidatePackageHash','releaseReceiptEvidenceRootHash','routeHash','originalPublicPath','outputSha256','archivePath','historicalState','historicalSource','historicalSourceEntryHash','withdrawalReceiptHash','supersessionReceiptHash','replacementPublicReleaseReceiptHash','replacementRouteHash','sourceC15RegisterHash','sourceC16LifecycleRegisterHash','publicReleaseWasTrue','currentlyPublicAtOriginalRoute','archivedHistoricalEvidence','archiveCanAuthorizeRelease','publicRelease','relayDependency']) {
    if (record[key] !== expected[key]) throw new Error(`Public Archive Record ${key} drift detected`);
  }
  if (!C1_17_ARCHIVE_STATES.includes(record.historicalState)) throw new Error('unsupported archive historicalState');
  ensureSha256(record.archiveRecordHash, 'archiveRecordHash');
  if (record.archiveRecordHash !== digestJson(archiveRecordPayload(record))) throw new Error('Public Archive Record self-hash mismatch');
  return { valid: true, historicalState: record.historicalState, currentlyPublicAtOriginalRoute: record.currentlyPublicAtOriginalRoute };
}

function correctionNoticePayload(notice) { return withoutFields(notice, ['correctionNoticeHash']); }
export function buildPublicCorrectionNotice({ c17Policy, archiveRecord, noticePath, publicSummary, recordedAt, noticeId = null }) {
  validatePublicArchivePolicy(c17Policy);
  if (!archiveRecord || archiveRecord.schema !== CINESWARM_ARCHIVE_RECORD_SCHEMA) throw new Error('Public Correction Notice requires a Public Archive Record');
  if (!['WITHDRAWN', 'SUPERSEDED'].includes(archiveRecord.historicalState)) throw new Error('Public Correction Notice is only valid for withdrawn or superseded releases');
  ensureSha256(archiveRecord.archiveRecordHash, 'archiveRecord.archiveRecordHash');
  ensureSha256(archiveRecord.withdrawalReceiptHash, 'archiveRecord.withdrawalReceiptHash');
  if (archiveRecord.historicalState === 'SUPERSEDED') {
    ensureSha256(archiveRecord.supersessionReceiptHash, 'archiveRecord.supersessionReceiptHash');
    ensureSha256(archiveRecord.replacementPublicReleaseReceiptHash, 'archiveRecord.replacementPublicReleaseReceiptHash');
  }
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(archiveRecord.recordedAt, 'archiveRecord.recordedAt').time) throw new Error('Correction Notice cannot predate Archive Record');
  const notice = {
    schema: CINESWARM_CORRECTION_NOTICE_SCHEMA,
    noticeId: safeToken(noticeId ?? `${archiveRecord.archiveRecordId}-notice`, 'noticeId'),
    policyId: c17Policy.policyId,
    archiveRecordId: archiveRecord.archiveRecordId,
    archiveRecordHash: archiveRecord.archiveRecordHash,
    publicReleaseReceiptHash: archiveRecord.publicReleaseReceiptHash,
    historicalState: archiveRecord.historicalState,
    originalPublicPath: archiveRecord.originalPublicPath,
    noticePath: safeArchivePath(noticePath, c17Policy.publicArchivePathPrefix, 'noticePath'),
    publicSummary: requiredString(publicSummary, 'publicSummary'),
    withdrawalReceiptHash: archiveRecord.withdrawalReceiptHash,
    supersessionReceiptHash: archiveRecord.supersessionReceiptHash,
    replacementPublicReleaseReceiptHash: archiveRecord.replacementPublicReleaseReceiptHash,
    historicalReceiptPreserved: true,
    noticeDoesNotDeleteHistory: true,
    noticeDoesNotAuthorizeRelease: true,
    publicRelease: false,
    relayDependency: false,
    recordedAt: time.text,
  };
  notice.correctionNoticeHash = digestJson(correctionNoticePayload(notice));
  return notice;
}

export function validatePublicCorrectionNotice(notice, { c17Policy, archiveRecord }) {
  if (!notice || notice.schema !== CINESWARM_CORRECTION_NOTICE_SCHEMA) throw new Error('invalid Public Correction Notice schema');
  const expected = buildPublicCorrectionNotice({ c17Policy, archiveRecord, noticePath: notice.noticePath, publicSummary: notice.publicSummary, recordedAt: notice.recordedAt, noticeId: notice.noticeId });
  for (const key of ['policyId','archiveRecordId','archiveRecordHash','publicReleaseReceiptHash','historicalState','originalPublicPath','noticePath','withdrawalReceiptHash','supersessionReceiptHash','replacementPublicReleaseReceiptHash','historicalReceiptPreserved','noticeDoesNotDeleteHistory','noticeDoesNotAuthorizeRelease','publicRelease','relayDependency']) if (notice[key] !== expected[key]) throw new Error(`Public Correction Notice ${key} drift detected`);
  ensureSha256(notice.correctionNoticeHash, 'correctionNoticeHash');
  if (notice.correctionNoticeHash !== digestJson(correctionNoticePayload(notice))) throw new Error('Public Correction Notice self-hash mismatch');
  return { valid: true, historicalState: notice.historicalState };
}

function requiredIntegrityEvidence(archiveRecord) {
  return [
    { kind: 'public-release-receipt', expectedSha256: archiveRecord.publicReleaseReceiptHash },
    { kind: 'release-receipt-evidence-root', expectedSha256: archiveRecord.releaseReceiptEvidenceRootHash },
    { kind: 'published-master-output', expectedSha256: archiveRecord.outputSha256 },
    { kind: 'c1-15-public-release-register', expectedSha256: archiveRecord.sourceC15RegisterHash },
    { kind: 'c1-16-release-lifecycle-register', expectedSha256: archiveRecord.sourceC16LifecycleRegisterHash },
    { kind: 'c1-17-public-archive-record', expectedSha256: archiveRecord.archiveRecordHash },
  ];
}
function revalidationPayload(report) { return withoutFields(report, ['revalidationReportHash']); }
export function buildIntegrityRevalidationReport({ c17Policy, archiveRecord, observations, verifierId, verifiedAt, reportId = null }) {
  validatePublicArchivePolicy(c17Policy);
  if (!archiveRecord || archiveRecord.schema !== CINESWARM_ARCHIVE_RECORD_SCHEMA) throw new Error('Integrity Revalidation requires a Public Archive Record');
  ensureSha256(archiveRecord.archiveRecordHash, 'archiveRecord.archiveRecordHash');
  if (!Array.isArray(observations)) throw new Error('observations must be an array');
  const required = requiredIntegrityEvidence(archiveRecord);
  const normalized = required.map((expected) => {
    const matches = observations.filter((item) => item?.kind === expected.kind);
    if (matches.length !== 1) throw new Error(`Integrity Revalidation requires exactly one observation for ${expected.kind}`);
    const item = matches[0];
    if (item.expectedSha256 !== expected.expectedSha256) throw new Error(`Integrity observation ${expected.kind} expected hash drift detected`);
    const available = item.available === true;
    const observedSha256 = item.observedSha256 == null ? null : ensureSha256(item.observedSha256, `${expected.kind}.observedSha256`);
    if (available && !observedSha256) throw new Error(`${expected.kind} available observation requires observedSha256`);
    if (!available && observedSha256 !== null) throw new Error(`${expected.kind} unavailable observation cannot claim observedSha256`);
    const status = !available ? 'MISSING' : (observedSha256 === expected.expectedSha256 ? 'MATCH' : 'MISMATCH');
    return { kind: expected.kind, expectedSha256: expected.expectedSha256, available, observedSha256, status };
  });
  if (observations.length !== required.length) throw new Error('Integrity Revalidation observations cannot add ungoverned evidence kinds');
  const mismatchCount = normalized.filter((item) => item.status === 'MISMATCH').length;
  const missingCount = normalized.filter((item) => item.status === 'MISSING').length;
  const status = mismatchCount > 0 ? 'FAIL' : (missingCount > 0 ? 'DEGRADED' : 'PASS');
  const time = parseTime(verifiedAt, 'verifiedAt');
  if (time.time < parseTime(archiveRecord.recordedAt, 'archiveRecord.recordedAt').time) throw new Error('Integrity Revalidation cannot predate Archive Record');
  const report = {
    schema: CINESWARM_INTEGRITY_REVALIDATION_SCHEMA,
    reportId: safeToken(reportId ?? `${archiveRecord.archiveRecordId}-revalidation-${time.text.slice(0, 10).replaceAll('-', '')}`, 'reportId'),
    policyId: c17Policy.policyId,
    archiveRecordId: archiveRecord.archiveRecordId,
    archiveRecordHash: archiveRecord.archiveRecordHash,
    publicReleaseReceiptHash: archiveRecord.publicReleaseReceiptHash,
    verifierId: safeToken(verifierId, 'verifierId'),
    verifiedAt: time.text,
    nextRevalidationDueAt: plusDays(time.text, c17Policy.maxRevalidationAgeDays),
    observations: normalized,
    observationCount: normalized.length,
    matchCount: normalized.filter((item) => item.status === 'MATCH').length,
    missingCount,
    mismatchCount,
    status,
    historicalIntegrityVerified: status === 'PASS',
    requiresHumanAttention: status !== 'PASS',
    autoRepublish: false,
    publicRelease: false,
    relayDependency: false,
  };
  report.revalidationReportHash = digestJson(revalidationPayload(report));
  return report;
}

export function validateIntegrityRevalidationReport(report, { c17Policy, archiveRecord }) {
  if (!report || report.schema !== CINESWARM_INTEGRITY_REVALIDATION_SCHEMA) throw new Error('invalid Integrity Revalidation Report schema');
  const rebuilt = buildIntegrityRevalidationReport({ c17Policy, archiveRecord, observations: report.observations.map((item) => ({ kind: item.kind, expectedSha256: item.expectedSha256, available: item.available, observedSha256: item.observedSha256 })), verifierId: report.verifierId, verifiedAt: report.verifiedAt, reportId: report.reportId });
  for (const key of ['policyId','archiveRecordId','archiveRecordHash','publicReleaseReceiptHash','nextRevalidationDueAt','observationCount','matchCount','missingCount','mismatchCount','status','historicalIntegrityVerified','requiresHumanAttention','autoRepublish','publicRelease','relayDependency']) if (report[key] !== rebuilt[key]) throw new Error(`Integrity Revalidation ${key} drift detected`);
  if (JSON.stringify(report.observations) !== JSON.stringify(rebuilt.observations)) throw new Error('Integrity Revalidation observation drift detected');
  if (!C1_17_INTEGRITY_STATES.includes(report.status)) throw new Error('unsupported integrity status');
  ensureSha256(report.revalidationReportHash, 'revalidationReportHash');
  if (report.revalidationReportHash !== digestJson(revalidationPayload(report))) throw new Error('Integrity Revalidation self-hash mismatch');
  return { valid: true, status: report.status, historicalIntegrityVerified: report.historicalIntegrityVerified };
}

function archiveEntryPayload(entry) { return withoutFields(entry, ['entryHash']); }
function archiveRegisterPayload(register) { return withoutFields(register, ['registerHash']); }
export function buildPublicArchiveRegister({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister, entries = [], revision = 0, recordedAt }) {
  validateSourceRegisters({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister });
  if (!Array.isArray(entries) || !Number.isInteger(revision) || revision < 0 || revision !== entries.length) throw new Error('Public Archive Register revision must equal entry count');
  let previous = null;
  const archivedReceipts = new Set();
  const notices = new Set();
  const latestRevalidation = new Map();
  for (const [index, entry] of entries.entries()) {
    if (entry.previousEntryHash !== previous) throw new Error(`Public Archive Register hash chain broken at entry ${index}`);
    ensureSha256(entry.entryHash, `entries[${index}].entryHash`);
    if (entry.entryHash !== digestJson(archiveEntryPayload(entry))) throw new Error(`Public Archive Register entry ${index} self-hash mismatch`);
    if (entry.eventType === 'ARCHIVED_PUBLIC_RELEASE') {
      ensureSha256(entry.archiveRecordHash, 'archiveRecordHash');
      ensureSha256(entry.publicReleaseReceiptHash, 'publicReleaseReceiptHash');
      if (archivedReceipts.has(entry.publicReleaseReceiptHash)) throw new Error('Public Release Receipt is already archived');
      archivedReceipts.add(entry.publicReleaseReceiptHash);
    } else if (entry.eventType === 'CORRECTION_NOTICE') {
      ensureSha256(entry.correctionNoticeHash, 'correctionNoticeHash');
      if (!archivedReceipts.has(entry.publicReleaseReceiptHash)) throw new Error('Correction Notice requires prior archive registration');
      if (notices.has(entry.publicReleaseReceiptHash)) throw new Error('Public Release Receipt already has a correction notice');
      notices.add(entry.publicReleaseReceiptHash);
    } else if (entry.eventType === 'INTEGRITY_REVALIDATED') {
      ensureSha256(entry.revalidationReportHash, 'revalidationReportHash');
      if (!archivedReceipts.has(entry.publicReleaseReceiptHash)) throw new Error('Integrity Revalidation requires prior archive registration');
      if (!C1_17_INTEGRITY_STATES.includes(entry.integrityStatus)) throw new Error('Archive Register has unsupported integrity status');
      latestRevalidation.set(entry.publicReleaseReceiptHash, { status: entry.integrityStatus, verifiedAt: entry.verifiedAt, reportHash: entry.revalidationReportHash });
    } else throw new Error('unsupported Public Archive Register eventType');
    if (entry.publicRelease !== false || entry.relayDependency !== false) throw new Error('Public Archive Register entry violates authority boundary');
    previous = entry.entryHash;
  }
  const passCount = [...latestRevalidation.values()].filter((item) => item.status === 'PASS').length;
  const attentionCount = [...latestRevalidation.values()].filter((item) => item.status !== 'PASS').length;
  const register = {
    schema: CINESWARM_PUBLIC_ARCHIVE_REGISTER_SCHEMA,
    registerId: `${c17Policy.sequenceId}-public-archive-register`,
    policyId: c17Policy.policyId,
    episodeId: c17Policy.episodeId,
    sequenceId: c17Policy.sequenceId,
    networkId: c17Policy.networkId,
    sourceC15RegisterHash: c15PublicReleaseRegister.registerHash,
    sourceC16LifecycleRegisterHash: c16LifecycleRegister.registerHash,
    revision,
    recordedAt: parseTime(recordedAt, 'recordedAt').text,
    entries: structuredClone(entries),
    entryCount: entries.length,
    headHash: previous,
    archivedReleaseCount: archivedReceipts.size,
    correctionNoticeCount: notices.size,
    revalidatedReleaseCount: latestRevalidation.size,
    latestIntegrityPassCount: passCount,
    latestIntegrityAttentionCount: attentionCount,
    status: archivedReceipts.size === 0 ? 'EMPTY_NO_ARCHIVED_PUBLIC_RELEASES' : (attentionCount > 0 ? 'ARCHIVE_ATTENTION_REQUIRED' : 'ARCHIVE_HISTORY_PRESERVED'),
    archiveCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  register.registerHash = digestJson(archiveRegisterPayload(register));
  return register;
}

export function validatePublicArchiveRegister(register, context) {
  if (!register || register.schema !== CINESWARM_PUBLIC_ARCHIVE_REGISTER_SCHEMA) throw new Error('invalid Public Archive Register schema');
  const rebuilt = buildPublicArchiveRegister({ ...context, entries: register.entries, revision: register.revision, recordedAt: register.recordedAt });
  for (const key of ['sourceC15RegisterHash','sourceC16LifecycleRegisterHash','entryCount','headHash','archivedReleaseCount','correctionNoticeCount','revalidatedReleaseCount','latestIntegrityPassCount','latestIntegrityAttentionCount','status','archiveCanAuthorizeRelease','publicRelease','relayDependency']) if (register[key] !== rebuilt[key]) throw new Error(`Public Archive Register ${key} mismatch`);
  ensureSha256(register.registerHash, 'registerHash');
  if (register.registerHash !== digestJson(archiveRegisterPayload(register))) throw new Error('Public Archive Register self-hash mismatch');
  return { valid: true, revision: register.revision, status: register.status, archivedReleaseCount: register.archivedReleaseCount };
}

export function appendArchiveRecordToRegister({ register, archiveRecord, registerContext, recordedAt }) {
  validatePublicArchiveRegister(register, registerContext);
  if (!archiveRecord || archiveRecord.schema !== CINESWARM_ARCHIVE_RECORD_SCHEMA) throw new Error('append archive requires Public Archive Record');
  ensureSha256(archiveRecord.archiveRecordHash, 'archiveRecordHash');
  if (register.entries.some((entry) => entry.publicReleaseReceiptHash === archiveRecord.publicReleaseReceiptHash && entry.eventType === 'ARCHIVED_PUBLIC_RELEASE')) throw new Error('Public Release Receipt already archived');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(archiveRecord.recordedAt, 'archiveRecord.recordedAt').time) throw new Error('archive register event cannot predate Archive Record');
  const entry = {
    entryId: `${registerContext.c17Policy.sequenceId}-archive-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'ARCHIVED_PUBLIC_RELEASE',
    publicReleaseReceiptHash: archiveRecord.publicReleaseReceiptHash,
    archiveRecordHash: archiveRecord.archiveRecordHash,
    historicalState: archiveRecord.historicalState,
    archivePath: archiveRecord.archivePath,
    outputSha256: archiveRecord.outputSha256,
    previousEntryHash: register.headHash,
    recordedAt: time.text,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(archiveEntryPayload(entry));
  return buildPublicArchiveRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}

export function appendCorrectionNoticeToRegister({ register, notice, archiveRecord, registerContext, recordedAt }) {
  validatePublicArchiveRegister(register, registerContext);
  validatePublicCorrectionNotice(notice, { c17Policy: registerContext.c17Policy, archiveRecord });
  if (!register.entries.some((entry) => entry.eventType === 'ARCHIVED_PUBLIC_RELEASE' && entry.archiveRecordHash === archiveRecord.archiveRecordHash)) throw new Error('Correction Notice requires registered Archive Record');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(notice.recordedAt, 'notice.recordedAt').time) throw new Error('correction notice register event cannot predate notice');
  const entry = {
    entryId: `${registerContext.c17Policy.sequenceId}-archive-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'CORRECTION_NOTICE',
    publicReleaseReceiptHash: notice.publicReleaseReceiptHash,
    archiveRecordHash: notice.archiveRecordHash,
    correctionNoticeHash: notice.correctionNoticeHash,
    historicalState: notice.historicalState,
    noticePath: notice.noticePath,
    previousEntryHash: register.headHash,
    recordedAt: time.text,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(archiveEntryPayload(entry));
  return buildPublicArchiveRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}

export function appendRevalidationToRegister({ register, report, archiveRecord, registerContext, recordedAt }) {
  validatePublicArchiveRegister(register, registerContext);
  validateIntegrityRevalidationReport(report, { c17Policy: registerContext.c17Policy, archiveRecord });
  if (!register.entries.some((entry) => entry.eventType === 'ARCHIVED_PUBLIC_RELEASE' && entry.archiveRecordHash === archiveRecord.archiveRecordHash)) throw new Error('Integrity Revalidation requires registered Archive Record');
  const time = parseTime(recordedAt, 'recordedAt');
  if (time.time < parseTime(report.verifiedAt, 'report.verifiedAt').time) throw new Error('revalidation register event cannot predate report');
  const entry = {
    entryId: `${registerContext.c17Policy.sequenceId}-archive-event-${String(register.revision + 1).padStart(4, '0')}`,
    eventType: 'INTEGRITY_REVALIDATED',
    publicReleaseReceiptHash: archiveRecord.publicReleaseReceiptHash,
    archiveRecordHash: archiveRecord.archiveRecordHash,
    revalidationReportHash: report.revalidationReportHash,
    integrityStatus: report.status,
    verifiedAt: report.verifiedAt,
    nextRevalidationDueAt: report.nextRevalidationDueAt,
    previousEntryHash: register.headHash,
    recordedAt: time.text,
    publicRelease: false,
    relayDependency: false,
  };
  entry.entryHash = digestJson(archiveEntryPayload(entry));
  return buildPublicArchiveRegister({ ...registerContext, entries: [...register.entries, entry], revision: register.revision + 1, recordedAt: time.text });
}

export function classifyPublicArchiveState({ c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister, archiveRegister, now = null }) {
  validatePublicArchiveRegister(archiveRegister, { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister });
  const latest = new Map();
  for (const entry of archiveRegister.entries) if (entry.eventType === 'INTEGRITY_REVALIDATED') latest.set(entry.publicReleaseReceiptHash, entry);
  const current = now ? parseTime(now, 'now').time : null;
  let overdueRevalidationCount = 0;
  if (current !== null) for (const entry of latest.values()) if (current > parseTime(entry.nextRevalidationDueAt, 'nextRevalidationDueAt').time) overdueRevalidationCount += 1;
  return {
    status: archiveRegister.status,
    archivedReleaseCount: archiveRegister.archivedReleaseCount,
    correctionNoticeCount: archiveRegister.correctionNoticeCount,
    revalidatedReleaseCount: archiveRegister.revalidatedReleaseCount,
    latestIntegrityPassCount: archiveRegister.latestIntegrityPassCount,
    latestIntegrityAttentionCount: archiveRegister.latestIntegrityAttentionCount,
    overdueRevalidationCount,
    publicArchiveReady: archiveRegister.archivedReleaseCount > 0,
    archiveCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}
