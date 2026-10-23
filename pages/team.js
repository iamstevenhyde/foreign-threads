// Team page: join with a code, design garments, choose how to enter each market, lock, then read the results.
// Reads only 'view' and 'result' snapshots the host published (fog already applied). Writes only this team's ww_decisions row.
import { openStore, savedSeat, resumeSeat, lookupCode, takeNewSeat, takeOverSeat, heartbeat, forgetSeat } from './supa.js';
import { h, $, params, setParam, toast, debounce, mmss, friendlyError } from './util.js';
import { validateWith } from '../engine/core.mjs';
import { ROWS, ROW_LABEL, TILES, tileLabel, MARKETS, MARKET_IDS, BRANDS, BRAND_BY_ID, dnaState, dnaChips, tag, garmentImg, tilesText, money, money1, pctf,
  MODE_LABEL, PRICE_LABEL, streetSrc, art, GAME_TITLE } from './ui.js';

const app = $('#app');
let planP = null, store, seat = null, game = null, team = null, view = null, result = null, finalSnap = null, plan = null, why = '', locked = false, notes = [], sig = '', planSeason = 0, tick = null;

const blank = () => ({ designs: [], markets: {}, research: [], copy: [], accept: [] });
const clone = x => JSON.parse(JSON.stringify(x));

// ---------- join ----------
function joinScreen(msg, resume) {
  const hint = params().get('g');
  const el = h('div.wrap', h('h1', GAME_TITLE), h('p', 'Enter the four-character code your instructor gave your team.'),
    msg ? h('p.err', msg) : null,
    h('div.card', h('div.row',
      h('div', h('label', 'Team code'), h('input#code', { maxlength: 4, style: 'text-transform:uppercase;width:90px;font:700 22px monospace' })),
      h('div', h('label', 'Your name'), h('input#nm', { placeholder: 'optional' })),
      h('button.primary', { onclick: async () => {
        try {
          const st = store;
          const found = await lookupCode(st, $('#code').value, hint);
          if (found.error) return joinScreen(found.error);
          if (found.team.house) return joinScreen('That is a house (AI) team. Ask your instructor for your own code.');
          const act = (found.game.settings || {}).active;
          if (found.game.phase !== 'lobby' && act && !act.includes(found.team.team_id)) return joinScreen('The game started before anybody joined that team. Ask your instructor.');
          const r = await takeNewSeat(st, found.game, found.team, $('#nm').value);
          if (r.error) return joinScreen(r.error);
          setParam('g', found.game.id); seat = r.seat; start();
        } catch (e) { joinScreen(friendlyError(e)); }
      } }, 'Join'))),
    resume ? h('div.card', h('p', 'You already have this seat on another screen.'), h('button', { onclick: async () => { await takeOverSeat(store, resume.game, resume.seat); seat = (await store.getSeats(resume.game.id)).find(x => x.id === resume.seat.id); start(); } }, 'Take over this seat here')) : null);
  app.replaceChildren(el);
}

// ---------- data ----------
async function load() {
  game = await store.getGame(seat.game_id);
  if (!game) return;
  team = (await store.getTeams(game.id)).find(t => t.team_id === seat.team_id);
  const r = game.round || 0;
  if (r > 0) {
    const v = (await store.getSnapshots(game.id, { kind: 'view', round: r, teamId: seat.team_id }))[0];
    view = v ? v.data.view : null;
    const rs = (await store.getSnapshots(game.id, { kind: 'result', round: r, teamId: seat.team_id }))[0];
    result = rs ? rs.data : null;
    if (planSeason !== r && view) { if (!planP || planP.r !== r) { planP = initPlan(r); planP.r = r; } await planP; }
  }
  finalSnap = game.phase === 'final' ? ((await store.getSnapshots(game.id, { kind: 'final' }))[0] || {}).data || null : null;
  const s = [game.phase, game.round, !!view, !!result, !!finalSnap, game.reveal && game.reveal.idx].join('|');
  const changed = s !== sig; sig = s;
  return changed;
}

async function initPlan(r) { await initPlanInner(r); planSeason = r; }
async function initPlanInner(r) {
  plan = null;
  const row = (await store.getDecisions(game.id, r)).find(d => d.team_id === seat.team_id);
  notes = (row && row.notes) || [];
  if (row && row.plan && (row.plan.designs || row.plan.markets)) { plan = { ...blank(), ...clone(row.plan) }; why = row.why || ''; locked = !!row.locked; return; }
  locked = false; why = '';
  plan = blank();
  if (view.lastPlan) {
    const lp = clone(view.lastPlan);
    plan.designs = lp.designs || [];
    for (const m of MARKET_IDS) {
      const l = (lp.markets || {})[m];
      if (l && l.mode && l.mode !== 'none' && l.mode !== 'carried' && plan.designs.some(d => d.id === l.design)) plan.markets[m] = { ...l, bid: l.bid || 0 };
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

const save = debounce(async () => {
  try { await store.patchDecision(game.id, seat.team_id, planSeason, { plan, why }); } catch (e) { toast(friendlyError(e), 6000); }
}, 350);
function changed(rerender = true) { save(); if (rerender) render(); }

// ---------- helpers ----------
const copyId = (c, i) => c.id || 'X' + (i + 1);
const designIds = () => [...plan.designs.map(d => d.id), ...plan.copy.map(copyId)];
const tilesOfDesign = id => plan.designs.find(d => d.id === id) || (() => { const c = plan.copy.map((x, i) => [copyId(x, i), x]).find(([k]) => k === id); if (!c) return null; const w = view.publicWinners.find(w => w.team === c[1].from_team && w.design === c[1].design && w.season === c[1].season); return w ? w.tiles : null; })();
const brandName = id => (view.brands[id] || { name: id }).name;
const env = () => ({ season: view.season, publicWinners: view.publicWinners, house: false });
const check = () => validateWith(view.pub, view.ctx, planForEngine(), env());
function planForEngine() {
  const p = clone(plan);
  // The engine reads a market line only when it has a mode; drop empty lines so a stale bid never escrows by accident
  for (const m of Object.keys(p.markets)) if (!p.markets[m] || ((!p.markets[m].mode || p.markets[m].mode === 'none') && !(Number(p.markets[m].bid) > 0))) delete p.markets[m];
  return p;
}
function fitHint(m, tiles) {
  const k = view.known[m]; let hit = 0, n = 0;
  for (const row of ROWS) if (k[row]) { n++; if (k[row].tile === tiles[row]) hit++; }
  return { hit, n };
}

// ---------- decision screen ----------
function designCard(d, i) {
  const set = (row, v) => { d[row] = v; changed(); };
  const sels = ROWS.map(row => h('div', h('label', ROW_LABEL[row]),
    h('select', { onchange: ev => set(row, ev.target.value) }, TILES[row].map(t => {
      const st = dnaState(view.team.brandId, row, t.id);
      return h('option', { value: t.id, selected: d[row] === t.id }, t.label + (st === 'free' ? ' (brand tile, free)' : st === 'costly' ? ' (off-brand, costly)' : ''));
    }))));
  const fee = view.pub.DESIGN.extraFee[Math.min(i, view.pub.DESIGN.extraFee.length - 1)];
  return h('div.card.design', garmentImg(d), h('div', { style: 'flex:1' }, h('h3', 'Design ' + d.id), h('div.sel', sels),
    h('p.small.muted', 'Design fee $' + fee.toFixed(1) + 'M. Each tile that is not one of your brand tiles adds a surcharge shown in the cost summary.'),
    plan.designs.length > 1 || plan.copy.length ? h('button.small', { onclick: () => { plan.designs.splice(i, 1); for (const m of Object.keys(plan.markets)) if (plan.markets[m].design === d.id) plan.markets[m].design = designIds()[0] || ''; changed(); } }, 'Remove design') : null));
}

function marketCard(m) {
  const pm = view.pub.markets[m], k = view.known[m], line = plan.markets[m] || { mode: 'none' };
  const modes = ['none', ...pm.rules.modes];
  const offer = view.myOffers.find(o => o.market === m);
  if (offer) modes.push('carried');
  const taxIdx = Math.min(view.active[m] || 0, pm.taxBySeason.length - 1), tax = pm.taxBySeason[taxIdx];
  const set = (patch) => { plan.markets[m] = { mode: 'none', design: designIds()[0] || '', price: 'standard', run: 50, bid: 0, fallback: 'none', ...plan.markets[m], ...patch }; changed(); };
  const ids = designIds();
  const chosen = line.mode && line.mode !== 'none' ? tilesOfDesign(line.design) : null;
  const hint = chosen ? fitHint(m, chosen) : null;
  const cost = (() => { try { return check().cost.by[m]; } catch (e) { return null; } })();
  const lastHolder = view.lastSeats[m];
  return h('div.card.mk', h('h3', h('span', pm.name), h('span.small.muted', 'pool ' + pm.pool + 'k buyers')),
    h('p.small.muted', pm.blurb),
    h('div', [pm.rules.dutyShipped ? h('span.chip', Math.round(pm.rules.dutyShipped * 100) + '% duty on shipped goods') : null,
      pm.rules.paymentLagSeasons ? h('span.chip', 'revenue arrives ' + pm.rules.paymentLagSeasons + ' season(s) late') : null,
      h('span.chip', pm.rules.court ? 'courts enforce copyright' : 'no court'), h('span.chip', pm.rules.research ? 'research firm: $' + view.pub.FOG.researchFee + 'M' : 'no research firm'),
      h('span.chip', 'local rival: ' + pm.incumbent.name),
      pm.pressure ? h('span.chip.hot', (pm.pressure === 'high' ? 'High' : 'Low') + ' pressure to localize: ' + (pm.pressure === 'high' ? 'only a good fit sells' : 'a global product still sells')) : null,
      pm.shipReachBonus ? h('span.chip', 'shipping reaches almost as many buyers as a partner here') : null,
      pm.rules.walkShare ? h('span.chip', 'a partner keeps ' + Math.round(pm.rules.walkShare * 100) + '% of your sales here') : null]),
    h('div.kv', h('span', 'What you know'), h('span', ROWS.map(row => k[row] ? h('span.chip.hot', ROW_LABEL[row] + ': ' + tileLabel(row, k[row].tile) + ' (' + k[row].tier + ' weight)') : h('span.chip', ROW_LABEL[row] + ': unknown')).flat()),
      h('span', 'Foreignness tax'), h('span', Math.round(tax * 100) + '% of unit cost this season' + ' (' + Math.round(tax * view.pub.PARTNER_TAX_CUT * 100) + '% with a partner)'),
      h('span', 'Last season'), h('span', lastHolder ? brandName(lastHolder) + ' held the partner seat, ' + (view.lastCrowd[m] || 0) + ' sellers' : view.season > 1 ? 'nobody held the seat' : 'no history yet')),
    h('div.row', { style: 'margin-top:8px' },
      h('div', h('label', 'How you enter'), h('select', { onchange: ev => { const v = ev.target.value; if (v === 'none') { plan.markets[m] = { ...(plan.markets[m] || {}), mode: 'none' }; changed(); } else {
          if (v === 'carried') { const od = offer.design; let own = plan.designs.find(d => ROWS.every(r => d[r] === od[r])); if (!own) { own = { ...od, id: od.id && !designIds().includes(od.id) ? od.id : 'D' + (plan.designs.length + plan.copy.length + 1) }; plan.designs.push(own); } set({ mode: v, design: own.id }); } else set({ mode: v }); } } },
        modes.map(x => h('option', { value: x, selected: line.mode === x || (!line.mode && x === 'none') }, x === 'carried' ? 'Carried by ' + brandName(offer.holder) + ' (fee $' + view.pub.CARRY.fee + 'M)' : MODE_LABEL[x] + (x === 'own' ? ' (set-up $' + view.pub.MODES.own.setup + 'M' + (view.owned[m] ? ', already paid' : '') + ')' : ''))))),
      line.mode && line.mode !== 'none' ? [
        h('div', h('label', 'Design'), h('select', { onchange: ev => set({ design: ev.target.value }) }, ids.map(id => h('option', { value: id, selected: line.design === id }, id)))),
        h('div', h('label', 'Price'), h('select', { onchange: ev => set({ price: ev.target.value }) }, Object.keys(view.pub.PRICES).map(p => h('option', { value: p, selected: line.price === p }, PRICE_LABEL[p] + ' $' + view.pub.PRICES[p] + ', costs x' + ((view.pub.TIER_COST || {})[p] || 1) + ' to make')))),
        h('div', h('label', 'Garments made (thousands)'), h('select', { onchange: ev => set({ run: Number(ev.target.value) }) }, view.pub.RUNS.sizes.map(r => h('option', { value: r, selected: line.run === r }, r + 'k, $' + view.pub.RUNS.unitCost[r] + ' each')))),
        line.mode === 'partner' || line.mode === 'ship' ? h('div', h('label', 'If your seat bid loses, fall back to'), h('select', { onchange: ev => set({ fallback: ev.target.value }) },
          ['none', 'ship', 'own'].filter(x => x === 'none' || pm.rules.modes.includes(x)).map(x => h('option', { value: x, selected: (line.fallback || 'none') === x }, x === 'none' ? 'Sit out' : MODE_LABEL[x])))) : null] : null),
    h('div.row', { style: 'margin-top:6px' },
      h('div', h('label', 'Sealed bid for the local partner seat ($M, max ' + view.bidCap.toFixed(2) + ', 0 = no bid)'),
        h('input', { type: 'number', min: 0, step: 0.1, value: line.bid || 0, style: 'width:90px', onchange: ev => set({ bid: Number(ev.target.value) || 0 }) })),
      pm.rules.research ? h('label', { style: 'display:flex;gap:6px;align-items:center;color:var(--ink)' }, h('input', { type: 'checkbox', checked: plan.research.includes(m),
        onchange: ev => { plan.research = ev.target.checked ? [...plan.research, m] : plan.research.filter(x => x !== m); changed(); } }), 'Buy research (reveals one more row, $' + view.pub.FOG.researchFee + 'M)') : null),
    hint ? h('p.small', 'This design matches ' + hint.hit + ' of the ' + hint.n + ' rows you can see here.') : null,
    cost ? h('p.small.muted', 'Cash held for this line: ' + money(cost.held) + ' (production ' + money(cost.primary.production) + ' incl. tax ' + money(cost.primary.tax) + (cost.primary.duty ? ', duty ' + money(cost.primary.duty) : '') + (cost.primary.setup ? ', set-up ' + money(cost.primary.setup) : '') + (cost.primary.carry ? ', carry fee ' + money(cost.primary.carry) : '') + ')') : null);
}

function copyPanel() {
  const seen = view.publicWinners.filter(w => w.team !== seat.team_id);
  if (!seen.length) return null;
  return h('div.card', h('h2', 'Designs shown in earlier reveals'), h('p.small.muted', 'You may copy any of these. A copy costs no design fee but counts toward your four designs, is announced on the projector, and in Berlin and Tokyo the original owner can sue you for $' + view.pub.COPY.suitFine + 'M.'),
    h('table', h('tbody', seen.map(w => {
      const taken = plan.copy.some(c => c.from_team === w.team && c.design === w.design && c.season === w.season);
      return h('tr', h('td', 'Season ' + w.season), h('td', MARKETS[w.market].name), h('td', brandName(w.team) + ' ' + w.design), h('td', tilesText(w.tiles)),
        h('td', h('button.small', { disabled: taken || plan.designs.length + plan.copy.length >= view.pub.DESIGN.maxPerSeason, onclick: () => { plan.copy.push({ id: 'X' + (plan.copy.length + 1), from_team: w.team, design: w.design, season: w.season, market: w.market }); changed(); } }, taken ? 'Copied' : 'Copy this')));
    }))),
    plan.copy.length ? h('div', plan.copy.map((c, i) => h('p', h('b', copyId(c, i)), ' copy of ' + brandName(c.from_team) + ' ' + c.design + ' ', h('button.small', { onclick: () => { plan.copy.splice(i, 1); for (const m of Object.keys(plan.markets)) if (plan.markets[m].design === copyId(c, i)) plan.markets[m].design = designIds()[0] || ''; changed(); } }, 'Remove')))) : null);
}

function offersPanel() {
  if (!view.offersToMe.length) return null;
  return h('div.card', h('h2', 'Carry offers to you'), h('p.small.muted', 'You hold (or may win) a partner seat. Accepting means you carry their line for the fee and you see the design. It only applies if you win the seat this season.'),
    view.offersToMe.map(o => { const on = plan.accept.some(a => a.deal_id === o.id);
      return h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--ink);font-size:15px' }, h('input', { type: 'checkbox', checked: on, onchange: ev => { plan.accept = ev.target.checked ? [...plan.accept, { deal_id: o.id }] : plan.accept.filter(a => a.deal_id !== o.id); changed(false); } }),
        'Carry ' + brandName(o.carried) + ' in ' + MARKETS[o.market].name + ': ' + tilesText(o.design) + ' (fee $' + view.pub.CARRY.fee + 'M to you)'); }));
}

function decideScreen() {
  const v = check(), c = v.cost, left = game.clock ? Math.max(0, game.clock.endsAt - Date.now()) : 0;
  const lockBar = h('div.lock',
    h('span', 'Plan needs ', h('b', money(c.total)), ' of your ', h('b', money(view.cash)), ' ', v.ok ? h('span.ok', 'OK') : h('span.err', 'too many problems to lock')),
    h('span.muted.small', 'fees ' + money(c.fees) + ', brand surcharge ' + money(c.dna) + ', lines ' + money(c.lines) + ', seat bids ' + money(c.escrow) + ', research ' + money(c.research)),
    locked ? h('b.ok', 'LOCKED') : null,
    locked ? h('button', { onclick: async () => { locked = false; await store.patchDecision(game.id, seat.team_id, planSeason, { locked: false }); render(); } }, 'Unlock to edit')
      : h('button.primary', { disabled: !v.ok || !plan.designs.length && !plan.copy.length, onclick: async () => {
        locked = true; await store.patchDecision(game.id, seat.team_id, planSeason, { plan, why, locked: true, locked_by: seat.name, locked_at: new Date().toISOString(), lock_left: Math.round(left / 1000) });
        toast('Locked. Waiting for the other teams.'); render(); } }, 'Lock plan'));
  return h('div', h('div.wrap',
    h('div.card', h('h2', 'Season ' + view.season + ' news'), view.events.length ? view.events.map(e => h('div.news', h('b', e.headline), h('div.small', e.rule))) : h('p.muted', 'No news this season.')),
    view.myOffers.length ? h('div.card', h('h3', 'Your carry offers for this season'), view.myOffers.map(o => h('p.small', MARKETS[o.market].name + ': offered to ' + brandName(o.holder) + ' (' + o.status + '). Choose "Carried" in that market to use it.'))) : null,
    h('h2', 'Your designs'), plan.designs.map(designCard),
    plan.designs.length + plan.copy.length < view.pub.DESIGN.maxPerSeason ? h('button', { onclick: () => { const id = 'D' + (Math.max(0, ...plan.designs.map(d => Number(d.id.slice(1)) || 0)) + 1); plan.designs.push({ ...plan.designs[plan.designs.length - 1], id }); changed(); } }, 'Add a design (more designs cost fees and raise unit cost)') : null,
    copyPanel(),
    h('h2', { style: 'margin-top:14px' }, 'Your markets'), h('div.grid.g2', MARKET_IDS.map(marketCard)),
    offersPanel(),
    h('div.card', h('label', 'Why this plan? (optional, one sentence, used in the debrief)'), h('textarea', { rows: 2, style: 'width:100%', value: why, onchange: ev => { why = ev.target.value; save(); } })),
    v.errors.length ? h('div.card', h('h3.err', 'Fix before you lock'), h('ul', v.errors.map(e => h('li.err', e)))) : null,
    v.warnings.length ? h('div.card', h('h3.warnt', 'Heads up'), h('ul', v.warnings.map(e => h('li.warnt', e)))) : null,
    rulesPanel()), lockBar);
}

function rulesPanel() {
  return h('details.card', h('summary', 'How a season works'), h('ul.small',
    h('li', 'Each design is four tiles: cut, colour, logo, fabric. Each market has a hidden taste. The more tile rows you match, weighted by how much that row matters, the higher your fit.'),
    h('li', 'Buyers in a market are shared out by fit and price, against a local rival. Garments you make but do not sell are written off.'),
    h('li', 'Pressure to localize is how much a market punishes a product that does not match its taste. Dearer price tiers cost more to make.'),
    h('li', 'Ship is cheap but reaches fewer buyers. Partner needs a sealed bid; the highest bid wins the one seat and learns one more row. Own costs a set-up fee.'),
    h('li', 'Foreignness tax falls each season you sell in a market. Rows of the taste are revealed as you sell there.'),
    h('li', 'If you do not lock, your last plan stands. Most profit after season ' + view.seasons + ' wins.')));
}

// ---------- results ----------
function resultScreen() {
  const r = result, m = r.mine;
  const banner = r.stood ? h('div.card', h('b', 'Your last plan stood.'), ' You did not lock a plan this season' + (r.engineError ? ' (' + r.engineError + ')' : '') + ', so last season\'s plan ran again.')
    : r.locked && (r.plan && (r.plan.designs.length || r.plan.copy.length)) ? h('div.card', 'Your locked plan ran.')
    : h('div.card', h('b', 'You sat this season out.'), r.engineError ? ' ' + r.engineError : ' No plan was locked and there was no earlier plan to repeat.');
  const rows = MARKET_IDS.filter(x => r.lines[x]).map(x => { const l = r.lines[x];
    return h('tr', h('td', MARKETS[x].name), h('td', MODE_LABEL[l.mode] + (l.requested && l.requested !== l.mode ? ' (planned ' + MODE_LABEL[l.requested] + ')' : '')),
      h('td', l.tiles ? tilesText(l.tiles) : l.design), h('td.n', pctf(l.fit)), h('td.n', l.buyers.toFixed(1) + 'k'), h('td.n', pctf(l.share)), h('td.n', money(l.revenue)),
      h('td.n', money(l.costs.production || 0)), h('td.n', money(l.costs.tax_paid)), h('td.n', money(l.costs.duty_paid)), h('td.n', money(l.costs.setup_paid + l.costs.partner_fee + l.costs.seat_paid)), h('td.n', h('b', money(l.profit)))); });
  const lastSeason = r.season >= view.seasons;
  return h('div.wrap', h('h2', 'Season ' + r.season + ' results'), banner,
    h('div.card', h('div.kv', h('span', 'Cash at start'), h('span', money(m.cashStart)), h('span', 'Design fees'), h('span', money(m.designFees)), h('span', 'Market profit'), h('span', money(m.marketProfit)),
      h('span', 'Season profit'), h('span', h('b', money(m.seasonProfit))), h('span', 'Foreignness tax paid'), h('span', money(m.taxPaid)), h('span', 'Cash now'), h('span', h('b', money(m.cashEnd))),
      m.receivables ? [h('span', 'Still owed to you'), h('span', money(m.receivables))] : null)),
    h('div.card', h('h3', 'By market'), rows.length ? h('div', { style: 'overflow:auto' }, h('table', h('thead', h('tr', ['Market', 'How', 'Design', 'Fit', 'Buyers', 'Share', 'Revenue', 'Production', 'of which tax', 'Duty', 'Set-up, fees, seat', 'Profit'].map((x, i) => h('th' + (i > 2 ? '.n' : ''), x)))), h('tbody', rows))) : h('p.muted', 'You did not sell anywhere.'),
      h('p.small.muted', 'Profit by market excludes design fees. Production includes the foreignness tax.')),
    h('div.card', h('h3', 'What happened to you'), h('ul.small', r.events.filter(e => e.type !== 'plan').map(e => h('li', e.text)))),
    !lastSeason ? carryPanel() : h('div.card', h('p', 'That was the last season. The final ranking shows once your instructor finishes the game.')));
}

function carryPanel() {
  const r = result;
  const opts = MARKET_IDS.filter(m => r.seats[m] && r.seats[m] !== seat.team_id && !view.brands[r.seats[m]].house);
  const mine = (r.plan && r.plan.designs) || [];
  if (!opts.length || !mine.length) return h('div.card', h('h3', 'Carry offers'), h('p.small.muted', 'No partner seat is held by another human team this season, so there is nothing to offer a carry to.'));
  const f = { m: opts[0], d: mine[0].id };
  return h('div.card', h('h3', 'Offer a carry for next season'), h('p.small.muted', 'The holder of a partner seat can carry your line next season for $' + view.pub.CARRY.fee + 'M, but they see your design and may copy it. They must accept in their plan and win the seat again.'),
    notes.filter(n => n.type === 'carry').map((n, i) => h('p.small', 'Offered in ' + MARKETS[n.market].name + ' with design ' + n.design.id + ' ', h('button.small', { onclick: async () => { notes.splice(notes.indexOf(n), 1); await store.patchDecision(game.id, seat.team_id, result.season, { notes }); render(); } }, 'Withdraw'))),
    h('div.row', h('div', h('label', 'Market'), h('select', { onchange: ev => { f.m = ev.target.value; } }, opts.map(m => h('option', { value: m }, MARKETS[m].name + ' (held by ' + brandName(r.seats[m]) + ')')))),
      h('div', h('label', 'Your design'), h('select', { onchange: ev => { f.d = ev.target.value; } }, mine.map(d => h('option', { value: d.id }, d.id + ': ' + tilesText(d))))),
      h('button', { onclick: async () => {
        if (notes.some(n => n.type === 'carry' && n.market === f.m)) return toast('One offer per market.');
        const d = mine.find(x => x.id === f.d);
        notes.push({ type: 'carry', market: f.m, design: { id: d.id, cut: d.cut, palette: d.palette, logo: d.logo, fabric: d.fabric } });
        await store.patchDecision(game.id, seat.team_id, result.season, { notes }); toast('Offer saved'); render(); } }, 'Make offer')));
}

// ---------- screens ----------
function lobbyScreen() {
  const b = BRAND_BY_ID[team.brand_id];
  return h('div.wrap', h('h1', 'Welcome, ' + b.name), h('p', 'Waiting for your instructor to start. Your brand tiles are below. Brand tiles are free to use; the costly tile carries a surcharge.'),
    h('div.card', h('h3', b.name), dnaChips(b.id)),
    h('div.card', h('h3', 'Every brand in the room'), h('table', h('tbody', BRANDS.map(x => h('tr', h('td', h('b', x.name)), h('td', dnaChips(x.id))))))));
}
function finalScreen() {
  const st = finalSnap && finalSnap.standings;
  if (!st) return h('div.wrap', h('p', 'Game over. Waiting for the final ranking.'));
  const mine = st.ranked.find(x => x.team === seat.team_id);
  return h('div.wrap', h('h1', 'Final ranking'), mine ? h('p.lead', 'You finished #' + mine.rank + ' with a profit of ' + money(mine.profit) + '.') : null,
    h('div.card', h('table', h('thead', h('tr', h('th', '#'), h('th', 'Brand'), h('th.n', 'Profit'))), h('tbody', st.ranked.map(x => h('tr', { style: x.team === seat.team_id ? 'background:var(--acid)' : '' }, h('td', x.rank), h('td', x.name), h('td.n', money(x.profit))))))),
    st.house.length ? h('div.card', h('h3.muted', 'House brands (not ranked)'), h('table', h('tbody', st.house.map(x => h('tr', { style: 'color:var(--muted)' }, h('td', x.name), h('td.n', money(x.profit))))))) : null,
    result ? resultScreen() : null);
}

function header() {
  const left = game.clock && game.phase === 'decide' ? Math.max(0, game.clock.endsAt - Date.now()) : null;
  const b = BRAND_BY_ID[team.brand_id];
  return h('div.bar', h('b', b.name), h('span', GAME_TITLE + (game.round ? ', season ' + game.round + (view ? ' of ' + view.seasons : '') : '')),
    view ? h('span.num', 'Cash ' + money1(result && game.phase !== 'decide' ? result.mine.cashEnd : view.cash)) : null,
    left !== null ? h('span.num', mmss(left)) : null);
}

function render() {
  if (!game || !team) return;
  if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
  let body;
  if (game.phase === 'lobby') body = lobbyScreen();
  else if (!view) body = h('div.wrap', h('p', 'Loading your season...'));
  else if (game.phase === 'final') body = finalScreen();
  else if (game.phase === 'decide') body = plan ? decideScreen() : h('div.wrap', 'Loading...');
  else if (game.phase === 'reveal') body = result ? resultScreen() : h('div.wrap', h('h2', 'Season ' + game.round + ' is being revealed'), h('p', 'Watch the projector. Your own results appear here after the last market.'), h('img', { src: streetSrc(MARKET_IDS[Math.min((game.reveal || { idx: 0 }).idx, 3)]), style: 'max-width:100%;border-radius:6px', onerror: ev => ev.target.remove() }));
  else body = h('div.wrap', h('p', 'Waiting for the host.'));
  const y = window.scrollY;
  app.replaceChildren(header(), body);
  window.scrollTo(0, y);
}

async function start() {
  clearInterval(tick);
  await load(); render();
  store.subscribe(seat.game_id, async () => { if (await load()) render(); });
  tick = setInterval(() => { if (game && game.phase === 'decide') { const b = $('.bar .num:last-child'); if (b && game.clock) b.textContent = mmss(Math.max(0, game.clock.endsAt - Date.now())); } }, 1000);
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
  } catch (e) { app.replaceChildren(h('div.wrap', h('h1', 'Could not start'), h('p.err', friendlyError(e)))); }
})();
window.__team = () => ({ game, view, result, plan, team });
