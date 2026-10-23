// The twelve Apparel Innovation Brands (AI Corp) brands, one per team.
// SOURCE for the names: C:/Users/User/Desktop/Classes/Martin Gale/boisestate_ai_upload/SHARED_AI_Corp_Facts.md, section "The twelve brands".
// That file supports only these facts, so only these are recorded as facts: the twelve names, Dunn is the largest and oldest,
// Rank is the most recent addition (acquired 2020), CEO Bob Buckwalter.
// EVERYTHING in free/costly below is GAME DESIGN (source: 'game design'). It says nothing about what these brands really sell.
//
// DNA: two tiles that are free to use (on-brand) and one costly tile (off-brand: the surcharge in rules.js dnaSurcharge.costly).
// Any other tile costs the small standard surcharge. Surcharge is charged once per design per season (see rules.js).
// Fable's review (R3) gave the starting DNA for Dunn, Rank, Baxter Trails, BlackPeak and Ritz Running; the other seven are my fill-ins.
// Interpretation of "free vs costly" follows Fable R3; flagged as an open question in BUILD_STATUS.md.

export const CEO = 'Bob Buckwalter';

const t = (row, tile) => ({ row, tile });

export const BRANDS = [
  { id: 'dunn', name: 'Dunn', fact: 'Largest and oldest of the twelve (SHARED_AI_Corp_Facts.md).', free: [t('logo', 'big'), t('fabric', 'heavy')], costly: t('palette', 'pastel'), source: 'game design' },
  { id: 'rank', name: 'Rank', fact: 'Most recent addition, acquired in 2020 (SHARED_AI_Corp_Facts.md).', free: [t('logo', 'allover'), t('palette', 'bright')], costly: t('cut', 'shell'), source: 'game design' },
  { id: 'baxter', name: 'Baxter Trails', fact: '', free: [t('cut', 'shell'), t('palette', 'earth')], costly: t('logo', 'allover'), source: 'game design' },
  { id: 'blackpeak', name: 'BlackPeak Outfitters', fact: '', free: [t('cut', 'puffer'), t('fabric', 'heavy')], costly: t('palette', 'pastel'), source: 'game design' },
  { id: 'ritz', name: 'Ritz Running', fact: '', free: [t('fabric', 'performance'), t('palette', 'bright')], costly: t('cut', 'denim'), source: 'game design' },
  { id: 'cruzwear', name: 'Cruzwear', fact: '', free: [t('cut', 'resort'), t('fabric', 'light')], costly: t('logo', 'none'), source: 'game design' },
  { id: 'ratfang', name: 'RatFang', fact: '', free: [t('cut', 'hoodie'), t('palette', 'black')], costly: t('fabric', 'recycled'), source: 'game design' },
  { id: 'murphies', name: 'Murphies', fact: '', free: [t('cut', 'denim'), t('palette', 'earth')], costly: t('logo', 'allover'), source: 'game design' },
  { id: 'newport', name: 'New Port', fact: '', free: [t('cut', 'resort'), t('palette', 'pastel')], costly: t('fabric', 'performance'), source: 'game design' },
  { id: 'kroes', name: 'Kroes & Ribas', fact: '', free: [t('palette', 'black'), t('logo', 'none')], costly: t('cut', 'hoodie'), source: 'game design' },
  { id: 'boodraj', name: 'Boodraj Bags', fact: '', free: [t('fabric', 'recycled'), t('logo', 'small')], costly: t('palette', 'bright'), source: 'game design' },
  { id: 'ritters', name: "Ritter's Rags", fact: '', free: [t('cut', 'hoodie'), t('fabric', 'light')], costly: t('logo', 'big'), source: 'game design' },
];

export const BRAND_BY_ID = Object.fromEntries(BRANDS.map(b => [b.id, b]));

// 'free' | 'costly' | 'other' for one tile of one brand.
export function dnaState(brandId, row, tile) {
  const b = BRAND_BY_ID[brandId];
  if (!b) return 'other';
  if (b.free.some(x => x.row === row && x.tile === tile)) return 'free';
  if (b.costly.row === row && b.costly.tile === tile) return 'costly';
  return 'other';
}
