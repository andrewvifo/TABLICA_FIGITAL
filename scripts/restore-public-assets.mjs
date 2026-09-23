import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('./assets-manifest.json',import.meta.url),'utf8'));
const queue=Object.entries(manifest);
async function worker(){for(;;){const entry=queue.shift();if(!entry)return;const [path,expected]=entry;
 try{await access(path);continue;}catch{}
 const url='https://tablicafigitaldeploy.vercel.app/'+path.slice('public/'.length);
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error(`${path}: differs from supplied designer build; refusing to overwrite`);
 await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);console.log('RESTORED',path,bytes.length);
}}
await Promise.all(Array.from({length:4},worker));
const path='public/operator.html';let html=await readFile(path,'utf8');
if(html.includes('CHALLONGE_API_KEY')){
 const start=html.indexOf('<section class="setup"'),end=html.indexOf('</section>',start)+10;
 if(start<0||end<10)throw new Error('Operator markup changed; manual review required');
 html=html.slice(0,start)+'<section class="setup" id="setup"><h2>Публичный источник — без API-ключа</h2><p>Сервер читает публичный модуль Challonge турнира <b>cyr6hff7</b>. Аккаунт судей, пароль и API-ключ не нужны. Проверка обновлений — по умолчанию каждые 30 секунд на активном сервере.</p><p>Счёт — сумма очков цифрового и физического этапов, а не число выигранных этапов. Подсветка победителя берётся из решения судей. Проверяются все 38 матчей, 20 участников и переходы между раундами.</p><p>В vMix: Web Browser <b>1920 × 1080</b>, основной адрес <b>без ?demo=1</b>. Демо предназначено только для проверки оформления.</p><p>При временном отказе источника последний подтверждённый кадр сохраняется. Ошибка и время последнего успешного чтения показаны на этой странице. Клавиша F в эфирном окне замораживает только этот экземпляр.</p></section>'+html.slice(end);
 html=html.replace('class="selected">Фото / тест','>Фото / тест').replace('id="show-live">','id="show-live" class="selected">').replace('src="index.html?demo=1"','src="index.html"').replace('Тестовое наполнение переписано с вашего изображения. Это не текущие результаты судей.','Живые данные с публичной таблицы Challonge. Демо включается отдельной кнопкой.');
 await writeFile(path,html);
}
const jsPath='public/operator.js';await writeFile(jsPath,(await readFile(jsPath,'utf8')).replace('До успешного чтения API','До успешного чтения публичного источника'));
await writeFile('public/build.json',JSON.stringify({adapterVersion:'public-1.1.0',requiresCredentials:false})+'\n');
