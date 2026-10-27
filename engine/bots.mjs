// Scripted players for the headless run: the three house personalities (config/rules.js HOUSE) and a spread of simple strategies for the other seats.
// A bot reads only teamView() output (fog applied) and returns a plan; it never sees a taste or a weight. Randomness only through the rand() it is given.

import { ROWS, tileIds } from '../config/tiles.js';
import { MARKET_IDS, MARKETS } from '../config/markets.js';
import { dnaState } from '../config/brands.js';
import { HOUSE } from '../config/rules.js';
import { costPlan } from './core.mjs';

const TIER = HOUSE.tierWeight;
// Bot-side knobs (not game rules). Exposed so balance/batch.mjs can sweep them with --set TUNE.name=value.
export const TUNE = { adapterBidFrac: 0.4, highbidderBidFrac: 1.15, adapterRunCeiling: 100, standardizerRun: 50, runSlack: 0.9, rivalFit: 0.55, rivalScale: 0.5 };
const tileCost = (view, row, tile) => view.pub.DESIGN.dnaSurcharge[dnaState(view.team.brandId, row, tile)];

// Best tile per row over a set of markets: matches the revealed taste tile (weighted by its tier); unknown rows fall back to the cheapest DNA tile.
export function designFor(view, markets) {
  const d = {};
  for (const row of ROWS) {
    const score = {};
    for (const m of markets) { const k = view.known[m][row]; if (k) score[k.tile] = (score[k.tile] || 0) + TIER[k.tier]; }
    const ids = tileIds(row);
    d[row] = ids.slice().sort((a, b) => (score[b] || 0) - (score[a] || 0) || tileCost(view, row, a) - tileCost(view, row, b) || ids.indexOf(a) - ids.indexOf(b))[0];
  }
  return d;
}
const sameTiles = (a, b) => ROWS.every(r => a[r] === b[r]);
export function knownWeight(view, m) { return Object.values(view.known[m]).reduce((a, k) => a + TIER[k.tier], 0); }
export function marketScore(view, m) { const pm = view.pub.markets[m]; return knownWeight(view, m) * pm.pool / (1 + (view.lastCrowd[m] || 0)); }
const byScore = view => MARKET_IDS.slice().sort((a, b) => marketScore(view, b) - marketScore(view, a) || MARKET_IDS.indexOf(a) - MARKET_IDS.indexOf(b));
export function bestPrice(view, m) {
  const pm = view.pub.markets[m];
  const tc = view.pub.TIER_COST || {}, base = view.pub.RUNS.unitCost[25] * 1.1;     // a mid-size run with a second design's cost uplift
  const score = t => pm.priceFit[t] * (view.pub.PRICES[t] - base * (tc[t] || 1));     // share weight x margin per garment at a 50k run
  return Object.keys(view.pub.PRICES).sort((a, b) => score(b) - score(a))[0];
}
// Expected buyers from what the team can see: revealed rows count at their tier weight, hidden rows at a blind guess, rivals at a typical weight.
export function estDemand(view, m, tiles, mode, price) {
  const pm = view.pub.markets[m];
  let f = 0, unk = 0;
  for (const row of ROWS) { const k = view.known[m][row]; if (k) { if (k.tile === tiles[row]) f += TIER[k.tier]; } else unk++; }
  f = Math.min(1, f + unk * 0.12);
  const reach = (view.pub.SHARE.reach[mode] + (mode === 'ship' ? pm.shipReachBonus || 0 : 0)) * (mode === 'own' && !view.owned[m] ? view.pub.MODES.own.ownRampFirstSeason : 1);
  const tol = pm.tolerance || 0, eff = x => tol + (1 - tol) * x;
  const w = eff(f) * eff(f) * pm.priceFit[price] * reach;
  const incW = eff(pm.incumbent.fit) * eff(pm.incumbent.fit) * pm.priceFit[pm.incumbent.price];
  // a typical rival: ordinary fit, shipping, standard price; as many as sold here last season (minus me), or four if nobody has yet
  const shipReach = view.pub.SHARE.reach.ship + (pm.shipReachBonus || 0);
  const rivalW = eff(TUNE.rivalFit) * eff(TUNE.rivalFit) * (pm.priceFit.standard || 1) * shipReach * TUNE.rivalScale;
  const rivals = Math.max((view.lastCrowd[m] ?? 5) - 1, 0) * rivalW;
  return pm.pool * w / (w + incW + rivals);
}
export function runFor(view, m, tiles, mode, price, ceiling = 100) {
  const need = estDemand(view, m, tiles, mode === 'carried' ? 'partner' : mode, price) * 0.9;
  const sizes = view.pub.RUNS.sizes.filter(x => x <= ceiling);
  return sizes.find(x => x >= need) || sizes[sizes.length - 1];
}
// Expected profit of one line from public information only (what a team could work out from the rules strip): buyers from estDemand capped at the run,
// price against unit cost with the foreignness tax, duty, own set-up and the walk-away cut where there is no court. The seat bid is not included.
export function lineValue(view, m, tiles, mode, price, run, nDesigns = 2) {
  const pub = view.pub, pm = pub.markets[m];
  const mult = pub.DESIGN.unitCostMultiplier[Math.min(nDesigns, pub.DESIGN.unitCostMultiplier.length) - 1];
  const unitBase = pub.RUNS.unitCost[run] * mult * ((pub.TIER_COST || {})[price] || 1);
  const partnered = mode === 'partner' || mode === 'carried';
  const tax = pm.taxBySeason[Math.min(view.active[m] || 0, pm.taxBySeason.length - 1)] * (partnered ? pub.PARTNER_TAX_CUT : 1);
  const buyers = Math.min(estDemand(view, m, tiles, mode, price), run);
  const rev = buyers * pub.PRICES[price] / 1000;
  const leak = mode === 'partner' && pm.rules.partnerWalks ? (pm.rules.walkShare || 0) * rev : 0;
  const lag = mode !== 'own' && pm.rules.paymentLagSeasons ? 0.85 : 1;       // money a season late is worth a little less
  const duty = mode === 'ship' ? pm.rules.dutyShipped * unitBase * run / 1000 : 0;
  const setup = mode === 'own' && !view.owned[m] ? pub.MODES.own.setup : 0;
  return (rev - leak) * lag - unitBase * (1 + tax) * run / 1000 - duty - setup;
}
// Pick mode, run and bid for one market the way a careful team would: compare the open modes on expected profit, and bid for the seat only
// a share (bidFrac) of what the seat adds over the best other way in.
export function chooseLine(view, m, tiles, { price = null, bidFrac = 0.4, ceiling = 100, nDesigns = 2 } = {}) {
  const pub = view.pub, pm = pub.markets[m], pr = price || bestPrice(view, m);
  const sizes = pub.RUNS.sizes.filter(x => x <= ceiling);
  const best = mode => sizes.map(run => ({ mode, run, v: lineValue(view, m, tiles, mode, pr, run, nDesigns) })).sort((a, b) => b.v - a.v)[0];
  const open = ['ship', 'own', 'partner'].filter(x => pm.rules.modes.includes(x));
  const cand = Object.fromEntries(open.map(x => [x, best(x)]));
  const others = open.filter(x => x !== 'partner').map(x => cand[x]).sort((a, b) => b.v - a.v)[0] || null;
  const seat = cand.partner;
  if (seat && (!others || seat.v - others.v > pub.BUDGET.minPartnerBid / bidFrac)) {
    const gain = seat.v - (others ? Math.max(others.v, 0) : 0);
    const bid = Math.max(pub.BUDGET.minPartnerBid, Math.min(view.bidCap, Math.round(bidFrac * gain * 4) / 4));
    return { market: m, tiles, mode: 'partner', price: pr, run: seat.run, bid, fallback: others && others.v > 0 ? others.mode : 'none', ev: seat.v - bid, fixedRun: true };
  }
  if (others && others.v > 0) return { market: m, tiles, mode: others.mode, price: pr, run: others.run, bid: 0, fallback: 'none', ev: others.v, fixedRun: true };
  return null;
}

const FIXED = Symbol('fixed');   // a line the bot protects when it has to cut a plan to its cash (not serialised)
const openMode = (view, m, mode) => view.pub.markets[m].rules.modes.includes(mode);
const clampBid = (view, x) => Math.max(view.pub.BUDGET.minPartnerBid, Math.min(x, view.bidCap));

// Turn per-market specs into a plan: identical tile sets share one design.
export function assemble(view, specs, copies = []) {
  const designs = [], markets = {};
  for (const sp of specs) {
    let d = designs.find(x => sameTiles(x, sp.tiles));
    if (!d) { d = { id: 'D' + (designs.length + 1), ...sp.tiles }; designs.push(d); }
    const run = sp.fixedRun ? sp.run : runFor(view, sp.market, sp.tiles, sp.mode, sp.price, sp.run);
    markets[sp.market] = { mode: sp.mode, design: d.id, price: sp.price, run, bid: sp.bid || 0, fallback: sp.fallback || 'none', [FIXED]: !!sp.fixedRun };
  }
  for (const c of copies) {
    const w = view.publicWinners.find(x => x.team === c.from_team && x.design === c.design && x.season === c.season);
    const tiles = w ? w.tiles : designFor(view, [c.market]);
    markets[c.market] = { mode: c.mode, design: c.id, price: c.price, run: c.fixedRun ? c.run : runFor(view, c.market, tiles, c.mode, c.price, c.run), bid: c.bid || 0, fallback: c.fallback || 'none', [FIXED]: !!c.fixedRun || !!c.keep };
  }
  return { designs, markets, research: [], copy: copies.map(c => ({ id: c.id, from_team: c.from_team, design: c.design, season: c.season, market: c.market })), accept: [] };
}

// Cut a plan to the cash the team holds: smaller runs first, then dearest bids, then drop lines. Bot-side only; the engine never trims a plan.
export function fitToCash(view, plan) {
  const sizes = view.pub.RUNS.sizes;
  for (let i = 0; i < 80; i++) {
    const c = costPlan(view.pub, view.ctx, plan);
    if (c.total <= view.cash - 0.01) return plan;
    const lines = Object.entries(plan.markets).filter(([, l]) => l.mode && l.mode !== 'none');
    const held = ([m]) => (c.by[m] ? c.by[m].held : 0);
    let done = false;
    for (const prot of [false, true]) {            // cut unprotected lines first, protected ones (fixed runs, defended seats) last
      const pool = lines.filter(([, l]) => !!l[FIXED] === prot);
      const big = pool.filter(([, l]) => l.run > sizes[0]).sort((a, b) => held(b) - held(a));
      if (big.length) { const l = big[0][1]; l.run = sizes[sizes.indexOf(l.run) - 1]; done = true; break; }
      const bids = pool.filter(([, l]) => l.bid > 0).sort((a, b) => b[1].bid - a[1].bid);
      if (bids.length) { const [m, l] = bids[0]; l.bid = 0; if (l.mode === 'partner') l.mode = openMode(view, m, 'ship') ? 'ship' : 'none'; done = true; break; }
      if (pool.length) { delete plan.markets[pool.sort((a, b) => held(b) - held(a))[0][0]]; done = true; break; }
    }
    if (!done) break;
  }
  return plan;
}

// FNV-1a hash of a string to [0, 1). No game rng is consumed, so adding the spread does not shift any other draw.
export function hashU(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) / 4294967296; }

// ---------- house personalities ----------
export function housePlan(view, personality) {
  const P = HOUSE.personalities[personality], cash = view.cash, specs = [];
  const order = byScore(view);
  // 10/27: house bids vary by team, season and market inside HOUSE.bidSpread (a fixed hash, so a rerun of the same room bids the same)
  const spread = HOUSE.bidSpread || [1, 1];
  const bidAmt = (m = '') => { const u = hashU(view.gameId + '|' + view.team.id + '|' + view.season + '|' + m); return clampBid(view, Math.round(P.bidShare * cash * (spread[0] + (spread[1] - spread[0]) * u) * 20) / 20); };
  if (personality === 'steady') {
    const tiles = designFor(view, MARKET_IDS);
    for (const m of MARKET_IDS) {
      const ship = openMode(view, m, 'ship');
      specs.push({ market: m, tiles, mode: ship ? 'ship' : 'partner', price: P.price, run: P.run, bid: bidAmt(m), fallback: P.fallback });
    }
  } else if (personality === 'local') {
    order.forEach((m, i) => {
      const tiles = designFor(view, [m]), bids = i < 2;
      const ship = openMode(view, m, 'ship');
      if (bids) specs.push({ market: m, tiles, mode: 'partner', price: bestPrice(view, m), run: P.run, bid: bidAmt(m), fallback: ship ? 'ship' : 'none' });
      else if (ship) specs.push({ market: m, tiles, mode: 'ship', price: bestPrice(view, m), run: P.run, bid: 0, fallback: 'none' });
    });
  } else {
    const best = order[0];
    order.forEach((m, i) => {
      const tiles = designFor(view, [m]), ship = openMode(view, m, 'ship');
      if (m === best) specs.push({ market: m, tiles, mode: P.ownMode, price: bestPrice(view, m), run: P.ownRun, bid: 0, fallback: 'none' });
      else if (i <= 2 && ship) specs.push({ market: m, tiles, mode: 'partner', price: bestPrice(view, m), run: P.run, bid: bidAmt(m), fallback: 'ship' });
    });
  }
  const plan = fitToCash(view, assemble(view, specs));
  return { plan, lock: true, why: P.why };
}

// ---------- strategies for the non-house seats ----------
export const STRATEGIES = ['adapter', 'standardizer', 'copier', 'highbidder', 'nairobi'];

// Hold the seat in a market where a rival has offered to be carried: a carry only stands if the holder wins the seat again.
function defend(view, plan) {
  for (const m of MARKET_IDS) {
    const l = plan.markets[m];
    if (view.offersToMe.some(o => o.market === m) && l && l.mode !== 'none') { l.bid = Math.max(l.bid || 0, 0.8 * view.bidCap); l[FIXED] = true; if (l.mode === 'ship') l.mode = 'partner'; l.fallback = l.fallback && l.fallback !== 'none' ? l.fallback : (openMode(view, m, 'ship') ? 'ship' : 'none'); }
  }
  return plan;
}
function offerAccept(view, plan) { plan.accept = view.offersToMe.map(o => ({ deal_id: o.id })); return plan; }

export function strategyPlan(bot, view, rand) {
  const s = view.season, cash = view.cash, order = byScore(view), m1 = bot.mem;
  if (bot.strategy === 'standardizer') {
    const tiles = designFor(view, MARKET_IDS), specs = [];
    for (const m of MARKET_IDS) if (openMode(view, m, 'ship')) specs.push({ market: m, tiles, mode: 'ship', price: 'standard', run: 50, bid: 0 });
    // lazy: locks in season 1, then never again, so the engine keeps its last plan
    return { plan: fitToCash(view, assemble(view, specs)), lock: s === 1, why: s === 1 ? 'One design everywhere, cheapest way in' : '' };
  }
  if (bot.strategy === 'adapter') {
    const specs = [];
    let copies = [];
    const offers = view.offersToMe;
    if (offers.length) {
      const o = offers[0];
      copies = [{ id: 'X1', from_team: o.carried, design: o.design.id, season: s, market: o.market, mode: openMode(view, o.market, 'partner') ? 'partner' : 'ship', price: bestPrice(view, o.market), run: 25,
        bid: view.bidCap, fallback: 'none', keep: true }];
    }
    for (const m of MARKET_IDS) {
      if (copies.some(c => c.market === m)) continue;
      const sp = chooseLine(view, m, designFor(view, [m]), { bidFrac: TUNE.adapterBidFrac, ceiling: TUNE.adapterRunCeiling, nDesigns: 3 });
      if (sp) specs.push(sp);
    }
    const plan = defend(view, offerAccept(view, assemble(view, specs.slice(0, 4 - copies.length), copies)));
    const unknown = MARKET_IDS.filter(m => view.pub.markets[m].rules.research && Object.keys(view.known[m]).length < 4).sort((a, b) => Object.keys(view.known[a]).length - Object.keys(view.known[b]).length);
    if (s <= 3 && cash >= 8 && unknown.length) plan.research = [unknown[0]];
    return { plan: fitToCash(view, plan), lock: true, why: copies.length ? 'Adapt per market, and take the carry offer' : 'Adapt a design to each market and bid for the best two' };
  }
  if (bot.strategy === 'highbidder') {
    const specs = [];
    order.forEach((m, i) => {
      const tiles = designFor(view, [m]), ship = openMode(view, m, 'ship');
      if (i < 1) { const sp = chooseLine(view, m, tiles, { bidFrac: TUNE.highbidderBidFrac }); if (sp) { if (sp.mode === 'partner') sp.bid = view.bidCap * 1.4; specs.push(sp); } }   // asks for more than the cap allows, so the cap is seen to bite
      else if (ship) specs.push({ market: m, tiles, mode: 'ship', price: bestPrice(view, m), run: 50, bid: 0 });
    });
    return { plan: fitToCash(view, defend(view, offerAccept(view, assemble(view, specs)))), lock: true, why: 'Pay up for the partner seat in the market we know best' };
  }
  if (bot.strategy === 'nairobi') {
    const specs = [];
    const tiles = designFor(view, ['nairobi']);
    specs.push({ market: 'nairobi', tiles, mode: 'own', price: bestPrice(view, 'nairobi'), run: s === 1 ? 50 : 100, bid: 0, fixedRun: true });
    const t2 = designFor(view, ['berlin']);
    if (openMode(view, 'berlin', 'ship')) specs.push({ market: 'berlin', tiles: t2, mode: 'ship', price: 'standard', run: 100, bid: 0 });
    return { plan: fitToCash(view, assemble(view, specs)), lock: true, why: 'Own Nairobi where no court can help, ship to Berlin' };
  }
  // copier: season 1 ships one design and watches the runway; later it copies what won, first in the court markets (and finds out what a suit costs),
  // then only where no court sues; it also buys a carry where a rival holds the seat.
  const specs = [], copies = [];
  if (s === 1) {
    const tiles = designFor(view, MARKET_IDS);
    for (const m of ['berlin', 'tokyo', 'saopaulo']) specs.push({ market: m, tiles, mode: 'ship', price: 'standard', run: 50, bid: 0 });
    return { plan: fitToCash(view, assemble(view, specs)), lock: true, why: 'Season one: ship one design and watch the runway' };
  }
  const carryMkts = new Set((m1.carry || []).map(c => c.market));
  const mine = view.team.id;
  const courts = m => view.pub.markets[m].rules.court;
  const order2 = s === 2 ? ['berlin', 'tokyo', 'saopaulo', 'nairobi'] : ['saopaulo', 'nairobi', 'berlin', 'tokyo'];
  for (const m of order2) {
    if (carryMkts.has(m) && !(s === 2 && courts(m))) continue;     // season 2 copies in a court market even if it also offered a carry there
    if (copies.length >= 2) break;
    if (s > 2 && courts(m)) continue;
    const w = view.publicWinners.filter(x => x.market === m && x.team !== mine).sort((a, b) => b.season - a.season)[0];
    if (!w) continue;
    copies.push({ id: 'X' + (copies.length + 1), from_team: w.team, design: w.design, season: w.season, market: m, mode: openMode(view, m, 'ship') ? 'ship' : 'own', price: 'standard', run: 25, fixedRun: true, keep: true, bid: 0 });
  }
  for (const c of (m1.carry || [])) {
    if (!view.myOffers.some(o => o.market === c.market && o.status !== 'void') || copies.some(x => x.market === c.market)) continue;
    specs.push({ market: c.market, tiles: c.design, mode: 'carried', price: bestPrice(view, c.market), run: 50, bid: 0, fallback: 'none', fixedRun: true });
  }
  const plan = assemble(view, specs, copies);
  if (!plan.designs.length && !plan.copy.length) return { plan: fitToCash(view, assemble(view, [{ market: 'berlin', tiles: designFor(view, MARKET_IDS), mode: 'ship', price: 'standard', run: 50, bid: 0 }])), lock: true, why: 'Nothing to copy yet' };
  return { plan: fitToCash(view, plan), lock: true, why: 'Copy what won on the runway, carry where a partner will take us' };
}

// Offers made after the reveal (copier only among the strategies): ask the first non-house holder that is not us to carry a design built for that market.
export function strategyOffers(bot, view) {
  bot.mem.carry = [];
  if (bot.strategy !== 'copier' || view.season >= view.seasons) return [];
  const out = [];
  for (const m of ['saopaulo', 'tokyo', 'berlin', 'nairobi']) {
    const holder = view.lastSeats[m];
    if (!holder || holder === view.team.id || view.brands[holder].house) continue;
    const tiles = designFor(view, [m]);
    out.push({ market: m, holder_team: holder, design: { id: 'D' + (out.length + 1), ...tiles } });
    bot.mem.carry.push({ market: m, design: tiles });
    if (out.length >= 3) break;
  }
  return out;
}
