// Rules added by the 10/23 balance retune: buyer tolerance (integration vs responsiveness), near-market ship reach, the no-court walk-away cut,
// price-tier unit cost, and a coarse bot-run regression so a later edit to config cannot quietly bring back the old balance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../config/rules.js';
import * as MK from '../config/markets.js';
import { effFit, publicConfig, costPlan } from './core.mjs';
import { game, season, row, plan, line, lock, PERFECT, D, beginSeason } from './testkit.mjs';
import { runBatch } from '../balance/metrics.mjs';

test('effective fit: tolerance lifts a poor fit toward 1, a perfect fit stays 1, and the raw fit shown to teams is unchanged', () => {
  const b = MK.MARKETS.berlin, t = MK.MARKETS.tokyo;
  assert.equal(effFit(b, 1), 1);
  assert.equal(effFit(t, 1), 1);
  assert.ok(effFit(b, 0.2) > effFit(t, 0.2), 'a global product is accepted in the low-pressure market');
  assert.ok(Math.abs(effFit({ tolerance: 0 }, 0.37) - 0.37) < 1e-12, 'no tolerance means fit counts as it is');
  assert.equal(effFit({}, 0.37), 0.37, 'a market with no tolerance field behaves as before');
});

test('low pressure for local responsiveness (Berlin) narrows the gap between a fitted and an unfitted design; high pressure (Tokyo) widens it', () => {
  const gap = (market, good, bad) => {
    const s = game([['A', 'dunn'], ['B', 'rank']]);
    season(s, { A: lock(plan([good], { [market]: line('D1', { run: 100 }) })), B: lock(plan([bad], { [market]: line('D1', { run: 100 }) })) });
    return row(s, 1, 'A', market).buyers / Math.max(row(s, 1, 'B', market).buyers, 1e-9);
  };
  const badBerlin = D('puffer', 'pastel', 'big', 'heavy'), badTokyo = D('puffer', 'pastel', 'big', 'heavy');
  const gBerlin = gap('berlin', PERFECT.berlin, badBerlin), gTokyo = gap('tokyo', PERFECT.tokyo, badTokyo);
  assert.ok(gTokyo > 3 * gBerlin, 'fit pays far more in Tokyo than in Berlin (' + gTokyo.toFixed(1) + ' vs ' + gBerlin.toFixed(1) + ')');
});

test('near-market ship reach: Berlin adds shipReachBonus to the Ship reach, Tokyo does not', () => {
  const ratio = market => {
    const s = game([['A', 'dunn'], ['B', 'rank']]);
    const d = D('puffer', 'pastel', 'big', 'heavy');       // same poor fit for both, so shares stay far below the run
    season(s, { A: lock(plan([d], { [market]: line('D1', { run: 100 }) })), B: lock(plan([d], { [market]: line('D1', { mode: 'partner', bid: 1, run: 100 }) })) });
    return row(s, 1, 'A', market).buyers / row(s, 1, 'B', market).buyers;
  };
  const exp = m => (R.SHARE.reach.ship + (MK.MARKETS[m].shipReachBonus || 0)) / R.SHARE.reach.partner;
  assert.ok(Math.abs(ratio('berlin') - exp('berlin')) < 0.02, 'Berlin ship to partner share ratio is ' + exp('berlin').toFixed(2));
  assert.ok(Math.abs(ratio('tokyo') - exp('tokyo')) < 0.02, 'Tokyo ship to partner share ratio is ' + exp('tokyo').toFixed(2));
  assert.ok(exp('berlin') > exp('tokyo'));
});

test('no court (Nairobi): a Partner line gives the local partner walkShare of its revenue; an Own line keeps it all', () => {
  const s = game([['A', 'dunn'], ['B', 'rank']]);
  season(s, {
    A: lock(plan([PERFECT.nairobi], { nairobi: line('D1', { mode: 'partner', bid: 1, run: 25 }) })),
    B: lock(plan([PERFECT.nairobi], { nairobi: line('D1', { mode: 'own', run: 25 }) })),
  });
  const a = row(s, 1, 'A', 'nairobi'), b = row(s, 1, 'B', 'nairobi');
  assert.equal(a.mode, 'partner');
  assert.ok(a.revenue > 0);
  assert.ok(Math.abs(a.partner_fee - MK.MARKETS.nairobi.rules.walkShare * a.revenue) < 1e-5, 'the leak is walkShare of revenue');
  assert.equal(b.partner_fee, 0);
  // the leak comes out of both profit and cash: cash = start - dna - production - seat + revenue - leak
  const dna = s.tables.ww_designs.find(d => d.team_id === 'A').dna_cost;
  assert.ok(Math.abs(s.teams.A.cash - (20 - dna - a.payload.production - a.seat_paid + a.revenue - a.partner_fee)) < 1e-4);
});

test('a Berlin Partner line has no walk-away cut (a court enforces the contract)', () => {
  const s = game([['A', 'dunn']]);
  season(s, { A: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 1, run: 25 }) })) });
  assert.equal(row(s, 1, 'A', 'berlin').partner_fee, 0);
});

test('price tier changes unit cost: premium costs TIER_COST.premium times standard, value costs TIER_COST.value times', () => {
  const s = game([['A', 'dunn']]);
  beginSeason(s);
  const pub = publicConfig(s.cfg), ctx = { brandId: 'dunn', cash: 20, active: {}, owned: {} };
  const unit = price => costPlan(pub, ctx, plan([PERFECT.berlin], { berlin: line('D1', { run: 50, price }) })).by.berlin.primary.unitBase;
  assert.ok(Math.abs(unit('premium') / unit('standard') - R.TIER_COST.premium) < 1e-9);
  assert.ok(Math.abs(unit('value') / unit('standard') - R.TIER_COST.value) < 1e-9);
});

test('the public rules carry the new fields the team page prints', () => {
  const s = game([['A', 'dunn']]);
  beginSeason(s);
  const pub = publicConfig(s.cfg);
  assert.equal(pub.markets.berlin.pressure, 'low');
  assert.equal(pub.markets.tokyo.pressure, 'high');
  assert.equal(pub.markets.berlin.tolerance, MK.MARKETS.berlin.tolerance);
  assert.equal(pub.markets.berlin.shipReachBonus, MK.MARKETS.berlin.shipReachBonus);
  assert.deepEqual(pub.TIER_COST, R.TIER_COST);
  assert.equal(pub.markets.nairobi.rules.walkShare, MK.MARKETS.nairobi.rules.walkShare);
});

test('the Berlin Ship reach bonus and tolerance are config, and Berlin is the low-pressure market while the other three are high', () => {
  assert.deepEqual(MK.MARKET_IDS.filter(m => MK.MARKETS[m].pressure === 'low'), ['berlin']);
  assert.deepEqual(MK.MARKET_IDS.filter(m => MK.MARKETS[m].pressure === 'high'), ['tokyo', 'saopaulo', 'nairobi']);
  assert.deepEqual(MK.MARKET_IDS.filter(m => MK.MARKETS[m].pressure === 'medium'), ['cdmx'], 'Mexico City (10/27) sits between');
  for (const m of MK.MARKET_IDS) { const p = MK.MARKETS[m].pressure, t = MK.MARKETS[m].tolerance; assert.ok(p === 'low' ? t >= 0.7 : p === 'medium' ? t > 0.3 && t < 0.7 : t <= 0.3, m); }
});

test('bot-run regression (20 seeds): adapting beats one design everywhere, seats and carries do not dominate, caps bind less than before', () => {
  const { out } = runBatch({ N: 20, FROM: 1, TEAMS: 6, HOUSE: 2 });
  const st = out.by_strategy_total;
  const oneDesign = Math.max(st.standardizer.mean_total_profit, st['house:steady'].mean_total_profit);
  assert.ok(st.adapter.mean_total_profit > oneDesign + 2, 'adapter ' + st.adapter.mean_total_profit.toFixed(1) + ' vs one design ' + oneDesign.toFixed(1));
  const g = out.adapter_vs_standardizer_groups;
  assert.ok(g.high.adapter > g.high.standardizer + 0.5, 'in the high-pressure markets adapting pays more per line');
  assert.ok(g.low.standardizer >= g.low.adapter - 0.3, 'in Berlin standardizing pays about as well as adapting');
  assert.ok(out.seat_wins.house_share <= 0.40, 'house share of seats ' + out.seat_wins.house_share.toFixed(2));
  assert.ok(out.carry_vs_bid.carried < out.carry_vs_bid.partner, 'a carry earns less than a won seat');
  assert.ok(out.capped_share < 0.5, 'share of lines that sell out ' + out.capped_share.toFixed(2));
  for (const m of ['ship', 'partner', 'own']) assert.ok((out.mode_win_share[m] || 0) < 0.55, m + ' wins too many market-seasons');
  assert.ok(out.team_profit_overall.all_mean > 0, 'the average team makes money');
});
