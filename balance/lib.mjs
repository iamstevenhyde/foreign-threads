// Shared by the balance scripts: config overrides applied in-process on import (nothing on disk changes).
//   --set PATH=JSON            e.g. --set POOLS.berlin=300
//   --sets file.json           a JSON object { "PATH": value, ... }
// PATH roots: any export of config/rules.js or config/markets.js, plus TUNE (bot knobs in engine/bots.mjs).
import fs from 'node:fs';
import * as RULES from '../config/rules.js';
import * as MKS from '../config/markets.js';
import { TUNE } from '../engine/bots.mjs';
export const ROOTS = { ...RULES, ...MKS, TUNE };
export function setPath(p, v) {
  const parts = p.split('.'), key = parts.pop();
  const parent = parts.reduce((o, k) => { if (o[k] === undefined) throw new Error('--set: no such path ' + p); return o[k]; }, ROOTS);
  parent[key] = v;
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--set') { const s = process.argv[i + 1], j = s.indexOf('='); setPath(s.slice(0, j), JSON.parse(s.slice(j + 1))); }
  if (process.argv[i] === '--sets') for (const [p, v] of Object.entries(JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')))) setPath(p, v);
}
