// Foreign Threads (Live) engine. Pure data in, pure data out: a game is one JSON-safe `state` object, every random draw comes from state.rng
// (one seeded stream), and there is no clock, network or LLM anywhere. Same seed + same plans = same game.
//
// Season flow (the host calls these in order):
//   beginSeason(state)                 draw the event cards, apply them, deal clue cards, open the season
//   teamView(state, teamId)            what that team may see (fog applied); the only thing a bot or a team page reads
//   validatePlan(state, teamId, plan)  hard errors, warnings and the cash a plan needs
//   resolveSeason(state, submissions)  { teamId: { plan, locked, why } } -> results; a team that never locked keeps its last plan
//   makeOffers(state, offersByTeam)    team-to-team carry offers, made AFTER the reveal, applying to the NEXT season
//   finalRanking(state)                human teams only; house teams listed separately
//   exportTables(state)                ww_* rows named as in pages/schema.sql
//
// Plan shape (pages/schema.sql ww_decisions.plan):
//   designs: [{id, cut, palette, logo, fabric}]
//   markets: { market: { mode: ship|partner|own|carried|none, design, price: value|standard|premium, run, bid, fallback: ship|own|none } }
//   research: [market]        copy: [{id?, from_team, design, season?, market?}]        accept: [{deal_id}]  (a holder accepting a carry offer)

import * as MK from '../config/markets.js';
import { ROWS, tileLabel, tileIds } from '../config/tiles.js';
import { BRAND_BY_ID, dnaState } from '../config/brands.js';
import * as R from '../config/rules.js';
import { EVENTS, drawDeck, renderEvent } from '../config/events.js';
import { CLUE_CARDS, clueFor, clueText } from '../config/clues.js';

const { MARKET_IDS } = MK;
const r6 = x => Math.round(x * 1e6) / 1e6;
const clone = x => JSON.parse(JSON.stringify(x));

// ---------- rng: mulberry32 stepping state.rng, so a saved state resumes the same stream ----------
export function rand(state) {
  let a = (state.rng + 0x6D2B79F5) | 0;
  state.rng = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pick = (state, arr) => arr[Math.floor(rand(state) * arr.length)];

// ---------- config for one season: base numbers, then the drawn news cards ----------
export function baseConfig() {
  return clone({
    MARKETS: MK.MARKETS, RUNS: R.RUNS, TIER_COST: R.TIER_COST, POOLS: R.POOLS, MODES: R.MODES, SHARE: R.SHARE, COPY: R.COPY, FOG: R.FOG, PRICES: R.PRICES,
    DESIGN: R.DESIGN, BUDGET: R.BUDGET, CARRY: R.CARRY, PARTNER: R.PARTNER, PARTNER_TAX_CUT: R.PARTNER_TAX_CUT,
    LATE_PAYMENT_FINAL_HAIRCUT: R.LATE_PAYMENT_FINAL_HAIRCUT, CLUES: R.CLUES, clueGrants: [],
  });
}
function mulDeep(v, k) {
  if (typeof v === 'number') return v * k;
  if (Array.isArray(v)) return v.map(x => mulDeep(x, k));
  if (v && typeof v === 'object') { const o = {}; for (const key of Object.keys(v)) o[key] = mulDeep(v[key], k); return o; }
  return v;
}
export function applyMods(cfg, mods) {
  for (const m of mods) {
    if (m.op === 'grant') { cfg.clueGrants.push({ market: m.market, row: m.row }); continue; }
    const parts = m.path.split('.');
    const key = parts.pop();
    const parent = parts.reduce((o, p) => o[p], cfg);
    if (m.op === 'set') parent[key] = m.value;
    else if (m.op === 'add') parent[key] = parent[key] + m.value;
    else if (m.op === 'mul') parent[key] = mulDeep(parent[key], m.value);
    else throw new Error('unknown event op ' + m.op);
  }
  return cfg;
}
export function seasonConfig(cardIds) {
  const cfg = baseConfig();
  for (const id of cardIds) applyMods(cfg, EVENTS.find(e => e.id === id).effect.mods);
  return cfg;
}

// What a team is allowed to know about the rules in force: no taste. Steven 10/26: weights and reveal order are PUBLIC (which rows matter most in each city,
// and the order the hidden rows come to light); only WHICH tile a city likes stays hidden.
export function publicConfig(cfg) {
  const markets = {};
  for (const id of MARKET_IDS) {
    const m = cfg.MARKETS[id];
    markets[id] = { id, name: m.name, distance: m.distance, taxBySeason: m.taxBySeason, priceFit: m.priceFit, pool: cfg.POOLS[id], rules: m.rules, incumbent: m.incumbent, blurb: m.blurb,
      pressure: m.pressure || null, tolerance: m.tolerance || 0, shipReachBonus: m.shipReachBonus || 0,
      weights: { ...m.weights }, revealOrder: [...m.revealOrder], startVisible: MK.startVisible(id) };
  }
  return {
    markets, RUNS: cfg.RUNS, PRICES: cfg.PRICES, TIER_COST: cfg.TIER_COST, DESIGN: cfg.DESIGN, BUDGET: cfg.BUDGET, MODES: cfg.MODES, SHARE: cfg.SHARE, CARRY: cfg.CARRY,
    COPY: { suitFine: cfg.COPY.suitFine, streetThreshold: cfg.COPY.streetThreshold, streetFitHit: cfg.COPY.streetFitHit },
    FOG: { researchFee: cfg.FOG.researchFee, researchPerSeason: cfg.FOG.researchPerSeason },
    PARTNER_TAX_CUT: cfg.PARTNER_TAX_CUT,
  };
}

// ---------- game setup ----------
// The room's hidden tastes ({market: {cut, palette, logo, fabric}}) live on state.secret, which is NON-enumerable: JSON.stringify(state), clone()
// and every snapshot the host saves leave it out. They are never part of cfg, teamView, publicConfig or any table. A host that reloads a saved state
// must call attachTastes(state, tastes) with the draw it kept in its own browser.
export function attachTastes(state, tastes) {
  for (const m of MARKET_IDS) for (const r of ROWS) {
    if (!tastes || !tastes[m] || !tileIds(r).includes(tastes[m][r])) throw new Error('tastes missing or invalid for ' + m + ' ' + r);
  }
  Object.defineProperty(state, 'secret', { value: { tastes: clone(tastes) }, enumerable: false, writable: true, configurable: true });
  return state;
}
const allTastes = state => {
  if (!state.secret) throw new Error('This game has no tastes attached. Enter the restore code on the host page.');
  return state.secret.tastes;
};
const tasteOf = (state, m) => allTastes(state)[m];

export function createGame({ seed = 1, teams, seasons = R.SEASONS, startCash = R.BUDGET.startCash, tastes }) {
  const state = {
    gameId: 'WW-' + seed, seed, rng: (seed ^ 0x9E3779B9) >>> 0, seasons, season: 0, phase: 'setup',
    cfg: baseConfig(), cards: [], deck: drawDeck(seed, seasons),
    order: [], teams: {}, seats: {}, publicWinners: [], offers: [], knockoffs: {}, history: {}, seq: 0, dealN: {},
    tables: { ww_log: [], ww_seasons: [], ww_designs: [], ww_bids: [], ww_deals: [], ww_decisions: [], ww_brands: [] },
  };
  for (const spec of teams) {
    const b = BRAND_BY_ID[spec.brandId];
    if (!b) throw new Error('unknown brand ' + spec.brandId);
    const t = {
      id: spec.id, brandId: spec.brandId, name: spec.name || b.name, house: !!spec.house, personality: spec.personality || null,
      startCash, cash: startCash, known: {}, active: {}, owned: {}, lastPlan: null, receivables: [], stoodCount: 0,
    };
    for (const m of MARKET_IDS) { t.known[m] = {}; t.active[m] = 0; t.owned[m] = false; }
    state.teams[t.id] = t; state.order.push(t.id);
    state.tables.ww_brands.push({ game_id: state.gameId, team_id: t.id, brand_id: b.id, name: t.name, free_tiles: b.free, costly_tile: b.costly, start_cash: startCash, house: t.house });
  }
  attachTastes(state, tastes);
  for (const id of state.order) for (const m of MARKET_IDS) {
    const t = state.teams[id];
    for (const row of MK.MARKETS[m].revealOrder.slice(0, MK.startVisible(m))) revealRow(state, t, m, row, 'start');
  }
  state.phase = 'ready';
  return state;
}

const name = (state, id) => state.teams[id].name;
export function log(state, { team = null, market = null, type, text, why = '', payload = {} }) {
  state.seq++;
  state.tables.ww_log.push({ game_id: state.gameId, seq: state.seq, round: state.season, team_id: team, market, type, text, why, payload });
}

function revealRow(state, t, m, row, source, extra = {}) {
  const base = MK.MARKETS[m];
  if (!row) row = base.revealOrder.find(r => !t.known[m][r]);
  if (!row || t.known[m][row]) return null;
  const rec = { tile: tasteOf(state, m)[row], tier: MK.weightTier(state.cfg.MARKETS[m].weights[row]), source, season: state.season };
  t.known[m][row] = rec;
  log(state, { team: t.id, market: m, type: 'fog',
    text: t.name + ' learned the ' + row + ' row in ' + base.name + ' (' + source + '): ' + tileLabel(row, rec.tile) + ', ' + rec.tier + ' weight',
    payload: { row, tile: rec.tile, tier: rec.tier, source, tiles_known: Object.keys(t.known[m]).length, ...extra } });
  return { row, ...rec };
}
const knownCount = (t, m) => Object.keys(t.known[m]).length;

// ---------- season open ----------
export function beginSeason(state) {
  if (state.season >= state.seasons) throw new Error('game is over');
  state.season++;
  const s = state.season;
  state.cards = state.deck[s];
  state.cfg = seasonConfig(state.cards);
  state.phase = 'open';
  state.offers = state.offers.filter(o => o.applies === s);
  state.cards.forEach((id, i) => {
    const ev = renderEvent(EVENTS.find(e => e.id === id), allTastes(state));
    log(state, { type: 'event', market: ev.markets.length === 1 && ev.markets[0] !== 'all' ? ev.markets[0] : null,
      text: ev.headline + ' (' + ev.rule + ')', payload: { card: id, slot: i + 1, headline: ev.headline, rule: ev.rule, mods: ev.effect.mods, season: s } });
  });
  for (const g of state.cfg.clueGrants) for (const id of state.order) revealRow(state, state.teams[id], g.market, g.row, 'clue', { card: 'event' });
  // clue cards: private, one per team per season from the rows it cannot see yet
  if (s >= state.cfg.CLUES.fromSeason) {
    for (const id of state.order) {
      const t = state.teams[id];
      for (let n = 0; n < state.cfg.CLUES.perTeamPerSeason; n++) {
        const open = [];
        for (const m of MARKET_IDS) for (const row of ROWS) if (!t.known[m][row]) open.push({ m, row });
        if (!open.length) break;
        const c = pick(state, open), card = clueFor(c.m, c.row);
        revealRow(state, t, c.m, c.row, 'clue', { card: card ? card.id : null, text: card ? clueText(c.m, c.row, tasteOf(state, c.m)[c.row]) : '' });
      }
    }
  }
  return { season: s, cards: state.cards.map(id => renderEvent(EVENTS.find(e => e.id === id), allTastes(state))) };
}

// ---------- fit, designs, costs ----------
export const designKey = d => ROWS.map(r => d[r]).join('/');
// How much of the product buyers will accept when it does not match their taste. tolerance 0 = only fit counts (high pressure for local
// responsiveness, Bartlett and Ghoshal); tolerance near 1 = a global product sells (low pressure). Fit shown to teams stays the raw tile match.
export const effFit = (marketCfg, fit) => { const t = marketCfg.tolerance || 0; return t + (1 - t) * fit; };
export function fitOf(marketCfg, d, taste) {
  let f = 0;
  for (const r of ROWS) if (d[r] === taste[r]) f += marketCfg.weights[r];
  return r6(f);
}
export function designDna(brandId, d) {
  let c = 0;
  for (const r of ROWS) c += R.DESIGN.dnaSurcharge[dnaState(brandId, r, d[r])];
  return r6(c);
}

const normPlan = p => ({
  designs: (p && p.designs) || [], markets: (p && p.markets) || {}, research: (p && p.research) || [], copy: (p && p.copy) || [], accept: (p && p.accept) || [],
});
const hasMode = (pubMarket, mode) => pubMarket.rules.modes.includes(mode);
const sizeOf = pub => pub.DESIGN.maxPerSeason;

// Cost of one market line for one mode, given the team's context. Money in $M, unit cost in $ per garment, run in thousands.
function lineMoney(pub, ctx, m, mode, line, nTotal, isCopy) {
  const pm = pub.markets[m];
  const run = line.run || 0;
  const mult = pub.DESIGN.unitCostMultiplier[Math.min(nTotal, pub.DESIGN.unitCostMultiplier.length) - 1] || 1;
  const unitBase = (pub.RUNS.unitCost[run] || 0) * mult * ((pub.TIER_COST || {})[line.price] || 1);
  const prior = ctx.active[m] || 0;
  const taxRate = pm.taxBySeason[Math.min(prior, pm.taxBySeason.length - 1)] * ((mode === 'partner' || mode === 'carried') ? pub.PARTNER_TAX_CUT : 1);
  const production = unitBase * (1 + taxRate) * run / 1000;
  const tax = unitBase * taxRate * run / 1000;
  const duty = mode === 'ship' ? pm.rules.dutyShipped * unitBase * run / 1000 : 0;
  const setup = mode === 'own' && !ctx.owned[m] ? pub.MODES.own.setup : 0;
  const carry = mode === 'carried' ? pub.CARRY.fee : 0;
  const suit = isCopy && pm.rules.suitOnCopy ? pub.COPY.suitFine : 0;
  return { unitBase, taxRate, production, tax, duty, setup, carry, suit, total: production + duty + setup + carry + suit };
}

// Cash a plan needs at lock. Bids are held in escrow (losers are refunded at resolution). Where a plan names a fallback, the dearer of the two is held.
export function costPlan(pub, ctx, plan) {
  plan = normPlan(plan);
  const nTotal = plan.designs.length + plan.copy.length;
  const copyIds = new Set(plan.copy.map((c, i) => c.id || 'X' + (i + 1)));
  let fees = 0, dna = 0;
  plan.designs.forEach((d, i) => { fees += pub.DESIGN.extraFee[Math.min(i, pub.DESIGN.extraFee.length - 1)]; dna += designDna(ctx.brandId, d); });
  let lines = 0, escrow = 0, research = 0;
  const by = {};
  for (const m of MARKET_IDS) {
    const line = plan.markets[m];
    if (line && Number(line.bid) > 0) {
      const cap = pub.BUDGET.partnerBidCap * ctx.cash;
      escrow += Math.min(Number(line.bid), cap);
    }
    if (plan.research.includes(m)) research += pub.FOG.researchFee;
    if (!line || !line.mode || line.mode === 'none') continue;
    const isCopy = copyIds.has(line.design);
    const a = lineMoney(pub, ctx, m, line.mode, line, nTotal, isCopy);
    const fb = line.fallback && line.fallback !== 'none' && hasMode(pub.markets[m], line.fallback) ? lineMoney(pub, ctx, m, line.fallback, line, nTotal, isCopy) : null;
    const worst = fb && fb.total > a.total ? fb : a;
    by[m] = { primary: a, fallback: fb, held: worst.total };
    lines += worst.total;
  }
  const total = fees + dna + lines + escrow + research;
  return { fees: r6(fees), dna: r6(dna), lines: r6(lines), escrow: r6(escrow), research: r6(research), total: r6(total), by };
}

export function teamCtx(state, t) {
  return { brandId: t.brandId, cash: t.cash, active: { ...t.active }, owned: { ...t.owned } };
}

// Hard errors reject the plan at lock. Warnings are things that may fail at resolution (a copy source, a carry).
export function validatePlan(state, teamId, plan) {
  const t = state.teams[teamId], pub = publicConfig(state.cfg);
  return validateWith(pub, teamCtx(state, t), plan, { season: state.season, publicWinners: state.publicWinners, house: t.house });
}
export function validateWith(pub, ctx, planIn, env = {}) {
  const plan = normPlan(planIn);
  const errors = [], warnings = [];
  if (!Array.isArray(plan.designs) || !Array.isArray(plan.copy)) errors.push('designs and copy must be lists');
  const ids = new Set();
  plan.designs.forEach(d => {
    if (!d.id || ids.has(d.id)) errors.push('design ids must be unique');
    ids.add(d.id);
    for (const r of ROWS) if (!tileIds(r).includes(d[r])) errors.push('design ' + d.id + ' has no valid ' + r + ' tile');
  });
  const copyIds = [];
  plan.copy.forEach((c, i) => {
    const id = c.id || 'X' + (i + 1);
    if (ids.has(id)) errors.push('copy id ' + id + ' clashes with a design id');
    ids.add(id); copyIds.push(id);
    if (!c.from_team || !c.design) errors.push('a copy needs from_team and design');
    if (env.house) errors.push('house teams never copy');
  });
  if (plan.designs.length + plan.copy.length > sizeOf(pub)) errors.push('at most ' + sizeOf(pub) + ' designs per season (copies count)');
  for (const m of Object.keys(plan.markets)) if (!MARKET_IDS.includes(m)) errors.push('unknown market ' + m);
  for (const m of MARKET_IDS) {
    const line = plan.markets[m];
    if (!line) continue;
    const pm = pub.markets[m];
    const mode = line.mode || 'none';
    if (!['ship', 'partner', 'own', 'carried', 'none'].includes(mode)) { errors.push(m + ': unknown mode ' + mode); continue; }
    const bid = Number(line.bid || 0);
    if (bid < 0 || Number.isNaN(bid)) errors.push(m + ': bad bid');
    if (bid > 0 && Math.min(bid, pub.BUDGET.partnerBidCap * ctx.cash) < pub.BUDGET.minPartnerBid) errors.push(m + ': a bid must be at least ' + pub.BUDGET.minPartnerBid + ' $M after the cap');
    if (mode === 'partner' && !(bid > 0)) errors.push(m + ': Partner needs a bid for the seat');
    if (['ship', 'partner', 'own'].includes(mode) && !hasMode(pm, mode)) errors.push(m + ': ' + mode + ' is not open in ' + pm.name);
    if (line.fallback && !['ship', 'own', 'none'].includes(line.fallback)) errors.push(m + ': bad fallback');
    if (line.fallback === 'ship' && !hasMode(pm, 'ship')) errors.push(m + ': fallback ship is not open in ' + pm.name);
    if (mode === 'none') continue;
    if (env.house && mode === 'carried') errors.push('house teams never take a carry');
    if (!ids.has(line.design)) errors.push(m + ': design ' + line.design + ' is not in this plan');
    if (!(line.price in pub.PRICES)) errors.push(m + ': bad price tier');
    if (!pub.RUNS.sizes.includes(line.run)) errors.push(m + ': run must be one of ' + pub.RUNS.sizes.join(', '));
  }
  for (const m of plan.research) {
    if (!MARKET_IDS.includes(m) || !pub.markets[m].rules.research) errors.push('no research firm in ' + (pub.markets[m] ? pub.markets[m].name : m));
  }
  if (new Set(plan.research).size !== plan.research.length) errors.push('one research purchase per market per season');
  if (env.house && (plan.accept.length || plan.copy.length)) errors.push('house teams never copy or accept a carry');
  plan.copy.forEach(c => {
    const s = c.season || (env.season - 1);
    const seen = (env.publicWinners || []).some(w => w.team === c.from_team && w.design === c.design && w.season === s);
    if (!seen) warnings.push('copy of ' + c.from_team + '/' + c.design + ' is allowed only for a design shown in a reveal or one you carry');
  });
  const cost = costPlan(pub, ctx, plan);
  if (cost.total > ctx.cash + 1e-9 && pub.BUDGET.noDebt) errors.push('this plan needs $' + cost.total.toFixed(2) + 'M and you hold $' + ctx.cash.toFixed(2) + 'M');
  return { ok: errors.length === 0, errors, warnings, cost };
}

// ---------- what a team can see ----------
export function teamView(state, teamId) {
  const t = state.teams[teamId], pub = publicConfig(state.cfg), b = BRAND_BY_ID[t.brandId];
  const last = state.history[state.season - (state.phase === 'resolved' ? 0 : 1)] || null;
  const mine = (state.offers || []).filter(o => o.applies === (state.phase === 'resolved' ? state.season + 1 : state.season));
  return {
    gameId: state.gameId, season: state.season, phase: state.phase, seasons: state.seasons,
    team: { id: t.id, brandId: t.brandId, name: t.name, house: t.house, free: b.free, costly: b.costly },
    cash: r6(t.cash), startCash: t.startCash, bidCap: r6(pub.BUDGET.partnerBidCap * t.cash), pub,
    ctx: teamCtx(state, t),
    known: clone(t.known),
    tilesKnown: Object.fromEntries(MARKET_IDS.map(m => [m, knownCount(t, m)])),
    active: { ...t.active }, owned: { ...t.owned },
    receivables: clone(t.receivables),
    events: state.cards.map(id => { const e = renderEvent(EVENTS.find(x => x.id === id), allTastes(state)); return { id, headline: e.headline, rule: e.rule }; }),
    publicWinners: clone(state.publicWinners),
    lastSeats: last ? clone(last.seats) : {},
    lastCrowd: last ? Object.fromEntries(MARKET_IDS.map(m => [m, last.markets[m].crowd])) : {},
    myOffers: mine.filter(o => o.carried === teamId).map(o => clone(o)),
    offersToMe: mine.filter(o => o.holder === teamId).map(o => clone(o)),
    brands: Object.fromEntries(state.order.map(id => [id, { name: state.teams[id].name, house: state.teams[id].house, brandId: state.teams[id].brandId }])),
    lastPlan: t.lastPlan ? clone(t.lastPlan) : null,
  };
}

// ---------- the share split ----------
export function splitPool(pool, sellers) {
  // sellers: [{key, w, cap}] ; cap Infinity for the incumbent. Water-fill so a capped seller's excess goes to the rest by weight.
  const out = Object.fromEntries(sellers.map(s => [s.key, 0]));
  let active = sellers.filter(s => s.w > 0), rem = pool;
  while (active.length) {
    const W = active.reduce((a, s) => a + s.w, 0);
    const over = active.filter(s => rem * s.w / W > s.cap + 1e-12);
    if (!over.length) { for (const s of active) out[s.key] = rem * s.w / W; break; }
    for (const s of over) { out[s.key] = s.cap; rem -= s.cap; }
    active = active.filter(s => !over.includes(s));
  }
  return out;
}

// ---------- offers (carry) ----------
export function makeOffers(state, byTeam) {
  if (state.phase !== 'resolved') throw new Error('offers are made after the reveal');
  const s = state.season, applies = s + 1, res = [];
  if (applies > state.seasons) return res;
  const last = state.history[s];
  for (const from of Object.keys(byTeam || {})) {
    for (const o of byTeam[from] || []) {
      const t = state.teams[from], holder = last.seats[o.market];
      const err = !t ? 'unknown team' : t.house ? 'house teams never offer a carry'
        : !MARKET_IDS.includes(o.market) ? 'unknown market'
        : !holder ? 'nobody holds the seat in ' + o.market
        : holder === from ? 'you hold the seat yourself'
        : state.teams[holder].house ? 'house teams never accept a carry'
        : !ROWS.every(r => tileIds(r).includes(o.design && o.design[r])) ? 'bad design'
        : state.offers.some(x => x.carried === from && x.market === o.market && x.applies === applies) ? 'one offer per market'
        : null;
      if (err) { res.push({ ok: false, from, market: o.market, error: err }); continue; }
      const n = (state.dealN[applies + o.market] = (state.dealN[applies + o.market] || 0) + 1);
      const offer = { id: 'D-' + applies + '-' + o.market + '-' + n, applies, made_in: s, market: o.market, holder, carried: from,
        design: { id: o.design.id || 'D1', cut: o.design.cut, palette: o.design.palette, logo: o.design.logo, fabric: o.design.fabric }, status: 'offered' };
      state.offers.push(offer);
      state.tables.ww_deals.push({ game_id: state.gameId, season: applies, deal_id: offer.id, market: o.market, holder_team: holder, carried_team: from,
        design_id: offer.design.id, fee: state.cfg.CARRY.fee, status: 'offered', holder_saw_design: false, copied: false, copy_season: null, made_in_season: s, reason: '' });
      log(state, { team: from, market: o.market, type: 'carry', text: name(state, from) + ' offered ' + name(state, holder) + ' a carry in ' + MK.MARKETS[o.market].name + ' for next season',
        payload: { deal_id: offer.id, phase: 'offer', holder, carried: from, fee: state.cfg.CARRY.fee, applies } });
      res.push({ ok: true, deal: offer.id });
    }
  }
  return res;
}
const dealRow = (state, id) => state.tables.ww_deals.find(d => d.deal_id === id && d.game_id === state.gameId);

// ---------- the season ----------
const STRIP = ['accept'];
export function resolveSeason(state, subs = {}) {
  if (state.phase !== 'open') throw new Error('season is not open');
  const s = state.season, cfg = state.cfg, T = state.teams, gid = state.gameId, ids = state.order;
  const pub = publicConfig(cfg);
  const cashStart = Object.fromEntries(ids.map(id => [id, T[id].cash]));
  const finals = {};

  // 1. which plan each team plays
  for (const id of ids) {
    const t = T[id], sub = subs[id] || {};
    let plan = null, stood = false, engineError = null;
    const notes = [];
    const ctx = teamCtx(state, t), env = { season: s, publicWinners: state.publicWinners, house: t.house };
    // runSaved: the host's clock ran out before this team locked, and the room plays a saved plan in that case (config/rules.js CLOCK.savedPlanRunsAtZero).
    // The plan is checked like a locked one; the row still says locked: false, so the debrief can tell the two apart.
    const ranOut = !sub.locked && !!sub.runSaved;
    if ((sub.locked || ranOut) && sub.plan) {
      const v = validateWith(pub, ctx, sub.plan, env);
      if (v.ok) plan = normPlan(clone(sub.plan));
      else { engineError = v.errors.join('; '); notes.push('rejected: ' + engineError); }
      v.warnings.forEach(w => notes.push(w));
      if (ranOut) notes.push(v.ok ? 'not locked when time ran out: the saved plan ran' : 'not locked when time ran out, and the saved plan failed the checks');
    } else if (sub.plan) notes.push('saved but never locked');
    if (!plan && t.lastPlan) {
      const stand = normPlan(clone(t.lastPlan)); for (const k of STRIP) stand[k] = [];
      const v = validateWith(pub, ctx, stand, env);
      if (v.ok) { plan = stand; stood = true; t.stoodCount++; }
      else { engineError = (engineError ? engineError + '; ' : '') + 'last plan no longer affordable: ' + v.errors.join('; '); notes.push('last plan could not stand'); }
    }
    if (!plan) plan = normPlan(null);
    const savedRan = ranOut && !stood && plan.designs.length + plan.copy.length > 0;
    finals[id] = { plan, stood, savedRan, why: sub.why || '', locked: !!sub.locked, lock_left: sub.lock_left ?? null, engineError, notes };
    log(state, { team: id, type: 'plan', why: finals[id].why,
      text: stood ? name(state, id) + ': Your last plan stood.' : savedRan ? name(state, id) + ' ran its saved plan when time ran out.' : name(state, id) + (sub.locked && plan.designs.length + plan.copy.length ? ' locked a plan.' : ' sat the season out.'),
      payload: { stood, locked: !!sub.locked, designs: plan.designs.length, copies: plan.copy.length, markets: Object.keys(plan.markets).filter(m => plan.markets[m].mode && plan.markets[m].mode !== 'none'), engine_error: engineError,
        ...(ranOut ? { timed_out: true, saved_ran: savedRan } : {}) } });
    state.tables.ww_decisions.push({ game_id: gid, team_id: id, round: s, plan: clone(plan), why: finals[id].why, locked: !!sub.locked, locked_by: null, locked_at: null,
      lock_left: finals[id].lock_left, stood, notes, engine_error: engineError });
  }

  // 2. sealed bids: one seat per market, highest capped bid wins, ties by the seeded draw, losers refunded, the winner pays its own bid
  const seats = {}, bidRows = {};
  for (const m of MARKET_IDS) {
    const entries = [];
    for (const id of ids) {
      const line = finals[id].plan.markets[m];
      if (!line || !(Number(line.bid) > 0)) continue;
      const amount = Number(line.bid), cap = r6(cfg.BUDGET.partnerBidCap * cashStart[id]);
      const capped = Math.min(amount, cap);
      entries.push({ id, amount, capped, bit: capped < amount - 1e-9, valid: capped >= cfg.BUDGET.minPartnerBid });
    }
    const live = entries.filter(e => e.valid);
    let winner = null;
    if (live.length) {
      const top = Math.max(...live.map(e => e.capped));
      const tied = live.filter(e => Math.abs(e.capped - top) < 1e-9);
      winner = tied.length > 1 ? pick(state, tied).id : tied[0].id;
    }
    seats[m] = winner;
    for (const e of entries) {
      const won = e.id === winner;
      state.tables.ww_bids.push({ game_id: gid, season: s, market: m, team_id: e.id, amount: e.amount, capped_to: e.bit ? e.capped : null, won });
      log(state, { team: e.id, market: m, type: 'bid', text: name(state, e.id) + ' bid $' + e.capped.toFixed(2) + 'M for the ' + MK.MARKETS[m].name + ' partner seat' + (won ? ' and won it' : ' and lost'),
        payload: { amount: e.amount, capped_to: e.bit ? e.capped : null, won, refunded: won ? 0 : e.capped, valid: e.valid } });
    }
    bidRows[m] = Object.fromEntries(entries.map(e => [e.id, e]));
  }

  // 3. carry offers addressed to this season: accepted by the holder, valid only if that holder won the seat and the carried team plays the offered design
  const deals = [];
  const oneHolder = new Set();
  for (const o of state.offers.filter(x => x.applies === s)) {
    const row = dealRow(state, o.id), hp = finals[o.holder].plan, cp = finals[o.carried].plan, line = cp.markets[o.market];
    const accepted = hp.accept.some(a => a.deal_id === o.id);
    let status = 'declined', reason = accepted ? '' : 'the holder did not accept';
    if (accepted) {
      const cd = line && line.mode === 'carried' ? cp.designs.find(d => d.id === line.design) : null;
      if (seats[o.market] !== o.holder) { status = 'void'; reason = 'the holder did not win the seat'; }
      else if (!cd || ROWS.some(r => cd[r] !== o.design[r])) { status = 'void'; reason = 'the carried team did not play the offered design'; }
      else if (oneHolder.has(o.holder + o.market)) { status = 'declined'; reason = 'one carry per holder per market per season'; }
      else { status = 'accepted'; oneHolder.add(o.holder + o.market); }
    }
    o.status = status; row.status = status; row.reason = reason;
    if (status === 'accepted') { row.holder_saw_design = true; deals.push(o); }
    log(state, { team: o.holder, market: o.market, type: 'carry',
      text: name(state, o.holder) + ' ' + (status === 'accepted' ? 'carries ' + name(state, o.carried) + ' in ' : 'does not carry ' + name(state, o.carried) + ' in ') + MK.MARKETS[o.market].name,
      payload: { deal_id: o.id, phase: 'resolve', status, reason, holder: o.holder, carried: o.carried, fee: status === 'accepted' ? cfg.CARRY.fee : 0, holder_saw_design: status === 'accepted',
        no_remedy: !cfg.MARKETS[o.market].rules.court } });
  }
  const dealFor = (carried, m) => deals.find(d => d.carried === carried && d.market === m);

  // 4. designs and copies
  const designs = {};      // team -> { id -> { tiles, fee, dna, copy:{from_team, design, season}|null } }
  for (const id of ids) {
    const t = T[id], p = finals[id].plan, n = p.designs.length + p.copy.length, D = {};
    p.designs.forEach((d, i) => {
      D[d.id] = { id: d.id, tiles: Object.fromEntries(ROWS.map(r => [r, d[r]])), fee: cfg.DESIGN.extraFee[Math.min(i, cfg.DESIGN.extraFee.length - 1)], dna: designDna(t.brandId, d), copy: null };
    });
    p.copy.forEach((c, i) => {
      const cid = c.id || 'X' + (i + 1), cs = c.season || (s - 1);
      let src = state.publicWinners.find(w => w.team === c.from_team && w.design === c.design && w.season === cs);
      let carried = false;
      if (!src) {
        const dl = deals.find(d => d.holder === id && d.carried === c.from_team && d.design.id === c.design);
        if (dl && cs === s) { src = { tiles: Object.fromEntries(ROWS.map(r => [r, dl.design[r]])), team: c.from_team, design: c.design, season: s }; carried = true; dealRow(state, dl.id).copied = true; dealRow(state, dl.id).copy_season = s; }
      }
      if (!src || id === c.from_team) {
        finals[id].notes.push('copy ' + cid + ' dropped: source not shown');
        log(state, { team: id, type: 'copy', text: name(state, id) + ' tried to copy ' + (T[c.from_team] ? name(state, c.from_team) : c.from_team) + ' but had not seen that design',
          payload: { from_team: c.from_team, design: c.design, rejected: true } });
        return;
      }
      D[cid] = { id: cid, tiles: clone(src.tiles), fee: 0, dna: 0, copy: { from_team: c.from_team, design: c.design, season: cs, carried } };
    });
    designs[id] = { map: D, n, ownCount: p.designs.length };
  }

  // 5. each market line: the effective mode after the partner and carry results, then the money
  const lines = {};        // market -> [line]
  for (const m of MARKET_IDS) lines[m] = [];
  const research = {};
  for (const id of ids) {
    const t = T[id], p = finals[id].plan, dz = designs[id];
    for (const m of MARKET_IDS) {
      const req = p.markets[m];
      if (!req || !req.mode || req.mode === 'none') continue;
      const pm = cfg.MARKETS[m];
      let mode = req.mode, fell = false, note = '';
      const des = dz.map[req.design];
      if (!des) { mode = 'none'; note = 'design missing'; }
      else if (mode === 'partner' && seats[m] !== id) { fell = true; mode = req.fallback || 'none'; note = 'lost the partner seat'; }
      else if (mode === 'carried' && !dealFor(id, m)) { fell = true; mode = req.fallback || 'none'; note = 'no carry deal'; }
      if (mode !== 'none' && ['ship', 'partner', 'own'].includes(mode) && !pm.rules.modes.includes(mode)) { mode = 'none'; note = 'mode not open'; }
      if (mode === 'none') { finals[id].notes.push(m + ': ' + (note || 'sat out')); continue; }
      const nTotal = dz.n, mult = cfg.DESIGN.unitCostMultiplier[Math.min(nTotal, cfg.DESIGN.unitCostMultiplier.length) - 1];
      const unitBase = cfg.RUNS.unitCost[req.run] * mult * ((cfg.TIER_COST || {})[req.price] || 1);
      const prior = t.active[m];
      const taxRate = pm.taxBySeason[Math.min(prior, pm.taxBySeason.length - 1)] * ((mode === 'partner' || mode === 'carried') ? cfg.PARTNER_TAX_CUT : 1);
      const ownFirst = mode === 'own' && !t.owned[m];
      const reach = ((mode === 'carried' ? cfg.SHARE.reach.carried : cfg.SHARE.reach[mode]) + (mode === 'ship' ? (pm.shipReachBonus || 0) : 0)) * (ownFirst ? cfg.MODES.own.ownRampFirstSeason : 1);
      let fit = fitOf(pm, des.tiles, tasteOf(state, m));
      const key = designKey(des.tiles);
      let knocked = false;
      const ko = state.knockoffs[m] && state.knockoffs[m][key];
      if (pm.rules.streetCopy && ko && ko.applyOn === s) { fit = r6(fit * cfg.COPY.streetFitHit); knocked = true; }
      lines[m].push({
        team: id, market: m, mode, requested: req.mode, fell, design: req.design, tiles: des.tiles, key, copy: des.copy, price: req.price, run: req.run,
        unitBase, taxRate, unitCost: unitBase * (1 + taxRate), fit, reach, ownFirst, knocked, prior,
        weight: Math.pow(effFit(pm, fit), cfg.SHARE.fitExponent) * pm.priceFit[req.price] * reach,
        buyers: 0, share: 0, revenue: 0,
      });
    }
    for (const m of finals[id].plan.research) if (cfg.MARKETS[m].rules.research) (research[id] = research[id] || []).push(m);
  }

  // 6. split every market
  const mk = {};
  for (const m of MARKET_IDS) {
    const pm = cfg.MARKETS[m], pool = cfg.POOLS[m], L = lines[m];
    const inc = pm.incumbent;
    const incW = Math.pow(effFit(pm, inc.fit), cfg.SHARE.fitExponent) * pm.priceFit[inc.price] * 1;
    const sellers = [{ key: 'INC', w: incW, cap: Infinity }, ...L.map((l, i) => ({ key: i, w: l.weight, cap: l.run }))];
    const out = splitPool(pool, sellers);
    L.forEach((l, i) => { l.buyers = r6(out[i]); l.share = r6(out[i] / pool); l.revenue = r6(l.buyers * cfg.PRICES[l.price] / 1000); });
    mk[m] = { pool, crowd: L.length, incumbent: { name: inc.name, fit: inc.fit, price: inc.price, buyers: r6(out.INC), share: r6(out.INC / pool) } };
  }

  // 7. copies and suits (a copy is sold the same season it is chosen)
  const suit = {};         // team -> market -> { paid, received }
  const bump = (id, m) => ((suit[id] = suit[id] || {})[m] = suit[id][m] || { paid: 0, received: 0 });
  for (const id of ids) {
    const used = new Set();
    for (const m of MARKET_IDS) for (const l of lines[m]) if (l.team === id && l.copy) {
      used.add(l.design);
      const src = l.copy.from_team, pm = cfg.MARKETS[m];
      log(state, { team: id, market: m, type: 'copy',
        text: name(state, id) + ' copied ' + name(state, src) + "'s " + tileLabel('cut', l.tiles.cut) + ' in ' + pm.name,
        payload: { from_team: src, design: l.copy.design, tiles: l.tiles, carried: l.copy.carried, remedy: pm.rules.court && pm.rules.suitOnCopy } });
      if (pm.rules.suitOnCopy) {
        const fine = cfg.COPY.suitFine;
        bump(id, m).paid += fine; bump(src, m).received += fine;
        log(state, { team: id, market: m, type: 'suit', text: pm.name + ' court: ' + name(state, id) + ' pays ' + name(state, src) + ' $' + fine + 'M for the copy',
          payload: { owner: src, copier: id, fine, from_design: l.copy.design } });
      }
    }
    for (const [cid, d] of Object.entries(designs[id].map)) if (d.copy && !used.has(cid)) {
      log(state, { team: id, type: 'copy', text: name(state, id) + ' copied ' + name(state, d.copy.from_team) + "'s design but sold it nowhere", payload: { from_team: d.copy.from_team, design: d.copy.design, sold: false } });
    }
  }

  // 8. street knock-off (Nairobi): a design at or above the threshold is knocked off next season, in every hand that sells it
  for (const m of MARKET_IDS) {
    if (!cfg.MARKETS[m].rules.streetCopy) continue;
    for (const l of lines[m]) {
      const ko = state.knockoffs[m] && state.knockoffs[m][l.key];
      if (l.knocked) log(state, { team: l.team, market: m, type: 'street', text: 'The street knock-off cut ' + name(state, l.team) + ' fit in ' + MK.MARKETS[m].name + ' this season',
        payload: { phase: 'applied', design: l.design, fit_after: l.fit } });
      if (l.share >= cfg.COPY.streetThreshold - 1e-12 && s < state.seasons) {
        (state.knockoffs[m] = state.knockoffs[m] || {})[l.key] = { applyOn: s + 1, from: l.team, share: l.share };
        log(state, { team: l.team, market: m, type: 'street', text: name(state, l.team) + ' sold ' + Math.round(l.share * 100) + '% of ' + MK.MARKETS[m].name + ' and the street will knock the design off next season',
          payload: { phase: 'triggered', share: l.share, threshold: cfg.COPY.streetThreshold, design: l.design } });
      }
    }
    for (const k of Object.keys(state.knockoffs[m] || {})) if (state.knockoffs[m][k].applyOn <= s) delete state.knockoffs[m][k];
  }

  // 9. money: one ww_seasons row per team per market
  const seasonRows = [];
  const designFees = {}, teamTax = {};
  const incomeNow = {}, dueLater = [];
  for (const id of ids) { incomeNow[id] = 0; designFees[id] = 0; teamTax[id] = 0; }
  const holderIncome = {}; // team -> market -> income
  for (const m of MARKET_IDS) for (const l of lines[m]) {
    const d = dealFor(l.team, m);
    if (l.mode === 'carried' && d) {
      const share = r6(cfg.MODES.partner.feeShare * l.revenue);
      l.partnerFee = r6(cfg.CARRY.fee + share); l.holder = d.holder; l.dealId = d.id; l.share$ = share;
      ((holderIncome[d.holder] = holderIncome[d.holder] || {})[m] = (holderIncome[d.holder] || {})[m] || { fee: 0, share: 0 });
      holderIncome[d.holder][m].fee += cfg.CARRY.fee; holderIncome[d.holder][m].share += share;
    } else if (l.mode === 'partner' && cfg.MARKETS[m].rules.partnerWalks) {
      // no court: the local partner keeps a cut of every sale and the contract cannot be enforced (Khanna and Palepu, institutional voids)
      l.walkLeak = r6((cfg.MARKETS[m].rules.walkShare || 0) * l.revenue); l.partnerFee = l.walkLeak;
    } else l.partnerFee = 0;
  }
  const rowsByKey = {};
  for (const id of ids) {
    const t = T[id], dz = designs[id];
    const my = {};
    for (const m of MARKET_IDS) my[m] = lines[m].find(l => l.team === id) || null;
    // design-level unit cost reference (average base over the lines using the design)
    for (const d of Object.values(dz.map)) {
      const using = MARKET_IDS.map(m => my[m]).filter(l => l && l.design === d.id);
      const mult = cfg.DESIGN.unitCostMultiplier[Math.min(dz.n, cfg.DESIGN.unitCostMultiplier.length) - 1];
      d.unitCost = using.length ? using.reduce((a, l) => a + l.unitBase, 0) / using.length : cfg.RUNS.unitCost[50] * mult;
      d.markets = using.map(l => l.market);
      designFees[id] += d.fee + d.dna;
      state.tables.ww_designs.push({ game_id: gid, season: s, team_id: id, design_id: d.id, cut: d.tiles.cut, palette: d.tiles.palette, logo: d.tiles.logo, fabric: d.tiles.fabric,
        fee: d.fee, dna_cost: d.dna, designs_this_season: dz.n, unit_cost: r6(d.unitCost), is_copy: !!d.copy,
        copied_from_team: d.copy ? d.copy.from_team : null, copied_from_design: d.copy ? d.copy.design : null, markets: d.markets });
      log(state, { team: id, type: 'design', why: finals[id].why,
        text: name(state, id) + ' fielded ' + ROWS.map(r => tileLabel(r, d.tiles[r])).join(', ') + (d.copy ? ' (a copy)' : ''),
        payload: { design: d.id, tiles: d.tiles, fee: d.fee, dna_cost: d.dna, designs_this_season: dz.n, unit_cost: r6(d.unitCost), is_copy: !!d.copy } });
    }
    for (const m of MARKET_IDS) {
      const l = my[m], sc = (suit[id] && suit[id][m]) || { paid: 0, received: 0 };
      const bidE = bidRows[m][id];
      const seatPaid = seats[m] === id ? r6(bidE.capped) : 0;
      const resFee = (research[id] || []).includes(m) ? cfg.FOG.researchFee : 0;
      const hi = (holderIncome[id] && holderIncome[id][m]) || { fee: 0, share: 0 };
      const partnerIncome = r6(hi.fee + hi.share);
      let production = 0, tax = 0, duty = 0, setup = 0;
      if (l) {
        production = r6(l.unitCost * l.run / 1000); tax = r6(l.unitBase * l.taxRate * l.run / 1000);
        duty = l.mode === 'ship' ? r6(cfg.MARKETS[m].rules.dutyShipped * l.unitBase * l.run / 1000) : 0;
        setup = l.ownFirst ? cfg.MODES.own.setup : 0;
        if (l.mode === 'own') t.owned[m] = true;
      }
      const gross = l ? l.revenue : 0, pFee = l ? l.partnerFee : 0;
      const profit = r6(gross - production - duty - setup - pFee - seatPaid - resFee - sc.paid + sc.received + partnerIncome);
      const cashOut = production + duty + setup + (l && l.mode === 'carried' ? cfg.CARRY.fee : 0) + seatPaid + resFee + sc.paid;
      const lag = l && l.mode !== 'own' ? cfg.MARKETS[m].rules.paymentLagSeasons : 0;
      // cash timing: revenue net of the partner share arrives now, or lag seasons later (an owned shop is paid at once)
      const revNet = l ? r6(gross - (l.mode === 'carried' ? (l.partnerFee ? l.partnerFee - cfg.CARRY.fee : 0) : (l.walkLeak || 0))) : 0;
      if (l && revNet) { if (lag > 0) dueLater.push({ team: id, market: m, amount: revNet, due: s + lag, earned: s, kind: 'revenue' }); else incomeNow[id] += revNet; }
      if (partnerIncome) { if (lag > 0) dueLater.push({ team: id, market: m, amount: partnerIncome, due: s + lag, earned: s, kind: 'partner' }); else incomeNow[id] += partnerIncome; }
      incomeNow[id] += sc.received - cashOut;
      teamTax[id] += tax;
      const mode = l ? l.mode : 'none';
      const row = {
        game_id: gid, season: s, team_id: id, market: m, mode, design_id: l ? l.design : '', price_tier: l ? l.price : '', run_units: l ? l.run : 0,
        fit: l ? l.fit : 0, tiles_known: knownCount(t, m), buyers: l ? l.buyers : 0, share: l ? l.share : 0, revenue: gross,
        unit_cost: l ? r6(l.unitCost) : 0, tax_paid: tax, duty_paid: duty, partner_fee: pFee, setup_paid: setup, profit, crowd: mk[m].crowd,
        tax_rate: l ? r6(l.taxRate) : r6(cfg.MARKETS[m].taxBySeason[Math.min(t.active[m], 3)]), seat_paid: seatPaid, partner_income: partnerIncome, research_paid: resFee,
        suit_paid: sc.paid, suit_received: sc.received, house: t.house,
        payload: { requested_mode: p0(finals[id].plan, m), fell_back: l ? l.fell : false, lag_seasons: lag, knocked_off: l ? l.knocked : false, deal_id: l && l.dealId ? l.dealId : null, production, copy: !!(l && l.copy) },
      };
      seasonRows.push(row); rowsByKey[id + '|' + m] = row;
    }
    incomeNow[id] -= designFees[id];
  }
  function p0(plan, m) { const x = plan.markets[m]; return x && x.mode ? x.mode : 'none'; }

  // 10. cash, receivables, fog
  for (const id of ids) {
    const t = T[id];
    t.cash = r6(t.cash + incomeNow[id]);
  }
  for (const r of dueLater) T[r.team].receivables.push(r);
  for (const id of ids) {
    const t = T[id], keep = [];
    for (const r of t.receivables) { if (r.due <= s) { t.cash = r6(t.cash + r.amount); r.paid = true; } else keep.push(r); }
    t.receivables = keep;
  }
  let writeOff = {};
  if (s === state.seasons) {
    for (const id of ids) {
      const t = T[id];
      const owed = t.receivables.reduce((a, r) => a + r.amount, 0), got = r6(owed * (1 - cfg.LATE_PAYMENT_FINAL_HAIRCUT));
      writeOff[id] = r6(owed - got);
      t.cash = r6(t.cash + got); t.receivables = [];
      if (owed) log(state, { team: id, type: 'standing', text: name(state, id) + ' collected $' + got.toFixed(2) + 'M of $' + owed.toFixed(2) + 'M still owed at the end', payload: { owed, collected: got, haircut: cfg.LATE_PAYMENT_FINAL_HAIRCUT } });
    }
  }
  for (const id of ids) {
    const t = T[id], p = finals[id].plan;
    for (const m of MARKET_IDS) if (lines[m].some(l => l.team === id)) { t.active[m]++; revealRow(state, t, m, null, 'season', { season_sold: t.active[m] }); }
    for (const m of MARKET_IDS) if (seats[m] === id) revealRow(state, t, m, null, 'partner');
    for (const m of (research[id] || [])) {
      revealRow(state, t, m, null, 'research');
      log(state, { team: id, market: m, type: 'fog', text: name(state, id) + ' bought research in ' + MK.MARKETS[m].name, payload: { purchase: true, fee: cfg.FOG.researchFee, source: 'research' } });
    }
    t.lastPlan = clone(p);
  }

  // 11. sale logs, public winners, results
  const winnersThisSeason = [];
  for (const m of MARKET_IDS) {
    const L = lines[m];
    if (L.length) {
      const top = L.reduce((a, l) => (l.buyers > a.buyers ? l : a), L[0]);
      if (top.buyers > 0) {
        const w = { season: s, market: m, team: top.team, design: top.design, tiles: clone(top.tiles), buyers: top.buyers };
        state.publicWinners.push(w); winnersThisSeason.push(w);
        log(state, { team: top.team, market: m, type: 'sale', text: name(state, top.team) + ' won ' + MK.MARKETS[m].name + ' with ' + ROWS.map(r => tileLabel(r, top.tiles[r])).join(', '),
          payload: { winner: true, buyers: top.buyers, share: top.share, fit: top.fit } });
      }
    }
    for (const l of L) {
      const row = rowsByKey[l.team + '|' + m];
      log(state, { team: l.team, market: m, type: 'sale',
        text: name(state, l.team) + ' sold ' + l.buyers.toFixed(1) + 'k in ' + MK.MARKETS[m].name + ' (' + l.mode + ', fit ' + l.fit.toFixed(2) + ') for a profit of $' + row.profit.toFixed(2) + 'M',
        payload: { mode: l.mode, buyers: l.buyers, share: l.share, fit: l.fit, revenue: l.revenue, profit: row.profit, crowd: mk[m].crowd, tax_paid: row.tax_paid, duty_paid: row.duty_paid, partner_fee: row.partner_fee } });
    }
  }
  for (const r of seasonRows) state.tables.ww_seasons.push(r);

  const res = buildResults(state, { s, lines, mk, seats, seasonRows, designs, designFees, teamTax, cashStart, finals, writeOff, winnersThisSeason });
  state.history[s] = res;
  state.seats[s] = seats;
  state.phase = 'resolved';
  // standings (human teams only in the ranking; house listed apart)
  const st = standings(state);
  st.ranked.forEach(r => log(state, { team: r.team, type: 'standing', text: '#' + r.rank + ' ' + r.name + ' with $' + r.profit.toFixed(2) + 'M profit after season ' + s, payload: { rank: r.rank, profit: r.profit, season: s, house: false } }));
  st.house.forEach(r => log(state, { team: r.team, type: 'standing', text: 'House brand ' + r.name + ' (not ranked) $' + r.profit.toFixed(2) + 'M after season ' + s, payload: { profit: r.profit, season: s, house: true } }));
  res.standings = st;
  return res;
}

function buildResults(state, c) {
  const { s, lines, mk, seats, seasonRows, designs, designFees, teamTax, cashStart, finals, writeOff, winnersThisSeason } = c;
  const markets = {};
  for (const m of MARKET_IDS) {
    markets[m] = { ...mk[m], seat: seats[m] || null,
      lines: lines[m].map(l => {
        const row = seasonRows.find(r => r.team_id === l.team && r.market === m);
        return { team: l.team, house: state.teams[l.team].house, mode: l.mode, requested: l.requested, design: l.design, tiles: l.tiles, price: l.price, run: l.run, fit: l.fit,
          buyers: l.buyers, share: l.share, crowd: mk[m].crowd, revenue: l.revenue,
          costs: { unit_cost: row.unit_cost, tax_paid: row.tax_paid, duty_paid: row.duty_paid, setup_paid: row.setup_paid, partner_fee: row.partner_fee, seat_paid: row.seat_paid, production: row.payload.production },
          profit: row.profit };
      }) };
  }
  const teams = {};
  for (const id of state.order) {
    const t = state.teams[id], rows = seasonRows.filter(r => r.team_id === id);
    const mp = rows.reduce((a, r) => a + r.profit, 0);
    teams[id] = { name: t.name, house: t.house, cashStart: cashStart[id], cashEnd: t.cash, designFees: r6(designFees[id]), marketProfit: r6(mp), seasonProfit: r6(mp - designFees[id]),
      taxPaid: r6(teamTax[id]), taxByMarket: Object.fromEntries(rows.map(r => [r.market, r.tax_paid])), stood: finals[id].stood, ...(finals[id].savedRan ? { savedRan: true } : {}), receivables: r6(t.receivables.reduce((a, x) => a + x.amount, 0)),
      writeOff: writeOff[id] || 0 };
  }
  return { season: s, cards: state.cards, seats, markets, teams, winners: winnersThisSeason };
}

// Profit so far = cash + money still owed - start cash. The final season also applies the haircut on unpaid receivables (done in resolveSeason).
export function standings(state) {
  const rows = state.order.map(id => {
    const t = state.teams[id];
    const owed = t.receivables.reduce((a, r) => a + r.amount, 0);
    return { team: id, name: t.name, house: t.house, personality: t.personality, cash: r6(t.cash), owed: r6(owed), profit: r6(t.cash + owed - t.startCash) };
  });
  const ranked = rows.filter(r => !r.house).sort((a, b) => b.profit - a.profit || a.team.localeCompare(b.team)).map((r, i) => ({ ...r, rank: i + 1 }));
  const house = rows.filter(r => r.house).sort((a, b) => b.profit - a.profit);
  return { ranked, house };
}
export const finalRanking = state => standings(state);
export const seasonResults = (state, season) => state.history[season];

export function exportTables(state) {
  const t = state.tables;
  return { game: { id: state.gameId, seed: state.seed, seasons: state.seasons, deck: state.deck, teams: state.order.map(id => ({ id, brand: state.teams[id].brandId, name: state.teams[id].name, house: state.teams[id].house, personality: state.teams[id].personality })) },
    ...clone(t) };
}
