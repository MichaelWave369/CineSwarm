#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyReplicaMaintenanceState, validateReplicaMaintenancePolicy, validateReplicaMaintenanceRegister, validateStorageAdapterRegistry } from '../packages/cineswarm-bridge/src/replica-maintenance.js';
import { validateArchiveRecoveryPolicy } from '../packages/cineswarm-bridge/src/archive-recovery.js';

const root = resolve(import.meta.dirname, '..', 'fixtures', 'cineswarm');
const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const c19Policy = read('pn-0001-c1-19-replica-maintenance-policy.json');
const c18Policy = read('pn-0001-c1-18-archive-recovery-policy.json');
const c17Policy = read('pn-0001-c1-17-public-archive-policy.json');
const c16Policy = read('pn-0001-c1-16-release-lifecycle-policy.json');
const c15Policy = read('pn-0001-c1-15-network-release-policy.json');
const c15PublicReleaseRegister = read('pn-0001-c1-15-public-release-register.json');
const c16LifecycleRegister = read('pn-0001-c1-16-release-lifecycle-register.json');
const c17ArchiveRegister = read('pn-0001-c1-17-public-archive-register.json');
const c18RecoveryRegister = read('pn-0001-c1-18-archive-recovery-register.json');
const adapterRegistry = read('pn-0001-c1-19-storage-adapter-registry.json');
const maintenanceRegister = read('pn-0001-c1-19-replica-maintenance-register.json');
const c17RegisterContext = { c17Policy, c16Policy, c15Policy, c15PublicReleaseRegister, c16LifecycleRegister };
const c18RecoveryRegisterContext = { c18Policy, c17Policy, c17ArchiveRegister, c17RegisterContext };
validateReplicaMaintenancePolicy(c19Policy); validateArchiveRecoveryPolicy(c18Policy); validateStorageAdapterRegistry(adapterRegistry, { c19Policy });
validateReplicaMaintenanceRegister(maintenanceRegister, { c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry });
const status = classifyReplicaMaintenanceState({ c19Policy, c18Policy, c18RecoveryRegister, c18RecoveryRegisterContext, adapterRegistry, maintenanceRegister, now: process.env.CINESWARM_STATUS_NOW ?? null });
console.log(JSON.stringify({ policy: { policyId: c19Policy.policyId, minimumManagedReplicaCount: c19Policy.minimumManagedReplicaCount, minimumDistinctFailureDomains: c19Policy.minimumDistinctFailureDomains, maxSyncAgeDays: c19Policy.maxSyncAgeDays, maxOpenRepairAgeHours: c19Policy.maxOpenRepairAgeHours, requireAtLeastOneColdOrOfflineReplica: c19Policy.requireAtLeastOneColdOrOfflineReplica }, adapterRegistry: { revision: adapterRegistry.revision, adapterCount: adapterRegistry.adapterCount, configuredAdapterCount: adapterRegistry.configuredAdapterCount, registryHash: adapterRegistry.registryHash }, maintenanceRegister: { revision: maintenanceRegister.revision, registerHash: maintenanceRegister.registerHash }, status }, null, 2));
