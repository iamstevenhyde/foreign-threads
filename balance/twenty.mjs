// 20-team balance run (10/27). node balance/twenty.mjs [--seeds 200] [--teams 20] [--house 10]
// Seats: the first (teams - house) are "human-like": half run the scripted strategies (engine/bots.mjs), half are random heuristic teams that
// pick two or three markets, design for each, and bid a random share of cash for the partner seat in one or two of them (fallback ship, or own).
// Reports: win rate by bid level, seats won per team, profit spread, share of teams with zero seats, mean profit by strategy.
import { playGame } from '../engine/run_bots.mjs';
import { designFor, assemble, fitToCash, bestPrice, chooseLine } from '../engine/bots.mjs';
import { MARKET_IDS } from '../config/markets.js';
import * as R from '../config/rules.js';
// experiment knobs: --pool <perTeam> --seats <n for 13+ teams> --spread <lo,hi>   (edit config/rules.js to keep a change)
{ const i = process.argv.indexOf('--pool'); if (i > 0) R.POOL_SCALE.perTeam = Number(process.argv[i + 1]); }
{ const i = process.argv.indexOf('--seats'); if (i > 0) { const n = Number(process.argv[i + 1]); R.PARTNER.seatsByTeams[1][1] = n; R.PARTNER.seatsByTeams[2][1] = n; } }
{ const i = process.argv.indexOf('--spread'); if (i > 0) R.HOUSE.bidSpread = process.argv[i + 1].split(',').map(Number); }

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SEEDS = arg('seeds', 200), TEAMS = arg('teams', 20), HOUSE = arg('house', 10);
const LEVELS = [0.01, 0.025, 0.04, 0.05, 0.06, 0.07, 0.08];   // bid as a share of cash (0.01 = the 0.2 minimum at 20 M)

function randomTeam(view, rand) {
  const k = 2 + Math.floor(rand() * 2);
  const ms = MARKET_IDS.slice().sort(() => rand() - 0.5).slice(0, k);
  const nBid = 1 + Math.floor(rand() * 2);
  const specs = ms.map((m, i) => {
    const tiles = designFor(view, [m]), open = view.pub.markets[m].rules.modes;
    if (i < nBid) {
      const share = LEVELS[Math.floor(rand() * LEVELS.length)];
      const bid = Math.max(view.pub.BUDGET.minPartnerBid, Math.min(view.bidCap, Math.round(share * view.cash * 20) / 20));
      return { market: m, tiles, mode: 'partner', price: bestPrice(view, m), run: 50, bid, fallback: open.includes('ship') ? 'ship' : 'own', fixedRun: true };
    }
    const sp = chooseLine(view, m, tiles, { bidFrac: 0 + 1e-9 });
    return sp && sp.mode !== 'partner' ? sp : { market: m, tiles, mode: open.includes('ship') ? 'ship' : 'own', price: bestPrice(view, m), run: 50, bid: 0, fixedRun: true };
  });
  return { plan: fitToCash(view, assemble(view, specs)), lock: true, why: 'random heuristic' };
}

const wonShares = [], bidders = new Set(), bidderZero = { n: 0, zero: 0 }, randomWins = { n: 0, any: 0 };
const bidStats = Object.fromEntries(LEVELS.map(l => [l, { n: 0, won: 0 }]));
const seatHist = {}, profits = { human: [], house: [], random: [] }, byStrat = {};
let zero = 0, teamsN = 0, seatsTotal = 0, bidsPerMarketSeason = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const players = TEAMS - HOUSE, overrides = {};
  for (let i = Math.ceil(players / 2); i < players; i++) overrides['T' + (i + 1)] = randomTeam;
  const { state, bots } = playGame({ seed, teams: TEAMS, house: HOUSE, seasons: 4, quiet: true, overrides });
  const startCash = {};
  // cash at the start of each season, for the bid share
  const cashAt = {};
  for (const r of state.tables.ww_seasons) { /* not needed */ }
  for (const id of state.order) startCash[id] = state.teams[id].startCash;
  const seats = Object.fromEntries(state.order.map(id => [id, 0]));
  for (let s = 1; s <= 4; s++) {
    const res = state.history[s];
    for (const m of MARKET_IDS) {
      for (const id of res.seatList[m]) seats[id]++;
      bidsPerMarketSeason.push(state.tables.ww_bids.filter(b => b.season === s && b.market === m).length);
    }
  }
  // bid share uses the cash the team started that season with: reconstruct from ww_bids capped amounts relative to profit is messy, so use the
  // bid's capped amount over the team's cash at season start, taken from the season log (start cash + cumulative profit before s).
  const cumProfit = {};
  for (const id of state.order) cumProfit[id] = { 1: startCash[id] };
  for (let s = 1; s <= 4; s++) for (const id of state.order) {
    const p = state.history[s].teams[id];
    cumProfit[id][s + 1] = p && typeof p.cashEnd === 'number' ? p.cashEnd : (p && typeof p.cash === 'number' ? p.cash : cumProfit[id][s]);
  }
  for (const b of state.tables.ww_bids) {
    const cash = cumProfit[b.team_id][b.season] || 20, amt = b.capped_to ?? b.amount;
    const share = amt / cash;
    const lvl = LEVELS.reduce((a, l) => (Math.abs(l - share) < Math.abs(a - share) ? l : a), LEVELS[0]);
    bidStats[lvl].n++; if (b.won) { bidStats[lvl].won++; wonShares.push(share); }
    bidders.add(seed + '|' + b.team_id);
  }
  for (const id of state.order) {
    const t = state.teams[id], profit = t.cash - t.startCash, kind = t.house ? 'house' : overrides[id] ? 'random' : 'human';
    profits[kind].push(profit);
    const strat = t.house ? 'house:' + t.personality : overrides[id] ? 'random' : bots[id].strategy;
    (byStrat[strat] = byStrat[strat] || []).push(profit);
    seatHist[seats[id]] = (seatHist[seats[id]] || 0) + 1;
    teamsN++; seatsTotal += seats[id]; if (!seats[id]) zero++;
    if (bidders.has(seed + '|' + id)) { bidderZero.n++; if (!seats[id]) bidderZero.zero++; }
    if (kind === 'random') { randomWins.n++; if (seats[id]) randomWins.any++; }
  }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log('== ' + SEEDS + ' seeds, ' + TEAMS + ' teams (' + HOUSE + ' house) ==');
console.log('win rate by bid level (share of cash; 0.01 = minimum):');
for (const l of LEVELS) console.log('  ' + (l * 100).toFixed(1).padStart(4) + '%  n=' + String(bidStats[l].n).padStart(6) + '  won ' + (bidStats[l].n ? (100 * bidStats[l].won / bidStats[l].n).toFixed(0) : '-') + '%');
console.log('bids per market-season: mean ' + mean(bidsPerMarketSeason).toFixed(1) + ', p90 ' + q(bidsPerMarketSeason, 0.9));
console.log('seats won per team over the game: ' + Object.keys(seatHist).sort((a, b) => a - b).map(k => k + ':' + (100 * seatHist[k] / teamsN).toFixed(0) + '%').join('  ') + '   (mean ' + (seatsTotal / teamsN).toFixed(2) + ')');
console.log('teams with zero seats: ' + (100 * zero / teamsN).toFixed(0) + '% of all; ' + (100 * bidderZero.zero / bidderZero.n).toFixed(0) + '% of teams that bid at least once; random human-like teams with 1+ seat: ' + (100 * randomWins.any / randomWins.n).toFixed(0) + '%');
console.log('winning bid as share of cash: p25 ' + (100 * q(wonShares, 0.25)).toFixed(1) + '%  median ' + (100 * q(wonShares, 0.5)).toFixed(1) + '%  p75 ' + (100 * q(wonShares, 0.75)).toFixed(1) + '%');
for (const k of Object.keys(profits)) if (profits[k].length) console.log('profit ' + k.padEnd(6) + ' p10 ' + q(profits[k], 0.1).toFixed(1) + '  median ' + q(profits[k], 0.5).toFixed(1) + '  p90 ' + q(profits[k], 0.9).toFixed(1) + '  share losing money ' + (100 * profits[k].filter(x => x < 0).length / profits[k].length).toFixed(0) + '%');
console.log('mean profit by strategy:');
for (const [k, v] of Object.entries(byStrat).sort((a, b) => mean(b[1]) - mean(a[1]))) console.log('  ' + k.padEnd(14) + mean(v).toFixed(2) + '  (n=' + v.length + ')');
