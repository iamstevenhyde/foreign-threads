import './lib.mjs';
import { playGame } from '../engine/run_bots.mjs';
import { exportTables } from '../engine/core.mjs';
const seed=Number(process.argv[process.argv.indexOf('--seed')+1]||1), team=process.argv[process.argv.indexOf('--team')+1]||'T1';
const {state,bots}=playGame({seed,teams:6,house:2,seasons:4,quiet:true});
console.log(team, bots[team].strategy||bots[team].personality);
const T=exportTables(state);
for(const d of T.ww_decisions.filter(d=>d.team_id===team)){console.log('S'+d.round,'cash?',JSON.stringify(Object.fromEntries(Object.entries(d.plan.markets).map(([m,l])=>[m,l.mode+' r'+l.run+' b'+l.bid+' '+l.price+' fb:'+l.fallback]))),'designs',d.plan.designs.length,'stood',d.stood,d.engine_error||'');}
for(const r of T.ww_seasons.filter(r=>r.team_id===team&&r.mode!=='none')) console.log('S'+r.season,r.market,r.mode,'fit',r.fit,'run',r.run_units,'buy',r.buyers.toFixed(1),'rev',r.revenue.toFixed(2),'prof',r.profit.toFixed(2),'seat',r.seat_paid,'unit',r.unit_cost.toFixed(1));
for(let s=1;s<=4;s++)console.log('S'+s,'cashEnd',state.history[s].teams[team].cashEnd,'cashStart',state.history[s].teams[team].cashStart);
