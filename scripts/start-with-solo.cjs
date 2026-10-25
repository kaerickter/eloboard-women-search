// Keep archive startup/routing independent of uploaded server.js contents.
const http=require('node:http');
const archive=require('../solo/integration.cjs');
const createServer=http.createServer;
http.createServer=function(...args){const index=typeof args[0]==='function'?0:1;const handler=args[index];if(typeof handler==='function')args[index]=function(req,res){const p=new URL(req.url,'http://localhost').pathname;if(p==='/solo'||p.startsWith('/solo/'))return archive.handle(req,res);return handler.call(this,req,res);};return createServer.apply(this,args);};
require('../server.js');
