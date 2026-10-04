#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildRenderQcReport } from '../packages/cineswarm-bridge/src/locked-render-audio.js';

const args = process.argv.slice(2);
if (args.length < 4 || args.length > 5) {
  console.error('Usage: node scripts/cineswarm-measure-render-qc.mjs <policy.json> <render-contract.json> <render.mp4> <relative-output-path> [qc-output.json]');
  process.exit(64);
}
const [policyPath, contractPath, mediaPath, relativeOutputPath, qcOutputPath] = args;
const load = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = load(policyPath);
const contract = load(contractPath);
const media = resolve(mediaPath);
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_entries', 'format=duration', '-of', 'json', media], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error(probe.stderr || 'ffprobe failed');
  process.exit(probe.status ?? 1);
}
const probeJson = JSON.parse(probe.stdout);
const videoStreams = probeJson.streams.filter((stream) => stream.codec_type === 'video');
const audioStreams = probeJson.streams.filter((stream) => stream.codec_type === 'audio');
const video = videoStreams[0] ?? {};
const audio = audioStreams[0] ?? {};
const loud = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', media, '-map', '0:a:0', '-af', `loudnorm=I=${policy.audio.integratedLufsTarget}:TP=${policy.audio.maxTruePeakDbtp}:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
if (loud.status !== 0) {
  console.error(loud.stderr || 'ffmpeg loudnorm measurement failed');
  process.exit(loud.status ?? 1);
}
const matches = [...loud.stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
if (!matches.length) {
  console.error('Could not parse loudnorm measurement JSON');
  process.exit(2);
}
const loudJson = JSON.parse(matches.at(-1)[0]);
const bytes = readFileSync(media);
const stat = statSync(media);
const measured = {
  durationSeconds: Number(probeJson.format.duration),
  videoStreamCount: videoStreams.length,
  audioStreamCount: audioStreams.length,
  width: Number(video.width),
  height: Number(video.height),
  sampleRateHz: Number(audio.sample_rate),
  channels: Number(audio.channels),
  integratedLufs: Number(loudJson.input_i),
  truePeakDbtp: Number(loudJson.input_tp),
};
const report = buildRenderQcReport({
  policy,
  contract,
  outputAsset: {
    relativePath: relativeOutputPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: stat.size,
    mediaType: 'video/mp4',
  },
  measured,
  measuredAt: new Date().toISOString(),
});
if (qcOutputPath) writeFileSync(resolve(qcOutputPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.status === 'PASSED' ? 0 : 3);
