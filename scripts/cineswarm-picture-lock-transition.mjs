#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPictureLockTransitionPayload, signPictureLockTransition } from '../packages/cineswarm-bridge/src/picture-lock.js';

const [policyArg, manifestArg, keyRegistryArg, privateKeyArg, decisionArg, authorityIdArg, outputArg, replacementArg, ...reasonParts] = process.argv.slice(2);
if (!policyArg || !manifestArg || !keyRegistryArg || !privateKeyArg || !decisionArg || !authorityIdArg || !outputArg || !reasonParts.length) {
  console.error('Usage: node scripts/cineswarm-picture-lock-transition.mjs <policy.json> <locked-manifest.json> <key-registry.json> <external-private-key.pem> <UNLOCK_FOR_REVISION|SUPERSEDE> <human-authority-id> <output.json> <replacement-manifest.json|-> <reason...>');
  process.exit(64);
}
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = readJson(policyArg);
const manifest = readJson(manifestArg);
const keyRegistry = readJson(keyRegistryArg);
const privateKeyPem = readFileSync(resolve(privateKeyArg), 'utf8');
const replacementManifest = replacementArg && replacementArg !== '-' ? readJson(replacementArg) : null;
const activeKeys = keyRegistry.keys.filter((key) => key.status === 'active' && key.authority?.id === authorityIdArg);
if (activeKeys.length !== 1) throw new Error(`expected exactly one active signing key for ${authorityIdArg}; found ${activeKeys.length}`);
const payload = buildPictureLockTransitionPayload({
  policy,
  manifest,
  decision: decisionArg,
  reason: reasonParts.join(' '),
  authorityId: authorityIdArg,
  keyId: activeKeys[0].keyId,
  recordedAt: new Date().toISOString(),
  replacementManifest,
});
const transition = signPictureLockTransition(payload, { privateKeyPem, keyRegistry });
writeFileSync(resolve(outputArg), JSON.stringify(transition, null, 2) + '\n');
console.log(JSON.stringify({ valid: true, transitionId: transition.transitionId, transitionHash: transition.transitionHash, decision: transition.decision, publicRelease: false }, null, 2));
