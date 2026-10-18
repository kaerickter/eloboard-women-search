const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=name=>import(pathToFileURL(path.join(__dirname,'../solo/',name)).href);
test('후원기록실 비밀번호 보호, 로그인, API, 304 응답, 로그아웃',async()=>{
  const {createApp}=await load('web.mjs');
  let reads=0;const store={revision:1,init:async()=>true,report:async()=>{reads++;return{sessions:[],donors:[],totals:{total:0}};},export:async()=>({events:[]})};
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
    await wait(()=>rows.length===4);assert.deepEqual(rows.map(r=>r.kind),['regular','challenge','challenge','battle']);assert.equal(rows[0].p.count,10);assert.ok(c.runtime.lastEventAt);assert.ok(!JSON.stringify(rows).includes('secret'));
    await c.enable(false);assert.equal(c.runtime.status,'paused');
  }finally{await c.close();for(const client of wss.clients)client.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>mock.close(r));for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
