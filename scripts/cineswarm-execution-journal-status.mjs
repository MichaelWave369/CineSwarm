#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyExecutionJournal } from '../packages/cineswarm-bridge/src/key-ceremony-journal.js';

const journalPath = resolve(process.argv[2] || 'fixtures/cineswarm/pn-0001-c1-7-execution-journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
console.log(JSON.stringify(classifyExecutionJournal(journal), null, 2));
