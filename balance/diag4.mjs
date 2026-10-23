import { playGame } from '../engine/run_bots.mjs';
import './lib.mjs';
import * as MKS from '../config/markets.js';
const A={};
for(let seed=1;seed<=30;seed++){const {state,bots}=playGame({seed,teams:6,house:2,seasons:4,quiet:true});
 for(const id of Object.keys(bots)){const b=bots[id];const s=b.house?'h:'+b.personality:b.strategy;
  for(let q=1;q<=4;q++){const t=state.history[q].teams[id];const k=s+' s'+q;const a=A[k]=A[k]||{n:0,start:0,end:0,sp:0,fees:0};a.n++;a.start+=t.cashStart;a.end+=t.cashEnd;a.sp+=t.seasonProfit;a.fees+=t.designFees;}}}
for(const [k,a] of Object.entries(A).sort()) console.log(k.padEnd(16),'cashStart',(a.start/a.n).toFixed(1),'cashEnd',(a.end/a.n).toFixed(1),'seasonProfit',(a.sp/a.n).toFixed(2),'designFees',(a.fees/a.n).toFixed(1));
