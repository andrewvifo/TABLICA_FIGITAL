import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import handler from './api/bracket.js';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/bracket') return await handler(req,res);
    if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;return res.end();}
    const requested=decodeURIComponent(url.pathname);
    const path=requested==='/'?'index.html':requested==='/operator'?'operator.html':requested.replace(/^\//,'');
    const absolute=resolve(root,path);
    if(!absolute.startsWith(resolve(root)+sep)){res.statusCode=403;return res.end();}
    if(!(await stat(absolute)).isFile()){res.statusCode=404;return res.end();}
    const content=await readFile(absolute);
    res.setHeader('Content-Type',types[extname(absolute)] || 'application/octet-stream');
    res.setHeader('Cache-Control','no-cache');
    return res.end(req.method==='HEAD'?undefined:content);
  } catch {res.statusCode=404;return res.end('Not found');}
});
const port=Number(process.env.PORT || 3000),host=process.env.HOST || '127.0.0.1';
server.listen(port,host,()=>console.log(`Local preview: http://${host}:${port}/?demo=1\nLive output: http://${host}:${port}/\nOperator: http://${host}:${port}/operator\nThis local server is NOT a public deployment.`));
