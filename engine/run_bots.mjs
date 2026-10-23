// Headless run: every seat is a bot. node engine/run_bots.mjs --seed 42 --teams 6 --house 2 --seasons 4 --out engine/runs/seed42.json
// Plain Node 18+, no install step. Prints a short per-season summary and writes the full run (state tables, results, ranking) as JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANDS } from '../config/brands.js';
import { HOUSE, POOLS } from '../config/rules.js';
import { MARKET_IDS, MARKETS } from '../config/markets.js';
import { createGame, beginSeason, teamView, resolveSeason, makeOffers, exportTables, finalRanking, rand } from './core.mjs';
import { housePlan, strategyPlan, strategyOffers, STRATEGIES } from './bots.mjs';

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }

export function playGame({ seed, teams, house, seasons, quiet = false, poolScale = 1, overrides = {} }) {
  if (poolScale !== 1) for (const m of Object.keys(POOLS)) POOLS[m] = POOLS[m] * poolScale;   // experiment only: edit config/rules.js to keep a change
  if (house > HOUSE.maxCount || house > teams) throw new Error('house count must be at most ' + Math.min(HOUSE.maxCount, teams));
  // brands: a seeded shuffle of the twelve; humans-seats first, then the house takes brands nobody picked
  const tmp = { rng: (seed ^ 0x51ED270B) >>> 0 };
  const pool = BRANDS.map(b => b.id);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand(tmp) * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const seats = [];
  const players = teams - house;
  for (let i = 0; i < players; i++) seats.push({ id: 'T' + (i + 1), brandId: pool[i], house: false, strategy: STRATEGIES[i % STRATEGIES.length] });
  for (let i = 0; i < house; i++) seats.push({ id: 'T' + (players + i + 1), brandId: pool[players + i], house: true, personality: HOUSE.order[i] });
  const state = createGame({ seed, teams: seats, seasons });
  const bots = Object.fromEntries(seats.map(s => [s.id, { id: s.id, strategy: s.strategy || null, personality: s.personality || null, house: s.house, mem: {} }]));
  const out = (...a) => { if (!quiet) console.log(...a); };
  out('game ' + state.gameId + ': ' + seats.map(s => state.teams[s.id].name + (s.house ? ' [HOUSE ' + s.personality + ']' : ' [' + s.strategy + ']')).join(', '));
  for (let s = 1; s <= seasons; s++) {
    const season = beginSeason(state);
    const subs = {};
    for (const id of state.order) {
      const bot = bots[id], view = teamView(state, id);
      const r = overrides[id] ? overrides[id](view, () => rand(state)) : bot.house ? housePlan(view, bot.personality) : strategyPlan(bot, view, () => rand(state));
      subs[id] = r.lock ? { plan: r.plan, locked: true, why: r.why, lock_left: 0 } : { plan: r.plan, locked: false, why: '' };
    }
    const res = resolveSeason(state, subs);
    const offers = {};
    for (const id of state.order) {
      if (bots[id].house || overrides[id]) continue;
      const o = strategyOffers(bots[id], teamView(state, id));
      if (o.length) offers[id] = o;
    }
    makeOffers(state, offers);
    out('--- season ' + s + ' | cards ' + season.cards.map(c => c.id).join(', ') + ' | seats ' + MARKET_IDS.map(m => m.slice(0, 3) + ':' + (res.seats[m] || '-')).join(' '));
    for (const m of MARKET_IDS) {
      const M = res.markets[m];
      out('  ' + MARKETS[m].name.padEnd(9) + 'crowd ' + M.crowd + ' | incumbent ' + (M.incumbent.share * 100).toFixed(0) + '% | ' +
        (M.lines.map(l => l.team + (l.house ? 'h' : '') + ':' + l.mode + ' fit' + l.fit.toFixed(2) + ' ' + (l.share * 100).toFixed(0) + '% $' + l.profit.toFixed(1)).join('  ') || 'nobody'));
    }
    out('  cash ' + state.order.map(id => id + (state.teams[id].house ? 'h' : '') + ' ' + state.teams[id].cash.toFixed(1)).join(' | '));
  }
  const rank = finalRanking(state);
  out('=== final (human teams ranked; house listed apart) ===');
  rank.ranked.forEach(r => out('  #' + r.rank + ' ' + r.team + ' ' + r.name.padEnd(22) + (bots[r.team].strategy || '').padEnd(14) + '$' + r.profit.toFixed(2) + 'M'));
  rank.house.forEach(r => out('  house ' + r.team + ' ' + r.name.padEnd(20) + (bots[r.team].personality || '').padEnd(14) + '$' + r.profit.toFixed(2) + 'M (not ranked)'));
  return { state, rank, bots, seats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seed = Number(arg('seed', 1)), teams = Number(arg('teams', 6)), house = Number(arg('house', 2)), seasons = Number(arg('seasons', 4));
  const outFile = arg('out', null);
  const { state, rank, bots } = playGame({ seed, teams, house, seasons, poolScale: Number(arg('pool-scale', 1)) });
  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    const run = { seed, teams, house, seasons, strategies: Object.fromEntries(Object.values(bots).map(b => [b.id, b.house ? 'house:' + b.personality : b.strategy])),
      ...exportTables(state), results: state.history, ranking: rank };
    fs.writeFileSync(outFile, JSON.stringify(run, null, 1));
    console.log('wrote ' + outFile);
  }
}
