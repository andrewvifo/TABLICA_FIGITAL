import { service } from '../lib/public-source.mjs';
export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Bracket-Adapter','public-1.1.0');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET' && req.method!=='HEAD') {
    res.setHeader('Allow','GET, HEAD');res.statusCode=405;return res.end(JSON.stringify({ok:false,error:{code:'METHOD',message:'Только чтение.'}}));
  }
  try {
    const data=await service.get();
    res.statusCode=data.ok?200:503;
    // Same URL for every browser. A short shared edge cache reduces upstream traffic.
    if(data.ok && !data.stale) res.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=10');
    if(req.method==='HEAD') return res.end();
    return res.end(JSON.stringify(data));
  } catch {
    res.statusCode=500;return res.end(JSON.stringify({ok:false,error:{code:'INTERNAL',message:'Не удалось получить данные.'}}));
  }
}
