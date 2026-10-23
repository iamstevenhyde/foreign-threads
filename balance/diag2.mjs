import { playGame } from '../engine/run_bots.mjs';
import { exportTables } from '../engine/core.mjs';
import './lib.mjs';
import * as MKS from '../config/markets.js';
const agg={};
for(let seed=1;seed<=30;seed++){const {state,bots}=playGame({seed,teams:6,house:2,seasons:4,quiet:true});
 const T=exportTables(state);
 for(const id of Object.keys(bots)){const b=bots[id];const s=b.house?'h:'+b.personality:b.strategy;const a=agg[s]=agg[s]||{n:0,rev:0,prod:0,duty:0,setup:0,seat:0,res:0,pfee:0,suit:0,fees:0,dna:0,lines:0,profit:0,inc:0};
  a.n++;
  for(const r of T.ww_seasons.filter(r=>r.team_id===id)){a.rev+=r.revenue;a.prod+=r.mode==='none'?0:r.payload.production;a.duty+=r.duty_paid;a.setup+=r.setup_paid;a.seat+=r.seat_paid;a.res+=r.research_paid;a.pfee+=r.partner_fee;a.suit+=r.suit_paid-r.suit_received;a.inc+=r.partner_income;a.lines+=r.mode==='none'?0:1;}
  for(const d of T.ww_designs.filter(r=>r.team_id===id)){a.fees+=d.fee;a.dna+=d.dna_cost;}
  a.profit+=state.teams[id].cash-20;}}
for(const [k,a] of Object.entries(agg)){const f=x=>(x/a.n).toFixed(1).padStart(6);console.log(k.padEnd(14),'lines',f(a.lines),'rev',f(a.rev),'prod',f(a.prod),'duty',f(a.duty),'setup',f(a.setup),'seat',f(a.seat),'res',f(a.res),'pfee',f(a.pfee),'suit',f(a.suit),'fees',f(a.fees),'dna',f(a.dna),'pinc',f(a.inc),'PROFIT',f(a.profit));}
