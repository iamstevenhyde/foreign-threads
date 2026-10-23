// Hidden tastes must not reach anything a team can read: the repo's config, the pages' import graph, the rows the host writes to the store
// (Supabase in live mode), the snapshots and every team view. Run: node --test engine/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKETS, MARKET_IDS } from '../config/markets.js';
import { TILES, ROWS, TILE_PHRASE } from '../config/tiles.js';
import { EVENTS, renderEvent } from '../config/events.js';
import { CLUE_CARDS, clueText } from '../config/clues.js';
import { drawTastes, seededInt, codeFromTastes, tastesFromCode } from '../config/taste.js';
import { REFERENCE_TASTES } from './reference_tastes.mjs';
import { createGame, beginSeason, teamView, publicConfig, attachTastes } from './core.mjs';

const G = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- the host in Node: a localStorage shim stands in for the browser, LocalStore for the store the host writes to ----
const mem = new Map();
globalThis.localStorage = { get length() { return mem.size; }, key: i => [...mem.keys()][i] ?? null, getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
globalThis.window = { addEventListener() {} };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const t = realSetInterval(...a); if (t && t.unref) t.unref(); return t; };
const { LocalStore } = await import('../pages/store.js');
const { Host } = await import('../pages/host.js');

const stored = () => [...mem.entries()].filter(([k]) => k.startsWith('wwl:'));        // everything the host ever wrote to the store
const walk = (v, f, p = '') => { f(v, p); if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, f, p + '/' + k); };

test('config/markets.js carries no taste, and the pages team members load never import the reference table or the host', () => {
  for (const m of MARKET_IDS) assert.equal(MARKETS[m].taste, undefined, m);
  const seen = new Set();
  const crawl = f => {
    f = path.resolve(f);
    if (seen.has(f) || !fs.existsSync(f)) return;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.html')) { for (const m of src.matchAll(/(?:src|href)="([^"]+\.(?:js|mjs))"/g)) crawl(path.resolve(path.dirname(f), m[1])); return; }
    for (const m of src.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) crawl(path.resolve(path.dirname(f), m[1]));
  };
  for (const page of ['team.html', 'projector.html']) crawl(path.join(G, 'pages', page));
  const names = [...seen].map(f => path.relative(G, f).replace(/\\/g, '/'));
  assert.ok(names.includes('engine/core.mjs') || names.includes('pages/team.js'), 'crawl found the team page modules: ' + names.join(', '));
  for (const bad of ['engine/reference_tastes.mjs', 'pages/host.js', 'pages/admin.js', 'config/taste.js']) assert.ok(!names.includes(bad), bad + ' must not be loaded by a team-facing page');
});

test('static text in the repo names no tile: clue cards are filled from the draw, and so are the news cards that reveal a row', () => {
  // phrases ("a small logo") and the tile words that only mean a tile; generic words like "small crowd" are fine
  const phrases = ROWS.flatMap(r => Object.values(TILE_PHRASE[r]));
  const words = ['denim', 'hoodie', 'puffer', 'shell', 'earth', 'black', 'bright', 'pastel', 'recycled', 'performance', 'allover', 'all-over'];
  const hit = text => [...phrases, ...words].filter(w => new RegExp('\b' + w + '\b', 'i').test(text));
  for (const e of EVENTS) {
    const h = hit([e.headline, e.standfirst, e.body, e.rule].join(' '));
    assert.deepEqual(h, [], e.id + ' static text names tile word(s) ' + h.join(', '));
  }
  assert.equal(CLUE_CARDS.length, 16);
  assert.ok(CLUE_CARDS.every(c => c.text === undefined), 'clue cards hold no tile text');
});

test('a draw is a restore code and back, avoids the old fixed table, and fills the clue and news text', () => {
  const t = drawTastes(seededInt(11), [REFERENCE_TASTES]);
  assert.deepEqual(tastesFromCode(codeFromTastes(t)), t);
  for (const m of MARKET_IDS) assert.notDeepEqual(t[m], REFERENCE_TASTES[m], m);
  assert.throws(() => tastesFromCode('0000-0001'), /restore code/);
  const ev01 = EVENTS.find(e => e.id === 'EV01'), r = renderEvent(ev01, t);
  assert.ok(r.body.includes(TILE_PHRASE.logo[t.tokyo.logo]), 'EV01 names the drawn Tokyo logo tile');
  assert.ok(clueText('tokyo', 'cut', t.tokyo.cut).includes(TILE_PHRASE.cut[t.tokyo.cut]));
});

test('team-facing state carries no tastes: views, public config, the saved state and everything the host wrote to the store', async () => {
  mem.clear();
  const store = new LocalStore();
  const host = await Host.create(store, { teams: 2, house: 2, seed: 4242, botFill: true });
  const secret = host.tastes, code = host.restoreCode;
  assert.ok(secret && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code));
  for (const m of MARKET_IDS) assert.notDeepEqual(secret[m], REFERENCE_TASTES[m], 'a live room never repeats the old fixed table');

  const scan = label => {
    for (const [k, v] of stored()) {
      assert.ok(!v.includes(code) && !v.includes(code.replace('-', '')), label + ': restore code written to ' + k);
      walk(JSON.parse(v), (x, p) => { const key = p.split('/').pop(); assert.ok(!['taste', 'tastes', 'secret'].includes(key), label + ': key "' + key + '" at ' + k + p); });
    }
    const snap = stored().filter(([k]) => k.includes('|state|'));
    for (const [, v] of snap) {
      const st = JSON.parse(v).data.state;
      for (const m of MARKET_IDS) assert.equal(st.cfg.MARKETS[m].taste, undefined, label + ': saved state cfg carries a taste');
    }
    // a team's saved view lists only the rows that team has been shown
    for (const [k, v] of stored().filter(([k]) => k.includes('|view|'))) {
      const view = JSON.parse(v).data.view;
      for (const m of MARKET_IDS) for (const rec of Object.values(view.known[m])) assert.ok(['start', 'season', 'partner', 'clue', 'research'].includes(rec.source), label + ': ' + k + ' holds a row with no reveal source in ' + m);
      assert.equal(view.cfg, undefined);
      assert.ok(!('secret' in view) && !('tastes' in view));
    }
  };

  await host.start();
  scan('after start');
  // every live team view straight from the engine
  for (const id of host.state.order) {
    const view = teamView(host.state, id);
    walk(view, (x, p) => assert.ok(!['taste', 'tastes', 'secret'].includes(p.split('/').pop()), 'view ' + id + p));
    for (const m of MARKET_IDS) for (const rec of Object.values(view.known[m])) assert.ok(['start', 'season', 'partner', 'clue', 'research'].includes(rec.source), id + ' row without a reveal source in ' + m);
    assert.ok(MARKET_IDS.some(m => Object.keys(view.known[m]).length < 4), id + ' still has hidden rows after the opening');
  }
  walk(publicConfig(host.state.cfg), (x, p) => assert.ok(!['taste', 'tastes', 'secret'].includes(p.split('/').pop()), 'publicConfig' + p));
  assert.equal(JSON.stringify(host.state).includes(code), false);
  assert.equal(Object.keys(host.state).includes('secret'), false, 'state.secret is not enumerable');

  await host.autoPlay();
  scan('after four seasons');

  // a second laptop: loads the saved room from the store and cannot play on until the code is typed
  const other = new Host(store);
  mem.delete('ft:tastes:' + host.gid);
  await other.load(host.gid);
  assert.equal(other.needsCode, true);
  assert.throws(() => other.restore('ZZZZ-ZZZZ'));
  other.restore(code);
  assert.deepEqual(other.tastes, secret);
  assert.deepEqual(other.state.secret.tastes, secret, 'the saved state picks the draw back up');
});

test('a game reloaded from JSON without its tastes refuses to run, and attachTastes restores it', () => {
  const t = drawTastes(seededInt(3));
  const s = createGame({ seed: 5, teams: [{ id: 'A', brandId: 'dunn' }, { id: 'B', brandId: 'rank' }], tastes: t });
  const copy = JSON.parse(JSON.stringify(s));
  assert.equal(copy.secret, undefined);
  assert.throws(() => beginSeason(copy), /tastes/);
  attachTastes(copy, t);
  assert.doesNotThrow(() => beginSeason(copy));
});
