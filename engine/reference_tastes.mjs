// TEST FIXTURE ONLY. The fixed tastes the engine, the tests and the 10/23 balance retune used before tastes were drawn per room.
// A live room never uses this: the host page draws from the crypto source and drawTastes() is told to avoid these (see pages/host.js).
// Team-facing pages do not import this file.
export const REFERENCE_TASTES = {
  berlin: { cut: 'shell', palette: 'black', logo: 'none', fabric: 'recycled' },
  tokyo: { cut: 'denim', palette: 'earth', logo: 'small', fabric: 'light' },
  saopaulo: { cut: 'resort', palette: 'bright', logo: 'allover', fabric: 'light' },
  nairobi: { cut: 'hoodie', palette: 'pastel', logo: 'big', fabric: 'heavy' },
};
