// Admin / host page. Creates a game, shows join codes, runs the clock and the reveal, and runs the engine (host.js).
// After Start the game runs itself on the clock (host.tick, driven by a worker tick in ticker.js); every button below Start is an optional override.
import { openStore } from './supa.js';
import { h, $, params, setParam, toast, download, friendlyError, pageMode, mmss } from './util.js';
import { Host } from './host.js';
import { BRAND_BY_ID, dnaChips, tag, MARKETS, MARKET_IDS, GAME_TITLE } from './ui.js';
import { HOUSE, CLOCK, SEASONS } from '../config/rules.js';
import { clockLeft, gamePlan, stepKey } from './clock.js';
import { every } from './ticker.js';

const app = $('#app');
let store, host = null, ready = {}, readyRound = 0, claimed = {}, busy = false, timer = null, unsub = null;
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
  if (host.state && host.game.phase === 'decide') { ready = await host.readiness(); readyRound = host.game.round; } else { ready = {}; readyRound = 0; }
  render();
  tick();
}

// Twice a second: count down on screen, shorten the decision clock once every human team has locked (or give it back if one unlocks), and move the
// game on when the clock runs out. Nothing here waits for a click.
let tickRest = 0;   // after a failed step (say the network dropped) wait a few seconds before trying again, instead of a toast every half second
function tick() {
  if (!host || !host.game) return;
  const c = $('#clock'); if (c) c.textContent = clockText(host.game);
  if (busy || Date.now() < tickRest) return;
  const step = fn => guard(async () => { try { await fn(); } catch (e) { tickRest = Date.now() + 5000; throw e; } });
  if (host.lockTarget(ready, readyRound)) { step(() => host.lockState(ready, readyRound)); return; }
  if (host.due()) step(() => host.tick());
}
const clockText = g => !g.clock ? '' : (g.clock.paused ? 'PAUSED ' : '') + mmss(clockLeft(g.clock, Date.now())) + (g.clock.early && !g.clock.paused ? ' (all locked)' : '');

// Skip and Back carry the step they were drawn for, and ignore a click in the first second of a step, so a double-click, or a click that lands just
// after the clock moved on, never skips (or backs up) two steps.
const shownAt = {};
function stepBtn(label, key, fn, title) {
  return h('button', { disabled: busy, title, onclick: () => {
    if (Date.now() - (shownAt[key] || 0) < 1000) return toast('That step has just started. Click again to skip it too.');
    guard(() => fn(key));
  } }, label);
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

// The room's hidden tastes are drawn in this browser and kept only here. This card shows the restore code on request (not on a projected screen by default)
// or asks for it when this browser does not hold it.
let showCode = false;
function tasteCard() {
  if (host.needsCode) {
    return h('div.card', h('h2', 'Enter the room taste code'),
      h('p', 'This browser does not hold the hidden market tastes for ' + host.gid + '. Type the 8-character restore code you wrote down when the game was created.'),
      h('div.row', h('input#f-code', { type: 'text', placeholder: '4K7Q-X2M9', style: 'width:140px;font:700 18px monospace;text-transform:uppercase' }),
        h('button.primary', { onclick: () => { try { host.restore($('#f-code').value); toast('Restored'); render(); } catch (e) { toast(e.message, 7000); } } }, 'Restore')));
  }
  return h('div.card', h('h2', 'Room taste code'),
    h('p.small.muted', 'The hidden tastes for this room were drawn in this browser and are not stored on any server. Write the code down once. If this browser is cleared, or you host from another laptop, type it back in. Do not show this page on the projector while the code is open.'),
    h('div.row', showCode ? h('b', { style: 'font:700 22px monospace;letter-spacing:2px' }, host.restoreCode) : h('span.muted', 'hidden'),
      h('button.small', { onclick: () => { showCode = !showCode; render(); } }, showCode ? 'Hide code' : 'Show code')));
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

// Lobby only: the clock speed and the whole-game arithmetic at that speed, so the host can fit the class slot before pressing Start.
function clockCard(g) {
  const set = g.settings || {}, scale = set.clockScale || 1, seasons = set.seasons || SEASONS, plan = gamePlan(CLOCK, seasons, scale);
  const s1 = plan.steps.filter(x => x.season === 1), s2 = plan.steps.filter(x => x.season === 2);
  const secsOf = (steps, k) => (steps.find(x => x.step === k) || { seconds: 0 }).seconds;
  const setSetting = patch => guard(async () => { await store.patchGame(g.id, { settings: { ...g.settings, ...patch } }); });
  return h('div.card', h('h2', 'Clock'),
    h('div.row',
      h('div', h('label', 'Clock speed'), h('select', { disabled: busy, onchange: ev => setSetting({ clockScale: Number(ev.target.value) }) },
        CLOCK.speeds.map(x => h('option', { value: x, selected: Math.abs(x - scale) < 1e-9 }, x === 1 ? '1x (class)' : x + 'x' + (x < 1 ? ' (faster)' : ' (slower)'))))),
      h('label.small', { style: 'display:flex;gap:6px;align-items:center;margin:0' }, h('input', { type: 'checkbox', checked: set.autoAdvance !== false, onchange: ev => setSetting({ autoAdvance: ev.target.checked }) }), 'Advance on the clock (off = press Skip for every step)'),
      h('label.small', { style: 'display:flex;gap:6px;align-items:center;margin:0' }, h('input', { type: 'checkbox', checked: set.savedPlanRuns !== false, onchange: ev => setSetting({ savedPlanRuns: ev.target.checked }) }), 'At zero, a team that has not locked plays its saved plan')),
    h('p', 'Each season: decide ' + mmss(secsOf(s1, 'decide') * 1000) + ' in season 1 and ' + mmss(secsOf(s2, 'decide') * 1000) + ' after, then ' + mmss(secsOf(s1, 'market 1') * 1000) + ' per market on the projector, then a ' + mmss(secsOf(s1, 'recap') * 1000) +
      ' recap for results and carry offers (' + mmss(plan.steps[plan.steps.length - 1].seconds * 1000) + ' after the last season), after a ' + mmss(plan.steps.filter(x => x.season === 0).reduce((a, x) => a + x.seconds, 0) * 1000) + ' practice round. Whole game: ', h('b', mmss(plan.total * 1000)), ' if nobody locks early.'),
    h('p', h('b', 'Run exactly one admin window for this game.'), ' A second admin tab or laptop would also run the clock; close it before Start.'),
    h('p.small.muted', 'After Start nothing needs a click. A decision window closes ' + CLOCK.allLockedSeconds + ' seconds after every human team has locked. Pause, +30 s and Skip stay available as overrides. Keep this page open (its own window is best) on the laptop that started the game: this page runs the clock and the engine.'));
}

// Steven 10/24: after Start nothing should need a click. This line says so on every step; the buttons beside it are emergency overrides.
const autoBadge = () => host.autoAdvance ? h('span.auto-on', 'Runs itself. Nothing needs a click; the buttons are overrides.') : h('span.err', 'Advance on the clock is OFF: press Skip for every step.');

function render() {
  if (!host) return landing();
  const g = host.game, st = host.state, phase = g.phase, key = stepKey(g);
  if (!shownAt[key]) shownAt[key] = Date.now();
  const ctrl = [];
  const clockBtns = () => g.clock ? [
    g.clock.paused ? h('button', { disabled: busy, onclick: () => guard(() => host.resume()) }, 'Resume clock') : h('button', { disabled: busy, onclick: () => guard(() => host.pause()) }, 'Pause clock'),
    h('button', { disabled: busy, onclick: () => guard(() => host.addTime(30)) }, '+30 s')] : [];
  if (phase === 'lobby') {
    ctrl.push(h('button.primary', { disabled: busy || host.needsCode, onclick: () => guard(() => host.start()) }, 'Start game (practice round, then season 1)'));
    ctrl.push(h('button', { disabled: busy || host.teams.filter(t => t.house).length >= HOUSE.maxCount, onclick: () => guard(() => host.addHouse()) }, 'Add a house (AI) team'));
    ctrl.push(h('label.small', { style: 'display:flex;gap:6px;align-items:center;margin:0' }, h('input', { type: 'checkbox', checked: !!g.settings.botFill,
      onchange: ev => guard(async () => { await store.patchGame(g.id, { settings: { ...g.settings, botFill: ev.target.checked } }); }) }), 'Bot-fill teams nobody joined'));
    ctrl.push(h('button', { disabled: busy, onclick: () => guard(() => host.autoPlay(m => console.log(m))) }, 'Test: play all four seasons with bots'));
  } else if (phase === 'example') {
    const idx = g.reveal ? g.reveal.idx : 0;
    ctrl.push(h('span', 'Practice round, step ' + (idx + 1) + ' of 3 (made-up brands, nothing counts)'));
    ctrl.push(h('b.admin-clock', h('span#clock', clockText(g))), autoBadge());
    ctrl.push(...clockBtns());
    if (idx > 0) ctrl.push(stepBtn('Back', key, k => host.back(k)));
    ctrl.push(stepBtn(idx < 2 ? 'Skip: next practice step' : 'Skip: start season 1', key, k => host.advance(k), 'Optional. The practice round moves on by itself.'));
  } else if (phase === 'decide') {
    ctrl.push(h('b.admin-clock', h('span#clock', clockText(g))), autoBadge());
    ctrl.push(...clockBtns());
    ctrl.push(stepBtn('Skip: resolve now', key, k => host.advance(k), 'Optional. The season resolves by itself when the clock runs out.'));
    ctrl.push(h('span.muted', host.autoAdvance ? 'Resolves by itself at zero, or ' + CLOCK.allLockedSeconds + ' s after every human team has locked. ' + (g.settings.savedPlanRuns !== false ? 'A team that has not locked plays its saved plan; with nothing saved, its last plan stands.' : 'A team that never locks keeps its last plan.') : 'Advance on the clock is off: press Skip.'));
  } else if (phase === 'reveal') {
    const idx = g.reveal ? g.reveal.idx : 0;
    ctrl.push(h('span', 'Reveal step ' + (idx + 1) + ' of 5 (' + (idx < 4 ? MARKETS[MARKET_IDS[idx]].name : 'recap: results and carry offers') + ')'));
    ctrl.push(h('b.admin-clock', h('span#clock', clockText(g))), autoBadge());
    ctrl.push(...clockBtns());
    if (idx > 0) ctrl.push(stepBtn('Back', key, k => host.back(k)));
    ctrl.push(stepBtn(idx < 4 ? 'Skip: next ' + (idx < 3 ? 'market' : 'step (recap)') : st.season >= st.seasons ? 'Skip: finish game' : 'Skip: next season', key, k => host.advance(k),
      'Optional. Each step moves on by itself when its clock runs out.' + (idx >= 4 ? ' Collects carry offers teams wrote.' : '')));
  } else if (phase === 'final') {
    ctrl.push(h('span.ok', 'Game over. Download the log for the debrief.'));
  }
  if (st && st.history && Object.keys(st.history).length) ctrl.push(h('button', { onclick: () => download('foreign-threads-' + g.id + '.json', JSON.stringify(host.exportRun(), null, 1)) }, 'Download game log (JSON)'));
  ctrl.push(h('button.small', { onclick: () => { setParam('g', null); host = null; render(); } }, 'Other games'));

  const el = h('div', h('div.bar', h('b', GAME_TITLE + ' ' + g.id), h('span.num', 'Phase: ' + phase + (g.round ? ', season ' + g.round : '')),
      h('span', pageMode() === 'local' ? 'LOCAL mode' : 'LIVE mode')),
    h('div.wrap',
      h('div.card', h('h2', 'Links'),
        h('div.kv', h('span', 'Students (team page)'), h('span', h('a', { href: teamUrl(), target: '_blank' }, teamUrl()), ' ', copyBtn(teamUrl(), 'Copy')),
          h('span', 'Projector'), h('span', h('a', { href: projUrl(), target: '_blank' }, projUrl()), ' ', copyBtn(projUrl(), 'Copy')))),
      tasteCard(),
      phase === 'lobby' ? clockCard(g) : null,
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
    timer = every(500, tick);
    document.addEventListener('visibilitychange', tick);
    window.__host = () => host;
  } catch (e) { app.replaceChildren(h('div.wrap', h('h1', 'Could not start'), h('p.err', friendlyError(e)))); }
})();
