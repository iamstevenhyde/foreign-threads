import fs from 'node:fs'; import path from 'node:path';
// summarise check_log failure reasons from a batch json: node failreasons.mjs out.json
const o=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const c={};
for(const f of o.check_log_failures) for(const x of f.fails) c[x]=(c[x]||0)+1;
console.log(Object.entries(c).map(([k,v])=>v+'x '+k).join('\n')||'no failures');
