// Mode x market probe: one seat (T1) plays a fixed script against the usual bot field; everything else is the same across cells (same seeds).
// node balance/probe.mjs [--seeds 30] [--set PATH=JSON ...] [--bid 2]
// Cell = mean over seeds of T1's total profit when it plays ONLY that market, in that mode, with a design tuned to what it can see (adapt) or one design for all (std).
import { playGame } from '../engine/run_bots.mjs';
import { designFor, assemble, bestPrice } from '../engine/bots.mjs';
import { MARKET_IDS } from '../config/markets.js';
import './lib.mjs';
import * as MKS from '../config/markets.js';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('seeds', 30)), BID = Number(arg('bid', 1.2)), RUNS_TRY = (arg('runs', '25,50,100')).split(',').map(Number);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

function script(market, mode, design, RUN) {
  return view => {
    const m = market, open = view.pub.markets[m].rules.modes;
    if (!open.includes(mode)) return { plan: { designs: [], markets: {}, research: [], copy: [], accept: [] }, lock: true, why: 'n/a' };
    const tiles = design === 'std' ? designFor(view, MARKET_IDS) : designFor(view, [m]);
    const spec = { market: m, tiles, mode, price: bestPrice(view, m), run: RUN, fixedRun: true, bid: mode === 'partner' ? Math.min(BID, view.bidCap) : 0, fallback: 'none' };
    return { plan: assemble(view, [spec]), lock: true, why: 'probe' };
  };
}
const out = {};
for (const design of ['adapt', 'std']) for (const m of MARKET_IDS) for (const mode of ['ship', 'partner', 'own']) {
  if (!MKS.MARKETS[m].rules.modes.includes(mode)) continue;
  let best = null;
  for (const RUN of RUNS_TRY) {
    const prof = [], seats = [], fit = [];
    for (let seed = 1; seed <= N; seed++) {
      const { state } = playGame({ seed, teams: 6, house: 2, seasons: 4, quiet: true, overrides: { T1: script(m, mode, design, RUN) } });
      prof.push(state.teams.T1.cash - 20 + state.teams.T1.receivables.reduce((a, r) => a + r.amount, 0) * 0.8);
      seats.push(Object.values(state.seats).filter(s => s[m] === 'T1').length);
      fit.push(mean(state.tables.ww_seasons.filter(r => r.team_id === 'T1' && r.market === m && r.mode !== 'none').map(r => r.fit)));
    }
    const c = { profit: mean(prof), seats: mean(seats), fit: mean(fit.filter(x => !Number.isNaN(x))), run: RUN };
    if (!best || c.profit > best.profit) best = c;
  }
  out[design + ' ' + m + ' ' + mode] = best;
}
for (const design of ['adapt', 'std']) {
  console.log('--- design: ' + design + '  (best-run mean 4-season profit of T1 playing only that market; run in thousands; seats won of 4)');
  for (const m of MARKET_IDS) console.log(m.padEnd(9) + ['ship', 'partner', 'own'].map(md => { const c = out[design + ' ' + m + ' ' + md]; return c ? (md + ' ' + c.profit.toFixed(2) + ' r' + c.run + (md === 'partner' ? ' seats' + c.seats.toFixed(1) : '')).padEnd(30) : (md + ' n/a').padEnd(30); }).join(''));
}
