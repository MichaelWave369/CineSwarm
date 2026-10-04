#!/usr/bin/env node
import { classifyHumanCeremonyConsoleState } from '../packages/cineswarm-bridge/src/human-ceremony-console.js';
import { loadC124EContext } from './lib/c1-24e-context.mjs';
const c=loadC124EContext();
const out=classifyHumanCeremonyConsoleState({technicalProofEarned:c.proofContext.rebuildReceipt.fullIndependentSourceRebuildProven===true,canonicalFullIndependentSourceRebuildProven:c.c24CanonicalRegister.fullIndependentSourceRebuildProven===true});
console.log(JSON.stringify({...out,humanNextAction:'Return only the public C1.24D enrollment-response JSON. C1.24E will verify proof-of-possession and require exact full-fingerprint re-entry before staging the public key.'},null,2));
