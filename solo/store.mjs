import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {applyMission,accountingView} from './mission-accounting.mjs';
import {applyBattle} from './battle-accounting.mjs';
export class Store {
  constructor(connectionString){this.pool=new pg.Pool({connectionString,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:15000});this.cache=new Map();this.revision=Date.now();this.owner=randomUUID();this.pool.on('error',e=>{this.error=e.message;});}
  async init(){await this.pool.query(`CREATE SCHEMA IF NOT EXISTS solo_archive;
    CREATE TABLE IF NOT EXISTS solo_archive.settings(id integer PRIMARY KEY CHECK(id=1),enabled boolean NOT NULL DEFAULT true);
    INSERT INTO solo_archive.settings VALUES(1,true) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS solo_archive.sessions(id text PRIMARY KEY,bno text NOT NULL UNIQUE,name text,title text,started_at timestamptz NOT NULL,ended_at timestamptz);
    CREATE TABLE IF NOT EXISTS solo_archive.events(id bigserial PRIMARY KEY,session_id text NOT NULL REFERENCES solo_archive.sessions(id),at timestamptz NOT NULL,kind text NOT NULL,event_key text UNIQUE,payload jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS solo_event_session ON solo_archive.events(session_id,id);
    CREATE INDEX IF NOT EXISTS solo_session_date ON solo_archive.sessions(started_at);
    CREATE TABLE IF NOT EXISTS solo_archive.lease(id integer PRIMARY KEY CHECK(id=1),owner text NOT NULL,expires_at timestamptz NOT NULL);`);return(await this.pool.query('SELECT enabled FROM solo_archive.settings WHERE id=1')).rows[0].enabled;}
  async lease(){return(await this.pool.query(`INSERT INTO solo_archive.lease VALUES(1,$1,now()+interval '90 seconds') ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE solo_archive.lease.owner=$1 OR solo_archive.lease.expires_at<now() RETURNING owner`,[this.owner])).rowCount===1;}
  async release(){await this.pool.query('UPDATE solo_archive.lease SET expires_at=now() WHERE owner=$1',[this.owner]);}
  async enable(value){await this.pool.query('UPDATE solo_archive.settings SET enabled=$1 WHERE id=1',[value]);}
  async session(info){
    const bno=String(info.BNO);
    const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('UPDATE solo_archive.sessions SET ended_at=COALESCE(ended_at,now()) WHERE bno<>$1 AND ended_at IS NULL',[bno]);
      const s=(await c.query(`INSERT INTO solo_archive.sessions VALUES($1,$2,$3,$4,now(),NULL) ON CONFLICT(bno) DO UPDATE SET ended_at=NULL RETURNING *`,[randomUUID(),bno,info.BJNICK||'이아깽',info.TITLE||''])).rows[0];await c.query('COMMIT');this.revision++;return s;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async end(){await this.pool.query('UPDATE solo_archive.sessions SET ended_at=now() WHERE ended_at IS NULL');this.revision++;}
  async record(session,kind,payload,eventKey=null){const result=await this.pool.query(`INSERT INTO solo_archive.events(session_id,at,kind,event_key,payload) SELECT $1,now(),$2,$3,$4 WHERE EXISTS(SELECT 1 FROM solo_archive.lease WHERE id=1 AND owner=$5 AND expires_at>now()) ON CONFLICT(event_key) DO NOTHING`,[session.id,kind,eventKey,JSON.stringify(payload),this.owner]);if(result.rowCount){this.revision++;return true;}if(eventKey&&(await this.pool.query('SELECT 1 FROM solo_archive.events WHERE event_key=$1',[eventKey])).rowCount)return false;throw Error('수집기 저장 잠금 만료');}
  async report(from='',to='',id=''){
    const sessions=(await this.pool.query(`SELECT s.*,COALESCE((SELECT MAX(e.id) FROM solo_archive.events e WHERE e.session_id=s.id),0)::text AS version FROM solo_archive.sessions s WHERE ($1='' OR (started_at AT TIME ZONE 'Asia/Seoul')::date >= NULLIF($1,'')::date) AND ($2='' OR (started_at AT TIME ZONE 'Asia/Seoul')::date <= NULLIF($2,'')::date) AND ($3='' OR s.id=$3) ORDER BY started_at DESC`,[from,to,id])).rows;
    const reports=[];
    for(const s of sessions){let r=this.cache.get(s.id);if(!r||r.version!==s.version){
      const rows=(await this.pool.query('SELECT * FROM solo_archive.events WHERE session_id=$1 ORDER BY id',[s.id])).rows;
      const state={broadcasts:[{bjId:'2ahgo1203',name:s.name,total:0,events:0}],donors:{'2ahgo1203':{}},gifts:[],missions:{},battleGifts:{}};
      const recent=[];
      for(const row of rows){const p=row.payload,at=row.at.toISOString();if(row.kind==='regular'){state.broadcasts[0].total+=p.count;state.broadcasts[0].events++;const d=state.donors['2ahgo1203'][p.donorId||p.donor]||={donorId:p.donorId,donor:p.donor,total:0,events:0};d.total+=p.count;d.events++;}else{applyMission(state,'2ahgo1203',p,at);applyBattle(state,'2ahgo1203',p,at);}recent.push({at,kind:row.kind,...p});}
      const view=accountingView(state);r={version:s.version,...view.broadcasts[0],donors:Object.values(view.donors['2ahgo1203']),missions:Object.values(state.missions),battleGifts:Object.values(state.battleGifts),recent:recent.slice(-100).reverse()};this.cache.set(s.id,r);
    }reports.push({...r,id:s.id,bno:s.bno,title:s.title,name:s.name,startedAt:s.started_at.toISOString(),endedAt:s.ended_at?.toISOString()||null});}
    const ranking=new Map(),totals={total:0,regularTotal:0,missionTotal:0,battleTotal:0,events:0};
    for(const r of reports){for(const k of Object.keys(totals))totals[k]+=r[k]||0;for(const d of r.donors){const k=d.donorId||d.donor,p=ranking.get(k)||{...d,total:0,regularTotal:0,missionTotal:0,battleTotal:0,events:0};for(const f of ['total','regularTotal','missionTotal','battleTotal','events'])p[f]+=d[f]||0;ranking.set(k,p);}}
    return{sessions:reports,donors:[...ranking.values()].sort((a,b)=>b.total-a.total||b.battleTotal-a.battleTotal),totals};
  }
  async export(from,to,id){const report=await this.report(from,to,id);const ids=report.sessions.map(s=>s.id);const events=(await this.pool.query('SELECT * FROM solo_archive.events WHERE session_id=ANY($1::text[]) ORDER BY id',[ids])).rows;return{exportedAt:new Date().toISOString(),report,events};}
  async close(){await this.release();await this.pool.end();}
}
