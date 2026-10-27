// Helpers for the engine tests: tiny hand-built games with no news cards, so each rule can be checked on its own.
import { createGame, beginSeason, resolveSeason, makeOffers } from './core.mjs?v=97381521';
import { REFERENCE_TASTES } from './reference_tastes.mjs?v=97381521';

export const D = (cut, palette, logo, fabric, id = 'D1') => ({ id, cut, palette, logo, fabric });
// True tastes (REFERENCE_TASTES, the fixture every test game uses unless it passes opts.tastes): Berlin shell/black/none/recycled, Tokyo denim/earth/small/light, Sao Paulo resort/bright/allover/light, Nairobi hoodie/pastel/big/heavy.
export const PERFECT = {
  berlin: D('shell', 'black', 'none', 'recycled'), tokyo: D('denim', 'earth', 'small', 'light'),
  saopaulo: D('resort', 'bright', 'allover', 'light'), nairobi: D('hoodie', 'pastel', 'big', 'heavy'),
};
export const line = (design, o = {}) => ({ mode: 'ship', design, price: 'standard', run: 50, bid: 0, fallback: 'none', ...o });
export const plan = (designs, markets, extra = {}) => ({ designs, markets, research: [], copy: [], accept: [], ...extra });
export const lock = (p, why = '') => ({ plan: p, locked: true, why });

export function game(specs = [['A', 'dunn'], ['B', 'rank']], opts = {}) {
  const state = createGame({ seed: opts.seed ?? 1, teams: specs.map(([id, brandId, house]) => ({ id, brandId, house: !!house, personality: house ? 'steady' : null })), seasons: opts.seasons ?? 4, tastes: opts.tastes ?? REFERENCE_TASTES });
  state.deck = { 1: [], 2: [], 3: [], 4: [] };      // no news cards unless a test asks for one
  return state;
}
export function season(state, subs, tweak) {
  beginSeason(state);
  if (tweak) tweak(state.cfg);
  return resolveSeason(state, subs);
}
export const row = (state, s, team, market) => state.tables.ww_seasons.find(r => r.season === s && r.team_id === team && r.market === market);
export { beginSeason, resolveSeason, makeOffers };
