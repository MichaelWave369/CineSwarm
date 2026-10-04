#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyLockedRenderState,
  validateLockedRenderPolicy,
  validateRenderCandidateRegister,
} from '../packages/cineswarm-bridge/src/locked-render-audio.js';
import { validatePictureLockRegister } from '../packages/cineswarm-bridge/src/picture-lock.js';

const [policyPath = 'fixtures/cineswarm/pn-0001-c1-11-locked-render-policy.json', pictureRegisterPath = 'fixtures/cineswarm/pn-0001-c1-10-picture-lock-register.json', renderRegisterPath = 'fixtures/cineswarm/pn-0001-c1-11-render-candidate-register.json'] = process.argv.slice(2);
const load = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const policy = load(policyPath);
const pictureLockRegister = load(pictureRegisterPath);
const renderRegister = load(renderRegisterPath);
validateLockedRenderPolicy(policy);
validatePictureLockRegister(pictureLockRegister);
validateRenderCandidateRegister(renderRegister, { policy });
console.log(JSON.stringify(classifyLockedRenderState({ policy, pictureLockRegister, renderRegister }), null, 2));
