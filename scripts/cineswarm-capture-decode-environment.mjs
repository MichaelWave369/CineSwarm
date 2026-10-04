#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildDecodeEnvironmentSnapshot } from '../packages/cineswarm-bridge/src/decode-environment-access.js';

function run(command, args = []) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function hashText(text) { return createHash('sha256').update(text).digest('hex'); }
function hashFile(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function which(name) { return run('which', [name]).trim(); }
function firstLine(text) { return String(text).split(/\r?\n/, 1)[0]; }

const [policyPath, outputPath] = process.argv.slice(2);
if (!policyPath || !outputPath) {
  console.error('Usage: node scripts/cineswarm-capture-decode-environment.mjs <policy.json> <output.json>');
  process.exit(64);
}
const policy = JSON.parse(readFileSync(resolve(policyPath), 'utf8'));
const ffmpegPath = which('ffmpeg');
const ffprobePath = which('ffprobe');
const ffmpegVersion = run(ffmpegPath, ['-version']);
const ffprobeVersion = run(ffprobePath, ['-version']);
const decoders = run(ffmpegPath, ['-hide_banner', '-decoders']);
const encoders = run(ffmpegPath, ['-hide_banner', '-encoders']);
const formats = run(ffmpegPath, ['-hide_banner', '-formats']);
const environment = {
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version,
  ffmpeg: {
    executablePath: ffmpegPath,
    executableSha256: hashFile(ffmpegPath),
    versionLine: firstLine(ffmpegVersion),
    versionOutputSha256: hashText(ffmpegVersion),
    decodersOutputSha256: hashText(decoders),
    encodersOutputSha256: hashText(encoders),
    formatsOutputSha256: hashText(formats),
  },
  ffprobe: {
    executablePath: ffprobePath,
    executableSha256: hashFile(ffprobePath),
    versionLine: firstLine(ffprobeVersion),
    versionOutputSha256: hashText(ffprobeVersion),
  },
};
const snapshot = buildDecodeEnvironmentSnapshot({ policy, environment, capturedAt: new Date().toISOString(), snapshotId: 'c1-22-local-decode-environment-proof' });
writeFileSync(resolve(outputPath), JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ snapshotHash: snapshot.snapshotHash, capabilityHash: snapshot.capabilityHash, ffmpeg: snapshot.environment.ffmpeg.versionLine, ffprobe: snapshot.environment.ffprobe.versionLine, credentialsCaptured: snapshot.credentialsCaptured, publicRelease: snapshot.publicRelease }, null, 2));
