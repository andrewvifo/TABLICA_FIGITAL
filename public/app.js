import { makeRenderer, validFrame } from './renderer.js';
import { DEMO } from './demo-data.js';
const params=new URLSearchParams(location.search);
const demo=window.FORCE_DEMO===true || params.get('demo')==='1';
const renderer=makeRenderer();
const notice=document.getElementById('notice'),mark=document.getElementById('demo-mark'),status=document.getElementById('status');
const storageKey='phygital:cyr6hff7:last-good-v1';
let good=null,verifiedThisSession=false,frozen=params.get('freeze')==='1',waiting=null,timer=null,lastError=null;
const state={mode:demo?'demo':'live',connected:false,stale:false,frozen,updatedAt:null,lastError:null};
window.BRACKET_STATUS=state;
function info(message){notice.textContent=message;notice.hidden=!message;}
function publish(){
  state.frozen=frozen;state.updatedAt=good?.fetchedAt??null;state.lastError=lastError;
  document.documentElement.dataset.health=state.connected&&!state.stale?'ready':'warning';
  const age=good?.fetchedAt?Math.max(0,Math.round((Date.now()-Date.parse(good.fetchedAt))/1000)):null;
  status.hidden=params.get('status')!=='1';
  status.textContent=(frozen?'СТОП-КАДР · ':'')+(state.stale?'НЕТ ОБНОВЛЕНИЙ':demo?'НЕ ЛАЙВ':'ИСТОЧНИК ПОДКЛЮЧЁН')+(age!==null?` · проверено ${age} с назад`:'');
  window.dispatchEvent(new CustomEvent('bracket-status',{detail:{...state}}));
}
function persist(data){try{localStorage.setItem(storageKey,JSON.stringify(data));}catch{/* Rendering remains usable without storage. */}}
function display(data){renderer.render(data);good=data;mark.hidden=!data.demo;}
function recover(){
  try{
    const cached=JSON.parse(localStorage.getItem(storageKey));
    const age=Date.now()-Date.parse(cached?.fetchedAt);
    if(validFrame(cached) && !cached.demo && Number.isFinite(age) && age>=0 && age<86400000) {
      display(cached);state.stale=true;info('Сохранённый снимок — актуальность пока не подтверждена.\nПроверяем источник…');
    }
  }catch{/* Corrupt or inaccessible cache is ignored, never shown as live. */}
}
async function poll(){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),50000);
  let wait=15000;
  try{
    const response=await fetch('api/bracket',{cache:'no-store',signal:controller.signal});
    const data=await response.json();
    wait=Math.max(10000,Math.min(300000,Number(data.nextPollMs)||15000));
    if(!response.ok || !data.ok || !validFrame(data)) throw new Error(data.error?.message || 'Источник прислал неполную таблицу.');
    if(data.demo) throw new Error('Тестовый источник не разрешён на live-выходе.');
    if(!data.mappingVerified || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Нет подтверждения структуры сетки или времени получения данных.');
    if(data.stale){state.stale=true;state.connected=false;lastError=data.error?.message || 'Обновления недоступны.';}
    else {
      state.stale=false;state.connected=true;lastError=null;verifiedThisSession=true;
      if(frozen && good){waiting=data;}else{display(data);persist(data);}
      info('');
    }
    if(!good && data.stale) info('Нет подтверждённых актуальных данных.\n'+lastError);
    else if(!verifiedThisSession && data.stale)info('Сохранённый снимок — обновление не подтверждено.\n'+lastError);
  }catch(error){
    state.stale=true;state.connected=false;lastError=error.name==='AbortError'?'Таймаут запроса источника.':error.message;
    wait=Math.max(wait,30000);
    if(!good)info('Живые данные не подключены.\n'+lastError);
    else if(!verifiedThisSession)info('Сохранённый снимок — обновление не подтверждено.\n'+lastError);
    // Once on air, preserve the last valid frame without inserting error text into the picture.
  }finally{
    clearTimeout(timeout);publish();timer=setTimeout(poll,wait);
  }
}
function setFrozen(value){
  frozen=Boolean(value);
  if(!frozen && waiting){display(waiting);persist(waiting);waiting=null;}
  publish();
}
window.BRACKET_OUTPUT={setFrozen, getState:()=>({...state})};
addEventListener('keydown',e=>{if(e.code==='KeyF' && !e.ctrlKey && !e.altKey && !e.metaKey){e.preventDefault();setFrozen(!frozen);}});
if(demo){display(DEMO);info('');mark.hidden=false;state.connected=false;state.stale=false;publish();}
else{recover();poll();}
setInterval(publish,1000);
