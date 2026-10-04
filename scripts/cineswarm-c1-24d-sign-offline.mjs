#!/usr/bin/env node
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { publicKeyFingerprintSha256 } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';
import { buildOfflineAdmissionSignedResponse } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { repoRoot } from './lib/c1-24d-context.mjs';
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
function inside(parent, child) { const r = relative(resolve(parent), resolve(child)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); }
const requestPath = arg('request'); const privateKeyPathArg = arg('private-key'); const outPath = resolve(arg('out', './C1_24D_SIGNED_ADMISSION_RESPONSE.json'));
if (!requestPath || !privateKeyPathArg) throw new Error('Usage: --request <OFFLINE_SIGNING_REQUEST.json> --private-key <external private PEM> [--out <signed response.json>]');
const privateKeyPath = resolve(privateKeyPathArg); if (inside(repoRoot, privateKeyPath)) throw new Error('C1.24D refuses to read a human private key from inside the repository/sidecar tree');
const request = JSON.parse(readFileSync(resolve(requestPath), 'utf8'));
if (Date.now() >= Date.parse(request.expiresAt)) throw new Error('C1.24D offline signing request has expired; prepare a fresh request');
const privatePem = readFileSync(privateKeyPath, 'utf8'); const privateKey = createPrivateKey(privatePem); if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('C1.24D private key must be Ed25519');
const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(); const fingerprint = publicKeyFingerprintSha256(publicPem);
if (fingerprint !== request.expectedPublicKeyFingerprintSha256) throw new Error('C1.24D external private key does not match the signing request fingerprint');
const signatureBase64 = cryptoSign(null, Buffer.from(request.messageUtf8), privateKey).toString('base64');
const response = buildOfflineAdmissionSignedResponse({ request, signatureBase64 });
writeFileSync(outPath, JSON.stringify(response, null, 2) + '\n');
console.log(JSON.stringify({ signed: true, outPath, requestHash: request.requestHash, responseHash: response.responseHash, keyId: request.keyId, fingerprintSha256: fingerprint, privateKeyCopied: false, canonicalApplied: false }, null, 2));
