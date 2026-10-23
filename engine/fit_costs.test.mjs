import test from 'node:test';
import * as R from '../config/rules.js';
import * as MK from '../config/markets.js';
import assert from 'node:assert/strict';
import { MARKETS } from '../config/markets.js';
import { REFERENCE_TASTES } from './reference_tastes.mjs';
import { fitOf, designDna, costPlan, publicConfig, validatePlan } from './core.mjs';
import { game, season, row, plan, line, lock, D, PERFECT, beginSeason } from './testkit.mjs';

test('fit is the sum of the matched hidden taste weights', () => {
  const b = MARKETS.berlin;
  assert.equal(fitOf(b, PERFECT.berlin, REFERENCE_TASTES.berlin), 1);
  assert.equal(fitOf(b, D('shell', 'black', 'big', 'heavy'), REFERENCE_TASTES.berlin), 0.45);                  // cut 0.15 + palette 0.30
  assert.equal(fitOf(b, D('puffer', 'pastel', 'big', 'heavy'), REFERENCE_TASTES.berlin), 0);
  assert.equal(fitOf(b, D('puffer', 'pastel', 'none', 'recycled'), REFERENCE_TASTES.berlin), 0.55);            // logo 0.15 + fabric 0.40
  assert.ok(Math.abs(fitOf(MARKETS.tokyo, PERFECT.tokyo, REFERENCE_TASTES.tokyo) - 1) < 1e-9);
});

test('brand DNA: two free tiles cost nothing, the costly tile and any other tile cost the config surcharge', () => {
  // Dunn: free logo big and fabric heavy, costly palette pastel
  const S = R.DESIGN.dnaSurcharge, near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(designDna('dunn', D('puffer', 'black', 'big', 'heavy')), S.other + S.other));
  assert.ok(near(designDna('dunn', D('puffer', 'pastel', 'big', 'heavy')), S.other + S.costly));
  assert.ok(near(designDna('dunn', D('puffer', 'earth', 'big', 'heavy')), S.other + S.other));
});

test('extra designs cost a fee and raise unit cost', () => {
  const s = game([['A', 'dunn']]);
  const a = D('shell', 'black', 'none', 'recycled', 'D1'), b = D('denim', 'earth', 'small', 'light', 'D2');
  const one = plan([a], { berlin: line('D1', { run: 50 }) });
  const two = plan([a, b], { berlin: line('D1', { run: 50 }), tokyo: line('D2', { run: 50 }) });
  beginSeason(s);
  const pub = publicConfig(s.cfg), ctx = { brandId: 'dunn', cash: 20, active: {}, owned: {} };
  assert.equal(costPlan(pub, ctx, one).fees, 0);
  assert.equal(costPlan(pub, ctx, two).fees, R.DESIGN.extraFee[1]);
  const c1 = costPlan(pub, ctx, one).by.berlin.primary, c2 = costPlan(pub, ctx, two).by.berlin.primary;
  assert.ok(Math.abs(c2.unitBase / c1.unitBase - R.DESIGN.unitCostMultiplier[1]) < 1e-9, 'second design multiplies unit cost by the config multiplier');
});

test('the log carries the design fee, DNA cost, designs_this_season and unit_cost', () => {
  const s = game([['A', 'dunn']]);
  season(s, { A: lock(plan([D('shell', 'black', 'none', 'recycled', 'D1'), D('denim', 'earth', 'small', 'light', 'D2')], { berlin: line('D1'), tokyo: line('D2') })) });
  const d = s.tables.ww_designs.filter(x => x.team_id === 'A');
  assert.equal(d.length, 2);
  assert.deepEqual(d.map(x => x.fee), [0, R.DESIGN.extraFee[1]]);
  assert.ok(d.every(x => x.designs_this_season === 2 && x.unit_cost > 0));
  assert.ok(d.every(x => x.dna_cost > 0));
  assert.ok(d.every(x => x.cut && x.palette && x.logo && x.fabric));
});

test('a plan that needs more cash than the team holds is rejected, not trimmed', () => {
  const s = game([['A', 'dunn']]);
  beginSeason(s);
  const big = plan([PERFECT.berlin, { ...PERFECT.tokyo, id: 'D2' }, { ...PERFECT.saopaulo, id: 'D3' }],
    { berlin: line('D1', { run: 100, mode: 'own', price: 'premium' }), tokyo: line('D2', { run: 100, mode: 'own', price: 'premium' }), saopaulo: line('D3', { run: 100, mode: 'own', price: 'premium' }) });
  const v = validatePlan(s, 'A', big);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /needs \$/);
});

test('the foreignness tax falls by season sold and is recorded per team per season', () => {
  const s = game([['A', 'dunn']]);
  const p = lock(plan([PERFECT.berlin], { berlin: line('D1', { run: 25 }) }));
  for (let i = 1; i <= 3; i++) season(s, { A: p });
  const rates = [1, 2, 3].map(i => row(s, i, 'A', 'berlin').tax_rate);
  assert.deepEqual(rates, MK.MARKETS.berlin.taxBySeason.slice(0, 3));
  assert.ok([1, 2, 3].every(i => row(s, i, 'A', 'berlin').tax_paid > 0));
});

test('fog: one taste row is revealed per season sold, and tiles_known is logged', () => {
  const s = game([['A', 'dunn']]);
  const p = lock(plan([PERFECT.nairobi], { nairobi: line('D1', { mode: 'own', run: 25 }) }));
  season(s, { A: p });
  season(s, { A: p });
  assert.equal(row(s, 1, 'A', 'nairobi').tiles_known, 1);   // Nairobi is distance 3, so one row at the start
  assert.equal(row(s, 2, 'A', 'nairobi').tiles_known, 2);
  assert.equal(row(s, 1, 'A', 'berlin').tiles_known, 3);
  const fog = s.tables.ww_log.filter(x => x.type === 'fog' && x.market === 'nairobi' && x.payload.source === 'season');
  assert.equal(fog.length, 2);
  assert.equal(fog[0].payload.row, 'logo');                  // Nairobi reveal order is fabric, logo, cut, palette; fabric is the start row
});
