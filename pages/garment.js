// Garments drawn in code (SVG strings), brand marks, and the cosmetic "look" of a piece. No image files are loaded.
//
// What buyers score is the four tiles only (config/tiles.js): cut, palette (colour), logo (placement) and fabric. They decide the silhouette, the
// main colour story, where the logo sits and the cloth texture. Everything else here is COSMETIC and never reaches the engine's fit or price maths:
//   look.name     the piece name the team types ("Earth Hoodie")
//   look.trim     trim colour: rib bands, drawcords, zips, buttons, stitching
//   look.pattern  solid | stripe | block (colour-block) | check, always drawn in the palette's own two colours, so the scored colour still reads
//   look.art      what the logo artwork is: the brand mark, the wordmark or both, drawn at the placement the Logo tile chose (none = nothing)
//   style         per team, not per piece: brand mark + brand colour, shown on every piece (logo artwork, neck label, hem tag) and on the projector.
// No "all-over print" pattern is offered here because All-over print is a scored Logo tile; a cosmetic copy of it would let a garment look like a
// choice the engine does not count. Likewise no artwork "none": No logo is a scored tile.
// Pure string building; safe to import in Node (the host's tests import host.js, which imports this file).

import { PALETTES, TILES, tileLabel } from '../config/tiles.js';

// ---------- cosmetic option sets ----------
export const TRIMS = [
  { id: 'accent', label: 'Palette accent', hex: null },
  { id: 'cream', label: 'Cream', hex: '#efe6d2' },
  { id: 'ink', label: 'Ink', hex: '#1b1a17' },
  { id: 'stone', label: 'Stone', hex: '#9b968a' },
  { id: 'cobalt', label: 'Cobalt', hex: '#2448d8' },
  { id: 'red', label: 'Signal red', hex: '#cc2f27' },
  { id: 'sun', label: 'Sun', hex: '#f0bf2c' },
  { id: 'forest', label: 'Forest', hex: '#2f5d3a' },
  { id: 'orange', label: 'Orange', hex: '#e2742c' },
  { id: 'pink', label: 'Pink', hex: '#e58cb0' },
];
export const PATTERNS = [
  { id: 'solid', label: 'Solid' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'block', label: 'Colour-block' },
  { id: 'check', label: 'Check' },
];
export const ARTWORK = [
  { id: 'mark', label: 'Brand mark' },
  { id: 'word', label: 'Wordmark' },
  { id: 'both', label: 'Mark + word' },
];
export const MARKS = [
  { id: 'peak', label: 'Peak' }, { id: 'wave', label: 'Wave' }, { id: 'slash', label: 'Slash' }, { id: 'disc', label: 'Disc' },
  { id: 'sun', label: 'Sunrise' }, { id: 'shield', label: 'Shield' }, { id: 'bolt', label: 'Bolt' }, { id: 'ring', label: 'Ring' },
  { id: 'pixel', label: 'Pixel' }, { id: 'block', label: 'Block' }, { id: 'arch', label: 'Arch' }, { id: 'star', label: 'Star' },
];
export const BRAND_COLOURS = [
  { id: 'ink', hex: '#1b1a17' }, { id: 'red', hex: '#d02b26' }, { id: 'orange', hex: '#e2591f' }, { id: 'mustard', hex: '#d39a17' },
  { id: 'forest', hex: '#1f6b4f' }, { id: 'teal', hex: '#13808a' }, { id: 'navy', hex: '#23355f' }, { id: 'violet', hex: '#5b3aa8' },
  { id: 'plum', hex: '#7a2c5e' }, { id: 'pink', hex: '#d94f86' }, { id: 'rust', hex: '#a8512a' }, { id: 'tan', hex: '#a8793f' },
];
// Default mark and colour per brand. Colours follow art/brands/BRANDS.md where the source logo has one, nudged apart so no two brands in a room
// share a colour; Rank has no logo in the source, so it takes the red slashes from Steven's mockup.
export const DEFAULT_STYLE = {
  dunn: { mark: 'block', colour: '#1b1a17' }, rank: { mark: 'slash', colour: '#d02b26' }, baxter: { mark: 'disc', colour: '#e2591f' },
  blackpeak: { mark: 'peak', colour: '#23355f' }, ritz: { mark: 'bolt', colour: '#1f6b4f' }, cruzwear: { mark: 'arch', colour: '#a8512a' },
  ratfang: { mark: 'star', colour: '#7a2c5e' }, murphies: { mark: 'shield', colour: '#a8793f' }, newport: { mark: 'wave', colour: '#13808a' },
  kroes: { mark: 'ring', colour: '#5b3aa8' }, boodraj: { mark: 'sun', colour: '#d39a17' }, ritters: { mark: 'pixel', colour: '#d94f86' },
};
const HEX = /^#[0-9a-f]{6}$/i;
export function cleanStyle(st, brandId) {
  const d = DEFAULT_STYLE[brandId] || { mark: 'peak', colour: '#1b1a17' };
  if (!st || typeof st !== 'object') return { ...d };
  return { mark: MARKS.some(m => m.id === st.mark) ? st.mark : d.mark, colour: HEX.test(st.colour || '') ? st.colour : d.colour };
}

const CUT_SHORT = { puffer: 'Puffer', shell: 'Shell', hoodie: 'Hoodie', resort: 'Resort Shirt', denim: 'Denim Jacket' };
export const defaultName = t => (t && t.palette ? tileLabel('palette', t.palette) + ' ' : '') + (CUT_SHORT[t && t.cut] || 'Piece');
export function cleanLook(lk, tiles) {
  const o = lk && typeof lk === 'object' ? lk : {};
  const name = String(o.name || '').replace(/[<>]/g, '').trim().slice(0, 24);
  return {
    name: name || defaultName(tiles),
    trim: TRIMS.some(t => t.id === o.trim) ? o.trim : 'accent',
    pattern: PATTERNS.some(p => p.id === o.pattern) ? o.pattern : 'solid',
    art: ARTWORK.some(a => a.id === o.art) ? o.art : 'mark',
  };
}

// ---------- colour helpers ----------
const rgb = hx => [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = hx => { const c = rgb(hx).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const isDark = hx => lum(hx) < 0.18;
const readableOn = (want, bg) => (contrast(want, bg) >= 1.9 ? want : isDark(bg) ? '#f6f1e6' : '#1b1a17');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------- brand marks: 40 x 40 boxes ----------
function markBody(mark, c, bg = '#ffffff') {
  switch (mark) {
    case 'peak': return `<path d="M1 35 L14 11 L21 23 L27 15 L39 35 Z" fill="${c}"/><path d="M14 11 L18 18 L14 21 L10 18 Z" fill="${bg}" opacity=".9"/>`;
    case 'wave': return `<circle cx="20" cy="20" r="18" fill="${c}"/><path d="M5 15 Q12 10 19 15 T33 15 M4 22 Q11 17 18 22 T32 22 T38 22 M6 29 Q13 24 20 29 T34 29" stroke="${bg}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'slash': return `<path d="M2 36 L16 4 L24 4 L10 36 Z M14 36 L28 4 L36 4 L22 36 Z" fill="${c}"/>`;
    case 'disc': return `<circle cx="20" cy="20" r="18" fill="${c}"/><path d="M9 26 L31 12" stroke="${bg}" stroke-width="4.5" stroke-linecap="round"/>`;
    case 'sun': return `<path d="M5 22 A15 15 0 0 1 35 22 Z" fill="${c}"/><path d="M3 30 L20 25 L37 30 M3 37 L20 32 L37 37" stroke="${c}" stroke-width="3.5" fill="none"/>`;
    case 'shield': return `<path d="M20 2 L36 8 L34 23 Q31 33 20 38 Q9 33 6 23 L4 8 Z" fill="${c}"/><path d="M20 9 L20 31 M12 17 L28 17" stroke="${bg}" stroke-width="3.2"/>`;
    case 'bolt': return `<path d="M24 1 L7 23 L18 23 L14 39 L33 14 L22 14 Z" fill="${c}"/>`;
    case 'ring': return `<circle cx="20" cy="20" r="14" fill="none" stroke="${c}" stroke-width="6"/><rect x="2" y="17" width="36" height="6" fill="${c}"/>`;
    case 'pixel': return [[0, 0], [2, 0], [1, 1], [3, 1], [0, 2], [2, 2], [1, 3], [3, 3]].map(([x, y]) => `<rect x="${2 + x * 9}" y="${2 + y * 9}" width="9" height="9" fill="${c}"/>`).join('');
    case 'block': return `<rect x="2" y="9" width="36" height="22" fill="${c}"/><rect x="9" y="15" width="10" height="10" fill="${bg}"/>`;
    case 'arch': return `<path d="M5 37 L5 20 A15 15 0 0 1 35 20 L35 37 L26 37 L26 21 A6 6 0 0 0 14 21 L14 37 Z" fill="${c}"/>`;
    case 'star': return `<path d="M20 1 L24 15 L39 15 L27 24 L31 39 L20 30 L9 39 L13 24 L1 15 L16 15 Z" fill="${c}"/>`;
    default: return `<circle cx="20" cy="20" r="16" fill="${c}"/>`;
  }
}
// A brand mark on its own (headers, cards, projector). size in px.
export function markSVG(mark, colour, size = 28, title = '') {
  return `<svg class="mark" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-label="${esc(title || 'brand mark')}">${markBody(mark, colour)}</svg>`;
}

// ---------- garments ----------
// viewBox 0 0 200 230, the wearer facing us. Left-hand parts are written once and mirrored (only M, L, C, Q commands, so x flips cleanly).
const mirror = d => d.replace(/([MLCQ])([^MLCQZ]*)/g, (m, cmd, args) => cmd + args.trim().split(/[\s,]+/).map((v, i) => (i % 2 === 0 ? String(200 - parseFloat(v)) : v)).join(' ') + ' ');
const both = d => [d, mirror(d)];

// Each cut: sil (silhouette parts, filled with the main colour, in drawing order), details by kind, and where the logo sits.
const CUTS = {
  hoodie: {
    sil: [...both('M58 50 C42 54 34 66 30 92 L18 168 L38 172 L50 106 L52 70 Z'), 'M58 50 Q78 42 88 46 Q100 56 112 46 Q122 42 142 50 L148 70 L150 186 Q100 192 50 186 L52 70 Z',
      'M74 50 C66 22 82 8 100 8 C118 8 134 22 126 50 Q114 60 100 60 Q86 60 74 50 Z'],
    back: [...both('M58 50 C42 54 34 66 30 92 L18 168 L38 172 L50 106 L52 70 Z'), 'M58 50 Q100 40 142 50 L148 70 L150 186 Q100 192 50 186 L52 70 Z',
      'M70 48 Q100 38 130 48 C134 72 124 94 100 98 C76 94 66 72 70 48 Z'],
    bands: [...both('M18 166 L38 170 L36 182 L16 178 Z'), 'M50 184 Q100 190 150 184 L150 198 Q100 204 50 198 Z'],
    bandsBack: [...both('M18 166 L38 170 L36 182 L16 178 Z'), 'M50 184 Q100 190 150 184 L150 198 Q100 204 50 198 Z'],
    inner: 'M86 48 C82 28 92 18 100 18 C108 18 118 28 114 48 Q100 54 86 48 Z',
    seams: ['M68 134 L132 134 L140 172 L60 172 Z', 'M70 136 Q66 152 62 166', 'M130 136 Q134 152 138 166'],
    seamsBack: ['M72 60 Q100 70 128 60'],
    trimLines: ['M92 54 L90 90', 'M108 54 L110 90'],
    trimDots: [[90, 92], [110, 92]],
    shade: ['M128 58 L148 70 L150 186 Q140 189 130 189 Z', 'M38 110 L50 106 L38 172 L30 170 Z'],
    big: [100, 100], small: [128, 84], neck: [100, 66],
  },
  puffer: {
    sil: [...both('M60 44 C34 46 24 64 20 94 L8 170 L40 178 L48 110 L46 70 Z'), 'M60 44 Q100 54 140 44 Q156 54 157 76 L157 184 Q156 200 100 203 Q44 200 43 184 L43 76 Q44 54 60 44 Z', 'M78 24 L122 24 L127 50 Q100 58 73 50 Z'],
    back: [...both('M60 44 C34 46 24 64 20 94 L8 170 L40 178 L48 110 L46 70 Z'), 'M60 44 Q100 54 140 44 Q156 54 157 76 L157 184 Q156 200 100 203 Q44 200 43 184 L43 76 Q44 54 60 44 Z', 'M78 28 L122 28 L125 50 Q100 56 75 50 Z'],
    bands: [...both('M8 168 L40 176 L38 188 L6 180 Z')],
    bandsBack: [...both('M8 168 L40 176 L38 188 L6 180 Z')],
    inner: 'M80 30 L120 30 L121 36 Q100 40 79 36 Z',
    quilt: ['M43 76 Q100 84 157 76', 'M43 100 Q100 108 157 100', 'M43 124 Q100 132 157 124', 'M43 148 Q100 156 157 148', 'M43 172 Q100 180 157 172',
      ...both('M18 102 L47 106'), ...both('M14 128 L47 132'), ...both('M10 154 L44 158')],
    trimLines: ['M100 30 L100 198'],
    trimDots: [[100, 34]],
    shade: ['M134 50 Q154 58 157 76 L157 184 Q154 198 138 201 Z'],
    big: [100, 92], small: [128, 84], neck: [100, 54],
  },
  shell: {
    sil: [...both('M60 50 C44 54 36 66 32 92 L22 182 L42 186 L52 106 L52 70 Z'), 'M60 50 Q100 60 140 50 L148 70 L150 204 Q100 214 50 204 L52 70 Z',
      'M72 50 C64 18 82 4 100 4 C118 4 136 18 128 50 Q100 62 72 50 Z'],
    back: [...both('M60 50 C44 54 36 66 32 92 L22 182 L42 186 L52 106 L52 70 Z'), 'M60 50 Q100 60 140 50 L148 70 L150 206 Q100 216 50 206 L52 70 Z',
      'M68 48 Q100 36 132 48 C136 70 126 90 100 94 C74 90 64 70 68 48 Z'],
    bands: [...both('M22 176 L42 180 L41 187 L21 183 Z')],
    bandsBack: [...both('M22 176 L42 180 L41 187 L21 183 Z')],
    inner: 'M84 46 C80 24 92 14 100 14 C108 14 120 24 116 46 Q100 52 84 46 Z',
    seams: ['M96 54 L96 208', 'M104 54 L104 208', 'M52 74 Q74 82 94 80', 'M148 74 Q126 82 106 80', 'M58 152 L84 148', 'M142 152 L116 148'],
    seamsBack: ['M52 76 Q100 88 148 76', 'M86 186 L86 206 M114 186 L114 206'],
    trimLines: ['M100 54 L100 206', 'M62 92 L86 85', 'M84 20 Q100 10 116 20'],
    trimDots: [[58, 201], [142, 201]],
    shade: ['M130 58 L148 70 L150 204 Q142 207 134 208 Z'],
    big: [100, 104], small: [128, 96], neck: [100, 66],
  },
  resort: {
    sil: [...both('M62 48 C46 52 36 62 30 86 L48 100 L54 84 L54 66 Z'), 'M62 48 Q78 44 86 46 L100 76 L114 46 Q122 44 138 48 L146 66 L148 192 L52 192 L54 66 Z',
      ...both('M86 44 L100 76 L84 72 L70 52 Q76 46 86 44 Z')],
    back: [...both('M62 48 C46 52 36 62 30 86 L48 100 L54 84 L54 66 Z'), 'M62 48 Q100 40 138 48 L146 66 L148 192 L52 192 L54 66 Z', 'M84 42 Q100 48 116 42 L114 52 Q100 56 86 52 Z'],
    bands: [],
    bandsBack: [],
    inner: 'M86 46 L100 76 L114 46 Q100 52 86 46 Z',
    seams: ['M100 76 L100 192', 'M62 94 L84 94 L84 116 L62 116 Z', 'M30 86 L48 100', 'M170 86 L152 100'],
    seamsBack: ['M56 70 Q100 78 144 70', 'M30 86 L48 100', 'M170 86 L152 100'],
    trimLines: ['M86 44 L100 76 M114 44 L100 76', 'M62 94 L84 94'],
    trimDots: [[100, 96], [100, 118], [100, 140], [100, 162], [100, 184]],
    shade: ['M128 52 L146 66 L148 192 L134 192 Z'],
    big: [100, 118], small: [126, 104], neck: [100, 58],
  },
  denim: {
    sil: [...both('M60 48 C44 52 34 64 30 92 L20 172 L42 176 L52 106 L52 68 Z'), 'M60 48 Q80 42 86 44 L100 62 L114 44 Q120 42 140 48 L148 68 L148 172 L52 172 L52 68 Z',
      ...both('M84 42 L100 62 L80 70 L68 50 Z')],
    back: [...both('M60 48 C44 52 34 64 30 92 L20 172 L42 176 L52 106 L52 68 Z'), 'M60 48 Q100 40 140 48 L148 68 L148 172 L52 172 L52 68 Z', 'M82 42 Q100 48 118 42 L116 50 Q100 54 84 50 Z'],
    bands: [...both('M20 166 L42 170 L41 182 L19 178 Z'), 'M52 170 L148 170 L148 186 L52 186 Z'],
    bandsBack: [...both('M20 166 L42 170 L41 182 L19 178 Z'), 'M52 170 L148 170 L148 186 L52 186 Z'],
    inner: 'M86 44 L100 62 L114 44 Q100 48 86 44 Z',
    seams: ['M100 62 L100 186', 'M62 84 L90 84 L90 94 L76 100 L62 94 Z', 'M138 84 L110 84 L110 94 L124 100 L138 94 Z', 'M62 94 L62 116 L90 116 L90 94', 'M138 94 L138 116 L110 116 L110 94',
      'M52 76 Q74 72 96 78', 'M148 76 Q126 72 104 78', 'M74 104 L72 170', 'M126 104 L128 170'],
    seamsBack: ['M52 78 L100 92 L148 78', 'M76 92 L74 170', 'M124 92 L126 170'],
    stitch: ['M54 79 Q74 75 96 81', 'M146 79 Q126 75 104 81', 'M97 64 L97 184', 'M54 173 L146 173', 'M54 183 L146 183'],
    stitchBack: ['M54 81 L100 95 L146 81', 'M54 173 L146 173', 'M54 183 L146 183'],
    trimDots: [[100, 80], [100, 104], [100, 128], [100, 152], [100, 178], [76, 92], [124, 92]],
    shade: ['M130 52 L148 68 L148 186 L134 186 Z'],
    big: [100, 130], small: [124, 132], neck: [100, 56],
  },
};

let N = 0;   // unique ids for defs inside one document

function fabricDef(id, fabric, main) {
  const dark = isDark(main);
  const ink = dark ? '#ffffff' : '#000000';
  switch (fabric) {
    case 'heavy': return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="6" fill="${ink}" opacity="${dark ? 0.12 : 0.16}"/></pattern>`;
    case 'light': return `<pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 .5 L5 .5 M.5 0 L.5 5" stroke="${dark ? '#ffffff' : '#ffffff'}" stroke-width=".9" opacity="${dark ? 0.16 : 0.34}"/></pattern>`;
    case 'performance': return `<pattern id="${id}" width="8" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.25" fill="${ink}" opacity="${dark ? 0.22 : 0.2}"/><circle cx="6" cy="5.5" r="1.25" fill="${ink}" opacity="${dark ? 0.22 : 0.2}"/></pattern>`;
    case 'recycled': return `<pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M2 3 L5 4 M9 2 L11 5 M13 9 L15 8 M4 11 L7 12 M10 13 L12 15" stroke="#ffffff" stroke-width="1.3" opacity=".55"/><path d="M6 7 L8 6 M1 14 L3 15 M13 2 L14 4" stroke="#000000" stroke-width="1.3" opacity=".35"/></pattern>`;
    default: return '';
  }
}
function patternDef(id, pattern, accent) {
  if (pattern === 'stripe') return `<pattern id="${id}" width="200" height="18" patternUnits="userSpaceOnUse"><rect y="10" width="200" height="7" fill="${accent}"/></pattern>`;
  if (pattern === 'check') return `<pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse"><rect x="0" width="6" height="16" fill="${accent}" opacity=".55"/><rect y="0" width="16" height="6" fill="${accent}" opacity=".55"/></pattern>`;
  return '';
}
function logoArt(art, style, name, colour, size) {
  // centred on 0,0; size = width of the artwork box
  const m = style.mark;
  if (art === 'word') {
    const fs = size * 0.36, w = Math.min(size * 1.25, Math.max(size * 0.6, name.length * fs * 0.52));
    return `<text x="0" y="${fs * 0.36}" text-anchor="middle" font-family="Anton, Impact, 'Arial Narrow', sans-serif" font-size="${fs}" fill="${colour}" textLength="${w}" lengthAdjust="spacingAndGlyphs">${esc(name.toUpperCase())}</text>`;
  }
  if (art === 'both') {
    const ms = size * 0.62, fs = size * 0.24, w = Math.min(size * 1.25, Math.max(size * 0.5, name.length * fs * 0.52));
    return `<g transform="translate(${-ms / 2} ${-ms * 0.78}) scale(${ms / 40})">${markBody(m, colour, 'none')}</g>` +
      `<text x="0" y="${fs * 1.25}" text-anchor="middle" font-family="Anton, Impact, 'Arial Narrow', sans-serif" font-size="${fs}" fill="${colour}" textLength="${w}" lengthAdjust="spacingAndGlyphs">${esc(name.toUpperCase())}</text>`;
  }
  return `<g transform="translate(${-size / 2} ${-size / 2}) scale(${size / 40})">${markBody(m, colour, 'none')}</g>`;
}

// tiles: {cut, palette, logo, fabric}; look: cleanLook output (or null for defaults); style: {mark, colour}; brandName for the wordmark.
// opts: back (draw the back), sketch (outline icon: no colour, no texture), noLogo (for silhouette icons), cls, title.
export function garmentSVG(tiles, look, style, brandName = '', opts = {}) {
  const cut = CUTS[tiles && tiles.cut] || CUTS.hoodie;
  const pal = PALETTES.find(p => p.id === (tiles && tiles.palette)) || PALETTES[0];
  const lk = cleanLook(look, tiles);
  const st = style || { mark: 'peak', colour: '#1b1a17' };
  const id = 'g' + (++N);
  const back = !!opts.back, sketch = !!opts.sketch;
  const main = sketch ? '#f7f3ea' : pal.main, accent = sketch ? '#f7f3ea' : pal.accent;
  const dark = isDark(main);
  const outline = sketch ? '#1b1a17' : dark ? '#000000' : mix(main, '#000000', 0.55);
  const seam = sketch ? '#1b1a17' : dark ? mix(main, '#ffffff', 0.22) : mix(main, '#000000', 0.32);
  const trimHex = sketch ? '#1b1a17' : lk.trim === 'accent' ? (contrast(pal.accent, main) > 1.25 ? pal.accent : mix(main, dark ? '#ffffff' : '#000000', 0.35)) : TRIMS.find(t => t.id === lk.trim).hex;
  const bandFill = sketch ? '#f7f3ea' : lk.trim === 'accent' ? mix(main, '#000000', dark ? 0.0 : 0.12) : trimHex;
  const sil = back ? cut.back : cut.sil;
  const bands = back ? cut.bandsBack : cut.bands;
  const sw = sketch ? 2.4 : 1.6;
  const defs = [];
  const clip = `<clipPath id="${id}c">${sil.map(d => `<path d="${d}"/>`).join('')}${bands.map(d => `<path d="${d}"/>`).join('')}</clipPath>`;
  defs.push(clip);
  let over = '';
  if (!sketch) {
    if (lk.pattern === 'stripe' || lk.pattern === 'check') { defs.push(patternDef(id + 'p', lk.pattern, accent)); over += `<rect width="200" height="230" fill="url(#${id}p)"/>`; }
    if (lk.pattern === 'block') over += `<rect y="${back ? 128 : 132}" width="200" height="110" fill="${accent}"/>`;
    const logoCol = readableOn(st.colour, main);
    if (tiles.logo === 'allover') {
      defs.push(`<pattern id="${id}l" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)"><g transform="translate(5 5) scale(.36)">${markBody(st.mark, logoCol, main)}</g></pattern>`);
      over += `<rect width="200" height="230" fill="url(#${id}l)" opacity=".9"/>`;
    }
    const fd = fabricDef(id + 'f', tiles.fabric, main);
    if (fd) { defs.push(fd); over += `<rect width="200" height="230" fill="url(#${id}f)"/>`; }
    over += (cut.shade || []).map(d => `<path d="${d}" fill="#000" opacity="${dark ? 0.22 : 0.09}"/>`).join('');
  }
  const P = [];
  P.push(`<ellipse cx="100" cy="222" rx="66" ry="4.5" fill="#000" opacity="${sketch ? 0 : 0.08}"/>`);
  // silhouette fill, then everything clipped to it, then outlines on top
  P.push(sil.map(d => `<path d="${d}" fill="${main}"/>`).join(''));
  P.push(bands.map(d => `<path d="${d}" fill="${bandFill}"/>`).join(''));
  if (over) P.push(`<g clip-path="url(#${id}c)">${over}</g>`);
  if (!back && cut.inner) P.push(`<path d="${cut.inner}" fill="${sketch ? '#ddd6c7' : mix(main, '#000000', dark ? 0.5 : 0.38)}"/>`);
  if (cut.quilt) P.push(cut.quilt.map(d => (sketch ? '' : `<path d="${d}" stroke="#000" stroke-opacity="${dark ? 0.35 : 0.13}" stroke-width="7" fill="none"/>`) + `<path d="${d}" stroke="${seam}" stroke-width="1.2" fill="none"/>`).join(''));
  P.push([...sil, ...bands].map(d => `<path d="${d}" fill="none" stroke="${outline}" stroke-width="${sw}" stroke-linejoin="round"/>`).join(''));
  const seams = back ? cut.seamsBack : cut.seams;
  if (seams) P.push(seams.map(d => `<path d="${d}" fill="none" stroke="${seam}" stroke-width="${sketch ? 1.6 : 1.2}"/>`).join(''));
  const stitch = back ? cut.stitchBack : cut.stitch;
  if (stitch && !sketch) P.push(stitch.map(d => `<path d="${d}" fill="none" stroke="${trimHex}" stroke-width="1.1" stroke-dasharray="3 2"/>`).join(''));
  if (!back && cut.trimLines) P.push(cut.trimLines.map(d => `<path d="${d}" fill="none" stroke="${sketch ? '#1b1a17' : trimHex}" stroke-width="${sketch ? 1.8 : 2.4}" stroke-linecap="round"/>`).join(''));
  if (!back && cut.trimDots) P.push(cut.trimDots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${sketch ? 2.2 : 2.6}" fill="${sketch ? '#1b1a17' : trimHex}"/>`).join(''));
  // logo, placement from the scored Logo tile
  if (!opts.noLogo && tiles.logo !== 'allover' && tiles.logo !== 'none') {
    const logoCol = sketch ? '#1b1a17' : readableOn(st.colour, main);
    const name = brandName || 'Brand';
    if (!back && tiles.logo === 'big') P.push(`<g transform="translate(${cut.big[0]} ${cut.big[1]})">${logoArt(sketch ? 'mark' : lk.art, st, name, logoCol, 46)}</g>`);
    if (!back && tiles.logo === 'small') P.push(`<g transform="translate(${cut.small[0]} ${cut.small[1]})">${logoArt('mark', st, name, logoCol, 13)}</g>`);
  }
  if (sketch && tiles.logo === 'allover' && !opts.noLogo) P.push(`<g clip-path="url(#${id}c)">${[[70, 90], [100, 120], [130, 90], [70, 150], [130, 150], [100, 170]].map(([x, y]) => `<g transform="translate(${x - 6} ${y - 6}) scale(.3)">${markBody(st.mark, '#1b1a17', 'none')}</g>`).join('')}</g>`);
  // the brand label every piece carries: a neck label on the back, a hem tag on the front
  if (!sketch) {
    if (back) P.push(`<rect x="${cut.neck[0] - 7}" y="${cut.neck[1] - 2}" width="14" height="8" fill="${st.colour}"/><g transform="translate(${cut.neck[0] - 3} ${cut.neck[1] - 1}) scale(.15)">${markBody(st.mark, '#ffffff', st.colour)}</g>`);
    else P.push(`<rect x="56" y="${tiles.cut === 'denim' ? 160 : tiles.cut === 'resort' ? 180 : tiles.cut === 'shell' ? 186 : 176}" width="6" height="9" fill="${st.colour}"/>`);
  }
  const title = opts.title || (lk.name + ': ' + ['cut', 'palette', 'logo', 'fabric'].map(r => tileLabel(r, tiles[r])).join(', '));
  return `<svg class="${opts.cls || 'gsvg'}" viewBox="0 0 200 230" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><defs>${defs.join('')}</defs>${P.join('')}</svg>`;
}

// Small option icons for the studio controls.
export function swatchSVG(paletteId, size = 34) {
  const p = PALETTES.find(x => x.id === paletteId) || PALETTES[0];
  return `<svg class="sw" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="${p.main}" stroke="#0003"/><path d="M27 7 A18 18 0 0 1 38 22 L27 22 Z" fill="${p.accent}"/></svg>`;
}
export function fabricSVG(fabric, paletteId, w = 64, hgt = 40) {
  const p = PALETTES.find(x => x.id === paletteId) || PALETTES[0];
  const id = 'fs' + (++N);
  return `<svg class="fab" viewBox="0 0 64 40" width="${w}" height="${hgt}" aria-hidden="true"><defs>${fabricDef(id, fabric, p.main)}</defs><rect width="64" height="40" fill="${p.main}"/><rect width="64" height="40" fill="url(#${id})"/></svg>`;
}
export function patternSVG(pattern, paletteId, size = 36) {
  const p = PALETTES.find(x => x.id === paletteId) || PALETTES[0];
  const id = 'ps' + (++N);
  const body = pattern === 'block' ? `<rect y="22" width="40" height="18" fill="${p.accent}"/>` : pattern === 'stripe' || pattern === 'check' ? `<rect width="40" height="40" fill="url(#${id})"/>` : '';
  const def = pattern === 'stripe' ? `<pattern id="${id}" width="40" height="10" patternUnits="userSpaceOnUse"><rect y="5" width="40" height="4" fill="${p.accent}"/></pattern>`
    : pattern === 'check' ? `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="4" height="10" fill="${p.accent}" opacity=".6"/><rect width="10" height="4" fill="${p.accent}" opacity=".6"/></pattern>` : '';
  return `<svg class="pat" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><defs>${def}</defs><rect width="40" height="40" fill="${p.main}"/>${body}<rect x=".5" y=".5" width="39" height="39" fill="none" stroke="#0003"/></svg>`;
}
export const trimHex = (trimId, paletteId) => { const t = TRIMS.find(x => x.id === trimId); if (t && t.hex) return t.hex; const p = PALETTES.find(x => x.id === paletteId) || PALETTES[0]; return p.accent; };
export { TILES };
