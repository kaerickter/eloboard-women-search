import {getLiveInfo} from './protocol.mjs';
export function parseBroadcastUrl(raw){
  let url;try{url=new URL(String(raw).trim());}catch{throw Error('SOOP 생방송 주소를 입력해 주세요.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw Error('올바른 SOOP 주소를 입력해 주세요.');
  const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);let bjId,bno;
  if(host==='play.sooplive.co.kr'){[bjId,bno]=parts;if(parts.length>2)throw Error('SOOP 생방송 주소만 입력해 주세요.');}
  else if(['sooplive.com','www.sooplive.com'].includes(host)&&parts[0]==='station'&&parts.length===2)bjId=parts[1];
  else if(host==='bj.sooplive.co.kr'&&parts.length===1)bjId=parts[0];
  if(!/^[a-z0-9_]{2,30}$/i.test(bjId||'')||(bno&&!/^\d+$/.test(bno)))throw Error('지원하는 SOOP 방송 주소가 아닙니다. 다시보기 대신 생방송 주소를 넣어 주세요.');
  return{bjId:bjId.toLowerCase(),bno:bno||null};
}
export async function resolveManual(raw,lookup=getLiveInfo){const parsed=parseBroadcastUrl(raw);if(parsed.bjId==='2ahgo1203')throw Error('이아깽 본인 방송은 이미 자동 감시 중입니다.');const info=await lookup(parsed.bjId);if(parsed.bno&&parsed.bno!==String(info.BNO))throw Error('현재 생방송과 다른 방송 번호입니다. 지난 방송은 소급 수집할 수 없습니다.');return{bjId:parsed.bjId,bno:String(info.BNO),name:info.BJNICK||parsed.bjId};}
