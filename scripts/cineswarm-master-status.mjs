#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyMasterReadiness,
  validateAudioLockRegister,
  validateMasterCandidateRegister,
  validateMasterReviewPolicy,
} from '../packages/cineswarm-bridge/src/master-review-audio-lock.js';

const [policyArg, audioRegisterArg, masterRegisterArg, renderCandidateArg] = process.argv.slice(2);
const policyPath = resolve(policyArg ?? 'fixtures/cineswarm/pn-0001-c1-12-master-review-policy.json');
const audioRegisterPath = resolve(audioRegisterArg ?? 'fixtures/cineswarm/pn-0001-c1-12-audio-lock-register.json');
const masterRegisterPath = resolve(masterRegisterArg ?? 'fixtures/cineswarm/pn-0001-c1-12-master-candidate-register.json');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const policy = readJson(policyPath);
const audioLockRegister = readJson(audioRegisterPath);
const masterRegister = readJson(masterRegisterPath);
const renderCandidate = renderCandidateArg ? readJson(resolve(renderCandidateArg)) : null;
validateMasterReviewPolicy(policy);
validateAudioLockRegister(audioLockRegister, { policy });
validateMasterCandidateRegister(masterRegister, { policy });
console.log(JSON.stringify({
  ...classifyMasterReadiness({ policy, renderCandidate, audioLockRegister, masterRegister }),
  audioLockRegisterHash: audioLockRegister.registerHash,
  masterCandidateRegisterHash: masterRegister.registerHash,
}, null, 2));
