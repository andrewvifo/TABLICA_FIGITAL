import { normalizeSource, DataError, canonicalName } from './normalize.mjs';
import { GRAPH, TEAMS } from '../public/config.js';

export const PUBLIC_SOURCE_URL = 'https://challonge.com/ru/cyr6hff7/module';
export const PUBLIC_TOURNAMENT_ID = '18212239';
export const ADAPTER_VERSION = 'public-1.1.0';
const MAX_BYTES = 1500000;
const aliases = { caplag: ['Caplag Еsports'] }; // The source uses a Cyrillic Е here.
export class PublicSourceError extends Error {
  constructor(code, message, retryAfter = 0) { super(message); this.code = code; this.retryAfter = retryAfter; }
}

// Parse the JSON value embedded in the public page. Never execute upstream JS.
export function extractTournamentStore(html) {
  if (typeof html !== 'string' || html.length > MAX_BYTES) throw new PublicSourceError('PUBLIC_SIZE', 'Ответ публичной страницы слишком большой.');
  const pattern = /window\._initialStoreState\s*\[\s*(['"])TournamentStore\1\s*\]\s*=\s*/g;
  const found = pattern.exec(html);
  if (!found) throw new PublicSourceError('PUBLIC_FORMAT', 'Публичная страница не отдала данные сетки: возможно, временная защита сайта или изменение формата.');
  const start = pattern.lastIndex;
  if (html[start] !== '{') throw new PublicSourceError('PUBLIC_FORMAT', 'Не найден JSON турнира.');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); }
      catch { throw new PublicSourceError('PUBLIC_JSON', 'Повреждён JSON публичной сетки.'); }
    }
  }
  throw new PublicSourceError('PUBLIC_JSON', 'Публичная страница вернула обрезанные данные.');
}

export function normalizePublicStore(store) {
  if (String(store?.tournament?.id) !== PUBLIC_TOURNAMENT_ID) throw new PublicSourceError('WRONG_TOURNAMENT', 'Получен другой турнир. Его результаты не показаны.');
  if (store.tournament.tournament_type !== 'double elimination') throw new PublicSourceError('BRACKET_TYPE', 'Формат сетки изменился.');
  const rounds = store.matches_by_round;
  if (!rounds || typeof rounds !== 'object' || Array.isArray(rounds) || Object.values(rounds).some(x => !Array.isArray(x))) throw new PublicSourceError('PUBLIC_MATCHES', 'Не получен полный список матчей публичной сетки.');
  const matches = Object.values(rounds).flat();
  if (matches.length !== 38) throw new PublicSourceError('MATCH_COUNT', `Получено ${matches.length} матчей вместо 38. Проверка остановлена, чтобы не обрезать сетку.`);
  const people = new Map(), names = new Map(), warnings = [], orientations = new Map();
  for (const [key, team] of Object.entries(TEAMS)) for (const name of [team.name, ...team.aliases, ...(aliases[key] || [])]) names.set(canonicalName(name), key);
  for (const m of matches) {
    if (String(m.tournament_id) !== PUBLIC_TOURNAMENT_ID) throw new PublicSourceError('WRONG_TOURNAMENT', 'В списке есть матч другого турнира.');
    const number = Number(m.identifier);
    if (!Number.isInteger(number) || !GRAPH[number]) throw new PublicSourceError('MATCH_MAPPING', 'Номер матча не соответствует макету M1–M38.');
    for (const p of [m.player1, m.player2]) if (p) {
      if (p.id == null || typeof p.display_name !== 'string' || !p.display_name.trim()) throw new PublicSourceError('PUBLIC_PARTICIPANT', `M${number}: неполные данные участника.`);
      const id = String(p.id), prior = people.get(id);
      if (prior && prior.name !== p.display_name) throw new PublicSourceError('PUBLIC_PARTICIPANT', `M${number}: несовпадающие имена одного участника.`);
      people.set(id, {id, name: p.display_name});
    }
    if (!Array.isArray(m.games) || m.games.some(g => !Array.isArray(g) || g.length !== 2 || g.some(n => typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 9999))) throw new PublicSourceError('PUBLIC_GAMES', `M${number}: неверные очки этапов.`);
    // 'scores' counts won stages (2:0), not the required sum of points (21:8).
    // With no game points, show dashes; never substitute stage-win tallies.
    if (m.state === 'complete' && m.games.length === 0) warnings.push(`M${number}: матч завершён без опубликованных очков этапов; счёт оставлен пустым.`);
    const actual = [1, 2].map(i => {
      const prerequisite = m[`player${i}_prereq_identifier`];
      if (prerequisite != null) return `${m[`player${i}_is_prereq_match_loser`] ? 'l' : 'w'}:${Number(prerequisite)}`;
      const p = m[`player${i}`], key = p ? names.get(canonicalName(p.display_name)) : null;
      return key ? `t:${key}` : 'unknown';
    });
    const expected = GRAPH[number].map(s => s.team ? `t:${s.team}` : `${s.outcome === 'loser' ? 'l' : 'w'}:${s.match}`);
    if (actual.some(x => x === 'unknown')) throw new PublicSourceError('TEAM_NAME', `M${number}: не распознана команда. Требуется сверка названия.`);
    const direct = actual.every((x,i) => x === expected[i]);
    const reverse = actual.every((x,i) => x === expected[1-i]);
    if (!direct && !reverse) throw new PublicSourceError('TOPOLOGY', `M${number}: переходы не совпадают с дизайнерской сеткой.`);
    orientations.set(number, !direct && reverse);
  }
  const payload = {
    tournament: {...store.tournament, url:'cyr6hff7', name:'Чемпионат России по фиджитал спорту 2026'},
    participants: [...people.values()],
    matches: matches.map(m => ({...m, player1_id:m.player1?.id ?? null, player2_id:m.player2?.id ?? null, score_in_sets:m.games, scores:undefined, scores_csv:''}))
  };
  const frame = normalizeSource(payload, {slug:'cyr6hff7', scoreMode:'sum_sets', aliases});
  return {...frame, source:'Challonge public module', publicDataUrl:PUBLIC_SOURCE_URL, adapterVersion:ADAPTER_VERSION,
    tournamentState:store.tournament.state, requiresCredentials:false, warnings,
    mappings:frame.mappings.map(m => ({...m, sourceOrderReversed:orientations.get(m.number)}))};
}

async function limitedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new PublicSourceError('PUBLIC_SIZE', 'Ответ источника превышает ограничение размера.');
  if (!response.body?.getReader) {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) throw new PublicSourceError('PUBLIC_SIZE', 'Ответ источника превышает ограничение размера.');
    return body;
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new PublicSourceError('PUBLIC_SIZE', 'Ответ источника превышает ограничение размера.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createPublicService({env=process.env, fetchImpl=globalThis.fetch, clock=Date.now}={}) {
  const configured = Number(env.POLL_SECONDS || 30);
  const interval = Math.max(15, Math.min(300, Number.isFinite(configured) ? configured : 30)) * 1000;
  let lastGood=null, lastReply=null, nextTry=0, pending=null, failures=0, etag=null;
  async function refresh() {
    try {
      let response;
      const headers = {'Accept':'text/html', 'User-Agent':'PhygitalBroadcastBracket/1.1 (public tournament read-only)'};
      if (etag && lastGood) headers['If-None-Match'] = etag;
      try {
        response = await fetchImpl(PUBLIC_SOURCE_URL, {method:'GET', headers, redirect:'error', cache:'no-store', signal:AbortSignal.timeout(12000)});
      } catch { throw new PublicSourceError('PUBLIC_NETWORK', 'Нет связи с публичной таблицей Challonge. Повторим запрос автоматически.'); }
      let frame;
      if (response.status === 304 && lastGood) frame = lastGood;
      else {
        if (!response.ok) {
          const retryHeader = response.headers.get('retry-after');
          const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader)*1000 : 0;
          const message = response.status === 403 ? 'Challonge временно не разрешил чтение публичной страницы с этого сервера.' : response.status === 429 ? 'Challonge попросил замедлить запросы. Повтор через несколько минут.' : `Публичная таблица вернула HTTP ${response.status}.`;
          throw new PublicSourceError(`PUBLIC_HTTP_${response.status}`, message, Math.max(retryAfter, [403,429].includes(response.status) ? 300000 : 0));
        }
        const html = await limitedText(response);
        frame = normalizePublicStore(extractTournamentStore(html));
        etag = response.headers.get('etag');
      }
      failures=0;
      lastGood={...frame, ok:true, stale:false, error:undefined, fetchedAt:new Date(clock()).toISOString(), nextPollMs:interval};
      lastReply=lastGood; nextTry=clock()+interval;
    } catch (error) {
      failures++;
      const retry = Math.max(interval, Math.min(300000, 30000*2**Math.min(failures-1,4)), Math.min(3600000, error.retryAfter || 0));
      const known = error instanceof DataError || error instanceof PublicSourceError;
      const publicError = {code:known ? error.code : 'INTERNAL', message:known ? error.message : 'Ошибка чтения публичной сетки. Предыдущий корректный кадр сохранён.', details:known ? (error.details || []) : []};
      lastReply = lastGood ? {...lastGood, stale:true, error:publicError, nextPollMs:retry} : {schemaVersion:1, ok:false, demo:false, stale:true, matches:[], fetchedAt:null, nextPollMs:retry, requiresCredentials:false, adapterVersion:ADAPTER_VERSION, error:publicError};
      nextTry=clock()+retry;
    }
    return lastReply;
  }
  return {async get() {
    if (pending) return pending;
    if (lastReply && clock()<nextTry) return lastReply;
    pending=refresh();
    try { return await pending; } finally { pending=null; }
  }};
}
export const service = createPublicService();
