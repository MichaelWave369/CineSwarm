#!/usr/bin/env node
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { buildHumanKeyEnrollmentResponse, validateHumanKeyEnrollmentChallenge } from '../packages/cineswarm-bridge/src/offline-human-admission-kit.js';
import { buildKeyPossessionMessage, publicKeyFingerprintSha256 } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';
import { loadC124DContext, repoRoot } from './lib/c1-24d-context.mjs';
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
function inside(parent, child) { const r = relative(resolve(parent), resolve(child)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); }
const challengePath = arg('challenge'); const privateDirArg = arg('private-dir');
if (!challengePath || !privateDirArg) throw new Error('Usage: --challenge <challenge.json> --private-dir <absolute external directory>');
const privateDir = resolve(privateDirArg);
if (!isAbsolute(privateDirArg)) throw new Error('C1.24D --private-dir must be an absolute path outside the repository/sidecar');
if (inside(repoRoot, privateDir)) throw new Error('C1.24D refuses to create a human private key inside the repository/sidecar tree');
const c = loadC124DContext(); const challenge = JSON.parse(readFileSync(resolve(challengePath), 'utf8'));
validateHumanKeyEnrollmentChallenge(challenge, { policy: c.kitPolicy, now: new Date().toISOString() });
if (challenge.authority.id !== c.keyCeremonyPlan.authority.id) throw new Error('C1.24D challenge authority does not match the configured human ceremony plan');
mkdirSync(privateDir, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const message = buildKeyPossessionMessage({ ceremonyId: challenge.ceremonyId, authorityId: challenge.authority.id, keyId: challenge.keyId, publicKeyPem, challengeNonce: challenge.challengeNonce });
const signatureBase64 = cryptoSign(null, Buffer.from(message), privateKeyPem).toString('base64');
const response = buildHumanKeyEnrollmentResponse({ challenge, policy: c.kitPolicy, publicKeyPem, possessionSignatureBase64: signatureBase64, createdAt: new Date().toISOString() });
const privateKeyPath = resolve(privateDir, `${challenge.keyId}.private.pem`);
const publicKeyPath = resolve(privateDir, `${challenge.keyId}.public.pem`);
const responsePath = resolve(privateDir, `${challenge.keyId}.enrollment-response.json`);
writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
try { chmodSync(privateKeyPath, 0o600); } catch {}
writeFileSync(publicKeyPath, publicKeyPem);
writeFileSync(responsePath, JSON.stringify(response, null, 2) + '\n');
console.log(JSON.stringify({ generated: true, authorityId: challenge.authority.id, keyId: challenge.keyId, fingerprintSha256: publicKeyFingerprintSha256(publicKeyPem), privateKeyPath, publicKeyPath, enrollmentResponsePath: responsePath, warning: 'KEEP THE PRIVATE KEY EXTERNAL. Return only the enrollment-response JSON/public key to CineSwarm.', privateKeyIncludedInResponse: false, publicRelease: false, relayDependency: false }, null, 2));
