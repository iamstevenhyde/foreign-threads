// 10/27: rooms of 8, 12 and 20 teams, the fifth market (Mexico City) and the interactive practice bid. Run: node --test engine/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../config/rules.js';
import * as MK from '../config/markets.js';
import { BRANDS } from '../config/brands.js';
import { CLUE_CARDS } from '../config/clues.js';
import { practiceResult, PRACTICE, practiceCap } from '../config/example.js';
import { playGame } from './run_bots.mjs';
import { D, line, plan, lock, game, season, row } from './testkit.mjs';
import { createGame } from './core.mjs';
import { REFERENCE_TASTES } from './reference_tastes.mjs';

const mem = new Map();
globalThis.localStorage = { get length() { return mem.size; }, key: i => [...mem.keys()][i] ?? null, getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
globalThis.window = { addEventListener() {} };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const t = realSetInterval(...a); if (t && t.unref) t.unref(); return t; };
const { LocalStore } = await import('../pages/store.js');
const { Host } = await import('../pages/host.js');

for (const [n, house] of [[8, 2], [12, 4], [20, 10]]) {
  test('a room of ' + n + ' teams (' + house + ' house) plays four seasons; seats per market and pool scale follow the room size', () => {
    const K = R.seatsFor(n), k = R.poolScale(n);
    assert.equal(K, n <= 8 ? 1 : 2);
    for (const seed of [1, 2, 3]) {
      const { state } = playGame({ seed, teams: n, house, seasons: 4, quiet: true });
      assert.equal(state.order.length, n);
      assert.equal(state.seatsPerMarket, K);
      assert.equal(state.poolScale, k);
      for (let s = 1; s <= 4; s++) {
        const res = state.history[s];
        for (const m of MK.MARKET_IDS) {
          const holders = res.seatList[m], bids = state.tables.ww_bids.filter(b => b.season === s && b.market === m);
          assert.ok(holders.length <= K, m + ' at most ' + K + ' seats');
          assert.equal(res.seats[m], holders[0] || null, 'seats[m] is the top bidder');
          assert.equal(new Set(holders).size, holders.length);
          // every winner pays its own capped bid, every loser pays nothing for the seat
          for (const b of bids) {
            const r = row(state, s, b.team_id, m), amt = b.capped_to ?? b.amount;
            assert.equal(b.won, holders.includes(b.team_id));
            assert.ok(Math.abs(r.seat_paid - (b.won ? amt : 0)) < 1e-6, 'seat paid for ' + b.team_id);
          }
          // the winners are the highest valid bids
          const valid = bids.filter(b => (b.capped_to ?? b.amount) >= R.BUDGET.minPartnerBid - 1e-9);
          const lowestWin = Math.min(...valid.filter(b => b.won).map(b => b.capped_to ?? b.amount));
          for (const b of valid.filter(x => !x.won)) assert.ok((b.capped_to ?? b.amount) <= lowestWin + 1e-9, 'a losing bid is never above a winning one');
          if (valid.length >= K) assert.equal(holders.length, K, 'every seat is filled when enough valid bids came in');
        }
      }
    }
  });
}

test('pools scale with the room: unchanged up to 8 teams, about x2.6 at 20', () => {
  assert.equal(R.poolScale(2), 1); assert.equal(R.poolScale(8), 1);
  assert.ok(R.poolScale(20) > 2.5 && R.poolScale(20) < 2.7);
  const st = createGame({ seed: 1, teams: BRANDS.slice(0, 20).map((b, i) => ({ id: 'T' + (i + 1), brandId: b.id })), tastes: REFERENCE_TASTES });
  assert.equal(st.seatsPerMarket, 2);
  const big = game(BRANDS.slice(0, 20).map((b, i) => ['T' + (i + 1), b.id]));
  const res = season(big, {});
  for (const m of MK.MARKET_IDS) assert.ok(Math.abs(res.markets[m].pool - R.POOLS[m] * R.poolScale(20)) < 1e-4, m + ' pool scaled');
  const small = game();
  const r2 = season(small, {});
  for (const m of MK.MARKET_IDS) assert.equal(r2.markets[m].pool, R.POOLS[m], m + ' pool unchanged in a 2-team room');
});

test('twenty brands, all distinct, and a host can open a room of 10 human plus 10 house teams', async () => {
  assert.equal(BRANDS.length, 20);
  assert.ok(R.HOUSE.maxCount >= 10 && R.HOUSE.order.length >= R.HOUSE.maxCount);
  mem.clear();
  const host = await Host.create(new LocalStore(), { teams: 10, house: 10, seed: 99 });
  assert.equal(host.teams.length, 20);
  assert.equal(host.teams.filter(t => t.house).length, 10);
  assert.equal(new Set(host.teams.map(t => t.brand_id)).size, 20);
  await assert.rejects(() => Host.create(new LocalStore(), { teams: 11, house: 10, seed: 98 }), /at most 20 teams/);
});

test('Mexico City: the near market. Ship is open with no duty and a ship bonus, copies are not sued, research exists, clue cards cover it', () => {
  const m = MK.MARKETS.cdmx;
  assert.equal(MK.MARKET_IDS.length, 5);
  assert.equal(m.distance, 1); assert.equal(MK.startVisible('cdmx'), 3);
  assert.ok(m.rules.modes.includes('ship') && m.rules.dutyShipped === 0 && m.shipReachBonus > 0);
  assert.equal(m.rules.suitOnCopy, false); assert.equal(m.rules.court, true); assert.equal(m.rules.research, true);
  assert.ok(R.POOLS.cdmx > 0);
  assert.equal(CLUE_CARDS.filter(c => c.market === 'cdmx').length, 4);
  // a perfect fit shipped in sells and pays no duty
  const st = game();
  const perfect = D(REFERENCE_TASTES.cdmx.cut, REFERENCE_TASTES.cdmx.palette, REFERENCE_TASTES.cdmx.logo, REFERENCE_TASTES.cdmx.fabric);
  season(st, { A: lock(plan([perfect], { cdmx: line('D1', { run: 50 }) })) });
  const r = row(st, 1, 'A', 'cdmx');
  assert.equal(r.mode, 'ship'); assert.equal(r.duty_paid, 0); assert.equal(r.fit, 1); assert.ok(r.buyers > 0);
});

test('two seats in a big room: the two highest bids each win and pay their own bid, the third is refunded and falls back', () => {
  const ids = BRANDS.slice(0, 14).map((b, i) => ['T' + (i + 1), b.id]);
  const st = game(ids);
  assert.equal(st.seatsPerMarket, 2);
  const P = D('shell', 'black', 'none', 'recycled');
  const subs = {
    T1: lock(plan([P], { berlin: line('D1', { mode: 'partner', bid: 1.5 }) })),
    T2: lock(plan([P], { berlin: line('D1', { mode: 'partner', bid: 1.0 }) })),
    T3: lock(plan([P], { berlin: line('D1', { mode: 'partner', bid: 0.9, fallback: 'ship' }) })),
  };
  const res = season(st, subs);
  assert.deepEqual(res.seatList.berlin, ['T1', 'T2']);
  assert.equal(row(st, 1, 'T1', 'berlin').seat_paid, 1.5);
  assert.equal(row(st, 1, 'T2', 'berlin').seat_paid, 1.0);
  assert.equal(row(st, 1, 'T2', 'berlin').mode, 'partner');
  assert.equal(row(st, 1, 'T3', 'berlin').seat_paid, 0);
  assert.equal(row(st, 1, 'T3', 'berlin').mode, 'ship');
  // both seat holders learn a taste row from the partner
  const pTokyo = D('denim', 'earth', 'small', 'light');
  const st2 = game(ids);
  season(st2, { T1: lock(plan([pTokyo], { tokyo: line('D1', { mode: 'partner', bid: 1.5 }) })), T2: lock(plan([pTokyo], { tokyo: line('D1', { mode: 'partner', bid: 1.0 }) })) });
  for (const id of ['T1', 'T2']) assert.ok(Object.values(st2.teams[id].known.tokyo).some(k => k.source === 'partner'), id + ' learned a row from its partner');
});

test('practice bid: the real cap and minimum, a default that plays when nothing is typed, win or lose against made-up rivals', () => {
  assert.equal(practiceCap(), R.BUDGET.partnerBidCap * R.BUDGET.startCash);
  const big = 20, small = 8;
  const d = practiceResult(null, big);
  assert.equal(d.entered, false); assert.equal(d.amount, PRACTICE.defaultBid); assert.ok(d.valid);
  assert.equal(d.seats, 2);
  assert.equal(practiceResult(0.1, big).valid, false, 'under the minimum is thrown out');
  assert.equal(practiceResult(0.1, big).won, false);
  const capped = practiceResult(5, big);
  assert.ok(capped.wasCapped && capped.capped === practiceCap() && capped.won && capped.paid === practiceCap());
  // two seats: beat the second-highest rival; one seat: beat the highest
  const second = PRACTICE.rivals.map(r => r.bid).sort((a, b) => b - a)[1], first = PRACTICE.rivals.map(r => r.bid).sort((a, b) => b - a)[0];
  assert.equal(practiceResult(second, big).won, false, 'a tie loses in the practice');
  assert.equal(practiceResult(second + 0.1, big).won, true);
  assert.equal(practiceResult(second + 0.1, small).won, false, 'one seat in a small room');
  assert.equal(practiceResult(first + 0.1, small).won, true);
  const lost = practiceResult(R.BUDGET.minPartnerBid, big);
  assert.equal(lost.won, false); assert.equal(lost.refunded, R.BUDGET.minPartnerBid); assert.equal(lost.paid, 0);
  assert.ok(PRACTICE.defaultBid >= R.BUDGET.minPartnerBid && PRACTICE.defaultBid <= practiceCap());
});

test('student-facing text added on 10/27 carries no em-dash', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  for (const f of ['pages/example.js', 'pages/team.js', 'pages/proj.js', 'config/example.js', 'config/markets.js', 'config/brands.js']) {
    assert.ok(!fs.readFileSync(path.join(root, f), 'utf8').includes('—'), f);
  }
});

test('default fallback: a partner line that never touches the fallback ships in when its bid loses, except in Nairobi where Ship is closed', () => {
  assert.equal(R.defaultFallback(MK.MARKETS.berlin.rules.modes), 'ship');
  assert.equal(R.defaultFallback(MK.MARKETS.cdmx.rules.modes), 'ship');
  assert.equal(R.defaultFallback(MK.MARKETS.nairobi.rules.modes), 'none');
  assert.equal(R.defaultFallback(undefined), 'none');
  const ids = BRANDS.slice(0, 10).map((b, i) => ['T' + (i + 1), b.id]);
  const P = D('shell', 'black', 'none', 'recycled');
  const st = game(ids);
  const fb = m => R.defaultFallback(MK.MARKETS[m].rules.modes);
  const subs = {};
  ids.forEach(([id], i) => { subs[id] = lock(plan([P], {
    berlin: line('D1', { mode: 'partner', bid: 1.5 - i * 0.1, fallback: fb('berlin') }),
    nairobi: line('D1', { mode: 'partner', bid: 1.5 - i * 0.1, fallback: fb('nairobi') }) })); });
  season(st, subs);
  assert.equal(st.seatsPerMarket, 2, 'ten teams get two seats now');
  assert.equal(row(st, 1, 'T3', 'berlin').seat_paid, 0);
  assert.equal(row(st, 1, 'T3', 'berlin').mode, 'ship', 'lost the Berlin seat, shipped by default');
  assert.equal(row(st, 1, 'T3', 'nairobi').mode, 'none', 'lost the Nairobi seat, no Ship there, sits out');
});

test('one-number lobby: total teams, students claim slots, Start turns every unclaimed slot into a house team; seats follow the total', async () => {
  assert.ok(R.HOUSE.maxCount >= 19 && R.HOUSE.order.length >= R.HOUSE.maxCount);
  for (const [total, humans, seats] of [[20, 10, 2], [20, 6, 2], [20, 20, 2], [8, 3, 1], [9, 2, 2]]) {
    mem.clear();
    const store = new LocalStore();
    const host = await Host.create(store, { teams: total, house: 0, fillHouse: true, seed: 5 });
    assert.equal(host.teams.length, total); assert.equal(host.teams.filter(t => t.house).length, 0, 'every slot is open in the lobby');
    for (let i = 1; i <= humans; i++) await store.upsertSeat({ id: 'S' + i, game_id: host.gid, team_id: 'T' + i, name: 'p' + i, slot: 0, removed: false });
    await host.start();
    assert.equal(host.state.order.length, total);
    assert.equal(host.state.seatsPerMarket, seats, total + ' teams give ' + seats + ' seats per city');
    const houses = host.teams.filter(t => t.house);
    assert.equal(houses.length, total - humans, 'unclaimed slots became house teams');
    assert.ok(houses.every(t => t.personality && R.HOUSE.personalities[t.personality]));
    assert.ok(host.teams.filter(t => !t.house).every(t => Number(t.team_id.slice(1)) <= humans), 'claimed slots stay human');
    assert.deepEqual(host.meta.humans.length, humans); assert.equal(host.meta.dropped.length, 0);
    assert.equal(host.game.house_count, total - humans);
  }
  // bot-fill (testing) still wins over house fill: unclaimed slots become ranked bots
  mem.clear();
  const store = new LocalStore();
  const host = await Host.create(store, { teams: 6, house: 0, fillHouse: true, botFill: true, seed: 6 });
  await store.upsertSeat({ id: 'S1', game_id: host.gid, team_id: 'T1', name: 'p', slot: 0, removed: false });
  await host.start();
  assert.equal(host.teams.filter(t => t.house).length, 0); assert.equal(Object.values(host.meta.bots).filter(b => !b.house).length, 5);
  // the old two-number create still works, and an unclaimed slot is dropped as before
  mem.clear();
  const old = await Host.create(new LocalStore(), { teams: 3, house: 2, seed: 7 });
  await old.store.upsertSeat({ id: 'S1', game_id: old.gid, team_id: 'T1', name: 'p', slot: 0, removed: false });
  await old.start();
  assert.equal(old.meta.dropped.length, 2);
});
