// Balance metrics: play N seeded bot games and aggregate the measures the retune is judged on. Used by batch.mjs (CLI) and search.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { playGame } from '../engine/run_bots.mjs';
import { exportTables } from '../engine/core.mjs';
import { MARKET_IDS, MARKETS } from '../config/markets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export function runBatch({ N = 30, FROM = 1, TEAMS = 6, HOUSE = 2, doCheck = false } = {}) {
let tmpDir = path.join(here, 'runs'); if (doCheck) fs.mkdirSync(tmpDir, { recursive: true });
const lines = [];          // every played line, tagged
const seatWins = { house: 0, human: 0, total: 0 };
const failures = [];
const finals = [];

for (let seed = FROM; seed < FROM + N; seed++) {
  const { state, bots, rank } = playGame({ seed, teams: TEAMS, house: HOUSE, seasons: 4, quiet: true });
  const T = exportTables(state);
  const strat = id => (bots[id].house ? 'house:' + bots[id].personality : bots[id].strategy);
  for (const r of T.ww_seasons) {
    if (r.mode === 'none') continue;
    lines.push({ seed, season: r.season, market: r.market, team: r.team_id, strat: strat(r.team_id), house: bots[r.team_id].house, mode: r.mode,
      fit: r.fit, profit: r.profit, run: r.run_units, buyers: r.buyers, capped: r.buyers >= r.run_units - 1e-6, share: r.share, design: r.design_id });
  }
  for (const b of T.ww_bids) if (b.won) { seatWins.total++; (bots[b.team_id].house ? seatWins.house++ : seatWins.human++); }
  for (const id of Object.keys(bots)) {
    const t = state.teams[id];
    finals.push({ seed, team: id, strat: strat(id), house: bots[id].house, profit: (t.cash - 20) });
  }
  if (doCheck) {
    const fp = path.join(tmpDir, 'seed' + seed + '.json');
    const run = { seed, teams: TEAMS, house: HOUSE, seasons: 4, strategies: Object.fromEntries(Object.values(bots).map(b => [b.id, b.house ? 'house:' + b.personality : b.strategy])), ...T, results: state.history, ranking: rank };
    fs.writeFileSync(fp, JSON.stringify(run));
    const r = spawnSync(process.execPath, [path.join(here, '../engine/check_log.mjs'), fp], { encoding: 'utf8' });
    if (r.status !== 0) failures.push({ seed, fails: r.stdout.split('\n').filter(l => l.startsWith('FAIL')) });
    fs.unlinkSync(fp);
  }
}

const out = {};
out.n_games = N; out.n_lines = lines.length;
out.capped_share = lines.filter(l => l.capped).length / lines.length;
const hiF = lines.filter(l => l.fit >= 0.7), loF = lines.filter(l => l.fit < 0.4);
out.fit_matters = { hi_n: hiF.length, hi_profit: mean(hiF.map(l => l.profit)), lo_n: loF.length, lo_profit: mean(loF.map(l => l.profit)) };
out.by_mode = {}; for (const m of ['ship', 'partner', 'own', 'carried']) { const L = lines.filter(l => l.mode === m); out.by_mode[m] = { n: L.length, mean_profit: mean(L.map(l => l.profit)), capped: L.filter(l => l.capped).length / (L.length || 1) }; }
out.by_market = {}; for (const m of MARKET_IDS) { const L = lines.filter(l => l.market === m); out.by_market[m] = { n: L.length, mean_profit: mean(L.map(l => l.profit)), mean_fit: mean(L.map(l => l.fit)), capped: L.filter(l => l.capped).length / (L.length || 1) }; }
out.by_market_mode = {}; for (const m of MARKET_IDS) { out.by_market_mode[m] = {}; for (const md of ['ship', 'partner', 'own', 'carried']) { const L = lines.filter(l => l.market === m && l.mode === md); if (L.length) out.by_market_mode[m][md] = { n: L.length, mean_profit: mean(L.map(l => l.profit)) }; } }
const strats = [...new Set(finals.map(x => x.strat))];
out.by_strategy_total = Object.fromEntries(strats.map(s => [s, { n: finals.filter(x => x.strat === s).length, mean_total_profit: mean(finals.filter(x => x.strat === s).map(x => x.profit)) }]));
out.by_strategy_line = Object.fromEntries(strats.map(s => { const L = lines.filter(l => l.strat === s); return [s, { n: L.length, mean_line_profit: mean(L.map(l => l.profit)), mean_fit: mean(L.map(l => l.fit)) }]; }));
// adapter vs standardizer per market class
const cls = id => MARKETS[id].pressure || null;
out.adapter_vs_standardizer = {};
for (const m of MARKET_IDS) { const a = lines.filter(l => l.market === m && l.strat === 'adapter'), s = lines.filter(l => l.market === m && l.strat === 'standardizer'); out.adapter_vs_standardizer[m] = { adapter: mean(a.map(l => l.profit)), standardizer: mean(s.map(l => l.profit)), pressure: cls(m) }; }
const hi = MARKET_IDS.filter(m => cls(m) === 'high'), lo = MARKET_IDS.filter(m => cls(m) === 'low');
const grp = (ms, s) => mean(lines.filter(l => ms.includes(l.market) && l.strat === s).map(l => l.profit));
out.adapter_vs_standardizer_groups = { high: { markets: hi, adapter: grp(hi, 'adapter'), standardizer: grp(hi, 'standardizer') }, low: { markets: lo, adapter: grp(lo, 'adapter'), standardizer: grp(lo, 'standardizer') } };
// which mode wins the market-season (top profit line among lines played)
const key = l => l.seed + '|' + l.season + '|' + l.market;
const groups = {}; for (const l of lines) (groups[key(l)] = groups[key(l)] || []).push(l);
const wins = {}; let contests = 0;
for (const g of Object.values(groups)) { const w = g.reduce((a, b) => (b.profit > a.profit ? b : a)); wins[w.mode] = (wins[w.mode] || 0) + 1; contests++; }
out.mode_win_share = Object.fromEntries(Object.entries(wins).map(([k, v]) => [k, v / contests]));
// per-market winner mode
out.mode_win_by_market = {}; for (const m of MARKET_IDS) { const G = Object.entries(groups).filter(([k]) => k.endsWith('|' + m)).map(([, g]) => g); const w = {}; for (const g of G) { const x = g.reduce((a, b) => (b.profit > a.profit ? b : a)); w[x.mode] = (w[x.mode] || 0) + 1; } out.mode_win_by_market[m] = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / G.length])); }
out.seat_wins = { ...seatWins, house_share: seatWins.house / seatWins.total, house_fair_share: HOUSE / TEAMS };
out.carry_vs_bid = { carried: out.by_mode.carried.mean_profit, partner: out.by_mode.partner.mean_profit };
out.team_profit_overall = { all_mean: mean(finals.map(x => x.profit)), human_mean: mean(finals.filter(x => !x.house).map(x => x.profit)), house_mean: mean(finals.filter(x => x.house).map(x => x.profit)), share_losing: finals.filter(x => x.profit < 0).length / finals.length };
out.check_log_failures = doCheck ? failures : 'not run';


return { out, lines, seatWins, failures };
}
