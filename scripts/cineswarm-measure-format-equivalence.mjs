#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
function run(cmd,args,{binary=false}={}){ const r=spawnSync(cmd,args,{encoding:binary?null:'utf8',maxBuffer:1024*1024*128}); if(r.status!==0) throw new Error(`${cmd} failed: ${binary?r.stderr?.toString():r.stderr}`); return r.stdout; }
function fileSha(p){ return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function streamSha(path,kind){ const args=kind==='video'?['-v','error','-i',path,'-map','0:v:0','-f','rawvideo','-pix_fmt','yuv420p','pipe:1']:['-v','error','-i',path,'-map','0:a:0','-f','s16le','-ac','2','-ar','48000','pipe:1']; return createHash('sha256').update(run('ffmpeg',args,{binary:true})).digest('hex'); }
function observe(path){ const j=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path])); const v=j.streams.find(s=>s.codec_type==='video'); const a=j.streams.find(s=>s.codec_type==='audio'); if(!v||!a) throw new Error('source and derivative must both contain video and audio'); return { path:resolve(path), sha256:fileSha(path), durationSeconds:Number(j.format.duration), width:Number(v.width), height:Number(v.height), frameRate:v.avg_frame_rate||v.r_frame_rate, sampleRate:Number(a.sample_rate), channels:Number(a.channels), container:j.format.format_name, videoCodec:v.codec_name, audioCodec:a.codec_name, decodedVideoSha256:streamSha(path,'video'), decodedAudioSha256:streamSha(path,'audio')}; }
if(process.argv.length<4){ console.error('Usage: node scripts/cineswarm-measure-format-equivalence.mjs <source> <derivative>'); process.exit(64); }
console.log(JSON.stringify({sourceObservation:observe(process.argv[2]),derivativeObservation:observe(process.argv[3])},null,2));
