// User supplied screenshot 2026-10-31 005827.png; exact event time/user ID unavailable.
export async function applyVodScreenshotCorrection(pool){
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(20261031,298227301)');
 const session=(await c.query("SELECT id FROM solo_archive.sessions WHERE bno='298227301' AND bj_id='2ahgo1203' AND deleted_at IS NULL")).rows[0];
 if(!session){await c.query('COMMIT');return 0;}
 const key='screenshot:20261031:298227301:005827:vod-1';
 const existing=await c.query("SELECT 1 FROM solo_archive.events WHERE event_key=$1 OR (session_id=$2 AND payload->>'serviceCode'='86' AND payload->>'donor'=$3 AND payload->>'count'='1' AND at BETWEEN '2026-10-31T00:53:27+09:00' AND '2026-10-31T01:03:27+09:00')",[key,session.id,'퇴근포근']);
 let added=0;if(!existing.rowCount){const known=(await c.query("SELECT payload->>'donorId' AS id FROM solo_archive.events WHERE payload->>'donor'=$1 AND COALESCE(payload->>'donorId','')<>'' ORDER BY id DESC LIMIT 1",['퇴근포근'])).rows[0];
 const payload={donor:'퇴근포근',donorId:known?.id||'',count:1,serviceCode:86,giftType:'vod',source:'user-screenshot-20261031',approximateAt:true,sourceNote:'사용자 제공 VOD 별풍선 1개 알림 사진 보완 · 시각은 스크린샷 촬영 시각 기준이며 정확한 후원 시각은 미확인',correctedAt:new Date().toISOString()};
 added=(await c.query("INSERT INTO solo_archive.events(session_id,at,kind,event_key,payload) VALUES($1,'2026-10-31T00:58:27+09:00','regular',$2,$3) ON CONFLICT(event_key) DO NOTHING",[session.id,key,JSON.stringify(payload)])).rowCount;}
 await c.query('COMMIT');return added;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
