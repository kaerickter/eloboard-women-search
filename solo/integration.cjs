let loaded,retry;
function load() {return loaded ||= import('./web.mjs').then(m=>m.createApp()).then(app=>{console.log('SOLO archive ready: Neon storage, password protected, target 2ahgo1203');return app;}).catch(error=>{console.error('SOLO init:',error.message);loaded=null;if(!retry&&process.env.DATABASE_URL&&process.env.SPAWN_DIARY_ADMIN_PASSWORD){retry=setTimeout(()=>{retry=null;load().catch(()=>{});},15000);retry.unref?.();}throw error;});}
exports.handle = async function(req,res) {
  try {return (await load()).handle(req,res);}
  catch {res.writeHead(503,{'content-type':'text/plain; charset=utf-8','retry-after':'30'});res.end('후원 기록실을 준비하고 있습니다. 잠시 뒤 다시 확인해 주세요.');}
};
if(process.env.DATABASE_URL&&process.env.SPAWN_DIARY_ADMIN_PASSWORD)load().catch(()=>{});
