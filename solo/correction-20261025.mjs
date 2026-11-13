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

// The supplied 2026-11-13 export confirms this one adballoon is absent from
// broadcast 298561509. Keep the correction separate from live packet capture.
export async function applyAdballoonCorrection20261113(pool) {
  const sessionId='799bfab6-c8ae-4ec2-89d3-44e67b6bb404';
  const at='2026-11-13T20:42:35+09:00';
  const eventKey='screenshot:20261113:298561509:204235:adballoon';
  const payload={donor:'쓰리런3',donorId:'',count:1,serviceCode:87,
    source:'user-screenshot-20261113',sourceNote:'사용자 제공 외부 집계 사진과 방송기록 백업 대조로 보완'};
  const result=await pool.query(`INSERT INTO solo_archive.events(session_id,at,kind,event_key,payload)
    SELECT s.id,$1::timestamptz,'adballoon',$2,$3::jsonb
    FROM solo_archive.sessions s
    WHERE s.id=$4 AND s.bno='298561509' AND s.bj_id='2ahgo1203' AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM solo_archive.events e WHERE e.session_id=s.id
        AND e.kind='adballoon' AND e.payload->>'donor'='쓰리런3'
        AND e.payload->>'count'='1'
        AND e.at BETWEEN $1::timestamptz-interval '2 minutes' AND $1::timestamptz+interval '2 minutes')
    ON CONFLICT(event_key) DO NOTHING`,[at,eventKey,JSON.stringify(payload),sessionId]);
  return result.rowCount;
}
