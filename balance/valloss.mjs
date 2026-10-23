// node valloss.mjs --sets cand.json [--from 101 --seeds 60]  -> loss on held-out seeds (search.mjs criteria)
import './lib.mjs';
import { runBatch } from './metrics.mjs';
import { loss } from './search.mjs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const m = runBatch({ N: Number(arg('seeds', 60)), FROM: Number(arg('from', 101)) });
const r = loss(m);
console.log('loss', r.total.toFixed(3), JSON.stringify(Object.fromEntries(Object.entries(r.L).filter(([, v]) => v > 0.05).map(([k, v]) => [k, +v.toFixed(2)]))));
