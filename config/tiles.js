// Tile tables: the four rows a garment is built from (cut, palette, logo, fabric).
// Names come from Fable's review (game_review_fable_20261021.md, R1). Image files for cut x palette follow the pattern
//   wk10_cut-<cut>_pal-<palette>.png        (no midjourney_prompts_week10 file existed on 10/21, so this pattern is the contract to match)
// Logo and fabric have no photos: the page draws them as flat SVG from the descriptors below (no gradients).

export const ROWS = ['cut', 'palette', 'logo', 'fabric'];
export const ROW_LABEL = { cut: 'Cut', palette: 'Colour', logo: 'Logo', fabric: 'Fabric' };

export const CUTS = [
  { id: 'puffer', label: 'Puffer' },
  { id: 'shell', label: 'Technical shell' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'resort', label: 'Resort shirt' },
  { id: 'denim', label: 'Denim jacket' },
];

// hex values are for the SVG fallback and the tint fallback (memo section 2: five neutral cut images tinted in the page if Midjourney drifts).
export const PALETTES = [
  { id: 'earth', label: 'Earth', main: '#7a5c3e', accent: '#c9a66b' },
  { id: 'black', label: 'Black', main: '#1c1c1e', accent: '#8a8a8e' },
  { id: 'bright', label: 'Bright', main: '#e5484d', accent: '#f5c518' },
  { id: 'pastel', label: 'Pastel', main: '#b9d3e6', accent: '#f1c9d8' },
];

// draw: plain-data instructions for a small inline SVG on a 100 x 100 chest view. No letters in any mark (feedback: no baked text).
// size is a fraction of the chest width, at is where it sits, repeat is the tile spacing for an all-over print.
export const LOGOS = [
  { id: 'big', label: 'Big logo', draw: { shape: 'ring-bar', size: 0.5, at: 'chest-center' } },
  { id: 'small', label: 'Small logo', draw: { shape: 'ring-bar', size: 0.12, at: 'chest-left' } },
  { id: 'none', label: 'No logo', draw: null },
  { id: 'allover', label: 'All-over print', draw: { shape: 'ring-bar', size: 0.1, repeat: 0.22, at: 'all' } },
];

export const FABRICS = [
  { id: 'heavy', label: 'Heavy', draw: { pattern: 'twill', stroke: 3, gap: 6, angle: 45 } },
  { id: 'light', label: 'Light', draw: { pattern: 'weave', stroke: 1, gap: 8, angle: 0 } },
  { id: 'performance', label: 'Performance', draw: { pattern: 'mesh', stroke: 1.5, gap: 5, angle: 0 } },
  { id: 'recycled', label: 'Recycled', draw: { pattern: 'fleck', stroke: 2, gap: 7, angle: 0 } },
];

export const TILES = { cut: CUTS, palette: PALETTES, logo: LOGOS, fabric: FABRICS };
export const tileIds = row => TILES[row].map(t => t.id);
export const tileLabel = (row, id) => (TILES[row].find(t => t.id === id) || { label: id }).label;

// One design = one tile id from each row.
export const designKey = d => ROWS.map(r => d[r]).join('/');
export const isValidDesign = d => ROWS.every(r => tileIds(r).includes(d && d[r]));

// The 20 garment photos (5 cuts x 4 palettes). Art arrives Thu 10/22 as PNG.
export const garmentFile = (cut, palette) => 'wk10_cut-' + cut + '_pal-' + palette + '.png';
export const GARMENT_FILES = CUTS.flatMap(c => PALETTES.map(p => garmentFile(c.id, p.id)));

// Other art named in the 10/21 brief: 4 street scenes, lobby, runway. Filenames are my choice; rename here if the art folder differs.
export const SCENE_FILES = {
  street: { berlin: 'wk10_street_berlin.png', tokyo: 'wk10_street_tokyo.png', saopaulo: 'wk10_street_saopaulo.png', nairobi: 'wk10_street_nairobi.png', cdmx: 'wk10_street_cdmx.png' },
  lobby: 'wk10_lobby.png',
  runway: 'wk10_runway.png',
};

// How a tile reads in a sentence ("shoppers choose ..."). Used by clue cards and the news cards that reveal a row, so their text follows the
// room's drawn taste instead of naming a fixed tile in the repo.
export const TILE_PHRASE = {
  cut: { puffer: 'puffer jackets', shell: 'technical shell jackets', hoodie: 'hoodies', resort: 'resort shirts', denim: 'denim jackets' },
  palette: { earth: 'earth colours', black: 'black', bright: 'bright colours', pastel: 'pastel colours' },
  logo: { big: 'a big logo', small: 'a small logo', none: 'no logo', allover: 'an all-over print' },
  fabric: { heavy: 'heavy fabric', light: 'light fabric', performance: 'performance fabric', recycled: 'recycled fabric' },
};
