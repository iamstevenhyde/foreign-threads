// node emit.mjs best.json out.json  -> writes the resolved {path: value} overrides for a search result (use with --sets)
import fs from 'node:fs';
import './lib.mjs';
import { apply } from './search.mjs';
import { ROOTS } from './lib.mjs';
const b = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
apply(b.vec);
const get = p => p.split('.').reduce((o, k) => o[k], ROOTS);
const paths = b.names.filter(n => !/Scale$|^tax_/.test(n));
const o = {};
for (const p of paths) o[p] = get(p);
for (const p of ['DESIGN.extraFee', 'DESIGN.dnaSurcharge', 'DESIGN.unitCostMultiplier', 'RUNS.unitCost', 'MARKETS.berlin.taxBySeason', 'MARKETS.tokyo.taxBySeason', 'MARKETS.saopaulo.taxBySeason', 'MARKETS.nairobi.taxBySeason']) o[p] = get(p);
fs.writeFileSync(process.argv[3], JSON.stringify(o, null, 1));
