const $=id=>document.getElementById(id),fmt=n=>Number(n||0).toLocaleString('ko-KR');
for(const name of ['usage','manual'])$('toggle-'+name).addEventListener('click',()=>{const panel=$(name+'-box'),button=$('toggle-'+name);panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));button.textContent=button.textContent.replace(/[▾▴]$/,panel.hidden?'▾':'▴');});
const PREVIEW=new URLSearchParams(location.search).get('preview')==='1';
const date=at=>at?new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token='',selected='',busy=false,lastRender='',lastStatus=null,donorRows=[],sortKey='total',sortDirection=-1;
const koreanDay=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
$('from').value=PREVIEW?'2026-10-17':koreanDay(Date.now()-89*86400000);$('to').value=PREVIEW?'2026-10-18':koreanDay(Date.now());
function fail(e){$('error').hidden=false;$('error').textContent=e.message||String(e);}
async function api(url,options={}){const r=await fetch("/solo"+url,{...options,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}});if(!r.ok){const p=await r.json();throw new Error(p.error||'요청에 실패했습니다.');}return r;}
function query(){return new URLSearchParams({from:$('from').value,to:$('to').value,session:selected});}
async function refresh(){
  if(busy)return;busy=true;
  try{
    const [s,r]=await Promise.all([api('/api/status').then(r=>r.json()),report()]);lastStatus=s;
    $('setup').hidden=!!s.config.target;$('name').textContent=s.config.target?.name||'이아깽';
    const labels={unconfigured:'대상 등록 전',waiting:'방송 시작 대기',connecting:'채팅방 연결 중',connected:'LIVE · 수집 중',reconnecting:'재연결 중',error:'연결 확인 필요',paused:'자동 감시 일시정지',standby:'이전 수집기 종료 대기',completed:'해당 회차 수집 종료'};
    $('live-status').textContent=labels[s.runtime.status]||s.runtime.status;$('live-status').className='badge'+(s.runtime.status==='connected'?' live':'');
    const active=r.sessions.find(x=>x.id===s.runtime.sessionId);
    $('broadcast-title').textContent=active?.title||'방송 시작을 기다리는 기록실';
    $('connection-note').textContent=s.runtime.error||(s.config.enabled?'화면을 닫아도 감시 유지 · 방송 시작 약 30초 이내 감지 · 재접속 자동 시도':'자동 감시가 멈춰 있습니다. 다시 켜면 방송 상태를 확인합니다.');
    $('monitor').textContent=s.config.enabled?'자동 감시 일시정지':'자동 감시 다시 켜기';
    $('last-check').textContent='마지막 방송 확인 '+date(s.runtime.lastCheckedAt)+' · 마지막 후원 수신 '+date(s.runtime.lastEventAt);
    $('storage-size').textContent='Neon 영구 저장 · 한국 시간 기준';
    renderUsage(s.usage);
    $('manual-list').innerHTML=(s.manual||[]).map(m=>`<div class="record"><div class="content"><strong>${esc(m.name)} · ${esc(labels[m.status]||m.status)}</strong><p>@${esc(m.bjId)} · #${esc(m.bno)}</p></div>${m.status!=='completed'?`<button data-stop-manual="${esc(m.bjId)}">수집 종료</button>`:''}</div>`).join('');
    if(PREVIEW){$('tools').hidden=true;$('preview-banner').hidden=false;$('live-status').textContent='가상 기록 미리보기';$('broadcast-title').textContent='본인 방송과 합방이 함께 저장된 예시';$('connection-note').textContent='실제 후원자·후원 금액이 아닌 화면 설명용 가상 데이터입니다.';$('usage-box').hidden=true;$('manual-box').hidden=true;for(const id of ['monitor','export','backup'])$(id).disabled=true;$('last-check').textContent='예시 화면 · 실제 데이터 변경 없음';}
    const sig=JSON.stringify(r);if(sig!==lastRender){lastRender=sig;render(r);}
    $('error').hidden=true;
  }catch(e){fail(e);$('live-status').textContent='수집기 연결 끊김';$('connection-note').textContent='화면 갱신이 중단되었습니다. 수집기 실행 상태를 확인해 주세요.';}finally{busy=false;}
}
function render(r){
  $('scope').textContent=selected?'선택한 방송 회차':`${$('from').value} ~ ${$('to').value}`;
  for(const [id,key]of [['total','total'],['regular','regularTotal'],['challenge','missionTotal'],['battle','battleTotal'],['battle-earned','battleEarnedTotal'],['ad','adTotal']])$(id).textContent=fmt(r.totals[key]);
  $('event-count').textContent=fmt(r.totals.events)+'회 일반 후원';
  $('sessions').className='list'+(r.sessions.length?'':' empty');
  $('sessions').innerHTML=r.sessions.length?r.sessions.map(s=>`<div class="record"><div class="content"><strong>${esc(s.title||'방송 기록')}</strong><p>${s.source==='manual'?'합방 수동':'본인 자동'} · ${esc(s.name||s.bjId||'이아깽')} · ${date(s.startedAt)} · ${s.endedAt?'종료 확인 '+date(s.endedAt):'종료 미확인'} · #${esc(s.bno)}</p></div><b class="amount">${fmt(s.total)}</b><div class="record-actions"><button data-session="${esc(s.id)}">상세</button><button class="danger" data-delete-session="${esc(s.id)}" ${PREVIEW?'disabled title="예시 기록은 삭제할 수 없습니다."':''}>삭제</button></div></div>`).join(''):'선택한 기간에 수집한 방송이 없습니다.';
  const correctionSession=r.sessions.some(s=>s.bno==='298101183');
  const notice=document.getElementById('correction-notice')||document.createElement('p');notice.id='correction-notice';notice.textContent=correctionSession?'10월 25일 기록은 외부 집계 사진으로 누락 4건·1,210개를 보완했습니다. 영상풍선 등 추가 누락 가능성이 있어 완전한 합계가 아닙니다.':'';notice.hidden=!correctionSession;$('feed').before(notice);
  const feed=r.sessions.flatMap(s=>s.recent.map(g=>({...g,broadcastName:s.name}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,35);
  $('feed').className='list'+(feed.length?'':' empty');
  $('feed').innerHTML=feed.length?feed.map(g=>`<div class="record"><div class="content"><strong>${esc(g.donor||g.user_nick||g.title||(g.kind==='battle-settle'?'대결미션 획득':'도전미션'))}</strong><p>${date(g.at)} · ${g.serviceCode===86?'VOD 별풍선 (일반 합계 포함)':g.serviceCode===105?'영상풍선 (일반 합계 포함)':{regular:'일반 별풍선',adballoon:'애드벌룬',battle:'대결미션 후원','battle-settle':'대결미션 획득',challenge:'도전미션'}[g.kind]}${g.type==='CHALLENGE_SETTLE'?' 정산':''}${g.source==='user-screenshot-20261025'?' · 외부 집계 사진 보완':g.source==='user-screenshot-20261031'?' · 알림 사진 보완 (시각은 촬영 기준)':''}</p></div><b class="amount">${fmt(g.count||g.gift_count||g.settle_count)}</b></div>`).join(''):'새로운 후원을 기다리고 있습니다.';
  donorRows=r.donors;renderDonors();
  const missions=r.sessions.flatMap(s=>[...s.missions.map(m=>({...m,kind:'challenge'})),...(s.battleSettlements||[]).map(g=>({...g,title:g.title||'대결미션 획득',kind:'battle-settle'})),...s.battleGifts.map(g=>({...g,title:'대결미션 #'+g.missionId,kind:'battle'}))]);
  $('mission-list').className=missions.length?'':'empty';
  $('mission-list').innerHTML=missions.length?missions.map(m=>`<div class="record"><div class="content"><strong>${esc(m.title||'도전미션 #'+m.missionId)}</strong><p>${m.kind==='battle'?'대결미션 후원 · '+esc(m.donor):m.kind==='battle-settle'?'스트리머 실제 획득 · 정산 반영':'도전미션 · '+esc(({pending:'미정산',success:'성공 · 정산 대기',failed:'실패',cancelled:'취소',settled:'정산 완료',unknown:'상태 확인 필요'})[m.status])}${m.kind==='challenge'?' · 참여 '+fmt(m.contributions.reduce((s,c)=>s+c.count,0))+'개':''}</p></div><span class="amount">${fmt(m.kind==='battle'||m.kind==='battle-settle'?m.count:m.settled)}개</span></div>`).join(''):'아직 수신한 미션이 없습니다.';
}
function sortedDonors(rows){return rows.slice().sort((a,b)=>sortDirection*((Number(a[sortKey])||0)-(Number(b[sortKey])||0))||String(a.donorId||a.donor).localeCompare(String(b.donorId||b.donor),'ko'));}
function renderDonors(){const rows=sortedDonors(donorRows);
  $('donors').innerHTML=rows.length?rows.map((d,i)=>`<tr><td class="rank">${i+1}</td><td>${esc(d.donor)}<div class="muted">${esc(d.donorId)}</div></td><td>${fmt(d.total)}</td><td>${fmt(d.regularTotal)}</td><td>${fmt(d.missionTotal)}</td><td>${fmt(d.adTotal)}</td><td>${fmt(d.battleTotal)}</td></tr>`).join(''):'<tr><td colspan="7" style="text-align:center;color:#9ba5b7">후원 수신 후 순위가 표시됩니다.</td></tr>';
  for(const button of document.querySelectorAll('[data-sort]')){const active=button.dataset.sort===sortKey;button.closest('th').setAttribute('aria-sort',active?(sortDirection===-1?'descending':'ascending'):'none');button.textContent=button.dataset.label+(active?(sortDirection===-1?' ▼':' ▲'):' ↕');}
}
$('ranking').addEventListener('click',e=>{const b=e.target.closest('[data-sort]');if(!b)return;sortDirection=sortKey===b.dataset.sort?-sortDirection:-1;sortKey=b.dataset.sort;renderDonors();});
async function action(fn){try{await fn();lastRender='';await refresh();}catch(e){fail(e);}}
$('register').onclick=()=>action(()=>api('/api/target',{method:'POST',body:JSON.stringify({bjId:'2ahgo1203'})}));
$('monitor').onclick=()=>action(()=>api('/api/monitor',{method:'POST',body:JSON.stringify({enabled:!lastStatus?.config.enabled})}));
$('filter').onclick=()=>{selected='';lastRender='';refresh();};
$('all-sessions').onclick=()=>{selected='';lastRender='';refresh();};
function confirmDelete(title){return new Promise(resolve=>{const dialog=$('delete-dialog');$('delete-record-title').textContent=title;let confirmed=false;$('delete-cancel').onclick=()=>dialog.close();$('delete-confirm').onclick=()=>{confirmed=true;dialog.close();};dialog.onclose=()=>resolve(confirmed);dialog.showModal();});}
$('sessions').onclick=async e=>{const button=e.target.closest('[data-delete-session]');if(button){if(PREVIEW||button.disabled)return;const id=button.dataset.deleteSession,title=button.closest('.record').querySelector('strong').textContent;if(!await confirmDelete(title))return;button.disabled=true;action(async()=>{try{await api('/api/session/delete',{method:'POST',body:JSON.stringify({id,confirm:true})});selected='';reportEtag='';reportCache=null;reportQuery='';}finally{button.disabled=false;}});return;}const id=e.target.closest('[data-session]')?.dataset.session;if(id){selected=id;lastRender='';refresh();}};
$('access').onclick=async()=>{await api('/logout',{method:'POST',body:'{}'});location.reload();};
async function download(url,name){const response=await api(url),blob=await response.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function textExport(payload){const r=payload.report,clean=v=>String(v??'').replace(/[\t\r\n]+/g,' '),lines=['이아깽 방송기록','조회 기간: '+$('from').value+' ~ '+$('to').value,'정산 반영 합계: '+fmt(r.totals.total)+'개','일반: '+fmt(r.totals.regularTotal)+'개 / 도전 정산: '+fmt(r.totals.missionTotal)+'개 / 대결 획득: '+fmt(r.totals.battleEarnedTotal)+'개','애드벌룬: '+fmt(r.totals.adTotal)+'개','대결 후원(정산 합계 제외): '+fmt(r.totals.battleTotal)+'개','','[방송 회차]'];for(const x of r.sessions)lines.push([clean(x.title),clean(x.name),date(x.startedAt),'방송번호 '+x.bno,fmt(x.total)+'개'].join(' | '));lines.push('','[후원자 순위]','순위\t후원자\t아이디\t합계\t일반\t도전 정산\t애드벌룬\t대결 후원');sortedDonors(r.donors).forEach((d,i)=>lines.push([i+1,clean(d.donor),clean(d.donorId),d.total||0,d.regularTotal||0,d.missionTotal||0,d.adTotal||0,d.battleTotal||0].join('\t')));lines.push('','※ 대결 획득은 스트리머 정산액이며 후원자별로 임의 배분하지 않습니다.','','[수신 기록]');for(const e of payload.events||[]){const p=e.payload||{};lines.push([date(e.at),clean(p.serviceCode===86?'VOD 별풍선':p.serviceCode===105?'영상풍선':({regular:'일반',adballoon:'애드벌룬',battle:'대결 후원','battle-settle':'대결 획득',challenge:'도전미션'})[e.kind]||e.kind),clean(p.type),clean(p.donor||p.user_nick||p.donorId||p.user_id),clean(p.title),p.settle_count??p.count??p.gift_count??'',clean(p.mission_status),clean(p.key)].join(' | '));}return lines.join('\r\n');}
$('export').onclick=()=>action(async()=>{const payload=await(await api('/api/export?'+query())).json(),session=selected&&payload.report.sessions.find(x=>x.id===selected),day=session?koreanDay(Date.parse(session.startedAt)):($('from').value===$('to').value?$('from').value:$('from').value+'_'+$('to').value),blob=new Blob(['\uFEFF'+textExport(payload)],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=day+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
$('backup').onclick=()=>action(()=>download('/api/backup','starwave-all-records.json'));
setTimeout(refresh,0);setInterval(()=>{if(!document.hidden&&!PREVIEW)refresh();},5000);

let reportCache=null,reportEtag='',reportQuery=''; async function report(){const q=query().toString();const r=await fetch(PREVIEW?'/solo/api/preview':('/solo/api/report?'+q),{headers:q===reportQuery&&reportEtag?{'if-none-match':reportEtag}:{}});if(r.status===304&&reportCache)return reportCache;if(r.status===401){location.reload();throw Error('다시 로그인해 주세요.');}if(!r.ok)throw Error('기록을 불러오지 못했습니다.');reportQuery=q;reportEtag=r.headers.get('etag')||'';reportCache=await r.json();if(PREVIEW&&selected){const sessions=reportCache.sessions.filter(s=>s.id===selected);reportCache={...reportCache,sessions,donors:(sessions[0]?.donors||[]).slice().sort((a,b)=>b.total-a.total||b.battleTotal-a.battleTotal),totals:sessions.reduce((p,s)=>{for(const k of Object.keys(p))p[k]+=s[k]||0;return p;},{total:0,regularTotal:0,missionTotal:0,battleTotal:0,battleEarnedTotal:0,adTotal:0,events:0})};}return reportCache;}


function size(bytes){return bytes>=1e9?(bytes/1e9).toFixed(2)+' GB':(bytes/1e6).toFixed(1)+' MB';}
function renderUsage(u){$('usage-values').hidden=!u?.configured||u.level==='unknown';if(!u?.configured||u.level==='unknown'){$('usage-message').textContent=u?.error||'사용량 API 연결 확인 중';return;}$('usage-used').textContent=size(u.usedBytes)+' / 5 GB';$('usage-left').textContent=size(u.remainingBytes);$('usage-yesterday').textContent=size(u.yesterdayBytes);$('usage-forecast').textContent=size(u.projectedBytes);$('usage-progress').value=Math.min(100,u.percent*100);$('usage-message').textContent=({ok:'무료 범위 안에서 사용 중',warning:'무료 한도 주의: 월말 예상 또는 누적 사용량을 확인해 주세요.',danger:'무료 한도 90% 이상: 자동·합방 수집이 일시정지됩니다.'})[u.level]||u.level;$('usage-basis').textContent=u.basis+' · 워크스페이스 서비스 합산 · '+date(u.checkedAt)+' 확인 · '+(u.note||'');$('usage-days').innerHTML=(u.daily||[]).map(d=>'<div class="record"><span class="content">'+esc(d.day)+'</span><b>'+size(d.bytes)+'</b></div>').join('');}
$('manual-form').onsubmit=e=>{e.preventDefault();if(PREVIEW)return;action(async()=>{await api('/api/manual',{method:'POST',body:JSON.stringify({url:$('manual-url').value})});$('manual-url').value='';});};
$('manual-list').onclick=e=>{const bjId=e.target.closest('[data-stop-manual]')?.dataset.stopManual;if(bjId&&!PREVIEW)action(()=>api('/api/manual/stop',{method:'POST',body:JSON.stringify({bjId})}));};
