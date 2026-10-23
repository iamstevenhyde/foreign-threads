// Shared bits for the three Foreign Threads pages: tile labels, art paths, small renderers.
import { h } from './util.js';
import { ROWS, ROW_LABEL, TILES, tileLabel, PALETTES } from '../config/tiles.js';
import { MARKETS, MARKET_IDS } from '../config/markets.js';
import { BRAND_BY_ID, BRANDS, dnaState } from '../config/brands.js';

export { ROWS, ROW_LABEL, TILES, tileLabel, MARKETS, MARKET_IDS, BRAND_BY_ID, BRANDS, dnaState };

export const GAME_TITLE = 'Foreign Threads';
export const art = p => '../art/' + p;
export const garmentSrc = (cut, palette) => art('garments/wk10_cut-' + cut + '_pal-' + palette + '.png');
export const streetSrc = m => art('wk10_street_' + m + '.png');
export const tilesText = t => ROWS.map(r => tileLabel(r, t[r])).join(', ');
export const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2) + 'M';
export const money1 = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(1) + 'M';
export const pctf = x => Math.round(x * 100) + '%';

export function garmentImg(t, cls = 'garment') {
  return h('img.' + cls, { src: garmentSrc(t.cut, t.palette), alt: tilesText(t), loading: 'lazy', onerror: ev => { ev.target.style.visibility = 'hidden'; } });
}
export function swatch(palette) {
  const p = PALETTES.find(x => x.id === palette) || PALETTES[0];
  return h('span', { style: 'display:inline-block;width:14px;height:14px;border:1px solid #000;vertical-align:-2px;margin-right:4px;background:' + p.main });
}
export function tag(team) {
  return [team.house ? h('span.chip.house', 'HOUSE') : null, team.bot ? h('span.chip.bot', 'BOT') : null];
}
export function dnaChips(brandId) {
  const b = BRAND_BY_ID[brandId];
  return [...b.free.map(f => h('span.chip.free', ROW_LABEL[f.row] + ': ' + tileLabel(f.row, f.tile))),
    h('span.chip.costly', 'Costly: ' + ROW_LABEL[b.costly.row] + ': ' + tileLabel(b.costly.row, b.costly.tile))];
}
export const MODE_LABEL = { ship: 'Ship', partner: 'Partner', own: 'Own shop', carried: 'Carried by the partner', none: 'Not selling' };
export const PRICE_LABEL = { value: 'Value', standard: 'Standard', premium: 'Premium' };
export const marketName = m => MARKETS[m].name;
// An event card's image, when it has one.
export const eventArt = ev => (ev && ev.art ? art(ev.art) : null);
