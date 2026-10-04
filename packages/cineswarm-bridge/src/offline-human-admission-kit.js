import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto';
import { digestJson, validateSigningKeyRegistry } from './authorization-seal.js';
import {
  applyHumanKeyCeremony,
  buildKeyPossessionMessage,
  publicKeyFingerprintSha256,
  validateHumanKeyCeremony,
  validateKeyCeremonyPlan,
  validateKeyCeremonyPolicy,
} from './key-ceremony-journal.js';
import {
  C1_24C_SIGNATURE_ALGORITHM,
  C1_24C_SIGNATURE_DOMAIN,
  buildIndependentRebuildAdmissionCeremonyDraft,
  buildIndependentRebuildAdmissionReview,
  buildIndependentRebuildCanonicalAdmissionPlan,
  classifyIndependentRebuildAdmissionState,
  validateIndependentRebuildAdmissionPolicy,
  validateIndependentRebuildAdmissionRegister,
  validateIndependentRebuildAdmissionReview,
  validateIndependentRebuildCanonicalAdmissionPlan,
} from './independent-rebuild-admission.js';

export const CINESWARM_C1_24D_KIT_POLICY_SCHEMA = 'parallax.cineswarm.offline-human-admission-kit-policy.c1.24d.v0.1';
export const CINESWARM_C1_24D_KIT_MANIFEST_SCHEMA = 'parallax.cineswarm.offline-human-admission-kit-manifest.c1.24d.v0.1';
export const CINESWARM_C1_24D_KEY_CHALLENGE_SCHEMA = 'parallax.cineswarm.offline-human-key-enrollment-challenge.c1.24d.v0.1';
export const CINESWARM_C1_24D_KEY_RESPONSE_SCHEMA = 'parallax.cineswarm.offline-human-key-enrollment-response.c1.24d.v0.1';
export const CINESWARM_C1_24D_SIGNING_REQUEST_SCHEMA = 'parallax.cineswarm.offline-independent-rebuild-admission-signing-request.c1.24d.v0.1';
export const CINESWARM_C1_24D_SIGNED_RESPONSE_SCHEMA = 'parallax.cineswarm.offline-independent-rebuild-admission-signed-response.c1.24d.v0.1';
export const C1_24D_KEY_ALGORITHM = 'Ed25519';
export const C1_24D_REQUEST_TTL_MINUTES = 15;

function req(v, l) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${l} must be a non-empty string`);
  return v.trim();
}
function tok(v, l) {
  const s = req(v, l);
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error(`${l} contains unsupported characters`);
  return s;
}
function sha(v, l) {
  const s = req(v, l);
  if (!/^[a-f0-9]{64}$/.test(s)) throw new Error(`${l} must be SHA-256`);
  return s;
}
function tm(v, l) {
  const s = req(v, l);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`${l} must be ISO-8601`);
  return { s, t };
}
function yes(v, l) { if (v !== true) throw new Error(`${l} must remain true`); }
function no(v, l) { if (v !== false) throw new Error(`${l} must remain false`); }
function strip(v, fields) { const x = structuredClone(v); for (const f of fields) delete x[f]; return x; }
function exactHash(v, field, label) {
  sha(v?.[field], `${label}.${field}`);
  if (digestJson(strip(v, [field])) !== v[field]) throw new Error(`${label} self-hash mismatch`);
}
function boundary(v, label) {
  no(v.kitCanAuthorizeAdmission, `${label}.kitCanAuthorizeAdmission`);
  no(v.kitCanAuthorizeRelease, `${label}.kitCanAuthorizeRelease`);
  no(v.publicRelease, `${label}.publicRelease`);
  no(v.relayDependency, `${label}.relayDependency`);
}
function hashJsonObject(v) { return digestJson(v); }
function signingMessage(digest) { return `${C1_24C_SIGNATURE_DOMAIN}\n${digest}`; }
function unsignedCeremonyPayload(v) { return strip(v, ['ceremonyDigest', 'signatureBase64', 'ceremonyHash']); }

export function validateOfflineHumanAdmissionKitPolicy(policy, {
  keyCeremonyPolicy,
  keyCeremonyPlan,
  admissionPolicy,
  proofContext,
  c24CanonicalRegister,
  admissionRegister,
  keyRegistry,
} = {}) {
  if (!policy || policy.schema !== CINESWARM_C1_24D_KIT_POLICY_SCHEMA) throw new Error('invalid C1.24D kit policy schema');
  tok(policy.policyId, 'policyId');
  tok(policy.episodeId, 'episodeId');
  tok(policy.sequenceId, 'sequenceId');
  tok(policy.networkId, 'networkId');
  tok(policy.sourceKeyCeremonyPlanId, 'sourceKeyCeremonyPlanId');
  tok(policy.sourceC24CAdmissionPolicyId, 'sourceC24CAdmissionPolicyId');
  if (policy.algorithm !== C1_24D_KEY_ALGORITHM) throw new Error('C1.24D algorithm drift');
  if (Number(policy.signingRequestTtlMinutes) !== C1_24D_REQUEST_TTL_MINUTES) throw new Error('C1.24D signing-request TTL drift');
  for (const k of [
    'privateKeyMustRemainExternal',
    'privateKeyImportProhibited',
    'privateKeyRepositoryStorageProhibited',
    'proofOfPossessionRequired',
    'humanFingerprintAcknowledgementRequired',
    'exactC24CSigningPayloadRequired',
    'signedResponseMustContainNoPrivateKey',
    'canonicalAdmissionRequiresSignedC24CCeremony',
    'canonicalApplyMustRemainSeparate',
  ]) yes(policy[k], k);
  for (const k of ['autoGenerateHumanKey', 'autoEnrollHumanKey', 'autoSignAdmission', 'autoApplyCanonicalAdmission', 'kitCanAuthorizeAdmission', 'kitCanAuthorizeRelease', 'publicRelease', 'relayDependency']) no(policy[k], k);

  if (keyCeremonyPolicy) validateKeyCeremonyPolicy(keyCeremonyPolicy);
  if (keyCeremonyPlan) {
    validateKeyCeremonyPlan(keyCeremonyPlan);
    if (keyCeremonyPlan.planId !== policy.sourceKeyCeremonyPlanId) throw new Error('C1.24D key ceremony plan drift');
  }
  if (admissionPolicy) {
    validateIndependentRebuildAdmissionPolicy(admissionPolicy, { proofContext, c24CanonicalRegister });
    if (admissionPolicy.policyId !== policy.sourceC24CAdmissionPolicyId) throw new Error('C1.24D admission policy drift');
    if (admissionPolicy.episodeId !== policy.episodeId || admissionPolicy.sequenceId !== policy.sequenceId || admissionPolicy.networkId !== policy.networkId) throw new Error('C1.24D admission lineage drift');
  }
  if (admissionRegister && admissionPolicy) validateIndependentRebuildAdmissionRegister(admissionRegister, { policy: admissionPolicy });
  if (keyRegistry) validateSigningKeyRegistry(keyRegistry);
  return { valid: true };
}

export function buildOfflineHumanAdmissionKitManifest({
  policy,
  keyCeremonyPolicy,
  keyCeremonyPlan,
  admissionPolicy,
  proofContext,
  c24CanonicalRegister,
  admissionRegister,
  keyRegistry,
  generatedAt,
  manifestId = 'pn0001-c1-24d-offline-human-admission-kit',
}) {
  validateOfflineHumanAdmissionKitPolicy(policy, { keyCeremonyPolicy, keyCeremonyPlan, admissionPolicy, proofContext, c24CanonicalRegister, admissionRegister, keyRegistry });
  tok(manifestId, 'manifestId'); tm(generatedAt, 'generatedAt');
  const state = classifyIndependentRebuildAdmissionState({ policy: admissionPolicy, proofContext, c24CanonicalRegister, admissionRegister, keyRegistry });
  const out = {
    schema: CINESWARM_C1_24D_KIT_MANIFEST_SCHEMA,
    manifestId,
    policyId: policy.policyId,
    episodeId: policy.episodeId,
    sequenceId: policy.sequenceId,
    networkId: policy.networkId,
    generatedAt,
    authority: structuredClone(keyCeremonyPlan.authority),
    sourceHashes: {
      keyCeremonyPolicyHash: hashJsonObject(keyCeremonyPolicy),
      keyCeremonyPlanHash: hashJsonObject(keyCeremonyPlan),
      admissionPolicyHash: hashJsonObject(admissionPolicy),
      c24CanonicalRegisterHash: c24CanonicalRegister.registerHash,
      admissionRegisterHash: admissionRegister.registerHash,
      keyRegistryHash: hashJsonObject(keyRegistry),
      buildInputArchiveHash: admissionPolicy.requiredProof.buildInputArchiveHash,
      rebuildReceiptHash: admissionPolicy.requiredProof.rebuildReceiptHash,
      proofRegisterHash: admissionPolicy.requiredProof.proofRegisterHash,
      buildLogSha256: admissionPolicy.requiredProof.buildLogSha256,
    },
    technicalProofEarned: state.technicalProofEarned,
    activeHumanSigningKeys: state.activeHumanSigningKeys,
    canonicalAdmissionPending: state.canonicalFullIndependentSourceRebuildProven === false,
    humanActionsRequired: [
      'Generate the Ed25519 private key outside the repository/sidecar and retain it under direct human control.',
      'Return only the public enrollment response and compare the full SHA-256 public-key fingerprint before enrollment.',
      'Perform the C1.24C evidence review and explicitly choose ADMIT_TO_CANONICAL, HOLD, or REJECT.',
      'If admitting, sign the exact short-lived C1.24C signing request offline with the enrolled private key.',
      'Return only the signed response; canonical application remains a separate verifier-controlled step.',
    ],
    privateKeyIncluded: false,
    privateKeyExpectedInRepository: false,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.manifestHash = digestJson(out);
  return out;
}

export function validateOfflineHumanAdmissionKitManifest(v, ctx) {
  const rebuilt = buildOfflineHumanAdmissionKitManifest({
    ...ctx,
    generatedAt: v.generatedAt,
    manifestId: v.manifestId,
  });
  if (v?.schema !== CINESWARM_C1_24D_KIT_MANIFEST_SCHEMA) throw new Error('invalid C1.24D kit manifest schema');
  if (rebuilt.manifestHash !== v.manifestHash) throw new Error('C1.24D kit manifest self-hash mismatch');
  if (v.privateKeyIncluded !== false || v.privateKeyExpectedInRepository !== false) throw new Error('C1.24D kit manifest cannot contain private-key custody');
  boundary(v, 'kitManifest');
  return { valid: true };
}

export function buildHumanKeyEnrollmentChallenge({
  policy,
  authorityId,
  keyId,
  ceremonyId,
  challengeId,
  challengeNonce,
  issuedAt,
  expiresAt,
  canonicalC24RegisterHash,
  admissionPolicyId,
}) {
  validateOfflineHumanAdmissionKitPolicy(policy);
  tok(authorityId, 'authorityId'); tok(keyId, 'keyId'); tok(ceremonyId, 'ceremonyId'); tok(challengeId, 'challengeId'); tok(challengeNonce, 'challengeNonce');
  const issued = tm(issuedAt, 'issuedAt'); const expires = tm(expiresAt, 'expiresAt');
  if (expires.t <= issued.t) throw new Error('C1.24D enrollment challenge must expire after issuance');
  if (expires.t - issued.t > 24 * 60 * 60 * 1000) throw new Error('C1.24D enrollment challenge lifetime cannot exceed 24 hours');
  sha(canonicalC24RegisterHash, 'canonicalC24RegisterHash'); tok(admissionPolicyId, 'admissionPolicyId');
  const out = {
    schema: CINESWARM_C1_24D_KEY_CHALLENGE_SCHEMA,
    challengeId,
    policyId: policy.policyId,
    authority: { kind: 'human', id: authorityId },
    keyId,
    ceremonyId,
    challengeNonce,
    issuedAt,
    expiresAt,
    canonicalC24RegisterHash,
    admissionPolicyId,
    purpose: 'ENROLL_EXTERNAL_HUMAN_ED25519_KEY_FOR_C1_24C',
    privateKeyMustRemainExternal: true,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.challengeHash = digestJson(out);
  return out;
}

export function validateHumanKeyEnrollmentChallenge(v, { policy, now = v?.issuedAt } = {}) {
  validateOfflineHumanAdmissionKitPolicy(policy);
  if (v?.schema !== CINESWARM_C1_24D_KEY_CHALLENGE_SCHEMA) throw new Error('invalid C1.24D enrollment challenge schema');
  const issued = tm(v.issuedAt, 'issuedAt'); const expires = tm(v.expiresAt, 'expiresAt'); const current = tm(now, 'now');
  if (current.t < issued.t) throw new Error('C1.24D enrollment challenge is not valid before issuedAt');
  if (current.t >= expires.t) throw new Error('C1.24D enrollment challenge has expired');
  tok(v.challengeId, 'challengeId'); tok(v.authority?.id, 'authority.id'); tok(v.keyId, 'keyId'); tok(v.ceremonyId, 'ceremonyId'); tok(v.challengeNonce, 'challengeNonce');
  sha(v.canonicalC24RegisterHash, 'canonicalC24RegisterHash'); tok(v.admissionPolicyId, 'admissionPolicyId');
  yes(v.privateKeyMustRemainExternal, 'privateKeyMustRemainExternal');
  exactHash(v, 'challengeHash', 'C1.24D enrollment challenge'); boundary(v, 'enrollmentChallenge');
  return { valid: true };
}

export function buildHumanKeyEnrollmentResponse({ challenge, policy, publicKeyPem, possessionSignatureBase64, createdAt }) {
  validateHumanKeyEnrollmentChallenge(challenge, { policy, now: createdAt });
  const fingerprintSha256 = publicKeyFingerprintSha256(publicKeyPem);
  const message = buildKeyPossessionMessage({
    ceremonyId: challenge.ceremonyId,
    authorityId: challenge.authority.id,
    keyId: challenge.keyId,
    publicKeyPem,
    challengeNonce: challenge.challengeNonce,
  });
  const signature = Buffer.from(req(possessionSignatureBase64, 'possessionSignatureBase64'), 'base64');
  if (!cryptoVerify(null, Buffer.from(message), publicKeyPem, signature)) throw new Error('C1.24D proof-of-possession signature is invalid');
  const out = {
    schema: CINESWARM_C1_24D_KEY_RESPONSE_SCHEMA,
    responseId: `${challenge.challengeId}-response`,
    challengeId: challenge.challengeId,
    challengeHash: challenge.challengeHash,
    authority: structuredClone(challenge.authority),
    keyId: challenge.keyId,
    algorithm: C1_24D_KEY_ALGORITHM,
    publicKeyPem: req(publicKeyPem, 'publicKeyPem'),
    fingerprintSha256,
    possessionProof: {
      challengeNonce: challenge.challengeNonce,
      signatureBase64: possessionSignatureBase64,
      messageSha256: createHash('sha256').update(message).digest('hex'),
    },
    createdAt,
    privateKeyIncluded: false,
    fingerprintHumanAcknowledged: false,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.responseHash = digestJson(out);
  return out;
}

export function validateHumanKeyEnrollmentResponse(v, { challenge, policy, now = v?.createdAt } = {}) {
  validateHumanKeyEnrollmentChallenge(challenge, { policy, now });
  if (v?.schema !== CINESWARM_C1_24D_KEY_RESPONSE_SCHEMA) throw new Error('invalid C1.24D key enrollment response schema');
  if (v.challengeId !== challenge.challengeId || v.challengeHash !== challenge.challengeHash || v.authority?.id !== challenge.authority.id || v.keyId !== challenge.keyId) throw new Error('C1.24D key response challenge lineage drift');
  if (v.algorithm !== C1_24D_KEY_ALGORITHM) throw new Error('C1.24D key response algorithm drift');
  if (v.fingerprintSha256 !== publicKeyFingerprintSha256(v.publicKeyPem)) throw new Error('C1.24D key response fingerprint drift');
  const message = buildKeyPossessionMessage({ ceremonyId: challenge.ceremonyId, authorityId: challenge.authority.id, keyId: challenge.keyId, publicKeyPem: v.publicKeyPem, challengeNonce: challenge.challengeNonce });
  if (v.possessionProof?.challengeNonce !== challenge.challengeNonce) throw new Error('C1.24D key response nonce drift');
  if (v.possessionProof?.messageSha256 !== createHash('sha256').update(message).digest('hex')) throw new Error('C1.24D key response possession message drift');
  if (!cryptoVerify(null, Buffer.from(message), v.publicKeyPem, Buffer.from(req(v.possessionProof?.signatureBase64, 'possessionProof.signatureBase64'), 'base64'))) throw new Error('C1.24D key response proof-of-possession verification failed');
  no(v.privateKeyIncluded, 'privateKeyIncluded'); no(v.fingerprintHumanAcknowledged, 'fingerprintHumanAcknowledged');
  exactHash(v, 'responseHash', 'C1.24D key enrollment response'); boundary(v, 'keyResponse');
  return { valid: true };
}

export function buildC17EnrollCeremonyFromOfflineResponse({
  response,
  challenge,
  policy,
  keyCeremonyPolicy,
  keyRegistry,
  recordedAt,
  exactFingerprintAcknowledgement,
}) {
  validateHumanKeyEnrollmentResponse(response, { challenge, policy, now: recordedAt });
  validateKeyCeremonyPolicy(keyCeremonyPolicy); validateSigningKeyRegistry(keyRegistry);
  sha(exactFingerprintAcknowledgement, 'exactFingerprintAcknowledgement');
  if (exactFingerprintAcknowledgement !== response.fingerprintSha256) throw new Error('C1.24D human fingerprint acknowledgement does not exactly match enrolled public key');
  const ceremony = {
    schema: 'parallax.cineswarm.human-key-ceremony.c1.7.v0.1',
    ceremonyId: challenge.ceremonyId,
    action: 'ENROLL',
    authority: structuredClone(response.authority),
    simulated: false,
    recordedAt,
    previousKeyId: null,
    newKey: {
      keyId: response.keyId,
      algorithm: response.algorithm,
      publicKeyPem: response.publicKeyPem,
      fingerprintSha256: response.fingerprintSha256,
      possessionProof: {
        challengeNonce: response.possessionProof.challengeNonce,
        signatureBase64: response.possessionProof.signatureBase64,
      },
    },
    acknowledgements: {
      privateKeyHeldExternally: true,
      privateKeyNotStoredInRepository: true,
      fingerprintVerifiedByHuman: true,
    },
    publicRelease: false,
    relayDependency: false,
  };
  validateHumanKeyCeremony(ceremony, { keyRegistry, policy: keyCeremonyPolicy, now: recordedAt });
  return ceremony;
}

export function stageHumanKeyEnrollment({ ceremony, keyRegistry, keyCeremonyPolicy, now = ceremony?.recordedAt }) {
  const stagedRegistry = applyHumanKeyCeremony(ceremony, { keyRegistry, policy: keyCeremonyPolicy, now });
  return {
    stagedRegistry,
    keyId: ceremony.newKey.keyId,
    fingerprintSha256: ceremony.newKey.fingerprintSha256,
    privateKeyIncluded: false,
    canonicalRegistryMutated: false,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}

export function buildOfflineAdmissionSigningRequest({
  policy,
  admissionPolicy,
  proofContext,
  c24CanonicalRegister,
  review,
  plan,
  keyRegistry,
  keyId,
  signedAt,
  expiresAt,
  ceremonyId,
  requestId = 'pn0001-c1-24d-offline-admission-signing-request',
}) {
  validateOfflineHumanAdmissionKitPolicy(policy);
  validateIndependentRebuildAdmissionReview(review, { policy: admissionPolicy, proofContext, c24CanonicalRegister });
  validateIndependentRebuildCanonicalAdmissionPlan(plan, { policy: admissionPolicy, proofContext, c24CanonicalRegister, review });
  validateSigningKeyRegistry(keyRegistry); tok(keyId, 'keyId'); tok(requestId, 'requestId'); tok(ceremonyId, 'ceremonyId');
  const s = tm(signedAt, 'signedAt'); const e = tm(expiresAt, 'expiresAt');
  if (e.t <= s.t) throw new Error('C1.24D signing request must expire after signedAt');
  if (e.t - s.t > Number(policy.signingRequestTtlMinutes) * 60 * 1000) throw new Error('C1.24D signing request exceeds policy TTL');
  if (e.t > tm(plan.archiveRecordedAt, 'plan.archiveRecordedAt').t) throw new Error('C1.24D signing request must expire no later than canonical transition start');
  const key = keyRegistry.keys.find(k => k.keyId === keyId);
  if (!key || key.status !== 'active' || key.authority?.kind !== 'human' || key.authority.id !== review.authority.id) throw new Error('C1.24D signing request requires the exact active human key');
  const draft = buildIndependentRebuildAdmissionCeremonyDraft({ policy: admissionPolicy, proofContext, c24CanonicalRegister, review, plan, keyId, signedAt, ceremonyId });
  const signableCeremony = structuredClone(draft);
  signableCeremony.admissionAuthorized = true;
  signableCeremony.ceremonyDigest = digestJson(unsignedCeremonyPayload(signableCeremony));
  const message = signingMessage(signableCeremony.ceremonyDigest);
  const out = {
    schema: CINESWARM_C1_24D_SIGNING_REQUEST_SCHEMA,
    requestId,
    kitPolicyId: policy.policyId,
    admissionPolicyId: admissionPolicy.policyId,
    authority: structuredClone(review.authority),
    keyId,
    expectedPublicKeyFingerprintSha256: publicKeyFingerprintSha256(key.publicKeyPem),
    createdAt: signedAt,
    expiresAt,
    reviewHash: review.reviewHash,
    planHash: plan.planHash,
    canonicalRegisterBeforeHash: c24CanonicalRegister.registerHash,
    expectedCanonicalRegisterAfterHash: plan.expectedCanonicalRegisterAfterHash,
    buildInputArchiveHash: plan.buildInputArchiveHash,
    rebuildReceiptHash: plan.rebuildReceiptHash,
    signableCeremony,
    signatureDomain: C1_24C_SIGNATURE_DOMAIN,
    signatureAlgorithm: C1_24C_SIGNATURE_ALGORITHM,
    ceremonyDigest: signableCeremony.ceremonyDigest,
    messageUtf8: message,
    messageSha256: createHash('sha256').update(message).digest('hex'),
    privateKeyRequiredOnlyOnExternalSigner: true,
    privateKeyIncluded: false,
    canonicalApplyIncluded: false,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.requestHash = digestJson(out);
  return out;
}

export function validateOfflineAdmissionSigningRequest(v, {
  policy,
  admissionPolicy,
  proofContext,
  c24CanonicalRegister,
  review,
  plan,
  keyRegistry,
  now = v?.createdAt,
} = {}) {
  validateOfflineHumanAdmissionKitPolicy(policy);
  if (v?.schema !== CINESWARM_C1_24D_SIGNING_REQUEST_SCHEMA) throw new Error('invalid C1.24D signing request schema');
  const nowT = tm(now, 'now'); const created = tm(v.createdAt, 'createdAt'); const expires = tm(v.expiresAt, 'expiresAt');
  if (nowT.t < created.t) throw new Error('C1.24D signing request is not valid before creation');
  if (nowT.t >= expires.t) throw new Error('C1.24D signing request has expired');
  const rebuilt = buildOfflineAdmissionSigningRequest({
    policy,
    admissionPolicy,
    proofContext,
    c24CanonicalRegister,
    review,
    plan,
    keyRegistry,
    keyId: v.keyId,
    signedAt: v.createdAt,
    expiresAt: v.expiresAt,
    ceremonyId: v.signableCeremony?.ceremonyId,
    requestId: v.requestId,
  });
  if (rebuilt.requestHash !== v.requestHash) throw new Error('C1.24D signing request self-hash mismatch');
  if (v.messageUtf8 !== signingMessage(v.ceremonyDigest) || v.messageSha256 !== createHash('sha256').update(v.messageUtf8).digest('hex')) throw new Error('C1.24D signing request message drift');
  no(v.privateKeyIncluded, 'privateKeyIncluded'); no(v.canonicalApplyIncluded, 'canonicalApplyIncluded');
  exactHash(v, 'requestHash', 'C1.24D signing request'); boundary(v, 'signingRequest');
  return { valid: true };
}

export function buildOfflineAdmissionSignedResponse({ request, signatureBase64, signedAt = request?.createdAt }) {
  if (!request || request.schema !== CINESWARM_C1_24D_SIGNING_REQUEST_SCHEMA) throw new Error('C1.24D signed response requires a signing request');
  tm(signedAt, 'signedAt'); req(signatureBase64, 'signatureBase64');
  if (signedAt !== request.createdAt) throw new Error('C1.24D signed response signedAt must equal the frozen C1.24C ceremony signedAt');
  const ceremony = structuredClone(request.signableCeremony);
  ceremony.signatureBase64 = signatureBase64;
  ceremony.ceremonyHash = digestJson(strip(ceremony, ['ceremonyHash']));
  const out = {
    schema: CINESWARM_C1_24D_SIGNED_RESPONSE_SCHEMA,
    responseId: `${request.requestId}-signed`,
    requestId: request.requestId,
    requestHash: request.requestHash,
    authority: structuredClone(request.authority),
    keyId: request.keyId,
    publicKeyFingerprintSha256: request.expectedPublicKeyFingerprintSha256,
    signedAt,
    signatureAlgorithm: C1_24C_SIGNATURE_ALGORITHM,
    signatureBase64,
    ceremony,
    privateKeyIncluded: false,
    canonicalApplyIncluded: false,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
  out.responseHash = digestJson(out);
  return out;
}

export function validateOfflineAdmissionSignedResponse(v, {
  request,
  policy,
  admissionPolicy,
  proofContext,
  c24CanonicalRegister,
  review,
  plan,
  keyRegistry,
  now = v?.signedAt,
} = {}) {
  validateOfflineAdmissionSigningRequest(request, { policy, admissionPolicy, proofContext, c24CanonicalRegister, review, plan, keyRegistry, now });
  if (v?.schema !== CINESWARM_C1_24D_SIGNED_RESPONSE_SCHEMA) throw new Error('invalid C1.24D signed response schema');
  if (v.requestId !== request.requestId || v.requestHash !== request.requestHash || v.keyId !== request.keyId || v.authority?.id !== request.authority.id) throw new Error('C1.24D signed response request lineage drift');
  if (v.publicKeyFingerprintSha256 !== request.expectedPublicKeyFingerprintSha256) throw new Error('C1.24D signed response public-key fingerprint drift');
  if (v.signedAt !== request.createdAt || v.ceremony?.signedAt !== request.createdAt) throw new Error('C1.24D signed response timestamp drift');
  const key = keyRegistry.keys.find(k => k.keyId === request.keyId);
  if (!key || key.status !== 'active') throw new Error('C1.24D signed response key is not active');
  if (!cryptoVerify(null, Buffer.from(request.messageUtf8), key.publicKeyPem, Buffer.from(req(v.signatureBase64, 'signatureBase64'), 'base64'))) throw new Error('C1.24D offline admission signature verification failed');
  if (v.ceremony?.signatureBase64 !== v.signatureBase64 || v.ceremony?.ceremonyDigest !== request.ceremonyDigest || v.ceremony?.ceremonyHash !== digestJson(strip(v.ceremony, ['ceremonyHash']))) throw new Error('C1.24D returned ceremony drift');
  no(v.privateKeyIncluded, 'privateKeyIncluded'); no(v.canonicalApplyIncluded, 'canonicalApplyIncluded');
  exactHash(v, 'responseHash', 'C1.24D signed response'); boundary(v, 'signedResponse');
  return { valid: true, ceremony: structuredClone(v.ceremony) };
}

export function classifyOfflineHumanAdmissionKitState({
  policy,
  keyCeremonyPolicy,
  keyCeremonyPlan,
  admissionPolicy,
  proofContext,
  c24CanonicalRegister,
  admissionRegister,
  keyRegistry,
}) {
  validateOfflineHumanAdmissionKitPolicy(policy, { keyCeremonyPolicy, keyCeremonyPlan, admissionPolicy, proofContext, c24CanonicalRegister, admissionRegister, keyRegistry });
  const base = classifyIndependentRebuildAdmissionState({ policy: admissionPolicy, proofContext, c24CanonicalRegister, admissionRegister, keyRegistry });
  const authorityKeys = keyRegistry.keys.filter(k => k.status === 'active' && k.authority?.kind === 'human' && k.authority.id === keyCeremonyPlan.authority.id);
  const blockers = [];
  if (!base.technicalProofEarned) blockers.push('TECHNICAL_INDEPENDENT_REBUILD_PROOF_NOT_EARNED');
  if (!authorityKeys.length) blockers.push('EXTERNAL_HUMAN_KEY_NOT_ENROLLED');
  if (!base.admissionReceipts) blockers.push('HUMAN_C1_24C_ADMISSION_NOT_SIGNED');
  if (!base.canonicalFullIndependentSourceRebuildProven) blockers.push('CANONICAL_C1_24_NOT_ADMITTED');
  return {
    phase: 'C1.24D',
    status: base.technicalProofEarned && !authorityKeys.length ? 'OFFLINE_KIT_READY_FOR_EXTERNAL_KEY_CEREMONY' : base.canonicalFullIndependentSourceRebuildProven ? 'CANONICAL_ADMISSION_COMPLETE' : 'HUMAN_SIGNING_FLOW_IN_PROGRESS',
    technicalProofEarned: base.technicalProofEarned,
    kitReady: base.technicalProofEarned,
    externalHumanKeyEnrolled: authorityKeys.length === 1,
    activeAuthorityKeyIds: authorityKeys.map(k => k.keyId),
    humanAdmissionSigned: base.admissionReceipts > 0,
    canonicalRegisterRevision: c24CanonicalRegister.revision,
    canonicalFullIndependentSourceRebuildProven: base.canonicalFullIndependentSourceRebuildProven,
    blockers,
    privateKeyCustody: 'external-human-controlled',
    privateKeyExpectedInRepository: false,
    kitCanAuthorizeAdmission: false,
    kitCanAuthorizeRelease: false,
    publicRelease: false,
    relayDependency: false,
  };
}
