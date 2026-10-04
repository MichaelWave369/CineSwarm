#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
function run(cmd,args,{binary=false}={}) { const r=spawnSync(cmd,args,{encoding:binary?null:'utf8',maxBuffer:128*1024*1024}); if(r.status!==0) throw new Error(`${cmd} failed: ${binary ? r.stderr?.toString() : r.stderr}`); return r.stdout; }
function fileSha(p){ return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function normalizeContainer(name){ if(String(name).includes('matroska')) return 'matroska'; if(String(name).includes('mp4')) return 'mp4'; if(String(name).includes('avi')) return 'avi'; return String(name).split(',')[0]; }
function rate(value){ if(typeof value!=='string'||!value.includes('/')) return Number(value); const [a,b]=value.split('/').map(Number); return b? a/b : 0; }
function observe(path){
  const j=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path]));
  const v=j.streams.find(s=>s.codec_type==='video'); const a=j.streams.find(s=>s.codec_type==='audio'); if(!v||!a) throw new Error('media must contain video and audio');
  run('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-map','0:a:0','-f','null','-']);
  return { actualSha256:fileSha(path), fullDecodePassed:true, technical:{container:normalizeContainer(j.format.format_name),videoCodec:v.codec_name,audioCodec:a.codec_name,pixelFormat:v.pix_fmt,audioSampleRateHz:Number(a.sample_rate),audioChannels:Number(a.channels),durationSeconds:Number(j.format.duration),width:Number(v.width),height:Number(v.height),frameRate:rate(v.avg_frame_rate||v.r_frame_rate)} };
}
const [policyPath, sourcePathArg, outputPathArg, observationPathArg] = process.argv.slice(2);
if(!policyPath||!sourcePathArg||!outputPathArg||!observationPathArg){ console.error('Usage: node scripts/cineswarm-create-playback-access-derivative.mjs <policy.json> <preservation.mkv> <access.mp4> <observations.json>'); process.exit(64); }
const policy=JSON.parse(readFileSync(resolve(policyPath),'utf8')); const sourcePath=resolve(sourcePathArg); const outputPath=resolve(outputPathArg);
const p=policy.accessProfile;
run('ffmpeg',['-y','-v','error','-i',sourcePath,'-map','0:v:0','-map','0:a:0','-c:v','libx264','-crf',String(p.videoCrf),'-pix_fmt',p.pixelFormat,'-c:a','aac','-ar',String(p.audioSampleRateHz),'-ac',String(p.audioChannels),'-movflags','+faststart',outputPath]);
const result={mechanicsOnly:true,governanceReceipt:false,sourceObservation:observe(sourcePath),accessObservation:observe(outputPath),outputPath,originalOrPreservationAuthorityChanged:false,publicRelease:false,relayDependency:false};
writeFileSync(resolve(observationPathArg),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({outputPath,accessSha256:result.accessObservation.actualSha256,technical:result.accessObservation.technical,governanceReceipt:false,publicRelease:false},null,2));
