const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
if(!/require\(["']\.\/solo\/integration\.cjs["']\)/.test(source)||!source.includes('return soloArchive.handle(req, res)'))throw Error('방송기록 수집 연결이 빠졌습니다. 기존 배포를 유지하고 server.js의 연결을 복구하세요.');
for(const name of ['integration.cjs','web.mjs','collector.mjs','store.mjs','protocol.mjs'])if(!fs.existsSync(require('node:path').join(__dirname,'../solo',name)))throw Error('수집 필수 파일 누락: '+name);
console.log('Broadcast archive integration guard passed');
