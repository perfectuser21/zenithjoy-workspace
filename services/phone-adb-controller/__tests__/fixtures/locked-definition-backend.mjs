// Test transport for Cecelia immutable-history v1. Historical rows are sealed;
// Task and current internalAuth token remain mutable. The middleware is exact e3.
import assert from'node:assert/strict';import{createServer,request}from'node:http';import{mkdirSync}from'node:fs';import{join}from'node:path';
import{internalAuthOrLoopback}from'./cecelia-e3-internal-auth.mjs';
export async function lockedBackend(f,probe,{windowMs}={}){
 f.lockHistory();const oldToken=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='synthetic-lock-token';
 const state={clientToken:'synthetic-lock-token',fault:null,requests:[],closed:[],credentials:0},sockets=new Set();
 const authPath='/api/brain/projections/notion/directory/status';
 const server=createServer((req,res)=>{
  state.requests.push({method:req.method,path:req.url});res.setHeader('Connection','close');res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const respond=()=>{if(state.fault?.(req,res)===true)return;if(req.method==='HEAD'&&req.url===authPath){res.setHeader('Content-Type','application/json');res.setHeader('Content-Length','2538');res.end();return;}if(req.method!=='GET'){res.status(405).json({error:'METHOD'});return;}const value=f.routes.get(req.url);res.status(value?200:404).json(value??{error:'UNKNOWN'});};
  if(req.url===authPath||req.url.endsWith('/definition'))internalAuthOrLoopback(req,res,respond);else respond();
 });
 server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const directory=join(f.journalDirectory,'locked-native');mkdirSync(directory,{mode:0o700});
 const options={...f.options,journalDirectory:directory,...(windowMs?{deadlineMs:Date.now()+windowMs,cleanupDeadlineMs:Date.now()+windowMs+500}:{}),credential:()=>{state.credentials++;return state.clientToken;},httpRequest:(opts,cb)=>{assert.equal(opts.hostname,'127.0.0.1');assert.equal(opts.port,5221);if(opts.method==='HEAD')assert.equal(opts.path,authPath);else assert.equal(opts.method,'GET');const req=request({...opts,port:server.address().port},cb);req.once('socket',s=>s.once('close',()=>state.closed.push({method:opts.method,path:opts.path})));return req;}};
 const control=f.createNativeControl(options);try{return await probe({control,options,state,directory,authPath,rotate(){process.env.CECELIA_INTERNAL_TOKEN='rotated-lock-token';},clear(){state.requests.length=0;state.closed.length=0;state.credentials=0;}});}finally{await control.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));if(oldToken===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=oldToken;}
}
