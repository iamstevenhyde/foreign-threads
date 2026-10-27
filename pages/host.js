// The host: runs the engine in the admin browser and publishes what teams and the projector may see.
// Teams never touch engine state. They read 'view' and 'result' snapshots and write only their own ww_decisions row.
// Clock (pages/clock.js): every step after Start has an endsAt in ww_games.clock, and tick() (called by the admin page twice a second) moves the
// game on when it runs out, so the host never has to press a button after Start. Pause, +30 s and Skip are optional overrides.
// Snapshots (ww_snapshots): kind 'state' round 0 (full engine state, so an admin reload resumes), 'view' per team per season (teamView at season open),
// 'public' per season (news + roster), 'reveal' per season (what the projector may show), 'result' per team per season (private results), 'final'.

import { createGame, attachTastes, beginSeason, teamView, resolveSeason, makeOffers, standings, exportTables, rand } from '../engine/core.mjs';
import { housePlan, strategyPlan, strategyOffers, STRATEGIES } from '../engine/bots.mjs';
import { BRANDS } from '../config/brands.js';
import { HOUSE, CLOCK, SEASONS } from '../config/rules.js';
import { MARKET_IDS } from '../config/markets.js';
import { makeCode, makeGameId } from './util.js';
import { drawTastes, secureInt, codeFromTastes, tastesFromCode } from '../config/taste.js';
import { REFERENCE_TASTES } from '../engine/reference_tastes.mjs';
import { stepKey, stepSeconds, newClock, isDue, pauseClock, resumeClock, addTime, earlyClock, restoreClock } from './clock.js';
import { cleanLook } from './garment.js';
import { EXAMPLE_STEPS } from '../config/example.js';

// The room's hidden tastes never go to the store (Supabase or local) and never into a snapshot. They live in this browser's localStorage under the
// room id, and the host writes down the short restore code (config/taste.js) so a cleared browser or a second laptop can pick the room up again.
const secretKey = gid => 'ft:tastes:' + gid;
const readSecret = gid => { try { const c = localStorage.getItem(secretKey(gid)); return c ? tastesFromCode(c) : null; } catch (e) { return null; } };
const writeSecret = (gid, tastes) => { try { localStorage.setItem(secretKey(gid), codeFromTastes(tastes)); } catch (e) { console.warn('could not keep the taste code in this browser', e); } };

const PUBLIC_EVENT_TYPES = new Set(['copy', 'suit', 'street']);

export class Host {
  constructor(store) { this.store = store; this.game = null; this.teams = []; this.state = null; this.meta = null; this.busy = false; this.tastes = null; this.now = () => Date.now(); this._advancing = false; }

  get needsCode() { return !this.tastes; }
  get restoreCode() { return this.tastes ? codeFromTastes(this.tastes) : ''; }
  // The host typed the restore code (new laptop or cleared browser).
  restore(code) {
    const tastes = tastesFromCode(code);
    this.tastes = tastes; writeSecret(this.gid, tastes);
    if (this.state) attachTastes(this.state, tastes);
  }

  get gid() { return this.game.id; }
  get season() { return this.state ? this.state.season : 0; }

  static async create(store, { teams = 6, house = 2, seed, botFill = false }) {
    const gid = makeGameId();
    seed = Number(seed) || (Math.floor(Math.random() * 900000) + 100);
    if (house > HOUSE.maxCount) throw new Error('at most ' + HOUSE.maxCount + ' house teams');
    if (teams + house > BRANDS.length) throw new Error('at most ' + BRANDS.length + ' teams in all');
    const tmp = { rng: (seed ^ 0x51ED270B) >>> 0 };
    const pool = BRANDS.map(b => b.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand(tmp) * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const codes = new Set();
    const code = () => { let c; do { c = makeCode(4); } while (codes.has(c)); codes.add(c); return c; };
    const rows = [];
    for (let i = 0; i < teams + house; i++) {
      const isHouse = i >= teams;
      rows.push({ game_id: gid, team_id: 'T' + (i + 1), name: BRANDS.find(b => b.id === pool[i]).name, brand_id: pool[i], join_code: code(), renamed: false,
        house: isHouse, personality: isHouse ? HOUSE.order[i - teams] : '' });
    }
    await store.createGame({ id: gid, seed, team_count: teams + house, bot_count: 0, house_count: house, phase: 'lobby', round: 0, clock: null, reveal: null, rev: 0,
      status: 'active', admin_key: makeCode(6), settings: { pool, botFill: !!botFill, aiTeams: rows.filter(r => r.house).map(r => r.team_id), seasons: SEASONS,
        autoAdvance: true, clockScale: 1, savedPlanRuns: CLOCK.savedPlanRunsAtZero !== false } });
    for (const r of rows) await store.upsertTeam(r);
    const host = new Host(store);
    await host.load(gid);
    host.tastes = drawTastes(secureInt, [REFERENCE_TASTES]);   // fresh per room, from the browser's crypto source; never sent anywhere
    writeSecret(gid, host.tastes);
    return host;
  }

  async load(gid) {
    this.game = await this.store.getGame(gid);
    if (!this.game) throw new Error('No game ' + gid);
    this.teams = await this.store.getTeams(gid);
    const snap = (await this.store.getSnapshots(gid, { kind: 'state' }))[0];
    if (snap) { this.state = snap.data.state; this.meta = snap.data.meta; } else { this.state = null; this.meta = null; }
    this.tastes = readSecret(gid);
    if (this.state && this.tastes) attachTastes(this.state, this.tastes);
    return this;
  }
  async refreshGame() { this.game = await this.store.getGame(this.gid); this.teams = await this.store.getTeams(this.gid); return this.game; }

  async _patch(patch) { this.game = await this.store.patchGame(this.gid, { ...patch, rev: (this.game.rev || 0) + 1 }); return this.game; }
  async _saveState() { await this.store.putSnapshot(this.gid, 0, 'state', '', { state: this.state, meta: this.meta }); }

  async addHouse() {
    await this.refreshGame();
    if (this.game.phase !== 'lobby') throw new Error('House teams can be added only in the lobby.');
    const nHouse = this.teams.filter(t => t.house).length, n = this.teams.length;
    if (nHouse >= HOUSE.maxCount) throw new Error('At most ' + HOUSE.maxCount + ' house teams.');
    const pool = this.game.settings.pool;
    if (n >= pool.length) throw new Error('All ' + pool.length + ' brands are in use.');
    const brand = BRANDS.find(b => b.id === pool[n]);
    const used = new Set(this.teams.map(t => t.join_code));
    let c; do { c = makeCode(4); } while (used.has(c));
    await this.store.upsertTeam({ game_id: this.gid, team_id: 'T' + (n + 1), name: brand.name, brand_id: brand.id, join_code: c, renamed: false, house: true, personality: HOUSE.order[nHouse] });
    await this._patch({ team_count: n + 1, house_count: nHouse + 1, settings: { ...this.game.settings, aiTeams: [...this.game.settings.aiTeams, 'T' + (n + 1)] } });
    await this.refreshGame();
  }

  async claimedTeams() {
    const seats = await this.store.getSeats(this.gid);
    const by = {};
    for (const s of seats) if (!s.removed) by[s.team_id] = (by[s.team_id] || 0) + 1;
    return by;
  }

  async start() {
    await this.refreshGame();
    if (this.game.phase !== 'lobby') throw new Error('The game has already started.');
    if (!this.tastes) throw new Error('This browser does not hold the room taste code. Enter the restore code first.');
    const claimed = await this.claimedTeams();
    const specs = [], bots = {}, humans = [], dropped = [], aiTeams = [];
    let k = 0;
    for (const t of this.teams) {
      if (t.house) { specs.push({ id: t.team_id, brandId: t.brand_id, house: true, personality: t.personality }); bots[t.team_id] = { id: t.team_id, strategy: null, personality: t.personality, house: true, mem: {} }; aiTeams.push(t.team_id); }
      else if (claimed[t.team_id]) { specs.push({ id: t.team_id, brandId: t.brand_id, house: false }); humans.push(t.team_id); }
      else if (this.game.settings.botFill) { const strategy = STRATEGIES[k++ % STRATEGIES.length]; specs.push({ id: t.team_id, brandId: t.brand_id, house: false, strategy }); bots[t.team_id] = { id: t.team_id, strategy, personality: null, house: false, mem: {} }; aiTeams.push(t.team_id); }
      else dropped.push(t.team_id);
    }
    if (specs.length < 2) throw new Error('Need at least two teams. Have students join, add house teams, or turn on bot fill.');
    this.state = createGame({ seed: this.game.seed, teams: specs, seasons: this.game.settings.seasons || SEASONS, tastes: this.tastes });
    this.meta = { bots, humans, dropped, autoSubs: {}, resultsPublished: 0 };
    await this._patch({ settings: { ...this.game.settings, aiTeams, active: specs.map(s => s.id) } });
    await this._saveState();
    await this.openExample(0);
  }

  // The worked-example round (Steven 10/26): three timed screens on made-up brands before season 1 (config/example.js). No engine step, no score, nothing
  // written for the teams to read: the pages draw the example from the config, so this only moves the game row through example:0, :1, :2.
  async openExample(idx) {
    await this._patch({ phase: 'example', round: 0, reveal: { season: 0, idx }, clock: this.clockFor({ phase: 'example', round: 0, reveal: { idx } }) });
  }

  roster() {
    return this.state.order.map(id => { const t = this.state.teams[id]; return { id, name: t.name, brandId: t.brandId, house: t.house, bot: !!(this.meta.bots[id] && !this.meta.bots[id].house) }; });
  }

  // Each step below moves the engine once, then writes. If a write fails (school wifi), the next tick retries the step: the engine part is skipped
  // because the engine is already there, and only the writes run again. So a failed write costs a few seconds, never a stuck game.
  async openSeason() {
    const st = this.state;
    if (st.phase !== 'open') {
      const season = beginSeason(st);
      this.meta.autoSubs = {};
      for (const id of st.order) {
        const bot = this.meta.bots[id];
        if (!bot) continue;
        const view = teamView(st, id);
        const r = bot.house ? housePlan(view, bot.personality) : strategyPlan(bot, view, () => rand(st));
        this.meta.autoSubs[id] = r.lock ? { plan: r.plan, locked: true, why: r.why, lock_left: 0 } : { plan: r.plan, locked: false, why: '' };
      }
      this.meta.opened = { season: season.season, cards: season.cards.map(c => ({ id: c.id, headline: c.headline, standfirst: c.standfirst, rule: c.rule, art: c.art, markets: c.markets })) };
    }
    const s = st.season, cards = this.meta.opened && this.meta.opened.season === s ? this.meta.opened.cards : [];
    for (const id of this.meta.humans) await this.store.putSnapshot(this.gid, s, 'view', id, { view: teamView(st, id) });
    await this.store.putSnapshot(this.gid, s, 'public', '', { season: s, seasons: st.seasons, cards, roster: this.roster() });
    await this._saveState();
    await this._patch({ phase: 'decide', round: s, clock: this.clockFor({ phase: 'decide', round: s }), reveal: null });
  }

  // Which human teams have locked, from the decisions table.
  async readiness() {
    const rows = await this.store.getDecisions(this.gid, this.season);
    return Object.fromEntries(this.meta.humans.map(id => { const d = rows.find(r => r.team_id === id); return [id, { locked: !!(d && d.locked), saved: !!(d && d.plan) }]; }));
  }

  async resolve() {
    if (this.game.phase !== 'decide') throw new Error('Not in a decision window.');
    const st = this.state, s = this.game.round;
    if (st.phase === 'open' && st.season === s) {
      const rows = await this.store.getDecisions(this.gid, s);
      const subs = { ...this.meta.autoSubs };
      const runSaved = this.game.settings.savedPlanRuns !== false;   // a saved plan that was never locked plays when the window closes (core.mjs resolveSeason)
      for (const id of this.meta.humans) {
        const d = rows.find(r => r.team_id === id);
        subs[id] = d ? { plan: d.plan, locked: !!d.locked, why: d.why || '', lock_left: d.lock_left ?? null, ...(runSaved && !d.locked ? { runSaved: true } : {}) } : {};
      }
      resolveSeason(st, subs);
    } else if (!(st.phase === 'resolved' && st.season === s)) throw new Error('The engine (season ' + st.season + ', ' + st.phase + ') and the game (season ' + s + ') disagree. Reload this page.');
    await this.store.putSnapshot(this.gid, s, 'reveal', '', this.revealData(s));
    await this._saveState();
    await this._patch({ phase: 'reveal', reveal: { season: s, idx: 0 }, clock: this.clockFor({ phase: 'reveal', round: s, reveal: { idx: 0 } }) });
  }

  revealData(s) {
    const st = this.state, res = st.history[s];
    const markets = {};
    for (const m of MARKET_IDS) {
      const M = res.markets[m];
      // Steven 10/26: the reveal shows WINNERS ONLY. Every seller appears with brand, entry mode and share (so the room sees who won by how much), but
      // only the market's winning piece carries its design, tiles and price. Nobody else's design ever leaves the host.
      const isWin = l => res.winners.some(w => w.market === m && w.team === l.team && w.design === l.design);
      markets[m] = { seat: M.seat || null, seats: M.seatList || (M.seat ? [M.seat] : []), crowd: M.crowd, incumbent: { name: st.cfg.MARKETS[m].incumbent.name, share: M.incumbent.share },
        lines: M.lines.map(l => (isWin(l) ? { team: l.team, house: l.house, mode: l.mode, win: true, design: l.design, tiles: l.tiles, price: l.price, share: l.share, buyers: l.buyers }
          : { team: l.team, house: l.house, mode: l.mode, win: false, share: l.share, buyers: l.buyers })) };
    }
    const events = st.tables.ww_log.filter(e => e.round === s && (PUBLIC_EVENT_TYPES.has(e.type) || e.type === 'bid' || (e.type === 'carry' && e.payload.phase === 'resolve')))
      .map(e => ({ type: e.type, market: e.market, text: e.text, team: e.team_id, status: e.payload && e.payload.status,
        ...(e.type === 'bid' ? { amount: e.payload.capped_to ?? e.payload.amount, won: !!e.payload.won } : {}) }));
    return { season: s, markets, events, winners: res.winners, roster: this.roster(), looks: this.looksFor(s) };
  }

  // The cosmetic look (piece name, trim, pattern, logo artwork) of every WINNING piece in season s, read from the plans the engine kept. Only winning pieces
  // are included (10/26), so the projector and the Rival Lookbook learn nothing about any other design. A copy carries the original's look and copyOf.
  // House and bot plans have no look; the pages draw a default one. Looks never touch fit, price or anything the engine scores.
  looksFor(s) {
    const st = this.state, res = st.history[s], decs = st.tables.ww_decisions, out = {};
    const planOf = (team, season) => { const d = decs.find(x => x.team_id === team && x.round === season); return d ? d.plan : null; };
    const lookIn = (team, season, design, tiles, depth = 0) => {
      const p = planOf(team, season);
      if (!p) return null;
      const d = (p.designs || []).find(x => x.id === design);
      if (d) return d.look ? cleanLook(d.look, d) : null;
      const i = (p.copy || []).findIndex((x, k) => (x.id || 'X' + (k + 1)) === design);
      if (i < 0 || depth > 3) return null;
      const c = p.copy[i];
      return { ...(lookIn(c.from_team, c.season || season - 1, c.design, tiles, depth + 1) || cleanLook(null, tiles)), copyOf: c.from_team };
    };
    for (const m of MARKET_IDS) for (const l of res.markets[m].lines) {
      if (!res.winners.some(w => w.market === m && w.team === l.team && w.design === l.design)) continue;   // winners only (10/26)
      const lk = lookIn(l.team, s, l.design, l.tiles);
      if (lk) (out[l.team] = out[l.team] || {})[l.design] = lk;
    }
    return out;
  }

  resultFor(id, s) {
    const st = this.state, res = st.history[s];
    const lines = {};
    for (const m of MARKET_IDS) { const l = res.markets[m].lines.find(x => x.team === id); if (l) lines[m] = l; }
    const events = st.tables.ww_log.filter(e => e.round === s && e.team_id === id && !['standing'].includes(e.type)).map(e => ({ type: e.type, market: e.market, text: e.text }));
    const dec = st.tables.ww_decisions.find(d => d.team_id === id && d.round === s);
    return { season: s, mine: res.teams[id], lines, events, seats: res.seats, plan: dec ? dec.plan : null, stood: dec ? dec.stood : false, locked: dec ? dec.locked : false, savedRan: !!res.teams[id].savedRan,
      notes: dec ? dec.notes : [], engineError: dec ? dec.engine_error : null, view: teamView(st, id) };
  }

  async setReveal(idx) {
    const s = this.state.season;
    idx = Math.max(0, Math.min(idx, MARKET_IDS.length));
    if (idx >= MARKET_IDS.length && this.meta.resultsPublished < s) await this.publishResults();
    await this._patch({ reveal: { season: s, idx }, clock: this.clockFor({ phase: 'reveal', round: s, reveal: { idx } }) });
  }
  async publishResults() {
    const s = this.state.season;
    for (const id of this.meta.humans) await this.store.putSnapshot(this.gid, s, 'result', id, this.resultFor(id, s));
    this.meta.resultsPublished = s;
    await this._saveState();
  }

  // Collect carry offers teams wrote during the reveal (decision notes), make them, then open the next season or finish.
  async nextSeason() {
    const st = this.state, s = this.game.round;     // the season the game row is on; after a failed write the engine may already be one ahead
    if (st.phase === 'resolved' && st.season === s) {
      if (this.meta.resultsPublished < s) await this.publishResults();
      if (this.meta.offersFor !== s) {
        const rows = await this.store.getDecisions(this.gid, s);
        const byTeam = {};
        for (const id of this.meta.humans) {
          const d = rows.find(r => r.team_id === id);
          const o = ((d && d.notes) || []).filter(n => n && n.type === 'carry' && n.market && n.design).map(n => ({ market: n.market, design: n.design }));
          if (o.length) byTeam[id] = o;
        }
        for (const id of st.order) {
          const bot = this.meta.bots[id];
          if (!bot || bot.house) continue;
          const o = strategyOffers(bot, teamView(st, id));
          if (o.length) byTeam[id] = o;
        }
        this._made = makeOffers(st, byTeam);
        this.meta.offersFor = s;
      }
      if (s >= st.seasons) { await this.finish(); return this._made; }
    } else if (!(st.phase === 'open' && st.season === s + 1)) throw new Error('The engine (season ' + st.season + ', ' + st.phase + ') and the game (season ' + s + ') disagree. Reload this page.');
    await this.openSeason();
    return this._made;
  }

  async finish() {
    const st = this.state;
    const rank = standings(st);
    await this.store.putSnapshot(this.gid, st.seasons, 'final', '', { standings: rank, roster: this.roster() });
    await this._saveState();
    await this._patch({ phase: 'final', reveal: null, clock: null });
    try { await this.store.addEvents(this.gid, st.tables.ww_log.map(e => ({ seq: e.seq, round: e.round, team_id: e.team_id, type: e.type, text: e.text, market: e.market, why: e.why, payload: e.payload }))); } catch (e) { console.warn('log not saved to the server', e); }
  }

  // ---------- the clock ----------
  // A fresh clock for the step a game is about to enter, at the speed the host chose in the lobby.
  clockFor(g) {
    const set = this.game.settings || {}, seasons = set.seasons || SEASONS;
    const secs = stepSeconds(CLOCK, { phase: g.phase, season: g.round, seasons, idx: (g.reveal && g.reveal.idx) || 0 }, set.clockScale || 1);
    return newClock(secs, stepKey(g), this.now());
  }
  get autoAdvance() { return !!this.game && (this.game.settings || {}).autoAdvance !== false; }
  due(now = this.now()) { return this.autoAdvance && !this.needsCode && isDue(this.game, now); }   // a laptop without the taste code never runs the engine

  // Called by the admin page about twice a second. Moves the game on one step when the clock of the step it is on has run out; otherwise does nothing.
  async tick(now = this.now()) {
    if (!this.due(now)) return false;
    return this.advance(stepKey(this.game));
  }

  // One step on: decide -> reveal market 1 -> ... -> market 4 -> recap -> next season's decide (or final). The tick and the Skip button both pass the
  // step they saw; advance re-reads the game and does nothing if the game is no longer on that step (a double-click, the clock, or another tab got there
  // first). With no key it moves on from wherever the game is (tests only).
  async advance(expected) {
    if (this._advancing) return false;
    this._advancing = true;
    try {
      await this.refreshGame();
      if (expected && stepKey(this.game) !== expected) return false;
      const g = this.game;
      if (g.phase === 'example') { const idx = g.reveal ? g.reveal.idx : 0; if (idx < EXAMPLE_STEPS - 1) await this.openExample(idx + 1); else await this.openSeason(); }
      else if (g.phase === 'decide') await this.resolve();
      else if (g.phase === 'reveal') { const idx = g.reveal ? g.reveal.idx : 0; if (idx < MARKET_IDS.length) await this.setReveal(idx + 1); else await this.nextSeason(); }
      else return false;
      return true;
    } finally { this._advancing = false; }
  }

  // Back on a reveal, keyed the same way, so a double-click goes back one market, not two.
  async back(expected) {
    if (this._advancing) return false;
    this._advancing = true;
    try {
      await this.refreshGame();
      if (expected && stepKey(this.game) !== expected) return false;
      const g = this.game;
      if (g.phase === 'example' && g.reveal && g.reveal.idx > 0) { await this.openExample(g.reveal.idx - 1); return true; }
      if (g.phase !== 'reveal' || !g.reveal || g.reveal.idx <= 0) return false;
      await this.setReveal(g.reveal.idx - 1);
      return true;
    } finally { this._advancing = false; }
  }

  async _clock(fn) { await this.refreshGame(); if (!this.game.clock) return; await this._patch({ clock: fn(this.game.clock, this.now()) }); }
  pause() { return this._clock(pauseClock); }
  resume() { return this._clock(resumeClock); }
  addTime(secs = 30) { return this._clock(c => addTime(c, secs)); }

  // Every human team has locked (ready from readiness(), read in season `round`): drop the decision clock to a few seconds. Someone unlocked: give the
  // full clock back. lockTarget says whether anything would change, without writing, so the admin page can ask twice a second for free.
  lockTarget(ready, round) {
    const g = this.game;
    if (!g || g.phase !== 'decide' || round !== g.round || !g.clock || !this.meta || !this.meta.humans.length || g.settings.autoResolve === false) return null;
    const all = this.meta.humans.every(id => ready[id] && ready[id].locked);
    const next = all ? earlyClock(g.clock, CLOCK.allLockedSeconds, this.now()) : restoreClock(g.clock, this.now());   // earlyClock leaves a paused clock alone
    return next === g.clock ? null : next;
  }
  async lockState(ready, round) {
    const next = this.lockTarget(ready, round);
    if (!next) return false;
    await this._patch({ clock: next });
    return true;
  }

  exportRun() {
    const st = this.state;
    return { seed: st.seed, taste_code: this.restoreCode, teams: st.order.length, house: st.order.filter(id => st.teams[id].house).length, seasons: st.seasons,
      strategies: Object.fromEntries(Object.values(this.meta.bots).map(b => [b.id, b.house ? 'house:' + b.personality : b.strategy])),
      ...exportTables(st), results: st.history, ranking: standings(st) };
  }

  // Test helper: skip the worked-example round straight to season 1.
  async skipExample() { while (this.game.phase === 'example') await this.advance(); }

  // Test helper: nobody is human, so run every season with the bots.
  async autoPlay(progress = () => {}) {
    if (this.game.phase === 'lobby') await this.start();
    if (this.game.phase === 'example') await this.openSeason();
    while (this.game.phase !== 'final') {
      if (this.game.phase === 'decide') await this.resolve();
      progress('season ' + this.state.season + ' resolved');
      await this.setReveal(MARKET_IDS.length);
      await this.nextSeason();
    }
  }
}
