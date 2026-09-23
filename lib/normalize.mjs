import { createHash } from 'node:crypto';
import { GRAPH, TEAMS, SOURCE_SLUG } from '../public/config.js';

export class DataError extends Error {
  constructor(code, message, details = []) { super(message); this.code = code; this.details = details; }
}
export function canonicalName(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]/gu, '');
}
function rows(payload, wrapper) {
  const list = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(list)) throw new DataError('SCHEMA', `Источник не вернул массив ${wrapper}.`);
  return list.map(x => x?.[wrapper] ?? x);
}
const identity = v => v === null || v === undefined || v === '' ? null : String(v);
const attrs = r => r?.attributes ?? r;
function relationships(r) { return r?.relationships ?? attrs(r)?.relationships ?? {}; }
function playerId(r, index) {
  const a = attrs(r), rel = relationships(r)[`player${index}`];
  return identity(a[`player${index}_id`] ?? rel?.data?.id ?? a[`player${index}`]?.id);
}
function pair(v) {
  if (Array.isArray(v) && v.length === 2 && v.every(x => x !== null && x !== '' && Number.isFinite(Number(x)))) {
    const result = v.map(Number);
    if (result.some(n => Math.abs(n) > 9999)) throw new DataError('SCORES', 'Счёт превышает допустимый размер поля.');
    return result;
  }
  if (typeof v !== 'string') throw new DataError('SCORES', 'Нераспознанный формат счёта.');
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*[-:–−]\s*(-?\d+(?:\.\d+)?)$/u);
  if (!m) throw new DataError('SCORES', `Нераспознанный счёт: ${v.slice(0, 40)}`);
  return pair([m[1], m[2]]);
}
export function parseScores(a, mode = 'sum_sets') {
  if (!['sum_sets', 'reported'].includes(mode)) throw new DataError('CONFIG', 'SCORE_MODE: допустимы sum_sets / reported.');
  let sets = a.score_in_sets;
  if (mode === 'sum_sets' && Array.isArray(sets) && sets.length) {
    return sets.map(pair).reduce((sum, score) => [sum[0] + score[0], sum[1] + score[1]], [0, 0]);
  }
  const raw = a.scores_csv ?? a.scores ?? '';
  if (raw === null || raw === '' || (typeof raw === 'string' && !raw.trim())) return [null, null];
  if (Array.isArray(raw)) return pair(raw);
  const values = String(raw).split(',').map(s => s.trim());
  if (values.length > 1 && mode === 'reported') throw new DataError('SCORES', 'Несколько этапов счёта: выберите SCORE_MODE=sum_sets.');
  return values.map(pair).reduce((sum, score) => [sum[0] + score[0], sum[1] + score[1]], [0, 0]);
}
export function designerNumber(raw, explicit = {}) {
  const a = attrs(raw), sourceId = identity(raw.id ?? a.id);
  const provided = explicit[sourceId];
  const label = String(a.identifier ?? '').trim().match(/^(?:M\s*)?(\d+)$/i);
  // Never derive a match number from array position or a guessed alphabetical order.
  const value = provided ?? (label ? label[1] : a.suggested_play_order);
  const n = Number(value);
  if (value === null || value === undefined || !Number.isInteger(n) || n < 1 || n > 38) {
    throw new DataError('MATCH_MAPPING', 'Не удалось безопасно сопоставить матч ячейке M1–M38.', [{ sourceId, identifier:a.identifier, suggestedPlayOrder:a.suggested_play_order }]);
  }
  return n;
}
export function normalizeSource({ tournament, participants, matches }, options = {}) {
  const t = attrs(tournament?.data ?? tournament?.tournament ?? tournament);
  if (!t || t.url !== (options.slug ?? SOURCE_SLUG)) throw new DataError('WRONG_TOURNAMENT', 'Ответ относится не к турниру cyr6hff7.');
  if (t.tournament_type && t.tournament_type !== 'double elimination') throw new DataError('BRACKET_TYPE', 'Макет рассчитан на double elimination.');
  const plist = rows(participants, 'participant');
  const mlist = rows(matches, 'match');
  if (mlist.length !== 38) throw new DataError('MATCH_COUNT', `В источнике ${mlist.length} матчей, а в макете — 38. Ничего не обрезано: требуется сверка сетки. Это также может быть дополнительный reset-финал.`, mlist.map(r => ({id:r.id,identifier:attrs(r).identifier})));
  if (plist.length !== 20) throw new DataError('PARTICIPANT_COUNT', `В источнике ${plist.length} участников; предоставленный макет содержит 20.`);
  const nameIndex = new Map();
  for (const [key, team] of Object.entries(TEAMS)) {
    for (const name of [team.name, ...team.aliases, ...(options.aliases?.[key] ?? [])]) nameIndex.set(canonicalName(name), key);
  }
  const pmap = new Map(), seedId = new Map();
  for (const r of plist) {
    const a = attrs(r), id = identity(r.id ?? a.id), name = String(a.name ?? a.display_name ?? '').trim();
    if (!id || !name || pmap.has(id)) throw new DataError('PARTICIPANTS', 'Неполные или повторяющиеся данные участников.');
    const key = nameIndex.get(canonicalName(name));
    if (!key) throw new DataError('TEAM_NAME', `Команда «${name}» не сопоставлена с макетом. Проверьте название; не подменяем его догадкой.`, [{id,name}]);
    if (seedId.has(key)) throw new DataError('TEAM_NAME', `Два участника совпали с одной командой макета: ${name}`);
    seedId.set(key,id);
    pmap.set(id,{id,name,key,logo:TEAMS[key].logo});
  }
  const byNumber = new Map(), sourceIds = new Set();
  for (const raw of mlist) {
    const number = designerNumber(raw, options.matchMap);
    const a = attrs(raw), sourceId = identity(raw.id ?? a.id);
    if (!sourceId || sourceIds.has(sourceId)) throw new DataError('MATCH_IDS', 'Пустые или повторяющиеся ID матчей.');
    if (byNumber.has(number)) throw new DataError('MATCH_MAPPING', `Два матча попали в M${number}.`);
    sourceIds.add(sourceId); byNumber.set(number, raw);
  }
  const normalized = new Map(), mappings=[];
  for (let number=1; number<=38; number++) {
    const raw = byNumber.get(number);
    if (!raw) throw new DataError('MISSING_MATCH', `В ответе нет M${number}.`);
    const a=attrs(raw), sourceId=identity(raw.id ?? a.id), state=String(a.state ?? 'pending');
    let ids=[playerId(raw,1),playerId(raw,2)], scores=parseScores(a,options.scoreMode ?? 'sum_sets');
    const winnerId=state==='complete' ? identity(a.winner_id ?? a.winner?.id ?? relationships(raw).winner?.data?.id) : null;
    for (const id of ids) if (id && !pmap.has(id)) throw new DataError('UNKNOWN_PARTICIPANT', `M${number}: неизвестный ID участника.`);
    if (ids[0] && ids[0]===ids[1]) throw new DataError('DUPLICATE_PLAYER', `M${number}: команда играет сама с собой.`);
    if (state==='complete' && (!winnerId || !ids.includes(winnerId) || ids.some(x=>!x))) throw new DataError('WINNER', `M${number}: противоречивый winner_id / участники.`);
    const sources = GRAPH[number];
    const expected = sources.map(s=>{
      if (s.team) return seedId.get(s.team);
      const prev=normalized.get(s.match);
      if (!prev || prev.winnerSide===null) return null;
      return prev.teams[s.outcome==='winner' ? prev.winnerSide : 1-prev.winnerSide]?.id ?? null;
    });
    const compatible = candidate => expected.every((id,i)=>id===null ? candidate[i]===null : candidate[i]===id);
    let swapped=false;
    if (!compatible(ids)) {
      const reversed=[ids[1],ids[0]];
      if (compatible(reversed)) { ids=reversed; scores=[scores[1],scores[0]]; swapped=true; }
      else throw new DataError('TOPOLOGY', `M${number}: участники не соответствуют переходам верхней/нижней сетки. Сохранено предыдущее корректное состояние.`, [{sourceId,actual:ids.map(id=>pmap.get(id)?.name??null),expected:expected.map(id=>pmap.get(id)?.name??null)}]);
    }
    const teams=ids.map((id,i)=>{
      if (id) return {...pmap.get(id),placeholder:null};
      const s=sources[i];
      return {id:null,key:null,name:null,logo:null,placeholder:s.team ? TEAMS[s.team].name : `${s.outcome==='winner'?'ПОБ.':'ПРОИГР.'} M${s.match}`};
    });
    const winnerSide=winnerId ? ids.indexOf(winnerId) : null;
    normalized.set(number,{number,sourceId,state,teams,scores,winnerSide,underway: Boolean(a.underway_at || a.timestamps?.underway_at || state==='underway')});
    mappings.push({number,sourceId,identifier:a.identifier??null,suggestedPlayOrder:a.suggested_play_order??null,swapped});
  }
  const result=[...normalized.values()];
  return {schemaVersion:1,ok:true,demo:false,stale:false,source:'Challonge API v2.1',scoreMode:options.scoreMode??'sum_sets',sourceUrl:`https://challonge.com/ru/${options.slug??SOURCE_SLUG}`,tournamentName:t.name??SOURCE_SLUG,mappingVerified:true,matches:result,mappings,version:createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0,20)};
}
