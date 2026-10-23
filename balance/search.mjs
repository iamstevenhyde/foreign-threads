// Random local search over config + bot knobs against the retune criteria.
// node balance/search.mjs --id A --iters 200 --seeds 20 [--seed 1] [--start file.json] [--sets base.json]
// Appends to balance/search_<id>.log, best vector in balance/search_<id>_best.json. Run from the balance folder.
import fs from 'node:fs';
import { ROOTS, setPath } from './lib.mjs';
import { runBatch } from './metrics.mjs';
import { MARKET_IDS } from '../config/markets.js';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const ID = arg('id', 'A'), ITERS = Number(arg('iters', 100)), SEEDS = Number(arg('seeds', 20)), RS = Number(arg('seed', 1));
let rs = (RS * 2654435761) >>> 0;
const rnd = () => { rs = (rs + 0x6D2B79F5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const clone = x => JSON.parse(JSON.stringify(x));
const get = p => p.split('.').reduce((o, k) => o[k], ROOTS);
// [path, lo, hi]
const NUM = [
  ['POOLS.berlin', 200, 440], ['POOLS.tokyo', 150, 380], ['POOLS.saopaulo', 180, 400], ['POOLS.nairobi', 120, 340],
  ['MARKETS.berlin.tolerance', 0.6, 0.95], ['MARKETS.tokyo.tolerance', 0, 0.3], ['MARKETS.saopaulo.tolerance', 0, 0.3], ['MARKETS.nairobi.tolerance', 0, 0.3],
  ['MARKETS.berlin.shipReachBonus', 0.2, 0.6],
  ['SHARE.fitExponent', 2, 3.2], ['SHARE.reach.ship', 0.25, 0.6], ['SHARE.reach.partner', 0.8, 1.3], ['SHARE.reach.own', 0.6, 1.1], ['SHARE.reach.carried', 0.5, 1.0],
  ['MODES.own.setup', 1, 4], ['MODES.own.ownRampFirstSeason', 0.3, 0.8], ['MODES.partner.feeShare', 0.1, 0.4], ['CARRY.fee', 0.5, 2.5],
  ['BUDGET.partnerBidCap', 0.06, 0.25], ['BUDGET.minPartnerBid', 0.2, 0.8],
  ['MARKETS.saopaulo.rules.dutyShipped', 0.2, 0.5], ['MARKETS.nairobi.rules.walkShare', 0.1, 0.4],
  ['TIER_COST.premium', 1.2, 1.7], ['FOG.researchFee', 0.2, 1.0], ['COPY.suitFine', 1.5, 4.0],
  ['HOUSE.personalities.local.bidShare', 0.04, 0.3], ['HOUSE.personalities.bold.bidShare', 0.04, 0.3],
  ['TUNE.rivalScale', 0.1, 0.9], ['TUNE.adapterBidFrac', 0.1, 0.7], ['TUNE.highbidderBidFrac', 0.3, 1.2],
];
// array-valued config scaled by one number: [name, lo, hi, apply(base, s)]
const SCALES = [
  ['feeScale', 0.4, 2.2, (b, s) => setPath('DESIGN.extraFee', b['DESIGN.extraFee'].map(x => snap(x * s, 0.05)))],
  ['dnaScale', 0.3, 2.5, (b, s) => setPath('DESIGN.dnaSurcharge', { free: 0, other: snap(b['DESIGN.dnaSurcharge'].other * s, 0.01), costly: snap(b['DESIGN.dnaSurcharge'].costly * s, 0.01) })],
  ['multScale', 0.5, 2.0, (b, s) => setPath('DESIGN.unitCostMultiplier', b['DESIGN.unitCostMultiplier'].map(x => snap(1 + (x - 1) * s, 0.01)))],
  ['costScale', 0.85, 1.2, (b, s) => setPath('RUNS.unitCost', Object.fromEntries(Object.entries(b['RUNS.unitCost']).map(([k, v]) => [k, Math.round(v * s)])))],
  ...MARKET_IDS.map(m => ['tax_' + m, 0.5, 1.6, (b, s) => setPath('MARKETS.' + m + '.taxBySeason', b['MARKETS.' + m + '.taxBySeason'].map(x => snap(x * s, 0.005)))]),
];
const base = {};
for (const [p] of NUM) base[p] = get(p);
for (const p of ['DESIGN.extraFee', 'DESIGN.dnaSurcharge', 'DESIGN.unitCostMultiplier', 'RUNS.unitCost', ...MARKET_IDS.map(m => 'MARKETS.' + m + '.taxBySeason')]) base[p] = clone(get(p));
const DIM = NUM.length + SCALES.length;

// Everything is snapped to a clean step so the result can be written into config as-is and printed on the team page without a stray decimal.
const STEP = p => (p.startsWith('POOLS') ? 5 : /bidShare|partnerBidCap/.test(p) ? 0.01 : p === 'SHARE.fitExponent' ? 0.1 : p === 'COPY.suitFine' ? 0.25 : 0.05);
const snap = (x, st) => +(Math.round(x / st) * st).toFixed(4);
export function apply(vec) {
  NUM.forEach(([p, lo, hi], i) => setPath(p, snap(lo + Math.min(1, Math.max(0, vec[i])) * (hi - lo), STEP(p))));
  SCALES.forEach(([n, lo, hi, fn], j) => fn(base, lo + Math.min(1, Math.max(0, vec[NUM.length + j])) * (hi - lo)));
}
function startVec() {
  const v = NUM.map(([p, lo, hi]) => Math.min(1, Math.max(0, (base[p] - lo) / (hi - lo))));
  SCALES.forEach(([n, lo, hi]) => v.push((1 - lo) / (hi - lo)));
  return v;
}
const hinge = (x, scale = 1) => Math.max(0, x) / scale;

export function loss(m) {
  const o = m.out, L = {}, st = o.by_strategy_total, bm = o.by_market, bmm = o.by_market_mode;
  L.cap = hinge(o.capped_share - 0.40, 0.15);
  const adapter = st.adapter.mean_total_profit, std = st.standardizer.mean_total_profit, steady = st['house:steady'].mean_total_profit;
  L.adaptBeatsOneDesign = hinge(3 - (adapter - Math.max(std, steady)), 4);
  const g = o.adapter_vs_standardizer_groups;
  L.highPressure = hinge(1.0 - (g.high.adapter - g.high.standardizer), 1.5);
  L.lowPressure = hinge(g.low.adapter - g.low.standardizer + 0.3, 1.0);
  L.fitMatters = hinge(1.0 - (o.fit_matters.hi_profit - o.fit_matters.lo_profit), 1.0);
  const w = o.mode_win_share;
  for (const mode of ['ship', 'partner', 'own']) L['win_' + mode] = hinge((w[mode] || 0) - 0.45, 0.1) + hinge(0.2 - (w[mode] || 0), 0.1);
  L.noDominant = hinge(Math.max(st.highbidder.mean_total_profit, st['house:local'].mean_total_profit, st['house:bold'] ? st['house:bold'].mean_total_profit : -99) - adapter - 3, 3);
  L.houseSeats = hinge(o.seat_wins.house_share - 0.33, 0.08);
  L.carryVsBid = hinge(o.carry_vs_bid.carried - o.carry_vs_bid.partner, 0.8);
  const t = o.team_profit_overall;
  L.meanProfit = hinge(2.5 - t.all_mean, 3) + hinge(t.all_mean - 9, 4);
  L.losing = hinge(t.share_losing - 0.33, 0.12);
  for (const mk of MARKET_IDS) L['mkt_' + mk] = hinge(-0.3 - bm[mk].mean_profit, 0.8) + hinge(bm[mk].mean_profit - 3, 2);
  const ok = (mk, md) => (bmm[mk][md] && bmm[mk][md].n >= 20 ? bmm[mk][md].mean_profit : null);
  const best = (mk, mode, others) => { const a = ok(mk, mode); if (a === null) return 1; const b = Math.max(...others.map(x => ok(mk, x) ?? -9)); return hinge(b - a + 0.2, 0.8); };
  L.callBerlin = best('berlin', 'ship', ['partner', 'own']);
  L.callTokyo = best('tokyo', 'partner', ['ship']);
  L.callSP = Math.min(best('saopaulo', 'partner', ['ship']), best('saopaulo', 'own', ['ship'])) * 1.5;
  L.callNairobi = best('nairobi', 'own', ['partner']);
  for (const [k, v] of Object.entries(st)) if (!k.startsWith('house:steady')) L['strat_' + k] = hinge(-5 - v.mean_total_profit, 3) * (k === 'copier' ? 0.5 : 1);
  const weights = { cap: 2, adaptBeatsOneDesign: 3, highPressure: 2, lowPressure: 1, houseSeats: 1.5, carryVsBid: 1.5, meanProfit: 1.5, losing: 1, callBerlin: 1, callTokyo: 1, callSP: 1, callNairobi: 1 };
  let total = 0;
  for (const [k, v] of Object.entries(L)) total += (weights[k] ?? 1) * v;
  return { total, L };
}

if (process.argv[1] && process.argv[1].endsWith('search.mjs')) {
  let cur = startVec();
  if (arg('start', null)) { const b = JSON.parse(fs.readFileSync(arg('start'), 'utf8')); if (b.vec && b.vec.length === DIM) cur = b.vec; }
  const evaluate = vec => { apply(vec); const m = runBatch({ N: SEEDS, FROM: 1 }); return { ...loss(m), m }; };
  let curE = evaluate(cur), best = { vec: cur.slice(), loss: curE.total, L: curE.L, names: [...NUM.map(x => x[0]), ...SCALES.map(x => x[0])] };
  const log = s => fs.appendFileSync('search_' + ID + '.log', s + '\n');
  log('start loss ' + curE.total.toFixed(3));
  for (let it = 1; it <= ITERS; it++) {
    const cand = cur.slice(), k = 1 + Math.floor(rnd() * 5), sigma = it % 10 === 0 ? 0.25 : 0.08;
    for (let n = 0; n < k; n++) { const i = Math.floor(rnd() * DIM); cand[i] = Math.min(1, Math.max(0, cand[i] + gauss() * sigma)); }
    const e = evaluate(cand);
    if (e.total < curE.total) {
      cur = cand; curE = e;
      if (e.total < best.loss) { best = { vec: cand.slice(), loss: e.total, L: e.L, names: best.names }; fs.writeFileSync('search_' + ID + '_best.json', JSON.stringify(best)); }
    }
    log('it ' + it + ' cand ' + e.total.toFixed(3) + ' cur ' + curE.total.toFixed(3) + ' best ' + best.loss.toFixed(3));
  }
  fs.writeFileSync('search_' + ID + '_best.json', JSON.stringify(best));
  log('done best ' + best.loss.toFixed(3) + ' ' + JSON.stringify(Object.fromEntries(Object.entries(best.L || {}).filter(([, v]) => v > 0.05).map(([k, v]) => [k, +v.toFixed(2)]))));
}
