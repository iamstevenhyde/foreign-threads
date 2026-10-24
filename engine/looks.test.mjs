// The 10/24 redesign: garments are drawn in code with a cosmetic "look" (piece name, trim, pattern, logo artwork) and a per-team brand style.
// These tests pin down that the cosmetic layer never touches scoring and leaks nothing: the reveal snapshot carries looks only for pieces that
// sold, a copy carries the original's look plus copyOf, the round-0 style rows do not disturb the host, and adding looks to a plan changes no
// engine number. Run: node --test engine/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTastes, seededInt, codeFromTastes } from '../config/taste.js';
import { D, line, plan, lock, game, season } from './testkit.mjs';
import { cleanLook, cleanStyle, garmentSVG, DEFAULT_STYLE } from '../pages/garment.js';
import { BRANDS } from '../config/brands.js';

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
  const host = await Host.create(store, { teams: 2, house: 1, seed: 7 });
  host.restore(CODE);
  for (const i of [1, 2]) await store.upsertSeat({ id: 'S' + i, game_id: host.gid, team_id: 'T' + i, name: 'p' + i, slot: 1, removed: false });
  return { store, host };
}
const withLook = (d, look) => ({ ...d, look });
async function toRecap(host) { while (!(host.game.phase === 'reveal' && host.game.reveal.idx === 4)) await host.advance(); }

test('looks: the reveal carries the look of every piece that sold, nothing for unsold pieces, and no tastes', async () => {
  const { store, host } = await room();
  await store.patchDecision(host.gid, 'T1', 0, { plan: { style: { mark: 'wave', colour: '#13808a' } } });   // a brand style row (round 0)
  await host.start();
  const sold = withLook(D('shell', 'bright', 'big', 'performance', 'D1'), { name: 'Tokyo Storm', trim: 'cobalt', pattern: 'stripe', art: 'both' });
  const unsold = withLook(D('resort', 'pastel', 'small', 'light', 'D2'), { name: 'Secret Piece', trim: 'pink', pattern: 'check', art: 'word' });
  await store.patchDecision(host.gid, 'T1', 1, { ...lock(plan([sold, unsold], { berlin: line('D1'), saopaulo: line('D1') })) });
  await store.patchDecision(host.gid, 'T2', 1, { ...lock(plan([D('hoodie', 'earth', 'small', 'heavy')], { tokyo: line('D1'), saopaulo: line('D1') })) });
  await host.advance();                                   // resolve
  const rev = (await store.getSnapshots(host.gid, { kind: 'reveal', round: 1 }))[0].data;
  assert.equal(rev.looks.T1.D1.name, 'Tokyo Storm');
  assert.equal(rev.looks.T1.D1.pattern, 'stripe');
  assert.equal(rev.looks.T1.D2, undefined, 'an unsold design is never revealed, not even its name');
  assert.ok(!JSON.stringify(rev).includes('Secret Piece'));
  assert.equal(rev.looks.T2, undefined, 'a design saved without a look gets none; the pages draw the default (Earth Hoodie)');
  assert.equal(cleanLook(null, { cut: 'hoodie', palette: 'earth' }).name, 'Earth Hoodie');
  const house = host.state.order.find(id => host.state.teams[id].house);
  assert.equal(rev.looks[house], undefined, 'house plans carry no look; the pages draw a default');
  for (const m of Object.keys(host.tastes)) assert.ok(!JSON.stringify(rev).includes(JSON.stringify(host.tastes[m])), 'no taste in the reveal');
});

test('looks: a copy shows the original look and names the brand it copied', async () => {
  const { store, host } = await room();
  await host.start();
  const a = withLook(D('shell', 'bright', 'big', 'performance', 'D1'), { name: 'Tokyo Storm', trim: 'cobalt', pattern: 'stripe', art: 'both' });
  await store.patchDecision(host.gid, 'T1', 1, { ...lock(plan([a], { berlin: line('D1'), tokyo: line('D1'), saopaulo: line('D1'), nairobi: line('D1', { mode: 'own' }) })) });
  await store.patchDecision(host.gid, 'T2', 1, { ...lock(plan([D('hoodie', 'earth', 'small', 'heavy')], { tokyo: line('D1', { run: 10 }) })) });
  await toRecap(host);
  await host.advance();                                   // season 2 opens
  const w = host.state.publicWinners.find(x => x.season === 1 && x.team !== 'T2');
  assert.ok(w, 'someone other than T2 won a market in season 1');
  await store.patchDecision(host.gid, 'T2', 2, { ...lock(plan([D('hoodie', 'earth', 'small', 'heavy')], { saopaulo: line('X1') }, { copy: [{ id: 'X1', from_team: w.team, design: w.design, season: 1, market: w.market }] })) });
  await store.patchDecision(host.gid, 'T1', 2, { ...lock(plan([a], { berlin: line('D1') })) });
  await host.advance();
  const rev = (await store.getSnapshots(host.gid, { kind: 'reveal', round: 2 }))[0].data;
  const lk = rev.looks.T2 && rev.looks.T2.X1;
  assert.ok(lk, 'the copied piece sold in Sao Paulo and has a look');
  assert.equal(lk.copyOf, w.team);
  if (w.team === 'T1') assert.equal(lk.name, 'Tokyo Storm', 'the copy carries the original name');
});

test('looks: cosmetic fields change no engine number', () => {
  const run = withLooks => {
    const st = game();
    const d = D('hoodie', 'black', 'big', 'heavy');
    const p = plan([withLooks ? { ...d, look: { name: 'X', trim: 'red', pattern: 'check', art: 'word' } } : d], { berlin: line('D1'), tokyo: line('D1', { mode: 'partner', bid: 0.5 }) });
    const r = season(st, { A: lock(p), B: lock(plan([D('shell', 'earth', 'none', 'light')], { berlin: line('D1') })) });
    return JSON.stringify({ markets: r.markets, teams: r.teams, cash: st.teams.A.cash });
  };
  assert.equal(run(true), run(false));
});

test('looks: cleanLook and cleanStyle reject junk, every brand has a default style, and every tile combination draws', () => {
  assert.ok(cleanLook({ name: 'x'.repeat(60) }, { cut: 'hoodie', palette: 'earth' }).name.length <= 24, 'names are capped at 24 characters');
  const c = cleanLook({ name: '<script>', trim: 'nope', pattern: 'allover', art: 'none' }, { cut: 'resort', palette: 'pastel' });
  assert.ok(!c.name.includes('<'));
  assert.equal(c.trim, 'accent'); assert.equal(c.pattern, 'solid', 'no cosmetic all-over print: All-over print is a scored Logo tile'); assert.equal(c.art, 'mark', 'no artwork "none": No logo is a scored tile');
  assert.equal(cleanLook(null, { cut: 'denim', palette: 'black' }).name, 'Black Denim Jacket');
  assert.deepEqual(cleanStyle({ mark: 'zzz', colour: 'red' }, 'rank'), DEFAULT_STYLE.rank);
  for (const b of BRANDS) assert.ok(DEFAULT_STYLE[b.id], 'default style for ' + b.id);
  for (const cut of ['puffer', 'shell', 'hoodie', 'resort', 'denim']) for (const palette of ['earth', 'black', 'bright', 'pastel'])
    for (const logo of ['big', 'small', 'none', 'allover']) for (const fabric of ['heavy', 'light', 'performance', 'recycled']) {
      const s1 = garmentSVG({ cut, palette, logo, fabric }, { name: 'Kroes & Ribas \'Test\'', art: 'both', pattern: 'check' }, DEFAULT_STYLE.kroes, 'Kroes & Ribas');
      assert.ok(s1.startsWith('<svg') && s1.endsWith('</svg>') && !s1.includes('undefined') && !s1.includes('NaN'));
      assert.ok(!/& /.test(s1.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, '')), 'text is escaped');
    }
});
