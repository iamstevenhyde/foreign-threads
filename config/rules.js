// Numbers the engine reads: budgets, fees, run sizes, unit-cost curve, buyer pools, partner bid cap, copy and suit rules.
// All STARTING VALUES for the Saturday bot balance run on bede. Money is $M, garments and buyers are thousands, prices are $ per garment.
// Rule from the Parent Trap: every number here that a team chooses against must also be printed on the team page at the moment of choice.

export const SEASONS = 4;

export const BUDGET = {
  startCash: 20,            // $M per brand at the start; profit rolls into the next season's cash
  partnerBidCap: 0.08,      // a sealed partner bid cannot exceed this share of cash on hand at the start of the season
  minPartnerBid: 0.2,       // $M
  noDebt: true,             // a plan that needs more cash than the team holds is rejected at lock, not silently trimmed
};

// Design: the first design each season is free, extras cost a fee AND raise unit cost (shorter runs). Brand DNA adds a tile surcharge.
export const DESIGN = {
  maxPerSeason: 4,
  extraFee: [0, 0.1, 0.2, 0.3],                 // $M for the 1st, 2nd, 3rd, 4th design fielded this season
  unitCostMultiplier: [1, 1.05, 1.09, 1.15],  // by number of designs fielded this season
  dnaSurcharge: { free: 0, other: 0.03, costly: 0.12 },   // $M per tile when a new design is created (see brands.js)
};

// Runs: how many garments (thousands) a team makes for one market. Unsold garments are written off (no inventory in v1).
// Unit cost ($ per garment) by run size, before the design multiplier and the foreignness tax.
export const RUNS = {
  sizes: [10, 25, 50, 100],
  unitCost: { 10: 51, 25: 46, 50: 41, 100: 37 },
};

export const PRICES = { value: 70, standard: 95, premium: 120 };    // $ per garment
// Unit cost multiplier by price tier: a premium garment uses better cloth and finishing, a value garment is plainer. Without it the dearest tier always wins.
export const TIER_COST = { value: 0.85, standard: 1.0, premium: 1.6 };

// Buyer pools per market per season (thousands of buyers; one buyer takes one garment). The local incumbent takes its share first by fit.
export const POOLS = { berlin: 270, tokyo: 335, saopaulo: 250, nairobi: 265, cdmx: 260 };
// 10/27 (20-team rooms): pools grow with the room so a team's share stays meaningful. The engine multiplies every pool by poolScale(teams) at game
// creation (rooms of up to POOL_SCALE.baseTeams teams are unchanged, so the 10/23 balance holds for small rooms).
export const POOL_SCALE = { baseTeams: 8, perTeam: 1.07 };   // 12 teams x1.5, 16 x2.1, 20 x2.6 (balance/twenty.mjs, 10/27)
export const poolScale = n => Math.max(1, 1 + POOL_SCALE.perTeam * (n - POOL_SCALE.baseTeams) / POOL_SCALE.baseTeams);

// Share split: each seller's weight = fit ^ fitExponent x market priceFit[tier] x reach(mode). Pool is split by weight, capped by run size.
// The incumbent is one more seller with its fixed fit and price tier, never a leaderboard row.
export const SHARE = {
  fitExponent: 2.1,
  reach: { ship: 0.45, partner: 1, own: 0.7, carried: 0.95 },
};

// Entry modes. Own: set-up cost, and half reach in the first season in that market (ownRampFirstSeason). No lead-time rule in v1.
export const MODES = {
  ship: { setup: 0, feeShare: 0 },
  partner: { setup: 0, feeShare: 0.2 },     // the holder of the partner seat keeps this share of the partner's revenue in that market
  own: { setup: 1.55, feeShare: 0, ownRampFirstSeason: 0.4 },
};

// The foreignness tax table is per market in markets.js. A partner halves it.
export const PARTNER_TAX_CUT = 0.5;

// 10/27: what the team page suggests for a partner bid, as shares of cash on hand. defaultShare fills the bid box when a team picks Local partner;
// wonShare is the range printed as "bids that won a seat in test games" (from the 20-team bot run, GAME_SPEC.md section 10). Teaching hint only.
export const BID_HINT = { defaultShare: 0.05, wonShare: [0.035, 0.07] };   // 300-seed run: winning bids p25 3.5%, median 5.0%, p75 7.0% of cash

// Fog: one more taste row is revealed for each season a team has sold in that market; a partner win reveals one at once;
// a clue card (static, pre-written) reveals one; research (where the market allows it) reveals one for the fee.
export const FOG = { perSeasonSold: 1, partnerReveals: 1, clueCardReveals: 1, researchFee: 0.25, researchPerSeason: 1 };

// Partner seat: one per market per season, sealed bid, highest wins, ties broken by seeded draw. The winner reveals one taste row at once.
// 10/27: a big room gets more seats per market (seatsFor). With 20 teams and five markets that is 10 seats a season, so most teams can win one.
// The top bids win, each winner PAYS its own bid, every losing bid is refunded. The first seat (highest bid) is the one a rival can ask to be carried on.
export const PARTNER = { seatsPerMarket: 1, revealRows: 1, seatsByTeams: [[10, 1], [16, 2], [99, 2]] };
export const seatsFor = n => (PARTNER.seatsByTeams.find(([max]) => n <= max) || [0, PARTNER.seatsPerMarket])[1];

// Team-to-team carry (Steven 10/21): the holder of the partner seat in a market may carry one rival's line there.
// The carried team pays carryFee up front (to the holder) and the holder's partner share applies to the carried revenue too.
// The holder sees the carried design (design cards are private until the projector reveal, so this is the information the fee buys).
export const CARRY = { fee: 1, maxPerHolderPerMarket: 1, holderSeesDesign: true };

// Copy. A team may copy any design it has seen (every design is shown on the projector after the season reveal, and a carried
// design is seen by the holder at once). A copy costs no design fee but is a visible, named act on the projector: "Rank copied Dunn's hoodie".
export const COPY = {
  fee: 0,
  suitFine: 2,        // $M, paid by the copier to the original owner where the market has suitOnCopy (Berlin, Tokyo)
  streetThreshold: 0.25,     // share of the pool at or above which Nairobi's street knocks the design off next season
  streetFitHit: 0.8,         // the original's fit multiplier in that market when knocked off
  copyArrivesNextSeason: false,   // a copy is sold in the same season it is chosen
};

// Duty and payment lag live on the market rule strip (markets.js). Receivable written off at the end of season 4:
export const LATE_PAYMENT_FINAL_HAIRCUT = 0.2;

// Time. Seconds. 75-minute class (GAME_SPEC.md section 4). After the host presses Start every step runs on this clock and the admin page moves the
// game on by itself (pages/clock.js); Pause, +30 s and Skip on the admin page are optional. The host can scale every number below in the lobby.
export const CLOCK = {
  decideSeconds: { 1: 360, 2: 240, 3: 240, 4: 240 },   // season 1 is a minute longer (10/26): the weights and reveal order are public now and there is more to read
  exampleSeconds: [60, 60, 60],   // the worked-example round before season 1 (Steven 10/26): choose, sealed bids, reveal, on made-up brands (config/example.js)
  revealSecondsPerMarket: 48,   // one market on the projector (10/27: five markets x 48 s = the old four x 60 s, so the 43:45 game clock holds)
  recapSeconds: 120,            // recap: own results on the team page and carry offers for next season (90 s was judged too short, audit 10/23)
  finalRecapSeconds: 45,        // recap after the last season (no offers), then the final ranking
  allLockedSeconds: 5,          // once every human team has locked, the decision clock drops to this
  savedPlanRunsAtZero: true,    // a team that has not locked when its clock runs out plays the plan saved on its page if it passes the checks (Parent Trap does
                                // the same); otherwise its last plan stands. false = strict GAME_SPEC rule 1.7: only a locked plan counts.
  speeds: [0.5, 0.75, 1, 1.25, 1.5],
  rulesSeconds: 180,
};

// One prize: highest total profit after four seasons. Total profit = ending cash - start cash (all markets, fees, bids, taxes, setup).
export const SCORE = { metric: 'profit', seasons: SEASONS };

// Clue cards (config/clues.js): each team is dealt this many cards per season, from the rows it cannot see yet, starting in fromSeason.
// The numbers are invented for the bot run (GAME_SPEC names clue cards but gives no deal rule). Set perTeamPerSeason to 0 to switch them off.
export const CLUES = { perTeamPerSeason: 1, fromSeason: 2 };

// House teams (GAME_SPEC.md section 8, PENDING Steven's confirm). Scripted bot teams, same start cash as a human team, HOUSE flag, out of the prize
// ranking, counted in every market split. They never copy, never offer a carry and never accept one, and they see only what fog shows them.
// Every number below is invented for the bot run. bidShare is a share of cash at the start of the season (the engine still applies partnerBidCap).
//   run: garments in thousands per market, price: a tier or 'best' (the tier with the highest price x priceFit shown in the market),
//   fallback: what the plan says to do if the partner bid loses.
export const HOUSE = {
  defaultCount: 2,
  maxCount: 10,       // 10/27: up to ten so a room of ten human teams can reach twenty
  order: ['steady', 'local', 'bold', 'steady', 'local', 'bold', 'local', 'steady', 'bold', 'local'],       // which personality takes house seat 1, 2, 3, ...
  // 10/27: a house bid is bidShare x cash x a factor drawn per team, season and market from bidSpread, so house bids are not one flat number a
  // human bid has to clear. Visible to students as a range in the bid hint (team page).
  bidSpread: [0.5, 1.1],
  personalities: {
    steady: { label: 'Steady', blurb: 'One design everywhere, ships where it can, small bids.',
      mode: 'ship', price: 'standard', run: 50, bidShare: 0, fallback: 'none', designs: 'one',
      why: 'House rule: one design everywhere' },
    local: { label: 'Local', blurb: 'A design for each market, bids for the partner seat in its two best markets.',
      mode: 'partner', price: 'best', run: 50, bidShare: 0.05, fallback: 'ship', designs: 'per-market',
      why: 'House rule: a design per market, bids for the partner seat in the two best' },
    bold: { label: 'Bold', blurb: 'Owns its best market, mid-size bids elsewhere.',
      mode: 'partner', ownMode: 'own', price: 'best', run: 100, ownRun: 100, bidShare: 0.05, fallback: 'ship', designs: 'per-market',
      why: 'House rule: own the best market, mid bids elsewhere' },
  },
  // How the house teams read a revealed weight tier when they score a tile (a house team never sees the true weights).
  tierWeight: { High: 0.40, Medium: 0.22, Low: 0.08 },
};
