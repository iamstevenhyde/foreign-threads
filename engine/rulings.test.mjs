// Steven's 10/26 rulings: the reveal shows WINNERS ONLY; weights and reveal order are PUBLIC (the taste tile stays hidden); percent shares on the
// reveal; a worked-example round before season 1 that says the winning bid is PAID. Run: node --test engine/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTastes, seededInt, codeFromTastes } from '../config/taste.js';
import { D, line, plan, lock } from './testkit.mjs';
import { MARKETS, MARKET_IDS } from '../config/markets.js';
import { publicConfig } from './core.mjs';
import { buildExample, EXAMPLE_STEPS } from '../config/example.js';
import { stepKey, gamePlan } from '../pages/clock.js';
import { CLOCK } from '../config/rules.js';

const mem = new Map();
globalThis.localStorage = { get length() { return mem.size; }, key: i => [...mem.keys()][i] ?? null, getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
globalThis.window = { addEventListener() {} };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const t = realSetInterval(...a); if (t && t.unref) t.unref(); return t; };
const { LocalStore } = await import('../pages/store.js');
const { Host } = await import('../pages/host.js');
const CODE = codeFromTastes(drawTastes(seededInt(11)));

async function room() {
  mem.clear();
  const store = new LocalStore();
  const host = await Host.create(store, { teams: 3, house: 2, seed: 9 });
  host.restore(CODE);
  for (const i of [1, 2, 3]) await store.upsertSeat({ id: 'S' + i, game_id: host.gid, team_id: 'T' + i, name: 'p' + i, slot: 1, removed: false });
  return { store, host };
}

test('weights and reveal order are public in the team config, and still no taste', async () => {
  const { host } = await room();
  await host.start(); await host.skipExample();
  const pub = publicConfig(host.state.cfg);
  for (const m of MARKET_IDS) {
    assert.deepEqual(pub.markets[m].weights, MARKETS[m].weights);
    assert.deepEqual(pub.markets[m].revealOrder, MARKETS[m].revealOrder);
    assert.equal(pub.markets[m].startVisible, 4 - MARKETS[m].distance);
  }
  assert.ok(!JSON.stringify(pub).includes('"taste"'));
  const view = JSON.parse(JSON.stringify((await host.store.getSnapshots(host.gid, { kind: 'view', round: 1, teamId: 'T1' }))[0].data.view));
  assert.equal(view.pub.markets.berlin.weights.fabric, MARKETS.berlin.weights.fabric, 'the team view carries the weights');
  const hidden = MARKET_IDS.flatMap(m => ['cut', 'palette', 'logo', 'fabric'].filter(r => !view.known[m][r]));
  assert.ok(hidden.length > 0, 'some rows are still hidden, so the weights are shown without the tiles');
  assert.ok(!/"tastes?":/.test(JSON.stringify(view.pub)), 'no taste key anywhere in the public rules');
});

test('the reveal shows winners only: non-winning sellers carry brand, mode and share but no design, tiles or price', async () => {
  const { store, host } = await room();
  await host.start(); await host.skipExample();
  const d = (cut, pal) => D(cut, pal, 'small', 'heavy', 'D1');
  await store.patchDecision(host.gid, 'T1', 1, { ...lock(plan([d('hoodie', 'earth')], { tokyo: line('D1'), saopaulo: line('D1') })) });
  await store.patchDecision(host.gid, 'T2', 1, { ...lock(plan([d('shell', 'black')], { tokyo: line('D1'), saopaulo: line('D1') })) });
  await store.patchDecision(host.gid, 'T3', 1, { ...lock(plan([d('denim', 'pastel')], { tokyo: line('D1'), saopaulo: line('D1') })) });
  await host.advance();
  const rev = (await store.getSnapshots(host.gid, { kind: 'reveal', round: 1 }))[0].data;
  let nonWin = 0;
  for (const m of MARKET_IDS) {
    const wins = rev.markets[m].lines.filter(l => l.win);
    assert.ok(wins.length <= 1, m + ': at most one winner');
    for (const l of rev.markets[m].lines) {
      assert.equal(typeof l.share, 'number', 'every seller keeps a share for the percent bars');
      if (l.win) { assert.ok(l.tiles && l.design); assert.ok(rev.winners.some(w => w.market === m && w.team === l.team && w.design === l.design)); }
      else { nonWin++; assert.equal(l.tiles, undefined); assert.equal(l.design, undefined); assert.equal(l.price, undefined); }
    }
  }
  assert.ok(nonWin > 0, 'the room had losing sellers to check');
  const lookTeams = Object.keys(rev.looks);
  for (const t of lookTeams) for (const dsg of Object.keys(rev.looks[t])) {
    assert.ok(rev.winners.some(w => w.team === t && w.design === dsg), 'a look is published only for a winning piece');
  }
});

test('worked-example round: three clocked steps before season 1, no engine season, then season 1 opens', async () => {
  const { host } = await room();
  await host.start();
  assert.equal(host.game.phase, 'example');
  assert.equal(host.state.season, 0, 'the engine has not opened a season');
  const keys = [];
  while (host.game.phase === 'example') { keys.push(stepKey(host.game)); assert.equal(host.game.clock.step, stepKey(host.game)); await host.advance(); }
  assert.deepEqual(keys, ['example:0', 'example:1', 'example:2']);
  assert.equal(EXAMPLE_STEPS, 3);
  assert.equal(host.game.phase, 'decide'); assert.equal(host.game.round, 1);
  assert.equal(Object.values(host.state.teams).every(t => t.cash === 20), true, 'the practice round moved no cash');
});

test('worked example: the winning bid is paid, the loser is refunded, shares are whole percents adding to 100', () => {
  const ex = buildExample();
  assert.equal(ex.seat.winner.id, 'birch'); assert.equal(ex.seat.paid, 0.6); assert.equal(ex.seat.refunded, 0.4);
  assert.equal(ex.shares.reduce((a, s) => a + s.pct, 0), 100);
  assert.equal(ex.topKey, 'birch');
  assert.ok(ex.shares.every(s => Number.isInteger(s.pct)));
});

test('the game block is longer: practice round plus a minute on season 1', () => {
  const p = gamePlan(CLOCK, 4, 1);
  assert.equal(p.steps.filter(s => s.season === 0).length, 3);
  assert.equal(p.total, 2325);
});

test('every page script parses as a module (a stray quote once left the projector on "Loading...")', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), cp = await import('node:child_process');
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'pages');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ftchk-'));
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const t = path.join(tmp, f.replace(/\.js$/, '.mjs'));
    fs.copyFileSync(path.join(dir, f), t);
    cp.execFileSync(process.execPath, ['--check', t], { stdio: 'pipe' });
  }
});
