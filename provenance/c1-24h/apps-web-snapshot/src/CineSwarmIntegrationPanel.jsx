import { useMemo, useState } from 'react';
import { cineswarmBaseline, cineswarmCandidateAssetRegistry, cineswarmExecutionJournal, cineswarmExecutionJournalStatus, cineswarmKeyCeremonyPlan, cineswarmKeyCeremonyStatus, cineswarmPictureLockRegister, cineswarmPictureLockStatus, cineswarmLockedRenderStatus, cineswarmRenderCandidateRegister, cineswarmAudioLockRegister, cineswarmMasterCandidateRegister, cineswarmMasterStatus, cineswarmCanonRegister, cineswarmLedgerPacketRegister, cineswarmCanonLedgerStatus, cineswarmLedgerAdmissionRegister, cineswarmReleaseCandidateRegister, cineswarmLedgerReleaseStatus, cineswarmNetworkReleaseStatus, cineswarmPublicReleaseRegister, cineswarmReleaseLifecycleStatus, cineswarmReleaseLifecycleRegister, cineswarmPublicArchiveStatus, cineswarmPublicArchiveRegister, cineswarmArchiveRecoveryStatus, cineswarmArchiveRecoveryRegister, cineswarmReplicaMaintenanceStatus, cineswarmReplicaMaintenanceRegister, cineswarmStorageAdapterRegistry, cineswarmPreservationStatus, cineswarmPreservationRegister, cineswarmFormatPreservationStatus, cineswarmFormatMigrationRegister, cineswarmDecodeAccessStatus, cineswarmDecodeAccessRegister, cineswarmReproDecodeStatus, cineswarmReproDecodeRegister, cineswarmIndependentRebuildStatus, cineswarmIndependentRebuildRegister, cineswarmIndependentRebuildProof, cineswarmIndependentRebuildAdmissionRegister, cineswarmIndependentRebuildAdmissionStatus, cineswarmOfflineHumanAdmissionKitManifest, cineswarmOfflineHumanAdmissionKitStatus, cineswarmHumanCeremonyConsoleStatus, cineswarmCanonicalAdmissionCommitStatus, cineswarmCanonicalAdmissionCommitRegister, cineswarmChallengeHealthHandoffStatus, cineswarmBuildInputStatus, cineswarmPicturePlanRegister, cineswarmPicturePlanningStatus, cineswarmProviderClassification, cineswarmProviderReadiness, cineswarmQuarantineRegister, cineswarmRequestAuthorizationDrafts, cineswarmRequestAuthorizationSummary, cineswarmSealStatus, cineswarmSigningKeyRegistry, cineswarmSigningPolicy, pn0001CineSwarmJobs } from './cineswarmProductionData.ts';
import './cineswarm.css';

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function CineSwarmIntegrationPanel() {
  const [selectedId, setSelectedId] = useState(pn0001CineSwarmJobs[0]?.network.sequenceId);
  const selected = useMemo(() => pn0001CineSwarmJobs.find((job) => job.network.sequenceId === selectedId) ?? pn0001CineSwarmJobs[0], [selectedId]);
  const currentState = cineswarmChallengeHealthHandoffStatus.status;

  return (
    <section className="csb-shell" aria-labelledby="csb-title">
      <div className="csb-heading">
        <div>
          <p className="csb-kicker">Studio production bridge · C1.24H Ceremony Health + Compact Handoff</p>
          <h2 id="csb-title">CineSwarm → Pilot 001</h2>
          <p>C1.24B earned the real independent source-rebuild proof; C1.24D–G built the external human-key, admission, commit, and resumable ceremony path. C1.24H now audits the live challenge/session/canonical baseline and packages the public human step into a compact handoff. Health is currently PASS; the real human enrollment response has not been supplied, so canonical C1.24 remains revision 0.</p>
        </div>
        <div className="csb-baseline-badge"><strong>{currentState}</strong><span>C1.24H · healthy human handoff</span></div>
      </div>

      <div className="csb-alert">
        <strong>Current state remains clean:</strong> no real provider attempt exists, the C1.8 quarantine register is empty, the C1.9 accepted-candidate registry is revision 0 with zero entries, the C1.10 Picture Lock register is revision 0 with no lock events, the C1.11 Render Candidate register is revision 0 with zero renders, both C1.12 Audio Lock and Master Candidate registers are revision 0, the C1.13 Canon + Ledger packet registers are revision 0, and both C1.14 admission/release-candidate registers are revision 0, the C1.15 Public Release Register is revision 0 with no public releases, and the C1.16 Release Lifecycle Register is revision 0 with no withdrawal or supersession events, and the C1.17 Public Archive Register is revision 0 with no archived releases or integrity reports, the C1.19 maintenance register is revision 0, and the C1.20 Preservation Register is revision 0 with no audits, refreshes, or retirements, the C1.21 Format Migration Register is revision 0 with no preservation derivatives, and the C1.22 Decode/Access Register is revision 0 with no environment snapshots, compatibility matrices, or access derivatives, the C1.23 Repro Decode Register is revision 0, and the C1.24 Independent Rebuild Register is revision 0 with no canonical build-input archive or independent rebuild receipt, the C1.24C Admission Register is revision 0, and the C1.24F Commit Register is revision 0. Earlier provider authorization gates also remain blocked.
      </div>

      <div className="csb-stats">
        <div><span>Episode</span><strong>PN-0001</strong></div>
        <div><span>C1.8 quarantine</span><strong>{cineswarmQuarantineRegister.quarantinedAssetCount}</strong><small>real quarantined assets</small></div>
        <div><span>C1.9 candidates</span><strong>{cineswarmPicturePlanningStatus.acceptedCandidateCount}</strong><small>registry revision {cineswarmPicturePlanningStatus.registryRevision}</small></div>
        <div><span>Picture Lock</span><strong>{cineswarmPictureLockStatus.pictureLocked ? 'LOCKED' : 'NONE'}</strong><small>register revision {cineswarmPictureLockStatus.revision}</small></div>
        <div><span>Render candidates</span><strong>{cineswarmLockedRenderStatus.renderCandidateCount}</strong><small>C1.11 register revision {cineswarmRenderCandidateRegister.revision}</small></div>
        <div><span>Audio Lock</span><strong>{cineswarmAudioLockRegister.audioLocked ? 'LOCKED' : 'NONE'}</strong><small>C1.12 register revision {cineswarmAudioLockRegister.revision}</small></div>
        <div><span>Master candidates</span><strong>{cineswarmMasterCandidateRegister.masterCandidateCount}</strong><small>C1.12 register revision {cineswarmMasterCandidateRegister.revision}</small></div>
        <div><span>Canon records</span><strong>{cineswarmCanonRegister.canonRecordCount}</strong><small>C1.13 register revision {cineswarmCanonRegister.revision}</small></div>
        <div><span>Ledger packets</span><strong>{cineswarmLedgerPacketRegister.packetCount}</strong><small>C1.13 register revision {cineswarmLedgerPacketRegister.revision}</small></div>
        <div><span>Ledger admissions</span><strong>{cineswarmLedgerAdmissionRegister.ledgerAdmittedCount}</strong><small>C1.14 register revision {cineswarmLedgerAdmissionRegister.revision}</small></div>
        <div><span>Release candidates</span><strong>{cineswarmReleaseCandidateRegister.releaseCandidateCount}</strong><small>C1.14 register revision {cineswarmReleaseCandidateRegister.revision}</small></div>
        <div><span>Public releases</span><strong>{cineswarmPublicReleaseRegister.publicReleaseCount}</strong><small>C1.15 register revision {cineswarmPublicReleaseRegister.revision}</small></div>
        <div><span>Lifecycle events</span><strong>{cineswarmReleaseLifecycleRegister.entryCount}</strong><small>C1.16 register revision {cineswarmReleaseLifecycleRegister.revision}</small></div>
        <div><span>Archived releases</span><strong>{cineswarmPublicArchiveRegister.archivedReleaseCount}</strong><small>C1.17 register revision {cineswarmPublicArchiveRegister.revision}</small></div>
      </div>

      <div className="csb-grid">
        <div className="csb-sequence-list">
          {pn0001CineSwarmJobs.map((job) => (
            <button key={job.network.sequenceId} className={job.network.sequenceId === selected?.network.sequenceId ? 'active' : ''} type="button" onClick={() => setSelectedId(job.network.sequenceId)}>
              <span>{String(job.network.order).padStart(2, '0')}</span>
              <div><strong>{job.project.name.replace(/^PN-0001 \/ \d+ /, '')}</strong><small>{job.narration.timecode} · {job.constraints.expectedDurationSeconds}s · {job.generation.shots.length} shots</small></div>
            </button>
          ))}
        </div>

        {selected && (
          <article className="csb-job-card">
            <div className="csb-job-topline"><span>{selected.network.sequenceId}</span><span>{selected.targetEngine.transport}</span></div>
            <h3>{selected.project.name}</h3>
            <p>{selected.project.brief}</p>
            {selected.network.sequenceId === 'pn0001-seq01-cold-open' && (
              <>
                <div className="csb-narration"><span>Provider readiness</span><p>{cineswarmProviderReadiness.providerName} · {cineswarmProviderReadiness.modelSnapshot} · ${cineswarmProviderReadiness.governanceCeilings.batchCeilingUsd.toFixed(2)} batch governance ceiling.</p></div>
                <div className="csb-narration"><span>C1.5 request authorizations</span><p>{cineswarmRequestAuthorizationDrafts.records.map((record) => `${record.requestId}: ${record.decision} · ${record.requestDigest.slice(0, 12)}…`).join(' · ')}</p></div>
                <div className="csb-narration"><span>C1.6 seal blockers</span><p>{cineswarmSealStatus.blockers.join(' · ')}</p></div>
                <div className="csb-narration"><span>C1.7 human key ceremony</span><p>{cineswarmKeyCeremonyPlan.status} · {cineswarmKeyCeremonyStatus.blockers.join(' · ')} Private key custody remains external-human-controlled.</p></div>
                <div className="csb-narration"><span>C1.7 replay journal</span><p>{cineswarmExecutionJournalStatus.replayProtectionReady ? 'Replay protection ready' : 'Replay protection unavailable'} · {cineswarmExecutionJournalStatus.entryCount} entries · hash head {cineswarmExecutionJournalStatus.headHash ?? 'empty'}.</p></div>
                <div className="csb-narration"><span>C1.8 asset intake</span><p>{cineswarmQuarantineRegister.status} · {cineswarmQuarantineRegister.quarantinedAssetCount} quarantined · {cineswarmQuarantineRegister.acceptedCandidateCount} accepted.</p></div>
                <div className="csb-narration"><span>C1.9 candidate registry</span><p>{cineswarmCandidateAssetRegistry.status} · revision {cineswarmCandidateAssetRegistry.revision} · {cineswarmCandidateAssetRegistry.entryCount} accepted candidates · hash {cineswarmCandidateAssetRegistry.registryHash.slice(0, 12)}…</p></div>
                <div className="csb-narration"><span>C1.9 Picture Plan</span><p>{cineswarmPicturePlanRegister.status} · {cineswarmPicturePlanRegister.picturePlanCandidateCount} candidate plans · {cineswarmPicturePlanRegister.pictureLockCeremonyEligibleCount} eligible for lock ceremony.</p></div>
                <div className="csb-narration"><span>C1.10 Picture Lock</span><p>{cineswarmPictureLockRegister.status} · revision {cineswarmPictureLockRegister.revision} · {cineswarmPictureLockRegister.lockedManifestCount} lock manifests · {cineswarmPictureLockRegister.unlockEventCount} unlocks · {cineswarmPictureLockRegister.supersededManifestCount} superseded.</p></div>
                <div className="csb-narration"><span>C1.11 Locked Render</span><p>{cineswarmLockedRenderStatus.status} · {cineswarmLockedRenderStatus.renderCandidateCount} Render Candidates.</p></div>
                <div className="csb-narration"><span>C1.12 Master gate</span><p>{cineswarmMasterStatus.status} · Audio Lock {cineswarmMasterStatus.activeAudioLock ? 'active' : 'absent'} · {cineswarmMasterStatus.masterCandidateCount} Master Candidates.</p></div>
                <div className="csb-narration"><span>C1.13 Canon + Ledger packet</span><p>{cineswarmCanonLedgerStatus.status} · {cineswarmCanonRegister.canonRecordCount} Canon records · {cineswarmLedgerPacketRegister.packetCount} Ledger Admission packets.</p></div>
                <div className="csb-narration"><span>C1.14 Ledger admission + Release Candidate</span><p>{cineswarmLedgerReleaseStatus.status} · {cineswarmLedgerAdmissionRegister.ledgerAdmittedCount} admitted · {cineswarmReleaseCandidateRegister.releaseCandidateCount} Release Candidate Packages.</p></div>
                <div className="csb-narration"><span>C1.15 Network Release</span><p>{cineswarmNetworkReleaseStatus.status} · {cineswarmPublicReleaseRegister.publicReleaseCount} Public Release Receipts · canonical publicRelease {String(cineswarmNetworkReleaseStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.16 Release Lifecycle</span><p>{cineswarmReleaseLifecycleStatus.status} · {cineswarmReleaseLifecycleRegister.withdrawalCount} withdrawals · {cineswarmReleaseLifecycleRegister.supersessionCount} supersessions · current publicRelease {String(cineswarmReleaseLifecycleStatus.currentPublicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.17 Public Archive + Integrity</span><p>{cineswarmPublicArchiveStatus.status} · {cineswarmPublicArchiveRegister.archivedReleaseCount} archived releases · {cineswarmPublicArchiveRegister.correctionNoticeCount} correction notices · {cineswarmPublicArchiveRegister.revalidatedReleaseCount} revalidated releases · archive publicRelease {String(cineswarmPublicArchiveStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.18 Archive Replication + Recovery</span><p>{cineswarmArchiveRecoveryStatus.status} · {cineswarmArchiveRecoveryRegister.successfulRestoreDrillCount} successful restore drills · recovery publicRelease {String(cineswarmArchiveRecoveryStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.19 Replica Placement + Maintenance</span><p>{cineswarmReplicaMaintenanceStatus.status} · {cineswarmStorageAdapterRegistry.adapterCount} adapter contracts · {cineswarmReplicaMaintenanceRegister.syncVerifiedCount} syncs · {cineswarmReplicaMaintenanceRegister.repairCount} repairs · {cineswarmReplicaMaintenanceRegister.migrationCount} migrations · maintenance publicRelease {String(cineswarmReplicaMaintenanceStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.21 Format Preservation + Migration</span><p>{cineswarmFormatMigrationRegister.status} · revision {cineswarmFormatPreservationStatus.registerRevision} · {cineswarmFormatMigrationRegister.derivativeCount} preservation derivatives · original deletion {String(cineswarmFormatPreservationStatus.originalDeletionAuthorized)} · publicRelease {String(cineswarmFormatPreservationStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.22 Decode Environment + Access Derivatives</span><p>{cineswarmDecodeAccessRegister.status} · revision {cineswarmDecodeAccessStatus.registerRevision} · {cineswarmDecodeAccessStatus.environmentSnapshots} decoder snapshots · {cineswarmDecodeAccessStatus.compatibilityMatrices} compatibility matrices · {cineswarmDecodeAccessStatus.accessDerivatives} access derivatives · publicRelease {String(cineswarmDecodeAccessStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.23 Reproducible Decode Capsule</span><p>{cineswarmReproDecodeRegister.status} · revision {cineswarmReproDecodeStatus.registerRevision} · {cineswarmReproDecodeStatus.reconstructionProofs} runtime reconstruction proofs · full independent source rebuild {String(cineswarmReproDecodeStatus.fullIndependentSourceRebuildProven)}.</p></div>
                <div className="csb-narration"><span>C1.24B Real Independent Source Rebuild</span><p>{cineswarmIndependentRebuildProof.status} · physical inputs {cineswarmIndependentRebuildProof.physicalInputCount}/{cineswarmIndependentRebuildProof.requiredInputCount} · proof full independent rebuild {String(cineswarmIndependentRebuildProof.proofFullIndependentSourceRebuildProven)} · full OS isolation {String(cineswarmIndependentRebuildProof.fullOsIsolationProven)} · canonical revision {cineswarmIndependentRebuildRegister.revision} · canonical admission pending {String(cineswarmIndependentRebuildProof.canonicalAdmissionPending)} · publicRelease {String(cineswarmIndependentRebuildStatus.publicRelease)}.</p></div>
                <div className="csb-narration"><span>C1.24C Human Independent-Rebuild Admission</span><p>{cineswarmIndependentRebuildAdmissionStatus.status} · technical proof {String(cineswarmIndependentRebuildAdmissionStatus.technicalProofEarned)} · active human signing keys {cineswarmIndependentRebuildAdmissionStatus.activeHumanSigningKeys} · admission receipts {cineswarmIndependentRebuildAdmissionRegister.admissionReceiptCount} · canonical proof {String(cineswarmIndependentRebuildAdmissionStatus.canonicalFullIndependentSourceRebuildProven)} · blockers {cineswarmIndependentRebuildAdmissionStatus.blockers.join(' · ')}.</p></div>
                <div className="csb-narration"><span>C1.24D Offline Human Key + Admission Signing Kit</span><p>{cineswarmOfflineHumanAdmissionKitStatus.status} · kit ready {String(cineswarmOfflineHumanAdmissionKitStatus.kitReady)} · external human key enrolled {String(cineswarmOfflineHumanAdmissionKitStatus.externalHumanKeyEnrolled)} · human admission signed {String(cineswarmOfflineHumanAdmissionKitStatus.humanAdmissionSigned)} · canonical proof {String(cineswarmOfflineHumanAdmissionKitStatus.canonicalFullIndependentSourceRebuildProven)} · manifest {cineswarmOfflineHumanAdmissionKitManifest.manifestHash.slice(0, 16)}… · blockers {cineswarmOfflineHumanAdmissionKitStatus.blockers.join(' · ')}.</p></div>
                <div className="csb-narration"><span>C1.24E Human Ceremony Console + Admission Staging</span><p>{cineswarmHumanCeremonyConsoleStatus.status} · public enrollment response {String(cineswarmHumanCeremonyConsoleStatus.humanEnrollmentResponsePresent)} · fingerprint acknowledged {String(cineswarmHumanCeremonyConsoleStatus.fingerprintAcknowledged)} · public key staged {String(cineswarmHumanCeremonyConsoleStatus.publicKeyStaged)} · signed response {String(cineswarmHumanCeremonyConsoleStatus.signedAdmissionResponsePresent)} · canonical stage {String(cineswarmHumanCeremonyConsoleStatus.canonicalAdmissionStagePresent)} · blockers {cineswarmHumanCeremonyConsoleStatus.blockers.join(' · ')}.</p></div>
                <div className="csb-narration"><span>C1.24F Canonical Admission Commit + Post-Commit Audit</span><p>{cineswarmCanonicalAdmissionCommitStatus.status} · commit register revision {cineswarmCanonicalAdmissionCommitRegister.revision} · human key enrolled {String(cineswarmCanonicalAdmissionCommitStatus.humanPublicKeyEnrolled)} · admission signed {String(cineswarmCanonicalAdmissionCommitStatus.humanAdmissionSigned)} · commit confirmed {String(cineswarmCanonicalAdmissionCommitStatus.commitConfirmed)} · canonical committed {String(cineswarmCanonicalAdmissionCommitStatus.canonicalCommitted)} · multi-file atomicity claimed {String(cineswarmCanonicalAdmissionCommitStatus.multiFileAtomicityClaimed)} · blockers {cineswarmCanonicalAdmissionCommitStatus.blockers.join(' · ')}.</p></div>
                <div className="csb-narration"><span>C1.24H Ceremony Health + Compact Handoff</span><p>{cineswarmChallengeHealthHandoffStatus.status} · health {cineswarmChallengeHealthHandoffStatus.healthAuditResult} · handoff ready {String(cineswarmChallengeHealthHandoffStatus.handoffReady)} · compact payload {cineswarmChallengeHealthHandoffStatus.handoffBytes} bytes · challenge expires {cineswarmChallengeHealthHandoffStatus.challengeExpiresAt} · canonical drift {String(cineswarmChallengeHealthHandoffStatus.canonicalDrift)} · private key detected {String(cineswarmChallengeHealthHandoffStatus.privateKeyDetected)}.</p></div>
              </>
            )}
            <div className="csb-narration"><span>Narration · {selected.narration.timecode}</span><p>{selected.narration.text}</p></div>
            <div className="csb-shots">
              {selected.generation.shots.map((shot, index) => (
                <div key={`${selected.network.sequenceId}-${shot.title}`}><span>Shot {index + 1} · {shot.durationSeconds}s</span><strong>{shot.title}</strong><p>{shot.prompt}</p></div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="csb-export" type="button" onClick={() => downloadJson(`${selected.network.sequenceId}.production-job.json`, selected)}>Export production job JSON</button>
              {selected.network.sequenceId === 'pn0001-seq01-cold-open' && (
                <>
                  <button className="csb-export" type="button" onClick={() => downloadJson('pn0001-seq01-provider-readiness-packet.json', cineswarmProviderReadiness)}>Export provider readiness packet</button>
                  <button className="csb-export" type="button" onClick={() => downloadJson('pn0001-seq01-request-authorization-drafts.json', cineswarmRequestAuthorizationDrafts)}>Export request authorization drafts</button>
                  <button className="csb-export" type="button" onClick={() => downloadJson('pn0001-c1-7-key-ceremony-plan.json', cineswarmKeyCeremonyPlan)}>Export key ceremony plan</button>
                  <button className="csb-export" type="button" onClick={() => downloadJson('pn0001-c1-7-execution-journal.json', cineswarmExecutionJournal)}>Export execution journal</button>
                </>
              )}
            </div>
          </article>
        )}
      </div>

      <div className="csb-boundaries">
        <div><span>Signing identity</span><strong>{cineswarmKeyCeremonyStatus.keyReady ? 'Active' : 'Pending ceremony'}</strong><p>Ed25519 proof-of-possession; private key remains outside the repository.</p></div>
        <div><span>Candidate registry</span><strong>Hash-chained revisions</strong><p>Accepted artifacts remain bound to exact request, sequence-job, review, and artifact hashes.</p></div>
        <div><span>Picture Lock</span><strong>Signed + immutable</strong><p>C1.10 locks only an exact approved plan hash; any later edit requires signed unlock/supersession history.</p></div>
        <div><span>Post-production</span><strong>Hash-bound + measured</strong><p>C1.11 can render only active Picture-Locked hashes with human-reviewed audio conform and measured QC.</p></div>
        <div><span>Master gate</span><strong>Signed + separate</strong><p>C1.12 requires exact Audio Lock, creative + technical review, and a separate signed Master Candidate acceptance. Canon and release remain unavailable here.</p></div>
        <div><span>Canon + Ledger</span><strong>Signed + evidence-bound</strong><p>C1.13 separates Canon Review from Canon Promotion and builds a 14-link Ledger evidence packet without self-admitting it.</p></div>
        <div><span>Ledger admission</span><strong>Independent + signed</strong><p>C1.14 re-verifies the exact packet, signs admission separately, and assembles a Release Candidate Package only after an immutable receipt exists.</p></div>
        <div><span>Network release</span><strong>Human review + signature + confirmation</strong><p>C1.15 alone proves a successful public release. C1.16 governs withdrawal, correction, and supersession without rewriting history; C1.17 preserves that history for audiences and revalidates its hashes; C1.18 adds independent replica and restore-drill proof; C1.19 adds ongoing placement, sync, repair, and migration evidence; C1.20 adds scheduled media audits, signed refresh authorization, verified replacement, and separate retirement history; C1.21 adds evidence-backed format monitoring and decoded-equivalent preservation derivatives while keeping the original immutable; C1.22 fingerprints the decode environment and permits access-only playback derivatives after compatibility/QC/human review. None gains release authority. Canonical PN-0001 remains unreleased.</p></div>
        <div><span>Relay</span><strong>Still separate</strong><p>{cineswarmBaseline.relayBoundary}</p></div>
      </div>
    </section>
  );
}
