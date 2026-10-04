import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadC124DContext, repoRoot, readJson } from './c1-24d-context.mjs';
export { repoRoot, readJson };
export function loadC124EContext(){
  const d=loadC124DContext();
  const consolePolicy=readJson('fixtures/cineswarm/pn-0001-c1-24e-human-ceremony-console-policy.json');
  return {...d,consolePolicy};
}
export const readJsonPath=(p)=>JSON.parse(readFileSync(resolve(p),'utf8'));
