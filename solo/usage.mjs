const DAY=86400000,GB=1e9;
const dayKey=t=>new Date(t+9*3600000).toISOString().slice(0,10);
export function normalizeBandwidth(series){
  if(!Array.isArray(series))throw Error('Render 사용량 응답 형식을 확인하지 못했습니다.');
  const points=[];
  for(const s of series){const unit=String(s.unit||'').toLowerCase(),scale=({b:1,bytes:1,kb:1e3,mb:1e6,gb:1e9,kib:1024,mib:1024**2,gib:1024**3})[unit];if(!scale)throw Error('Render 사용량 단위를 확인하지 못했습니다: '+unit);
    for(const p of s.values||[]){const at=typeof p.timestamp==='number'?(p.timestamp>1e12?p.timestamp:p.timestamp*1000):Date.parse(p.timestamp),value=Number(p.value);if(!Number.isFinite(at)||!Number.isFinite(value)||value<0)throw Error('사용량 수치가 올바르지 않습니다.');points.push({at,bytes:value*scale});}
  }return points;
}
export function forecastUsage(points,now=Date.now(),limitBytes=5*GB){
  const start=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),1),end=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth()+1,1),daily={};let used=0;
  for(const p of points)if(p.at>=start&&p.at<=now){used+=p.bytes;const day=dayKey(p.at);daily[day]=(daily[day]||0)+p.bytes;}
  const yesterday=dayKey(now-DAY),completed=Object.entries(daily).filter(([d])=>d<dayKey(now)).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7),average=completed.length?completed.reduce((s,[,b])=>s+b,0)/completed.length:used/Math.max((now-start)/DAY,1),projected=used+average*Math.max(0,(end-now)/DAY),percent=used/limitBytes;
  return{checkedAt:new Date(now).toISOString(),month:new Date(start).toISOString().slice(0,7),usedBytes:used,limitBytes,remainingBytes:Math.max(0,limitBytes-used),percent,daily:Object.entries(daily).sort().map(([day,bytes])=>({day,bytes})),yesterdayBytes:daily[yesterday]||0,averageDailyBytes:average,projectedBytes:projected,daysToLimit:average>0?Math.max(0,(limitBytes-used)/average):null,level:percent>=.9?'danger':percent>=.8||projected>limitBytes?'warning':'ok',basis:completed.length?'최근 최대 7개 완료 일자의 평균':'이번 달 경과일 평균',source:'Render API · 워크스페이스 서비스 합산',billingMonthTimezone:'UTC',dailyTimezone:'Asia/Seoul'};
}
export class UsageMonitor{
  constructor(store,{onDanger=async()=>{},fetcher=fetch}={}){this.store=store;this.onDanger=onDanger;this.fetcher=fetcher;this.snapshot={configured:!!process.env.RENDER_API_KEY,level:'unknown',error:'사용량 연결 확인 중'};this.lastCheck=0;this.busy=false;}
  async request(route){const r=await this.fetcher('https://api.render.com/v1'+route,{headers:{authorization:'Bearer '+process.env.RENDER_API_KEY,accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Render 사용량 조회 HTTP '+r.status);return r.json();}
  async start(){this.snapshot=await this.store.usageLatest?.()||this.snapshot;void this.check();this.timer=setInterval(()=>this.check(),3600000);this.timer.unref();}
  async check(force=false){if(this.busy||(!force&&Date.now()-this.lastCheck<6*3600000))return this.snapshot;this.busy=true;
    try{if(!process.env.RENDER_API_KEY){this.snapshot={configured:false,level:'unknown',error:'RENDER_API_KEY를 연결하면 일간 사용량과 예상치를 자동 확인합니다.'};return this.snapshot;}
      const owner=process.env.RENDER_OWNER_ID||'tea-d96nr98js32c739a1eq0';let cursor='',resources=[];
      for(let page=0;page<5;page++){const list=await this.request('/services?ownerId='+encodeURIComponent(owner)+'&limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(list))throw Error('Render 서비스 목록을 확인하지 못했습니다.');resources.push(...list.map(x=>x.service||x).filter(x=>x.id));if(list.length<100)break;cursor=list.at(-1).cursor;if(!cursor)throw Error('Render 서비스 목록이 일부만 반환됐습니다.');}
      if(!resources.length)throw Error('워크스페이스 서비스가 없습니다.');
      const now=Date.now(),d=new Date(now),start=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)).toISOString(),end=new Date(now).toISOString();let points=[];
      for(const service of resources){const p=new URLSearchParams({resource:service.id,startTime:start,endTime:end});points.push(...normalizeBandwidth(await this.request('/metrics/bandwidth?'+p)));}
      this.snapshot={configured:true,...forecastUsage(points,now),resources:resources.map(s=>({id:s.id,name:s.name})),note:'과금 대시보드와 집계 지연·반올림 차이가 있을 수 있습니다. 기존 사이트 사용량도 포함됩니다.'};this.lastCheck=now;await this.store.usageSave(this.snapshot);if(this.snapshot.level==='danger')await this.onDanger();
    }catch(e){console.warn('SOLO usage monitor:',e.message);this.snapshot={...this.snapshot,configured:!!process.env.RENDER_API_KEY,level:'unknown',error:e.message,stale:true};this.lastCheck=Date.now()-5*3600000;}
    finally{this.busy=false;}return this.snapshot;
  }
  close(){clearInterval(this.timer);}
}
