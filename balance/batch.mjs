// Balance batch: node balance/batch.mjs --seeds 30 [--from 1] [--teams 6] [--house 2] [--out balance/runs/x.json] [--check 1]
// Plays N seeded bot games headless, aggregates the measures the retune is judged on, optionally runs check_log on each seed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBatch } from './metrics.mjs';
import { MARKET_IDS, MARKETS } from '../config/markets.js';
import './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('seeds', 30)), FROM = Number(arg('from', 1)), TEAMS = Number(arg('teams', 6)), HOUSE = Number(arg('house', 2));
const outFile = arg('out', null), doCheck = arg('check', '0') === '1';
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

const { out, seatWins, failures } = runBatch({ N, FROM, TEAMS, HOUSE, doCheck });
if (arg('brief', '0') === '1') {
  const P = (o) => Object.entries(o).map(([k, v]) => k + ' ' + (typeof v === 'number' ? f(v) : JSON.stringify(v))).join(' | ');
  console.log('capped ' + f(out.capped_share * 100, 0) + '% of ' + out.n_lines + ' lines');
  console.log('mode line profit: ' + Object.entries(out.by_mode).map(([k, v]) => k + ' ' + f(v.mean_profit) + ' (n' + v.n + ')').join(' | '));
  console.log('market line profit: ' + Object.entries(out.by_market).map(([k, v]) => k + ' ' + f(v.mean_profit) + ' fit' + f(v.mean_fit) + ' cap' + f(v.capped * 100, 0)).join(' | '));
  console.log('strategy total profit: ' + Object.entries(out.by_strategy_total).map(([k, v]) => k + ' ' + f(v.mean_total_profit)).join(' | '));
  console.log('adapter vs standardizer by market: ' + Object.entries(out.adapter_vs_standardizer).map(([k, v]) => k + ' A' + f(v.adapter) + ' S' + f(v.standardizer)).join(' | '));
  console.log('groups: ' + JSON.stringify(out.adapter_vs_standardizer_groups));
  console.log('mode win share: ' + P(out.mode_win_share));
  console.log('mode win by market: ' + Object.entries(out.mode_win_by_market).map(([k, v]) => k + ' {' + P(Object.fromEntries(Object.entries(v).map(([a, b]) => [a, Math.round(b * 100) + '%']))) + '}').join(' '));
  console.log('seats house ' + seatWins.house + '/' + seatWins.total + ' = ' + f(out.seat_wins.house_share) + ' (fair ' + f(out.seat_wins.house_fair_share) + ') | carried ' + f(out.carry_vs_bid.carried) + ' vs partner ' + f(out.carry_vs_bid.partner));
  console.log('team profit: all ' + f(out.team_profit_overall.all_mean) + ' human ' + f(out.team_profit_overall.human_mean) + ' house ' + f(out.team_profit_overall.house_mean) + ' losing ' + f(out.team_profit_overall.share_losing * 100, 0) + '%');
  console.log('check_log fails: ' + (doCheck ? failures.map(x => x.seed).join(',') || 'none' : 'not run'));
} else console.log(JSON.stringify(out, null, 1));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
