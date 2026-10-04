#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyProviderGoNoGo, summarizeProviderReadiness } from '../packages/cineswarm-bridge/src/index.js';

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('Usage: node scripts/cineswarm-provider-go-no-go.mjs <provider-readiness-packet.json> [decision.json]');
  process.exit(64);
}

const packet = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
const decision = args[1] ? JSON.parse(readFileSync(resolve(args[1]), 'utf8')) : null;
const summary = summarizeProviderReadiness(packet);
const classification = classifyProviderGoNoGo({ packet, decision });
console.log(JSON.stringify({ summary, classification }, null, 2));
