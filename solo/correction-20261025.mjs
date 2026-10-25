// User-authorized transcription of the supplied 2026-10-25 17:10:16 screenshot.
// External list excludes video gifts and is not a complete broadcast total.
export const correctionRows = [
  {externalId:'179291344811668',time:'16:30:48',donor:'김윤환',count:100},
  {externalId:'179291352118486',time:'16:32:01',donor:'억까는안함',count:100},
  {externalId:'179291352432191',time:'16:32:04',donor:'서진fiia',count:10},
  {externalId:'179291542180038',time:'17:03:41',donor:'뉴다막퀸깽즈',count:1000}
];
export async function applyScreenshotCorrection(pool) {
  const c=await pool.connect();let inserted=0;
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(20261025,298101183)");
    const session=(await c.query("SELECT id FROM solo_archive.sessions WHERE bno='298101183' AND bj_id='2ahgo1203' AND deleted_at IS NULL")).rows[0];
    if(!session){await c.query('COMMIT');return 0;}
    for(const row of correctionRows){
      const at='2026-10-25T'+row.time+'+09:00',key='screenshot:20261025:298101183:'+row.externalId;
      const present=await c.query("SELECT 1 FROM solo_archive.events WHERE event_key=$1 OR (session_id=$2 AND kind='regular' AND payload->>'donor'=$3 AND (payload->>'count')::int=$4 AND at BETWEEN $5::timestamptz-interval '3 seconds' AND $5::timestamptz+interval '3 seconds')",[key,session.id,row.donor,row.count,at]);
      if(present.rowCount)continue;
      const known=(await c.query("SELECT payload->>'donorId' AS id FROM solo_archive.events WHERE payload->>'donor'=$1 AND COALESCE(payload->>'donorId','')<>'' ORDER BY id DESC LIMIT 1",[row.donor])).rows[0];
      const payload={donor:row.donor,donorId:known?.id||'',count:row.count,source:'user-screenshot-20261025',externalId:row.externalId,sourceNote:'사용자 제공 외부 집계 사진으로 보완 · 영상풍선 미포함 · 전체 정확성 미확인',correctedAt:new Date().toISOString()};
      inserted+=(await c.query("INSERT INTO solo_archive.events(session_id,at,kind,event_key,payload) VALUES($1,$2,'regular',$3,$4) ON CONFLICT(event_key) DO NOTHING",[session.id,at,key,JSON.stringify(payload)])).rowCount;
    }
    await c.query('COMMIT');return inserted;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
