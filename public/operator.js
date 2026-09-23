const byId=id=>document.getElementById(id);
byId('demo-link').href='index.html?demo=1';
let current=null,lastError=null,pending=false,timer=null;
function preview(demo){
  byId('preview').src=demo?'index.html?demo=1':'index.html';
  byId('show-demo').classList.toggle('selected',demo);byId('show-live').classList.toggle('selected',!demo);
  byId('preview-caption').textContent=demo?'Тестовое наполнение переписано с вашего изображения. Это не текущие результаты судей.':'Живой выход. До успешного чтения публичного источника остаётся пустая сетка с предупреждением.';
}
byId('show-demo').onclick=()=>preview(true);byId('show-live').onclick=()=>preview(false);
function paint(){
  const good=current?.ok && !current.stale,has=current?.ok;
  byId('lamp').className='lamp '+(good?'good':'bad');
  byId('headline').textContent=good?'Источник отвечает':has?'Обновления прерваны':'Live-источник не подключён';
  byId('detail').textContent=lastError || (good?'Получен полный набор матчей; семена и переходы прошли автоматическую проверку.':'Тестовый макет ниже не заменяет подключение судейских данных.');
  byId('completed').textContent=has?`${current.matches.filter(m=>m.state==='complete').length} / 38`:'— / 38';
  byId('mapping').textContent=current?.mappingVerified?'Автопроверка пройдена':'Не проверена';
  const date=current?.fetchedAt?new Date(current.fetchedAt):null;
  byId('checked').textContent=date?date.toLocaleTimeString('ru-RU')+` · ${Math.max(0,Math.floor((Date.now()-date)/1000))} с назад`:'Нет';
  if(has){
    const fragment=document.createDocumentFragment();
    for(const m of current.matches){
      const row=document.createElement('tr');
      const state={complete:'Завершён',open:'Открыт',pending:'Ожидание',underway:'Идёт'}[m.state] || m.state;
      const values=[`M${m.number}`,m.teams[0].name||m.teams[0].placeholder,m.scores.map(s=>s===null?'—':s).join(' : '),m.teams[1].name||m.teams[1].placeholder,state,m.sourceId];
      values.forEach((v,i)=>{const cell=document.createElement('td');cell.textContent=v;if(i===2)cell.className='score';row.append(cell);});fragment.append(row);
    }
    byId('rows').replaceChildren(fragment);
    byId('table-caption').textContent='Автоматическая сверка не заменяет контроль перед эфиром. Жёлтым в графике отмечается только winner_id завершённого матча — не просто больший счёт.';
  }
}
async function read(){
  if(pending)return;pending=true;byId('refresh').disabled=true;clearTimeout(timer);
  let wait=15000;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),50000);
  try{
    const response=await fetch('api/bracket',{cache:'no-store',signal:controller.signal});const data=await response.json();
    wait=Math.max(10000,Math.min(300000,Number(data.nextPollMs)||15000));
    if(!response.ok || !data.ok){
      if(current)current={...current,stale:true};
      lastError=data.error?.message||'Сервер не вернул данные.';
    }else{current=data;lastError=data.error?.message||null;}
    const details=data.error?.details;byId('errors').hidden=!details?.length;byId('errors').textContent=details?.length?JSON.stringify(details,null,2):'';
  }catch{if(current)current={...current,stale:true};lastError='Нет ответа сервера. Последний результат на выходе не обновляется.';wait=30000;}
  finally{clearTimeout(timeout);pending=false;byId('refresh').disabled=false;paint();timer=setTimeout(read,wait);}
}
byId('refresh').onclick=read;read();setInterval(paint,1000);
