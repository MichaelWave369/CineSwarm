#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildFfmpegRenderArgs,
  validateActiveLockedPicture,
  validateLockedRenderContract,
  validateLockedRenderPolicy,
} from '../packages/cineswarm-bridge/src/locked-render-audio.js';

const args = process.argv.slice(2);
if (args.length !== 7) {
  console.error('Usage: node scripts/cineswarm-render-locked-picture.mjs <policy.json> <locked-picture-manifest.json> <picture-lock-register.json> <render-contract.json> <picture-root> <audio-root> <output.mp4>');
  process.exit(64);
}
const [policyPath, manifestPath, registerPath, contractPath, pictureRoot, audioRoot, outputPath] = args;
const load = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = load(policyPath);
const manifest = load(manifestPath);
const pictureLockRegister = load(registerPath);
const contract = load(contractPath);
validateLockedRenderPolicy(policy);
validateActiveLockedPicture({ manifest, pictureLockRegister });
validateLockedRenderContract(contract, { policy, lockedPictureManifest: manifest, pictureLockRegister });
const ffmpegArgs = buildFfmpegRenderArgs(contract, { pictureRootDir: resolve(pictureRoot), audioRootDir: resolve(audioRoot), outputPath: resolve(outputPath) });
const result = spawnSync('ffmpeg', ffmpegArgs, { encoding: 'utf8' });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'ffmpeg failed');
  process.exit(result.status ?? 1);
}
const output = resolve(outputPath);
const bytes = readFileSync(output);
const stat = statSync(output);
console.log(JSON.stringify({
  rendered: true,
  output,
  sizeBytes: stat.size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  renderContractHash: contract.contractHash,
  lockedPictureManifestHash: contract.lockedPictureManifestHash,
  masterAccepted: false,
  publicRelease: false,
}, null, 2));
