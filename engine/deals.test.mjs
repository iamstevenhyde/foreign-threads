import test from 'node:test';
import * as R from '../config/rules.js';
import assert from 'node:assert/strict';
import { makeOffers, resolveSeason, beginSeason } from './core.mjs';
import { game, season, row, plan, line, lock, PERFECT } from './testkit.mjs';

// Season 1: A wins the Berlin seat (and is the only seller there, so its design is the public winner).
function seasonOne(extra = []) {
  const s = game([['A', 'dunn'], ['B', 'rank'], ...extra]);
  const subs = {
    A: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 3, run: 25 }) })),
    B: lock(plan([PERFECT.tokyo], { tokyo: line('D1', { run: 25 }) })),
  };
  season(s, subs);
  return s;
}

test('carry: an offer made after the reveal applies to the NEXT season only', () => {
  const s = seasonOne();
  assert.equal(s.history[1].seats.berlin, 'A');
  const res = makeOffers(s, { B: [{ market: 'berlin', design: { id: 'D1', ...PERFECT.berlin } }] });
  assert.equal(res[0].ok, true);
  const deal = s.tables.ww_deals[0];
  assert.equal(deal.season, 2);                    // applies next season
  assert.equal(deal.made_in_season, 1);
  assert.equal(deal.status, 'offered');
  assert.equal(s.tables.ww_seasons.filter(r => r.season === 1 && r.mode === 'carried').length, 0, 'nothing carried in season one');
  // season two: B plays carried, A accepts and wins the seat again
  const plans = {
    A: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 1, run: 25 }) }, { accept: [{ deal_id: deal.deal_id }] })),
    B: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'carried', run: 25 }) })),
  };
  season(s, plans);
  const b = row(s, 2, 'B', 'berlin'), a = row(s, 2, 'A', 'berlin');
  assert.equal(b.mode, 'carried');
  assert.ok(b.partner_fee >= R.CARRY.fee, 'the carried team pays the carry fee plus the holder share');
  assert.ok(Math.abs(a.partner_income - b.partner_fee) < 1e-9, 'the holder receives what the carried team paid');
  assert.equal(s.tables.ww_deals[0].status, 'accepted');
  assert.equal(s.tables.ww_deals[0].holder_saw_design, true);
});

test('carry: offers cannot be made before the reveal, and a carry cannot start in the season it was offered', () => {
  const s = game([['A', 'dunn'], ['B', 'rank']]);
  beginSeason(s);
  assert.throws(() => makeOffers(s, {}), /after the reveal/);
  resolveSeason(s, {});
  // a plan that says "carried" in season 1 with no deal falls back to nothing
  const t = game([['A', 'dunn'], ['B', 'rank']]);
  season(t, { B: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'carried', run: 25 }) })) });
  assert.equal(row(t, 1, 'B', 'berlin').mode, 'none');
});

test('carry: void if the holder loses the seat; one carry per holder per market per season; house teams never accept', () => {
  const s = seasonOne([['C', 'ritz']]);
  makeOffers(s, {
    B: [{ market: 'berlin', design: { id: 'D1', ...PERFECT.berlin } }],
    C: [{ market: 'berlin', design: { id: 'D1', ...PERFECT.berlin } }],
  });
  const ids = s.tables.ww_deals.map(d => d.deal_id);
  assert.equal(ids.length, 2);
  // A accepts both; only the first becomes active
  season(s, {
    A: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 1, run: 25 }) }, { accept: ids.map(deal_id => ({ deal_id })) })),
    B: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'carried', run: 25 }) })),
    C: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'carried', run: 25 }) })),
  });
  const st = s.tables.ww_deals.map(d => d.status).sort();
  assert.deepEqual(st, ['accepted', 'declined']);
  // void when the holder loses the seat
  const t = seasonOne();
  makeOffers(t, { B: [{ market: 'berlin', design: { id: 'D1', ...PERFECT.berlin } }] });
  const id = t.tables.ww_deals[0].deal_id;
  season(t, {
    A: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'ship', run: 25 }) }, { accept: [{ deal_id: id }] })),   // A no longer bids
    B: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'carried', run: 25 }) })),
  });
  assert.equal(t.tables.ww_deals[0].status, 'void');
  assert.equal(row(t, 2, 'B', 'berlin').partner_fee, 0, 'no fee is paid on a void deal');
  // house holder: the offer is refused outright
  const h = game([['A', 'dunn', true], ['B', 'rank']]);
  season(h, { A: lock(plan([PERFECT.berlin], { berlin: line('D1', { mode: 'partner', bid: 3, run: 25 }) })) });
  const r = makeOffers(h, { B: [{ market: 'berlin', design: { id: 'D1', ...PERFECT.berlin } }] });
  assert.equal(r[0].ok, false);
  assert.match(r[0].error, /house teams never accept/);
});

test('copy + suit: copying a shown design in Berlin costs the suit fine, paid to the original; Sao Paulo does not sue', () => {
  const s = seasonOne();
  // B copies A's season-one Berlin winner and sells it in Berlin and Sao Paulo
  const cashA = s.teams.A.cash, cashB = s.teams.B.cash;
  const p = plan([], { berlin: line('X1', { run: 25 }), saopaulo: line('X1', { run: 25 }) }, { copy: [{ id: 'X1', from_team: 'A', design: 'D1', season: 1 }] });
  season(s, { A: lock(plan([], {})), B: lock(p) });
  const rb = row(s, 2, 'B', 'berlin'), rs = row(s, 2, 'B', 'saopaulo'), ra = row(s, 2, 'A', 'berlin');
  assert.equal(rb.suit_paid, R.COPY.suitFine);
  assert.equal(ra.suit_received, R.COPY.suitFine);
  assert.equal(rs.suit_paid, 0);
  const suits = s.tables.ww_log.filter(l => l.type === 'suit');
  assert.equal(suits.length, 1);
  assert.equal(suits[0].payload.fine, R.COPY.suitFine);
  assert.equal(suits[0].payload.owner, 'A');
  assert.equal(s.tables.ww_log.filter(l => l.type === 'copy').length, 2, 'one copy log per market sold');
  assert.ok(s.teams.A.cash >= cashA + R.COPY.suitFine - 1e-6, 'A received the fine');
  assert.ok(s.teams.B.cash < cashB);
  const d = s.tables.ww_designs.find(x => x.team_id === 'B' && x.season === 2);
  assert.equal(d.is_copy, true);
  assert.equal(d.copied_from_team, 'A');
  assert.equal(d.fee, 0);
});

test('copy: a design that was not shown in a reveal cannot be copied', () => {
  const s = seasonOne();
  // A's Tokyo design was never sold; B's own Tokyo winner is shown, A's is not
  const p = plan([], { berlin: line('X1', { run: 25 }) }, { copy: [{ id: 'X1', from_team: 'A', design: 'D9', season: 1 }] });
  season(s, { A: lock(plan([], {})), B: lock(p) });
  assert.equal(row(s, 2, 'B', 'berlin').mode, 'none');
  assert.ok(s.tables.ww_log.some(l => l.type === 'copy' && l.payload.rejected));
});

test('the holder sees a carried design and can copy it only under an active deal', () => {
  const s = seasonOne();
  makeOffers(s, { B: [{ market: 'berlin', design: { ...PERFECT.berlin, id: 'D7' } }] });
  const id = s.tables.ww_deals[0].deal_id;
  season(s, {
    A: lock(plan([], { berlin: line('X1', { mode: 'partner', bid: 1, run: 25 }) }, { accept: [{ deal_id: id }], copy: [{ id: 'X1', from_team: 'B', design: 'D7', season: 2 }] })),
    B: lock(plan([{ ...PERFECT.berlin, id: 'D7' }], { berlin: line('D7', { mode: 'carried', run: 25 }) })),
  });
  assert.equal(row(s, 2, 'A', 'berlin').payload.copy, true);
  assert.equal(s.tables.ww_deals[0].copied, true);
  assert.equal(s.tables.ww_deals[0].copy_season, 2);
});
