// Event deck: news articles in the in-game trade publication (masthead constant GAME.PUBLICATION, "Same Cloth Live").
// All companies, wires and facts are GAME DESIGN, invented for play. No real firms, brands or people.
// The deck is PUBLIC and identical for every team. drawDeck(seed) gives the fixed season-by-season draw.
// effect.mods use config paths from markets.js and rules.js. op: 'set' | 'add' | 'mul' | 'grant'. Every effect lasts the one season it is drawn for,
// then the config value returns. A weight 'add' on one row is always paired with an opposite 'add' on another so the four weights still sum to 1.
// op 'grant' on FOG.clueCardReveals (clue cards): shows that taste row (tile and weight tier) to every team, and the teams keep the knowledge.
// teaches: oli | distance | control | integration | voids.  art: file under art/ or null; needsArt holds a prompt when art is null.

import { TILE_PHRASE } from './tiles.js?v=c89ef327';

// Cards that reveal a taste row to every team carry a `render(tile ids of that market)` that writes the headline, standfirst and body from the
// room's drawn tile. Their static text is a placeholder that names no tile, so the repo holds no market's taste. Every other card is tile-neutral.
const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
export function renderEvent(ev, tastes) {
  if (!ev.render || !tastes) return ev;
  return { ...ev, ...ev.render(tastes[ev.markets[0]]) };
}

export const EVENTS = [
  {
    id: 'EV01', seasons: [1], pinned: 1, markets: ['tokyo'], teaches: 'distance', secondary: 'integration',
    headline: 'Tokyo Buyers Settle On A Logo Style',
    standfirst: 'A store survey finds shoppers agreeing on what belongs on the chest.',
    body: 'Floor staff at three Tokyo department stores told our correspondent that shoppers have settled on a logo style. (Loom Wire)',
    render: t => ({
      headline: 'Tokyo Buyers Keep Reaching For ' + cap(TILE_PHRASE.logo[t.logo].replace(/^an? /, '')),
      standfirst: 'A store survey finds shoppers settling on ' + TILE_PHRASE.logo[t.logo] + '.',
      body: 'Floor staff at three Tokyo department stores told our correspondent that shoppers keep reaching for ' + TILE_PHRASE.logo[t.logo] + ' and handing back almost everything else. One buyer said the favoured style outsold the nearest alternative almost two to one. Foreign labels that arrived with something different are quietly restocking, while local houses barely changed a stitch. The pattern looks settled. (Loom Wire)' }),
    rule: 'The Tokyo logo row is revealed to every team this season (tile and weight tier), and stays revealed.',
    numbers: 'FOG.clueCardReveals: grant for tokyo, row logo (third in revealOrder, hidden at the start because Tokyo distance is 2).',
    effect: { duration: 'season', mods: [{ path: 'FOG.clueCardReveals', op: 'grant', market: 'tokyo', row: 'logo' }] },
    debrief: 'This clue reached every team at once. Who could use it, and why did distance still leave teams unequal?',
    art: 'extras/wk10_event_cafe.png', needsArt: null
  },
  {
    id: 'EV02', seasons: [2], pinned: 2, markets: ['saopaulo'], teaches: 'voids', secondary: 'control',
    headline: 'Sao Paulo Payment Run Stretches To Two Seasons',
    standfirst: 'Retailers cite a clearing backlog as invoices stack up at the banks.',
    body: 'A clearing backlog at Sao Paulo banks has pushed retailer settlements out by a further season, according to three distributors we contacted. Imported lines already waited a season to be paid, and the new queue doubles that. One distributor said the shelves are full and the cash is slow. Suppliers who ship on thin reserves will feel it first, because goods sold this season will not be paid for until the final one. (Loom Wire)',
    rule: 'Sao Paulo revenue earned this season arrives two seasons later instead of one.',
    numbers: 'MARKETS.saopaulo.rules.paymentLagSeasons: 1 becomes 2. Revenue earned in season 2 arrives in season 4. LATE_PAYMENT_FINAL_HAIRCUT (0.20) still applies to anything unpaid at the end of season 4.',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.saopaulo.rules.paymentLagSeasons', op: 'set', value: 2 }] },
    debrief: 'What did a team with a thin cash balance give up in Sao Paulo, and what would owning a shop there have changed?',
    art: 'extras/wk10_event_customs.png', needsArt: null
  },
  {
    id: 'EV03', seasons: [3], pinned: 3, markets: ['nairobi'], teaches: 'voids', secondary: 'control',
    headline: 'Nairobi Stall Rows Copy Hot Sellers Within Days',
    standfirst: 'Market traders say a design now needs only a small crowd before it is knocked off.',
    body: 'Along the stall rows of central Nairobi, tailors report that a jacket needs only a modest following before copies appear at half the price. One trader said a few good days is enough to be noticed and a week is enough to be matched. With no court to complain to, original makers have no remedy beyond moving on. Larger stockists say the line between a hit and a target is getting thinner. (Loom Wire)',
    rule: 'The Nairobi street knock-off triggers at 15% of the pool this season instead of 25%.',
    numbers: 'COPY.streetThreshold: 0.25 becomes 0.15. A design at or above that share has its fit multiplied by COPY.streetFitHit (0.8) in Nairobi next season, as the street rule already says.',
    effect: { duration: 'season', mods: [{ path: 'COPY.streetThreshold', op: 'set', value: 0.15 }] },
    debrief: 'With no court, what could a successful team do to stop being a target, and what did it cost them in share?',
    art: 'extras/wk10_event_nairobi_knockoff.png', needsArt: null
  },
  {
    id: 'EV04', seasons: [1, 2, 3, 4], pinned: null, markets: ['berlin'], teaches: 'integration', secondary: 'oli',
    headline: 'Berlin Stores Ask Where The Cloth Came From',
    standfirst: 'Buyers are reading fabric labels before colour or cut.',
    body: 'Berlin buyers are turning garments over to read the fabric label first, our shop-floor survey finds. A palette that sold last season now takes second place to what the garment is made of. Store managers say the right fabric will be forgiven an awkward colour, while a fine colour on the wrong fabric will not. Local firms were already ahead of this and are adding weight to the point. (Loom Wire)',
    rule: 'In Berlin this season fabric counts 0.55 of the fit and palette counts 0.15; cut and logo keep their weights.',
    numbers: 'MARKETS.berlin.weights.fabric: 0.40 becomes 0.55 (add 0.15). palette: 0.30 becomes 0.15 (add -0.15). cut 0.15 and logo 0.15 unchanged. Revealed weight tiers follow: fabric High, palette Medium.',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.berlin.weights.fabric', op: 'add', value: 0.15 }, { path: 'MARKETS.berlin.weights.palette', op: 'add', value: -0.15 }] },
    debrief: 'Did a team that fitted one design to Berlin notice the shift, and what would a Berlin-only variant have cost them?',
    art: 'extras/wk10_event_cafe.png', needsArt: null
  },
  {
    id: 'EV05', seasons: [1, 2, 3, 4], pinned: null, markets: ['all'], teaches: 'oli', secondary: 'control',
    headline: 'Offshore Sewing Wages Rise, Unit Costs Follow',
    standfirst: 'Contract lines raise their price per garment across every run size.',
    body: 'Contract factories that sew for most labels have raised their rates, citing higher wages and a tight labour market. Brands buying short runs will see the biggest effect in their margins, while those with long runs can spread the cost thinner. Several design teams said they are reconsidering how many variants they can afford. Buyers in the shops will see no change in the price on the rail. (Loom Wire)',
    rule: 'Every unit cost is 10% higher this season, in every market and run size.',
    numbers: 'RUNS.unitCost x 1.10 (10: 51 becomes 56.1; 25: 46 becomes 50.6; 50: 41 becomes 45.1; 100: 37 becomes 40.7), before the design multiplier and the foreignness tax.',
    effect: { duration: 'season', mods: [{ path: 'RUNS.unitCost', op: 'mul', value: 1.10 }] },
    debrief: 'Which teams absorbed the shock because they had made one cheap run, and which paid for responsiveness?',
    art: 'extras/wk10_event_sewing.png', needsArt: null
  },
  {
    id: 'EV06', seasons: [1, 2, 3, 4], pinned: null, markets: ['saopaulo'], teaches: 'control', secondary: 'oli',
    headline: 'Sao Paulo Raises Import Duty On Finished Apparel',
    standfirst: 'Customs sets a higher rate for shipped goods, with local partners spared.',
    body: 'Brazilian customs officials announced a higher duty on finished apparel arriving by ship, effective at once. Goods made through a local partner or in an owned shop are not affected, which importers described as a clear push to put stitching and selling on local ground. Warehouses at the port report cargo piling up as importers wait to see how the rate will be applied. (Loom Wire)',
    rule: 'The duty on goods shipped into Sao Paulo is 55% this season, not 40%. Partner and Own pay no duty.',
    numbers: 'MARKETS.saopaulo.rules.dutyShipped: 0.40 becomes 0.55.',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.saopaulo.rules.dutyShipped', op: 'set', value: 0.55 }] },
    debrief: 'At what price did Ship stop being the cheap way in, and who had already moved to a partner or their own shop?',
    art: 'extras/wk10_event_customs.png', needsArt: null
  },
  {
    id: 'EV07', seasons: [2, 3, 4], pinned: null, markets: ['berlin', 'tokyo'], teaches: 'voids', secondary: 'control',
    headline: 'Berlin And Tokyo Courts Agree Tougher Copy Fines',
    standfirst: 'A joint accord doubles what a copier pays the original maker.',
    body: 'Courts in Berlin and Tokyo have signed a joint accord on copied designs, doubling the award a successful claimant receives. Lawyers expect more cases and quicker settlements because the cost of being found out has risen sharply. Smaller labels said the change makes a copy a far more serious risk to take. Merchants in both cities welcomed it, though several admitted that nobody wants to be the first test. (Loom Wire)',
    rule: 'A copy sued in Berlin or Tokyo this season costs the copier $5M, not $2M, paid to the original owner.',
    numbers: 'COPY.suitFine: 2.0 becomes 5.0. Applies only where MARKETS.x.rules.suitOnCopy is true (Berlin, Tokyo).',
    effect: { duration: 'season', mods: [{ path: 'COPY.suitFine', op: 'set', value: 5.0 }] },
    debrief: 'Did anyone still copy in Berlin or Tokyo, and was the fine the thing that stopped the rest?',
    art: 'extras/wk10_event_suit.png', needsArt: null
  },
  {
    id: 'EV08', seasons: [2, 3, 4], pinned: null, markets: ['berlin'], teaches: 'voids', secondary: 'integration',
    headline: 'Berlin Commercial Court Closes To New Copy Cases',
    standfirst: 'A staffing gap pauses suits over copied designs for a season.',
    body: 'Berlin commercial court has stopped taking new claims over copied designs for the season, citing a shortage of judges after a regional reshuffle. Cases already filed continue, but a maker who finds a lookalike on a rail will have nowhere to take it until the court reopens. Lawyers said the pause is administrative, not political, and that it ends on schedule. Copyists have noticed all the same. (Loom Wire)',
    rule: 'Copies sold in Berlin this season are not sued, so no $2M fine is paid. Tokyo is unchanged.',
    numbers: 'MARKETS.berlin.rules.suitOnCopy: true becomes false.',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.berlin.rules.suitOnCopy', op: 'set', value: false }] },
    debrief: 'Berlin had a court every other season. What did teams do when the court went away for one?',
    art: null, needsArt: 'a quiet courthouse corridor, one closed oak door with a handwritten notice, stacks of ring binders on a bench, flat design-sheet style'
  },
  {
    id: 'EV09', seasons: [2, 3, 4], pinned: null, markets: ['tokyo'], teaches: 'integration', secondary: 'distance',
    headline: 'Tokyo Shoppers Weigh Colour Above Logos',
    standfirst: 'Shoppers drift from marked garments toward what colour says.',
    body: 'A season of crowded streets has left Tokyo shoppers wanting less to look at. Buyers at several stores told us that colour is doing more of the talking now and the logo less. A garment in the right colour is moving faster than one with a marked chest, even where the cut is plain. Local houses were first, and the foreign labels are scrambling to follow. (Loom Wire)',
    rule: 'In Tokyo this season palette counts 0.25 of the fit and logo counts 0.20; cut and fabric keep their weights.',
    numbers: 'MARKETS.tokyo.weights.palette: 0.10 becomes 0.25 (add 0.15). logo: 0.35 becomes 0.20 (add -0.15). cut 0.35 and fabric 0.20 unchanged.',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.tokyo.weights.palette', op: 'add', value: 0.15 }, { path: 'MARKETS.tokyo.weights.logo', op: 'add', value: -0.15 }] },
    debrief: 'Which team found out about the weight shift from the card and which from their own results?',
    art: 'extras/wk10_event_cafe.png', needsArt: null
  },
  {
    id: 'EV10', seasons: [1, 2, 4], pinned: null, markets: ['nairobi'], teaches: 'oli', secondary: 'voids',
    headline: 'Nairobi Phone Payments Open The Shop Doors Wider',
    standfirst: 'A new mobile wallet pulls first-time buyers into clothing shops.',
    body: 'A mobile wallet launched across Nairobi last month has brought first-time buyers into clothing shops, according to a trade association count of till receipts. Stall holders report a long queue on payday and a thinner one in between. Foreign labels already selling there get the same crowd as the local houses, though only those with stock on the rail can serve it. No court has yet been asked to settle a wallet dispute. (Loom Wire)',
    rule: 'The Nairobi buyer pool is 345 thousand this season instead of 265 thousand.',
    numbers: 'POOLS.nairobi: 265 becomes 345 (x1.30).',
    effect: { duration: 'season', mods: [{ path: 'POOLS.nairobi', op: 'mul', value: 1.30 }] },
    debrief: 'Was the bigger pool a reason to enter Nairobi, or did the teams already there simply collect it?',
    art: 'extras/wk10_event_winner.png', needsArt: null
  },
  {
    id: 'EV11', seasons: [2, 3, 4], pinned: null, markets: ['all'], teaches: 'control', secondary: 'oli',
    headline: 'Trade Show Floods Market With Willing Distributors',
    standfirst: 'A packed fair leaves distributors competing for fewer brands, and partner fees soften.',
    body: 'The season trade show closed with more distributors than brands, and our reporter counted them stacked three deep at some booths. With so many offering to carry a line, the usual cut was hard to hold, and several accepted half of what they asked a year ago. Brands without a stand did not benefit, since the fair only rewarded those who took part. (Loom Wire)',
    rule: 'The partner seat holder keeps 10% of the partner revenue in its market this season, not 20%.',
    numbers: 'MODES.partner.feeShare: 0.20 becomes 0.10. The carry fee (CARRY.fee, $1.0M) is unchanged.',
    effect: { duration: 'season', mods: [{ path: 'MODES.partner.feeShare', op: 'set', value: 0.10 }] },
    debrief: 'Who paid for a partner seat in a season when the seat was worth less, and who should have waited?',
    art: 'extras/wk10_event_tradeshow.png', needsArt: null
  },
  {
    id: 'EV12', seasons: [2, 3, 4], pinned: null, markets: ['tokyo'], teaches: 'distance', secondary: 'control',
    headline: 'Tokyo Trade Pact Halves Entry Costs For Foreign Labels',
    standfirst: 'A bilateral pact trims the foreign premium for one season.',
    body: 'A newly signed trade pact has lowered the extra cost foreign labels pay to sell in Tokyo, officials confirmed. The change is temporary and expires at season end, with renewal uncertain. Importers described the cost of being a stranger as halved overnight. Several local houses said they were not worried, and one noted the pact does nothing about the thing the buyers actually want. (Loom Wire)',
    rule: 'The Tokyo foreignness tax is halved this season, before the partner halving.',
    numbers: 'MARKETS.tokyo.taxBySeason x 0.5: [0.18, 0.10, 0.05, 0.02] becomes [0.09, 0.05, 0.025, 0.01]. A partner still halves the result (PARTNER_TAX_CUT 0.5).',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.tokyo.taxBySeason', op: 'mul', value: 0.5 }] },
    debrief: 'The tax fell, but the buyers did not move. What does the cost of being foreign leave untouched?',
    art: 'extras/wk10_partner_tokyo.png', needsArt: null
  },
  {
    id: 'EV13', seasons: [3, 4], pinned: 4, markets: ['berlin'], teaches: 'oli', secondary: 'integration',
    headline: 'Berlin Shoppers Trade Down After Cold Winter',
    standfirst: 'Value tags outsell premium on every rail in the city.',
    body: 'Berlin shoppers are keeping their wallets closed this season after an expensive winter, retailers say. Value-priced pieces are selling through while premium rails sit untouched, even among labels that built their name on the high end. Store owners said buyers still want the right garment, though not at the old price. The crowded city has become a harder place to charge for quality. (Loom Wire)',
    rule: 'In Berlin this season Value sells at 1.1 and Premium at 0.7; Standard is unchanged.',
    numbers: 'MARKETS.berlin.priceFit: value 0.9 becomes 1.1; premium 0.9 becomes 0.7; standard stays 1.0.',
    effect: { duration: 'season', mods: [{ path: 'MARKETS.berlin.priceFit.value', op: 'set', value: 1.1 }, { path: 'MARKETS.berlin.priceFit.premium', op: 'set', value: 0.7 }] },
    debrief: 'Which team had one price everywhere, and what did it cost them in Berlin this season?',
    art: 'extras/wk10_incumbent_berlin.png', needsArt: null
  },
  {
    id: 'EV14', seasons: [1, 2, 3], pinned: null, markets: ['saopaulo'], teaches: 'distance', secondary: 'integration',
    headline: 'Sao Paulo Buyers Settle On A Fabric',
    standfirst: 'Store buyers say shoppers have agreed on the cloth they want.',
    body: 'Store buyers in Sao Paulo say shoppers have settled on a fabric. (Loom Wire)',
    render: t => ({
      headline: 'Sao Paulo Buyers Settle On ' + cap(TILE_PHRASE.fabric[t.fabric]),
      standfirst: 'Store buyers say shoppers are choosing ' + TILE_PHRASE.fabric[t.fabric] + ' across the city.',
      body: 'A season of talk on the Sao Paulo shop floor has settled on one point, according to store buyers: shoppers are choosing ' + TILE_PHRASE.fabric[t.fabric] + ' ahead of anything else on the rail. One chain said the favoured cloth sold through in a morning while the rest was left on the hangers. The preference is not a passing fad, one stylist said, since local houses have favoured it for as long as anyone can remember. Foreign labels have noticed the pattern. (Loom Wire)' }),
    rule: 'The Sao Paulo fabric row is revealed to every team this season (tile and weight tier), and stays revealed.',
    numbers: 'FOG.clueCardReveals: grant for saopaulo, row fabric (third in revealOrder, hidden at the start because Sao Paulo distance is 2).',
    effect: { duration: 'season', mods: [{ path: 'FOG.clueCardReveals', op: 'grant', market: 'saopaulo', row: 'fabric' }] },
    debrief: 'A free clue went to everyone. Why did some teams still turn it into a better design, and others not?',
    art: 'wk10_street_saopaulo.png', needsArt: null
  },
  {
    id: 'EV15', seasons: [2, 3, 4], pinned: null, markets: ['all'], teaches: 'control', secondary: 'oli',
    headline: 'Port Congestion Leaves Shipped Orders Sitting On Docks',
    standfirst: 'Waiting cargo means fewer shipped garments reach the shelves in time.',
    body: 'Port congestion across major apparel routes left shipped orders on the dock for weeks, forwarders said, and shops that waited on them lost sales. Brands that stitch locally or sell through a partner were largely spared. Analysts said the surge is expected to clear within the season. For shipped lines, though, a late jacket is a lost jacket, and retailers have few kind words for the delay. (Loom Wire)',
    rule: 'Shipped goods carry a reach of 0.30 this season instead of 0.45. Partner, Own and carried reach are unchanged.',
    numbers: 'SHARE.reach.ship: 0.45 becomes 0.30. Berlin keeps its +0.50 near-market bonus.',
    effect: { duration: 'season', mods: [{ path: 'SHARE.reach.ship', op: 'set', value: 0.30 }] },
    debrief: 'Ship was the cheap door. When the door stuck, who had a second way in?',
    art: null, needsArt: 'a container port at dawn, one crane idle above a long queue of stacked shipping containers and waiting trucks, flat design-sheet style'
  },
  {
    id: 'EV16', seasons: [1, 2], pinned: null, markets: ['nairobi'], teaches: 'distance', secondary: 'voids',
    headline: 'Nairobi Market Day Settles On A Logo Style',
    standfirst: 'Stallholders say shoppers know what they want on the chest.',
    body: 'On Nairobi market day, stallholders say one logo style goes first. (Loom Wire)',
    render: t => ({
      headline: 'Nairobi Market Day Favours ' + cap(TILE_PHRASE.logo[t.logo].replace(/^an? /, '')),
      standfirst: 'Stallholders say shoppers know what they want on the chest.',
      body: 'On Nairobi market day, stallholders say the garments that go first carry ' + TILE_PHRASE.logo[t.logo] + ', and shoppers pass over the rest. Our correspondent found nothing like it on the rails in any other city she visited. A research firm would charge for such news if one existed here. (Loom Wire)' }),
    rule: 'The Nairobi logo row is revealed to every team this season (tile and weight tier), and stays revealed.',
    numbers: 'FOG.clueCardReveals: grant for nairobi, row logo (second in revealOrder, hidden at the start because Nairobi distance is 3). There is no research firm in Nairobi (MARKETS.nairobi.rules.research is false), so this is the only free source.',
    effect: { duration: 'season', mods: [{ path: 'FOG.clueCardReveals', op: 'grant', market: 'nairobi', row: 'logo' }] },
    debrief: 'With no research firm, how did anyone learn about Nairobi, and what did that tell you about the case you read?',
    art: 'wk10_street_nairobi.png', needsArt: null
  }
];

// Seeded draw: two cards per season. Slot 1 is the pinned card if the season has one, else a seeded pick; slot 2 is a seeded pick
// from the cards still eligible for that season that share no market with slot 1 (an 'all' card shares with none) and were not used.
// Slot 1 is the lead story (runway step 1, projector front page); slot 2 goes to the ticker.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawDeck(seed, seasons = 4, perSeason = 2) {
  const rnd = mulberry32(seed >>> 0), used = new Set(), out = {};
  for (let s = 1; s <= seasons; s++) {
    const picks = [];
    const pin = EVENTS.find(e => e.pinned === s);
    if (pin) { picks.push(pin); used.add(pin.id); }
    while (picks.length < perSeason) {
      const pool = EVENTS.filter(e => e.seasons.includes(s) && e.pinned == null && !used.has(e.id) &&
        !picks.some(p => p.markets.some(m => m !== 'all' && e.markets.includes(m))));
      const c = pool[Math.floor(rnd() * pool.length)];
      picks.push(c); used.add(c.id);
    }
    out[s] = picks.map(c => c.id);
  }
  return out;
}
