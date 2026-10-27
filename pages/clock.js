// The game clock, shared by the host, the projector and the team page. Pure functions (no DOM, no store), so the tests drive them with a fake time.
// A clock lives in ww_games.clock: {endsAt, total, paused, remaining, step, early, fullEndsAt}. The admin browser is the only writer and the only page
// that moves the game on; the projector and the team pages only count down from endsAt. A reload of any page reads the same row, so nothing resets.
//
// Before season 1 there is a worked-example round: 'example:0'..'example:2' (made-up brands, no engine), then 'decide:1'.
// Steps of a season: 'decide:S', then 'reveal:S:0'..'reveal:S:N-1' (one market each), then 'reveal:S:N' (the recap: own results on the team pages and
// carry offers for next season). The recap of the last season leads to 'final', which has no clock.

import { MARKET_IDS } from '../config/markets.js?v=0b0c6c97';
export const MARKET_STEPS = MARKET_IDS.length;   // one reveal step per market (five since 10/27)

export function stepKey(g) {
  if (!g) return '';
  if (g.phase === 'example') return 'example:' + ((g.reveal && g.reveal.idx) || 0);
  if (g.phase === 'decide') return 'decide:' + g.round;
  if (g.phase === 'reveal') return 'reveal:' + g.round + ':' + ((g.reveal && g.reveal.idx) || 0);
  return (g.phase || '') + ':' + (g.round || 0);
}

// Seconds for one step from config/rules.js CLOCK, times the host's speed setting (chosen in the lobby). Never under five seconds.
export const scaled = (secs, scale = 1) => Math.max(5, Math.round(secs * (Number(scale) > 0 ? Number(scale) : 1)));
export function stepSeconds(C, { phase, season, seasons, idx = 0 }, scale = 1) {
  if (phase === 'example') return scaled((C.exampleSeconds || [60])[idx] || 60, scale);
  if (phase === 'decide') return scaled(C.decideSeconds[season] || C.decideSeconds[2] || 240, scale);
  if (idx < MARKET_STEPS) return scaled(C.revealSecondsPerMarket, scale);
  return scaled(season >= seasons ? C.finalRecapSeconds : C.recapSeconds, scale);
}

// The whole game on the clock, step by step, with no early locks. The lobby prints the total so the host can fit the class slot.
export function gamePlan(C, seasons, scale = 1) {
  const steps = [];
  for (let i = 0; i < (C.exampleSeconds || []).length; i++) steps.push({ season: 0, step: 'example ' + (i + 1), seconds: stepSeconds(C, { phase: 'example', idx: i }, scale) });
  for (let s = 1; s <= seasons; s++) {
    steps.push({ season: s, step: 'decide', seconds: stepSeconds(C, { phase: 'decide', season: s, seasons }, scale) });
    for (let i = 0; i <= MARKET_STEPS; i++) steps.push({ season: s, step: i < MARKET_STEPS ? 'market ' + (i + 1) : 'recap', seconds: stepSeconds(C, { phase: 'reveal', season: s, seasons, idx: i }, scale) });
  }
  return { steps, total: steps.reduce((a, x) => a + x.seconds, 0) };
}

export const newClock = (seconds, step, now) => ({ endsAt: now + seconds * 1000, total: seconds, paused: false, remaining: null, step });
export const clockLeft = (c, now) => (!c ? 0 : c.paused ? Math.max(0, c.remaining || 0) : Math.max(0, (c.endsAt || 0) - now));
// Due: the clock belongs to the step the game is on (a clock without a step, from an older room, counts as belonging), is not paused, and ran out
// a moment ago. The slack keeps a host whose clock runs a little fast from cutting off a lock that is already on its way.
export const isDue = (g, now, slack = 250) => !!(g && g.clock && !g.clock.paused && g.clock.endsAt && (g.clock.step === undefined || g.clock.step === stepKey(g)) && now >= g.clock.endsAt + slack);

export const pauseClock = (c, now) => (!c || c.paused ? c : { ...c, paused: true, remaining: Math.max(0, c.endsAt - now), endsAt: null, ...(c.early ? { fullRemaining: Math.max(0, c.fullEndsAt - now) } : {}) });
export function resumeClock(c, now) {
  if (!c || !c.paused) return c;
  const { fullRemaining, ...rest } = c;
  return { ...rest, paused: false, endsAt: now + (c.remaining || 0), remaining: null, ...(c.early ? { fullEndsAt: now + (fullRemaining ?? c.remaining ?? 0) } : {}) };
}
// +30 s during the all-locked seconds also moves the full clock, so an unlock afterwards does not take the added time away.
export function addTime(c, secs) {
  if (!c) return c;
  const ms = secs * 1000;
  return c.paused ? { ...c, remaining: (c.remaining || 0) + ms, total: c.total + secs, ...(c.early ? { fullRemaining: (c.fullRemaining || 0) + ms } : {}) }
    : { ...c, endsAt: c.endsAt + ms, total: c.total + secs, ...(c.early ? { fullEndsAt: c.fullEndsAt + ms } : {}) };
}

// Every human team has locked: the decision clock drops to a few seconds so the projector can say so before the reveal. If a team unlocks during
// those seconds the full clock comes back, paused or not. A paused clock is never shortened; the drop waits for Resume.
export function earlyClock(c, secs, now) {
  if (!c || c.early || c.paused) return c;
  const endsAt = Math.min(c.endsAt, now + secs * 1000);
  return { ...c, early: true, fullEndsAt: c.endsAt, endsAt };
}
export function restoreClock(c, now) {
  if (!c || !c.early) return c;
  const { early, fullEndsAt, fullRemaining, ...rest } = c;
  if (c.paused) return { ...rest, remaining: Math.max(fullRemaining ?? 0, c.remaining || 0) };
  return { ...rest, endsAt: Math.max(fullEndsAt, now) };
}
