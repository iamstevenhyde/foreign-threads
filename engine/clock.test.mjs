// The timed game: after Start the host's clock moves every step on by itself (pages/clock.js, Host.tick), with Pause, +30 s and Skip as optional
// overrides. These tests drive the real Host and LocalStore with a fake time, so no test waits on a real clock. Run: node --test engine/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK } from '../config/rules.js';
import { drawTastes, seededInt, codeFromTastes } from '../config/taste.js';
import { stepKey, stepSeconds, gamePlan, clockLeft, isDue, newClock, pauseClock, resumeClock, addTime, earlyClock, restoreClock } from '../pages/clock.js';
import { every } from '../pages/ticker.js';
import { teamView } from './core.mjs';
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
  const expect = (300 + 4 * 60 + 120) + 2 * (240 + 4 * 60 + 120) + (240 + 4 * 60 + 45);
  assert.equal(p.total, expect);
  assert.equal(p.total, 2385, '39:45 with no early locks, inside the 41:00 slot');
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
    expect.push(['reveal:' + s + ':4', s === 4 ? 45 : 120]);
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

// One scripted game: T1 bids for the Berlin partner seat and locks; T2 saves an unlocked plan in odd seasons and offers T1 a carry in Berlin at each
// recap. `inject` lists store calls that fail once each; after a failure the driver simply tries the step again, as the admin tick does 5 s later.
async function playGame({ useClock, inject = [] }) {
  const { host, clock, store } = await room({ humans: 2, house: 2, seed: 9 });
  const fired = [];
  for (const r of inject) {
    const orig = store[r.method].bind(store);
    let armed = true;
    store[r.method] = async (...a) => { if (armed && r.when(...a)) { armed = false; fired.push(r.label); throw new Error('injected write failure: ' + r.label); } return orig(...a); };
  }
  await host.start();
  const t1 = plan([D('shell', 'black', 'none', 'recycled')], { berlin: line('D1', { mode: 'partner', bid: 1.6 }), tokyo: line('D1') });
  const carry = { type: 'carry', market: 'berlin', design: { id: 'D1', cut: 'denim', palette: 'earth', logo: 'small', fabric: 'light' } };
  let failures = 0, steps = 0;
  while (host.game.phase !== 'final') {
    const g = host.game, s = g.round;
    if (g.phase === 'decide') {
      await store.patchDecision(host.gid, 'T1', s, { plan: t1, locked: true });
      if (s % 2) await store.patchDecision(host.gid, 'T2', s, { plan: ok([D('denim', 'earth', 'small', 'light')]) });
    }
    if (g.phase === 'reveal' && g.reveal.idx === 4 && s < 4) await store.patchDecision(host.gid, 'T2', s, { notes: [carry] });
    try { if (useClock) assert.equal(await runOut(host, clock), true); else assert.equal(await host.advance(stepKey(host.game)), true); }
    catch (e) { assert.match(e.message, /injected write failure/); failures++; }
    assert.ok(++steps < 60, 'no runaway');
  }
  const run = host.exportRun();
  delete run.taste_code;
  return { run: JSON.stringify(run), failures, fired, host };
}

test('the clock changes when things happen, never what happens: a game run on the clock equals the same game run with Skip', async () => {
  const a = await playGame({ useClock: true }), b = await playGame({ useClock: false });
  assert.equal(a.run, b.run);
  assert.ok(a.host.state.offers.length >= 1, 'the script made at least one carry offer, so offers are inside the comparison');
});

test('a failed write never wedges the game: each step retries only its writes, and the finished game equals one with no failures', async () => {
  let n3 = 0;
  const inject = [
    { label: 'reveal snapshot, season 1 resolve', method: 'putSnapshot', when: (gid, r, kind) => kind === 'reveal' && r === 1 },
    { label: 'game row, season 2 resolve', method: 'patchGame', when: (gid, p) => p.phase === 'reveal' && p.reveal && p.reveal.season === 2 && p.reveal.idx === 0 },
    { label: 'result snapshot, season 1 recap', method: 'putSnapshot', when: (gid, r, kind) => kind === 'result' && r === 1 },
    { label: 'team view, season 2 open (engine already moved on)', method: 'putSnapshot', when: (gid, r, kind) => kind === 'view' && r === 2 },
    { label: 'game row, season 3 open', method: 'patchGame', when: (gid, p) => p.phase === 'decide' && p.round === 3 },
    { label: 'decisions read, season 3 recap (carry offers)', method: 'getDecisions', when: (gid, r) => r === 3 && ++n3 === 2 },
    { label: 'game row, finish', method: 'patchGame', when: (gid, p) => p.phase === 'final' },
  ];
  const bad = await playGame({ useClock: true, inject }), good = await playGame({ useClock: true });
  assert.deepEqual([...bad.fired].sort(), inject.map(r => r.label).sort(), 'every injected failure fired once');
  assert.equal(bad.failures, inject.length);
  assert.equal(bad.run, good.run, 'same game: no season resolved twice, no offer made twice, no season opened twice');
  const st = bad.host.state;
  for (const s of [1, 2, 3, 4]) assert.equal(st.tables.ww_decisions.filter(d => d.round === s).length, st.order.length, 'one decisions row per team in season ' + s);
  assert.equal(bad.host.game.phase, 'final');
});

test('Skip and Back carry their step: a double-click moves one step, not two', async () => {
  const { host, clock } = await room({ humans: 1, house: 1 });
  await host.start();
  const k = stepKey(host.game);
  assert.equal(await host.advance(k), true);
  assert.equal(await host.advance(k), false, 'the second click still carries decide:1, so it does nothing');
  assert.equal(stepKey(host.game), 'reveal:1:0');
  await host.advance(stepKey(host.game));
  await host.advance(stepKey(host.game));
  assert.equal(stepKey(host.game), 'reveal:1:2');
  const b = stepKey(host.game);
  const r = await Promise.all([host.back(b), host.back(b)]);
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(stepKey(host.game), 'reveal:1:1', 'one market back');
  assert.equal(await host.back(b), false, 'a late Back drawn for reveal:1:2 does nothing');
  assert.equal(await runOut(host, clock), true, 'Back gave the market a fresh clock that still runs out on its own');
  assert.equal(stepKey(host.game), 'reveal:1:2');
});

test('+30 s and Pause are honoured during the all-locked seconds, and an unlock while paused gives the full clock back', async () => {
  // pure functions first
  const full = newClock(240, 'decide:2', T0), e = earlyClock(full, 5, T0 + 10000);
  const e30 = addTime(e, 30);
  assert.equal(e30.endsAt, T0 + 45000); assert.equal(e30.fullEndsAt, T0 + 270000, '+30 s moves the full clock too');
  assert.equal(restoreClock(e30, T0 + 20000).endsAt, T0 + 270000, 'an unlock after +30 s keeps the added time');
  const ep = pauseClock(e, T0 + 12000);
  const fp = pauseClock(full, T0);
  assert.equal(earlyClock(fp, 5, T0), fp, 'a paused clock is never shortened');
  const rp = restoreClock(ep, T0 + 99000);
  assert.equal(rp.paused, true); assert.equal(rp.remaining, 228000, 'unlock while paused: the full time left comes back, still paused'); assert.equal(rp.early, undefined);
  assert.equal(resumeClock(rp, T0 + 200000).endsAt, T0 + 428000);
  assert.equal(addTime(ep, 30).fullRemaining, ep.fullRemaining + 30000);

  // through the host
  const { host, clock, store } = await room({ humans: 2, house: 1 });
  await host.start();
  const fullEnds = host.game.clock.endsAt;
  clock.now = fullEnds - 100000;
  for (const id of ['T1', 'T2']) await store.patchDecision(host.gid, id, 1, { plan: ok(), locked: true });
  let ready = await host.readiness();
  await host.lockState(ready, 1);
  assert.equal(host.game.clock.endsAt, clock.now + 5000);
  await host.addTime(30);
  assert.equal(host.game.clock.endsAt, clock.now + 35000, '+30 s during the all-locked seconds is honoured');
  assert.equal(host.lockTarget(ready, 1), null, 'and not cut back to 5 s while everyone stays locked');
  clock.now += 6000;
  assert.equal(await host.tick(), false, 'still 29 s to go');
  await host.pause();
  clock.now += 10 * 60000;
  assert.equal(await host.tick(), false, 'paused during the all-locked seconds: nothing moves');
  await store.patchDecision(host.gid, 'T2', 1, { locked: false });
  ready = await host.readiness();
  assert.equal(await host.lockState(ready, 1), true, 'an unlock while paused is acted on');
  assert.equal(host.game.clock.paused, true);
  assert.equal(host.game.clock.remaining, 100000 + 30000 - 6000, 'the full clock, with the 30 s, is back');
  await host.resume();
  assert.equal(host.game.clock.endsAt, clock.now + 124000);
  await store.patchDecision(host.gid, 'T2', 1, { locked: true });
  ready = await host.readiness();
  await host.lockState(ready, 1);
  clock.now += 5300;
  assert.equal(await host.tick(), true);
  assert.equal(stepKey(host.game), 'reveal:1:0');
});

test('carry offers written during the recap are collected when its clock ends; one written after that is not', async () => {
  const { host, clock, store } = await room({ humans: 2, house: 0 });
  await host.start();
  const t1 = plan([D('shell', 'black', 'none', 'recycled')], { berlin: line('D1', { mode: 'partner', bid: 1.6 }) });
  const offer = { type: 'carry', market: 'berlin', design: { id: 'D1', cut: 'denim', palette: 'earth', logo: 'small', fabric: 'light' } };
  await store.patchDecision(host.gid, 'T1', 1, { plan: t1, locked: true });
  await store.patchDecision(host.gid, 'T2', 1, { plan: ok([D('denim', 'earth', 'small', 'light')]), locked: true });
  for (let i = 0; i < 5; i++) await runOut(host, clock);
  assert.equal(stepKey(host.game), 'reveal:1:4');
  assert.equal(host.state.history[1].seats.berlin, 'T1', 'T1 holds the Berlin seat');
  await store.patchDecision(host.gid, 'T2', 1, { notes: [offer] });           // during the recap
  await runOut(host, clock);
  assert.equal(stepKey(host.game), 'decide:2');
  assert.deepEqual(host.state.offers.map(o => [o.carried, o.holder, o.market, o.applies]), [['T2', 'T1', 'berlin', 2]]);
  assert.equal(teamView(host.state, 'T1').offersToMe.length, 1, 'T1 sees the offer in its season 2 view');
  assert.equal((await store.getSnapshots(host.gid, { kind: 'view', round: 2, teamId: 'T1' }))[0].data.view.offersToMe.length, 1, 'and so does its team page');
  // too late: a second offer on the season 1 row once season 2 is open, then season 2 runs to its recap with no new notes
  await store.patchDecision(host.gid, 'T2', 1, { notes: [offer, { ...offer, design: { ...offer.design, id: 'D2', cut: 'shell' } }] });
  await store.patchDecision(host.gid, 'T1', 2, { plan: t1, locked: true });
  for (let i = 0; i < 5; i++) await runOut(host, clock);
  assert.equal(stepKey(host.game), 'reveal:2:4');
  assert.equal(host.state.history[2].seats.berlin, 'T1');
  await store.patchDecision(host.gid, 'T2', 2, { notes: [{ ...offer, design: { ...offer.design, id: 'D3', palette: 'black' } }] });   // on time, season 2 recap
  await runOut(host, clock);
  assert.equal(stepKey(host.game), 'decide:3');
  const next = host.state.offers.filter(o => o.applies === 3);
  assert.deepEqual(next.map(o => o.design.id), ['D3'], 'the on-time season 2 offer counts; the late note on the season 1 row (D2) was never read');
  assert.equal(new Set(host.state.tables.ww_deals.map(d => d.deal_id)).size, 2, 'two offers in all, none from the late note');
});

test('the admin tick never stops: a backstop setInterval runs beside the worker, and an error or a failed start switches to full-speed setInterval', async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (cond, ms = 2000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await wait(5); return cond(); };   // Windows timers are coarse
  class FakeWorker { constructor() { FakeWorker.last = this; this.terminated = false; } terminate() { this.terminated = true; } }
  const savedWorker = globalThis.Worker, savedWarn = console.warn;
  const warned = [];
  console.warn = m => warned.push(String(m));
  try {
    // 1. starts, ticks twice, then reports an error: full-speed setInterval takes over and the worker is dropped
    globalThis.Worker = FakeWorker;
    let n = 0;
    let stop = every(10, () => n++, { backupMs: 100000 });
    const w = FakeWorker.last;
    w.onmessage(); w.onmessage();
    assert.equal(n, 2);
    w.onerror(new Error('worker died'));
    assert.equal(w.terminated, true);
    assert.ok(await until(() => n >= 5), 'setInterval took over (' + n + ' ticks)');
    stop();
    let before = n; w.onmessage();
    assert.equal(n, before, 'a stray message from the dead worker adds no tick');
    before = n; await wait(40); assert.equal(n, before, 'stop() stops the fallback too');
    // 2. the constructor throws (worker blocked): straight to setInterval
    globalThis.Worker = class { constructor() { throw new Error('blocked'); } };
    n = 0; stop = every(10, () => n++, { backupMs: 100000 });
    assert.ok(await until(() => n >= 3), 'fallback when the worker cannot start (' + n + ')'); stop();
    // 3. the worker ticks, then dies with no error event (audit N1): the backstop keeps ticking
    globalThis.Worker = FakeWorker;
    n = 0; stop = every(10, () => n++, { backupMs: 20 });
    FakeWorker.last.onmessage(); FakeWorker.last.onmessage();     // two worker ticks, then silence
    const afterWorker = n;
    assert.ok(await until(() => n >= afterWorker + 3), 'the backstop ticks on after the worker went silent (' + n + ')');
    stop();
    before = n; await wait(60); assert.equal(n, before, 'stop() stops the backstop');
    // 4. a worker that never ticks at all: the backstop covers it too, and nothing was terminated or warned about
    warned.length = 0;
    n = 0; stop = every(10, () => n++, { backupMs: 20 });
    assert.ok(await until(() => n >= 3), 'backstop with a silent worker (' + n + ')');
    assert.equal(FakeWorker.last.terminated, false);
    assert.deepEqual(warned, []);
    stop();
    assert.equal(FakeWorker.last.terminated, true, 'stop() ends the worker');
  } finally {
    console.warn = savedWarn;
    if (savedWorker === undefined) delete globalThis.Worker; else globalThis.Worker = savedWorker;
  }
});
