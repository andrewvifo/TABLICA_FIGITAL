import { LAYOUT, ART_SIZE } from './config.js';
export function validFrame(data) {
  if(!data || data.ok!==true || !Array.isArray(data.matches) || data.matches.length!==38) return false;
  const ids=new Set();
  for(const m of data.matches) {
    if(!Number.isInteger(m.number) || !LAYOUT[m.number] || ids.has(m.number)) return false;
    ids.add(m.number);
    if(!Array.isArray(m.teams) || m.teams.length!==2 || !Array.isArray(m.scores) || m.scores.length!==2) return false;
    if(m.winnerSide!==null && m.winnerSide!==0 && m.winnerSide!==1) return false;
    if(m.scores.some(x=>x!==null && (typeof x!=='number' || !Number.isFinite(x)))) return false;
    if(m.teams.some(t=>!t || (typeof t.name!=='string' && t.name!==null))) return false;
  }
  return true;
}
export function makeRenderer(stage=document.getElementById('stage'),host=document.getElementById('matches')) {
  const signatures=new Map(),nodes=new Map();
  function resize() {
    const scale=Math.min(innerWidth/ART_SIZE.width,innerHeight/ART_SIZE.height);
    stage.style.transform=`scale(${scale})`;
    stage.style.left=`${(innerWidth-ART_SIZE.width*scale)/2}px`;
    stage.style.top=`${(innerHeight-ART_SIZE.height*scale)/2}px`;
  }
  addEventListener('resize',resize);resize();
  function makeRow(match,index,layout) {
    const t=match.teams[index],row=document.createElement('div');
    row.className='row'+(!t.name?' placeholder':'')+(match.winnerSide!==null && match.winnerSide!==index?' loser':'');
    row.dataset.side=String(index);
    row.style.top=`${(layout.grand?25:11)+16*index}px`;
    const image=document.createElement('img');image.className='logo';image.alt='';image.width=14;image.height=14;
    if(t.logo && /^assets\/logos\/[a-z]+\.png$/.test(t.logo)) {
      image.src=window.EMBEDDED_LOGOS?.[t.logo] || t.logo;
      image.onerror=()=>{image.hidden=true;};
    } else image.hidden=true;
    const name=document.createElement('div');name.className='name';
    const text=document.createElement('span');text.className='name-text';
    const label=t.name || t.placeholder || '—';text.textContent=label;name.title=label;
    if(t.key==='vz' && t.name) {
      name.classList.add('multiline');text.textContent=t.name.replace(/\s+(?=Волжская)/iu,'\n');
    }
    name.append(text);
    const score=document.createElement('span');score.className='score';
    const value=match.scores[index];score.textContent=value===null?'—':String(value);
    if(value===null)score.classList.add('empty');
    if(String(value??'').length>2)score.classList.add('long');
    if(match.winnerSide===index)score.classList.add('winner');
    row.append(image,name,score);return row;
  }
  function render(data) {
    if(!validFrame(data))throw new Error('Кадр не прошёл проверку: нужен полный набор M1–M38.');
    const legend=document.querySelector('#legend > div');
    if(legend)legend.textContent=data.scoreMode==='reported'?'СЧЁТ — ЗНАЧЕНИЯ, ОПУБЛИКОВАННЫЕ СУДЬЯМИ':'СЧЁТ — СУММА ЦИФРОВОГО И ФИЗИЧЕСКОГО ЭТАПОВ';
    for(const match of data.matches) {
      const sig=JSON.stringify(match);
      if(signatures.get(match.number)===sig)continue;
      const l=LAYOUT[match.number];
      const node=document.createElement('section');node.className='match';node.dataset.match=String(match.number);
      node.setAttribute('aria-label',`Матч M${match.number}`);
      Object.assign(node.style,{left:l.x+'px',top:l.y+'px',width:l.w+'px',height:l.h+'px'});
      node.append(makeRow(match,0,l),makeRow(match,1,l));
      const previous=nodes.get(match.number);
      if(previous)previous.replaceWith(node);else host.append(node);
      nodes.set(match.number,node);signatures.set(match.number,sig);
      for(const name of node.querySelectorAll('.name:not(.multiline)')) {
        const text=name.firstElementChild,available=name.clientWidth,width=text.getBoundingClientRect().width;
        const currentScale=stage.getBoundingClientRect().width/ART_SIZE.width;
        const natural=width/currentScale;
        if(natural>available)text.style.transform=`scaleX(${Math.max(.2,available/natural)})`;
      }
    }
  }
  return {render,resize};
}
