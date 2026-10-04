#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { sealAuthorizationPayload } from '../packages/cineswarm-bridge/src/authorization-seal.js';

const args = process.argv.slice(2);
const payloadPath = args[0];
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

if (!payloadPath) {
  console.error('Usage: node scripts/cineswarm-sign-authorization-receipt.mjs <payload.json> --payload-type <type> --payload-id <id> --key-id <id> --authority-id <id> --private-key <external.pem> --signed-at <iso> --expires-at <iso> --out <seal.json>');
  process.exit(64);
}

const privateKeyPath = flag('--private-key');
const outputPath = flag('--out');
if (!privateKeyPath || !outputPath) throw new Error('--private-key and --out are required');
const repositoryRoot = resolve(import.meta.dirname, '..');
const resolvedPrivateKey = resolve(privateKeyPath);
if (resolvedPrivateKey === repositoryRoot || resolvedPrivateKey.startsWith(`${repositoryRoot}${sep}`)) {
  throw new Error('private signing key must remain outside the repository tree');
}

const payload = JSON.parse(readFileSync(resolve(payloadPath), 'utf8'));
const privateKeyPem = readFileSync(resolvedPrivateKey, 'utf8');
const seal = sealAuthorizationPayload(payload, {
  payloadType: flag('--payload-type'),
  payloadId: flag('--payload-id'),
  keyId: flag('--key-id'),
  authorityId: flag('--authority-id'),
  privateKeyPem,
  signedAt: flag('--signed-at'),
  expiresAt: flag('--expires-at'),
});
writeFileSync(resolve(outputPath), `${JSON.stringify(seal, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ sealId: seal.sealId, payloadDigest: seal.payloadDigest, expiresAt: seal.expiresAt, publicRelease: false }, null, 2));
