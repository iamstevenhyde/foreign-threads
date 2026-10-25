// Projector. Public information only: news, who has locked (never what), per-market reveal of winners and designs, and one final ranking.
// Every step after Start shows its countdown large in the top right and as a bar along the bottom edge; the admin page moves the game on at zero.
import { openStore } from './supa.js';
import { h, $, params, mmss, friendlyError, pageMode } from './util.js';
import { MARKETS, MARKET_IDS, BRANDS, BRAND_BY_ID, dnaChips, tag, garmentImg, tilesText, pctf, MODE_LABEL, streetSrc, art, money, GAME_TITLE } from './ui.js';
import { clockLeft } from './clock.js';

const app = $('#app');
let store, gid, game = null, pub = null, reveal = null, prevReveal = null, ready = {}, teams = [], seats = [], finalSnap = null;

const isDark = () => game && game.phase === 'reveal';

async function load() {
  game = await store.getGame(gid);
  if (!game) return;
  teams = await store.getTeams(gid);
  const r = game.round || 0;
  if (game.phase === 'lobby') seats = await store.getSeats(gid);
  pub = r ? ((await store.getSnapshots(gid, { kind: 'public', round: r }))[0] || {}).data || null : null;
  reveal = game.phase === 'reveal' || game.phase === 'final' ? ((await store.getSnapshots(gid, { kind: 'reveal', round: r }))[0] || {}).data || null : null;
  prevReveal = r > 1 ? ((await store.getSnapshots(gid, { kind: 'reveal', round: r - 1 }))[0] || {}).data || null : null;
  if (game.phase === 'decide' && pub) {
    const rows = await store.getDecisions(gid, r);
    ready = Object.fromEntries(rows.map(d => [d.team_id, !!d.locked]));
  }
  finalSnap = game.phase === 'final' ? ((await store.getSnapshots(gid, { kind: 'final' }))[0] || {}).data || null : null;
}

const nameOf = id => { const t = teams.find(x => x.team_id === id); return t ? t.name : id; };
const rosterOf = id => (pub && pub.roster.find(r => r.id === id)) || (reveal && reveal.roster.find(r => r.id === id)) || { house: false, bot: false };
const mast = (right) => h('div.masthead', h('span', GAME_TITLE + (game.round ? ', season ' + game.round : '') + (game.round && game.settings && game.settings.seasons ? ' of ' + game.settings.seasons : '')),
  h('span', { style: 'margin-left:auto;margin-right:40px' }, right || ''), clockBox());

// The countdown: what the clock is counting to, and the time, updated four times a second by paintClock() without redrawing the page.
function clockLabel() {
  const c = game.clock;
  if (!c) return '';
  if (c.paused) return 'Paused';
  if (game.phase === 'decide') return c.early ? 'All teams locked. Reveal in' : 'Lock your plan';
  if (game.phase === 'reveal') {
    const idx = (game.reveal && game.reveal.idx) || 0, last = game.round >= ((game.settings && game.settings.seasons) || 4);
    return idx < 3 ? 'Next market in' : idx === 3 ? 'Recap in' : last ? 'Final ranking in' : 'Season ' + (game.round + 1) + ' opens in';
  }
  return '';
}
function clockBox() {
  if (!game.clock) return null;
  return h('span.pclock' + (game.phase === 'decide' ? '.huge' : ''), h('span.lbl.js-clock-label', clockLabel()), h('span.time.js-clock', mmss(clockLeft(game.clock, Date.now()))));
}
function paintClock() {
  if (!game || !game.clock) return;
  const c = game.clock, left = clockLeft(c, Date.now()), low = !c.paused && left <= (game.phase === 'decide' ? 30000 : 10000);
  document.querySelectorAll('.js-clock').forEach(el => { el.textContent = mmss(left); });
  document.querySelectorAll('.pclock').forEach(el => { el.classList.toggle('low', low); el.classList.toggle('paused', !!c.paused); });
  const bar = document.querySelector('.js-bar');
  if (bar) { bar.style.width = (c.total ? Math.max(0, Math.min(1, left / (c.total * 1000))) * 100 : 0).toFixed(2) + '%'; bar.classList.toggle('low', low); }
}

function lobby() {
  const joinUrl = location.href.replace(/projector\.html.*$/, 'team.html?g=' + gid);
  const count = id => seats.filter(s => s.team_id === id && !s.removed).length;
  return h('div', mast('Game ' + gid),
    h('div.cols',
      h('div', h('h1', 'Foreign Threads'), h('p.big', 'Open the team page and type your team code.'), h('p.big', { style: 'font-family:monospace;font-size:34px;word-break:break-all' }, joinUrl),
        h('img', { src: art('wk10_lobby.png'), style: 'width:100%;max-height:520px;object-fit:cover;border:3px solid #000', onerror: ev => ev.target.remove() })),
      h('div', h('h2', 'Brands in the room'),
        h('div', { style: 'columns:2;column-gap:20px' }, teams.map(t => h('div.tile' + (t.house ? '.house' : count(t.team_id) ? '.done' : ''), { style: 'break-inside:avoid;margin-bottom:12px;font-size:24px' },
          h('b', t.name), ' ', t.house ? h('span.chip.house', 'HOUSE') : (count(t.team_id) ? h('span.chip', 'joined') : null),
          h('div', dnaChips(t.brand_id)))))),
    ));
}

function decide() {
  if (!pub) return h('div', mast(), h('h1', 'Getting ready...'));
  return h('div', mast(),
    h('div.cols', h('div', h('h2', 'In the news'),
        pub.cards.map(c => h('div', { style: 'display:flex;gap:20px;margin-bottom:20px' }, c.art ? h('img', { src: art(c.art), style: 'width:260px;height:170px;object-fit:cover;border:2px solid #000', onerror: ev => ev.target.remove() }) : null,
          h('div', h('div.lead', { style: 'font-size:40px' }, c.headline), h('div', { style: 'font-size:28px;margin-top:6px' }, c.rule))))),
      h('div', h('h2', 'Teams'), h('div.tiles', { style: 'grid-template-columns:1fr 1fr' }, pub.roster.map(r => h('div.tile' + (r.house ? '.house' : ready[r.id] || r.bot ? '.done' : ''),
        h('b', r.name), ' ', tag(r), h('div', { style: 'font-size:24px' }, r.house ? 'plays itself' : r.bot ? 'bot' : ready[r.id] ? 'locked' : 'deciding')))),
        prevReveal ? [h('h3', { style: 'margin-top:24px' }, 'Partner seats last season'), h('div', MARKET_IDS.map(m => h('div', { style: 'font-size:28px' }, MARKETS[m].name + ': ', h('b', prevReveal.markets[m].seat ? nameOf(prevReveal.markets[m].seat) : 'nobody'))))] : null)));
}

function marketCard(m) {
  const M = reveal.markets[m], win = reveal.winners.find(w => w.market === m);
  const evs = reveal.events.filter(e => e.market === m);
  return h('div', mast(MARKETS[m].name), h('div.cols',
    h('div', h('img', { src: streetSrc(m), style: 'width:100%;height:560px;object-fit:cover;border:3px solid #f2ecdf', onerror: ev => ev.target.remove() }),
      h('div.big', { style: 'margin-top:16px' }, 'Partner seat: ', h('b', M.seat ? nameOf(M.seat) : 'nobody bid enough')),
      h('div.big', 'Sellers: ' + M.crowd + '. Local rival ' + M.incumbent.name + ' holds ' + pctf(M.incumbent.share)),
      evs.filter(e => e.type === 'bid').map(e => h('div', { style: 'font-size:24px;opacity:.8' }, e.text))),
    h('div', h('h2', 'Who sold what'),
      M.lines.length ? [...M.lines].sort((a, b) => b.share - a.share).map(l => h('div.rowline', { style: win && win.team === l.team ? 'background:#e4ff3a33' : '' },
        l.tiles ? garmentImg(l.tiles) : null,
        h('div', { style: 'flex:1' }, h('b', nameOf(l.team)), ' ', tag(rosterOf(l.team)), win && win.team === l.team ? h('span.chip', { style: 'background:#e4ff3a;color:#000' }, 'WINNER') : null,
          h('div', { style: 'font-size:24px' }, MODE_LABEL[l.mode] + ', ' + (l.tiles ? tilesText(l.tiles) : l.design))),
        h('div.big', pctf(l.share)))) : h('p.big', 'Nobody sold here.'),
      evs.filter(e => e.type !== 'bid').map(e => h('div.big', { style: 'color:#e4ff3a;margin-top:10px' }, e.text)))));
}

function recap() {
  const evs = reveal.events.filter(e => e.type !== 'bid');
  const nxt = game.round < (game.settings.seasons || 4);
  return h('div', mast('Season ' + game.round + ' recap'),
    h('h1', 'What the room did'),
    evs.length ? evs.map(e => h('div.big', { style: 'padding:6px 0;border-bottom:1px solid #6b665a' }, (e.market ? MARKETS[e.market].name + ': ' : '') + e.text)) : h('p.big', 'No copies, suits or deals this season.'),
    h('h2', { style: 'margin-top:30px' }, nxt ? 'Check your own results on your team page, then make offers.' : 'That was the last season.'));
}

function finalView() {
  const st = finalSnap && finalSnap.standings;
  if (!st) return h('div', mast(), h('h1', 'Final'));
  return h('div', mast('Final ranking'), h('h1', 'Highest profit after season ' + game.round),
    h('div.cols', h('div', st.ranked.map(r => h('div.rowline', h('span.lead', '#' + r.rank), h('span.lead', { style: 'flex:1;font-size:48px' }, r.name), h('span.big', money(r.profit))))),
      h('div', h('h3', { style: 'color:#777' }, 'House brands (not ranked)'), st.house.map(r => h('div.rowline', { style: 'color:#888' }, h('span', { style: 'flex:1' }, r.name + ' (HOUSE)'), h('span', money(r.profit)))))));
}

function render() {
  let body;
  if (!game) body = h('h1', 'No game ' + (gid || '') + ' found. Add ?g=GAMEID to the address.');
  else if (game.phase === 'lobby') body = lobby();
  else if (game.phase === 'decide') body = decide();
  else if (game.phase === 'reveal') body = !reveal ? h('h1', 'Resolving...') : (game.reveal && game.reveal.idx < 4 ? marketCard(MARKET_IDS[game.reveal.idx]) : recap());
  else if (game.phase === 'final') body = finalView();
  else body = h('h1', game.phase);
  document.body.classList.toggle('dark', !!isDark());
  const stage = h('div.stage' + (isDark() ? '.dark' : ''), body, game && game.clock ? h('div.pbar', h('div.js-bar')) : null);
  const sc = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = 'scale(' + sc + ')';
  app.replaceChildren(stage);
  paintClock();
  document.body.style.background = document.documentElement.style.background = isDark() ? '#15130f' : '#f4f1ea';
}

(async function main() {
  try {
    store = await openStore();
    gid = params().get('g');
    if (gid) { await load(); store.subscribe(gid, async () => { await load(); render(); }); setInterval(paintClock, 250); }
    render();
    addEventListener('resize', render);
    window.__proj = () => ({ game, pub, reveal });
  } catch (e) { app.replaceChildren(h('div', { style: 'padding:30px' }, h('h1', 'Could not start'), h('p', friendlyError(e)))); }
})();
