import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {applyMission,accountingView} from './mission-accounting.mjs';
import {applyBattle} from './battle-accounting.mjs';
export class Store {
  constructor(connectionString){this.pool=new pg.Pool({connectionString,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:15000});this.cache=new Map();this.revision=Date.now();this.owner=randomUUID();this.bjId='2ahgo1203';this.root=this;this.pool.on('error',e=>{this.error=e.message;});}
  scope(bjId){const s=Object.create(this);s.bjId=bjId;s.root=this.root;return s;}
  changed(){this.root.revision++;}
  async init(){await this.pool.query(`CREATE SCHEMA IF NOT EXISTS solo_archive;
    CREATE TABLE IF NOT EXISTS solo_archive.settings(id integer PRIMARY KEY CHECK(id=1),enabled boolean NOT NULL DEFAULT true);
    INSERT INTO solo_archive.settings VALUES(1,true) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS solo_archive.sessions(id text PRIMARY KEY,bno text NOT NULL UNIQUE,name text,title text,started_at timestamptz NOT NULL,ended_at timestamptz);
    CREATE TABLE IF NOT EXISTS solo_archive.events(id bigserial PRIMARY KEY,session_id text NOT NULL REFERENCES solo_archive.sessions(id),at timestamptz NOT NULL,kind text NOT NULL,event_key text UNIQUE,payload jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS solo_event_session ON solo_archive.events(session_id,id);
    CREATE INDEX IF NOT EXISTS solo_session_date ON solo_archive.sessions(started_at);
    CREATE TABLE IF NOT EXISTS solo_archive.lease(id integer PRIMARY KEY CHECK(id=1),owner text NOT NULL,expires_at timestamptz NOT NULL);
    ALTER TABLE solo_archive.sessions ADD COLUMN IF NOT EXISTS bj_id text NOT NULL DEFAULT '2ahgo1203';
    ALTER TABLE solo_archive.sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    ALTER TABLE solo_archive.sessions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto';
    CREATE TABLE IF NOT EXISTS solo_archive.target_leases(bj_id text PRIMARY KEY,owner text NOT NULL,expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS solo_archive.manual_targets(bj_id text PRIMARY KEY,bno text NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true);
    CREATE TABLE IF NOT EXISTS solo_archive.usage_snapshots(at timestamptz PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS solo_archive.usage_points(resource text NOT NULL,at timestamptz NOT NULL,bytes double precision NOT NULL,PRIMARY KEY(resource,at));
    CREATE TABLE IF NOT EXISTS solo_archive.usage_baselines(month text PRIMARY KEY,at timestamptz NOT NULL,bytes double precision NOT NULL);`);
    if(/^\d{4}-\d{2}$/.test(process.env.SOLO_BASELINE_MONTH||'')&&Number.isFinite(Number(process.env.SOLO_BASELINE_BYTES))&&process.env.SOLO_BASELINE_AT)await this.pool.query('INSERT INTO solo_archive.usage_baselines VALUES($1,$2,$3) ON CONFLICT(month) DO NOTHING',[process.env.SOLO_BASELINE_MONTH,process.env.SOLO_BASELINE_AT,Number(process.env.SOLO_BASELINE_BYTES)]);
    return(await this.pool.query('SELECT enabled FROM solo_archive.settings WHERE id=1')).rows[0].enabled;}
  async lease(){if(this.bjId==='2ahgo1203')return(await this.pool.query(`INSERT INTO solo_archive.lease VALUES(1,$1,now()+interval '90 seconds') ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE solo_archive.lease.owner=$1 OR solo_archive.lease.expires_at<now() RETURNING owner`,[this.owner])).rowCount===1;return(await this.pool.query(`INSERT INTO solo_archive.target_leases VALUES($1,$2,now()+interval '90 seconds') ON CONFLICT(bj_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE solo_archive.target_leases.owner=$2 OR solo_archive.target_leases.expires_at<now() RETURNING owner`,[this.bjId,this.owner])).rowCount===1;}
  async release(){if(this.bjId==='2ahgo1203')await this.pool.query('UPDATE solo_archive.lease SET expires_at=now() WHERE owner=$1',[this.owner]);else await this.pool.query('UPDATE solo_archive.target_leases SET expires_at=now() WHERE bj_id=$1 AND owner=$2',[this.bjId,this.owner]);}
  async enable(value){if(this.bjId==='2ahgo1203')await this.pool.query('UPDATE solo_archive.settings SET enabled=$1 WHERE id=1',[value]);}
  async manualTargets(){return(await this.pool.query('SELECT * FROM solo_archive.manual_targets WHERE active=true')).rows;}
  async addManual(bjId,bno,name){await this.pool.query('INSERT INTO solo_archive.manual_targets VALUES($1,$2,$3,true) ON CONFLICT(bj_id) DO UPDATE SET bno=excluded.bno,name=excluded.name,active=true',[bjId,bno,name]);}
  async stopManual(bjId){await this.pool.query('UPDATE solo_archive.manual_targets SET active=false WHERE bj_id=$1',[bjId]);}
  async usageSave(data){await this.pool.query('INSERT INTO solo_archive.usage_snapshots VALUES(now(),$1)',[JSON.stringify(data)]);}
  async usageLatest(){return(await this.pool.query('SELECT data FROM solo_archive.usage_snapshots ORDER BY at DESC LIMIT 1')).rows[0]?.data||null;}
  async usagePoints(points,start,end){if(points.length)await this.pool.query(`INSERT INTO solo_archive.usage_points SELECT resource,at,bytes FROM jsonb_to_recordset($1::jsonb) AS x(resource text,at timestamptz,bytes double precision) ON CONFLICT(resource,at) DO UPDATE SET bytes=GREATEST(solo_archive.usage_points.bytes,excluded.bytes)`,[JSON.stringify(points.map(p=>({resource:p.resource,at:new Date(p.at).toISOString(),bytes:p.bytes})))]);return(await this.pool.query('SELECT at,bytes FROM solo_archive.usage_points WHERE at>=$1 AND at<=$2',[start,end])).rows.map(p=>({at:p.at.getTime(),bytes:p.bytes}));}
  async usageBaseline(month){const b=(await this.pool.query('SELECT * FROM solo_archive.usage_baselines WHERE month=$1',[month])).rows[0];return b?{at:b.at.getTime(),bytes:b.bytes}:null;}
  async session(info){
    const bno=String(info.BNO);
    const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('UPDATE solo_archive.sessions SET ended_at=COALESCE(ended_at,now()) WHERE bj_id=$2 AND bno<>$1 AND ended_at IS NULL',[bno,this.bjId]);
      const s=(await c.query(`INSERT INTO solo_archive.sessions(id,bno,name,title,started_at,ended_at,bj_id,source) VALUES($1,$2,$3,$4,now(),NULL,$5,$6) ON CONFLICT(bno) DO UPDATE SET ended_at=NULL RETURNING *`,[randomUUID(),bno,info.BJNICK||this.bjId,info.TITLE||'',this.bjId,this.bjId==='2ahgo1203'?'auto':'manual'])).rows[0];await c.query('COMMIT');this.changed();return s;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async end(){await this.pool.query('UPDATE solo_archive.sessions SET ended_at=now() WHERE bj_id=$1 AND ended_at IS NULL',[this.bjId]);this.changed();}
  async record(session,kind,payload,eventKey=null){const result=await this.pool.query(`INSERT INTO solo_archive.events(session_id,at,kind,event_key,payload) SELECT $1,now(),$2,$3,$4 WHERE EXISTS(SELECT 1 FROM solo_archive.lease WHERE $6='2ahgo1203' AND id=1 AND owner=$5 AND expires_at>now() UNION ALL SELECT 1 FROM solo_archive.target_leases WHERE bj_id=$6 AND owner=$5 AND expires_at>now()) ON CONFLICT(event_key) DO NOTHING`,[session.id,kind,eventKey,JSON.stringify(payload),this.owner,this.bjId]);if(result.rowCount){this.changed();return true;}if(eventKey&&(await this.pool.query('SELECT 1 FROM solo_archive.events WHERE event_key=$1',[eventKey])).rowCount)return false;throw Error('수집기 저장 잠금 만료');}
  async deleteSession(id){const result=await this.pool.query('UPDATE solo_archive.sessions SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id',[id]);if(result.rowCount){this.cache.delete(id);this.changed();}return result.rowCount>0;}
  async report(from='',to='',id=''){
    const sessions=(await this.pool.query(`SELECT s.*,COALESCE((SELECT MAX(e.id) FROM solo_archive.events e WHERE e.session_id=s.id),0)::text AS version FROM solo_archive.sessions s WHERE s.deleted_at IS NULL AND ($1='' OR (started_at AT TIME ZONE 'Asia/Seoul')::date >= NULLIF($1,'')::date) AND ($2='' OR (started_at AT TIME ZONE 'Asia/Seoul')::date <= NULLIF($2,'')::date) AND ($3='' OR s.id=$3) ORDER BY started_at DESC`,[from,to,id])).rows;
    const reports=[];
    for(const s of sessions){const bjId=s.bj_id;let r=this.cache.get(s.id);if(!r||r.version!==s.version){
      const rows=(await this.pool.query('SELECT * FROM solo_archive.events WHERE session_id=$1 ORDER BY id',[s.id])).rows;
      const state={broadcasts:[{bjId,name:s.name,total:0,events:0}],donors:{[bjId]:{}},gifts:[],missions:{},battleGifts:{}};
      const recent=[];
      for(const row of rows){const p=row.payload,at=row.at.toISOString();if(row.kind==='regular'){state.broadcasts[0].total+=p.count;state.broadcasts[0].events++;const d=state.donors[bjId][p.donorId||p.donor]||={donorId:p.donorId,donor:p.donor,total:0,events:0};d.total+=p.count;d.events++;}else{applyMission(state,bjId,p,at);applyBattle(state,bjId,p,at);}recent.push({at,kind:row.kind,...p});}
      const view=accountingView(state);r={version:s.version,...view.broadcasts[0],donors:Object.values(view.donors[bjId]),missions:Object.values(state.missions),battleGifts:Object.values(state.battleGifts),recent:recent.slice(-100).reverse()};this.cache.set(s.id,r);
    }reports.push({...r,id:s.id,bno:s.bno,title:s.title,name:s.name,bjId,source:s.source,startedAt:s.started_at.toISOString(),endedAt:s.ended_at?.toISOString()||null});}
    const ranking=new Map(),totals={total:0,regularTotal:0,missionTotal:0,battleTotal:0,events:0};
    for(const r of reports){for(const k of Object.keys(totals))totals[k]+=r[k]||0;for(const d of r.donors){const k=d.donorId||d.donor,p=ranking.get(k)||{...d,total:0,regularTotal:0,missionTotal:0,battleTotal:0,events:0};for(const f of ['total','regularTotal','missionTotal','battleTotal','events'])p[f]+=d[f]||0;ranking.set(k,p);}}
    return{sessions:reports,donors:[...ranking.values()].sort((a,b)=>b.total-a.total||b.battleTotal-a.battleTotal),totals};
  }
  async export(from,to,id){const report=await this.report(from,to,id);const ids=report.sessions.map(s=>s.id);const events=(await this.pool.query('SELECT * FROM solo_archive.events WHERE session_id=ANY($1::text[]) ORDER BY id',[ids])).rows;return{exportedAt:new Date().toISOString(),report,events};}
  async close(){await this.release();if(this.root===this)await this.pool.end();}
}
