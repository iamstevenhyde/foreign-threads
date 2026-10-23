// Market table: four markets with a hidden taste, a distance, a foreignness tax by season and the market's own rules.
// All taste tiles, weights, incumbents and tax numbers are GAME DESIGN, invented for play, not claims about real consumers.
// Numbers are starting values for the Saturday bot balance run on bede; the engine reads them, nothing here is code.

// weights over [cut, palette, logo, fabric] sum to 1. Fit = sum of the weights of the rows a design matches.
// taste: the preferred tile per row (hidden from teams until revealed).
// distance: 1 to 3, sets how many of the four taste rows start hidden (fog).
// revealOrder: the order rows become visible, first row shown first. Visible at the start = 4 - distance rows.
// When a row is revealed the team sees the tile and a weight tier: High (>= 0.30), Medium (0.15 to 0.29), Low (< 0.15).
// taxBySeason: foreignness tax as a share of unit cost, by the team's n-th season selling in that market (1st, 2nd, 3rd, 4th).
//   A partner halves it (rules.partnerTaxCut). The tax is a visible line on the results card.
// rules: flags the engine reads.
//   research   a research firm exists (one paid reveal per season, fee in rules.js); false means the purchase button is absent
//   court      contracts and copyright are enforced; if true a Copy is sued, if false the street and partners copy freely
//   suitOnCopy a copy of a design in this market is sued (fine in rules.js)
//   streetCopy a design whose share passes rules.streetThreshold is knocked off by the street next season (fit x rules.streetFitHit)
//   dutyShipped import duty on goods shipped in (Own and Partner avoid it)
//   paymentLagSeasons revenue arrives this many seasons late
//   modes      entry modes open in this market (no formal distributor in Nairobi, so no Ship)
//   partnerWalks the partner may use your design with no remedy (no court); walkShare is the share of a Partner line's revenue the local partner keeps
// shipReachBonus: added to the Ship reach in this market (a near, integrated market is reached by ship almost as well as by a partner; CAGE distance lowers it).
// pressure / tolerance: pressure for local responsiveness (Bartlett and Ghoshal). tolerance is how much of the product buyers accept without a taste match:
//   share weight uses effective fit = tolerance + (1 - tolerance) x fit. Low pressure (high tolerance): a global product sells. High pressure: only fit sells.
// incumbent: the local firm, never on a leaderboard. Its garment is the market's taste exactly, discounted to incumbent.fit.

export const MARKET_IDS = ['berlin', 'tokyo', 'saopaulo', 'nairobi'];

export const MARKETS = {
  berlin: {
    id: 'berlin', pressure: 'low', tolerance: 0.9, shipReachBonus: 0.5, name: 'Berlin', distance: 1,
    taste: { cut: 'shell', palette: 'black', logo: 'none', fabric: 'recycled' },
    weights: { cut: 0.15, palette: 0.30, logo: 0.15, fabric: 0.40 },
    revealOrder: ['fabric', 'palette', 'cut', 'logo'],
    taxBySeason: [0.12, 0.07, 0.025, 0.01],
    rules: { research: true, court: true, suitOnCopy: true, streetCopy: false, dutyShipped: 0, paymentLagSeasons: 0, modes: ['ship', 'partner', 'own'], partnerWalks: false },
    incumbent: { name: 'Nordlicht', fit: 0.65, price: 'standard' },
    priceFit: { value: 0.9, standard: 1.0, premium: 0.9 },   // how well each price tier sells here (multiplies attractiveness)
    blurb: 'Big and crowded. Strong courts, research on sale, one firm everywhere is the test.',
  },
  tokyo: {
    id: 'tokyo', pressure: 'high', tolerance: 0.1, name: 'Tokyo', distance: 2,
    taste: { cut: 'denim', palette: 'earth', logo: 'small', fabric: 'light' },
    weights: { cut: 0.35, palette: 0.10, logo: 0.35, fabric: 0.20 },
    revealOrder: ['cut', 'fabric', 'logo', 'palette'],
    taxBySeason: [0.18, 0.1, 0.05, 0.02],
    rules: { research: true, court: true, suitOnCopy: true, streetCopy: false, dutyShipped: 0, paymentLagSeasons: 0, modes: ['ship', 'partner', 'own'], partnerWalks: false },
    incumbent: { name: 'Hanagumi', fit: 0.65, price: 'premium' },
    priceFit: { value: 0.8, standard: 1.0, premium: 1.1 },   // price tolerance is high
    blurb: 'Distance without voids. The taste is far from US habits and buyers pay for a fit.',
  },
  saopaulo: {
    id: 'saopaulo', pressure: 'high', tolerance: 0.1, name: 'Sao Paulo', distance: 2,
    taste: { cut: 'resort', palette: 'bright', logo: 'allover', fabric: 'light' },
    weights: { cut: 0.25, palette: 0.35, logo: 0.20, fabric: 0.20 },
    revealOrder: ['palette', 'cut', 'fabric', 'logo'],
    taxBySeason: [0.11, 0.06, 0.03, 0.01],
    rules: { research: true, court: true, suitOnCopy: false, streetCopy: false, dutyShipped: 0.4, paymentLagSeasons: 1, modes: ['ship', 'partner', 'own'], partnerWalks: false },
    incumbent: { name: 'Rua Viva', fit: 0.65, price: 'standard' },
    priceFit: { value: 1.1, standard: 1.0, premium: 0.8 },
    blurb: 'Administrative distance. 35% duty on goods you ship in; payments arrive a season late.',
  },
  nairobi: {
    id: 'nairobi', pressure: 'high', tolerance: 0.1, name: 'Nairobi', distance: 3,
    taste: { cut: 'hoodie', palette: 'pastel', logo: 'big', fabric: 'heavy' },
    weights: { cut: 0.20, palette: 0.15, logo: 0.25, fabric: 0.40 },
    revealOrder: ['fabric', 'logo', 'cut', 'palette'],
    taxBySeason: [0.43, 0.215, 0.09, 0.03],
    rules: { research: false, court: false, suitOnCopy: false, streetCopy: true, dutyShipped: 0, paymentLagSeasons: 0, modes: ['partner', 'own'], partnerWalks: true, walkShare: 0.35 },
    incumbent: { name: 'Mtaani Wear', fit: 0.65, price: 'value' },
    priceFit: { value: 1.4, standard: 0.85, premium: 0.4 },    // fabric and price weigh most
    blurb: 'The void market. No research firm, no court, no formal distributor. Copies spread fast.',
  },
};

export const marketList = () => MARKET_IDS.map(id => MARKETS[id]);

// How many of the four taste rows a team sees before any season is sold there.
export const startVisible = id => 4 - MARKETS[id].distance;
export const weightTier = w => (w >= 0.30 ? 'High' : w >= 0.15 ? 'Medium' : 'Low');
