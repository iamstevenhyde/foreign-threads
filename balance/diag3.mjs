import { playGame } from '../engine/run_bots.mjs';
import { exportTables } from '../engine/core.mjs';
import './lib.mjs';
import * as MKS from '../config/markets.js';
const strat=process.argv.includes('--strat')?process.argv[process.argv.indexOf('--strat')+1]:'standardizer';
const agg={};
for(let seed=1;seed<=30;seed++){const {state,bots}=playGame({seed,teams:6,house:2,seasons:4,quiet:true});
 for(const r of exportTables(state).ww_seasons){ if(r.mode==='none')continue; const b=bots[r.team_id]; const s=b.house?'h:'+b.personality:b.strategy; if(s!==strat)continue;
  const k=r.market+' s'+r.season; const a=agg[k]=agg[k]||{n:0,fit:0,prof:0,buy:0,run:0,rev:0}; a.n++; a.fit+=r.fit; a.prof+=r.profit; a.buy+=r.buyers; a.run+=r.run_units; a.rev+=r.revenue;}}
for(const [k,a] of Object.entries(agg).sort()) console.log(strat,k.padEnd(12),'n',String(a.n).padStart(3),'fit',(a.fit/a.n).toFixed(2),'run',(a.run/a.n).toFixed(0),'buyers',(a.buy/a.n).toFixed(0),'rev',(a.rev/a.n).toFixed(2),'profit',(a.prof/a.n).toFixed(2));
