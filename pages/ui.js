// Shared bits for the three Foreign Threads pages: tile labels, art paths, small renderers.
// Garments are drawn in code (garment.js). The 20 garment photos stay in art/garments for a later return but no page loads them.
// Scene and event art is served as compressed WebP from art/web (see art/web/README.txt); the PNG originals stay where they were.
import { h } from './util.js';
import { ROWS, ROW_LABEL, TILES, tileLabel, PALETTES } from '../config/tiles.js';
import { MARKETS, MARKET_IDS } from '../config/markets.js';
import { BRAND_BY_ID, BRANDS, dnaState } from '../config/brands.js';
import { garmentSVG, markSVG, cleanStyle, cleanLook } from './garment.js';

export { ROWS, ROW_LABEL, TILES, tileLabel, MARKETS, MARKET_IDS, BRAND_BY_ID, BRANDS, dnaState };

export const GAME_TITLE = 'Foreign Threads';
export const art = p => '../art/' + p;
// The old photo path, kept so photos can come back later (not called by any page in this build).
export const garmentSrc = (cut, palette) => art('garments/wk10_cut-' + cut + '_pal-' + palette + '.png');
const webp = p => art('web/' + p.replace(/^extras\//, '').replace(/\.png$/i, '.webp'));
export const streetSrc = m => webp('wk10_street_' + m + '.png');
export const thumbSrc = m => art('web/thumb_street_' + m + '.webp');
export const lobbySrc = () => webp('wk10_lobby.png');
export const tilesText = t => ROWS.map(r => tileLabel(r, t[r])).join(', ');
export const tilesCaps = t => ROWS.map(r => tileLabel(r, t[r])).join(' / ').toUpperCase();
export const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2) + 'M';
export const money1 = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(1) + 'M';
export const pctf = x => Math.round(x * 100) + '%';

// A garment as a DOM node. style = {mark, colour}; brandName for the wordmark.
export function garmentEl(tiles, look, style, brandName, opts = {}) {
  return h('span.g' + (opts.wrap ? '.' + opts.wrap : ''), { html: garmentSVG(tiles, look, style, brandName, opts) });
}
export function markEl(style, size = 24, title = '') {
  return h('span.mk', { html: markSVG(style.mark, style.colour, size, title) });
}
export { cleanStyle, cleanLook };
export function swatch(palette) {
  const p = PALETTES.find(x => x.id === palette) || PALETTES[0];
  return h('span.swatch', { style: 'background:' + p.main });
}
export function tag(team) {
  return [team.house ? h('span.tagx.house', 'HOUSE') : null, team.bot ? h('span.tagx.bot', 'BOT') : null];
}
export function dnaChips(brandId) {
  const b = BRAND_BY_ID[brandId];
  return [...b.free.map(f => h('span.chip.free', ROW_LABEL[f.row] + ': ' + tileLabel(f.row, f.tile))),
    h('span.chip.costly', 'Off-brand: ' + ROW_LABEL[b.costly.row] + ': ' + tileLabel(b.costly.row, b.costly.tile))];
}
export const MODE_LABEL = { ship: 'Ship in', partner: 'Local partner', own: 'Own shop', carried: 'Carried by the partner', none: 'Not selling' };
export const PRICE_LABEL = { value: 'Value', standard: 'Standard', premium: 'Premium' };
export const marketName = m => MARKETS[m].name;
// An event card's image, when it has one (compressed copy in art/web).
export const eventArt = ev => (ev && ev.art ? webp(ev.art) : null);
// A lazy image that hides itself if the file is missing.
export const lazyImg = (src, cls = '', alt = '') => h('img' + (cls ? '.' + cls : ''), { src, alt, loading: 'lazy', decoding: 'async', onerror: ev => { ev.target.style.visibility = 'hidden'; } });
