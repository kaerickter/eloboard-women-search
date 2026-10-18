import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Store} from './store.mjs';
import {Collector} from './collector.mjs';
import {resolveManual} from './manual.mjs';
import {UsageMonitor} from './usage.mjs';
import {previewReport} from './sample.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function createApp(options={}) {
  const password=options.password||process.env.SPAWN_DIARY_ADMIN_PASSWORD;
  if(!password)throw Error('SPAWN_DIARY_ADMIN_PASSWORD is required');
  const store=options.store||new Store(process.env.DATABASE_URL);
  const collector=options.collector||new Collector(store),key=randomBytes(32),attempts=new Map(),cache=new Map();
  let enabled;try{enabled=await store.init();}catch(e){await store.pool?.end();throw e;}collector.enabled=enabled;collector.status(enabled?'starting':'paused');if(enabled)void collector.check();
  const manual=new Map();
  async function restoreManual(target){const c=new Collector(store.scope(target.bj_id),{bjId:target.bj_id,bno:target.bno,onEnd:()=>store.stopManual(target.bj_id)});manual.set(target.bj_id,{name:target.name,bno:target.bno,collector:c});c.enabled=collector.enabled;c.status(c.enabled?'starting':'paused');if(c.enabled)void c.check();return c;}
  for(const target of await store.manualTargets?.()||[])await restoreManual(target);
  async function pauseAll(value){await collector.enable(value);for(const m of manual.values())if(m.collector.runtime.status!=='completed')await m.collector.enable(value);}
  const usage=options.usage||new UsageMonitor(store,{onDanger:()=>pauseAll(false)});if(options.usage!==false)await usage.start?.();
  const sign=data=>createHmac('sha256',key).update(data).digest('base64url');
  function valid(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('solo_session='))?.slice(13)||'';const [time,mac]=raw.split('.');const expected=sign(time||'');return !!mac&&mac.length===expected.length&&timingSafeEqual(Buffer.from(mac),Buffer.from(expected))&&Number(time)>Date.now();}
  function send(req,res,code,value,type='application/json; charset=utf-8',headers={}){let data=Buffer.from(type.startsWith('application/json')?JSON.stringify(value):value);res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','same-origin');if(data.length>1024&&/gzip/.test(req.headers['accept-encoding']||'')){data=gzipSync(data);res.setHeader('content-encoding','gzip');res.setHeader('vary','Accept-Encoding');}res.writeHead(code,{'content-type':type,'content-length':data.length,...headers});res.end(data);}
  async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('입력이 너무 깁니다.');}return JSON.parse(raw||'{}');}
  const login=fs.readFileSync(path.join(root,'public/login.html'),'utf8');
  async function handle(req,res){
    try{
      const url=new URL(req.url,'http://'+req.headers.host),p=url.pathname.replace(/^\/solo/,'')||'/';
      if(p==='/healthz'&&req.method==='GET'){res.writeHead(204,{'cache-control':'no-store'});return res.end();}
      if(p==='/usage-notice'&&req.method==='GET'){const u=await usage.check?.()||usage.snapshot;return send(req,res,200,{level:u?.level||'unknown',configured:!!u?.configured,month:u?.month||new Date().toISOString().slice(0,7)});}
      if(req.method!=='GET'&&req.headers.origin&&!['http://'+req.headers.host,'https://'+req.headers.host].includes(req.headers.origin))return send(req,res,403,{error:'허용되지 않은 요청입니다.'});
      if(p==='/login'&&req.method==='POST'){
        const ip=req.headers['x-forwarded-for']?.split(',').at(-1)?.trim()||req.socket.remoteAddress,old=attempts.get(ip);
        if(old&&old.until>Date.now()&&old.count>=10)return send(req,res,429,{error:'로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요.'});
        const b=await body(req),a=createHash('sha256').update(String(b.password||'')).digest(),z=createHash('sha256').update(password).digest();
        if(!timingSafeEqual(a,z)){if(attempts.size>1000)for(const [k,v]of attempts)if(v.until<Date.now())attempts.delete(k);attempts.set(ip,{count:(old?.until>Date.now()?old.count:0)+1,until:Date.now()+900000});return send(req,res,401,{error:'비밀번호를 확인해 주세요.'});}
        attempts.delete(ip);const expires=String(Date.now()+12*3600000),secure=process.env.NODE_ENV==='production'?'; Secure':'';
        return send(req,res,200,{ok:true},undefined,{'set-cookie':`solo_session=${expires}.${sign(expires)}; Path=/solo; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`});
      }
      if(!valid(req)){if(p==='/')return send(req,res,200,login,'text/html; charset=utf-8');return send(req,res,401,{error:'비밀번호를 입력해 주세요.'});}
      if(p==='/logout'&&req.method==='POST')return send(req,res,200,{ok:true},undefined,{'set-cookie':'solo_session=; Path=/solo; HttpOnly; SameSite=Strict; Max-Age=0'});
      if(p==='/api/status'&&req.method==='GET')return send(req,res,200,{app:'starwave-solo-cloud',revision:store.revision,config:{target:{bjId:'2ahgo1203',name:'이아깽'},enabled:collector.enabled},runtime:collector.runtime,storage:'Neon PostgreSQL',usage:usage.snapshot,manual:[...manual].map(([bjId,m])=>({bjId,name:m.name,bno:m.bno,...m.collector.runtime}))});
      if(p==='/api/usage'&&req.method==='GET')return send(req,res,200,usage.snapshot);
      if(p==='/api/manual'&&req.method==='POST'){if(!collector.enabled)return send(req,res,409,{error:'수집이 일시정지돼 있습니다. 먼저 수집을 다시 켜주세요.'});if([...manual.values()].filter(x=>x.collector.enabled).length>=3)return send(req,res,409,{error:'합방은 동시에 최대 3개까지 등록할 수 있습니다.'});const b=await body(req);let target;try{target=await resolveManual(b.url);}catch(e){return send(req,res,400,{error:e.message||'현재 생방송을 확인하지 못했습니다.'});}const old=manual.get(target.bjId);if(old?.collector.enabled)return send(req,res,409,{error:'이미 수집 중인 방송입니다.'});await store.addManual(target.bjId,target.bno,target.name);await restoreManual({bj_id:target.bjId,bno:target.bno,name:target.name});return send(req,res,201,{ok:true,target});}
      if(p==='/api/manual/stop'&&req.method==='POST'){const b=await body(req),m=manual.get(String(b.bjId));if(!m)return send(req,res,404,{error:'등록한 합방 방송이 없습니다.'});await m.collector.enable(false);await store.stopManual(String(b.bjId));m.collector.status('completed');return send(req,res,200,{ok:true});}
      if(p==='/api/preview'&&req.method==='GET')return send(req,res,200,previewReport());
      if(p==='/api/monitor'&&req.method==='POST'){const b=await body(req);if(typeof b.enabled!=='boolean')throw Error('감시 설정을 확인해 주세요.');if(b.enabled&&usage.snapshot?.level==='danger')return send(req,res,409,{error:'전송량이 무료 한도의 90% 이상입니다. 사용량을 확인한 뒤 다음 달 다시 켜주세요.'});await pauseAll(b.enabled);return send(req,res,200,{ok:true});}
      if((p==='/api/report'||p==='/api/export'||p==='/api/backup')&&req.method==='GET'){
        const from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'',id=url.searchParams.get('session')||'';
        if([from,to].some(x=>x&&!/^\d{4}-\d{2}-\d{2}$/.test(x))||(from&&to&&from>to))throw Error('조회 기간을 확인해 주세요.');
        if(p!=='/api/report'){const payload=await store.export(p==='/api/backup'?'':from,p==='/api/backup'?'':to,p==='/api/backup'?'':id);return send(req,res,200,payload,undefined,{'content-disposition':'attachment; filename="starwave-records.json"'});}
        const query=JSON.stringify([from,to,id]),cached=cache.get(query);let value;
        if(cached?.revision===store.revision)value=cached.value;
        else{value=await store.report(from,to,id);if(cache.size>20)cache.clear();cache.set(query,{revision:store.revision,until:Date.now()+30000,value});}
        const etag='"'+createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)+'"';
        if(req.headers['if-none-match']===etag){res.writeHead(304,{'etag':etag,'cache-control':'private, no-cache'});return res.end();}
        return send(req,res,200,value,undefined,{'etag':etag,'cache-control':'private, no-cache'});
      }
      const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      if(files[p]&&req.method==='GET'){const type=p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';return send(req,res,200,fs.readFileSync(path.join(root,'public',files[p])),type);}
      return send(req,res,404,{error:'없는 페이지입니다.'});
    }catch(e){return send(req,res,503,{error:'기록실 처리 오류입니다. 잠시 뒤 다시 시도해 주세요.'});}
  }
  return{handle,store,collector,close:async()=>{usage.close?.();for(const m of manual.values())await m.collector.close();await collector.close();}};
}
