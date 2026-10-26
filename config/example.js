// The worked-example round (Steven 10/26): a practice walk-through before season 1 on made-up brands in a made-up city, so the room sees one full
// cycle (choose, sealed bid, reveal) before it plays for real. Nothing here is a real market, nothing here touches the engine or the score, and the
// example city's taste is not any room's hidden taste. Numbers use the real share formula (fit ^ exponent x reach) so the example behaves like the game.
import { SHARE } from './rules.js';

export const EXAMPLE_STEPS = 3;     // 0 choose, 1 sealed bids, 2 reveal

const CITY = {
  name: 'Example City',
  weights: { cut: 0.30, palette: 0.30, logo: 0.20, fabric: 0.20 },
  taste: { cut: 'hoodie', palette: 'earth', logo: 'small', fabric: 'heavy' },     // made up; shown on the slide so the fit sums can be followed
};

const SELLERS = [
  { id: 'birch', name: 'Birch', mark: 'bolt', colour: '#2448d8', tiles: { cut: 'hoodie', palette: 'earth', logo: 'small', fabric: 'light' }, pieceName: 'Earth Hoodie',
    mode: 'partner', bid: 0.6, price: 'Standard', run: 50 },
  { id: 'alder', name: 'Alder', mark: 'wave', colour: '#2f5d3a', tiles: { cut: 'puffer', palette: 'earth', logo: 'small', fabric: 'heavy' }, pieceName: 'Earth Puffer',
    mode: 'partner', bid: 0.4, price: 'Standard', run: 50, fallback: 'ship' },
];
const RIVAL = { name: 'Local rival', fit: 0.65 };

const fitOf = tiles => Math.round(Object.keys(CITY.weights).reduce((s, r) => s + (tiles[r] === CITY.taste[r] ? CITY.weights[r] : 0), 0) * 100) / 100;

export function buildExample() {
  const birch = { ...SELLERS[0] }, alder = { ...SELLERS[1] };
  birch.fit = fitOf(birch.tiles); alder.fit = fitOf(alder.tiles);
  const winnerOfSeat = birch.bid >= alder.bid ? birch : alder, loserOfSeat = winnerOfSeat === birch ? alder : birch;
  // the seat winner sells as the partner; the loser falls back to the plan's fallback (ship), at ship reach
  const reachOf = s => (s === winnerOfSeat ? SHARE.reach.partner : SHARE.reach.ship);
  const parts = [
    { key: 'birch', name: birch.name, w: Math.pow(birch.fit, SHARE.fitExponent) * reachOf(birch) },
    { key: 'alder', name: alder.name, w: Math.pow(alder.fit, SHARE.fitExponent) * reachOf(alder) },
    { key: 'rival', name: RIVAL.name, w: Math.pow(RIVAL.fit, SHARE.fitExponent) * SHARE.reach.partner },
  ];
  const total = parts.reduce((s, p) => s + p.w, 0);
  let shares = parts.map(p => ({ key: p.key, name: p.name, share: p.w / total }));
  // whole percents that add to 100
  const pct = shares.map(s => Math.floor(s.share * 100)); let rest = 100 - pct.reduce((a, b) => a + b, 0);
  shares.map((s, i) => ({ i, r: s.share * 100 - pct[i] })).sort((a, b) => b.r - a.r).forEach(x => { if (rest > 0) { pct[x.i]++; rest--; } });
  shares = shares.map((s, i) => ({ ...s, pct: pct[i] }));
  const top = shares.reduce((a, s) => (s.pct > a.pct ? s : a), shares[0]);
  return { city: CITY, birch, alder, seat: { winner: winnerOfSeat, loser: loserOfSeat, paid: winnerOfSeat.bid, refunded: loserOfSeat.bid }, shares, topKey: top.key, rival: RIVAL };
}

// The words on the three screens. Plain language, kept here so the projector and the team page say the same thing.
export const EXAMPLE_TEXT = [
  { kicker: 'Practice round, step 1 of 3', head: 'Choose.', lines: [
      'Each brand picks one piece (cut, colour, logo, fabric), a price, how many to make, and how to enter the city.',
      'Both brands here want the local-partner seat, so each writes a sealed bid. Alder also names a fallback: ship in if the bid loses.',
      'Every city has public weights, shown here. What a city likes inside each row stays hidden until you learn it.'] },
  { kicker: 'Practice round, step 2 of 3', head: 'The sealed bids.', lines: [
      'The highest bid takes the seat. The winning bid is PAID. It is spent, not held, and it does not come back.',
      'A losing bid is returned in full, and the loser plays its fallback.'] },
  { kicker: 'Practice round, step 3 of 3', head: 'The reveal.', lines: [
      'The projector shows who won each city and by how much. Only the winning piece is shown, so everyone else\'s design stays private.',
      'A winning piece can be copied next season, so winning in public has a price.'] },
];
