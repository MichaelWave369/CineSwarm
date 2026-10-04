#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  appendBuildInputArchive,
  appendIndependentRebuildReceipt,
  buildBuildInputArchive,
  buildHermeticDecoderRecipe,
  buildIndependentRebuildReceipt,
  buildIndependentRebuildRegister,
  buildIndependentRebuildReport,
  validateBuildInputAcquisitionStatus,
  validateIndependentBuildPolicy,
  validateIndependentRebuildReceipt,
  validateIndependentRebuildRegister,
  validateIndependentRebuildReport,
} from '../packages/cineswarm-bridge/src/independent-source-rebuild.js';

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function fail(message, extra = {}, code = 65) {
  console.error(JSON.stringify({ ok: false, phase: 'C1.24', error: message, ...extra }, null, 2));
  process.exit(code);
}
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.error) throw result.error;
  return result;
}
function mustRun(cmd, args, label, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}
function parseConfigureArgs(text) {
  const line = text.split(/\r?\n/).find((x) => x.startsWith('configure_args='));
  if (!line) throw new Error('BUILD_CONFIGURATION.txt missing configure_args');
  return line.slice('configure_args='.length).trim().split(/\s+/).filter(Boolean);
}
function parseMakeJobs(text) {
  const line = text.split(/\r?\n/).find((x) => x.startsWith('make_jobs='));
  if (!line) return 1;
  const jobs = Number(line.slice('make_jobs='.length).trim());
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw new Error('BUILD_CONFIGURATION.txt invalid make_jobs');
  return jobs;
}
function verifyDescriptorBytes(root, descriptor) {
  if (descriptor.present !== true) throw new Error(`${descriptor.kind} is not present`);
  const path = resolve(root, descriptor.path);
  if (!existsSync(path)) throw new Error(`${descriptor.kind} file is missing: ${descriptor.path}`);
  if (statSync(path).size !== descriptor.size) throw new Error(`${descriptor.kind} size drift`);
  if (sha256File(path) !== descriptor.sha256) throw new Error(`${descriptor.kind} SHA-256 drift`);
  return path;
}
function verifySourceSignature({ sourcePath, signaturePath, publicKeyPath, expectedFingerprint }) {
  const home = mkdtempSync(resolve(tmpdir(), 'c124-gpg-build-'));
  try {
    mustRun('gpg', ['--homedir', home, '--batch', '--import', publicKeyPath], 'release key import');
    const fp = mustRun('gpg', ['--homedir', home, '--batch', '--with-colons', '--fingerprint'], 'release key fingerprint');
    const fingerprints = fp.stdout.split(/\r?\n/).filter((l) => l.startsWith('fpr:')).map((l) => l.split(':')[9]).filter(Boolean);
    if (!fingerprints.includes(expectedFingerprint)) throw new Error(`release signing fingerprint drift; expected ${expectedFingerprint}`);
    mustRun('gpg', ['--homedir', home, '--batch', '--verify', signaturePath, sourcePath], 'detached source signature verification');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
function extractArchive(archivePath, dest) {
  mkdirSync(dest, { recursive: true });
  if (archivePath.endsWith('.tar.xz')) mustRun('tar', ['-xJf', archivePath, '-C', dest], `extract ${basename(archivePath)}`);
  else mustRun('tar', ['-xf', archivePath, '-C', dest], `extract ${basename(archivePath)}`);
}
function makeRegularNull(buildRoot) {
  // The current container lacks CAP_MKNOD. A regular empty file is used only as
  // a chroot compatibility fallback. This prevents us from claiming full OS
  // isolation; the independent receipt's fullOsIsolationProven remains false.
  mkdirSync(resolve(buildRoot, 'dev'), { recursive: true });
  writeFileSync(resolve(buildRoot, 'dev/null'), '');
}

const root = resolve(process.argv[2] || '.');
const fixtures = resolve(root, 'fixtures/cineswarm');
const evidence = resolve(root, 'proof/c1-24/real-input-acquisition');
const proofBase = resolve(root, 'proof/c1-24/independent-source-rebuild');
const policy = JSON.parse(readFileSync(resolve(fixtures, 'pn-0001-c1-24-independent-build-policy.json'), 'utf8'));
const status = JSON.parse(readFileSync(resolve(fixtures, 'pn-0001-c1-24-build-input-status.json'), 'utf8'));
validateIndependentBuildPolicy(policy);
validateBuildInputAcquisitionStatus(status, { policy });

if (status.status !== 'READY_TO_BUILD_INPUT_ARCHIVE') {
  fail('Source build is fail-closed until all seven governed build-input classes are physically present and verified.', {
    status: status.status,
    missingKinds: status.missingKinds,
    fullIndependentSourceRebuildProven: false,
  });
}

const paths = Object.fromEntries(status.artifacts.map((a) => [a.kind, verifyDescriptorBytes(root, a)]));
const sourcePath = paths.UPSTREAM_SOURCE_TARBALL;
const signaturePath = paths.DETACHED_SIGNATURE;
const publicKeyPath = paths.SIGNING_PUBLIC_KEY;
verifySourceSignature({ sourcePath, signaturePath, publicKeyPath, expectedFingerprint: policy.releaseSigningKeyFingerprint });

const configExtract = mkdtempSync(resolve(tmpdir(), 'c124-config-bundle-'));
const buildRoot = mkdtempSync(resolve(tmpdir(), 'c124-ffmpeg-build-'));
let runDir = null;
try {
  extractArchive(paths.BUILD_CONFIGURATION, configExtract);
  const networkDeny = resolve(configExtract, 'network-deny');
  const networkProbe = resolve(configExtract, 'network-probe');
  const configTextPath = resolve(configExtract, 'BUILD_CONFIGURATION.txt');
  if (!existsSync(networkDeny) || !existsSync(networkProbe) || !existsSync(configTextPath)) throw new Error('build-configuration bundle is incomplete');
  const netProof = mustRun(networkDeny, [networkProbe], 'seccomp network-deny proof');
  if (!netProof.stdout.includes('C1.24_NETWORK_SYSCALL_BLOCKED:EPERM')) throw new Error('seccomp network-deny proof output drift');

  // Create the fresh build root solely from governed closure bundles.
  extractArchive(paths.COMPILER_TOOLCHAIN, buildRoot);
  extractArchive(paths.BUILD_TOOL, buildRoot);
  extractArchive(paths.SYSROOT_OR_BUILD_DEPENDENCY_CLOSURE, buildRoot);
  for (const d of ['inputs', 'src', 'work', 'media', 'tmp', 'dev']) mkdirSync(resolve(buildRoot, d), { recursive: true });
  makeRegularNull(buildRoot);
  copyFileSync(sourcePath, resolve(buildRoot, 'inputs/ffmpeg-7.1.5.tar.xz'));

  const c22 = JSON.parse(readFileSync(resolve(root, 'C1_22_OPERATIONAL_PROOF.json'), 'utf8'));
  const eq = c22.c21SyntheticContext?.equivalenceReport;
  if (!eq || eq.status !== 'PASS') throw new Error('authoritative C1.22/C1.21 equivalence context is unavailable');
  const sourceMedia = resolve(root, 'proof/c1-22/source-proof.avi');
  const preservationMedia = resolve(root, 'proof/c1-22/preservation-derivative.mkv');
  if (sha256File(sourceMedia) !== eq.sourceObservation.sha256) throw new Error('C1.22 Original proof media SHA-256 drift');
  if (sha256File(preservationMedia) !== eq.derivativeObservation.sha256) throw new Error('C1.22 Preservation proof media SHA-256 drift');
  copyFileSync(sourceMedia, resolve(buildRoot, 'media/original.avi'));
  copyFileSync(preservationMedia, resolve(buildRoot, 'media/preservation.mkv'));

  const networkDeniedChroot = (script, label) => mustRun(networkDeny, [
    '/usr/sbin/chroot', buildRoot,
    '/usr/bin/env', '-i',
    'HOME=/tmp', 'TMPDIR=/tmp', 'LC_ALL=C',
    'PATH=/usr/bin:/bin',
    'CC=/usr/bin/gcc', 'AR=/usr/bin/ar', 'AS=/usr/bin/as', 'LD=/usr/bin/ld',
    'NM=/usr/bin/nm', 'RANLIB=/usr/bin/ranlib', 'STRIP=/usr/bin/strip',
    'PKG_CONFIG=/usr/bin/pkgconf',
    '/bin/sh', '-lc', script,
  ], label);

  // The source tarball is unpacked by the archived tar/xz tools inside the
  // syscall-network-denied root, not by the host extraction tool.
  networkDeniedChroot('/usr/bin/tar -xJf /inputs/ffmpeg-7.1.5.tar.xz -C /src', 'governed FFmpeg source extraction');
  const sourceDir = '/src/ffmpeg-7.1.5';
  if (!existsSync(resolve(buildRoot, 'src/ffmpeg-7.1.5/configure'))) throw new Error('expected FFmpeg 7.1.5 source root was not created');

  const configText = readFileSync(configTextPath, 'utf8');
  const configureArgs = parseConfigureArgs(configText);
  const makeJobs = parseMakeJobs(configText);
  const compilerVersion = networkDeniedChroot('/usr/bin/gcc --version | /usr/bin/head -n1', 'archived compiler version').stdout.trim();
  const makeVersion = networkDeniedChroot('/usr/bin/make --version | /usr/bin/head -n1', 'archived make version').stdout.trim();
  const compilerSha256 = sha256File(resolve(buildRoot, 'usr/bin/gcc'));
  const buildToolSha256 = sha256File(resolve(buildRoot, 'usr/bin/make'));

  const createdAt = new Date().toISOString();
  const buildInputArchive = buildBuildInputArchive({
    policy,
    artifacts: status.artifacts,
    authenticity: {
      signatureVerified: true,
      signingKeyFingerprint: policy.releaseSigningKeyFingerprint,
      sourceArtifactSha256: status.artifacts.find((a) => a.kind === 'UPSTREAM_SOURCE_TARBALL').sha256,
      verificationTool: 'gpg-detached-signature-plus-frozen-fingerprint',
    },
    toolchain: {
      compilerId: 'gcc', compilerVersion, compilerSha256,
      buildToolId: 'make', buildToolVersion: makeVersion, buildToolSha256,
    },
    buildConfiguration: {
      networkAllowed: false,
      credentialsAllowed: false,
      copyHostDecoderBinaries: false,
      configureArgs,
      makeJobs,
    },
    createdAt,
    archiveId: 'c1-24-proof-ffmpeg-7.1.5-build-input-archive',
  });
  const authoritativeMedia = [
    { role: 'ORIGINAL', sha256: eq.sourceObservation.sha256, decodedVideoSha256: eq.sourceObservation.decodedVideoSha256, decodedAudioSha256: eq.sourceObservation.decodedAudioSha256 },
    { role: 'PRESERVATION_DERIVATIVE', sha256: eq.derivativeObservation.sha256, decodedVideoSha256: eq.derivativeObservation.decodedVideoSha256, decodedAudioSha256: eq.derivativeObservation.decodedAudioSha256 },
  ];
  const recipe = buildHermeticDecoderRecipe({
    policy,
    buildInputArchive,
    authoritativeMedia,
    createdAt: new Date().toISOString(),
    recipeId: 'c1-24-proof-ffmpeg-7.1.5-hermetic-build-recipe',
  });

  const startedAt = new Date().toISOString();
  const configureCommand = `cd ${sourceDir} && : > /work/build.log && ./configure ${configureArgs.join(' ')} >> /work/build.log 2>&1`;
  const configureResult = run(networkDeny, [
    '/usr/sbin/chroot', buildRoot, '/usr/bin/env', '-i', 'HOME=/tmp', 'TMPDIR=/tmp', 'LC_ALL=C', 'PATH=/usr/bin:/bin',
    'CC=/usr/bin/gcc', 'AR=/usr/bin/ar', 'AS=/usr/bin/as', 'LD=/usr/bin/ld', 'NM=/usr/bin/nm', 'RANLIB=/usr/bin/ranlib', 'STRIP=/usr/bin/strip', 'PKG_CONFIG=/usr/bin/pkgconf',
    '/bin/sh', '-lc', configureCommand,
  ]);
  if (configureResult.status !== 0) throw new Error(`FFmpeg configure failed; see build.log (${configureResult.status})`);
  const makeResult = run(networkDeny, [
    '/usr/sbin/chroot', buildRoot, '/usr/bin/env', '-i', 'HOME=/tmp', 'TMPDIR=/tmp', 'LC_ALL=C', 'PATH=/usr/bin:/bin',
    '/bin/sh', '-lc', `cd ${sourceDir} && /usr/bin/make -j${makeJobs} >> /work/build.log 2>&1`,
  ]);
  if (makeResult.status !== 0) throw new Error(`FFmpeg source build failed; see build.log (${makeResult.status})`);

  const builtFfmpeg = resolve(buildRoot, 'src/ffmpeg-7.1.5/ffmpeg');
  const builtFfprobe = resolve(buildRoot, 'src/ffmpeg-7.1.5/ffprobe');
  if (!existsSync(builtFfmpeg) || !existsSync(builtFfprobe)) throw new Error('source build did not produce ffmpeg + ffprobe');

  const list = (flag) => networkDeniedChroot(`${sourceDir}/ffmpeg -hide_banner ${flag}`, `built ffmpeg ${flag}`).stdout;
  const demuxers = list('-demuxers');
  const decoders = list('-decoders');
  const protocols = list('-protocols');
  const capabilityResults = policy.requiredDecoderCapabilities.map((capability) => {
    const [kind, name] = capability.split(':');
    const haystack = kind === 'demuxer' ? demuxers : kind === 'decoder' ? decoders : protocols;
    return { capability, present: new RegExp(`(^|[\\s,])${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}([\\s,]|$)`, 'm').test(haystack) };
  });

  const decodeMedia = (role, inputPath, prefix, expected) => {
    const videoCmd = `${sourceDir}/ffmpeg -v error -y -i ${inputPath} -map 0:v:0 -f rawvideo -pix_fmt yuv420p /work/${prefix}.video.raw`;
    const audioCmd = `${sourceDir}/ffmpeg -v error -y -i ${inputPath} -map 0:a:0 -f s16le -ac 2 -ar 48000 /work/${prefix}.audio.s16`;
    const v = run(networkDeny, ['/usr/sbin/chroot', buildRoot, '/usr/bin/env', '-i', 'HOME=/tmp', 'TMPDIR=/tmp', 'LC_ALL=C', 'PATH=/usr/bin:/bin', '/bin/sh', '-lc', videoCmd]);
    const a = run(networkDeny, ['/usr/sbin/chroot', buildRoot, '/usr/bin/env', '-i', 'HOME=/tmp', 'TMPDIR=/tmp', 'LC_ALL=C', 'PATH=/usr/bin:/bin', '/bin/sh', '-lc', audioCmd]);
    const videoOut = resolve(buildRoot, `work/${prefix}.video.raw`);
    const audioOut = resolve(buildRoot, `work/${prefix}.audio.s16`);
    return {
      role,
      expectedSha256: expected.sha256,
      observedSha256: sha256File(resolve(buildRoot, inputPath.replace(/^\//, ''))),
      decodedVideoSha256: existsSync(videoOut) ? sha256File(videoOut) : '0'.repeat(64),
      decodedAudioSha256: existsSync(audioOut) ? sha256File(audioOut) : '0'.repeat(64),
      fullDecodePassed: v.status === 0 && a.status === 0,
    };
  };
  const mediaResults = [
    decodeMedia('ORIGINAL', '/media/original.avi', 'original', authoritativeMedia[0]),
    decodeMedia('PRESERVATION_DERIVATIVE', '/media/preservation.mkv', 'preservation', authoritativeMedia[1]),
  ];

  const completedAt = new Date().toISOString();
  const buildLogPath = resolve(buildRoot, 'work/build.log');
  const report = buildIndependentRebuildReport({
    policy,
    buildInputArchive,
    recipe,
    startedAt,
    completedAt,
    buildEnvironment: {
      freshBuildRoot: true,
      networkDisabled: true,
      networkIsolationMechanism: 'seccomp-network-syscall-deny',
      credentialsUsed: false,
      fullOsIsolationProven: false,
    },
    buildResult: {
      sourceBuiltNotCopied: true,
      hostDecoderBinariesCopied: false,
      exitCode: 0,
      buildLogSha256: sha256File(buildLogPath),
      ffmpegSha256: sha256File(builtFfmpeg),
      ffprobeSha256: sha256File(builtFfprobe),
    },
    capabilityResults,
    mediaResults,
    reportId: 'c1-24-proof-ffmpeg-7.1.5-independent-rebuild-report',
  });
  validateIndependentRebuildReport(report, { policy, buildInputArchive, recipe });
  const receipt = buildIndependentRebuildReceipt({
    policy,
    report,
    reportContext: { policy, buildInputArchive, recipe },
    issuedAt: new Date().toISOString(),
    receiptId: 'c1-24-proof-ffmpeg-7.1.5-independent-rebuild-receipt',
  });
  validateIndependentRebuildReceipt(receipt, { policy, report, reportContext: { policy, buildInputArchive, recipe } });

  const registerContext = { policy, sourceC23ReproDecodeRegisterHash: policy.sourceC23ReproDecodeRegisterHash };
  let proofRegister = buildIndependentRebuildRegister({ ...registerContext, recordedAt: startedAt, registerId: 'c1-24-proof-independent-rebuild-register' });
  proofRegister = appendBuildInputArchive({ register: proofRegister, buildInputArchive, archiveContext: { policy }, registerContext, recordedAt: createdAt });
  proofRegister = appendIndependentRebuildReceipt({ register: proofRegister, receipt, receiptContext: { policy, report, reportContext: { policy, buildInputArchive, recipe } }, registerContext, recordedAt: receipt.issuedAt });
  validateIndependentRebuildRegister(proofRegister, registerContext);

  runDir = resolve(proofBase, completedAt.replace(/[:.]/g, '-'));
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, 'BUILD_INPUT_ARCHIVE.json'), `${JSON.stringify(buildInputArchive, null, 2)}\n`);
  writeFileSync(resolve(runDir, 'HERMETIC_BUILD_RECIPE.json'), `${JSON.stringify(recipe, null, 2)}\n`);
  writeFileSync(resolve(runDir, 'INDEPENDENT_REBUILD_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(runDir, 'INDEPENDENT_REBUILD_RECEIPT.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(resolve(runDir, 'PROOF_REGISTER.json'), `${JSON.stringify(proofRegister, null, 2)}\n`);
  copyFileSync(buildLogPath, resolve(runDir, 'BUILD.log'));

  console.log(JSON.stringify({
    ok: true,
    phase: 'C1.24',
    status: report.status,
    fullIndependentSourceRebuildProven: receipt.fullIndependentSourceRebuildProven,
    fullOsIsolationProven: receipt.fullOsIsolationProven,
    buildInputArchiveHash: buildInputArchive.archiveHash,
    recipeHash: recipe.recipeHash,
    reportHash: report.reportHash,
    receiptHash: receipt.receiptHash,
    proofRegisterHash: proofRegister.registerHash,
    proofDirectory: runDir,
    canonicalRegisterModified: false,
    publicRelease: false,
    relayDependency: false,
  }, null, 2));
} catch (error) {
  if (runDir) console.error(`partial proof directory: ${runDir}`);
  fail(error.message, { fullIndependentSourceRebuildProven: false });
} finally {
  rmSync(configExtract, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
