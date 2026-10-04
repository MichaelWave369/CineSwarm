import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestJson } from '../src/authorization-seal.js';
import { buildKeyPossessionMessage, publicKeyFingerprintSha256 } from '../src/key-ceremony-journal.js';
import {
  applyIndependentRebuildCanonicalAdmission,
  buildIndependentRebuildAdmissionReceipt,
  validateIndependentRebuildAdmissionCeremony,
} from '../src/independent-rebuild-admission.js';
import {
  buildC17EnrollCeremonyFromOfflineResponse,
  buildHumanKeyEnrollmentChallenge,
  buildHumanKeyEnrollmentResponse,
  buildOfflineAdmissionSignedResponse,
  buildOfflineAdmissionSigningRequest,
  buildOfflineHumanAdmissionKitManifest,
  classifyOfflineHumanAdmissionKitState,
  stageHumanKeyEnrollment,
  validateHumanKeyEnrollmentChallenge,
  validateHumanKeyEnrollmentResponse,
  validateOfflineAdmissionSignedResponse,
  validateOfflineAdmissionSigningRequest,
  validateOfflineHumanAdmissionKitManifest,
  validateOfflineHumanAdmissionKitPolicy,
} from '../src/offline-human-admission-kit.js';
import {
  buildIndependentRebuildAdmissionReview,
  buildIndependentRebuildCanonicalAdmissionPlan,
} from '../src/independent-rebuild-admission.js';

const root = resolve(import.meta.dirname, '../../..');
const j = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const c24Policy = j('fixtures/cineswarm/pn-0001-c1-24-independent-build-policy.json');
const admissionPolicy = j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-policy.json');
const kitPolicy = j('fixtures/cineswarm/pn-0001-c1-24d-offline-human-admission-kit-policy.json');
const keyCeremonyPolicy = j('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-policy.json');
const keyCeremonyPlan = j('fixtures/cineswarm/pn-0001-c1-7-key-ceremony-plan.json');
const canonical = j('fixtures/cineswarm/pn-0001-c1-24-independent-rebuild-register.json');
const admissionRegister = j('fixtures/cineswarm/pn-0001-c1-24c-independent-rebuild-admission-register.json');
const canonicalKeyRegistry = j('fixtures/cineswarm/pn-0001-c1-6-signing-key-registry.json');
const proofDir = 'proof/c1-24/real-independent-rebuild';
const proofContext = {
  c24Policy,
  buildInputArchive: j(`${proofDir}/BUILD_INPUT_ARCHIVE.json`),
  recipe: j(`${proofDir}/HERMETIC_BUILD_RECIPE.json`),
  report: j(`${proofDir}/INDEPENDENT_REBUILD_REPORT.json`),
  rebuildReceipt: j(`${proofDir}/INDEPENDENT_REBUILD_RECEIPT.json`),
  proofRegister: j(`${proofDir}/PROOF_REGISTER.json`),
  buildLogSha256: createHash('sha256').update(readFileSync(resolve(root, `${proofDir}/BUILD.log`))).digest('hex'),
};

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
function challenge(authorityId = 'proof-human', keyId = 'proof-human-key') {
  return buildHumanKeyEnrollmentChallenge({
    policy: kitPolicy,
    authorityId,
    keyId,
    ceremonyId: `c1-24d-enroll-${authorityId}`,
    challengeId: `c1-24d-challenge-${authorityId}`,
    challengeNonce: '00112233445566778899aabbccddeeff',
    issuedAt: '2026-08-13T23:40:00Z',
    expiresAt: '2026-08-14T23:40:00Z',
    canonicalC24RegisterHash: canonical.registerHash,
    admissionPolicyId: admissionPolicy.policyId,
  });
}
function enrollment() {
  const kp = keyPair();
  const ch = challenge();
  const message = buildKeyPossessionMessage({ ceremonyId: ch.ceremonyId, authorityId: ch.authority.id, keyId: ch.keyId, publicKeyPem: kp.publicKeyPem, challengeNonce: ch.challengeNonce });
  const sig = cryptoSign(null, Buffer.from(message), kp.privateKeyPem).toString('base64');
  const response = buildHumanKeyEnrollmentResponse({ challenge: ch, policy: kitPolicy, publicKeyPem: kp.publicKeyPem, possessionSignatureBase64: sig, createdAt: '2026-08-13T23:41:00Z' });
  const ceremony = buildC17EnrollCeremonyFromOfflineResponse({ response, challenge: ch, policy: kitPolicy, keyCeremonyPolicy, keyRegistry: canonicalKeyRegistry, recordedAt: '2026-08-13T23:42:00Z', exactFingerprintAcknowledgement: response.fingerprintSha256 });
  const staged = stageHumanKeyEnrollment({ ceremony, keyRegistry: canonicalKeyRegistry, keyCeremonyPolicy, now: '2026-08-13T23:42:00Z' });
  return { ...kp, ch, response, ceremony, keyRegistry: staged.stagedRegistry };
}
function admissionChain() {
  const e = enrollment();
  const review = buildIndependentRebuildAdmissionReview({
    policy: admissionPolicy,
    proofContext,
    c24CanonicalRegister: canonical,
    reviewId: 'proof-c1-24d-human-review',
    authority: { kind: 'human', id: 'proof-human', simulated: false },
    decision: 'ADMIT_TO_CANONICAL',
    reason: 'Synthetic proof-only human accepts the exact C1.24B evidence and limitations.',
    reviewedAt: '2026-08-13T23:43:00Z',
    checks: {
      sourceAuthenticityAccepted: true,
      buildInputClosureAccepted: true,
      sourceBuildAccepted: true,
      authoritativeDecodeAccepted: true,
      fullOsIsolationLimitationAcknowledged: true,
      releaseBoundaryAcknowledged: true,
    },
  });
  const plan = buildIndependentRebuildCanonicalAdmissionPlan({
    policy: admissionPolicy,
    proofContext,
    c24CanonicalRegister: canonical,
    review,
    archiveRecordedAt: '2026-08-13T23:55:00Z',
    receiptRecordedAt: '2026-08-13T23:56:00Z',
    planId: 'proof-c1-24d-admission-plan',
  });
  const request = buildOfflineAdmissionSigningRequest({
    policy: kitPolicy,
    admissionPolicy,
    proofContext,
    c24CanonicalRegister: canonical,
    review,
    plan,
    keyRegistry: e.keyRegistry,
    keyId: 'proof-human-key',
    signedAt: '2026-08-13T23:44:00Z',
    expiresAt: '2026-08-13T23:54:00Z',
    ceremonyId: 'proof-c1-24d-admission-ceremony',
    requestId: 'proof-c1-24d-signing-request',
  });
  const sig = cryptoSign(null, Buffer.from(request.messageUtf8), e.privateKeyPem).toString('base64');
  const signedResponse = buildOfflineAdmissionSignedResponse({ request, signatureBase64: sig });
  return { ...e, review, plan, request, signedResponse };
}

test('C1.24D policy composes C1.7 custody with exact C1.24C admission proof', () => {
  assert.equal(validateOfflineHumanAdmissionKitPolicy(kitPolicy, { keyCeremonyPolicy, keyCeremonyPlan, admissionPolicy, proofContext, c24CanonicalRegister: canonical, admissionRegister, keyRegistry: canonicalKeyRegistry }).valid, true);
  assert.equal(kitPolicy.autoGenerateHumanKey, false);
  assert.equal(kitPolicy.autoSignAdmission, false);
  assert.equal(kitPolicy.privateKeyImportProhibited, true);
});

test('canonical C1.24D kit manifest contains no private key and preserves pending-human truth', () => {
  const manifest = buildOfflineHumanAdmissionKitManifest({ policy: kitPolicy, keyCeremonyPolicy, keyCeremonyPlan, admissionPolicy, proofContext, c24CanonicalRegister: canonical, admissionRegister, keyRegistry: canonicalKeyRegistry, generatedAt: '2026-08-13T23:43:00Z' });
  assert.equal(validateOfflineHumanAdmissionKitManifest(manifest, { policy: kitPolicy, keyCeremonyPolicy, keyCeremonyPlan, admissionPolicy, proofContext, c24CanonicalRegister: canonical, admissionRegister, keyRegistry: canonicalKeyRegistry }).valid, true);
  assert.equal(manifest.technicalProofEarned, true);
  assert.equal(manifest.activeHumanSigningKeys, 0);
  assert.equal(manifest.privateKeyIncluded, false);
});

test('enrollment challenge is short-lived, exact-state-bound, and cannot authorize admission', () => {
  const ch = challenge();
  assert.equal(validateHumanKeyEnrollmentChallenge(ch, { policy: kitPolicy, now: '2026-08-13T23:41:00Z' }).valid, true);
  assert.throws(() => validateHumanKeyEnrollmentChallenge(ch, { policy: kitPolicy, now: '2026-08-14T23:40:00Z' }), /expired/);
  assert.equal(ch.kitCanAuthorizeAdmission, false);
});

test('offline enrollment response proves possession but contains only public-key material', () => {
  const e = enrollment();
  assert.equal(validateHumanKeyEnrollmentResponse(e.response, { challenge: e.ch, policy: kitPolicy, now: '2026-08-13T23:41:00Z' }).valid, true);
  assert.equal(e.response.fingerprintSha256, publicKeyFingerprintSha256(e.publicKeyPem));
  assert.equal(JSON.stringify(e.response).includes('BEGIN PRIVATE KEY'), false);
});

test('wrong human fingerprint acknowledgement blocks key enrollment', () => {
  const kp = keyPair(); const ch = challenge();
  const msg = buildKeyPossessionMessage({ ceremonyId: ch.ceremonyId, authorityId: ch.authority.id, keyId: ch.keyId, publicKeyPem: kp.publicKeyPem, challengeNonce: ch.challengeNonce });
  const response = buildHumanKeyEnrollmentResponse({ challenge: ch, policy: kitPolicy, publicKeyPem: kp.publicKeyPem, possessionSignatureBase64: cryptoSign(null, Buffer.from(msg), kp.privateKeyPem).toString('base64'), createdAt: '2026-08-13T23:41:00Z' });
  assert.throws(() => buildC17EnrollCeremonyFromOfflineResponse({ response, challenge: ch, policy: kitPolicy, keyCeremonyPolicy, keyRegistry: canonicalKeyRegistry, recordedAt: '2026-08-13T23:42:00Z', exactFingerprintAcknowledgement: '0'.repeat(64) }), /fingerprint acknowledgement/);
});

test('staged key enrollment provisions only a cloned registry, not canonical fixture', () => {
  const e = enrollment();
  assert.equal(e.keyRegistry.keys.length, 1);
  assert.equal(e.keyRegistry.keys[0].status, 'active');
  assert.equal(canonicalKeyRegistry.keys.length, 0);
});

test('offline signing request binds exact review, plan, canonical hashes, key fingerprint and 15-minute maximum TTL', () => {
  const c = admissionChain();
  assert.equal(validateOfflineAdmissionSigningRequest(c.request, { policy: kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan, keyRegistry: c.keyRegistry, now: '2026-08-13T23:44:30Z' }).valid, true);
  assert.equal(c.request.expectedPublicKeyFingerprintSha256, publicKeyFingerprintSha256(c.publicKeyPem));
  assert.equal(c.request.privateKeyIncluded, false);
  assert.equal(c.request.canonicalApplyIncluded, false);
});

test('expired offline signing request is rejected before signature acceptance', () => {
  const c = admissionChain();
  assert.throws(() => validateOfflineAdmissionSigningRequest(c.request, { policy: kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan, keyRegistry: c.keyRegistry, now: '2026-08-13T23:54:00Z' }), /expired/);
});

test('offline signed response reconstructs an exact valid C1.24C ceremony', () => {
  const c = admissionChain();
  const validated = validateOfflineAdmissionSignedResponse(c.signedResponse, { request: c.request, policy: kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan, keyRegistry: c.keyRegistry, now: '2026-08-13T23:44:30Z' });
  assert.equal(validated.valid, true);
  assert.equal(validateIndependentRebuildAdmissionCeremony(validated.ceremony, { keyRegistry: c.keyRegistry, policy: admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan }).valid, true);
});

test('returned signature from the wrong private key is rejected', () => {
  const c = admissionChain(); const other = keyPair();
  const sig = cryptoSign(null, Buffer.from(c.request.messageUtf8), other.privateKeyPem).toString('base64');
  const response = buildOfflineAdmissionSignedResponse({ request: c.request, signatureBase64: sig });
  assert.throws(() => validateOfflineAdmissionSignedResponse(response, { request: c.request, policy: kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan, keyRegistry: c.keyRegistry, now: '2026-08-13T23:44:30Z' }), /signature verification failed/);
});

test('request tampering is rejected even when old requestHash is retained', () => {
  const c = admissionChain(); const bad = structuredClone(c.request); bad.messageUtf8 += '\nTAMPERED';
  assert.throws(() => validateOfflineAdmissionSigningRequest(bad, { policy: kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan, keyRegistry: c.keyRegistry, now: '2026-08-13T23:44:30Z' }), /self-hash mismatch|message drift/);
});

test('synthetic offline signature can drive cloned C1.24 admission but not mutate canonical fixture', () => {
  const c = admissionChain();
  const { ceremony } = validateOfflineAdmissionSignedResponse(c.signedResponse, { request: c.request, policy: kitPolicy, admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan, keyRegistry: c.keyRegistry, now: '2026-08-13T23:44:30Z' });
  const admitted = applyIndependentRebuildCanonicalAdmission({ ceremony, keyRegistry: c.keyRegistry, policy: admissionPolicy, proofContext, c24CanonicalRegister: canonical, review: c.review, plan: c.plan });
  const receipt = buildIndependentRebuildAdmissionReceipt({ policy: admissionPolicy, ceremony, keyRegistry: c.keyRegistry, proofContext, c24CanonicalRegisterBefore: canonical, review: c.review, plan: c.plan, c24CanonicalRegisterAfter: admitted, issuedAt: '2026-08-13T23:56:30Z', receiptId: 'proof-c1-24d-admission-receipt' });
  assert.equal(admitted.fullIndependentSourceRebuildProven, true);
  assert.equal(receipt.canonicalFullIndependentSourceRebuildProven, true);
  assert.equal(canonical.revision, 0);
  assert.equal(canonical.fullIndependentSourceRebuildProven, false);
});

test('real C1.24D state is kit-ready but still blocked on external human key and signed admission', () => {
  const state = classifyOfflineHumanAdmissionKitState({ policy: kitPolicy, keyCeremonyPolicy, keyCeremonyPlan, admissionPolicy, proofContext, c24CanonicalRegister: canonical, admissionRegister, keyRegistry: canonicalKeyRegistry });
  assert.equal(state.status, 'OFFLINE_KIT_READY_FOR_EXTERNAL_KEY_CEREMONY');
  assert.equal(state.technicalProofEarned, true);
  assert.equal(state.externalHumanKeyEnrolled, false);
  assert.equal(state.humanAdmissionSigned, false);
  assert.equal(state.canonicalFullIndependentSourceRebuildProven, false);
  assert.deepEqual(state.blockers, ['EXTERNAL_HUMAN_KEY_NOT_ENROLLED', 'HUMAN_C1_24C_ADMISSION_NOT_SIGNED', 'CANONICAL_C1_24_NOT_ADMITTED']);
});

import { spawnSync } from 'node:child_process';

test('packaged C1.24D proof contains no persisted private-key PEM material', () => {
  const dir = resolve(root, 'proof/c1-24d/synthetic-offline-human-admission');
  const names = ['KIT_MANIFEST.json','ENROLLMENT_CHALLENGE.json','ENROLLMENT_RESPONSE.json','C1_7_KEY_ENROLLMENT_CEREMONY.json','STAGED_SIGNING_KEY_REGISTRY.json','HUMAN_ADMISSION_REVIEW.json','CANONICAL_ADMISSION_PLAN.json','OFFLINE_SIGNING_REQUEST.json','SIGNED_ADMISSION_RESPONSE.json','VERIFIED_C1_24C_CEREMONY.json','PROPOSED_C24_CANONICAL_REGISTER.json','PROPOSED_C1_24C_ADMISSION_RECEIPT.json','PROPOSED_C1_24C_ADMISSION_REGISTER.json','C1_24D_OPERATIONAL_PROOF.json'];
  const text = names.map(n => readFileSync(resolve(dir, n), 'utf8')).join('\n');
  assert.equal(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), false);
});

test('external key generator refuses private-key output inside the repository tree', () => {
  const script = resolve(root, 'scripts/cineswarm-c1-24d-generate-external-key-response.mjs');
  const challengePath = resolve(root, 'proof/c1-24d/synthetic-offline-human-admission/ENROLLMENT_CHALLENGE.json');
  const badDir = resolve(root, 'proof/c1-24d/SHOULD_NEVER_CONTAIN_PRIVATE_KEY');
  const r = spawnSync(process.execPath, [script, '--challenge', challengePath, '--private-dir', badDir], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stderr}\n${r.stdout}`, /refuses to create a human private key inside the repository\/sidecar tree/);
});

test('standalone C1.24D proof verifier succeeds without private-key material', () => {
  const script = resolve(root, 'scripts/cineswarm-verify-c1-24d-offline-kit-proof.mjs');
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.valid, true);
  assert.equal(out.privateKeyPersisted, false);
  assert.equal(out.realHumanKeyCount, 0);
  assert.equal(out.realCanonicalRevision, 0);
});
