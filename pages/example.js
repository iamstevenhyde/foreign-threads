// The worked-example round, drawn the same way on the projector and the team page (Steven 10/26). Made-up brands, a made-up city, no engine.
// Three screens: 0 choose, 1 sealed bids (the winning bid is PAID, not held), 2 the reveal (winners only, with percent shares).
import { h } from './util.js';
import { garmentEl, markEl, tileLabel, ROWS, ROW_LABEL } from './ui.js';
import { buildExample, EXAMPLE_TEXT } from '../config/example.js';

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

// step 0..2; where = 'proj' | 'team'
export function exampleScreen(step, where = 'team') {
  const t = EXAMPLE_TEXT[Math.max(0, Math.min(step, 2))];
  const body = step === 0 ? chooseScreen() : step === 1 ? bidScreen() : revealScreen();
  return h('div.ex.' + where, h('span.lbl', t.kicker), h('h1.ex-head', t.head), h('p.ex-note', 'Made-up brands in a made-up city. Nothing here counts.'),
    h('div.ex-say', t.lines.map(l => h('p', l))), body);
}
export const exampleFacts = EX;
