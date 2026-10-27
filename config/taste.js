// Hidden market tastes: how a room's draw is made, coded and restored. This file holds the DISTRIBUTION (every tile is possible in every
// market-row) and the machinery. It never holds a room's draw. The host page draws once per room from the browser's crypto random source,
// keeps the draw in that browser's localStorage and shows a short restore code; nothing here, in the repo or in Supabase carries it.
//
// A draw is one preferred tile per row per market. The code is the draw itself in base 32: 4 markets x (5 cuts x 4 colours x 4 logos x 4 fabrics = 320)
// is 320^4 (about 1.05e10), 7 characters, plus one check character. There is no seed to search, and no oracle to test a guess against before a reveal.
import { ROWS, TILES } from './tiles.js?v=0b0c6c97';
import { MARKET_IDS } from './markets.js?v=0b0c6c97';

const SIZES = ROWS.map(r => TILES[r].length);
const PER_MARKET = SIZES.reduce((a, b) => a * b, 1);          // 320
const BASE = 32n, DIGITS = Math.ceil(Math.log(PER_MARKET ** MARKET_IDS.length) / Math.log(32) - 1e-9);   // 9 for five markets (was 7 for four)
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';              // no I, L, O, U

export const TASTE_SPACE = { markets: MARKET_IDS.length, perMarket: PER_MARKET, codes: BigInt(PER_MARKET) ** BigInt(MARKET_IDS.length) };

const marketIndex = taste => ROWS.reduce((acc, r, i) => {
  const k = TILES[r].findIndex(t => t.id === taste[r]);
  if (k < 0) throw new Error('unknown ' + r + ' tile ' + taste[r]);
  return acc * SIZES[i] + k;
}, 0);
const marketFromIndex = idx => {
  const out = {};
  for (let i = ROWS.length - 1; i >= 0; i--) { out[ROWS[i]] = TILES[ROWS[i]][idx % SIZES[i]].id; idx = Math.floor(idx / SIZES[i]); }
  return Object.fromEntries(ROWS.map(r => [r, out[r]]));
};
const check = digits => digits.reduce((s, d, i) => s + d * (2 * i + 1), 0) % 32;   // odd weights: any single mistyped character is caught

export function codeFromTastes(tastes) {
  let n = 0n;
  for (const m of MARKET_IDS) n = n * BigInt(PER_MARKET) + BigInt(marketIndex(tastes[m]));
  const digits = [];
  for (let i = 0; i < DIGITS; i++) { digits.unshift(Number(n % BASE)); n /= BASE; }
  digits.push(check(digits));
  const s = digits.map(d => ALPHA[d]).join('');
  return s.slice(0, 4) + '-' + s.slice(4);
}

export function tastesFromCode(code) {
  const s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== DIGITS + 1) throw new Error('A restore code has ' + (DIGITS + 1) + ' characters, like ' + 'K7QX2M94K7Q'.slice(0, DIGITS + 1).replace(/^(.{4})(.{0,})$/, '$1-$2') + '.');
  const digits = [...s].map(c => ALPHA.indexOf(c));
  if (digits.includes(-1)) throw new Error('That restore code has a character that is not allowed.');
  if (check(digits.slice(0, DIGITS)) !== digits[DIGITS]) throw new Error('That restore code does not check out. Look for a mistyped character.');
  let n = 0n;
  for (let i = 0; i < DIGITS; i++) n = n * BASE + BigInt(digits[i]);
  if (n >= TASTE_SPACE.codes) throw new Error('That restore code is not one this game can issue.');
  const out = {};
  for (const m of [...MARKET_IDS].reverse()) { out[m] = marketFromIndex(Number(n % BigInt(PER_MARKET))); n /= BigInt(PER_MARKET); }
  return Object.fromEntries(MARKET_IDS.map(m => [m, out[m]]));
}

// Uniform integer in [0, n) from the browser (or Node 19+) crypto source. Rejection sampling, so no modulo bias.
export function secureInt(n) {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) throw new Error('No secure random source here. Use a current browser.');
  const lim = Math.floor(4294967296 / n) * n, buf = new Uint32Array(1);
  do { c.getRandomValues(buf); } while (buf[0] >= lim);
  return buf[0] % n;
}
// Seeded integer stream, for headless runs and tests only (a live room never uses it).
export function seededInt(seed) {
  let a = (seed ^ 0x7A57E5) | 0;
  return n => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

// One tile per row per market. `avoid` is a list of tastes (market -> taste) that must not come up for a market, so a live room can never
// repeat the old fixed table that sits in this repo's history.
export function drawTastes(int = secureInt, avoid = []) {
  const out = {};
  for (const m of MARKET_IDS) {
    for (;;) {
      const t = Object.fromEntries(ROWS.map((r, i) => [r, TILES[r][int(SIZES[i])].id]));
      if (!avoid.some(a => a[m] && ROWS.every(r => a[m][r] === t[r]))) { out[m] = t; break; }
    }
  }
  return out;
}
