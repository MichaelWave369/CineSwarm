import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { publicKeyFingerprintSha256 } from '../src/key-ceremony-journal.js';
import {
  appendPreservationDerivative,
  buildFormatAssessment,
  buildFormatEquivalenceReport,
  buildFormatMigrationCeremonyPayload,
  buildFormatMigrationPlan,
  buildFormatMigrationRegister,
  buildFormatMigrationReview,
  buildPreservationDerivativeRecord,
  classifyFormatPreservationState,
  signFormatMigrationCeremony,
  validateFormatAssessment,
  validateFormatEquivalenceReport,
  validateFormatMigrationPlan,
  validateFormatMigrationRegister,
  validateFormatPreservationPolicy,
  validatePreservationDerivativeRecord,
  verifyFormatMigrationCeremony,
} from '../src/format-obsolescence-migration.js';
const base=resolve(import.meta.dirname,'../../../fixtures/cineswarm');
const read=n=>JSON.parse(readFileSync(resolve(base,n),'utf8'));
const policy=read('pn-0001-c1-21-format-preservation-policy.json');
const sourceC20='0c7c00d090f5d796f537879688cbda077cb2a48fa8b4b718c04bf4c2d2f963f2';

function fixture(){
  const source={assetId:'proof-original-master',sha256:'1'.repeat(64),container:'avi',videoCodec:'mpeg4',audioCodec:'pcm_s16le'};
  const assessment=buildFormatAssessment({policy,source,disposition:'MIGRATION_RECOMMENDED',evidenceRefs:['operator:synthetic-proof-profile'],assessedAt:'2026-08-13T21:21:00.000Z',reviewDueAt:'2027-02-09T21:21:00.000Z'});
  const plan=buildFormatMigrationPlan({policy,assessment,source,plannedAt:'2026-08-13T21:22:00.000Z'});
  const obs={sha256:source.sha256,container:'avi',videoCodec:'mpeg4',audioCodec:'pcm_s16le',durationSeconds:2,width:320,height:180,frameRate:'24/1',sampleRate:48000,channels:2,decodedVideoSha256:'2'.repeat(64),decodedAudioSha256:'3'.repeat(64)};
  const der={...obs,sha256:'4'.repeat(64),container:'matroska',videoCodec:'ffv1',audioCodec:'pcm_s24le'};
  const equivalenceReport=buildFormatEquivalenceReport({policy,plan,assessment,sourceObservation:obs,derivativeObservation:der,observedAt:'2026-08-13T21:23:00.000Z'});
  const review=buildFormatMigrationReview({policy,plan,assessment,equivalenceReport,authorityId:'michael-hughes',decision:'APPROVE_DERIVATIVE',reason:'Decoded audiovisual identity and timeline parity pass.',recordedAt:'2026-08-13T21:24:00.000Z'});
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'); const publicKeyPem=publicKey.export({type:'spki',format:'pem'}); const privateKeyPem=privateKey.export({type:'pkcs8',format:'pem'});
  const keyRegistry={schema:'parallax.cineswarm.signing-key-registry.c1.6.v0.1',keys:[{keyId:'c1-21-proof-key',algorithm:'Ed25519',status:'active',authority:{kind:'human',id:'michael-hughes'},publicKeyPem,fingerprintSha256:publicKeyFingerprintSha256(publicKeyPem),validFrom:'2026-08-13T20:00:00.000Z',validUntil:null}]};
  const payload=buildFormatMigrationCeremonyPayload({policy,plan,assessment,equivalenceReport,review,authorityId:'michael-hughes',keyId:'c1-21-proof-key',recordedAt:'2026-08-13T21:25:00.000Z',expiresAt:'2026-08-14T21:25:00.000Z'});
  const ceremony=signFormatMigrationCeremony({ceremony:payload,privateKeyPem});
  const ctx={policy,plan,assessment,equivalenceReport,review,ceremony,keyRegistry};
  const derivative=buildPreservationDerivativeRecord({...ctx,recordedAt:'2026-08-13T21:26:00.000Z'});
  return {source,assessment,plan,obs,der,equivalenceReport,review,keyRegistry,ceremony,ctx,derivative};
}

test('C1.21 policy preserves original bytes and cannot auto-declare obsolescence or release',()=>{ assert.equal(validateFormatPreservationPolicy(policy).valid,true); assert.equal(policy.autoDeclareObsolete,false); assert.equal(policy.originalDeleteAuthorized,false); assert.equal(policy.derivativeCanReplaceOriginal,false); assert.equal(policy.publicRelease,false); });
test('format assessment requires operator evidence and a deliberate migration disposition',()=>{ const f=fixture(); assert.equal(validateFormatAssessment(f.assessment,{policy}).valid,true); assert.throws(()=>buildFormatAssessment({policy,source:f.source,disposition:'MIGRATION_RECOMMENDED',evidenceRefs:[],assessedAt:'2026-08-13T21:21:00Z',reviewDueAt:'2027-01-01T00:00:00Z'}),/evidence/); });
test('migration plan can only follow MIGRATION_RECOMMENDED and freezes the internal target profile',()=>{ const f=fixture(); assert.equal(validateFormatMigrationPlan(f.plan,{policy,assessment:f.assessment}).valid,true); const supported=buildFormatAssessment({policy,source:f.source,disposition:'SUPPORTED',evidenceRefs:['operator:ok'],assessedAt:'2026-08-13T21:21:00Z',reviewDueAt:'2027-01-01T00:00:00Z'}); assert.throws(()=>buildFormatMigrationPlan({policy,assessment:supported,source:f.source,plannedAt:'2026-08-13T21:22:00Z'}),/MIGRATION_RECOMMENDED/); });
test('equivalence report requires exact decoded video/audio identity plus timeline parity',()=>{ const f=fixture(); assert.equal(validateFormatEquivalenceReport(f.equivalenceReport,{policy,plan:f.plan,assessment:f.assessment}).status,'PASS'); const bad={...f.der,decodedVideoSha256:'9'.repeat(64)}; const r=buildFormatEquivalenceReport({policy,plan:f.plan,assessment:f.assessment,sourceObservation:f.obs,derivativeObservation:bad,observedAt:'2026-08-13T21:23:00Z'}); assert.equal(r.status,'FAIL'); });
test('equivalence gate rejects decoded-identical output in the wrong target format',()=>{ const f=fixture(); const wrong={...f.der,videoCodec:'h264'}; assert.throws(()=>buildFormatEquivalenceReport({policy,plan:f.plan,assessment:f.assessment,sourceObservation:f.obs,derivativeObservation:wrong,observedAt:'2026-08-13T21:23:00Z'}),/approved target profile/); });
test('human review cannot approve a failed equivalence report',()=>{ const f=fixture(); const bad={...f.der,channels:1}; const r=buildFormatEquivalenceReport({policy,plan:f.plan,assessment:f.assessment,sourceObservation:f.obs,derivativeObservation:bad,observedAt:'2026-08-13T21:23:00Z'}); assert.throws(()=>buildFormatMigrationReview({policy,plan:f.plan,assessment:f.assessment,equivalenceReport:r,authorityId:'michael-hughes',decision:'APPROVE_DERIVATIVE',reason:'bad',recordedAt:'2026-08-13T21:24:00Z'}),/failed equivalence/); });
test('signed migration ceremony is exact-lineage bound and revoked keys fail',()=>{ const f=fixture(); assert.equal(verifyFormatMigrationCeremony(f.ctx).valid,true); const bad=structuredClone(f.keyRegistry); bad.keys[0].status='revoked'; assert.throws(()=>verifyFormatMigrationCeremony({...f.ctx,keyRegistry:bad}),/revoked/); const tampered=structuredClone(f.ceremony); tampered.originalSha256='f'.repeat(64); assert.throws(()=>verifyFormatMigrationCeremony({...f.ctx,ceremony:tampered}),/drift|signature/); });
test('preservation derivative keeps original mandatory and cannot replace original or authorize release',()=>{ const f=fixture(); assert.equal(validatePreservationDerivativeRecord(f.derivative,f.ctx).valid,true); assert.equal(f.derivative.originalStillRequired,true); assert.equal(f.derivative.originalDeleted,false); assert.equal(f.derivative.derivativeCanReplaceOriginal,false); assert.equal(f.derivative.publicRelease,false); });
test('format migration register is append-only and rejects duplicate derivative records',()=>{ const f=fixture(); const registerContext={policy,sourceC20PreservationRegisterHash:sourceC20}; let r=buildFormatMigrationRegister({...registerContext,entries:[],revision:0,recordedAt:'2026-08-13T21:27:00Z'}); r=appendPreservationDerivative({register:r,derivativeRecord:f.derivative,derivativeContext:f.ctx,registerContext,recordedAt:'2026-08-13T21:28:00Z'}); assert.equal(validateFormatMigrationRegister(r,registerContext).valid,true); assert.equal(r.revision,1); assert.throws(()=>appendPreservationDerivative({register:r,derivativeRecord:f.derivative,derivativeContext:f.ctx,registerContext,recordedAt:'2026-08-13T21:29:00Z'}),/already registered/); });
test('post-signing derivative hash tampering fails validation',()=>{ const f=fixture(); const bad=structuredClone(f.derivative); bad.derivativeSha256='a'.repeat(64); assert.throws(()=>validatePreservationDerivativeRecord(bad,f.ctx),/drift|self-hash/); });
test('canonical C1.21 register remains revision 0 because PN-0001 has no real archived Master to migrate',()=>{ const r=read('pn-0001-c1-21-format-migration-register.json'); const ctx={policy,sourceC20PreservationRegisterHash:sourceC20}; assert.equal(validateFormatMigrationRegister(r,ctx).valid,true); const s=classifyFormatPreservationState({...ctx,register:r,now:'2026-08-13T21:30:00Z'}); assert.equal(s.registerRevision,0); assert.equal(s.preservationDerivatives,0); assert.equal(s.publicRelease,false); assert.equal(s.relayDependency,false); });
