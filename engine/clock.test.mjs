// The timed game: after Start the host's clock moves every step on by itself (pages/clock.js, Host.tick), with Pause, +30 s and Skip as optional
// overrides. These tests drive the real Host and LocalStore with a fake time, so no test waits on a real clock. Run: node --test engine/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK } from '../config/rules.js';
import { drawTastes, seededInt, codeFromTastes } from '../config/taste.js';
import { stepKey, stepSeconds, gamePlan, clockLeft, isDue, newClock, pauseClock, resumeClock, addTime, earlyClock, restoreClock } from '../pages/clock.js';
import { D, line, plan } from './testkit.mjs';

// ---- the host in Node: a localStorage shim stands in for the browser (same set-up as secrecy.test.mjs) ----
const mem = new Map();
globalThis.localStorage = { get length() { return mem.size; }, key: i => [...mem.keys()][i] ?? null, getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
globalThis.window = { addEventListener() {} };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const t = realSetInterval(...a); if (t && t.unref) t.unref(); return t; };
const { LocalStore } = await import('../pages/store.js');
const { Host } = await import('../pages/host.js');

const CODE = codeFromTastes(drawTastes(seededInt(7)));   // one fixed draw, so two rooms with the same seed play the same game
const T0 = 1_700_000_000_000;

// A room with `humans` claimed human teams (T1..) and `house` house teams, on a fake clock the test moves by hand.
async function room({ humans = 1, house = 2, seed = 42, settings = {} } = {}) {
  mem.clear();
  const store = new LocalStore();
  const clock = { now: T0 };
  const host = await Host.create(store, { teams: humans, house, seed });
  host.now = () => clock.now;
  host.restore(CODE);
  for (let i = 1; i <= humans; i++) await store.upsertSeat({ id: 'S' + i, game_id: host.gid, team_id: 'T' + i, name: 'p' + i, slot: 1, removed: false });
  if (Object.keys(settings).length) { await store.patchGame(host.gid, { settings: { ...host.game.settings, ...settings } }); await host.refreshGame(); }
  return { store, host, clock };
}
// Let the clock of the current step run out and tick once. Returns what tick() returned.
async function runOut(host, clock) { clock.now = host.game.clock.endsAt + 300; return host.tick(); }
const ok = (designs = [D('shell', 'black', 'none', 'recycled')]) => plan(designs, { berlin: line('D1'), tokyo: line('D1') });
const bad = () => plan([D('nope', 'black', 'none', 'recycled')], { berlin: line('D1') });     // fails the checks: no such cut tile
const decision = (host, id, s) => host.state.tables.ww_decisions.find(d => d.team_id === id && d.round === s);
const planLog = (host, id, s) => host.state.tables.ww_log.find(e => e.type === 'plan' && e.team_id === id && e.round === s);

test('clock arithmetic: the configured steps add up to the game length the lobby prints', () => {
  const p = gamePlan(CLOCK, 4, 1);
  assert.equal(p.steps.length, 24, '4 seasons x (decide + 4 markets + recap)');
  const expect = (300 + 4 * 60 + 90) + 2 * (240 + 4 * 60 + 90) + (240 + 4 * 60 + 45);
  assert.equal(p.total, expect);
  assert.equal(p.total, 2295, '38:15 with no early locks');
  assert.equal(gamePlan(CLOCK, 4, 0.5).total, p.steps.reduce((a, x) => a + Math.max(5, Math.round(x.seconds * 0.5)), 0));
  assert.equal(stepSeconds(CLOCK, { phase: 'reveal', season: 4, seasons: 4, idx: 4 }, 1), CLOCK.finalRecapSeconds);
  assert.equal(stepSeconds(CLOCK, { phase: 'decide', season: 1, seasons: 4 }, 0.01), 5, 'never under five seconds');
});

test('clock functions: due, pause, resume, +30 s, early close and its undo, on a fake time', () => {
  const g = { phase: 'decide', round: 2, clock: newClock(240, 'decide:2', T0) };
  assert.equal(isDue(g, T0 + 239000), false);
  assert.equal(isDue(g, T0 + 240100), false, 'a quarter second of slack');
  assert.equal(isDue(g, T0 + 240300), true);
  assert.equal(isDue({ ...g, phase: 'reveal', reveal: { idx: 0 } }, T0 + 999999), false, 'a clock left over from another step never fires');
  const p = pauseClock(g.clock, T0 + 40000);
  assert.equal(p.paused, true); assert.equal(p.remaining, 200000);
  assert.equal(isDue({ ...g, clock: p }, T0 + 9e9), false, 'a paused clock never fires');
  assert.equal(clockLeft(p, T0 + 9e9), 200000, 'a paused clock does not count down');
  const r = resumeClock(p, T0 + 100000);
  assert.equal(r.endsAt, T0 + 300000); assert.equal(r.paused, false); assert.equal(r.remaining, null);
  const a = addTime(r, 30);
  assert.equal(a.endsAt, T0 + 330000); assert.equal(a.total, 270);
  assert.equal(addTime(p, 30).remaining, 230000, '+30 s while paused adds to what is left');
  const e = earlyClock(g.clock, 5, T0 + 10000);
  assert.equal(e.endsAt, T0 + 15000); assert.equal(e.early, true); assert.equal(e.fullEndsAt, T0 + 240000);
  assert.equal(earlyClock(e, 5, T0 + 12000), e, 'locking again does not push the early close back');
  assert.equal(restoreClock(e, T0 + 12000).endsAt, T0 + 240000, 'an unlock gives the full clock back');
  const ep = pauseClock(e, T0 + 12000), er = resumeClock(ep, T0 + 60000);
  assert.equal(er.endsAt, T0 + 63000); assert.equal(er.fullEndsAt, T0 + 288000, 'a pause during the early close shifts the full clock too');
});

test('after Start, zero clicks: the clock alone runs four seasons to the final ranking, every step on its configured time', async () => {
  const { host, clock, store } = await room({ humans: 1, house: 2 });
  await host.start();
  const seen = [];
  while (host.game.phase !== 'final') {
    const g = host.game, key = stepKey(g);
    assert.equal(g.clock.step, key, 'the clock belongs to the step it was set for');
    seen.push([key, g.clock.total]);
    clock.now = g.clock.endsAt - 1000;
    assert.equal(await host.tick(), false, key + ': nothing happens before zero');
    assert.equal(stepKey(host.game), key);
    assert.equal(await runOut(host, clock), true, key + ': zero moves the game on');
    assert.ok(seen.length <= 24, 'no runaway');
  }
  const expect = [];
  for (let s = 1; s <= 4; s++) {
    expect.push(['decide:' + s, s === 1 ? 300 : 240]);
    for (let i = 0; i < 4; i++) expect.push(['reveal:' + s + ':' + i, 60]);
    expect.push(['reveal:' + s + ':4', s === 4 ? 45 : 90]);
  }
  assert.deepEqual(seen, expect);
  assert.equal(host.game.clock, null, 'the final ranking has no clock');
  assert.ok((await store.getSnapshots(host.gid, { kind: 'final' })).length === 1);
  assert.ok((await store.getSnapshots(host.gid, { kind: 'result', round: 4, teamId: 'T1' })).length === 1, 'results reached the team page every season');
  assert.equal(await host.tick(), false, 'the final ranking stays put');
});

test('the lobby speed setting scales every step', async () => {
  const { host, clock } = await room({ humans: 1, house: 1, settings: { clockScale: 0.5 } });
  await host.start();
  let total = 0;
  while (host.game.phase !== 'final') { total += host.game.clock.total; await runOut(host, clock); }
  assert.equal(total, gamePlan(CLOCK, 4, 0.5).total);
});

test('with "advance on the clock" off nothing moves until Skip', async () => {
  const { host, clock } = await room({ humans: 1, house: 1, settings: { autoAdvance: false } });
  await host.start();
  clock.now = host.game.clock.endsAt + 60000;
  assert.equal(await host.tick(), false);
  assert.equal(stepKey(host.game), 'decide:1');
  assert.equal(await host.advance(), true, 'Skip still works');
  assert.equal(stepKey(host.game), 'reveal:1:0');
});

test('missed deadlines: a saved plan runs, nothing saved means the last plan stands, a broken saved plan falls back, a late lock is ignored', async () => {
  const { host, clock, store } = await room({ humans: 3, house: 1 });
  await host.start();
  // season 1: T1 saves a plan but never locks, T2 never touches the page, T3 locks
  await store.patchDecision(host.gid, 'T1', 1, { plan: ok(), why: 'saved only' });
  await store.patchDecision(host.gid, 'T3', 1, { plan: ok(), why: 'locked', locked: true, lock_left: 100 });
  await runOut(host, clock);
  assert.equal(stepKey(host.game), 'reveal:1:0');
  assert.equal(decision(host, 'T1', 1).locked, false, 'the row still says the team did not lock');
  assert.equal(decision(host, 'T1', 1).plan.markets.berlin.mode, 'ship', 'the saved plan is the plan that ran');
  assert.ok(decision(host, 'T1', 1).notes.includes('not locked when time ran out: the saved plan ran'));
  assert.match(planLog(host, 'T1', 1).text, /ran its saved plan when time ran out/);
  assert.equal(planLog(host, 'T1', 1).payload.timed_out, true);
  assert.equal(host.state.history[1].teams.T1.savedRan, true);
  assert.equal(decision(host, 'T2', 1).plan.designs.length, 0, 'nothing saved and no last plan: T2 sits season 1 out');
  assert.match(planLog(host, 'T2', 1).text, /sat the season out/);
  assert.equal(decision(host, 'T3', 1).locked, true);
  assert.equal(host.state.history[1].teams.T3.savedRan, undefined, 'a locked plan is not a saved-plan run');
  // a lock that arrives after the window closed changes nothing for season 1
  await store.patchDecision(host.gid, 'T2', 1, { plan: ok(), locked: true });
  for (let i = 0; i < 4; i++) await runOut(host, clock);
  assert.equal(stepKey(host.game), 'reveal:1:4');
  const res = (await store.getSnapshots(host.gid, { kind: 'result', round: 1, teamId: 'T1' }))[0].data;
  assert.equal(res.savedRan, true, 'the team page is told its saved plan ran');
  await runOut(host, clock);
  assert.equal(stepKey(host.game), 'decide:2');
  assert.equal(host.state.tables.ww_decisions.filter(d => d.team_id === 'T2' && d.round === 1).length, 1);
  assert.equal(decision(host, 'T2', 1).locked, false, 'the late lock was ignored');
  // season 2: T1 saves nothing (its season 1 plan stands), T2 saves a broken plan (nothing to fall back to), T3 saves a broken plan (falls back)
  await store.patchDecision(host.gid, 'T2', 2, { plan: bad() });
  await store.patchDecision(host.gid, 'T3', 2, { plan: bad() });
  await runOut(host, clock);
  assert.equal(decision(host, 'T1', 2).stood, true);
  assert.match(planLog(host, 'T1', 2).text, /Your last plan stood/);
  assert.equal(decision(host, 'T2', 2).plan.designs.length, 0);
  assert.ok(decision(host, 'T2', 2).notes.includes('not locked when time ran out, and the saved plan failed the checks'));
  assert.equal(decision(host, 'T3', 2).stood, true, 'a saved plan that fails the checks falls back to the last plan');
  assert.equal(host.state.history[2].teams.T3.savedRan, undefined);
});

test('strict rule (setting off): only a locked plan counts, as GAME_SPEC rule 1.7 says', async () => {
  const { host, clock, store } = await room({ humans: 2, house: 1, settings: { savedPlanRuns: false } });
  await host.start();
  await store.patchDecision(host.gid, 'T1', 1, { plan: ok() });
  await runOut(host, clock);
  assert.equal(decision(host, 'T1', 1).plan.designs.length, 0, 'saved but never locked: sits season 1 out');
  assert.ok(decision(host, 'T1', 1).notes.includes('saved but never locked'));
  assert.equal(planLog(host, 'T1', 1).payload.timed_out, undefined);
});

test('pause holds the step past zero, resume picks up the same time left, +30 s adds time', async () => {
  const { host, clock } = await room({ humans: 1, house: 1 });
  await host.start();
  const ends = host.game.clock.endsAt;
  clock.now = ends - 200000;
  await host.pause();
  assert.equal(host.game.clock.paused, true);
  assert.equal(host.game.clock.remaining, 200000);
  clock.now = ends + 600000;
  assert.equal(await host.tick(), false, 'paused: ten minutes past zero and still deciding');
  assert.equal(stepKey(host.game), 'decide:1');
  await host.resume();
  assert.equal(host.game.clock.endsAt, clock.now + 200000);
  clock.now += 199000;
  assert.equal(await host.tick(), false);
  await host.addTime(30);
  clock.now += 1300;
  assert.equal(await host.tick(), false, '+30 s pushed zero back');
  clock.now += 30000;
  assert.equal(await host.tick(), true);
  assert.equal(stepKey(host.game), 'reveal:1:0');
  // pause works the same on a reveal step
  await host.pause();
  clock.now += 10 * 60000;
  assert.equal(await host.tick(), false);
  await host.resume();
  assert.equal(await runOut(host, clock), true);
  assert.equal(stepKey(host.game), 'reveal:1:1');
});

test('every human team locked: the decision clock drops to a few seconds, an unlock gives it back, and the season resolves on its own', async () => {
  const { host, clock, store } = await room({ humans: 2, house: 1 });
  await host.start();
  const full = host.game.clock.endsAt;
  clock.now = full - 100000;
  await store.patchDecision(host.gid, 'T1', 1, { plan: ok(), locked: true });
  let ready = await host.readiness();
  assert.equal(host.lockTarget(ready, 1), null, 'one of two locked: no change');
  await store.patchDecision(host.gid, 'T2', 1, { plan: ok(), locked: true });
  ready = await host.readiness();
  assert.equal(host.lockTarget(ready, 0), null, 'readiness from another season is never used');
  assert.equal(await host.lockState(ready, 1), true);
  assert.equal(host.game.clock.early, true);
  assert.equal(host.game.clock.endsAt, clock.now + CLOCK.allLockedSeconds * 1000);
  assert.equal(await host.lockState(ready, 1), false, 'a second call changes nothing');
  clock.now += 2000;
  await store.patchDecision(host.gid, 'T2', 1, { locked: false });
  ready = await host.readiness();
  assert.equal(await host.lockState(ready, 1), true);
  assert.equal(host.game.clock.endsAt, full, 'T2 unlocked: the full clock is back');
  assert.equal(host.game.clock.early, undefined);
  await store.patchDecision(host.gid, 'T2', 1, { locked: true });
  ready = await host.readiness();
  await host.lockState(ready, 1);
  clock.now += CLOCK.allLockedSeconds * 1000 - 500;
  assert.equal(await host.tick(), false);
  clock.now += 1000;
  assert.equal(await host.tick(), true);
  assert.equal(stepKey(host.game), 'reveal:1:0');
  assert.equal(decision(host, 'T1', 1).locked, true);
});

test('no double step: two ticks at once advance once, and a second host tab that saw the old step does nothing', async () => {
  const { host, clock, store } = await room({ humans: 1, house: 1 });
  await host.start();
  clock.now = host.game.clock.endsAt + 300;
  const other = new Host(store);
  await other.load(host.gid);
  other.now = () => clock.now;
  assert.equal(other.due(), true, 'the second tab also sees the clock run out');
  const r = await Promise.all([host.tick(), host.tick()]);
  assert.deepEqual(r.filter(Boolean).length, 1);
  assert.equal(stepKey(host.game), 'reveal:1:0');
  assert.equal(await other.tick(), false, 'the second tab re-reads the game, sees the step already moved, and stops');
  assert.equal(stepKey(await store.getGame(host.gid)), 'reveal:1:0');
  assert.equal((await store.getGame(host.gid)).reveal.idx, 0);
  // the first tab closes; the second (a reload, or another laptop with the code) carries the clock on from the stored row
  assert.equal(await runOut(other, clock), true);
  assert.equal(stepKey(await store.getGame(host.gid)), 'reveal:1:1');
  other.tastes = null;
  clock.now = other.game.clock.endsAt + 300;
  assert.equal(other.due(), false, 'a laptop without the taste code never runs the engine on the clock');
});

test('the clock changes when things happen, never what happens: a game run on the clock equals the same game run with Skip', async () => {
  const play = async (useClock) => {
    const { host, clock, store } = await room({ humans: 2, house: 2, seed: 9 });
    await host.start();
    while (host.game.phase !== 'final') {
      if (host.game.phase === 'decide') {
        const s = host.game.round;
        await store.patchDecision(host.gid, 'T1', s, { plan: ok(), locked: true });
        if (s % 2) await store.patchDecision(host.gid, 'T2', s, { plan: ok([D('denim', 'earth', 'small', 'light')]) });
      }
      if (useClock) await runOut(host, clock); else await host.advance();
    }
    const run = host.exportRun();
    delete run.taste_code;
    return JSON.stringify(run);
  };
  const a = await play(true), b = await play(false);
  assert.equal(a, b);
});
