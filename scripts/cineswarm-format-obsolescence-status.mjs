#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyFormatPreservationState, validateFormatPreservationPolicy, validateFormatMigrationRegister } from '../packages/cineswarm-bridge/src/format-obsolescence-migration.js';
const fixture=n=>JSON.parse(readFileSync(resolve(import.meta.dirname,'../fixtures/cineswarm',n),'utf8'));
const policy=fixture('pn-0001-c1-21-format-preservation-policy.json');
const register=fixture('pn-0001-c1-21-format-migration-register.json');
const c20=fixture('pn-0001-c1-20-preservation-register.json');
validateFormatPreservationPolicy(policy); validateFormatMigrationRegister(register,{policy,sourceC20PreservationRegisterHash:c20.registerHash});
console.log(JSON.stringify(classifyFormatPreservationState({policy,register,sourceC20PreservationRegisterHash:c20.registerHash,now:new Date().toISOString()}),null,2));
