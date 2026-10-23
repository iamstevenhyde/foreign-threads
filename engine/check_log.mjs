// node engine/check_log.mjs engine/runs/seed42.json
// Fails loudly (exit 1) if a GAME_SPEC.md section 3 field or log type is absent or always null, if a row carries a column pages/schema.sql does not
// have, or if the house rule is broken (house teams ranked, copying, offering or accepting).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file && process.env.NODE_TEST_CONTEXT) process.exit(0);   // `node --test engine/` on Node 18/20 also launches every .mjs here; this one needs a run file
if (!file) { console.error('usage: node engine/check_log.mjs <run.json>'); process.exit(2); }
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
let bad = 0, good = 0;
const fail = m => { bad++; console.log('FAIL ' + m); };
const ok = (c, m) => { if (c) good++; else fail(m); };

// 1. columns: every row key must exist in schema.sql for that table
const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../pages/schema.sql'), 'utf8');
const cols = {};
for (const m of schema.matchAll(/create table if not exists (ww_\w+) \(([\s\S]*?)\n\);/g)) {
  cols[m[1]] = new Set(m[2].split('\n').map(l => l.trim()).filter(l => /^[a-z_]+\s/.test(l) && !/^(primary|foreign|constraint)/.test(l)).map(l => l.split(/\s+/)[0]));
}
const TABLES = ['ww_log', 'ww_seasons', 'ww_designs', 'ww_bids', 'ww_deals', 'ww_decisions', 'ww_brands'];
for (const t of TABLES) {
  ok(Array.isArray(run[t]) && run[t].length > 0, t + ' has rows');
  const extra = new Set();
  for (const r of run[t] || []) for (const k of Object.keys(r)) if (!cols[t].has(k)) extra.add(k);
  ok(extra.size === 0, t + ' writes only columns that schema.sql has' + (extra.size ? ' (unknown: ' + [...extra].join(', ') + ')' : ''));
}

// 2. the section 3 fields: present on every row and not null somewhere
const need = {
  ww_seasons: ['fit', 'profit', 'mode', 'tax_paid', 'tiles_known', 'buyers', 'crowd', 'share', 'partner_fee', 'setup_paid', 'duty_paid', 'revenue', 'unit_cost', 'design_id'],
  ww_designs: ['fee', 'dna_cost', 'designs_this_season', 'unit_cost', 'cut', 'palette', 'logo', 'fabric'],
  ww_bids: ['amount', 'capped_to', 'won'],
  ww_deals: ['holder_team', 'carried_team', 'fee', 'copied', 'status', 'holder_saw_design'],
  ww_decisions: ['why', 'stood', 'plan'],
};
for (const [t, fields] of Object.entries(need)) for (const f of fields) {
  const rows = run[t] || [];
  ok(rows.length && rows.every(r => f in r), t + '.' + f + ' is on every row');
  ok(rows.some(r => r[f] !== null && r[f] !== undefined && r[f] !== ''), t + '.' + f + ' is not always null or empty');
}

// 3. the fields must fire, not just exist (a zero column is a rule that never ran)
const S = run.ww_seasons, D = run.ww_designs, B = run.ww_bids, DL = run.ww_deals, DC = run.ww_decisions, L = run.ww_log;
const pos = (rows, f) => rows.some(r => Number(r[f]) > 0);
for (const f of ['tax_paid', 'duty_paid', 'setup_paid', 'partner_fee', 'seat_paid', 'partner_income', 'suit_paid', 'suit_received', 'research_paid', 'buyers', 'crowd']) ok(pos(S, f), 'ww_seasons.' + f + ' is above zero somewhere');
for (const mode of ['ship', 'partner', 'own', 'carried', 'none']) ok(S.some(r => r.mode === mode), 'ww_seasons.mode takes the value ' + mode);
ok(S.every(r => r.mode !== 'ship' || r.market !== 'nairobi'), 'nobody shipped to Nairobi');
ok(S.every(r => r.market !== 'nairobi' || Number(r.research_paid) === 0), 'no research bought in Nairobi');
ok(S.some(r => r.market === 'saopaulo' && r.mode === 'ship' && r.duty_paid > 0), 'Sao Paulo shipped goods paid duty');
ok(S.every(r => r.market === 'saopaulo' || r.mode !== 'ship' || r.duty_paid === 0), 'duty only in Sao Paulo');
ok(pos(D, 'fee') && pos(D, 'dna_cost') && D.some(r => r.designs_this_season > 1), 'designs: fee, dna_cost and designs_this_season above one all occur');
ok(D.some(r => r.is_copy), 'a design was a copy');
ok(B.some(r => r.won === true) && B.some(r => r.won === false) && B.some(r => r.capped_to !== null), 'bids: won, lost and capped_to all occur');
ok(DL.some(r => r.status === 'accepted') && DL.some(r => r.copied === true) && DL.some(r => r.holder_saw_design === true), 'deals: accepted, copied and holder_saw_design all occur');
ok(DC.some(r => r.stood === true) && DC.some(r => r.why && r.why.length), 'decisions: a last plan stood and a why was stored');
const tilesKnown = new Set(S.map(r => r.tiles_known));
ok(tilesKnown.size > 1, 'tiles_known varies (fog moves)');
// taxes fall by season for a team that stays in a market
const byKey = {};
for (const r of S) if (r.mode !== 'none' && r.mode !== 'partner' && r.mode !== 'carried') (byKey[r.team_id + r.market] = byKey[r.team_id + r.market] || []).push(r);
ok(Object.values(byKey).some(a => a.length > 1 && a.every((r, i) => i === 0 || r.tax_rate < a[i - 1].tax_rate)), 'a team\'s foreignness tax rate falls season on season');

// 4. log types
const types = new Set(L.map(r => r.type));
for (const t of ['event', 'design', 'plan', 'fog', 'bid', 'sale', 'copy', 'suit', 'street', 'carry', 'standing']) ok(types.has(t), 'ww_log has type ' + t);
const sources = new Set(L.filter(r => r.type === 'fog').map(r => r.payload.source));
for (const s of ['start', 'season', 'partner', 'clue', 'research']) ok(sources.has(s), 'fog source ' + s + ' occurs');
ok(L.some(r => r.type === 'plan' && r.payload.stood && /last plan stood/i.test(r.text)), 'a "Your last plan stood" plan entry exists');
ok(L.some(r => r.type === 'carry' && r.payload.phase === 'offer') && L.some(r => r.type === 'carry' && r.payload.status === 'accepted'), 'carry: offer and accepted entries exist');
ok(L.filter(r => r.type === 'event').length >= run.seasons * 2, 'two event cards logged per season');
ok(L.every((r, i) => r.seq === i + 1), 'log seq runs 1..n');

// 5. house rule
const house = new Set(run.game.teams.filter(t => t.house).map(t => t.id));
ok(run.ranking.ranked.every(r => !house.has(r.team)), 'house teams are not in the prize ranking');
ok(run.ranking.house.length === house.size, 'house teams are listed apart');
ok(!L.some(r => r.type === 'copy' && house.has(r.team_id)), 'a house team never copied');
ok(!L.some(r => r.type === 'carry' && ((r.payload.phase === 'offer' && house.has(r.payload.carried)) || (r.payload.status === 'accepted' && (house.has(r.payload.holder) || house.has(r.payload.carried))))), 'a house team never offered or took a carry');
ok(!DC.some(r => house.has(r.team_id) && (r.plan.copy.length || r.plan.accept.length)), 'no house plan copies or accepts');
ok(S.some(r => house.has(r.team_id) && r.buyers > 0), 'house teams sold (they count in the split)');

console.log(bad ? '\n' + bad + ' check(s) FAILED, ' + good + ' passed' : 'log OK: ' + good + ' checks passed (' + L.length + ' log rows, ' + S.length + ' season rows)');
process.exit(bad ? 1 : 0);
