import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScreenshotCorrection,correctionRows} from '../solo/correction-20261025.mjs';
test('사진 보완은 지정 회차에 4건 1210개만 추가하고 재실행 시 중복하지 않는다',async()=>{
 const saved=new Map();let released=0;const client={release(){released++},async query(sql,p=[]){
 if(sql.startsWith('SELECT id FROM'))return {rows:[{id:'today'}],rowCount:1};
 if(sql.startsWith('SELECT 1 FROM'))return {rows:[],rowCount:saved.has(p[0])?1:0};
 if(sql.startsWith('SELECT payload'))return {rows:p[0]==='김윤환'?[{id:'existing-donor'}]:[],rowCount:0};
 if(sql.startsWith('INSERT INTO')){assert.equal(p[0],'today');saved.set(p[2],{at:p[1],...JSON.parse(p[3])});return {rowCount:1};}
 return {rows:[],rowCount:0};}};
 const pool={connect:async()=>client};assert.equal(await applyScreenshotCorrection(pool),4);assert.equal(await applyScreenshotCorrection(pool),0);
 assert.equal([...saved.values()].reduce((s,e)=>s+e.count,0),1210);assert.equal(saved.size,4);assert.equal(released,2);
 assert.equal([...saved.values()][0].donorId,'existing-donor');assert.ok([...saved.values()].every(e=>e.source==='user-screenshot-20261025'&&e.at.endsWith('+09:00')));
 assert.equal(correctionRows.length,4);
});
