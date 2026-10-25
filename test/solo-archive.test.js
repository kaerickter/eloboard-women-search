const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=name=>import(pathToFileURL(path.join(__dirname,'../solo/',name)).href);
test('합방 주소 검증과 지난 방송 거부, 예시 데이터의 분리 및 합계',async()=>{
  const {parseBroadcastUrl,resolveManual}=await load('manual.mjs');
  assert.deepEqual(parseBroadcastUrl('https://play.sooplive.co.kr/guest_bj/123'),{bjId:'guest_bj',bno:'123'});
  assert.equal(parseBroadcastUrl('https://www.sooplive.com/station/guest_bj').bjId,'guest_bj');
  for(const url of ['http://127.0.0.1/guest','https://play.sooplive.co.kr.evil.example/x','https://evil@play.sooplive.co.kr/x','https://vod.sooplive.co.kr/player/123'])assert.throws(()=>parseBroadcastUrl(url));
  const lookup=async()=>({BNO:124,BJNICK:'합방진행자'});
  await assert.rejects(resolveManual('https://play.sooplive.co.kr/guest_bj/123',lookup),/다른 방송 번호/);
  assert.equal((await resolveManual('https://play.sooplive.co.kr/guest_bj/124',lookup)).bno,'124');
  const {previewReport}=await load('sample.mjs'),r=previewReport();assert.equal(r.totals.total,6977);assert.equal(r.totals.battleEarnedTotal,2177);assert.equal(r.totals.adTotal,100);assert.equal(r.donors.reduce((n,d)=>n+d.adTotal,0),100);assert.equal(r.totals.battleTotal,500);assert.equal(r.totals.missionTotal,1200);assert.equal(r.sessions.filter(s=>s.source==='manual').length,1);assert.equal(r.donors.reduce((s,d)=>s+d.total,0),4800);
});
test('무료 사용량: 단위 정규화, 일간 평균과 예측, 한도 임박 시 수집 정지 콜백',async()=>{
  const {normalizeBandwidth,forecastUsage,UsageMonitor}=await load('usage.mjs');const now=Date.parse('2026-10-19T03:00:00Z');
  const points=normalizeBandwidth([{unit:'GB',values:[{timestamp:'2026-10-17T01:00:00Z',value:1},{timestamp:'2026-10-18T01:00:00Z',value:1}]}]);
  const r=forecastUsage(points,now);assert.equal(r.usedBytes,2e9);assert.equal(r.yesterdayBytes,1e9);assert.equal(r.averageDailyBytes,1e9);assert.equal(r.level,'warning');assert.equal(forecastUsage([{at:now-1000,bytes:4.6e9}],now).level,'danger');
  const anchored=forecastUsage(points,now,5e9,{at:Date.parse('2026-10-17T12:00:00Z'),bytes:600e6});assert.equal(anchored.usedBytes,1.6e9);assert.equal(forecastUsage(points,now,5e9,{at:Date.parse('2026-09-30T00:00:00Z'),bytes:600e6}).usedBytes,2e9);
  assert.throws(()=>normalizeBandwidth([{unit:'unknown',values:[]}]));
  const old=process.env.RENDER_API_KEY;process.env.RENDER_API_KEY='temporary-test-key';let stopped=0,saved;
  const store={usageSave:async x=>saved=x};const m=new UsageMonitor(store,{onDanger:async()=>stopped++,fetcher:async url=>({ok:true,json:async()=>url.includes('/services?')?[{service:{id:'srv-example',name:'example'}}]:[{unit:'GB',values:[{timestamp:new Date(Date.now()-1000).toISOString(),value:4.6}]}]})});
  try{await m.check(true);assert.equal(saved.level,'danger');assert.equal(stopped,1);assert.ok(!JSON.stringify(saved).includes('temporary-test-key'));}finally{m.close();if(old===undefined)delete process.env.RENDER_API_KEY;else process.env.RENDER_API_KEY=old;}
});
test('후원기록실 비밀번호 보호, 로그인, API, 304 응답, 로그아웃',async()=>{
  const {createApp}=await load('web.mjs');
  let reads=0,deleted=[];const store={revision:1,deleteSession:async id=>{deleted.push(id);store.revision++;return id==='stored-session';},init:async()=>true,report:async()=>{reads++;return{sessions:[],donors:[],totals:{total:0}};},export:async()=>({events:[]})};
  const collector={runtime:{status:'waiting'},status(){},check(){},enable:async value=>{collector.enabled=value;},close:async()=>{}};
  const app=await createApp({store,collector,password:'test-password-only'}),server=http.createServer(app.handle);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const page=await(await fetch(base+'/solo/')).text();assert.match(page,/type="password"/);assert.doesNotMatch(page,/class="metrics"/);
    for(const p of ['api/report','api/status','api/export','api/backup','app.js'])assert.equal((await fetch(base+'/solo/'+p)).status,401);
    const post=async(p,b,cookie='',origin='')=>fetch(base+'/solo/'+p,{method:'POST',headers:{'content-type':'application/json',cookie,...(origin?{origin}:{})},body:JSON.stringify(b)});
    assert.equal((await post('login',{password:'wrong'})).status,401);
    const auth=await post('login',{password:'test-password-only'}),cookie=auth.headers.get('set-cookie').split(';')[0];assert.match(auth.headers.get('set-cookie'),/HttpOnly/);
    const content=await(await fetch(base+'/solo/',{headers:{cookie}})).text();assert.match(content,/class="metrics"/);
    const first=await fetch(base+'/solo/api/report',{headers:{cookie}});assert.equal(first.status,200);const etag=first.headers.get('etag');
    assert.equal((await fetch(base+'/solo/api/report',{headers:{cookie,'if-none-match':etag}})).status,304);assert.equal(reads,1);
    assert.equal((await post('api/monitor',{enabled:false},cookie,'https://evil.example')).status,403);
    assert.equal((await post('api/monitor',{enabled:false},cookie)).status,200);assert.equal(collector.enabled,false);
    assert.equal((await post('api/session/delete',{id:'stored-session',confirm:true})).status,401);
    assert.equal((await post('api/session/delete',{id:'stored-session',confirm:true},cookie,'https://evil.example')).status,403);
    assert.equal((await post('api/session/delete',{id:'stored-session'},cookie)).status,400);
    collector.enabled=true;collector.runtime.sessionId='stored-session';assert.equal((await post('api/session/delete',{id:'stored-session',confirm:true},cookie)).status,409);assert.deepEqual(deleted,[]);
    collector.enabled=false;assert.equal((await post('api/session/delete',{id:'stored-session',confirm:true},cookie)).status,200);assert.deepEqual(deleted,['stored-session']);
    assert.equal((await fetch(base+'/solo/api/report',{headers:{cookie,'if-none-match':etag}})).status,304);assert.equal(reads,2);
    assert.equal((await post('api/session/delete',{id:'missing',confirm:true},cookie)).status,404);
    assert.equal((await post('logout',{},cookie)).status,200);
    assert.equal((await fetch(base+'/solo/healthz')).status,204);
  }finally{await new Promise(r=>server.close(r));}
});
test('수집기: 오프라인 대기 → 채팅 입장 → 세 종류 후원과 순서 보존',async()=>{
  const {WebSocketServer}=require('ws');let live=false,peer,lease=true;
  const mock=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({CHANNEL:live?{RESULT:1,BNO:100,CHATNO:5,FTK:'secret',BJID:'2ahgo1203'}:{RESULT:-1}}));});mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const wss=new WebSocketServer({port:0,host:'127.0.0.1'});await once(wss,'listening');
  const previous={...process.env};process.env.SOLO_LIVE_API='http://127.0.0.1:'+mock.address().port;process.env.SOLO_TEST_SOCKET='ws://127.0.0.1:'+wss.address().port;process.env.NODE_ENV='test';process.env.SOLO_CHECK_MS='40';
  // Cache-bust protocol import before collector is loaded (the other test doesn't use network).
  const protocol=await load('protocol.mjs'),{Collector}=await load('collector.mjs');
  wss.on('connection',ws=>{peer=ws;ws.on('message',data=>{const p=protocol.parsePacket(data);if(p.serviceCode===1||p.serviceCode===2)ws.send(protocol.makePacket(p.serviceCode));});});
  const rows=[],seen=new Set(),store={enable:async()=>{},lease:async()=>lease,session:async()=>({id:'test-session'}),record:async(s,kind,p,key)=>{if(key&&seen.has(key))return false;if(key)seen.add(key);rows.push({kind,p});return true;},end:async()=>{},release:async()=>{},close:async()=>{}};
  const c=new Collector(store),wait=async fn=>{const until=Date.now()+6000;while(Date.now()<until){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('상태 변경 시간 초과');};
  try{
    await c.enable(true);await wait(()=>c.runtime.status==='waiting');assert.equal(c.socket,null);
    live=true;await wait(()=>c.runtime.status==='connected');peer.send(protocol.makePacket(18,['','donor','후원자','10']));
    const e={type:'CHALLENGE_GIFT',uuid:'a',key:'2',bj_id:'2ahgo1203',is_relay:false,user_id:'donor',user_nick:'후원자',gift_count:30};
    const send=e=>peer.send(protocol.makePacket(121,[JSON.stringify(e)]));send(e);send(e);send({...e,type:'CHALLENGE_SETTLE',uuid:'b',settle_count:30});send({...e,type:'GIFT',uuid:'c',image:'mission_gift_1',gift_count:20});
    const settled={type:'SETTLE',bj_id:'2ahgo1203',uuid:'battle-paid',key:'2',settle_count:2177};send(settled);send(settled);send({...settled,bj_id:'other',uuid:'foreign'});
    const ad=protocol.makePacket(87,['5','2ahgo1203','ad-fan','애드팬','','','','','',17,0,0,0,0]);ad.write('11111111-1111-4111-8111-111111111111',14,'utf8');peer.send(ad);peer.send(ad);peer.send(protocol.makePacket(87,['5','other','foreign','다른방','','','','','',99]));peer.send(protocol.makePacket(87,['5','2ahgo1203','invalid','오류','','','','','',-2]));
    peer.send(protocol.makePacket(105,['5','2ahgo1203','video-fan','영상팬',55]));peer.send(protocol.makePacket(105,['5','other','wrong','다른방',99]));peer.send(protocol.makePacket(105,['5','2ahgo1203','bad','오류',-1]));
    await wait(()=>rows.length===7);assert.deepEqual(rows.map(r=>r.kind),['regular','challenge','challenge','battle','battle-settle','adballoon','regular']);assert.equal(rows[6].p.count,55);assert.equal(rows[6].p.donorId,'video-fan');assert.equal(rows[6].p.giftType,'video');assert.equal(rows[4].p.settle_count,2177);assert.equal(rows[5].p.count,17);assert.equal(rows[5].p.donorId,'ad-fan');assert.equal(rows[0].p.count,10);assert.ok(c.runtime.lastEventAt);assert.ok(!JSON.stringify(rows).includes('secret'));
    await c.enable(false);assert.equal(c.runtime.status,'paused');
    let ended=0;const guestRows=[];const guest=new Collector({...store,record:async(s,k,p)=>{guestRows.push({k,p});return true;}},{bjId:'guest_bj',bno:100,onEnd:async()=>ended++});
    try{await guest.enable(true);await wait(()=>guest.runtime.status==='connected');send({...e,bj_id:'guest_bj',uuid:'guest-mission'});await wait(()=>guestRows.length===1);assert.equal(guestRows[0].p.bj_id,'guest_bj');live=false;peer.close();await wait(()=>guest.runtime.status==='completed');assert.equal(guest.enabled,false);assert.equal(ended,1);}finally{await guest.close();}
  }finally{await c.close();for(const client of wss.clients)client.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>mock.close(r));for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('대결 후원과 실제 획득 분리, 중복·다른 방송·잘못된 정산 거부',async()=>{const {applyBattle}=await load('battle-accounting.mjs'),{accountingView}=await load('mission-accounting.mjs');const state={broadcasts:[{bjId:'a',total:10,events:1}],donors:{a:{}},missions:{},gifts:[]};const e={type:'SETTLE',uuid:'paid',key:'1',bj_id:'a',settle_count:2177};assert.equal(applyBattle(state,'a',e),true);assert.equal(applyBattle(state,'a',e),false);for(const bad of [{...e,uuid:'bad',bj_id:'b'},{...e,uuid:'bad',settle_count:-1},{...e,uuid:'bad',is_relay:true}])assert.equal(applyBattle(state,'a',bad),false);const v=accountingView(state);assert.equal(v.broadcasts[0].total,2187);assert.equal(v.broadcasts[0].battleEarnedTotal,2177);assert.equal(v.broadcasts[0].battleTotal,0);assert.equal(Object.keys(v.donors.a).length,0);});

test('애드벌룬은 일반 별풍선과 구분하고 스트리머·후원자 합계에 한 번 반영',async()=>{const {accountingView}=await load('mission-accounting.mjs');const state={broadcasts:[{bjId:'a',total:10,events:1}],donors:{a:{fan:{donorId:'fan',donor:'팬',total:10,events:1}}},missions:{},gifts:[],adGifts:{one:{bjId:'a',donorId:'fan',donor:'팬',count:17},other:{bjId:'b',donorId:'other',count:99}}};const view=accountingView(state);assert.equal(view.broadcasts[0].total,27);assert.equal(view.broadcasts[0].regularTotal,10);assert.equal(view.broadcasts[0].adTotal,17);assert.equal(view.donors.a.fan.total,27);assert.equal(view.donors.a.fan.adTotal,17);assert.equal(accountingView(state).broadcasts[0].total,27);assert.equal(state.donors.a.fan.total,10);});
