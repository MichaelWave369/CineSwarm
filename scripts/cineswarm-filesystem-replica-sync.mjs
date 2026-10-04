#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const [mode = 'verify', sourceArg, targetArg, inventoryArg] = process.argv.slice(2);
if (!['verify', 'sync', 'repair'].includes(mode) || !sourceArg || !targetArg || !inventoryArg) {
  console.error('Usage: node scripts/cineswarm-filesystem-replica-sync.mjs <verify|sync|repair> <sourceDir> <targetDir> <recovery-bundle-or-inventory.json>');
  process.exit(64);
}
const sourceDir = resolve(sourceArg); const targetDir = resolve(targetArg);
const input = JSON.parse(readFileSync(resolve(inventoryArg), 'utf8'));
const objects = Array.isArray(input.objects) ? input.objects : input.inventory;
if (!Array.isArray(objects) || !objects.length) throw new Error('inventory JSON must expose a non-empty objects or inventory array');
function safeJoin(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('..') || rel.includes('\\')) throw new Error(`unsafe relative path: ${rel}`);
  const full = resolve(root, rel);
  if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error(`path escapes root: ${rel}`);
  return full;
}
function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function inspect(path, expectedHash, expectedSize) {
  if (!existsSync(path)) return { available: false, sha256: null, sizeBytes: null, status: 'MISSING' };
  const sizeBytes = statSync(path).size; const sha256 = sha256File(path);
  return { available: true, sha256, sizeBytes, status: sha256 === expectedHash && sizeBytes === expectedSize ? 'MATCH' : 'MISMATCH' };
}
const observations = [];
for (const obj of objects) {
  const kind = String(obj.kind); const rel = String(obj.relativePath); const expectedHash = String(obj.blobSha256); const expectedSize = Number(obj.sizeBytes);
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !Number.isInteger(expectedSize) || expectedSize < 1) throw new Error(`invalid inventory object ${kind}`);
  const sourcePath = safeJoin(sourceDir, rel); const targetPath = safeJoin(targetDir, rel);
  const source = inspect(sourcePath, expectedHash, expectedSize); let before = inspect(targetPath, expectedHash, expectedSize); let action = 'NONE';
  if (mode !== 'verify' && before.status !== 'MATCH') {
    if (source.status !== 'MATCH') action = 'BLOCKED_SOURCE_NOT_HEALTHY';
    else { mkdirSync(dirname(targetPath), { recursive: true }); copyFileSync(sourcePath, targetPath); action = before.status === 'MISSING' ? 'COPIED' : 'REPAIRED'; }
  }
  const after = inspect(targetPath, expectedHash, expectedSize);
  observations.push({ kind, relativePath: rel, expectedBlobSha256: expectedHash, expectedSizeBytes: expectedSize, sourceStatus: source.status, targetBeforeStatus: before.status, action, targetAfterStatus: after.status, observedBlobSha256: after.sha256, observedSizeBytes: after.sizeBytes });
}
const mismatchCount = observations.filter((item) => item.targetAfterStatus === 'MISMATCH').length;
const missingCount = observations.filter((item) => item.targetAfterStatus === 'MISSING').length;
const blockedCount = observations.filter((item) => item.action === 'BLOCKED_SOURCE_NOT_HEALTHY').length;
const status = mismatchCount || blockedCount ? 'FAIL' : (missingCount ? 'DEGRADED' : 'HEALTHY');
const result = { schema: 'parallax.cineswarm.filesystem-adapter-run.c1.19.v0.1', authority: 'STORAGE_MECHANICS_ONLY_NOT_A_GOVERNED_MAINTENANCE_RECEIPT', mode, sourceDir, targetDir, objectCount: observations.length, observations, matchCount: observations.filter((item) => item.targetAfterStatus === 'MATCH').length, missingCount, mismatchCount, blockedCount, status, deletesPerformed: 0, maintenanceCanAuthorizeRelease: false, publicRelease: false, relayDependency: false };
console.log(JSON.stringify(result, null, 2));
if (status === 'FAIL') process.exitCode = 2;
