#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePreservationAuditRefreshPolicy, validatePreservationRegister, classifyPreservationState } from '../packages/cineswarm-bridge/src/preservation-audit-refresh.js';

const base = resolve(import.meta.dirname, '../fixtures/cineswarm');
const read = (name) => JSON.parse(readFileSync(resolve(base, name), 'utf8'));
const c20Policy = read('pn-0001-c1-20-preservation-audit-refresh-policy.json');
const c19Policy = read('pn-0001-c1-19-replica-maintenance-policy.json');
const c18Policy = read('pn-0001-c1-18-archive-recovery-policy.json');
const c17Policy = read('pn-0001-c1-17-public-archive-policy.json');
const c16Policy = read('pn-0001-c1-16-release-lifecycle-policy.json');
const c15Policy = read('pn-0001-c1-15-network-release-policy.json');
const c15reg = read('pn-0001-c1-15-public-release-register.json');
const c16reg = read('pn-0001-c1-16-release-lifecycle-register.json');
const c17reg = read('pn-0001-c1-17-public-archive-register.json');
const c18reg = read('pn-0001-c1-18-archive-recovery-register.json');
const c19reg = read('pn-0001-c1-19-replica-maintenance-register.json');
const adapters = read('pn-0001-c1-19-storage-adapter-registry.json');
const c20reg = read('pn-0001-c1-20-preservation-register.json');
const c17RegisterContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister: c15reg, c16LifecycleRegister: c16reg };
const c18RecoveryRegisterContext = { c18Policy, c17Policy, c17ArchiveRegister: c17reg, c17RegisterContext };
const c19MaintenanceRegisterContext = { c19Policy, c18Policy, c18RecoveryRegister: c18reg, c18RecoveryRegisterContext, adapterRegistry: adapters };
const context = { c20Policy, c19Policy, c19MaintenanceRegister: c19reg, c19MaintenanceRegisterContext, storageAdapterRegistry: adapters };
validatePreservationAuditRefreshPolicy(c20Policy);
validatePreservationRegister(c20reg, context);
console.log(JSON.stringify({
  policy: { maxAuditAgeDays: c20Policy.maxAuditAgeDays, refreshWarningLeadDays: c20Policy.refreshWarningLeadDays, maxRefreshAuthorizationAgeHours: c20Policy.maxRefreshAuthorizationAgeHours, mediaRefreshDueDateStatus: c20Policy.mediaRefreshDueDateStatus },
  register: c20reg,
  classification: classifyPreservationState({ ...context, preservationRegister: c20reg }),
}, null, 2));
