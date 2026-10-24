// Projector. Public information only: news, who has locked (never what), per-market reveal of every piece sold there, the season's collection
// spread, and one final ranking. 1920 x 1080 stage scaled to the screen. Every step after Start shows its countdown in the masthead (yellow chip)
// and as a bar along the bottom edge; the admin page moves the game on at zero.
// Garments are drawn in code (garment.js); each brand's mark and colour come from its round-0 decisions row, each piece's look from the reveal snapshot.
import { openStore } from './supa.js';
import { h, $, $$, params, mmss, friendlyError } from './util.js';
import { MARKETS, MARKET_IDS, BRAND_BY_ID, dnaChips, tag, tilesCaps, pctf, MODE_LABEL, streetSrc, lobbySrc, eventArt, money, GAME_TITLE, garmentEl, markEl, lazyImg, ROWS, tileLabel, ROW_LABEL } from './ui.js';
import { cleanStyle, cleanLook } from './garment.js';
import { clockLeft } from './clock.js';

const app = $('#app');
let store, gid, game = null, pub = null, reveal = null, prevReveal = null, ready = {}, teams = [], seats = [], finalSnap = null, styles = {};

async function load() {
  game = await store.getGame(gid);
  if (!game) return;
  teams = await store.getTeams(gid);
  const r = game.round || 0;
  if (game.phase === 'lobby') seats = await store.getSeats(gid);
  const srows = await store.getDecisions(gid, 0);
  styles = {};
  for (const d of srows) if (d.plan && d.plan.style) styles[d.team_id] = d.plan.style;
  pub = r ? ((await store.getSnapshots(gid, { kind: 'public', round: r }))[0] || {}).data || null : null;
  reveal = game.phase === 'reveal' || game.phase === 'final' ? ((await store.getSnapshots(gid, { kind: 'reveal', round: r }))[0] || {}).data || null : null;
  prevReveal = r > 1 ? ((await store.getSnapshots(gid, { kind: 'reveal', round: r - 1 }))[0] || {}).data || null : null;
  if (game.phase === 'decide' && pub) {
    const rows = await store.getDecisions(gid, r);
    ready = Object.fromEntries(rows.map(d => [d.team_id, !!d.locked]));
  }
  finalSnap = game.phase === 'final' ? ((await store.getSnapshots(gid, { kind: 'final' }))[0] || {}).data || null : null;
}

// The page redraws on every store event; reusing one <img> per picture keeps it decoded, so a redraw never blanks or re-fetches it.
const pics = new Map();
const pic = src => { if (!pics.has(src)) pics.set(src, lazyImg(src, 'cover', '', true)); return pics.get(src); };
const teamRow = id => teams.find(x => x.team_id === id) || { name: id, brand_id: '', house: false };
const nameOf = id => teamRow(id).name;
const styleOf = id => cleanStyle(styles[id], teamRow(id).brand_id);
const rosterOf = id => (pub && pub.roster.find(r => r.id === id)) || (reveal && reveal.roster.find(r => r.id === id)) || { house: teamRow(id).house, bot: false };
const seasons = () => (game.settings && game.settings.seasons) || 4;
const lookOf = (R, team, design) => (R && R.looks && R.looks[team] ? R.looks[team][design] : null);

// ---------- masthead and clock ----------
function clockLabel() {
  const c = game.clock;
  if (!c) return '';
  if (c.paused) return 'Paused';
  if (game.phase === 'decide') return c.early ? 'All locked. Reveal in' : 'Lock your plan';
  if (game.phase === 'reveal') {
    const idx = (game.reveal && game.reveal.idx) || 0, last = game.round >= seasons();
    return idx < 3 ? 'Next: ' + MARKETS[MARKET_IDS[idx + 1]].name : idx === 3 ? 'Next: the collection' : last ? 'Next: final ranking' : 'Next: season ' + (game.round + 1);
  }
  return '';
}
function clockBox() {
  if (!game.clock) return null;
  return h('div.pclock' + (game.phase === 'decide' ? '.huge' : ''), h('span.lbl.js-clock-label', clockLabel()), h('span.time.js-clock', mmss(clockLeft(game.clock, Date.now()))));
}
const mast = (kicker, sub) => h('header.pmast', h('div.wm.pm-wm', 'Foreign Threads'),
  h('div.pm-kick', h('span', kicker || ''), sub ? h('span.pm-sub', sub) : null), clockBox());
function paintClock() {
  if (!game || !game.clock) return;
  const c = game.clock, left = clockLeft(c, Date.now()), low = !c.paused && left <= (game.phase === 'decide' ? 30000 : 10000);
  $$('.js-clock').forEach(el => { el.textContent = mmss(left); });
  $$('.pclock').forEach(el => { el.classList.toggle('low', low); el.classList.toggle('paused', !!c.paused); });
  const bar = $('.js-bar');
  if (bar) { bar.style.transform = 'scaleX(' + (c.total ? Math.max(0, Math.min(1, left / (c.total * 1000))) : 0).toFixed(4) + ')'; bar.classList.toggle('low', low); }
}

// ---------- screens ----------
function lobby() {
  const joinUrl = location.href.replace(/projector\.html.*$/, 'team.html?g=' + gid);
  const count = id => seats.filter(s => s.team_id === id && !s.removed).length;
  return h('div.pscreen', mast('Game ' + gid, 'MBA 546 · week 10'),
    h('div.plobby',
      h('div.pl-left', h('h1.ph1', 'Join the season.'), h('p.pl-how', 'Open the team page and type your four-letter team code.'), h('div.pl-url', joinUrl),
        h('div.pl-img', pic(lobbySrc()))),
      h('div.pl-right', h('div.sec-h', h('span.lbl', 'Brands in the room')),
        h('div.pl-brands', teams.map(t => h('div.pbrand' + (t.house ? '.house' : count(t.team_id) ? '.in' : ''),
          markEl(styleOf(t.team_id), 52), h('div', h('b.wm', t.name), h('span.pb-st', t.house ? 'House brand, plays itself' : count(t.team_id) ? 'Joined' : 'Waiting for a code'),
            h('div.pb-dna', dnaChips(t.brand_id)))))))));
}

function decide() {
  if (!pub) return h('div.pscreen', mast('Season ' + game.round), h('h1.ph1', 'Getting ready...'));
  return h('div.pscreen', mast('Season ' + game.round + ' of ' + seasons(), 'Decide'),
    h('div.pdecide',
      h('div.pd-news' + (pub.cards.length > 1 ? '.two' : ''), h('div.sec-h', h('span.lbl', 'The Thread'), h('span.lbl', 'Season ' + game.round)),
        pub.cards.length ? pub.cards.map(c => h('article.pnews', c.art ? h('div.pn-img', pic(eventArt(c))) : null,
          h('div', h('h2.pn-head', c.headline), c.standfirst ? h('p.pn-stand', c.standfirst) : null, h('p.pn-rule', c.rule)))) : h('p.pn-stand', 'A quiet season. No rule changes.')),
      h('div.pd-teams', h('div.sec-h', h('span.lbl', 'Brands at work'), h('span.lbl', Object.values(ready).filter(Boolean).length + ' locked')),
        h('div.pt-grid', pub.roster.map(r => { const st = r.house ? 'house' : r.bot ? 'bot' : ready[r.id] ? 'locked' : 'deciding';
          return h('div.ptile.' + st, markEl(styleOf(r.id), 40), h('b.wm', r.name), h('span.pt-st', st === 'house' ? 'House brand' : st === 'bot' ? 'Bot' : st === 'locked' ? 'Locked' : 'Deciding')); })),
        prevReveal ? h('div.pd-seats', h('span.lbl', 'Partner seats last season'), h('div.seats', MARKET_IDS.map(m => h('div', h('span', MARKETS[m].name), h('b', prevReveal.markets[m].seat ? nameOf(prevReveal.markets[m].seat) : 'nobody'))))) : null)));
}

function spreadCol(R, l, win, size) {
  const st = styleOf(l.team), lk = cleanLook(lookOf(R, l.team, l.design), l.tiles), copied = lookOf(R, l.team, l.design) && lookOf(R, l.team, l.design).copyOf;
  return h('article.scol' + (win ? '.win' : ''),
    win ? h('div.ribbon', 'Best seller') : h('div.ribbon.blank', ''),
    garmentEl(l.tiles, lookOf(R, l.team, l.design), st, nameOf(l.team), { cls: 'gsvg ' + size }),
    h('div.sc-brand', markEl(st, 30), h('b.wm', nameOf(l.team)), tag(rosterOf(l.team))),
    h('div.sc-name', lk.name + (copied ? ' (copy)' : '')),
    h('div.sc-mode', MODE_LABEL[l.mode]),
    h('div.sc-share', h('b', pctf(l.share)), h('span', l.buyers.toFixed(0) + 'k buyers')));
}
function marketCard(m) {
  const M = reveal.markets[m], win = reveal.winners.find(w => w.market === m);
  const evs = reveal.events.filter(e => e.market === m);
  const lines = [...M.lines].sort((a, b) => b.share - a.share);
  const size = lines.length <= 3 ? 'xl' : lines.length <= 5 ? 'lg' : 'md';
  return h('div.pscreen', mast('Season ' + game.round + ' · market ' + (MARKET_IDS.indexOf(m) + 1) + '/4', 'The reveal'),
    h('div.pmarket',
      h('aside.pm-side', h('div.wm.pm-city', { style: 'font-size:' + Math.min(128, Math.floor(400 / (MARKETS[m].name.length * 0.5))) + 'px' }, MARKETS[m].name), h('div.pm-img', pic(streetSrc(m))),
        h('div.kv2.pk', h('span', 'Partner seat'), h('b', M.seat ? nameOf(M.seat) : 'Nobody bid enough'),
          h('span', 'Sellers'), h('b', String(M.crowd)),
          h('span', 'Local rival ' + M.incumbent.name), h('b', pctf(M.incumbent.share) + ' of buyers')),
        bidLines(evs.filter(e => e.type === 'bid'))),
      h('section.spread' + (lines.length > 5 ? '.many' : ''),
        lines.length ? lines.map(l => spreadCol(reveal, l, win && win.team === l.team && win.design === l.design, size)) : h('div.nobody', 'Nobody sold here this season.'))),
    threadBar(evs.filter(e => e.type !== 'bid')));
}
// Sealed bids, shortest first form: who bid what. At most four lines so the side panel never runs off the screen.
function bidLines(bids) {
  if (!bids.length) return null;
  const txt = e => e.text.replace(/ for the .* partner seat/, '');
  return h('div.pm-bids', h('span.lbl', 'Sealed bids'), bids.slice(0, 4).map(e => h('div', txt(e))), bids.length > 4 ? h('div', 'and ' + (bids.length - 4) + ' more') : null);
}
function threadBar(evs) {
  return h('div.pthread', h('span.lbl', 'The Thread'), h('div.pt-items', evs.length ? evs.map(e => h('span', (e.market ? MARKETS[e.market].name + ': ' : '') + e.text)) : h('span.quiet', 'No copies, suits or knock-offs here.')));
}

// Height of a brand's lead piece in the collection spread: as tall as its column allows (a garment is 200 x 230), leaving room for side pieces.
const leadH = (n, sides) => { const per = n > 6 ? 6 : Math.max(1, n), colW = 1840 / per - 34 - (sides ? 104 : 0); return Math.round(Math.min(n > 6 ? 150 : 300, colW * 230 / 200)); };
// The season's collection: every brand's pieces that sold anywhere, side by side.
function recap() {
  const R = reveal, by = {};
  for (const m of MARKET_IDS) for (const l of R.markets[m].lines) {
    const t = by[l.team] = by[l.team] || { team: l.team, pieces: {}, best: 0 };
    const p = t.pieces[l.design] = t.pieces[l.design] || { design: l.design, tiles: l.tiles, markets: [], buyers: 0 };
    p.markets.push({ m, share: l.share, win: R.winners.some(w => w.market === m && w.team === l.team && w.design === l.design) });
    p.buyers += l.buyers; t.best = Math.max(t.best, l.buyers);
  }
  const order = R.roster.map(r => r.id);
  const sold = c => Object.values(c.pieces).reduce((x, p) => x + p.buyers, 0);
  // human brands first, then house brands, each by buyers won; brands that sold nothing sit at the end
  const cols = order.map(id => by[id] || { team: id, pieces: {}, sat: true })
    .sort((a, b) => (!!a.sat - !!b.sat) || (!!rosterOf(a.team).house - !!rosterOf(b.team).house) || sold(b) - sold(a));
  const evs = R.events.filter(e => e.type !== 'bid');
  const nxt = game.round < seasons();
  return h('div.pscreen', mast('Season ' + game.round + ' of ' + seasons(), 'Live collection reveal'),
    h('div.precap',
      h('h1.season-out', 'The season is out.'),
      h('div.collection' + (cols.length > 6 ? '.two' : ''), cols.map(c => {
        const st = styleOf(c.team), ps = Object.values(c.pieces).sort((a, b) => b.buyers - a.buyers);
        const lead = ps[0];
        return h('article.ccol' + (c.sat ? '.sat' : ''),
          h('div.cc-brand', h('b.wm', nameOf(c.team)), markEl(st, 34)), tag(rosterOf(c.team)),
          lead ? h('div.cc-name', cleanLook(lookOf(R, c.team, lead.design), lead.tiles).name) : h('div.cc-name', 'Sat this season out'),
          h('div.cc-art', { style: '--lead:' + leadH(cols.length, ps.length > 1) + 'px' }, ps.length ? [garmentEl(ps[0].tiles, lookOf(R, c.team, ps[0].design), st, nameOf(c.team), { cls: 'gsvg lead' }),
            ps.length > 1 ? h('div.cc-sides', ps.slice(1, 3).map(p => garmentEl(p.tiles, lookOf(R, c.team, p.design), st, nameOf(c.team), { cls: 'gsvg side' }))) : null] : h('div.cc-empty', 'No pieces sold')),
          lead ? h('div.cc-tiles', ROWS.map(r => h('div', h('span.lbl', ROW_LABEL[r]), h('b', tileLabel(r, lead.tiles[r]))))) : null,
          ps.length ? h('div.cc-dest', h('span.lbl', 'Sold in'), ps.flatMap(p => p.markets).map(x => h('div' + (x.win ? '.win' : ''), MARKETS[x.m].name + ' ' + pctf(x.share) + (x.win ? ' · best' : '')))) : null);
      }))),
    h('div.pfoot', threadBar(evs), h('div.next', nxt ? 'Next: season ' + (game.round + 1) + ' decisions' : 'Next: the final ranking')));
}

// A brand's best-selling piece in the last season (from the last reveal), drawn beside its line in the final ranking.
function leadPiece(team) {
  if (!reveal) return null;
  let best = null;
  for (const m of MARKET_IDS) for (const l of (reveal.markets[m] || { lines: [] }).lines) if (l.team === team && (!best || l.buyers > best.buyers)) best = l;
  return best;
}
function finalView() {
  const st = finalSnap && finalSnap.standings;
  if (!st) return h('div.pscreen', mast('Final'), h('h1.ph1', 'Final'));
  return h('div.pscreen', mast('After ' + game.round + ' seasons', 'Final ranking'),
    h('div.pfinal', h('h1.pf-h', 'The final ranking.'),
      h('div.pf-cols',
        h('ol.pf-rank', st.ranked.map(r => { const lead = leadPiece(r.team);
          return h('li' + (r.rank === 1 ? '.first' : ''), h('span.rk', '#' + r.rank), markEl(styleOf(r.team), 56), h('b.wm', r.name),
            lead ? garmentEl(lead.tiles, lookOf(reveal, r.team, lead.design), styleOf(r.team), r.name, { cls: 'gsvg pf-g' }) : h('span'), h('span.pr', money(r.profit))); })),
        st.house.length ? h('div.pf-house', h('span.lbl', 'House brands (not ranked)'), st.house.map(r => h('div', markEl(styleOf(r.team), 30), h('span', r.name), h('span', money(r.profit))))) : null)));
}

function render() {
  let body;
  if (!game) body = h('div.pscreen', h('h1.ph1', 'No game ' + (gid || '') + ' found. Add ?g=GAMEID to the address.'));
  else if (game.phase === 'lobby') body = lobby();
  else if (game.phase === 'decide') body = decide();
  else if (game.phase === 'reveal') body = !reveal ? h('div.pscreen', mast('Season ' + game.round), h('h1.ph1', 'The season is closing...')) : (game.reveal && game.reveal.idx < 4 ? marketCard(MARKET_IDS[game.reveal.idx]) : recap());
  else if (game.phase === 'final') body = finalView();
  else body = h('h1', game.phase);
  const stage = h('div.stage', body, game && game.clock ? h('div.pbar', h('div.js-bar')) : null);
  const sc = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = 'scale(' + sc + ')';
  app.replaceChildren(stage);
  paintClock();
}

(async function main() {
  try {
    store = await openStore();
    gid = params().get('g');
    if (gid) { await load(); store.subscribe(gid, async () => { await load(); render(); }); setInterval(paintClock, 250); }
    render();
    addEventListener('resize', render);
    window.__proj = () => ({ game, pub, reveal, styles });
  } catch (e) { app.replaceChildren(h('div', { style: 'padding:30px' }, h('h1', 'Could not start'), h('p', friendlyError(e)))); }
})();
