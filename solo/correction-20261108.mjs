// Three missing gifts documented by the user in the 2026-11-09 screenshot.
const gifts=[['179414926449324','23:47:44'],['179414926840827','23:47:48'],['179414927146432','23:47:51']];
export async function applyNovemberScreenshotCorrection(pool){
 const c=await pool.connect();let added=0;
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(20261108,298443701)');
  const session=(await c.query("SELECT id FROM solo_archive.sessions WHERE bno='298443701' AND bj_id='2ahgo1203' AND deleted_at IS NULL")).rows[0];
  if(session){
   const donor='삼오삼오사';
   const known=(await c.query("SELECT payload->>'donorId' AS id FROM solo_archive.events WHERE session_id=$1 AND kind='regular' AND payload->>'donor'=$2 AND COALESCE(payload->>'donorId','')<>'' ORDER BY id DESC LIMIT 1",[session.id,donor])).rows[0];
   for(const [externalId,time] of gifts){
    const at='2026-11-08T'+time+'+09:00',key='screenshot:20261108:298443701:'+externalId;
    const present=await c.query("SELECT 1 FROM solo_archive.events WHERE event_key=$1 OR (session_id=$2 AND kind='regular' AND payload->>'donor'=$3 AND payload->>'count'='101' AND at >= $4::timestamptz AND at < $4::timestamptz + interval '1 second')",[key,session.id,donor,at]);
    if(present.rowCount)continue;
    const payload={donor,donorId:known?.id||'',count:101,externalId,source:'user-screenshot-20261108',sourceNote:'사용자 제공 외부 집계 사진 보완',correctedAt:new Date().toISOString()};
    added+=(await c.query("INSERT INTO solo_archive.events(session_id,at,kind,event_key,payload) VALUES($1,$2,'regular',$3,$4) ON CONFLICT(event_key) DO NOTHING",[session.id,at,key,JSON.stringify(payload)])).rowCount;
   }
  }
  await c.query('COMMIT');return added;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
