#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCandidateAssetRegistry } from '../packages/cineswarm-bridge/src/candidate-picture-plan.js';

const root = new URL('../', import.meta.url);
const registryPath = resolve(process.argv[2] ?? new URL('fixtures/cineswarm/pn-0001-c1-9-candidate-asset-registry.json', root).pathname);
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const result = validateCandidateAssetRegistry(registry);
console.log(JSON.stringify({
  valid: result.valid,
  registryId: registry.registryId,
  revision: registry.revision,
  entryCount: registry.entryCount,
  status: registry.status,
  registryHash: registry.registryHash,
  pictureLockEligibleCount: registry.pictureLockEligibleCount,
  canonEligibleCount: registry.canonEligibleCount,
  publicRelease: registry.publicRelease,
  relayDependency: registry.relayDependency,
}, null, 2));
