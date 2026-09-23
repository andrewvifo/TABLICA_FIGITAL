import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAPH,TEAMS} from '../public/config.js';
import {DEMO} from '../public/demo-data.js';
import {extractTournamentStore,normalizePublicStore,createPublicService,PUBLIC_SOURCE_URL,PUBLIC_TOURNAMENT_ID} from '../lib/public-source.mjs';
function rawStore() {
  const people=new Map(Object.entries(TEAMS).map(([key,p],i)=>[key,{id:String(1000+i),display_name:p.name}]));
  const matches=DEMO.matches.map(m=>{
    const n=m.number;
    const raw={id:String(900000+n),tournament_id:Number(PUBLIC_TOURNAMENT_ID),identifier:n,round:1,state:m.state,
      winner_id:m.winnerSide===null?null:people.get(m.teams[m.winnerSide].key).id,underway_at:null,
      player1:people.get(m.teams[0].key)??null,player2:people.get(m.teams[1].key)??null,
      games:m.scores.every(x=>x!==null)?[[...m.scores]]:[],scores:m.state==='complete'?[2,0]:[]};
    for(let i=0;i<2;i++){const s=GRAPH[n][i];raw[`player${i+1}_prereq_identifier`]=s.match??null;raw[`player${i+1}_is_prereq_match_loser`]=s.outcome==='loser';}
    return raw;
  });
  matches.find(m=>m.identifier===1).games=[[13,7],[8,1]];
  return {tournament:{id:Number(PUBLIC_TOURNAMENT_ID),state:'underway',tournament_type:'double elimination'},matches_by_round:{1:matches}};
}
function html(store=rawStore()) {return `<!doctype html><script>window._initialStoreState['TournamentStore'] = ${JSON.stringify(store)}; window.someOtherThing = 5;</script>`;}
function harness(){let now=Date.parse('2026-09-23T10:00:00Z'),status=200,body=html();const calls=[];
 const service=createPublicService({env:{},clock:()=>now,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(status===304?null:body,{status,headers:{'content-type':'text/html','etag':'"test1"'}})}});
 return {service,calls,advance:ms=>now+=ms,status:n=>status=n,body:s=>body=s};}
function reverse(m){for(const field of ['','_prereq_identifier','_is_prereq_match_loser','_placeholder_text']) [m[`player1${field}`],m[`player2${field}`]]=[m[`player2${field}`],m[`player1${field}`]];m.games=m.games.map(p=>[p[1],p[0]]);}
test('extracts actual public initial-store assignment, not executable JavaScript',()=>{assert.deepEqual(extractTournamentStore(html()),rawStore())});
test('quotes, braces and escaped quotes inside names do not break the parser',()=>{const s=rawStore();s.test='}; quoted " } \\ text';assert.deepEqual(extractTournamentStore(html(s)),s)});
test('rejects missing, truncated, invalid and executable JSON',()=>{for(const s of ['<html>Blocked</html>',"window._initialStoreState['TournamentStore'] = {", "window._initialStoreState['TournamentStore'] = {foo:1}","window._initialStoreState['TournamentStore'] = (()=>{globalThis.BAD=1})()"]){assert.throws(()=>extractTournamentStore(s))}assert.equal(globalThis.BAD,undefined)});
test('exactly 38 designer matches and 20 public participants map correctly',()=>{const d=normalizePublicStore(rawStore());assert.equal(d.matches.length,38);assert.equal(d.mappingVerified,true);assert.equal(new Set(d.matches.flatMap(m=>m.teams.map(t=>t.id)).filter(Boolean)).size,20);assert.equal(d.requiresCredentials,false)});
test('adds points of both stages (21:8) instead of stage wins (2:0)',()=>{const d=normalizePublicStore(rawStore());assert.deepEqual(d.matches[0].scores,[21,8]);assert.equal(d.matches[0].winnerSide,0)});
test('unplayed games remain dashes, not zeroes and not wins of stages',()=>{const d=normalizePublicStore(rawStore());assert.deepEqual(d.matches.find(m=>m.number===21).scores,[null,null])});
test('known Cyrillic E in Caplag name maps explicitly',()=>{const s=rawStore();for(const m of s.matches_by_round[1])for(const p of [m.player1,m.player2])if(p?.display_name==='Caplag Esports')p.display_name='Caplag Еsports';assert.equal(normalizePublicStore(s).ok,true)});
test('reverses source order into designer order for M12, including its score',()=>{const s=rawStore();reverse(s.matches_by_round[1].find(m=>m.identifier===12));const d=normalizePublicStore(s),m=d.matches.find(m=>m.number===12);assert.equal(m.teams[0].key,'donstu');assert.deepEqual(m.scores,[15,1]);assert.equal(d.mappings.find(m=>m.number===12).sourceOrderReversed,true)});
test('validates loser bracket routes even before participants are known',()=>{const s=rawStore(),m=s.matches_by_round[1].find(m=>m.identifier===29);m.player1_prereq_identifier=21;assert.throws(()=>normalizePublicStore(s),e=>e.code==='TOPOLOGY')});
test('rejects wrong tournament and incomplete bracket',()=>{const s=rawStore();s.tournament.id=1;assert.throws(()=>normalizePublicStore(s));const t=rawStore();t.matches_by_round[1].pop();assert.throws(()=>normalizePublicStore(t))});
test('rejects invalid game point arrays and unknown renamed teams',()=>{const s=rawStore();s.matches_by_round[1][0].games=[[null,8]];assert.throws(()=>normalizePublicStore(s));const t=rawStore();t.matches_by_round[1][0].player1.display_name='Unknown team';assert.throws(()=>normalizePublicStore(t))});
test('completed match without published game points shows dashes plus a warning',()=>{const s=rawStore();s.matches_by_round[1][0].games=[];const d=normalizePublicStore(s);assert.deepEqual(d.matches[0].scores,[null,null]);assert.equal(d.warnings.length,1)});
test('public service needs no API keys and sends no authentication or cookies',async()=>{const h=harness(),d=await h.service.get();assert.equal(d.ok,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,PUBLIC_SOURCE_URL);assert.equal(h.calls[0].options.headers.Authorization,undefined);assert.equal(h.calls[0].options.headers.Cookie,undefined)});
test('simultaneous output clients share a single source request',async()=>{const h=harness();const frames=await Promise.all(Array.from({length:30},()=>h.service.get()));assert.equal(h.calls.length,1);assert.ok(frames.every(d=>d.ok))});
test('unchanged source uses cached frame, then checks again after interval',async()=>{const h=harness();await h.service.get();await h.service.get();assert.equal(h.calls.length,1);h.advance(30001);const d=await h.service.get();assert.equal(h.calls.length,2);assert.equal(d.stale,false)});
test('304 revalidates existing data without erasing scores',async()=>{const h=harness(),a=await h.service.get();h.status(304);h.advance(30001);const b=await h.service.get();assert.equal(b.ok,true);assert.equal(b.version,a.version);assert.notEqual(b.fetchedAt,a.fetchedAt);assert.equal(h.calls[1].options.headers['If-None-Match'],'"test1"')});
test('403 retains last frame and backs off instead of hammering the source',async()=>{const h=harness(),a=await h.service.get();h.status(403);h.advance(30001);const b=await h.service.get();assert.equal(b.stale,true);assert.equal(b.version,a.version);assert.equal(b.fetchedAt,a.fetchedAt);assert.equal(b.nextPollMs,300000);assert.equal(b.error.code,'PUBLIC_HTTP_403')});
test('malformed source never replaces a verified on-air frame',async()=>{const h=harness(),a=await h.service.get();h.body('<html>Cloudflare challenge</html>');h.advance(30001);const b=await h.service.get();assert.equal(b.stale,true);assert.equal(b.version,a.version)});
test('cold failure does not seed demonstration results',async()=>{const h=harness();h.status(503);const d=await h.service.get();assert.equal(d.ok,false);assert.deepEqual(d.matches,[]);assert.equal(d.demo,false)});
test('recovers with a fresh frame after source access returns',async()=>{const h=harness();h.status(429);await h.service.get();h.status(200);h.advance(300001);const d=await h.service.get();assert.equal(d.ok,true);assert.equal(d.stale,false);assert.equal(d.error,undefined)});
