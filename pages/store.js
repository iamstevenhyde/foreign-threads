// Local mode store. Same interface as the Supabase store in supa.js, backed by localStorage.
// Tabs of the same browser (admin, projector, team seats) see each other through the "storage" event, with a
// one-second poll as a backup, so local mode behaves like live mode with no network and no Supabase.
//
// Row shapes (snake_case, identical to the ww_ tables in schema.sql):
//   games     {id, seed, team_count, bot_count, phase, round, clock, reveal, rev, status, admin_key, settings, created_at}
//   teams     {game_id, team_id, name, join_code, created_at}
//   seats     {id, game_id, team_id, name, slot, role_override, secret, removed, connected_at, last_seen}
//   decisions {game_id, team_id, round, capital, actions, market, why, predicted, locked, locked_by, locked_at, notes, engine_error, updated_at}
//   events    {game_id, seq, round, team_id, type, text, payload}
//   snapshots {game_id, round, kind, team_id, data}     kind: public | view | result | final | log

const P = 'wwl:';

export class LocalStore {
  constructor() {
    this.mode = 'local';
    this.subs = new Map();
    this.lastRev = {};
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith(P)) this._fromKey(e.key); });
    setInterval(() => this._poll(), 1000);
  }
  _k(table, gid, pk) { return P + table + ':' + gid + ':' + pk; }
  _get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  _put(table, gid, pk, row) {
    localStorage.setItem(this._k(table, gid, pk), JSON.stringify(row));
    const rv = (Number(localStorage.getItem(P + 'rev:' + gid)) || 0) + 1;
    localStorage.setItem(P + 'rev:' + gid, String(rv));
    this.lastRev[gid] = rv;
    this._emit(gid, table);
  }
  _list(table, gid) {
    const out = [], pre = P + table + ':' + gid + ':';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(pre)) { const v = this._get(k); if (v) out.push(v); }
    }
    return out;
  }
  _emit(gid, table) { (this.subs.get(gid) || []).forEach(fn => { try { fn(table); } catch (e) { console.error(e); } }); }
  _fromKey(key) {
    const parts = key.slice(P.length).split(':');
    if (parts[0] === 'rev') { return; }
    const gid = parts[1];
    this.lastRev[gid] = Number(localStorage.getItem(P + 'rev:' + gid)) || 0;
    this._emit(gid, parts[0]);
  }
  _poll() {
    for (const gid of this.subs.keys()) {
      const rv = Number(localStorage.getItem(P + 'rev:' + gid)) || 0;
      if (rv !== (this.lastRev[gid] || 0)) { this.lastRev[gid] = rv; this._emit(gid, 'poll'); }
    }
  }
  subscribe(gid, fn) {
    if (!this.subs.has(gid)) this.subs.set(gid, []);
    this.subs.get(gid).push(fn);
    this.lastRev[gid] = Number(localStorage.getItem(P + 'rev:' + gid)) || 0;
    return () => this.subs.set(gid, this.subs.get(gid).filter(f => f !== fn));
  }

  // games
  async createGame(row) { this._put('games', row.id, 'g', { created_at: new Date().toISOString(), rev: 0, ...row }); return row; }
  async getGame(id) { return this._get(this._k('games', id, 'g')); }
  async patchGame(id, patch) {
    const g = await this.getGame(id); if (!g) return null;
    const row = { ...g, ...patch }; this._put('games', id, 'g', row); return row;
  }
  async listGames(n = 10) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(P + 'games:')) { const v = this._get(k); if (v) out.push(v); } }
    return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, n);
  }
  // teams
  async upsertTeam(row) { const old = this._get(this._k('teams', row.game_id, row.team_id)); this._put('teams', row.game_id, row.team_id, { created_at: new Date().toISOString(), ...old, ...row }); }
  async getTeams(gid) { return this._list('teams', gid).sort((a, b) => Number(a.team_id.slice(1)) - Number(b.team_id.slice(1))); }
  async findTeamByCode(code) {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith(P + 'teams:')) continue;
      const v = this._get(k);
      if (v && v.join_code === code && (!best || v.created_at > best.created_at)) best = v;
    }
    return best;
  }
  // seats
  async upsertSeat(row) { const old = this._get(this._k('seats', row.game_id, row.id)); this._put('seats', row.game_id, row.id, { ...old, ...row }); }
  async getSeats(gid) { return this._list('seats', gid); }
  // decisions. Each column is its own key, so two tabs editing different columns of one team's plan never overwrite each other
  // (the Supabase upsert behaves the same way: only the columns sent are written).
  async patchDecision(gid, teamId, round, patch) {
    const now = new Date().toISOString();
    for (const [col, val] of Object.entries(patch)) this._put('decisions', gid, teamId + '@' + round + '|' + col, { game_id: gid, team_id: teamId, round, col, val, at: now });
  }
  async getDecisions(gid, round) {
    const by = {};
    for (const c of this._list('decisions', gid)) {
      if (round !== undefined && c.round !== round) continue;
      const k = c.team_id + '@' + c.round;
      const row = by[k] = by[k] || { game_id: gid, team_id: c.team_id, round: c.round, capital: {}, actions: [], market: { bids: [], builds: [] }, why: '', predicted: null, locked: false, notes: [], updated_at: '' };
      row[c.col] = c.val;
      if (c.at > row.updated_at) row.updated_at = c.at;
    }
    return Object.values(by);
  }
  // events
  async addEvents(gid, rows) { for (const r of rows) this._put('events', gid, String(r.seq).padStart(6, '0'), { ...r, game_id: gid }); }
  async getEvents(gid, f = {}) {
    return this._list('events', gid).filter(e => (f.round === undefined || e.round === f.round) && (f.teamId === undefined || e.team_id === f.teamId)).sort((a, b) => a.seq - b.seq);
  }
  // snapshots
  async putSnapshot(gid, round, kind, teamId, data) {
    this._put('snapshots', gid, [round, kind, teamId || ''].join('|'), { game_id: gid, round, kind, team_id: teamId || '', data, updated_at: new Date().toISOString() });
  }
  async getSnapshots(gid, f = {}) {
    return this._list('snapshots', gid).filter(s => (f.kind === undefined || s.kind === f.kind) && (f.round === undefined || s.round === f.round) && (f.teamId === undefined || s.team_id === f.teamId));
  }
  async removeGame(gid) {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(P) && k.includes(':' + gid + ':')) doomed.push(k); }
    doomed.forEach(k => localStorage.removeItem(k));
  }
}
