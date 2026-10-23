import WebSocket from 'ws';
import {makePacket,parsePacket,getLiveInfo,BroadcastOfflineError} from './protocol.mjs';
export class Collector {
  constructor(store,options={}){this.bjId=options.bjId||'2ahgo1203';this.expectedBno=options.bno?String(options.bno):null;this.onEnd=options.onEnd;this.store=store;this.socket=null;this.timer=null;this.heartbeat=null;this.leaseTimer=null;this.generation=0;this.enabled=false;this.busy=false;this.queue=Promise.resolve();this.runtime={status:'starting',error:'',lastCheckedAt:null,lastEventAt:null,sessionId:null};}
  status(status,error=''){if(this.runtime.status!==status)console.log('SOLO collector state:',status);this.runtime.status=status;this.runtime.error=error;}
  schedule(ms=30000){clearTimeout(this.timer);if(this.enabled)this.timer=setTimeout(()=>this.check(),Number(process.env.SOLO_CHECK_MS||ms));this.timer?.unref();}
  disconnect(){this.generation++;clearTimeout(this.timer);clearInterval(this.heartbeat);clearInterval(this.leaseTimer);const old=this.socket;this.socket=null;old?.terminate();}
  async enable(enabled){await this.store.enable(enabled);this.disconnect();this.enabled=enabled;this.status(enabled?'waiting':'paused');if(enabled)void this.check();else{await this.queue;await this.store.release();}}
  async check(){
    if(!this.enabled||this.busy||this.socket)return;this.busy=true;const gen=this.generation;
    try{
      this.runtime.lastCheckedAt=new Date().toISOString();const info=await getLiveInfo(this.bjId);if(gen!==this.generation)return;
      if(this.expectedBno&&String(info.BNO)!==this.expectedBno){this.enabled=false;await this.store.end();await this.store.release();this.status('completed');await this.onEnd?.();return;}
      if(!await this.store.lease()){this.status('standby');this.schedule(30000);return;}
      const session=await this.store.session(info);if(gen!==this.generation)return;this.runtime.sessionId=session.id;this.status('connecting');
      const endpoint=process.env.NODE_ENV==='test'&&process.env.SOLO_TEST_SOCKET?process.env.SOLO_TEST_SOCKET:`wss://${info.CHDOMAIN||info.CHIP}${info.CHPT?':'+(Number(info.CHPT)+1):''}/Websocket/${info.BJID||this.bjId}`;
      const ws=new WebSocket(endpoint,'chat',{origin:'https://play.sooplive.co.kr',handshakeTimeout:12000,headers:{referer:`https://play.sooplive.co.kr/${this.bjId}/${info.BNO}`}});this.socket=ws;let alive=Date.now();
      ws.on('open',()=>{if(gen!==this.generation)return;ws.send(makePacket(1,[info.FTK,'',16]));this.heartbeat=setInterval(()=>{if(Date.now()-alive>90000)return ws.terminate();if(ws.readyState===WebSocket.OPEN){ws.send(makePacket(0));ws.ping();}},30000);this.leaseTimer=setInterval(async()=>{try{if(!await this.store.lease())ws.terminate();}catch(e){this.status('error','DB 연결 확인 중');ws.terminate();}},30000);});
      ws.on('pong',()=>alive=Date.now());
      ws.on('message',data=>{if(gen!==this.generation)return;alive=Date.now();const p=parsePacket(data);
        if(p.serviceCode===1){if(p.retCode!==0)return ws.close();return ws.send(makePacket(2,[info.CHATNO,info.FTK,0,'','pver=2&access_system=html5&mode=landing']));}
        if(p.serviceCode===2){if(p.retCode===0)this.status('connected');else ws.close();return;}
        // Serialize writes: settlements must follow their earlier contributions.
        this.queue=this.queue.then(async()=>{
          let kind,payload,key=null;
          if([18,33,105].includes(p.serviceCode)){const offset=p.serviceCode===105?1:0,count=Number(p.fields[3+offset]);if(!Number.isSafeInteger(count)||count<=0)return;kind='regular';payload={donorId:String(p.fields[1+offset]||''),donor:String(p.fields[2+offset]||p.fields[1+offset]||'익명'),count,serviceCode:p.serviceCode};}
          else if(p.serviceCode===87){const count=Number(p.fields[9]);if(p.fields[1]!==this.bjId||!Number.isSafeInteger(count)||count<=0||p.fields[6])return;kind='adballoon';payload={donorId:String(p.fields[2]||''),donor:String(p.fields[3]||p.fields[2]||'익명'),count,serviceCode:87};const packetId=Buffer.from(data).subarray(14,50).toString('utf8');if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(packetId)&&packetId!=='00000000-0000-0000-0000-000000000000')key=this.bjId+':adballoon:'+packetId;}
          else if(p.serviceCode===121){let e;try{e=JSON.parse(p.fields[0]);}catch{return;}if(e.is_relay===true||(e.bj_id&&e.bj_id!==this.bjId))return;
            const earned=e.type==='SETTLE';if(earned){if((!e.uuid&&!/^\d+$/.test(String(e.key)))||!Number.isSafeInteger(e.settle_count)||e.settle_count<=0)return;}else if(!e.uuid||!/^\d+$/.test(String(e.key)))return;
            const battle=e.type==='GIFT'&&e.is_relay===false&&e.bj_id===this.bjId&&/^mission_gift_\d+$/.test(e.image||'');
            if(!earned&&!battle&&!['CHALLENGE_GIFT','CHALLENGE_NOTICE','CHALLENGE_SETTLE'].includes(e.type))return;
            if((battle||e.type==='CHALLENGE_GIFT')&&(!Number.isSafeInteger(e.gift_count)||e.gift_count<=0))return;
            if(e.type==='CHALLENGE_SETTLE'&&(!Number.isSafeInteger(e.settle_count)||e.settle_count<=0))return;
            payload=Object.fromEntries(['type','uuid','key','bj_id','is_relay','image','user_id','user_nick','gift_count','settle_count','title','mission_status'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));kind=earned?'battle-settle':battle?'battle':'challenge';key=earned?this.bjId+':battle-settle:'+(e.uuid||('mission:'+e.key)):this.bjId+':'+e.uuid;
          }else return;
          let retries=0;
          for(;;){try{if(await this.store.record(session,kind,payload,key))this.runtime.lastEventAt=new Date().toISOString();break;}catch(e){this.status('error','DB 저장 재시도 중: '+e.message);ws.terminate();await new Promise(r=>setTimeout(r,Math.min(30000,1000*2**Math.min(retries++,5))));await this.store.lease().catch(()=>{});}}
        }).catch(e=>{this.status('error','후원 저장 실패: '+e.message);ws.terminate();});
      });
      ws.on('error',e=>{if(gen===this.generation)this.status('error',e.message);});
      ws.on('close',()=>{if(gen!==this.generation)return;clearInterval(this.heartbeat);clearInterval(this.leaseTimer);this.socket=null;if(this.runtime.status!=='error')this.status('reconnecting');this.schedule(5000);});
    }catch(e){if(gen!==this.generation)return;if(e instanceof BroadcastOfflineError){if(this.runtime.sessionId||this.expectedBno){await this.queue;await this.store.end();this.runtime.sessionId=null;await this.store.release();}if(this.expectedBno){this.enabled=false;this.status('completed');await this.onEnd?.();}else this.status('waiting');}else this.status('error',e.message);this.schedule(e instanceof BroadcastOfflineError?30000:15000);}
    finally{this.busy=false;if(gen!==this.generation)this.schedule(100);}
  }
  async close(){this.enabled=false;this.disconnect();await this.queue;await this.store.close();}
}
