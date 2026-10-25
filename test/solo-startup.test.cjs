const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const guard=fs.readFileSync(path.join(__dirname,'../scripts/check-solo-integration.cjs'),'utf8');
test('수집 연결이 빠진 업로드는 배포 검사에서 거부한다',()=>{
 const run=source=>vm.runInNewContext(guard,{__dirname:path.join(__dirname,'../scripts'),console:{log(){}},require:n=>n==='node:fs'?{readFileSync:()=>source,existsSync:()=>true}:require(n)});
 assert.throws(()=>run('const http=require("node:http");'),/수집 연결/);
 run(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'));
});
test('시작 래퍼가 업로드된 서버와 독립적으로 방송기록을 연결하고 기존 메뉴를 유지한다',()=>{
 let handler,archive=0,ordinary=0;const http={createServer(fn){handler=fn;return {}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/start-with-solo.cjs'),'utf8'),{URL,process:{on(){}},require:n=>{
 if(n==='node:http')return http;if(n==='../solo/integration.cjs')return {handle(){archive++}};
 if(n==='../server.js'){http.createServer(()=>ordinary++);return {};}
 throw Error(n);
 }});
 handler({url:'/solo/'},{});handler({url:'/solo/healthz'},{});handler({url:'/tournament-bracket.html'},{});
 assert.equal(archive,2);assert.equal(ordinary,1);
});
