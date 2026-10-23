// Admin / host page. Creates a game, shows join codes, runs the clock and the reveal, and runs the engine (host.js).
import { openStore } from './supa.js';
import { h, $, params, setParam, toast, download, friendlyError, pageMode, mmss } from './util.js';
import { Host } from './host.js';
import { BRAND_BY_ID, dnaChips, tag, MARKETS, MARKET_IDS, GAME_TITLE } from './ui.js';
import { HOUSE } from '../config/rules.js';

const app = $('#app');
let store, host = null, ready = {}, claimed = {}, busy = false, timer = null, unsub = null;
function attach() {
  if (unsub) unsub();
  unsub = store.subscribe(host.gid, () => { clearTimeout(attach.t); attach.t = setTimeout(() => { if (!busy) refresh(); }, 400); });
}

const base = () => location.href.split('?')[0].replace(/[^/]*$/, '');
const teamUrl = () => base() + 'team.html?g=' + host.gid + (pageMode() === 'local' && !/localhost|127\.0\.0\.1/.test(location.hostname) ? '&local=1' : '');
const projUrl = () => base() + 'projector.html?g=' + host.gid;

async function guard(fn) {
  if (busy) return;
  busy = true; render();
  try { await fn(); } catch (e) { console.error(e); toast(friendlyError(e), 8000); }
  busy = false; await refresh();
}

async function refresh() {
  if (!host) return render();
  await host.refreshGame();
  if (host.game.phase !== 'lobby' && !host.state) await host.load(host.gid);
  claimed = await host.claimedTeams();
  if (host.state && host.game.phase === 'decide') ready = await host.readiness(); else ready = {};
  render();
  if (host.game.phase === 'decide' && host.meta.humans.length && Object.values(ready).every(r => r.locked) && !busy && host.game.settings.autoResolve !== false) {
    guard(() => host.resolve());
  }
}

function landing() {
  const f = { teams: 6, house: 2, seed: '', bot: pageMode() === 'local' };
  const el = h('div.wrap', h('h1', GAME_TITLE + ': host'),
    h('div.card', h('h2', 'New game'),
      h('div.row',
        h('div', h('label', 'Human teams'), h('input#f-teams', { type: 'number', min: 1, max: 12, value: f.teams, style: 'width:80px' })),
        h('div', h('label', 'House (AI) teams, 0 to 4'), h('input#f-house', { type: 'number', min: 0, max: HOUSE.maxCount, value: f.house, style: 'width:80px' })),
        h('div', h('label', 'Seed (blank = random)'), h('input#f-seed', { type: 'number', style: 'width:110px' })),
        h('div', h('label', 'Bot-fill empty teams'), h('input#f-bot', { type: 'checkbox', checked: f.bot }), ' ', h('span.small.muted', 'for testing; labelled BOT, ranked')),
        h('button.primary', { onclick: async () => {
          try {
            host = await Host.create(store, { teams: +$('#f-teams').value, house: +$('#f-house').value, seed: $('#f-seed').value, botFill: $('#f-bot').checked });
            setParam('g', host.gid); attach(); await refresh();
          } catch (e) { toast(friendlyError(e), 9000); }
        } }, 'Create game'))),
    h('div.card', h('h2', 'Recent games'), h('div#recent', 'Loading...')));
  app.replaceChildren(el);
  store.listGames(10).then(gs => {
    $('#recent').replaceChildren(...(gs.length ? gs.map(g => h('div.row', h('b', g.id), h('span.muted', g.phase + ', season ' + g.round + ', ' + g.team_count + ' teams'),
      h('button.small', { onclick: async () => { host = new Host(store); await host.load(g.id); setParam('g', g.id); attach(); await refresh(); } }, 'Open'))) : ['No games yet.']));
  }).catch(e => $('#recent').replaceChildren(h('span.err', friendlyError(e))));
}

function copyBtn(text, label) { return h('button.small', { onclick: () => { navigator.clipboard && navigator.clipboard.writeText(text); toast('Copied'); } }, label); }

function teamTable() {
  const phase = host.game.phase, st = host.state;
  return h('table', h('thead', h('tr', ['Team', 'Brand DNA', 'Join code', 'Seats', phase === 'decide' ? 'Locked' : ''].map(x => h('th', x)))),
    h('tbody', host.teams.map(t => {
      const inGame = st ? st.teams[t.team_id] : null;
      const bot = host.meta && host.meta.bots && host.meta.bots[t.team_id];
      const dropped = host.meta && host.meta.dropped && host.meta.dropped.includes(t.team_id);
      return h('tr', { style: dropped ? 'opacity:.4' : '' },
        h('td', t.team_id + ' ', h('b', t.name), ' ', tag({ house: t.house, bot: bot && !bot.house }), t.house ? h('span.chip', t.personality) : null, dropped ? h('span.chip', 'dropped (nobody joined)') : null),
        h('td', dnaChips(t.brand_id)),
        h('td', t.house ? h('span.muted', 'AI') : h('b', { style: 'font:700 20px monospace' }, t.join_code)),
        h('td.n', t.house ? '' : String(claimed[t.team_id] || 0)),
        h('td', phase === 'decide' && !t.house ? (bot ? 'bot' : (ready[t.team_id] && ready[t.team_id].locked ? h('span.ok', 'locked') : 'deciding')) : ''));
    })));
}

function render() {
  if (!host) return landing();
  const g = host.game, st = host.state, phase = g.phase;
  const secs = g.clock ? Math.max(0, g.clock.endsAt - Date.now()) : 0;
  const ctrl = [];
  if (phase === 'lobby') {
    ctrl.push(h('button.primary', { disabled: busy, onclick: () => guard(() => host.start()) }, 'Start game (season 1)'));
    ctrl.push(h('button', { disabled: busy || host.teams.filter(t => t.house).length >= HOUSE.maxCount, onclick: () => guard(() => host.addHouse()) }, 'Add a house (AI) team'));
    ctrl.push(h('label.small', { style: 'display:flex;gap:6px;align-items:center;margin:0' }, h('input', { type: 'checkbox', checked: !!g.settings.botFill,
      onchange: ev => guard(async () => { await store.patchGame(g.id, { settings: { ...g.settings, botFill: ev.target.checked } }); }) }), 'Bot-fill teams nobody joined'));
    ctrl.push(h('button', { disabled: busy, onclick: () => guard(() => host.autoPlay(m => console.log(m))) }, 'Test: play all four seasons with bots'));
  } else if (phase === 'decide') {
    ctrl.push(h('button.primary', { disabled: busy, onclick: () => guard(() => host.resolve()) }, 'Resolve season now'));
    ctrl.push(h('span.muted', 'Resolves by itself when every human team has locked. A team that never locks keeps its last plan.'));
  } else if (phase === 'reveal') {
    const idx = g.reveal ? g.reveal.idx : 0;
    ctrl.push(h('span', 'Reveal step ' + (idx + 1) + ' of 5 (' + (idx < 4 ? MARKETS[MARKET_IDS[idx]].name : 'recap') + ')'));
    ctrl.push(h('button', { disabled: busy || idx <= 0, onclick: () => guard(() => host.setReveal(idx - 1)) }, 'Back'));
    ctrl.push(h('button.primary', { disabled: busy || idx >= 4, onclick: () => guard(() => host.setReveal(idx + 1)) }, 'Next market'));
    ctrl.push(h('button.warn', { disabled: busy || idx < 4, title: 'Reaches the recap first. Collects carry offers teams wrote.', onclick: () => guard(() => host.nextSeason()) },
      st.season >= st.seasons ? 'Finish game' : 'Next season'));
  } else if (phase === 'final') {
    ctrl.push(h('span.ok', 'Game over. Download the log for the debrief.'));
  }
  if (st && st.history && Object.keys(st.history).length) ctrl.push(h('button', { onclick: () => download('foreign-threads-' + g.id + '.json', JSON.stringify(host.exportRun(), null, 1)) }, 'Download game log (JSON)'));
  ctrl.push(h('button.small', { onclick: () => { setParam('g', null); host = null; render(); } }, 'Other games'));

  const el = h('div', h('div.bar', h('b', GAME_TITLE + ' ' + g.id), h('span.num', 'Phase: ' + phase + (g.round ? ', season ' + g.round : '') + (phase === 'decide' ? ', clock ' + mmss(secs) : '')),
      h('span', pageMode() === 'local' ? 'LOCAL mode' : 'LIVE mode')),
    h('div.wrap',
      h('div.card', h('h2', 'Links'),
        h('div.kv', h('span', 'Students (team page)'), h('span', h('a', { href: teamUrl(), target: '_blank' }, teamUrl()), ' ', copyBtn(teamUrl(), 'Copy')),
          h('span', 'Projector'), h('span', h('a', { href: projUrl(), target: '_blank' }, projUrl()), ' ', copyBtn(projUrl(), 'Copy')))),
      h('div.card', h('h2', 'Run'), h('div.row', ctrl), busy ? h('p.muted', 'Working...') : null),
      h('div.card', h('h2', 'Teams'), teamTable(),
        h('p.small.muted', 'Students open the team page, type their team code and a name. Up to five seats per team. House teams are scripted, labelled HOUSE and left out of the prize ranking. Teams nobody joins are dropped at Start unless bot-fill is on.'))));
  app.replaceChildren(el);
}

(async function main() {
  try {
    store = await openStore();
    const gid = params().get('g');
    if (gid) { host = new Host(store); try { await host.load(gid); } catch (e) { toast(e.message, 6000); host = null; setParam('g', null); } }
    if (host) attach();
    await refresh();
    timer = setInterval(() => { if (host && host.game && host.game.phase === 'decide') render(); }, 1000);
    window.__host = () => host;
  } catch (e) { app.replaceChildren(h('div.wrap', h('h1', 'Could not start'), h('p.err', friendlyError(e)))); }
})();
