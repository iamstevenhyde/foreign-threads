// node config/validate.mjs : loads every config module and checks the cross-references. Exits 1 on any failure.
import { MARKETS, MARKET_IDS, startVisible } from './markets.js';
import { TILES, ROWS, GARMENT_FILES, tileIds } from './tiles.js';
import { BRANDS, dnaState } from './brands.js';
import * as R from './rules.js';
import { CLUE_CARDS, clueText } from './clues.js';
import { TILE_PHRASE } from './tiles.js';
import { drawTastes, seededInt, codeFromTastes, tastesFromCode } from './taste.js';
import { tileLabel } from './tiles.js';

let bad = 0;
const fail = m => { bad++; console.log('FAIL ' + m); };
const ok = (c, m) => { if (!c) fail(m); };

for (const id of MARKET_IDS) {
  const m = MARKETS[id];
  ok(Math.abs(ROWS.reduce((s, r) => s + m.weights[r], 0) - 1) < 1e-9, id + ' weights sum to 1');
  ok(m.taste === undefined, id + ' carries no taste (tastes are drawn per room, config/taste.js)');
  ok(m.revealOrder.length === 4 && new Set(m.revealOrder).size === 4, id + ' revealOrder is a permutation');
  ok(m.taxBySeason.length === R.SEASONS, id + ' tax has one number per season');
  ok(startVisible(id) === 4 - m.distance, id + ' start visible');
  ok(R.POOLS[id] > 0, id + ' has a pool');
  ok(Object.keys(R.PRICES).every(p => m.priceFit[p] > 0), id + ' priceFit covers every tier');
  ok(m.rules.modes.length > 0, id + ' has an entry mode');
}
ok(MARKETS.nairobi.rules.research === false && MARKETS.nairobi.rules.court === false, 'Nairobi has no research and no court');
ok(MARKETS.saopaulo.rules.dutyShipped > 0 && MARKETS.saopaulo.rules.paymentLagSeasons > 0, 'Sao Paulo has duty and late payment');
ok(MARKETS.berlin.rules.suitOnCopy && MARKETS.tokyo.rules.suitOnCopy, 'Berlin and Tokyo sue on copying');

ok(BRANDS.length >= 20 && new Set(BRANDS.map(b => b.id)).size === BRANDS.length, 'at least twenty distinct brands (20-team rooms, 10/27)');
ok(R.seatsFor(8) === 1 && R.seatsFor(10) === 1 && R.seatsFor(12) === 2 && R.seatsFor(20) === 2, 'partner seats per market scale with the room');
for (const b of BRANDS) {
  ok(b.free.length === 2 && b.costly, b.id + ' has two free tiles and one costly tile');
  for (const x of [...b.free, b.costly]) ok(tileIds(x.row).includes(x.tile), b.id + ' tile exists: ' + x.row + '/' + x.tile);
  ok(new Set([...b.free, b.costly].map(x => x.row + '/' + x.tile)).size === 3, b.id + ' three distinct tiles');
  ok(dnaState(b.id, b.free[0].row, b.free[0].tile) === 'free' && dnaState(b.id, b.costly.row, b.costly.tile) === 'costly', b.id + ' dnaState');
}
ok(GARMENT_FILES.length === 20, '20 garment files');
ok(Object.values(TILES).every(a => a.length >= 4), 'every row has at least four tiles');
ok(R.RUNS.sizes.every(s => R.RUNS.unitCost[s] > 0), 'unit cost for every run size');
ok(R.DESIGN.extraFee.length === R.DESIGN.maxPerSeason && R.DESIGN.unitCostMultiplier.length === R.DESIGN.maxPerSeason, 'design curves match maxPerSeason');

// Clue cards: one per (market, row), each names its market and row, is marked draft, and reads for every possible tile.
ok(CLUE_CARDS.length === MARKET_IDS.length * ROWS.length, 'one clue card per market row');
ok(new Set(CLUE_CARDS.map(c => c.market + '/' + c.row)).size === CLUE_CARDS.length, 'clue cards are unique per market row');
for (const c of CLUE_CARDS) {
  const m = MARKETS[c.market];
  ok(m && ROWS.includes(c.row), c.id + ' names a real market and row');
  if (!m || !ROWS.includes(c.row)) continue;
  ok(c.draft === true, c.id + ' is draft text');
  ok(tileIds(c.row).every(t => TILE_PHRASE[c.row][t] && clueText(c.market, c.row, t).length > 0), c.id + ' reads for every tile of its row');
}
// Taste draws: the restore code round-trips and rejects a mistyped character.
for (let k = 1; k <= 200; k++) {
  const t = drawTastes(seededInt(k)), c = codeFromTastes(t);
  ok(JSON.stringify(tastesFromCode(c)) === JSON.stringify(t), 'restore code round-trips (draw ' + k + ')');
}
{
  const c = codeFromTastes(drawTastes(seededInt(7))).replace('-', '');
  let threw = false;
  try { tastesFromCode(c.slice(0, 3) + (c[3] === '2' ? '3' : '2') + c.slice(4)); } catch (e) { threw = true; }
  ok(threw, 'a mistyped restore code is refused');
}
// House block: three personalities, order only names real ones, counts sane.
ok(R.HOUSE && R.HOUSE.defaultCount <= R.HOUSE.maxCount, 'house counts');
ok(R.HOUSE.order.length >= R.HOUSE.maxCount && R.HOUSE.order.every(p => R.HOUSE.personalities[p]), 'house order names real personalities');
for (const [k, p] of Object.entries(R.HOUSE.personalities)) {
  ok(R.RUNS.sizes.includes(p.run) && p.bidShare >= 0 && p.bidShare <= R.BUDGET.partnerBidCap + 1e-9, 'house ' + k + ' run and bidShare');
  ok(typeof p.why === 'string' && p.why.length > 0, 'house ' + k + ' has a why line');
}
ok(R.CLUES && R.CLUES.perTeamPerSeason >= 0, 'clue deal rule');

console.log(bad ? bad + ' failure(s)' : 'config OK: ' + MARKET_IDS.length + ' markets, ' + BRANDS.length + ' brands, ' + GARMENT_FILES.length + ' garment files');
process.exit(bad ? 1 : 0);
