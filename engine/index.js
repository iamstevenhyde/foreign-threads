// Entry for `node --test engine/` on Node 22+, which runs a directory argument as a module instead of searching it.
// Node 18 and 20 search the directory themselves (and also pick this file up, which only re-registers the same tests).
import './fit_costs.test.mjs?v=9c995793';
import './markets.test.mjs?v=9c995793';
import './deals.test.mjs?v=9c995793';
