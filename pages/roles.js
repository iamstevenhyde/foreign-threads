// Seats, roles and the client-side plan checks (spec 01 section 13, spec 05 sections 1.2, 1.3, 1.7).
// The engine does not enforce roles. This file does, for the screens. The admin page re-validates every lock with the engine.

import { wordCount, fmtM } from './util.js';

export const ROLE_DEFS = {
  ceo: { key: 'ceo', label: 'CEO', perms: ['lock'], hint: 'The CEO writes the why and the predicted value, and presses Lock.' },
  cfo: { key: 'cfo', label: 'CFO', perms: ['capital'], hint: 'The CFO picks the capital request on each business card.' },
  deals: { key: 'deals', label: 'Head of Deals', perms: ['market'], hint: 'The Head of Deals handles bids, co-bids, listings and deep dives on listed companies.' },
  ops: { key: 'ops', label: 'Head of Operations', perms: ['ops'], hint: 'The Head of Operations runs Integrate, Turnaround, Develop capability and deep dives on pairs you hold.' },
  ceo_deals: { key: 'ceo_deals', label: 'CEO and Head of Deals', perms: ['lock', 'market'], hint: 'Two-person team: you lock the plan and handle the market.' },
  cfo_ops: { key: 'cfo_ops', label: 'CFO and Head of Operations', perms: ['capital', 'ops'], hint: 'You pick capital requests and run corporate actions.' },
  cfo_ops3: { key: 'cfo_ops3', label: 'CFO and Head of Operations', perms: ['capital', 'ops'], hint: 'Three-person team: one seat owns both capital and corporate actions.' },
  solo: { key: 'solo', label: 'CEO (all jobs)', perms: ['lock', 'capital', 'market', 'ops'], hint: 'You are the only seat, so you hold every job.' },
};
// Steven, 2026-10-10 play-through ask 4: drop roles for now. Every seat holds every job; flip ROLES_ON to bring the rotation back.
export const ROLES_ON = false;
ROLE_DEFS.member = { key: 'member', label: 'Team member', perms: ['lock', 'capital', 'market', 'ops'], hint: 'Everyone on a team can do every job.' };
export const ROLE_KEYS = Object.keys(ROLE_DEFS);

// The cycle of roles for a team of n active seats. A seat at position i holds list[(i + round - 1) % n].
export function roleCycle(n, round) {
  if (n <= 1) return ['solo'];
  if (n === 2) return ['ceo_deals', 'cfo_ops'];
  if (n === 3) return ['ceo', 'deals', 'cfo_ops3'];
  const base = ['ceo', 'cfo', 'deals', 'ops'];
  for (let i = 4; i < n; i++) base.push(round === 4 ? 'deals' : 'ops');
  return base;
}
export function activeSeats(seats, teamId) {
  return seats.filter(x => x.team_id === teamId && !x.removed).sort((a, b) => (a.slot - b.slot) || (a.id < b.id ? -1 : 1));
}
export function roleFor(seats, seat, round) {
  if (!ROLES_ON) return ROLE_DEFS.member;
  if (seat.role_override && ROLE_DEFS[seat.role_override]) return ROLE_DEFS[seat.role_override];
  const mates = activeSeats(seats, seat.team_id);
  const pos = Math.max(0, mates.findIndex(x => x.id === seat.id));
  const cyc = roleCycle(mates.length, round);
  return ROLE_DEFS[cyc[(pos + Math.max(0, round - 1)) % cyc.length]];
}
export const can = (role, perm) => !!role && role.perms.includes(perm);

// What a role edits, for the grey-out tooltip.
export const OWNER_LABEL = { lock: 'CEO', capital: 'CFO', market: 'Head of Deals', ops: 'Head of Operations' };

export function planFromRow(row) {
  row = row || {};
  const m = row.market || {};
  return { bids: m.bids || [], builds: m.builds || [], capital: row.capital || {}, actions: row.actions || [], live: !!m.closed || !!(m.live && Object.keys(m.live).length), liveBids: m.live || {} };
}
// In a live-market game the bids are won in the market and limited by cash, so they do not use attention.
export const attentionUsed = (plan, live) => ((plan.live || live) ? 0 : plan.bids.length) + plan.builds.length + plan.actions.length;

// The cash meter, from the numbers in the team view. Same arithmetic as the engine's reservedFor():
// highest single bid (own share, plus the deal fee) plus builds, capital requests and action costs.
export function meter(view, plan) {
  const lotBy = Object.fromEntries(view.lots.map(l => [l.key, l]));
  let maxBid = 0, rest = 0;
  for (const b of plan.bids) {
    const lot = lotBy[b.lot]; if (!lot) continue;
    const amt = lot.kind === 'team' ? lot.price : Number(b.amount) || 0;
    const one = amt * (b.ally ? 0.5 : 1) * (1 + view.feeRate);
    maxBid = view.liveAuction ? maxBid + one : Math.max(maxBid, one);
  }
  for (const b of plan.builds) { const lot = lotBy[b.lot]; if (lot) rest += lot.buildCost || 0; }
  for (const [uid, idx] of Object.entries(plan.capital)) {
    if (idx === null || idx === undefined) continue;
    const u = view.units.find(x => x.id === uid); if (u) rest += u.requests[idx].cost * u.w;
  }
  for (const a of plan.actions) rest += actionCost(view, a);
  const obl = view.liveAuction && view.obl ? view.obl.total : 0, total = maxBid + rest + obl;
  return { maxBid, rest, obl, total, free: view.budget - total, short: Math.max(0, total - view.budget), commits: maxBid + rest };
}
export function actionCost(view, a) {
  const c = view.costs;
  switch (a.type) {
    case 'integrate': return c.integrate[[a.a, a.b].sort().join('+')] || 0;
    case 'turnaround': return c.turnaround[a.unit] || 0;
    case 'devcap': return c.devcap;
    case 'hedge': return c.hedge[a.chain + '|' + a.unit] || 0;
    default: return 0;
  }
}

// The first reason the Lock button is off, in the order of spec 05 section 1.7. Returns null when it can lock.
export function lockReason(view, plan, why, predicted, round, opts = {}) {
  const needWhy = opts.requireWhy === true;   // the why sentence and predicted value never block a lock unless the admin switches the gate on
  const m = meter(view, plan);
  if (m.short > 1e-6 && m.commits > 0) return 'Cash is ' + fmtM(Math.ceil(m.short)) + ' short. ' + (view.liveAuction ? 'That counts about ' + fmtM(Math.ceil(m.obl)) + ' you must pay at the end of the round (interest and the cost of running your businesses). Without it the game would force you to sell a business. Your market wins and build orders stay, so remove a capital request or an action. Check Free to spend before you lock.' : 'Remove a bid or a capital request.');
  const att = attentionUsed(plan, view.liveAuction);
  if (att > view.attMax) return 'You picked ' + att + ' actions. The limit is ' + view.attMax + '.';
  if (needWhy && wordCount(why) < 8) return 'Write your one-sentence why.';
  if (needWhy && (predicted === null || predicted === undefined || predicted === '' || !(Number(predicted) > 0))) return 'Enter your predicted value.';
  if (round === 1 && !view.liveAuction && !plan.bids.length && !plan.builds.length) return 'Round 1 rule: you must bid on, co-bid on, or build one company.';
  return null;
}

// Plain-word labels for a plan item, used on the team page and in the log.
export function describeAction(view, a) {
  const nm = id => (view.units.find(u => u.id === id) || {}).name || id;
  switch (a.type) {
    case 'integrate': return 'Integrate ' + nm(a.a) + ' and ' + nm(a.b);
    case 'turnaround': return 'Turnaround at ' + nm(a.unit);
    case 'devcap': return 'Develop capability: ' + (view.capLabels[a.cap] || a.cap);
    case 'deepdive': return a.lot ? 'Deep dive on ' + ((view.lots.find(l => l.key === a.lot) || {}).name || a.lot) : 'Deep dive on ' + nm(a.pair[0]) + ' and ' + nm(a.pair[1]);
    case 'divest': return a.mode === 'list' ? 'List ' + nm(a.unit) + ' at ' + Math.round(a.f * 100) + ' percent' : 'Sell ' + nm(a.unit) + ' to the market';
    case 'hedge': return 'Protect ' + nm(a.unit) + ' against ' + ((view.hedges.find(x => x.chain === a.chain) || {}).title || a.chain);
    default: return a.type;
  }
}
