// The host: runs the engine in the admin browser and publishes what teams and the projector may see.
// Teams never touch engine state. They read 'view' and 'result' snapshots and write only their own ww_decisions row.
// Snapshots (ww_snapshots): kind 'state' round 0 (full engine state, so an admin reload resumes), 'view' per team per season (teamView at season open),
// 'public' per season (news + roster), 'reveal' per season (what the projector may show), 'result' per team per season (private results), 'final'.

import { createGame, beginSeason, teamView, resolveSeason, makeOffers, standings, exportTables, rand } from '../engine/core.mjs';
import { housePlan, strategyPlan, strategyOffers, STRATEGIES } from '../engine/bots.mjs';
import { BRANDS } from '../config/brands.js';
import { HOUSE, CLOCK, SEASONS } from '../config/rules.js';
import { MARKET_IDS } from '../config/markets.js';
import { makeCode, makeGameId } from './util.js';

const PUBLIC_EVENT_TYPES = new Set(['copy', 'suit', 'street']);

export class Host {
  constructor(store) { this.store = store; this.game = null; this.teams = []; this.state = null; this.meta = null; this.busy = false; }

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
      status: 'active', admin_key: makeCode(6), settings: { pool, botFill: !!botFill, aiTeams: rows.filter(r => r.house).map(r => r.team_id), seasons: SEASONS } });
    for (const r of rows) await store.upsertTeam(r);
    const host = new Host(store);
    await host.load(gid);
    return host;
  }

  async load(gid) {
    this.game = await this.store.getGame(gid);
    if (!this.game) throw new Error('No game ' + gid);
    this.teams = await this.store.getTeams(gid);
    const snap = (await this.store.getSnapshots(gid, { kind: 'state' }))[0];
    if (snap) { this.state = snap.data.state; this.meta = snap.data.meta; } else { this.state = null; this.meta = null; }
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
    if (n >= pool.length) throw new Error('All twelve brands are in use.');
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
    this.state = createGame({ seed: this.game.seed, teams: specs, seasons: this.game.settings.seasons || SEASONS });
    this.meta = { bots, humans, dropped, autoSubs: {}, resultsPublished: 0 };
    await this._patch({ settings: { ...this.game.settings, aiTeams, active: specs.map(s => s.id) } });
    await this.openSeason();
  }

  roster() {
    return this.state.order.map(id => { const t = this.state.teams[id]; return { id, name: t.name, brandId: t.brandId, house: t.house, bot: !!(this.meta.bots[id] && !this.meta.bots[id].house) }; });
  }

  async openSeason() {
    const st = this.state, season = beginSeason(st), s = season.season;
    this.meta.autoSubs = {};
    for (const id of st.order) {
      const bot = this.meta.bots[id];
      if (!bot) continue;
      const view = teamView(st, id);
      const r = bot.house ? housePlan(view, bot.personality) : strategyPlan(bot, view, () => rand(st));
      this.meta.autoSubs[id] = r.lock ? { plan: r.plan, locked: true, why: r.why, lock_left: 0 } : { plan: r.plan, locked: false, why: '' };
    }
    for (const id of this.meta.humans) await this.store.putSnapshot(this.gid, s, 'view', id, { view: teamView(st, id) });
    await this.store.putSnapshot(this.gid, s, 'public', '', { season: s, seasons: st.seasons,
      cards: season.cards.map(c => ({ id: c.id, headline: c.headline, standfirst: c.standfirst, rule: c.rule, art: c.art, markets: c.markets })), roster: this.roster() });
    await this._saveState();
    const secs = CLOCK.decideSeconds[s] || 240;
    await this._patch({ phase: 'decide', round: s, clock: { endsAt: Date.now() + secs * 1000, total: secs }, reveal: null });
  }

  // Which human teams have locked, from the decisions table.
  async readiness() {
    const rows = await this.store.getDecisions(this.gid, this.season);
    return Object.fromEntries(this.meta.humans.map(id => { const d = rows.find(r => r.team_id === id); return [id, { locked: !!(d && d.locked), saved: !!(d && d.plan) }]; }));
  }

  async resolve() {
    if (this.game.phase !== 'decide') throw new Error('Not in a decision window.');
    const st = this.state, s = st.season;
    const rows = await this.store.getDecisions(this.gid, s);
    const subs = { ...this.meta.autoSubs };
    for (const id of this.meta.humans) {
      const d = rows.find(r => r.team_id === id);
      subs[id] = d ? { plan: d.plan, locked: !!d.locked, why: d.why || '', lock_left: d.lock_left ?? null } : {};
    }
    resolveSeason(st, subs);
    await this.store.putSnapshot(this.gid, s, 'reveal', '', this.revealData(s));
    await this._saveState();
    await this._patch({ phase: 'reveal', reveal: { season: s, idx: 0 }, clock: null });
  }

  revealData(s) {
    const st = this.state, res = st.history[s];
    const markets = {};
    for (const m of MARKET_IDS) {
      const M = res.markets[m];
      markets[m] = { seat: M.seat || null, crowd: M.crowd, incumbent: { name: st.cfg.MARKETS[m].incumbent.name, share: M.incumbent.share },
        lines: M.lines.map(l => ({ team: l.team, house: l.house, mode: l.mode, design: l.design, tiles: l.tiles, price: l.price, share: l.share, buyers: l.buyers })) };
    }
    const events = st.tables.ww_log.filter(e => e.round === s && (PUBLIC_EVENT_TYPES.has(e.type) || e.type === 'bid' || (e.type === 'carry' && e.payload.phase === 'resolve')))
      .map(e => ({ type: e.type, market: e.market, text: e.text, team: e.team_id, status: e.payload && e.payload.status }));
    return { season: s, markets, events, winners: res.winners, roster: this.roster() };
  }

  resultFor(id, s) {
    const st = this.state, res = st.history[s];
    const lines = {};
    for (const m of MARKET_IDS) { const l = res.markets[m].lines.find(x => x.team === id); if (l) lines[m] = l; }
    const events = st.tables.ww_log.filter(e => e.round === s && e.team_id === id && !['standing'].includes(e.type)).map(e => ({ type: e.type, market: e.market, text: e.text }));
    const dec = st.tables.ww_decisions.find(d => d.team_id === id && d.round === s);
    return { season: s, mine: res.teams[id], lines, events, seats: res.seats, plan: dec ? dec.plan : null, stood: dec ? dec.stood : false, locked: dec ? dec.locked : false,
      notes: dec ? dec.notes : [], engineError: dec ? dec.engine_error : null, view: teamView(st, id) };
  }

  async setReveal(idx) {
    const s = this.state.season;
    if (idx >= 4 && this.meta.resultsPublished < s) await this.publishResults();
    await this._patch({ reveal: { season: s, idx: Math.max(0, Math.min(idx, 4)) } });
  }
  async publishResults() {
    const s = this.state.season;
    for (const id of this.meta.humans) await this.store.putSnapshot(this.gid, s, 'result', id, this.resultFor(id, s));
    this.meta.resultsPublished = s;
    await this._saveState();
  }

  // Collect carry offers teams wrote during the reveal (decision notes), make them, then open the next season or finish.
  async nextSeason() {
    const st = this.state, s = st.season;
    if (this.meta.resultsPublished < s) await this.publishResults();
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
    const made = makeOffers(st, byTeam);
    if (s >= st.seasons) { await this.finish(); return made; }
    await this.openSeason();
    return made;
  }

  async finish() {
    const st = this.state;
    const rank = standings(st);
    await this.store.putSnapshot(this.gid, st.seasons, 'final', '', { standings: rank, roster: this.roster() });
    await this._saveState();
    await this._patch({ phase: 'final', reveal: null, clock: null });
    try { await this.store.addEvents(this.gid, st.tables.ww_log.map(e => ({ seq: e.seq, round: e.round, team_id: e.team_id, type: e.type, text: e.text, market: e.market, why: e.why, payload: e.payload }))); } catch (e) { console.warn('log not saved to the server', e); }
  }

  exportRun() {
    const st = this.state;
    return { seed: st.seed, teams: st.order.length, house: st.order.filter(id => st.teams[id].house).length, seasons: st.seasons,
      strategies: Object.fromEntries(Object.values(this.meta.bots).map(b => [b.id, b.house ? 'house:' + b.personality : b.strategy])),
      ...exportTables(st), results: st.history, ranking: standings(st) };
  }

  // Test helper: nobody is human, so run every season with the bots.
  async autoPlay(progress = () => {}) {
    if (this.game.phase === 'lobby') await this.start();
    while (this.game.phase !== 'final') {
      if (this.game.phase === 'decide') await this.resolve();
      progress('season ' + this.state.season + ' resolved');
      await this.setReveal(4);
      await this.nextSeason();
    }
  }
}
