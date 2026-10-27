// Team page: join with a code, build a collection, choose how to enter each market, lock, then read the results.
// Reads only 'view', 'result' and public 'reveal' snapshots the host published (fog already applied). Writes only this team's ww_decisions rows:
// the season's plan, and a round-0 row that holds the team's brand mark and colour (cosmetic, read by the projector).
// Layout (10/24 redesign): tabs Studio / Markets / Rival Lookbook, the news as "The Thread", and a dock along the bottom with cash, what the plan
// holds, what is still open, the clock and the lock button.
import { openStore, savedSeat, resumeSeat, lookupCode, takeNewSeat, takeOverSeat, heartbeat, forgetSeat } from './supa.js?v=97381521';
import { h, $, $$, params, setParam, toast, debounce, mmss, friendlyError, safeGet, safeSet } from './util.js?v=97381521';
import { clockLeft } from './clock.js?v=97381521';
import { exampleScreen } from './example.js?v=97381521';
import { BUILD } from './build.js?v=97381521';
import { validateWith } from '../engine/core.mjs?v=97381521';
import { BID_HINT, defaultFallback } from '../config/rules.js?v=97381521';
import { ROWS, ROW_LABEL, TILES, tileLabel, MARKETS, MARKET_IDS, BRANDS, BRAND_BY_ID, dnaState, money, money1, pctf,
  MODE_LABEL, PRICE_LABEL, GAME_TITLE, garmentEl, markEl, tilesCaps, thumbSrc, lazyImg, tag } from './ui.js?v=97381521';
import { garmentSVG, cleanLook, cleanStyle, defaultName, TRIMS, PATTERNS, ARTWORK, MARKS, BRAND_COLOURS, swatchSVG, fabricSVG, patternSVG, trimHex, markSVG } from './garment.js?v=97381521';

const app = $('#app');
let planP = null, store, seat = null, game = null, team = null, allTeams = [], view = null, result = null, finalSnap = null, plan = null, why = '', locked = false, notes = [],
  sig = '', planSeason = 0, tick = null, styles = {}, reveals = {}, brandOpen = false;
let tab = safeGet('ft:tab') || 'studio', selD = null, selM = safeGet('ft:market') || 'berlin';

const blank = () => ({ designs: [], markets: {}, research: [], copy: [], accept: [] });
const clone = x => JSON.parse(JSON.stringify(x));
const htm = (cls, html) => h('span.' + cls, { html });

// ---------- join ----------
// ---------- game code (10/27): the student link needs no code in it. Type the game code from the projector, then pick a team ----------
const normGame = v => { v = String(v || '').trim().toUpperCase().replace(/\s+/g, ''); const m = /^(?:WW-?)?([A-Z0-9]{4})$/.exec(v); return m ? 'WW-' + m[1] : v; };
const NO_GAME = 'No game with that code yet. Ask your instructor for the code shown on the projector, or wait and try again.';
function gameCodeScreen(msg) {
  const enter = async code => {
    const gid = normGame(code), say = t => { const e = $('#gmsg'); if (e) e.textContent = t; };
    if (!gid) return say('Type the game code shown on the projector.');
    try {
      const g = await store.getGame(gid);
      if (!g) return say(NO_GAME);
      setParam('g', gid); joinScreen();
    } catch (e) { say(NO_GAME); }
  };
  app.replaceChildren(h('div.join',
    h('div.wm.join-wm', 'Foreign Threads'),
    h('p.join-kick', 'MBA 546, week 10. One collection, five cities.'),
    h('div.join-card',
      h('label.lbl', { for: 'gcode' }, 'Game code'),
      h('input#gcode', { autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'WW-XXXX', onkeydown: ev => { if (ev.key === 'Enter') enter(ev.target.value); } }),
      h('p.err#gmsg', msg || ''),
      h('button.btn.primary.wide', { onclick: () => enter($('#gcode').value) }, 'Join'),
      h('div#gopen'))));
  // one game made in the last 3 hours, still in its lobby, on this build: offer it as a button. Never a list.
  store.listGames(20).then(gs => {
    const now = Date.now(), fresh = (gs || []).filter(g => g.phase === 'lobby' && (g.settings || {}).build === BUILD.id && g.created_at && now - new Date(g.created_at).getTime() < 3 * 3600 * 1000);
    const box = $('#gopen');
    if (box && fresh.length === 1) box.append(h('button.btn.wide', { onclick: () => enter(fresh[0].id) }, 'Join the open game ' + fresh[0].id));
  }).catch(() => {});
}

function joinScreen(msg, resume) {
  const hint = params().get('g');
  if (!hint && !resume) return gameCodeScreen(msg);
  const go = async () => {
    try {
      const found = await lookupCode(store, $('#code').value, hint);
      if (found.error) return joinScreen(found.error);
      if (found.team.house) return joinScreen('That is a house (AI) team. Ask your instructor for your own code.');
      const act = (found.game.settings || {}).active;
      if (found.game.phase !== 'lobby' && act && !act.includes(found.team.team_id)) return joinScreen('The game started before anybody joined that team. Ask your instructor.');
      const r = await takeNewSeat(store, found.game, found.team, $('#nm').value);
      if (r.error) return joinScreen(r.error);
      setParam('g', found.game.id); seat = r.seat; start();
    } catch (e) { joinScreen(friendlyError(e)); }
  };
  app.replaceChildren(h('div.join',
    h('div.wm.join-wm', 'Foreign Threads'),
    h('p.join-kick', 'MBA 546, week 10. One collection, five cities.'),
    h('div.join-card',
      h('label.lbl', { for: 'code' }, 'Team code'),
      h('input#code', { maxlength: 4, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'ABCD', onkeydown: ev => { if (ev.key === 'Enter') go(); } }),
      h('label.lbl', { for: 'nm' }, 'Your name (optional)'),
      h('input#nm', { placeholder: 'First name', onkeydown: ev => { if (ev.key === 'Enter') go(); } }),
      msg ? h('p.err', msg) : null,
      h('button.btn.primary.wide', { onclick: go }, 'Join your brand')),
    hint ? h('div.join-card#pick', h('p.lbl', 'Game ' + hint + '. Tap your team, or type its four-letter code above.'), h('p.err#pickmsg'), h('div.pickl#pickl'),
      h('button.btn.ghost.sm', { onclick: () => { setParam('g', null); joinScreen(); } }, 'Not this game? Change the game code')) : null,
    resume ? h('div.join-card', h('p', 'You already have this seat on another screen.'), h('button.btn', { onclick: async () => { await takeOverSeat(store, resume.game, resume.seat); seat = (await store.getSeats(resume.game.id)).find(x => x.id === resume.seat.id); start(); } }, 'Take over this seat here')) : null));
  if (hint) {
    // teams and who has claimed them, refreshed every 4 s while this screen is up; a game that does not exist yet just waits
    const fill = async () => {
      const box = $('#pickl'); if (!box) return;
      let ts = [], seatsNow = [], g = null;
      try { [ts, seatsNow, g] = await Promise.all([store.getTeams(hint), store.getSeats(hint), store.getGame(hint)]); } catch (e) { g = null; }
      const msgEl = $('#pickmsg');
      if (!g) { if (msgEl) msgEl.textContent = NO_GAME; box.replaceChildren(); }
      else {
        if (msgEl) msgEl.textContent = '';
        const n = {}; for (const x of seatsNow || []) if (!x.removed) n[x.team_id] = (n[x.team_id] || 0) + 1;
        const open = (ts || []).filter(t => !t.house);
        if (g.phase !== 'lobby' || !open.length) { box.replaceChildren(); return; }
        box.replaceChildren(...open.map(t => h('button.btn' + (n[t.team_id] ? '' : '.primary'), { onclick: () => { $('#code').value = t.join_code; go(); } },
          t.name + ' (' + t.join_code + ')' + (n[t.team_id] ? ' ' + n[t.team_id] + ' joined' : ' open'))));
      }
      setTimeout(fill, 4000);
    };
    fill();
  }
}

// ---------- data ----------
async function load() {
  game = await store.getGame(seat.game_id);
  if (!game) return;
  allTeams = await store.getTeams(game.id);
  team = allTeams.find(t => t.team_id === seat.team_id);
  const r = game.round || 0;
  // brand marks and colours: one round-0 decisions row per team (cosmetic)
  const srows = await store.getDecisions(game.id, 0);
  const st = {};
  for (const d of srows) if (d.plan && d.plan.style) st[d.team_id] = d.plan.style;
  styles = { ...st, ...(styles[seat.team_id] && !st[seat.team_id] ? { [seat.team_id]: styles[seat.team_id] } : {}) };
  if (r > 0) {
    const v = (await store.getSnapshots(game.id, { kind: 'view', round: r, teamId: seat.team_id }))[0];
    view = v ? v.data.view : null;
    const rs = (await store.getSnapshots(game.id, { kind: 'result', round: r, teamId: seat.team_id }))[0];
    result = rs ? rs.data : null;
    if (planSeason !== r && view) { if (!planP || planP.r !== r) { planP = initPlan(r); planP.r = r; } await planP; }
    // earlier reveals are public; the Rival Lookbook draws from them
    for (let s = 1; s < r; s++) if (!reveals[s]) { const x = (await store.getSnapshots(game.id, { kind: 'reveal', round: s }))[0]; if (x) reveals[s] = x.data; }
  }
  finalSnap = game.phase === 'final' ? ((await store.getSnapshots(game.id, { kind: 'final' }))[0] || {}).data || null : null;
  const s = [game.phase, game.round, !!view, !!result, !!finalSnap, game.reveal && game.reveal.idx, game.clock && [game.clock.step, game.clock.paused, game.clock.early].join(','),
    game.phase === 'lobby' ? JSON.stringify(styles) + allTeams.length : ''].join('|');
  const changed = s !== sig; sig = s;
  return changed;
}

async function initPlan(r) { await initPlanInner(r); planSeason = r; }
async function initPlanInner(r) {
  plan = null;
  const row = (await store.getDecisions(game.id, r)).find(d => d.team_id === seat.team_id);
  notes = (row && row.notes) || [];
  if (row && row.plan && (row.plan.designs || row.plan.markets)) {
    plan = { ...blank(), ...clone(row.plan) }; why = row.why || ''; locked = !!row.locked;
  } else {
    locked = false; why = '';
    plan = blank();
    if (view.lastPlan) {
      const lp = clone(view.lastPlan);
      plan.designs = lp.designs || [];
      for (const m of MARKET_IDS) {
        const l = (lp.markets || {})[m];
        if (l && l.mode && l.mode !== 'none' && l.mode !== 'carried' && plan.designs.some(d => d.id === l.design)) plan.markets[m] = { ...l, bid: l.bid || 0 };
        else plan.markets[m] = { mode: 'none' };    // carried over: last season you stayed out here
      }
    } else {
      const d = { id: 'D1' };
      for (const row of ROWS) {
        const free = BRAND_BY_ID[view.team.brandId].free.find(f => f.row === row);
        d[row] = free ? free.tile : TILES[row][0].id;
      }
      plan.designs = [d];
    }
  }
  plan.designs.forEach(d => { d.look = cleanLook(d.look, d); });
  selD = plan.designs[0] ? plan.designs[0].id : null;
}

const save = debounce(async () => {
  try { await store.patchDecision(game.id, seat.team_id, planSeason, { plan, why }); } catch (e) { toast(friendlyError(e), 6000); }
}, 350);
function changed(rerender = true) { save(); if (rerender) render(); }

// ---------- helpers ----------
const brandIdOf = id => (view && view.brands[id] ? view.brands[id].brandId : (allTeams.find(t => t.team_id === id) || {}).brand_id);
const styleOf = id => cleanStyle(styles[id], brandIdOf(id));
const myStyle = () => styleOf(seat.team_id);
const brandName = id => (view && view.brands[id] ? view.brands[id].name : (allTeams.find(t => t.team_id === id) || { name: id }).name);
const isHouse = id => !!((view && view.brands[id] && view.brands[id].house) || (allTeams.find(t => t.team_id === id) || {}).house);
const copyNo = c => Number(String(c.id || '').replace(/\D/g, '')) || 0;
const copyId = (c, i) => c.id || 'X' + (i + 1);
const designIds = () => [...plan.designs.map(d => d.id), ...plan.copy.map(copyId)];
const env = () => ({ season: view.season, publicWinners: view.publicWinners, house: false });
const check = () => validateWith(view.pub, view.ctx, planForEngine(), env());
function planForEngine() {
  const p = clone(plan);
  for (const m of Object.keys(p.markets)) if (!p.markets[m] || ((!p.markets[m].mode || p.markets[m].mode === 'none') && !(Number(p.markets[m].bid) > 0))) delete p.markets[m];
  return p;
}
function fitHint(m, tiles) {
  const k = view.known[m]; let hit = 0, n = 0;
  for (const row of ROWS) if (k[row]) { n++; if (k[row].tile === tiles[row]) hit++; }
  return { hit, n };
}
const lookFromReveal = (season, teamId, designId) => { const R = reveals[season]; return R && R.looks && R.looks[teamId] ? R.looks[teamId][designId] : null; };
// Every piece in the plan, designs and copies, in one list.
function pieces() {
  const me = seat.team_id, out = [];
  plan.designs.forEach((d, i) => out.push({ id: d.id, kind: 'design', idx: i, tiles: { cut: d.cut, palette: d.palette, logo: d.logo, fabric: d.fabric }, look: d.look, d }));
  plan.copy.forEach((c, i) => {
    const w = view.publicWinners.find(x => x.team === c.from_team && x.design === c.design && x.season === c.season);
    const src = lookFromReveal(c.season, c.from_team, c.design);
    out.push({ id: copyId(c, i), kind: 'copy', idx: i, tiles: w ? w.tiles : null, look: src ? { ...src } : w ? cleanLook(null, w.tiles) : null, c });   // a house or bot piece has no look: use its default name
  });
  return out.filter(p => p.tiles || p.kind === 'design');
}
const pieceById = id => pieces().find(p => p.id === id) || null;
const usedIn = id => MARKET_IDS.filter(m => plan.markets[m] && plan.markets[m].mode && plan.markets[m].mode !== 'none' && plan.markets[m].design === id);
const dnaCost = t => ROWS.reduce((a, r) => a + view.pub.DESIGN.dnaSurcharge[dnaState(view.team.brandId, r, t[r])], 0);
const feeAt = i => view.pub.DESIGN.extraFee[Math.min(i, view.pub.DESIGN.extraFee.length - 1)];
const multAt = n => view.pub.DESIGN.unitCostMultiplier[Math.min(Math.max(n, 1), view.pub.DESIGN.unitCostMultiplier.length) - 1];
const gEl = (p, opts = {}) => garmentEl(p.tiles, p.look, opts.style || myStyle(), opts.brand || view.team.name, opts);
function costTag(row, tile) {
  const st = dnaState(view.team.brandId, row, tile), c = view.pub.DESIGN.dnaSurcharge[st];
  return st === 'free' ? h('span.ctag.free', 'Brand · free') : st === 'costly' ? h('span.ctag.costly', 'Off-brand +' + money(c)) : h('span.ctag', '+' + money(c));
}

// ---------- header, thread, dock ----------
function clockLabel() {
  const c = game.clock;
  if (!c) return '';
  if (c.paused) return 'Paused';
  if (game.phase === 'decide') return c.early ? 'All locked' : 'Lock in';
  if (game.phase === 'example') return 'Practice ends in';
  const idx = (game.reveal && game.reveal.idx) || 0;
  return idx < MARKET_IDS.length - 1 ? 'Next market' : idx === MARKET_IDS.length - 1 ? 'Results in' : game.round >= ((game.settings && game.settings.seasons) || 4) ? 'Final in' : 'Next season';
}
const timerChip = (cls = '') => game.clock && (game.phase === 'decide' || game.phase === 'reveal' || game.phase === 'example') ? h('span.timer' + cls, h('span.tl.js-tlabel', clockLabel()), h('b.js-tclock', mmss(clockLeft(game.clock, Date.now())))) : null;
function brandLockup(big) {
  const st = myStyle(), name = team ? BRAND_BY_ID[team.brand_id].name : '';
  return h('button.lockup' + (big ? '.big' : ''), { title: 'Change your brand mark and colour', onclick: () => { brandOpen = !brandOpen; render(); } }, markEl(st, big ? 34 : 26), h('span.lockup-name', name));
}
function header(withTabs) {
  const seasons = view ? view.seasons : (game.settings && game.settings.seasons) || 4;
  return h('header.tp-head',
    h('div.tp-row',
      h('div.wm.tp-wm', 'Foreign Threads'),
      brandLockup(false),
      withTabs ? h('nav.tabs', { role: 'tablist' }, [['studio', 'Studio'], ['markets', 'Markets'], ['lookbook', 'Lookbook', 'Rival ']].map(([k, l, pre]) =>
        h('button.tab' + (tab === k ? '.on' : ''), { role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; safeSet('ft:tab', k); render(); window.scrollTo(0, 0); } }, pre ? h('span.hide-s', pre) : null, l))) : h('span.grow'),
      h('div.tp-meta',
        game.round ? h('div.meta', h('span.lbl', 'Season'), h('b', game.round + ' / ' + seasons)) : null,
        view ? h('div.meta.hide-s', h('span.lbl', 'Cash'), h('b.cash', money1(result && game.phase !== 'decide' ? result.mine.cashEnd : view.cash))) : null,
        timerChip(withTabs ? '.hide-s' : ''))));   // on a phone the decision clock lives in the dock; other steps show it here
}
function thread() {
  const evs = view.events || [];
  if (!evs.length) return h('div.thread', h('span.lbl', 'The Thread'), h('span.th-head', 'A quiet season. No rule changes this time.'));
  return h('div.thread', h('span.lbl', 'The Thread'), h('div.th-list', evs.map(e => h('div.th-item', h('span.th-head', e.headline), h('span.th-rule', e.rule)))));
}
function openItems(v) {
  const und = MARKET_IDS.filter(m => !plan.markets[m]);
  const out = [];
  if (!plan.designs.length && !plan.copy.length) out.push('Add at least one design');
  if (und.length) out.push((und.length === MARKET_IDS.length ? 'All ' + MARKET_IDS.length + ' markets' : und.map(m => MARKETS[m].name).join(', ')) + ' not decided');
  const entered = MARKET_IDS.filter(m => plan.markets[m] && plan.markets[m].mode && plan.markets[m].mode !== 'none');
  if (!und.length && !entered.length) out.push('You are not selling anywhere');
  if (v.errors.length) out.unshift(v.errors[0]);
  return out;
}
function dock() {
  const v = check(), c = v.cost, left = game.clock ? Math.max(0, clockLeft(game.clock, Date.now())) : 0;
  const open = openItems(v);
  const lockBtn = locked
    ? h('button.btn.lockd', { onclick: async () => { locked = false; await store.patchDecision(game.id, seat.team_id, planSeason, { locked: false }); render(); } }, h('span', 'Locked'), h('small', 'Tap to edit'))
    : h('button.btn.primary.lockbtn', { disabled: !v.ok || (!plan.designs.length && !plan.copy.length), onclick: async () => {
      locked = true; await store.patchDecision(game.id, seat.team_id, planSeason, { plan, why, locked: true, locked_by: seat.name, locked_at: new Date().toISOString(), lock_left: Math.round(left / 1000) });
      toast('Locked. You can still unlock until the clock runs out.'); render(); } }, 'Lock plan');
  return h('footer.dock',
    h('div.dock-in',
      h('div.dstat', h('span.lbl', 'Cash'), h('b', money1(view.cash))),
      h('div.dstat', h('span.lbl', 'Plan holds'), h('b' + (c.total > view.cash + 1e-9 ? '.err' : ''), money1(c.total)),
        h('small.hide-s', 'fees ' + money1(c.fees + c.dna) + ' · lines ' + money1(c.lines) + ' · bids ' + money1(c.escrow) + (c.research ? ' · research ' + money1(c.research) : ''))),
      h('div.dopen', h('span.lbl', locked ? 'Locked in' : 'Still open'), h('span.dopen-t' + (v.errors.length ? '.err' : ''), locked ? 'Your plan is in. Unlock to change it.' : open.length ? open.join(' · ') : 'Nothing. Ready to lock.'),
        h('span.js-lock-note.err')),
      timerChip(),
      lockBtn));
}

// ---------- brand identity (mark + colour), cosmetic ----------
async function setStyle(patch) {
  const st = { ...myStyle(), ...patch };
  styles[seat.team_id] = st;
  render();
  try { await store.patchDecision(game.id, seat.team_id, 0, { plan: { style: st } }); } catch (e) { toast(friendlyError(e), 6000); }
}
function brandEditor(compact) {
  const st = myStyle(), name = BRAND_BY_ID[team.brand_id].name;
  const demo = { cut: 'hoodie', palette: 'pastel', logo: 'big', fabric: 'light' };
  return h('div.brand-ed' + (compact ? '.compact' : ''),
    h('div.be-preview', garmentEl(demo, { art: 'both', pattern: 'solid', trim: 'accent' }, st, name), h('div.be-lock', markEl(st, 46), h('span.wm.be-name', name))),
    h('div.be-ctrls',
      h('div.lbl', 'Brand mark'),
      h('div.be-marks', MARKS.map(m => h('button.optsq' + (st.mark === m.id ? '.on' : ''), { title: m.label, 'aria-label': m.label, 'aria-pressed': st.mark === m.id ? 'true' : 'false', onclick: () => setStyle({ mark: m.id }) }, htm('i', markSVG(m.id, st.colour, 30))))),
      h('div.lbl', 'Brand colour'),
      h('div.be-cols', BRAND_COLOURS.map(c => h('button.dot' + (st.colour === c.hex ? '.on' : ''), { style: '--c:' + c.hex, 'aria-label': 'Colour ' + c.id, 'aria-pressed': st.colour === c.hex ? 'true' : 'false', onclick: () => setStyle({ colour: c.hex }) }))),
      h('p.note', 'Your mark and colour go on every piece you make and on the projector. They are looks only: buyers do not score them.')));
}
function brandSheet() {
  if (!brandOpen) return null;
  return h('div.sheet', { onclick: ev => { if (ev.target.classList.contains('sheet')) { brandOpen = false; render(); } } },
    h('div.sheet-in', h('div.sheet-top', h('span.lbl', 'Your brand'), h('button.btn.ghost', { onclick: () => { brandOpen = false; render(); } }, 'Done')), brandEditor(true)));
}

// ---------- studio ----------
function studio() {
  const P = pieces();
  if (!P.find(p => p.id === selD)) selD = P[0] ? P[0].id : null;
  const cur = P.find(p => p.id === selD);
  const max = view.pub.DESIGN.maxPerSeason, n = plan.designs.length + plan.copy.length;
  const list = h('section.coll',
    h('div.sec-h', h('span.lbl', 'Your collection'), h('span.lbl', n + ' / ' + max)),
    h('div.coll-list',
      P.map(p => h('button.ccard' + (p.id === selD ? '.on' : ''), { onclick: () => { selD = p.id; render(); } },
        gEl(p, { cls: 'gsvg sm' }),
        h('div.cc-txt', h('span.lbl', p.id + (p.kind === 'copy' ? ' · copy' : '')), h('b.cc-name', p.look ? cleanLook(p.look, p.tiles).name : 'Copied look'),
          h('span.cc-use', usedIn(p.id).length ? usedIn(p.id).map(m => MARKETS[m].name).join(' · ') : 'Not placed in a market yet')))),
      n < max ? h('button.ccard.add', { onclick: () => addDesign() },
        h('span.plus', '+'), h('div.cc-txt', h('b.cc-name', 'Add a design'), h('span.cc-use', 'Fee ' + money1(feeAt(plan.designs.length)) + ', and every garment costs x' + multAt(n + 1).toFixed(2) + ' to make'))) : null));
  if (!cur) return h('div.studio', list, h('section.st-stage', h('p.note', 'No designs yet. Add one.')));
  return h('div.studio', list, stage(cur), cur.kind === 'design' ? controls(cur) : copyCard(cur));
}
function addDesign() {
  const src = plan.designs.find(d => d.id === selD) || plan.designs[plan.designs.length - 1];
  const id = 'D' + (Math.max(0, ...plan.designs.map(d => Number(d.id.slice(1)) || 0)) + 1);
  const d = { id, cut: src ? src.cut : 'hoodie', palette: src ? src.palette : 'earth', logo: src ? src.logo : 'small', fabric: src ? src.fabric : 'heavy' };
  d.look = cleanLook({ trim: src && src.look ? src.look.trim : 'accent' }, d);
  plan.designs.push(d); selD = id; changed();
}
function removePiece(p) {
  if (p.kind === 'design') plan.designs.splice(p.idx, 1); else plan.copy.splice(p.idx, 1);
  for (const m of Object.keys(plan.markets)) if (plan.markets[m] && plan.markets[m].design === p.id) plan.markets[m].design = designIds()[0] || '';
  selD = designIds()[0] || null; changed();
}
function stage(p) {
  const lk = p.look ? cleanLook(p.look, p.tiles) : null;
  const n = plan.designs.length + plan.copy.length;
  // the name re-renders a moment after blur, so a click that caused the blur still lands on its button
  const nameInput = p.kind === 'design' ? h('input.piece-name', { value: lk.name, maxlength: 24, 'aria-label': 'Piece name', placeholder: defaultName(p.tiles),
    onchange: ev => { p.d.look = cleanLook({ ...p.d.look, name: ev.target.value }, p.d); changed(false); setTimeout(render, 150); } }) : h('h2.piece-name.static', lk ? lk.name : 'Copied look');
  return h('section.st-stage',
    h('div.stage-top', h('span.lbl', 'Design ' + p.id + (p.kind === 'copy' ? ' · copy of ' + brandName(p.c.from_team) : '')),
      h('div.stage-acts',
        p.kind === 'design' && n < view.pub.DESIGN.maxPerSeason ? h('button.btn.ghost.sm', { onclick: () => addDesign() }, 'Duplicate') : null,
        n > 1 ? h('button.btn.ghost.sm', { onclick: () => removePiece(p) }, 'Remove') : null)),
    nameInput,
    h('div.stage-cap', tilesCaps(p.tiles)),
    h('div.stage-art',
      h('figure.front', gEl(p, { cls: 'gsvg xl' }), h('figcaption.lbl', 'Front')),
      h('figure.back', gEl(p, { cls: 'gsvg lg', back: true }), h('figcaption.lbl', 'Back'))),
    h('div.fitrow', h('span.lbl', 'Against what you know'),
      h('div.fit-chips', MARKET_IDS.map(m => { const f = fitHint(m, p.tiles), used = usedIn(p.id).includes(m);
        return h('button.fchip' + (used ? '.used' : ''), { title: 'Open ' + MARKETS[m].name + ' in Markets', onclick: () => { selM = m; safeSet('ft:market', m); tab = 'markets'; safeSet('ft:tab', 'markets'); render(); window.scrollTo(0, 0); } },
          h('b', MARKETS[m].name), h('span', f.n ? f.hit + ' of ' + f.n + ' known rows match' : 'nothing known yet'), used ? h('span.lbl', 'placed here') : null); }))));
}
function optRow(row, cur) {
  // a name the team never edited follows the tiles ("Earth Hoodie" becomes "Black Hoodie"); a typed name stays
  const d = cur.d, set = v => { const auto = !d.look || d.look.name === defaultName(d); d[row] = v; d.look = cleanLook({ ...d.look, ...(auto ? { name: '' } : {}) }, d); changed(); };
  return TILES[row].map(t => {
    const on = d[row] === t.id;
    let icon;
    if (row === 'cut') icon = htm('i', garmentSVG({ ...d, cut: t.id, logo: 'none' }, null, null, '', { sketch: true, noLogo: true, cls: 'gsvg ic' }));
    else if (row === 'palette') icon = htm('i', swatchSVG(t.id, 36));
    else if (row === 'logo') icon = htm('i', garmentSVG({ ...d, cut: 'hoodie', logo: t.id }, null, myStyle(), '', { sketch: true, cls: 'gsvg ic' }));
    else icon = htm('i', fabricSVG(t.id, d.palette, 64, 36));
    return h('button.opt.' + row + (on ? '.on' : ''), { 'aria-pressed': on ? 'true' : 'false', onclick: () => set(t.id) }, icon, h('span.opt-l', t.label), costTag(row, t.id));
  });
}
function controls(cur) {
  const d = cur.d, lk = cleanLook(d.look, d), setLook = patch => { d.look = cleanLook({ ...d.look, ...patch }, d); changed(); };
  const fee = feeAt(cur.idx), dna = dnaCost(d);
  const artNote = d.logo === 'none' ? 'Your Logo tile is No logo, so there is no artwork on the chest.' : d.logo === 'allover' ? 'All-over print repeats your brand mark across the piece.' : '';
  return h('section.ctrls',
    h('div.grp-h', h('b', 'What buyers score'), h('span.note', 'Matched against each market\'s hidden taste')),
    h('div.ctl', h('div.ctl-h', h('span.lbl', '1. Cut')), h('div.opts.cut', optRow('cut', cur))),
    h('div.ctl', h('div.ctl-h', h('span.lbl', '2. Colour')), h('div.opts.palette', optRow('palette', cur))),
    h('div.ctl', h('div.ctl-h', h('span.lbl', '3. Logo')), h('div.opts.logo', optRow('logo', cur))),
    h('div.ctl', h('div.ctl-h', h('span.lbl', '4. Fabric')), h('div.opts.fabric', optRow('fabric', cur))),
    h('div.ctl.yours',
      h('div.ctl-h', h('span.lbl', 'Make it yours'), h('span.note', 'Looks only. Buyers do not score these.')),
      h('div.sub', h('span.sub-l', 'Trim'), h('div.dots', TRIMS.map(t => h('button.dot' + (lk.trim === t.id ? '.on' : ''), { style: '--c:' + (t.hex || trimHex('accent', d.palette)), title: t.label, 'aria-label': 'Trim ' + t.label, 'aria-pressed': lk.trim === t.id ? 'true' : 'false', onclick: () => setLook({ trim: t.id }) })))),
      h('div.sub', h('span.sub-l', 'Pattern'), h('div.pats', PATTERNS.map(pt => h('button.optsq' + (lk.pattern === pt.id ? '.on' : ''), { title: pt.label, 'aria-pressed': lk.pattern === pt.id ? 'true' : 'false', onclick: () => setLook({ pattern: pt.id }) }, htm('i', patternSVG(pt.id, d.palette, 30)), h('span', pt.label))))),
      h('div.sub', h('span.sub-l', 'Logo artwork'), h('div.seg', ARTWORK.map(a => h('button.segb' + (lk.art === a.id ? '.on' : ''), { disabled: d.logo === 'none' || d.logo === 'allover', 'aria-pressed': lk.art === a.id ? 'true' : 'false', onclick: () => setLook({ art: a.id }) }, a.label))),
        artNote ? h('p.note', artNote) : null)),
    h('div.ctl.costs', h('div.kv2',
      h('span', 'Design fee'), h('b', money(fee) + (cur.idx === 0 ? ' (first design is free)' : '')),
      h('span', 'Brand surcharge'), h('b', money(dna)),
      h('span', 'Unit cost multiplier'), h('b', 'x' + multAt(plan.designs.length + plan.copy.length).toFixed(2) + ' with ' + (plan.designs.length + plan.copy.length) + ' piece' + (plan.designs.length + plan.copy.length > 1 ? 's' : ''))),
      h('p.note', 'Brand tiles are free. Other tiles add ' + money(view.pub.DESIGN.dnaSurcharge.other) + ', your off-brand tile adds ' + money(view.pub.DESIGN.dnaSurcharge.costly) + '.')));
}
function copyCard(p) {
  const c = p.c;
  return h('section.ctrls', h('div.ctl',
    h('div.ctl-h', h('span.lbl', 'A copied look')),
    h('p', 'You copied ', h('b', brandName(c.from_team)), '\'s best seller in ' + MARKETS[c.market || 'berlin'].name + ' (season ' + c.season + '). Its four tiles are fixed: ' + tilesCaps(p.tiles).toLowerCase() + '.'),
    h('ul.rules',
      h('li', 'No design fee, but it counts toward your ' + view.pub.DESIGN.maxPerSeason + ' pieces and raises unit cost like any design.'),
      h('li', 'The projector names every copy.'),
      h('li', 'Courts in Berlin and Tokyo fine a copy ' + money1(view.pub.COPY.suitFine) + ', paid to the original brand. Sao Paulo and Nairobi do not.')),
    h('button.btn', { onclick: () => removePiece(p) }, 'Remove this copy')));
}

// ---------- markets ----------
function marketStrip() {
  return h('div.mstrip', MARKET_IDS.map(m => {
    const pm = view.pub.markets[m], line = plan.markets[m], known = view.tilesKnown[m];
    const status = !line ? 'Not decided' : !line.mode || line.mode === 'none' ? (Number(line.bid) > 0 ? 'Bidding only' : 'Staying out') : MODE_LABEL[line.mode] + ' · ' + line.design;
    return h('button.mcard' + (selM === m ? '.on' : '') + (!line ? '.und' : ''), { onclick: () => { selM = m; safeSet('ft:market', m); render(); } },
      thumb(m),
      h('div.mc-txt', h('span.wm.mc-name', pm.name), h('span.lbl', Math.round(pm.pool) + 'K buyers'), h('span.mc-st', status), h('span.mc-k', known + ' of 4 tastes known')));
  }));
}
const thumbs = new Map();   // one <img> per city thumbnail, reused across redraws
const thumb = m => { if (!thumbs.has(m)) thumbs.set(m, lazyImg(thumbSrc(m), 'mthumb')); return thumbs.get(m); };
const SOURCE = { start: 'known from the start', season: 'learned by selling here', partner: 'from the partner seat', clue: 'from a clue card', research: 'from research' };
// Weights and reveal order are public (Steven 10/26): every row shows how much it counts and where it sits in the order rows come to light.
const wPct = (m, row) => Math.round(view.pub.markets[m].weights[row] * 100) + '%';
const ordinal = n => ['', 'first', 'second', 'third', 'fourth'][n] || String(n);
function tasteCard(m, row) {
  const k = view.known[m][row];
  let icon = null;
  if (k) {
    const base = { cut: 'hoodie', palette: 'pastel', logo: 'none', fabric: 'light' };
    if (row === 'cut') icon = htm('i', garmentSVG({ ...base, cut: k.tile }, null, null, '', { sketch: true, noLogo: true, cls: 'gsvg ic' }));
    else if (row === 'palette') icon = htm('i', swatchSVG(k.tile, 40));
    else if (row === 'logo') icon = htm('i', garmentSVG({ ...base, logo: k.tile }, null, myStyle(), '', { sketch: true, cls: 'gsvg ic' }));
    else icon = htm('i', fabricSVG(k.tile, 'earth', 64, 40));
  }
  return h('div.taste' + (k ? '' : '.unk'),
    h('span.lbl', ROW_LABEL[row]),
    k ? icon : h('span.q', '?'),
    h('b', k ? tileLabel(row, k.tile) : 'Hidden'),
    k ? h('span.tier.' + k.tier.toLowerCase(), k.tier + ' weight · ' + wPct(m, row)) : h('span.tier.none', 'Weight ' + wPct(m, row) + ' · revealed ' + ordinal(view.pub.markets[m].revealOrder.indexOf(row) + 1)),
    h('span.src', k ? SOURCE[k.source] || k.source : 'Sell here, win the partner seat, draw a clue' + (view.pub.markets[m].rules.research ? ' or buy research' : '')));
}
// 10/27: partner seats per market (2 in a big room) and the bid suggestion, both from the public config.
const seatsN = () => (view.pub.PARTNER && view.pub.PARTNER.seatsPerMarket) || 1;
const seatWords = () => (seatsN() > 1 ? 'The ' + seatsN() + ' highest bids each take a seat.' : 'The highest bid takes the one seat.');
const r10 = x => Math.round(x * 10) / 10;
function defaultBid() { return Math.max(view.pub.BUDGET.minPartnerBid, Math.min(r10(view.bidCap), r10(BID_HINT.defaultShare * view.cash))); }
function bidHint() {
  const [a, b] = BID_HINT.wonShare;
  return 'In test games, bids that won a seat were mostly ' + money1(Math.min(view.bidCap, a * view.cash)) + ' to ' + money1(Math.min(view.bidCap, b * view.cash)) + ' at your cash. A bid at the minimum rarely wins.';
}
function costsList(m) {
  const pm = view.pub.markets[m], R = pm.rules, taxIdx = Math.min(view.active[m] || 0, pm.taxBySeason.length - 1), tax = pm.taxBySeason[taxIdx];
  const lastHolders = (view.lastSeatList && view.lastSeatList[m]) || (view.lastSeats[m] ? [view.lastSeats[m]] : []), lastHolder = lastHolders.length ? lastHolders.map(brandName).join(', ') : null;
  const row = (k, v, cls = '') => [h('span' + cls, k), h('b' + cls, v)];
  return h('div.kv2.costs-list',
    row('Foreignness tax', Math.round(tax * 100) + '% of unit cost this season (' + Math.round(tax * view.pub.PARTNER_TAX_CUT * 100) + '% with a partner). It falls each season you sell here.'),
    row('Duty on shipped goods', R.dutyShipped ? Math.round(R.dutyShipped * 100) + '% of unit cost' : 'None'),
    row('When you are paid', R.paymentLagSeasons ? 'Revenue arrives ' + R.paymentLagSeasons + ' season late (an own shop is paid at once)' : 'At the end of the season'),
    row('Copying', R.court ? (R.suitOnCopy ? 'Courts fine a copy ' + money1(view.pub.COPY.suitFine) : 'Courts exist, but copies here are not sued') : 'No court: copies spread freely'),
    R.streetCopy ? row('Street knock-offs', 'A design with ' + Math.round(view.pub.COPY.streetThreshold * 100) + '% of buyers is knocked off next season') : null,
    row('Research firm', R.research ? money(view.pub.FOG.researchFee) + ' for one more taste row' : 'None here'),
    R.walkShare ? row('Partner contracts', 'No court to enforce them: a partner keeps ' + Math.round(R.walkShare * 100) + '% of your sales') : null,
    row('What buyers weigh', ROWS.slice().sort((a, b) => pm.weights[b] - pm.weights[a]).map(r => ROW_LABEL[r] + ' ' + Math.round(pm.weights[r] * 100) + '%').join(' · ') + ' (public)'),
    row('Order rows come to light', pm.revealOrder.map(r => ROW_LABEL[r]).join(', ') + '. The first ' + pm.startVisible + ' show from the start.'),
    row('Local firm (a computer seller)', pm.incumbent.name + ' sells a garment that matches the taste of this city about ' + Math.round((pm.incumbent.fit || 0.65) * 100) + '% as well as a perfect one, at ' + pm.incumbent.price + ' price. It takes its buyers first; your rivals are the other teams.'),
    row('Last season', lastHolder ? lastHolder + (lastHolders.length > 1 ? ' held the partner seats; ' : ' held the partner seat; ') + (view.lastCrowd[m] || 0) + ' sellers' : view.season > 1 ? 'Nobody held the partner seat; ' + (view.lastCrowd[m] || 0) + ' sellers' : 'No history yet'));
}
function modeCards(m) {
  const pm = view.pub.markets[m], line = plan.markets[m] || null, cur = line ? line.mode || 'none' : null;
  const taxIdx = Math.min(view.active[m] || 0, pm.taxBySeason.length - 1), tax = Math.round(pm.taxBySeason[taxIdx] * 100), taxP = Math.round(pm.taxBySeason[taxIdx] * view.pub.PARTNER_TAX_CUT * 100);
  const reach = view.pub.SHARE.reach, ship = Math.round(Math.min(1.5, reach.ship + (pm.shipReachBonus || 0)) * 100), own = Math.round(reach.own * 100), ramp = Math.round(reach.own * view.pub.MODES.own.ownRampFirstSeason * 100);
  const offer = view.myOffers.find(o => o.market === m);
  const set = patch => { plan.markets[m] = { mode: 'none', design: designIds()[0] || '', price: 'standard', run: 50, bid: 0, fallback: defaultFallback(view.pub.markets[m].rules.modes), ...plan.markets[m], ...patch }; changed(); };
  const pick = mode => {
    if (mode === 'none') { plan.markets[m] = { ...(plan.markets[m] || {}), mode: 'none' }; changed(); return; }
    if (mode === 'carried') {
      const od = offer.design; let own = plan.designs.find(d => ROWS.every(r => d[r] === od[r]));
      if (!own) { own = { ...od, id: od.id && !designIds().includes(od.id) ? od.id : 'D' + (Math.max(0, ...plan.designs.map(d => Number(d.id.slice(1)) || 0)) + 1) }; own.look = cleanLook(null, own); plan.designs.push(own); }
      set({ mode, design: own.id }); return;
    }
    const patch = { mode };
    if (mode === 'partner' && !(Number((plan.markets[m] || {}).bid) > 0)) patch.bid = defaultBid();   // 10/27: was twice the minimum (0.4), which never beat a house bid
    set(patch);
  };
  const cards = [
    { k: 'none', t: 'Stay out', c: '$0 committed', d: 'Keep focus elsewhere. You learn nothing new here this season.' },
    { k: 'ship', t: 'Ship in', c: 'Tax ' + tax + '%' + (pm.rules.dutyShipped ? ' · duty ' + Math.round(pm.rules.dutyShipped * 100) + '%' : ' · no duty'), d: 'Reaches ' + ship + '% as many buyers as a partner. You keep every sale.', off: !pm.rules.modes.includes('ship') && 'No formal distributor here, so nothing can be shipped in.' },
    { k: 'partner', t: 'Local partner', c: 'Tax ' + taxP + '% · sealed bid, max ' + money(view.bidCap), d: 'Full reach (100% of buyers, against ' + ship + '% by shipping and ' + own + '% for an own shop) and one taste row the moment you win. A rival team can ask you to carry its line next season: you earn ' + money1(view.pub.CARRY.fee) + ' plus ' + Math.round(view.pub.MODES.partner.feeShare * 100) + '% of its sales there. ' + seatWords() + ' Each winning bid is PAID (spent, not held); losers are refunded and their fallback runs (ship in by default where that is open).' + (pm.rules.walkShare ? ' Here the partner keeps ' + Math.round(pm.rules.walkShare * 100) + '% of sales.' : '') },
    { k: 'own', t: 'Own shop', c: (view.owned[m] ? 'Set-up already paid' : 'Set-up ' + money(view.pub.MODES.own.setup)) + ' · tax ' + tax + '%', d: 'Reaches ' + own + '% of a partner, only ' + ramp + '% in your first season here. Paid at once, no partner share.' },
  ];
  if (offer) cards.push({ k: 'carried', t: 'Carried by ' + brandName(offer.holder), c: 'Fee ' + money(view.pub.CARRY.fee) + ' · tax ' + taxP + '%', d: 'Rides on their partner seat if they win it again. They see your design.' });
  return h('div.modes', cards.map(x => h('button.mode' + (cur === x.k ? '.on' : '') + (x.off ? '.off' : ''), { disabled: !!x.off, 'aria-pressed': cur === x.k ? 'true' : 'false', onclick: () => pick(x.k) },
    h('span.radio'), h('b.mode-t', x.t), h('span.mode-c', x.c), h('span.mode-d', x.off || x.d))));
}
function lineSettings(m) {
  const pm = view.pub.markets[m], line = plan.markets[m];
  if (!line || !line.mode || line.mode === 'none') return null;
  const set = patch => { plan.markets[m] = { ...plan.markets[m], ...patch }; changed(); };
  const P = pieces();
  return h('div.lineset',
    h('div.ls', h('span.lbl', 'Which piece'), h('div.pickd', P.map(p => { const f = fitHint(m, p.tiles);
      return h('button.pd' + (line.design === p.id ? '.on' : ''), { 'aria-pressed': line.design === p.id ? 'true' : 'false', onclick: () => set({ design: p.id }) }, gEl(p, { cls: 'gsvg sm' }),
        h('span.pd-t', h('b', p.id + ' ' + (p.look ? cleanLook(p.look, p.tiles).name : '')), h('span', f.n ? f.hit + ' of ' + f.n + ' known rows match' : 'nothing known here yet'))); }))),
    h('div.ls', h('span.lbl', 'Price'), h('div.seg3', Object.keys(view.pub.PRICES).map(t => h('button.sbox' + (line.price === t ? '.on' : ''), { 'aria-pressed': line.price === t ? 'true' : 'false', onclick: () => set({ price: t }) },
      h('b', PRICE_LABEL[t] + ' $' + view.pub.PRICES[t]), h('span', 'costs x' + ((view.pub.TIER_COST || {})[t] || 1) + ' to make'), h('span', 'sells x' + pm.priceFit[t] + ' here'))))),
    h('div.ls', h('span.lbl', 'Garments made'), h('div.seg4', view.pub.RUNS.sizes.map(r => h('button.sbox' + (line.run === r ? '.on' : ''), { 'aria-pressed': line.run === r ? 'true' : 'false', onclick: () => set({ run: r }) },
      h('b', r + 'k'), h('span', '$' + view.pub.RUNS.unitCost[r] + ' each'))))),
    h('p.note', 'Unsold garments are written off. A bigger run is cheaper per garment but only pays if buyers take it.'),
    line.mode === 'partner' || line.mode === 'carried' ? h('div.ls', h('span.lbl', line.mode === 'partner' ? 'If your bid loses' : 'If the carry falls through'),
      h('div.seg', ['none', 'ship', 'own'].filter(x => x === 'none' || pm.rules.modes.includes(x)).map(x => h('button.segb' + ((line.fallback || 'none') === x ? '.on' : ''), { onclick: () => set({ fallback: x }) }, x === 'none' ? 'Sit out' : MODE_LABEL[x])))) : null);
}
function bidBox(m) {
  const line = plan.markets[m] || {}, bid = Number(line.bid) || 0, need = line.mode === 'partner';
  const set = v => { v = Math.max(0, Math.round(v * 10) / 10); plan.markets[m] = { mode: 'none', design: designIds()[0] || '', price: 'standard', run: 50, fallback: defaultFallback(view.pub.markets[m].rules.modes), ...plan.markets[m], bid: v }; changed(); };
  return h('div.bid' + (need ? '.need' : ''),
    h('div', h('span.lbl', need ? 'Sealed bid for the partner seat' : 'Bid for the seat anyway (optional)'),
      h('p.note', 'Max ' + money(view.bidCap) + ' (' + Math.round(view.pub.BUDGET.partnerBidCap * 100) + '% of cash), at least ' + money(view.pub.BUDGET.minPartnerBid) + '. ' + seatWords() + ' A winning bid is PAID (spent, not held). A losing bid is refunded.'),
      h('p.note.hint', bidHint())),
    h('div.stepper', h('button.btn.sq', { 'aria-label': 'Lower bid', onclick: () => set(bid - 0.1) }, '−'),
      h('input', { type: 'number', min: 0, step: 0.1, value: bid.toFixed(1), 'aria-label': 'Bid in $M', onchange: ev => set(Number(ev.target.value) || 0) }),
      h('button.btn.sq', { 'aria-label': 'Raise bid', onclick: () => set(bid + 0.1) }, '+')));
}
function offersTo(m) {
  const offs = view.offersToMe.filter(o => o.market === m);
  if (!offs.length) return null;
  return h('div.offers', h('span.lbl', 'Carry offers to you here'), offs.map(o => { const on = plan.accept.some(a => a.deal_id === o.id);
    return h('div.offer', garmentEl(o.design, null, styleOf(o.carried), brandName(o.carried), { cls: 'gsvg sm' }),
      h('div', h('b', brandName(o.carried)), h('p.note', 'Pays you ' + money1(view.pub.CARRY.fee) + ' plus your partner share if you win this seat again. You see their design: ' + tilesCaps(o.design).toLowerCase() + '.')),
      h('button.btn' + (on ? '.primary' : ''), { onclick: () => { plan.accept = on ? plan.accept.filter(a => a.deal_id !== o.id) : [...plan.accept, { deal_id: o.id }]; changed(); } }, on ? 'Accepted' : 'Accept')); }));
}
function markets() {
  const m = MARKETS[selM] ? selM : 'berlin', pm = view.pub.markets[m];
  const v = check(), cost = v.cost.by[m];
  const pressure = pm.pressure === 'high' ? 'Only a good fit sells here.' : pm.pressure === 'medium' ? 'A global product half sells here; a fit sells better.' : 'A global product still sells here.';
  return h('div.mkts', marketStrip(),
    h('div.brief',
      h('div.brief-l',
        h('div.brief-head', h('h2.serif-h', pm.name), h('p.lead', pm.blurb), h('p.press' + (pm.pressure === 'high' ? '.hi' : ''), h('span.lbl', 'Pressure to localize'), ' ' + (pm.pressure === 'high' ? 'High. ' : pm.pressure === 'medium' ? 'Medium. ' : 'Low. ') + pressure)),
        h('div.sec-h', h('span.lbl', 'What buyers want'), h('span.note', 'Weights are public; a tile shows once you have learned it')),
        h('div.tastes', ROWS.map(r => tasteCard(m, r))),
        h('div.sec-h', h('span.lbl', 'Costs and barriers')),
        costsList(m)),
      h('div.brief-r',
        h('div.sec-h', h('span.lbl', 'Choose your entry mode'), !plan.markets[m] ? h('span.note.warnt', 'Not decided yet') : null),
        modeCards(m),
        lineSettings(m),
        bidBox(m),
        pm.rules.research ? h('div.research', h('div', h('span.lbl', 'Research'), h('p.note', 'Reveals one more taste row here at the end of this season.')),
          h('button.btn' + (plan.research.includes(m) ? '.primary' : ''), { onclick: () => { plan.research = plan.research.includes(m) ? plan.research.filter(x => x !== m) : [...plan.research, m]; changed(); } },
            plan.research.includes(m) ? 'Research bought · ' + money(view.pub.FOG.researchFee) : 'Buy research · ' + money(view.pub.FOG.researchFee))) : h('div.research', h('span.lbl', 'Research'), h('p.note', 'No research firm in ' + pm.name + '.')),
        offersTo(m),
        cost ? h('div.linecost', h('span.lbl', 'Cash held for ' + pm.name), h('b', money(cost.held)),
          h('span.note', 'production ' + money(cost.primary.production) + ' incl. tax ' + money(cost.primary.tax) + (cost.primary.duty ? ' · duty ' + money(cost.primary.duty) : '') + (cost.primary.setup ? ' · set-up ' + money(cost.primary.setup) : '') + (cost.primary.carry ? ' · carry fee ' + money(cost.primary.carry) : '') + (cost.fallback && cost.held > cost.primary.total + 1e-9 ? ' · the dearer fallback is held' : ''))) : null,
        h('div.why', h('label.lbl', { for: 'why' }, 'Why this plan? (one sentence, optional, read out in the debrief)'),
          h('textarea#why', { rows: 2, value: why, onchange: ev => { why = ev.target.value; save(); } })))));
}

// ---------- rival lookbook ----------
function lookbook() {
  const items = [];
  for (let s = view.season - 1; s >= 1; s--) {
    const R = reveals[s];
    if (!R) continue;
    const by = {};
    for (const m of MARKET_IDS) for (const l of (R.markets[m] || { lines: [] }).lines) {
      if (l.team === seat.team_id || !l.win) continue;   // winners only (10/26): only a market winning piece is ever shown
      const k = l.team + '|' + l.design;
      by[k] = by[k] || { season: s, team: l.team, design: l.design, tiles: l.tiles, look: R.looks && R.looks[l.team] ? R.looks[l.team][l.design] : null, sold: [], winner: [] };
      by[k].sold.push({ m, share: l.share });
      if ((R.winners || []).some(w => w.market === m && w.team === l.team && w.design === l.design)) by[k].winner.push(m);
    }
    Object.values(by).sort((a, b) => b.winner.length - a.winner.length || Math.max(...b.sold.map(x => x.share)) - Math.max(...a.sold.map(x => x.share))).forEach(x => items.push(x));
  }
  const full = plan.designs.length + plan.copy.length >= view.pub.DESIGN.maxPerSeason;
  const intro = h('div.lb-intro', h('h2.serif-h', 'What your rivals put out.'),
    h('p', 'Every winning piece from earlier reveals (only winners are shown). A market\'s best seller can be copied: no design fee, but it counts toward your ' + view.pub.DESIGN.maxPerSeason + ' pieces, the projector names it, and Berlin and Tokyo courts fine a copy ' + money1(view.pub.COPY.suitFine) + '.'));
  if (!items.length) return h('div.lookbook', intro, h('div.empty', h('p', view.season === 1 ? 'Nothing yet. After the first reveal, each market winning piece shows up here.' : 'No rival has won a market in the reveals so far.')));
  let lastS = 0;
  return h('div.lookbook', intro, items.map(x => {
    const hd = x.season !== lastS ? h('div.lb-season', h('span.lbl', 'Season ' + x.season)) : null; lastS = x.season;
    const can = x.winner.length > 0;
    const taken = plan.copy.some(c => c.from_team === x.team && c.design === x.design && c.season === x.season);
    const lk = cleanLook(x.look, x.tiles);
    return [hd, h('article.lcard' + (x.winner.length ? '.win' : ''),
      garmentEl(x.tiles, x.look, styleOf(x.team), brandName(x.team), { cls: 'gsvg lb' }),
      h('div.lc-brand', markEl(styleOf(x.team), 22), h('b', brandName(x.team)), tag({ house: isHouse(x.team) })),
      h('div.lc-name', lk.name),
      h('div.lc-cap', tilesCaps(x.tiles)),
      h('div.lc-sold', x.sold.map(s => h('span' + (x.winner.includes(s.m) ? '.best' : ''), MARKETS[s.m].name + ' ' + pctf(s.share) + (x.winner.includes(s.m) ? ' · best seller' : '')))),
      can ? h('button.btn', { disabled: taken || full, onclick: () => {
        const id = 'X' + (Math.max(0, ...plan.copy.map(copyNo)) + 1);
        plan.copy.push({ id, from_team: x.team, design: x.design, season: x.season, market: x.winner[0] }); selD = id; toast('Copied into your collection as ' + id + '. Place it in a market.'); changed(); } },
        taken ? 'In your collection' : full ? 'Collection full' : 'Copy this look') : h('span.note', 'Taken'))];
  }));
}

// ---------- decide screen ----------
function decideScreen() {
  let body;
  if (tab === 'markets') body = markets();
  else if (tab === 'lookbook') body = lookbook();
  else body = h('div', h('h1.serif-h.page-h', 'Build your next collection.'), studio());
  return [header(true), thread(), h('main.tp-main', body), dock(), brandSheet()];
}

const savedRuns = () => !game.settings || game.settings.savedPlanRuns !== false;

// ---------- results ----------
function myLook(r, designId) {
  const d = r.plan && r.plan.designs ? r.plan.designs.find(x => x.id === designId) : null;
  if (d) return d.look || null;
  const c = r.plan && r.plan.copy ? r.plan.copy.find((x, i) => copyId(x, i) === designId) : null;
  return c ? lookFromReveal(c.season, c.from_team, c.design) : null;
}
function resultScreen() {
  const r = result, m = r.mine;
  const banner = r.savedRan ? 'Time ran out before you locked, so the plan saved on your page ran.'
    : r.stood ? 'Your last plan stood. You did not lock a plan this season' + (r.engineError ? ' (' + r.engineError + ')' : '') + ', so last season\'s plan ran again.'
    : r.locked && (r.plan && (r.plan.designs.length || r.plan.copy.length)) ? 'Your locked plan ran.'
    : 'You sat this season out. ' + (r.engineError ? r.engineError : 'No plan was locked and there was no earlier plan to repeat.');
  const lastSeason = r.season >= view.seasons;
  const cards = MARKET_IDS.filter(x => r.lines[x]).map(x => { const l = r.lines[x];
    const other = l.costs.setup_paid + l.costs.partner_fee + l.costs.seat_paid;
    return h('article.rcard', garmentEl(l.tiles, myLook(r, l.design), myStyle(), view.team.name, { cls: 'gsvg md' }),
      h('div.rc-body',
        h('div.rc-top', h('span.wm.rc-city', MARKETS[x].name), h('b.rc-profit' + (l.profit < 0 ? '.neg' : '.pos'), (l.profit >= 0 ? '+' : '') + money(l.profit))),
        h('div.rc-mode', MODE_LABEL[l.mode] + (l.requested && l.requested !== l.mode ? ' (you planned ' + MODE_LABEL[l.requested] + ')' : '') + ' · ' + PRICE_LABEL[l.price] + ' · ' + l.run + 'k made'),
        h('div.share', h('div.share-bar', h('i', { style: 'width:' + Math.min(100, l.share * 100).toFixed(1) + '%' })), h('span', pctf(l.share) + ' of buyers · ' + l.buyers.toFixed(1) + 'k sold · fit ' + pctf(l.fit))),
        h('div.kv2.sm', h('span', 'Revenue'), h('b', money(l.revenue)), h('span', 'Production (incl. tax ' + money(l.costs.tax_paid) + ')'), h('b', '-' + money(l.costs.production || 0)),
          l.costs.duty_paid ? [h('span', 'Duty'), h('b', '-' + money(l.costs.duty_paid))] : null, other ? [h('span', 'Set-up, partner fees, seat'), h('b', '-' + money(other))] : null)));
  });
  return h('div.results',
    h('div.res-head', h('span.lbl', 'Season ' + r.season + ' of ' + view.seasons), h('h1.serif-h', 'How your season sold.'), h('p.banner', banner)),
    h('div.bignums',
      h('div', h('span.lbl', 'Season profit'), h('b' + (m.seasonProfit < 0 ? '.neg' : ''), money1(m.seasonProfit))),
      h('div', h('span.lbl', 'Cash now'), h('b', money1(m.cashEnd))),
      h('div', h('span.lbl', 'Foreignness tax paid'), h('b', money1(m.taxPaid))),
      h('div', h('span.lbl', m.receivables ? 'Still owed to you' : 'Design fees'), h('b', money1(m.receivables || m.designFees)))),
    cards.length ? h('div.rcards', cards) : h('p.empty', 'You did not sell anywhere this season.'),
    h('div.res-events', h('span.lbl', 'What happened to you'), h('ul', r.events.filter(e => e.type !== 'plan').map(e => h('li', e.text)))),
    !lastSeason ? carryPanel() : h('p.note', 'That was the last season. The final ranking appears when the clock at the top runs out.'));
}
function carryPanel() {
  const r = result;
  const opts = MARKET_IDS.filter(m => r.seats[m] && r.seats[m] !== seat.team_id && !view.brands[r.seats[m]].house);
  const mine = (r.plan && r.plan.designs) || [];
  if (!opts.length || !mine.length) return h('div.carry', h('span.lbl', 'Carry offers'), h('p.note', 'No other human team holds a partner seat this season, so there is nobody to offer a carry to.'));
  const f = { m: opts[0], d: mine[0].id };
  return h('div.carry', h('span.lbl', 'Offer a carry for next season'),
    h('p', 'A partner-seat holder can carry your line next season for ' + money1(view.pub.CARRY.fee) + '. They see your design and may copy it. They must accept and win the seat again. Offers close when the clock runs out.'),
    notes.filter(n => n.type === 'carry').map(n => h('p.offer-made', 'Offered in ' + MARKETS[n.market].name + ' with ' + n.design.id + ' ', h('button.btn.ghost.sm', { onclick: async () => { notes.splice(notes.indexOf(n), 1); await store.patchDecision(game.id, seat.team_id, result.season, { notes }); render(); } }, 'Withdraw'))),
    h('div.carry-row',
      h('div', h('label.lbl', 'Market'), h('select', { onchange: ev => { f.m = ev.target.value; } }, opts.map(m => h('option', { value: m }, MARKETS[m].name + ' (held by ' + brandName(r.seats[m]) + ')')))),
      h('div', h('label.lbl', 'Your piece'), h('select', { onchange: ev => { f.d = ev.target.value; } }, mine.map(d => h('option', { value: d.id }, d.id + ': ' + cleanLook(d.look, d).name)))),
      h('button.btn.primary', { onclick: async () => {
        if (notes.some(n => n.type === 'carry' && n.market === f.m)) return toast('One offer per market.');
        const d = mine.find(x => x.id === f.d);
        notes.push({ type: 'carry', market: f.m, design: { id: d.id, cut: d.cut, palette: d.palette, logo: d.logo, fabric: d.fabric } });
        await store.patchDecision(game.id, seat.team_id, result.season, { notes }); toast('Offer saved'); render(); } }, 'Make offer')));
}
function revealWait() {
  const idx = Math.min((game.reveal || { idx: 0 }).idx, MARKET_IDS.length - 1), m = MARKET_IDS[idx], line = plan && plan.markets[m];
  const p = line && line.mode && line.mode !== 'none' ? pieceById(line.design) : null;
  return h('div.rwait', h('span.lbl', 'Season ' + game.round + ' is out'), h('h1.serif-h', 'Now on the projector: ' + MARKETS[m].name + '.'),
    p ? h('div.rw-piece', gEl(p, { cls: 'gsvg lg' }), h('div', h('span.lbl', 'Your entry here'), h('b.rw-name', cleanLook(p.look, p.tiles).name), h('p', MODE_LABEL[line.mode] + ' · ' + PRICE_LABEL[line.price] + ' · ' + line.run + 'k made')))
      : h('p.lead', 'You did not enter ' + MARKETS[m].name + ' this season.'),
    h('p.note', 'Your own results arrive here after the fourth market.'));
}

// ---------- lobby, final ----------
function lobbyScreen() {
  const b = BRAND_BY_ID[team.brand_id];
  const others = allTeams.filter(t => t.team_id !== seat.team_id);
  return [header(false), h('main.tp-main.lobby',
    h('h1.serif-h.page-h', 'Welcome to ' + b.name + '.'),
    h('p.lead', 'Your instructor starts the game. While you wait, set the mark and colour your pieces will carry.'),
    h('p.note', 'Not you? ', h('button.btn.ghost.sm', { onclick: async () => { try { await store.upsertSeat({ ...seat, removed: true }); } catch (e) { /* the seat is forgotten here either way */ } forgetSeat(game.id); location.href = location.pathname; } }, 'Leave this team')),
    brandEditor(false),
    h('div.dna', h('span.lbl', 'Your brand tiles'), h('p', 'Two tiles are on-brand and free to use. One is off-brand and costs extra. Every other tile adds a small surcharge.'),
      h('div.dna-row', b.free.map(f => h('span.dtile.free', h('span.lbl', ROW_LABEL[f.row]), h('b', tileLabel(f.row, f.tile)), h('span', 'free'))),
        h('span.dtile.costly', h('span.lbl', ROW_LABEL[b.costly.row]), h('b', tileLabel(b.costly.row, b.costly.tile)), h('span', 'off-brand, costly')))),
    h('div.rivals', h('span.lbl', 'Brands in the room'), h('div.rv-grid', others.map(t => h('div.rv', markEl(styleOf(t.team_id), 26), h('b', t.name), tag({ house: t.house })))))), brandSheet()];
}
function finalScreen() {
  const st = finalSnap && finalSnap.standings;
  if (!st) return h('main.tp-main', h('p', 'Game over. Waiting for the final ranking.'));
  const mine = st.ranked.find(x => x.team === seat.team_id);
  return h('main.tp-main.final',
    h('span.lbl', 'Final ranking'), h('h1.serif-h.page-h', mine ? 'You finished #' + mine.rank + '.' : 'The season is over.'),
    mine ? h('p.lead', 'Profit after season ' + view.seasons + ': ' + money(mine.profit) + '.') : null,
    h('ol.rank', st.ranked.map(x => h('li' + (x.team === seat.team_id ? '.me' : ''), h('span.rk', '#' + x.rank), markEl(styleOf(x.team), 26), h('b', x.name), h('span.rp', money(x.profit))))),
    st.house.length ? h('div.house-list', h('span.lbl', 'House brands (not ranked)'), st.house.map(x => h('div', x.name + ' ' + money(x.profit)))) : null,
    result ? resultScreen() : null);
}

// ---------- practice bid (10/27): kept on this phone only, never written to the store ----------
const practiceKey = () => 'ft:practice:' + (game ? game.id : '') + ':' + (seat ? seat.id : '');
function practiceCtx() {
  const v = Number(safeGet(practiceKey()));
  return { teamCount: game.team_count || (allTeams || []).length || 8, bid: v > 0 ? v : null, setBid: x => { safeSet(practiceKey(), String(x)); render(); } };
}

// ---------- clock paint, render ----------
function paintClock() {
  if (!game || !game.clock) return;
  const left = clockLeft(game.clock, Date.now()), low = game.phase === 'decide' && !game.clock.paused && left <= 30000;
  $$('.js-tclock').forEach(el => { el.textContent = mmss(left); });
  $$('.timer').forEach(el => el.classList.toggle('low', low));
  const note = $('.js-lock-note');
  if (note) note.textContent = game.phase !== 'decide' || game.clock.paused || left > 30000 || locked ? '' : left > 0 ? ' Under 30 seconds. ' + (savedRuns() ? 'At zero the plan saved on this page runs.' : 'Lock now or your last plan stands.') : ' Time is up.';
}

function render() {
  if (!game || !team) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && /text|number|search/.test(ae.type))) && app.contains(ae)) return;
  let body;
  if (game.phase === 'lobby') body = lobbyScreen();
  else if (game.phase === 'example') body = [header(false), h('main.tp-main', exampleScreen((game.reveal && game.reveal.idx) || 0, 'team', practiceCtx()))];
  else if (!view) body = [header(false), h('main.tp-main', h('p', 'Loading your season...'))];
  else if (game.phase === 'final') body = [header(false), finalScreen()];
  else if (game.phase === 'decide') body = plan ? decideScreen() : [header(false), h('main.tp-main', 'Loading...')];
  else if (game.phase === 'reveal') body = [header(false), h('main.tp-main', result ? resultScreen() : revealWait())];
  else body = [header(false), h('main.tp-main', h('p', 'Waiting for the host.'))];
  const y = window.scrollY;
  document.body.classList.toggle('has-dock', game.phase === 'decide' && !!plan && !!view);
  app.replaceChildren(...[body].flat(Infinity).filter(Boolean));
  window.scrollTo(0, y);
  paintClock();
}

async function start() {
  clearInterval(tick);
  await load(); render();
  store.subscribe(seat.game_id, async () => { if (await load()) render(); });
  tick = setInterval(paintClock, 250);
  setInterval(() => heartbeat(store, seat).catch(() => {}), 30000);
}

(async function main() {
  try {
    store = await openStore();
    const saved = savedSeat(params().get('g') || undefined);
    if (saved) {
      const r = await resumeSeat(store, saved);
      if (r.status === 'ok' || r.status === 'gameover') { seat = r.seat; return start(); }
      if (r.status === 'replaced') return joinScreen('This seat was taken over on another screen.', r);
    }
    joinScreen();
  } catch (e) { app.replaceChildren(h('div.join', h('h1', 'Could not start'), h('p.err', friendlyError(e)))); }
})();
window.__team = () => ({ game, view, result, plan, team, styles, reveals });
