import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, standings, resolveSeason, exportTables } from './core.mjs';
import { game, season, row, plan, line, lock, PERFECT, beginSeason as beginSeasonOnly } from './testkit.mjs';
import { playGame } from './run_bots.mjs';
import * as R from '../config/rules.js';
import * as MK from '../config/markets.js';
const CAP = R.BUDGET.partnerBidCap * 20;     // a team starts with $20M

test('sealed bids: capped at the cash share in config, losers refunded in full, the winner pays its own capped bid', () => {
  const s = game([['A', 'dunn'], ['B', 'rank'], ['C', 'ritz']]);
  const bid = (amount) => lock(plan([], { berlin: { mode: 'none', bid: amount } }));
  season(s, { A: bid(10), B: bid(1), C: bid(1) });
  const bids = s.tables.ww_bids;
  const a = bids.find(b => b.team_id === 'A');
  assert.equal(a.amount, 10);
  assert.ok(Math.abs(a.capped_to - CAP) < 1e-9);       // bidCap x 20
  assert.equal(a.won, true);
  assert.equal(bids.find(b => b.team_id === 'B').capped_to, null);
  assert.ok(Math.abs(s.teams.A.cash - (20 - CAP)) < 1e-9);   // paid its own capped bid
  assert.equal(s.teams.B.cash, 20);                  // refunded in full
  assert.equal(s.teams.C.cash, 20);
  assert.ok(Math.abs(row(s, 1, 'A', 'berlin').seat_paid - CAP) < 1e-9);
  assert.equal(row(s, 1, 'B', 'berlin').seat_paid, 0);
});

test('a tie on the bid is broken by the seeded draw: same seed, same winner', () => {
  const run = seed => {
    const s = game([['A', 'dunn'], ['B', 'rank']], { seed });
    season(s, { A: lock(plan([], { tokyo: { mode: 'none', bid: 2 } })), B: lock(plan([], { tokyo: { mode: 'none', bid: 2 } })) });
    return s.tables.ww_bids.find(b => b.won).team_id;
  };
  assert.equal(run(5), run(5));
  const winners = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(run));
  assert.equal(winners.size, 2, 'across seeds both teams win sometimes');
});

test('a bid under the minimum is rejected at lock; a partner line without a bid is rejected', () => {
  const s = game([['A', 'dunn']]);
  beginSeasonOnly(s);
  assert.equal(validatePlan(s, 'A', plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 0.1 }) })).ok, false);
  assert.equal(validatePlan(s, 'A', plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 0 }) })).ok, false);
  assert.equal(validatePlan(s, 'A', plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 2 }) })).ok, true);
});

test('a losing partner bid falls back to what the plan said, and the Nairobi loser can go Own or sit out', () => {
  const s = game([['A', 'dunn'], ['B', 'rank'], ['C', 'ritz']]);
  const D1 = PERFECT.nairobi;
  season(s, {
    A: lock(plan([D1], { nairobi: line('D1', { mode: 'partner', bid: 5, run: 25 }) })),
    B: lock(plan([D1], { nairobi: line('D1', { mode: 'partner', bid: 1, run: 25, fallback: 'own' }) })),
    C: lock(plan([D1], { nairobi: line('D1', { mode: 'partner', bid: 1, run: 25, fallback: 'none' }) })),
  });
  assert.equal(row(s, 1, 'A', 'nairobi').mode, 'partner');
  assert.equal(row(s, 1, 'B', 'nairobi').mode, 'own');
  assert.equal(row(s, 1, 'B', 'nairobi').setup_paid, R.MODES.own.setup);
  assert.equal(row(s, 1, 'C', 'nairobi').mode, 'none');
});

test('Nairobi has no Ship, no research firm', () => {
  const s = game([['A', 'dunn']]);
  beginSeasonOnly(s);
  const v = validatePlan(s, 'A', plan([PERFECT.nairobi], { nairobi: line('D1', { mode: 'ship' }) }));
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /ship is not open in Nairobi/);
  const r = validatePlan(s, 'A', plan([PERFECT.nairobi], { nairobi: line('D1', { mode: 'own' }) }, { research: ['nairobi'] }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /no research firm in Nairobi/);
  assert.equal(validatePlan(s, 'A', plan([PERFECT.berlin], { berlin: line('D1') }, { research: ['berlin'] })).ok, true);
});

test('Sao Paulo: 35% duty on shipped goods, revenue arrives a season late (an owned shop is paid at once)', () => {
  const s = game([['A', 'dunn'], ['B', 'rank']]);
  const D1 = PERFECT.saopaulo;
  const subs = { A: lock(plan([D1], { saopaulo: line('D1', { mode: 'ship', run: 25 }) })), B: lock(plan([D1], { saopaulo: line('D1', { mode: 'own', run: 25 }) })) };
  season(s, subs);
  const a = row(s, 1, 'A', 'saopaulo'), b = row(s, 1, 'B', 'saopaulo');
  assert.ok(a.duty_paid > 0 && b.duty_paid === 0, 'duty on shipped goods only');
  const unitBase = R.RUNS.unitCost[25] * 1.0;                 // run 25, one design, standard price
  assert.ok(Math.abs(a.duty_paid - MK.MARKETS.saopaulo.rules.dutyShipped * unitBase * 25 / 1000) < 1e-6);
  // A: cash fell by production + duty and no revenue yet; the revenue sits as a receivable due next season
  assert.ok(a.revenue > 0);
  const production = a.unit_cost * 25 / 1000;
  const dna = s.tables.ww_designs.find(d => d.team_id === 'A').dna_cost;
  assert.ok(Math.abs(s.teams.A.cash - (20 - dna - production - a.duty_paid)) < 1e-4);
  assert.equal(s.teams.A.receivables.length, 1);
  assert.equal(s.teams.A.receivables[0].due, 2);
  // B owns the shop: revenue in the same season (setup 4, ramp, but paid at once)
  assert.equal(s.teams.B.receivables.length, 0);
  const dnaB = s.tables.ww_designs.find(d => d.team_id === 'B').dna_cost;
  assert.ok(Math.abs(s.teams.B.cash - (20 - dnaB - b.payload.production - R.MODES.own.setup + b.revenue)) < 1e-4);
  // season two: A plays nothing and the money still arrives
  const before = s.teams.A.cash;
  season(s, { A: lock(plan([], {})), B: lock(plan([], {})) });
  assert.ok(Math.abs(s.teams.A.cash - (before + a.revenue)) < 1e-4, 'the season-one revenue lands in season two');
  assert.equal(s.teams.A.receivables.length, 0);
});

test('Sao Paulo: revenue unpaid at the end of season 4 is paid at the haircut', () => {
  const s = game([['A', 'dunn']]);
  const p = lock(plan([PERFECT.saopaulo], { saopaulo: line('D1', { mode: 'ship', run: 25 }) }));
  for (let i = 1; i <= 4; i++) season(s, { A: p });
  const r4 = row(s, 4, 'A', 'saopaulo');
  assert.ok(s.history[4].teams.A.writeOff > 0);
  assert.ok(Math.abs(s.history[4].teams.A.writeOff - 0.2 * r4.revenue) < 1e-4);
});

test('last plan stood: a team that never locks keeps its previous plan and the log says so', () => {
  const s = game([['A', 'dunn'], ['B', 'rank']]);
  const p = lock(plan([PERFECT.berlin], { berlin: line('D1', { run: 25 }) }), 'ship it');
  season(s, { A: p, B: p });
  season(s, { A: { plan: plan([], {}), locked: false }, B: p });   // A saved something empty but never locked
  const dec = s.tables.ww_decisions.filter(d => d.team_id === 'A');
  assert.equal(dec[0].stood, false);
  assert.equal(dec[1].stood, true);
  assert.equal(dec[1].plan.markets.berlin.run, 25);
  assert.equal(row(s, 2, 'A', 'berlin').mode, 'ship');
  assert.ok(s.tables.ww_log.some(l => l.type === 'plan' && l.team_id === 'A' && l.round === 2 && l.payload.stood && /last plan stood/i.test(l.text)));
  // the engine never orders an action: a team with no earlier plan simply sits out
  const t = game([['A', 'dunn']]);
  season(t, {});
  assert.equal(t.tables.ww_seasons.filter(r => r.mode !== 'none').length, 0);
  assert.equal(t.tables.ww_decisions[0].stood, false);
});

test('house teams: counted in every market split, never in the prize ranking', () => {
  const s = game([['A', 'dunn'], ['H', 'rank', true]]);
  const p = lock(plan([PERFECT.berlin], { berlin: line('D1', { run: 100 }) }));
  const res = season(s, { A: p, H: p });
  assert.equal(res.markets.berlin.crowd, 2);
  assert.equal(res.markets.berlin.lines.find(l => l.team === 'H').house, true);
  const st = standings(s);
  assert.deepEqual(st.ranked.map(r => r.team), ['A']);
  assert.deepEqual(st.house.map(r => r.team), ['H']);
  // the house team shifts A's share: A alone would sell more
  const solo = game([['A', 'dunn']]);
  const r2 = season(solo, { A: p });
  assert.ok(res.markets.berlin.lines.find(l => l.team === 'A').buyers <= r2.markets.berlin.lines[0].buyers);
  // house teams never copy or take a carry (the engine rejects such a plan)
  const t = game([['H', 'rank', true]]);
  beginSeasonOnly(t);
  assert.equal(validatePlan(t, 'H', plan([PERFECT.berlin], { berlin: line('D1') }, { copy: [{ from_team: 'A', design: 'D1' }] })).ok, false);
  assert.equal(validatePlan(t, 'H', plan([PERFECT.berlin], { berlin: line('D1') }, { accept: [{ deal_id: 'x' }] })).ok, false);
});

test('a seed reproduces a whole game exactly; a different seed does not', () => {
  const a = playGame({ seed: 11, teams: 6, house: 2, seasons: 4, quiet: true }).state;
  const b = playGame({ seed: 11, teams: 6, house: 2, seasons: 4, quiet: true }).state;
  const c = playGame({ seed: 12, teams: 6, house: 2, seasons: 4, quiet: true }).state;
  assert.equal(JSON.stringify(exportTables(a)), JSON.stringify(exportTables(b)));
  assert.notEqual(JSON.stringify(exportTables(a)), JSON.stringify(exportTables(c)));
});

test('money adds up: final profit = market profits - design costs - the final haircut', () => {
  const { state } = playGame({ seed: 3, teams: 6, house: 2, seasons: 4, quiet: true });
  const st = standings(state);
  for (const r of [...st.ranked, ...st.house]) {
    const profit = state.tables.ww_seasons.filter(x => x.team_id === r.team).reduce((a, x) => a + x.profit, 0);
    const designs = state.tables.ww_designs.filter(x => x.team_id === r.team).reduce((a, x) => a + x.fee + x.dna_cost, 0);
    const writeOff = state.history[4].teams[r.team].writeOff;
    assert.ok(Math.abs(r.profit - (profit - designs - writeOff)) < 1e-3, r.team + ' ' + r.profit + ' vs ' + (profit - designs - writeOff));
  }
});

test('street knock-off (Nairobi): a design over the threshold loses fit next season', () => {
  const s = game([['A', 'dunn']]);
  const p = lock(plan([PERFECT.nairobi], { nairobi: line('D1', { mode: 'own', run: 100 }) }));
  season(s, { A: p }, cfg => { cfg.COPY.streetThreshold = 0.01; });
  assert.ok(s.tables.ww_log.some(l => l.type === 'street' && l.payload.phase === 'triggered'));
  season(s, { A: p }, cfg => { cfg.COPY.streetThreshold = 0.01; });
  assert.equal(row(s, 1, 'A', 'nairobi').fit, 1);
  assert.equal(row(s, 2, 'A', 'nairobi').fit, 0.8);
  assert.ok(s.tables.ww_log.some(l => l.type === 'street' && l.payload.phase === 'applied'));
});

test('event cards: the effect applies for the one season it is drawn', () => {
  const s = game([['A', 'dunn']]);
  s.deck = { 1: ['EV06'], 2: [], 3: [], 4: [] };           // Sao Paulo duty 40% -> 55%
  const p = lock(plan([PERFECT.saopaulo], { saopaulo: line('D1', { mode: 'ship', run: 25 }) }));
  resolveAfterBegin(s, p);
  resolveAfterBegin(s, p);
  assert.ok(Math.abs(row(s, 1, 'A', 'saopaulo').duty_paid - 0.55 * R.RUNS.unitCost[25] * 25 / 1000) < 1e-6);
  assert.ok(Math.abs(row(s, 2, 'A', 'saopaulo').duty_paid - MK.MARKETS.saopaulo.rules.dutyShipped * R.RUNS.unitCost[25] * 25 / 1000) < 1e-6, 'the card reverts after its season');
  assert.ok(s.tables.ww_log.some(l => l.type === 'event' && l.payload.card === 'EV06'));
});
function resolveAfterBegin(s, p) { beginSeasonOnly(s); return resolveSeason(s, { A: p }); }
