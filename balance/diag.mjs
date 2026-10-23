import { playGame } from '../engine/run_bots.mjs';
import { exportTables } from '../engine/core.mjs';
import './lib.mjs';
import * as MKS from '../config/markets.js';
const agg={};
for(let seed=1;seed<=30;seed++){const {state,bots}=playGame({seed,teams:6,house:2,seasons:4,quiet:true});
 for(const r of exportTables(state).ww_seasons){ if(r.mode==='none')continue; const b=bots[r.team_id]; const s=b.house?'h:'+b.personality:b.strategy;
  const k=s+' run'+r.run_units; const a=agg[k]=agg[k]||{n:0,cap:0,fit:0,prof:0,ratio:0}; a.n++; a.cap+=r.buyers>=r.run_units-1e-6?1:0; a.fit+=r.fit; a.prof+=r.profit; a.ratio+=r.buyers/r.run_units;}}
for(const [k,a] of Object.entries(agg).sort()) console.log(k.padEnd(22),'n',String(a.n).padStart(4),'cap%',(100*a.cap/a.n).toFixed(0).padStart(3),'fit',(a.fit/a.n).toFixed(2),'sell/run',(a.ratio/a.n).toFixed(2),'profit',(a.prof/a.n).toFixed(2));
