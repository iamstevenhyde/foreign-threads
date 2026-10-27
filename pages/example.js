// The worked-example round, drawn the same way on the projector and the team page (Steven 10/26). Made-up brands, a made-up city, no engine.
// Three screens: 0 choose, 1 sealed bids (the winning bid is PAID, not held), 2 the reveal (winners only, with percent shares).
import { h } from './util.js?v=97381521';
import { garmentEl, markEl, tileLabel, ROWS, ROW_LABEL } from './ui.js?v=97381521';
import { buildExample, EXAMPLE_TEXT, PRACTICE, practiceResult } from '../config/example.js?v=97381521';

const EX = buildExample();
const pc = x => Math.round(x * 100) + '%';
const m2 = x => '$' + x.toFixed(2) + 'M';
const style = s => ({ mark: s.mark, colour: s.colour });

function weightsStrip() {
  return h('div.ex-weights', h('span.lbl', EX.city.name + ': what buyers weigh (public)'),
    h('div.exw-row', ROWS.map(r => h('div.exw', h('span.lbl', ROW_LABEL[r]), h('b', pc(EX.city.weights[r])),
      h('i', { style: 'width:' + Math.round(EX.city.weights[r] * 100 * 2.2) + 'px' })))));
}
function pieceCard(s, extra) {
  return h('article.ex-card', garmentEl(s.tiles, { name: s.pieceName }, style(s), s.name, { cls: 'gsvg ex-g' }),
    h('div.ex-brand', markEl(style(s), 28), h('b.wm', s.name)), h('div.ex-pname', s.pieceName),
    h('div.ex-tiles', ROWS.map(r => h('span', h('span.lbl', ROW_LABEL[r]), h('b', tileLabel(r, s.tiles[r]))))), extra);
}

function chooseScreen() {
  const line = s => h('div.ex-plan', h('span.lbl', 'Plan'),
    h('div', 'Local partner seat, sealed bid ', h('b', m2(s.bid))), h('div', s.price + ' price, ' + s.run + 'k made'), h('div.note', s.fallback ? 'If the bid loses: ship in' : 'If the bid loses: sit out'));
  return h('div.ex-body', h('div.ex-cards', pieceCard(EX.birch, line(EX.birch)), pieceCard(EX.alder, line(EX.alder))), weightsStrip());
}
function bidScreen() {
  const { winner, loser, paid, refunded } = EX.seat;
  const bar = (s, win) => h('div.ex-bid' + (win ? '.win' : ''), h('div.eb-top', markEl(style(s), 28), h('b.wm', s.name), h('span.eb-amt', m2(s.bid))),
    h('i', { style: 'width:' + Math.round(s.bid / 0.6 * 100) + '%' }),
    h('p', win ? 'Highest bid. Wins the seat and PAYS ' + m2(paid) + '. That money is spent, not held.' : 'Lower bid. Gets all ' + m2(refunded) + ' back and plays its fallback: ship in.'));
  return h('div.ex-body', h('div.ex-bids', bar(winner, true), bar(loser, false)),
    h('div.ex-paid', h('span.lbl', 'Plainly'), h('b', 'The winning bid is paid. A losing bid comes back.')));
}
function revealScreen() {
  const win = EX.topKey === 'birch' ? EX.birch : EX.alder;
  const sh = EX.shares.find(x => x.key === win.id);
  return h('div.ex-body.rv',
    h('article.ex-win', h('div.ribbon', 'Best seller in ' + EX.city.name), garmentEl(win.tiles, { name: win.pieceName }, style(win), win.name, { cls: 'gsvg ex-gw' }),
      h('div.ex-brand', markEl(style(win), 30), h('b.wm', win.name)), h('div.ex-pname', win.pieceName), h('div.ex-big', sh.pct + '%')),
    h('div.ex-shares', h('span.lbl', 'Share of buyers (only the winner\'s design is shown)'),
      EX.shares.slice().sort((a, b) => b.pct - a.pct).map(x => h('div.exs' + (x.key === EX.topKey ? '.win' : ''), h('b.wm', x.name), h('i', { style: 'width:' + Math.round(x.pct / EX.shares.reduce((a, y) => Math.max(a, y.pct), 1) * 100) + '%' }), h('span', x.pct + '%')))));
}

// ---------- the practice bid (10/27) ----------
// Team page, steps 0 and 1: a bid box with the real cap and minimum, a default and a hint. Step 2: did it win, what was paid or refunded.
// Projector: steps 0 and 1 tell the room to bid on their phones; step 2 shows the rival bids and the bid that had to be beaten.
const seatLine = n => (n > 1 ? 'Example City has ' + n + ' partner seats: the ' + n + ' highest bids win.' : 'Example City has one partner seat: the highest bid wins.');
function practiceBox(ctx, step) {
  const r = practiceResult(ctx.bid, ctx.teamCount);
  const set = v => ctx.setBid(Math.max(0, Math.round(v * 10) / 10));
  return h('div.ex-practice',
    h('span.lbl', step === 0 ? 'Your turn: a practice bid' : 'Sealed bids are in. You can still change yours'),
    h('p', seatLine(r.seats) + ' You hold ' + m2(PRACTICE.cash) + ', so your bid can be at most ' + m2(r.cap) + ' (8% of cash) and at least ' + m2(r.min) + '.'),
    h('div.stepper', h('button.btn.sq', { 'aria-label': 'Lower practice bid', onclick: () => set(r.amount - 0.1) }, '−'),
      h('input', { type: 'number', min: 0, step: 0.1, value: r.amount.toFixed(1), 'aria-label': 'Practice bid in $M', onchange: ev => set(Number(ev.target.value) || 0) }),
      h('button.btn.sq', { 'aria-label': 'Raise practice bid', onclick: () => set(r.amount + 0.1) }, '+')),
    r.wasCapped ? h('p.warn', 'Over the cap: it counts as ' + m2(r.cap) + '.') : !r.valid ? h('p.warn', 'Under the minimum: a bid this small is thrown out.') : null,
    h('p.note', 'Hint: in test games, winning bids were mostly 3.5% to 7% of cash, about ' + m2(0.035 * PRACTICE.cash) + ' to ' + m2(0.07 * PRACTICE.cash) + ' at the start. A winning bid is PAID; a losing bid comes back.'),
    h('p.note', r.entered ? 'Your bid is saved on this phone. The reveal shows if it won.' : 'No bid typed yet, so the default ' + m2(PRACTICE.defaultBid) + ' plays.'));
}
function practiceOutcome(ctx) {
  const r = practiceResult(ctx.bid, ctx.teamCount);
  return h('div.ex-practice' + (r.won ? '.won' : '.lost'),
    h('span.lbl', 'Your practice bid'),
    h('h2', r.won ? 'You won a seat and PAID ' + m2(r.paid) + '.' : !r.valid ? 'Your bid was under the minimum, so it was thrown out.' : 'You lost. All ' + m2(r.refunded) + ' comes back.'),
    h('p', (r.entered ? '' : 'You did not type a bid, so the default played. ') + 'To win you needed more than ' + m2(r.toBeat) + '. ' + seatLine(r.seats)),
    h('div.ex-ranks', r.ranking.map(x => h('div' + (x.me ? '.me' : '') + (x.won ? '.won' : ''), h('b', x.me ? 'You' : x.name), h('span', m2(x.bid) + (x.won ? ' wins, pays' : ' refunded'))))));
}
function practiceProj(step, ctx) {
  const r = practiceResult(0, ctx.teamCount);
  if (step < 2) return h('div.ex-practice.proj', h('span.lbl', 'Everyone, on your phone'), h('h2', 'Type a practice bid now.'),
    h('p', seatLine(r.seats) + ' Cap ' + m2(r.cap) + ', minimum ' + m2(r.min) + '. Three made-up rivals have already bid, sealed.'));
  return h('div.ex-practice.proj', h('span.lbl', 'The practice bids'), h('h2', 'Bids over ' + m2(r.toBeat) + ' won a seat.'),
    h('div.ex-ranks', PRACTICE.rivals.map((x, i) => h('div' + (i < r.seats ? '.won' : ''), h('b', x.name), h('span', m2(x.bid))))),
    h('p', 'Your phone says whether your own bid won and what it paid.'));
}

// step 0..2; where = 'proj' | 'team'; ctx = { teamCount, bid, setBid } (the team page passes all three, the projector only teamCount)
export function exampleScreen(step, where = 'team', ctx = null) {
  const t = EXAMPLE_TEXT[Math.max(0, Math.min(step, 2))];
  const body = step === 0 ? chooseScreen() : step === 1 ? bidScreen() : revealScreen();
  const practice = !ctx ? null : where === 'team' ? (step < 2 ? practiceBox(ctx, step) : practiceOutcome(ctx)) : practiceProj(step, ctx);
  return h('div.ex.' + where, h('span.lbl', t.kicker), h('h1.ex-head', t.head), h('p.ex-note', 'Made-up brands in a made-up city. Nothing here counts.'),
    where === 'team' ? practice : null,
    h('div.ex-say', t.lines.map(l => h('p', l))), body, where === 'proj' ? practice : null);
}
export const exampleFacts = EX;
