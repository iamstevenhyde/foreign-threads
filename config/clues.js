// Buyer clue cards: static, pre-written, one per (market, taste row). Dealt per CLUES in rules.js. A clue reveals that row's taste tile and weight
// tier to the team that holds it (the same as any other fog reveal). Every line is DRAFT text, plain and factual, to be edited later.
// The tile named in each line is the market's true taste (config/markets.js); config/validate.mjs checks that the line names it.
export const CLUE_CARDS = [
  { id: 'CL-BER-CUT', market: 'berlin', row: 'cut', text: 'Berlin shoppers choose the technical shell cut.', draft: true },
  { id: 'CL-BER-PAL', market: 'berlin', row: 'palette', text: 'Berlin shoppers choose black.', draft: true },
  { id: 'CL-BER-LOG', market: 'berlin', row: 'logo', text: 'Berlin shoppers choose garments with no logo.', draft: true },
  { id: 'CL-BER-FAB', market: 'berlin', row: 'fabric', text: 'Berlin shoppers choose recycled fabric.', draft: true },
  { id: 'CL-TOK-CUT', market: 'tokyo', row: 'cut', text: 'Tokyo shoppers choose the denim jacket cut.', draft: true },
  { id: 'CL-TOK-PAL', market: 'tokyo', row: 'palette', text: 'Tokyo shoppers choose earth colours.', draft: true },
  { id: 'CL-TOK-LOG', market: 'tokyo', row: 'logo', text: 'Tokyo shoppers choose a small logo.', draft: true },
  { id: 'CL-TOK-FAB', market: 'tokyo', row: 'fabric', text: 'Tokyo shoppers choose light fabric.', draft: true },
  { id: 'CL-SAO-CUT', market: 'saopaulo', row: 'cut', text: 'Sao Paulo shoppers choose the resort shirt cut.', draft: true },
  { id: 'CL-SAO-PAL', market: 'saopaulo', row: 'palette', text: 'Sao Paulo shoppers choose bright colours.', draft: true },
  { id: 'CL-SAO-LOG', market: 'saopaulo', row: 'logo', text: 'Sao Paulo shoppers choose an all-over print.', draft: true },
  { id: 'CL-SAO-FAB', market: 'saopaulo', row: 'fabric', text: 'Sao Paulo shoppers choose light fabric.', draft: true },
  { id: 'CL-NAI-CUT', market: 'nairobi', row: 'cut', text: 'Nairobi shoppers choose the hoodie cut.', draft: true },
  { id: 'CL-NAI-PAL', market: 'nairobi', row: 'palette', text: 'Nairobi shoppers choose pastel colours.', draft: true },
  { id: 'CL-NAI-LOG', market: 'nairobi', row: 'logo', text: 'Nairobi shoppers choose a big logo.', draft: true },
  { id: 'CL-NAI-FAB', market: 'nairobi', row: 'fabric', text: 'Nairobi shoppers choose heavy fabric.', draft: true },
];

export const clueFor = (market, row) => CLUE_CARDS.find(c => c.market === market && c.row === row) || null;
