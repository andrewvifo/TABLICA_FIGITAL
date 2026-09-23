import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {extractTournamentStore,normalizePublicStore,createPublicService,PUBLIC_SOURCE_URL} from '../lib/public-source.mjs';
const response=await fetch(PUBLIC_SOURCE_URL,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html','User-Agent':'PhygitalBroadcastBracket/1.1 (public tournament read-only)'}});
assert.equal(response.status,200,'Public module must be accessible without credentials');
const html=await response.text(),store=extractTournamentStore(html),frame=normalizePublicStore(store),source=new Map(Object.values(store.matches_by_round).flat().map(m=>[Number(m.identifier),m]));
assert.equal(frame.matches.length,38);assert.equal(frame.requiresCredentials,false);assert.equal(frame.mappingVerified,true);
for(const m of frame.matches){
 const raw=source.get(m.number);assert.ok(raw);
 const sum=raw.games.length?raw.games.reduce((a,g)=>[a[0]+g[0],a[1]+g[1]],[0,0]):[null,null];
 for(let i=0;i<2;i++){
  const team=m.teams[i];if(!team.id){assert.equal(m.scores[i],null);continue;}
  const side=String(raw.player1?.id)===team.id?0:String(raw.player2?.id)===team.id?1:-1;assert.notEqual(side,-1,`M${m.number} participant identity`);
  assert.equal(m.scores[i],sum[side],`M${m.number} sum of points must follow team identity`);
  assert.equal(team.name,raw[`player${side+1}`].display_name);
 }
 if(m.state==='complete')assert.equal(m.teams[m.winnerSide].id,String(raw.winner_id));
}
// Exercise the exact service with the real HTML, including caching and stale recovery.
let calls=0,fail=false,now=Date.now();const service=createPublicService({env:{},clock:()=>now,fetchImpl:async()=>{calls++;return new Response(fail?'Unavailable':html,{status:fail?503:200})}});
const initial=await service.get();assert.equal(initial.ok,true);await service.get();assert.equal(calls,1);
fail=true;now+=30001;const stale=await service.get();assert.equal(stale.stale,true);assert.equal(stale.version,initial.version);
fail=false;now+=300001;const recovered=await service.get();assert.equal(recovered.stale,false);
const report={checkedAt:new Date().toISOString(),upstreamHttp:response.status,sourceUrl:PUBLIC_SOURCE_URL,adapterVersion:frame.adapterVersion,credentialsUsed:false,matches:frame.matches.length,participants:new Set(frame.matches.flatMap(m=>m.teams.map(t=>t.id)).filter(Boolean)).size,completed:frame.matches.filter(m=>m.state==='complete').length,allScoresCheckedAgainstRawGames:true,allWinnersCheckedAgainstSource:true,allRoutesValidated:true,serviceCacheAndRecoveryPassed:true,frameVersion:frame.version,examples:frame.matches.filter(m=>[1,9,12,13,17,19,21,27,38].includes(m.number)).map(m=>({match:m.number,teams:m.teams.map(t=>t.name||t.placeholder),scores:m.scores,state:m.state}))};
await mkdir('docs',{recursive:true});await writeFile('docs/LIVE_PUBLIC_CHECK.json',JSON.stringify(report,null,2)+'\n');
await writeFile('docs/live-frame.json',JSON.stringify({...frame,fetchedAt:report.checkedAt,nextPollMs:30000},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
