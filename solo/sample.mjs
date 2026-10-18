import {applyMission,accountingView} from './mission-accounting.mjs';
import {applyBattle} from './battle-accounting.mjs';
export function previewReport(){
  const sessions=[];
  for(const [i,bjId,name,regular,settled,battle]of [[0,'2ahgo1203','이아깽',[1200,800],500,300],[1,'sample_host','합방 진행자(예시)',[600,900],700,200]]){
    const at=`2026-10-${18-i}T12:00:00.000Z`,state={broadcasts:[{bjId,name,total:regular[0]+regular[1],events:2}],donors:{[bjId]:{sample_a:{donorId:'sample_a',donor:'별빛팬(예시)',total:regular[0],events:1},sample_b:{donorId:'sample_b',donor:'응원팬(예시)',total:regular[1],events:1}}},gifts:[],missions:{},battleGifts:{}};
    const donor=i?'sample_b':'sample_a',event={type:'CHALLENGE_GIFT',bj_id:bjId,is_relay:false,key:String(900+i),uuid:'example-gift-'+i,user_id:donor,user_nick:i?'응원팬(예시)':'별빛팬(예시)',gift_count:settled,title:i?'합방 3승 도전(예시)':'오늘의 승리 미션(예시)'};
    applyMission(state,bjId,event,at);applyMission(state,bjId,{...event,type:'CHALLENGE_SETTLE',uuid:'example-settle-'+i,settle_count:settled},at);
    applyBattle(state,bjId,{...event,type:'GIFT',uuid:'example-battle-'+i,image:'mission_gift_1',user_id:'sample_c',user_nick:'미션팬(예시)',gift_count:battle},at);
    const v=accountingView(state);sessions.push({...v.broadcasts[0],id:'preview-'+i,bno:String(100000+i),source:i?'manual':'auto',bjId,name,title:i?'함께하는 팀 대결 · 합방 예시':'이아깽의 저녁 방송 · 예시',startedAt:at,endedAt:at,donors:Object.values(v.donors[bjId]),missions:Object.values(state.missions),battleGifts:Object.values(state.battleGifts),recent:[{kind:'regular',at,donor:'별빛팬(예시)',count:regular[0]},{kind:'regular',at,donor:'응원팬(예시)',count:regular[1]},{kind:'challenge',at,...event,type:'CHALLENGE_SETTLE',settle_count:settled},{kind:'battle',at,donor:'미션팬(예시)',count:battle}]});
  }
  const donors=new Map(),totals={total:0,regularTotal:0,missionTotal:0,battleTotal:0,events:0};for(const s of sessions){for(const k of Object.keys(totals))totals[k]+=s[k]||0;for(const d of s.donors){const p=donors.get(d.donorId)||{...d,total:0,regularTotal:0,missionTotal:0,battleTotal:0,events:0};for(const k of ['total','regularTotal','missionTotal','battleTotal','events'])p[k]+=d[k]||0;donors.set(d.donorId,p);}}
  return{preview:true,sessions,donors:[...donors.values()].sort((a,b)=>b.total-a.total),totals};
}
