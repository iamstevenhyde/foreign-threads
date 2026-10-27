// Supabase client, store, realtime channel, seat registration and the stale-cookie rejoin flow.
// openStore() returns the Supabase store in live mode and the localStorage store (store.js) in local mode,
// so the three pages are written once against one interface.

import { SUPA_URL, SUPA_ANON_KEY } from './config.js?v=c89ef327';
import { LocalStore } from './store.js?v=c89ef327';
import { pageMode, safeGet, safeSet, safeDel, uid } from './util.js?v=c89ef327';
import { roleFor } from './roles.js?v=c89ef327';

const SB_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

function loadSupabaseLib() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = SB_SRC; el.onload = () => res(); el.onerror = () => rej(new Error('Could not load the Supabase library. Check the network.'));
    document.head.append(el);
  });
}

class SupaStore {
  constructor(sb) { this.sb = sb; this.mode = 'live'; this.channels = new Map(); }
  async _ok(q) { const { data, error } = await q; if (error) throw new Error(error.message); return data; }

  async createGame(row) { return this._ok(this.sb.from('ww_games').insert(row).select().single()); }
  async getGame(id) { return this._ok(this.sb.from('ww_games').select('*').eq('id', id).maybeSingle()); }
  async patchGame(id, patch) { return this._ok(this.sb.from('ww_games').update(patch).eq('id', id).select().maybeSingle()); }
  async listGames(n = 10) { return this._ok(this.sb.from('ww_games').select('*').order('created_at', { ascending: false }).limit(n)); }

  async upsertTeam(row) { return this._ok(this.sb.from('ww_teams').upsert(row, { onConflict: 'game_id,team_id' })); }
  async getTeams(gid) { return (await this._ok(this.sb.from('ww_teams').select('*').eq('game_id', gid))).sort((a, b) => Number(a.team_id.slice(1)) - Number(b.team_id.slice(1))); }
  async findTeamByCode(code) {
    const rows = await this._ok(this.sb.from('ww_teams').select('*').eq('join_code', code).order('created_at', { ascending: false }).limit(1));
    return rows && rows[0] || null;
  }

  async upsertSeat(row) { return this._ok(this.sb.from('ww_seats').upsert(row, { onConflict: 'id' })); }
  async getSeats(gid) { return this._ok(this.sb.from('ww_seats').select('*').eq('game_id', gid)); }

  // Only the columns in "patch" are written, so the CFO's capital column and the CEO's why column never overwrite each other.
  async patchDecision(gid, teamId, round, patch) {
    return this._ok(this.sb.from('ww_decisions').upsert({ game_id: gid, team_id: teamId, round, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'game_id,team_id,round' }));
  }
  async getDecisions(gid, round) {
    let q = this.sb.from('ww_decisions').select('*').eq('game_id', gid);
    if (round !== undefined) q = q.eq('round', round);
    return this._ok(q);
  }

  async addEvents(gid, rows) {
    const clean = rows.map(r => ({ game_id: gid, seq: r.seq, round: r.round, team_id: r.team_id || null, type: r.type, text: r.text || '', market: r.market || null, why: r.why || '', payload: r.payload || {} }));
    for (let i = 0; i < clean.length; i += 200) await this._ok(this.sb.from('ww_log').upsert(clean.slice(i, i + 200), { onConflict: 'game_id,seq' }));
  }
  async getEvents(gid, f = {}) {
    let q = this.sb.from('ww_log').select('*').eq('game_id', gid).order('seq');
    if (f.round !== undefined) q = q.eq('round', f.round);
    if (f.teamId !== undefined) q = q.eq('team_id', f.teamId);
    return this._ok(q);
  }

  async putSnapshot(gid, round, kind, teamId, data) {
    return this._ok(this.sb.from('ww_snapshots').upsert({ game_id: gid, round, kind, team_id: teamId || '', data, updated_at: new Date().toISOString() }, { onConflict: 'game_id,round,kind,team_id' }));
  }
  async getSnapshots(gid, f = {}) {
    let q = this.sb.from('ww_snapshots').select('*').eq('game_id', gid);
    if (f.kind !== undefined) q = q.eq('kind', f.kind);
    if (f.round !== undefined) q = q.eq('round', f.round);
    if (f.teamId !== undefined) q = q.eq('team_id', f.teamId);
    return this._ok(q);
  }

  // One realtime channel per game. Every table change calls fn(tableName). A 4 second poll of the game row is the backup.
  subscribe(gid, fn) {
    const ch = this.sb.channel('ww:' + gid);
    for (const t of ['ww_games', 'ww_teams', 'ww_seats', 'ww_decisions', 'ww_snapshots', 'ww_log']) {
      const filter = t === 'ww_games' ? 'id=eq.' + gid : 'game_id=eq.' + gid;
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter }, () => fn(t === 'ww_log' ? 'events' : t.slice(3)));
    }
    ch.subscribe(status => { this.status = status; });
    const poll = setInterval(() => fn('poll'), 4000);
    this.channels.set(gid, ch);
    return () => { clearInterval(poll); this.sb.removeChannel(ch); this.channels.delete(gid); };
  }
}

let storePromise = null;
export function openStore() {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    if (pageMode() === 'local') return new LocalStore();
    await loadSupabaseLib();
    const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON_KEY, { realtime: { params: { eventsPerSecond: 10 } } });
    return new SupaStore(sb);
  })();
  return storePromise;
}

// ---------- seats and rejoin (spec 05 section 4) ----------
const SEAT_KEY = g => 'ww_seat_' + g;
const LAST_KEY = 'ww_seat_last';
const ENDED = 'final';
export const MAX_SEATS = 5;

// Live mode keeps the seat in localStorage (survives closing the tab). Local mode keeps it per tab (sessionStorage),
// so several tabs of one browser can be different seats at once.
const bag = () => {
  if (pageMode() === 'local') return { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: k => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  return { get: safeGet, set: safeSet, del: safeDel };
};
export function savedSeat(gid) {
  try {
    const b = bag(), raw = gid ? b.get(SEAT_KEY(gid)) : b.get(LAST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function saveSeat(info) { const raw = JSON.stringify(info), b = bag(); b.set(SEAT_KEY(info.gameId), raw); b.set(LAST_KEY, raw); }
export function forgetSeat(gid) { const b = bag(); b.del(SEAT_KEY(gid)); const l = savedSeat(); if (l && l.gameId === gid) b.del(LAST_KEY); }

// Check a saved seat against the server. Returns {status, ...}.
//   ok | gameover | nogame | removed | replaced
export async function resumeSeat(store, saved) {
  if (!saved) return { status: 'none' };
  const game = await store.getGame(saved.gameId);
  if (!game) { forgetSeat(saved.gameId); return { status: 'nogame' }; }
  const seats = await store.getSeats(saved.gameId);
  const seat = seats.find(x => x.id === saved.seatId);
  if (!seat || seat.removed) { forgetSeat(saved.gameId); return { status: 'removed', game }; }
  if (seat.secret !== saved.secret) return { status: 'replaced', game, seat };
  if (game.phase === ENDED) return { status: 'gameover', game, seat };
  return { status: 'ok', game, seat };
}

// A team code (4 characters). Returns {team, game} or {error}.
export async function lookupCode(store, code, gameHint) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { error: 'Enter your team code.' };
  let team = null;
  if (gameHint) { const teams = await store.getTeams(gameHint); team = teams.find(t => t.join_code === code) || null; }
  if (!team) team = await store.findTeamByCode(code);
  if (!team) return { error: 'That code does not match a team. Check with your instructor.' };
  const game = await store.getGame(team.game_id);
  if (!game) return { error: 'We could not find that game. Enter a join code.' };
  if (game.phase !== 'lobby' && ((game.settings || {}).aiTeams || []).includes(team.team_id)) return { error: 'The game has already started, and nobody had claimed that team, so AI is playing it. Ask your instructor.' };
  return { team, game };
}

export async function takeNewSeat(store, game, team, name) {
  const seats = (await store.getSeats(game.id)).filter(x => x.team_id === team.team_id && !x.removed);
  if (seats.length >= MAX_SEATS) return { error: 'Your team already has ' + seats.length + ' seats. Ask your instructor.' };
  const all = await store.getSeats(game.id);
  const slot = all.filter(x => x.team_id === team.team_id).reduce((m, x) => Math.max(m, x.slot + 1), 0);
  const row = { id: uid(10), game_id: game.id, team_id: team.team_id, name: (name || '').trim() || 'Player ' + (slot + 1), slot, role_override: null, secret: uid(16), removed: false, connected_at: new Date().toISOString(), last_seen: new Date().toISOString() };
  row.role = roleFor([...all, row], row, Math.max(1, game.round || 1)).label;   // role at registration; the screens recompute it each round
  await store.upsertSeat(row);
  const info = { gameId: game.id, teamId: team.team_id, seatId: row.id, secret: row.secret };
  saveSeat(info);
  return { info, seat: row };
}
// Take over an existing seat (new device, same student). The old device sees its secret stop matching.
export async function takeOverSeat(store, game, seat) {
  const secret = uid(16);
  await store.upsertSeat({ ...seat, secret, connected_at: new Date().toISOString(), last_seen: new Date().toISOString() });
  const info = { gameId: game.id, teamId: seat.team_id, seatId: seat.id, secret };
  saveSeat(info);
  return { info };
}
// Only last_seen is written, so a heartbeat can never undo a takeover or an admin role change.
export async function heartbeat(store, seat) {
  await store.upsertSeat({ id: seat.id, game_id: seat.game_id, team_id: seat.team_id, slot: seat.slot, last_seen: new Date().toISOString() });
}
