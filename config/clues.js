// Buyer clue cards: static, pre-written, one per (market, taste row). Dealt per CLUES in rules.js. A clue reveals that row's taste tile and weight
// tier to the team that holds it (the same as any other fog reveal). The line is DRAFT text, plain and factual, to be edited later.
// The card names the tile the room drew for that market: clueText(market, row, tile) fills it in from TILE_PHRASE, so the repo holds no market's tile.
import { TILE_PHRASE } from './tiles.js?v=9c995793';

const CITY = { berlin: 'Berlin', tokyo: 'Tokyo', saopaulo: 'Sao Paulo', nairobi: 'Nairobi', cdmx: 'Mexico City' };
const IDS = { berlin: 'BER', tokyo: 'TOK', saopaulo: 'SAO', nairobi: 'NAI', cdmx: 'MEX' };
const ROWID = { cut: 'CUT', palette: 'PAL', logo: 'LOG', fabric: 'FAB' };
export const CLUE_CARDS = Object.keys(CITY).flatMap(market => Object.keys(ROWID).map(row => ({ id: 'CL-' + IDS[market] + '-' + ROWID[row], market, row, draft: true })));

export const clueText = (market, row, tile) => CITY[market] + ' shoppers choose ' + TILE_PHRASE[row][tile] + '.';
export const clueFor = (market, row) => CLUE_CARDS.find(c => c.market === market && c.row === row) || null;
