import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import WS,{WebSocketServer} from 'ws';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {captureOwnerGatewayRoute,createOwnerReadConnectionFactory} from '../official-owner-read-connection.mjs';
import {loadOfficialGatewayDependencies} from '../official-gateway-dependencies.mjs';
const runtimeRoot=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const source={commit:'a'.repeat(40),files:['official-owner-read-connection.mjs','official-gateway-dependencies.mjs','vendor/official-gateway-sdk.json','vendor/official-gateway-client.mjs','vendor/official-gateway-client.LICENSE.txt'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(runtimeRoot,path))).digest('hex')}))};
async function fixture(t,{noReply=false,shutdown=false,closeMissing=false,invalidFrame,stopThrows=false,authorityRevoked=false}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'owner-read-wire-'))),http=createServer(),wss=new WebSocketServer({server:http}),sockets=new Set(),frames=[];
 let connections=0;
 wss.on('connection',ws=>{connections++;sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'fixture',ts:Date.now()}}));ws.on('message',raw=>{
  const f=JSON.parse(raw);frames.push(f);if(noReply&&f.method!=='connect')return;
  if(invalidFrame&&f.method!=='connect')ws.send(JSON.stringify(invalidFrame==='type'?{type:'junk'}:invalidFrame==='seq'?{type:'event',event:'tick',seq:-1}:{type:'res',id:f.id,payload:{}}));
  if(shutdown&&f.method!=='connect')ws.send(JSON.stringify({type:'event',event:'shutdown'}));
  const payload=f.method==='connect'?{protocol:4,server:{version:'2026.9.8'},auth:{role:'operator',scopes:['operator.read','operator.write']}}:{method:f.method};
  ws.send(JSON.stringify({type:'res',id:f.id,ok:true,payload}));
 });});await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const s of sockets)s.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>http.close(r));rmSync(dir,{recursive:true,force:true});});
 const port=http.address().port,config=join(dir,'config.json'),env={OPENCLAW_CONFIG_PATH:config,OPENCLAW_STATE_DIR:dir,OPENCLAW_GATEWAY_PORT:String(port),OPENCLAW_GATEWAY_TOKEN:'fixture'};
 writeFileSync(config,JSON.stringify({gateway:{port,bind:'loopback',mode:'local',auth:{mode:'token',token:'fixture'}}}),{mode:0o600});
 const deps={...await loadOfficialGatewayDependencies({runtimeRoot,source})};let wire;
 class Socket extends deps.WebSocket{constructor(...args){super(...args);wire=this;if(closeMissing==='request')this._req.once=()=>this._req;else if(closeMissing==='socket'){const once=this._req.once.bind(this._req);this._req.once=(event,fn)=>once(event,event==='socket'?s=>fn({once:()=>{},destroy:()=>s.destroy()}):fn);}}on(event,fn){return closeMissing==='websocket'&&event==='close'?this:super.on(event,fn);}}
 deps.WebSocket=Socket;const Base=deps.GatewayProtocolClient;if(stopThrows)deps.GatewayProtocolClient=class extends Base{stop(){super.stop();throw Error('FIXTURE_STOP_FAILURE');}};
 const options={runtimeRoot,source:structuredClone(source),gatewayRoute:captureOwnerGatewayRoute(env),gatewayDependencies:deps,runtimePolicy:()=>({gateway_version:'2026.9.8'}),authorize:(()=>{let calls=0;return async()=>!authorityRevoked||++calls===1;})()};
 const request={source_commit:source.commit,receipt_deadline_ms:Date.now()+2000},scope={request,parent:'agent:work-commander:fixture',child:{run_id:'child'},assertCurrent:()=>{}};
 return {env,config,frames,scope,options,connections:()=>connections,wire:()=>wire,open:()=>createOwnerReadConnectionFactory(options)(scope)};
}
test('真实SDK单连接只读七次且req/WS/socket全部关闭，没有串到18789',async t=>{
 const f=await fixture(t),c=await f.open();
 const methods=['sessions.describe','chat.history','tools.invoke','sessions.describe','chat.history','tools.invoke','sessions.describe'];
 for(const method of methods){const params=method==='sessions.describe'?{key:f.scope.parent,agentId:'work-commander'}:method==='chat.history'?{sessionKey:f.scope.parent,limit:1}:{name:'subagents',sessionKey:f.scope.parent,args:{action:'list'}};assert.equal((await c.read(method,params)).body.method,method);}
 const proof=await c.close();assert.equal(f.connections(),1);assert.deepEqual(f.frames.map(f=>f.method),['connect',...methods]);
 for(const key of ['request_closed','websocket_closed','socket_closed'])assert.equal(proof[key],true);
 assert.equal(proof.pending_request_count,0);assert.equal(proof.reconnect_count,0);assert.equal(f.wire().readyState,WS.CLOSED);
 assert.equal(JSON.stringify(proof).includes('fixture'),false);await assert.rejects(()=>c.read('sessions.describe',{key:f.scope.parent,agentId:'work-commander'}));
});
for(const drift of ['config','source','scope','state-path','url','missing-port','mismatch-port'])test('固定route/source边界拒绝 '+drift,async t=>{
 const f=await fixture(t);
 if(drift==='config')writeFileSync(f.config,'{}');
 if(drift==='source')f.options.source.commit='b'.repeat(40);
 if(drift==='scope')f.scope.request.source_commit='b'.repeat(40);
 if(drift==='state-path')f.options.gatewayRoute=captureOwnerGatewayRoute({...f.env,OPENCLAW_STATE_DIR:'/missing'});
 if(drift==='url')f.options.gatewayRoute=captureOwnerGatewayRoute({...f.env,OPENCLAW_GATEWAY_URL:'ws://localhost:18789'});
 if(drift==='missing-port')f.options.gatewayRoute=captureOwnerGatewayRoute({...f.env,OPENCLAW_GATEWAY_PORT:undefined});
 if(drift==='mismatch-port')f.options.gatewayRoute=captureOwnerGatewayRoute({...f.env,OPENCLAW_GATEWAY_PORT:'18789'});
 await assert.rejects(f.open);assert.equal(f.connections(),0);
});
for(const action of ['agent','sessions.abort','foreign-parent','parallel','shutdown','no-reply','missing-close','missing-socket-close','missing-websocket-close','stop-throws','authority-revoked','config-after-open','scope-after-open','source-after-open','junk-frame','missing-ok-frame','negative-seq-frame'])test('越权/生命周期失败只unknown且不重连 '+action,async t=>{
 const f=await fixture(t,{shutdown:action==='shutdown',noReply:['no-reply','parallel'].includes(action),closeMissing:action==='missing-close'?'request':action==='missing-socket-close'?'socket':action==='missing-websocket-close'?'websocket':false,stopThrows:action==='stop-throws',authorityRevoked:action==='authority-revoked',invalidFrame:action==='junk-frame'?'type':action==='missing-ok-frame'?'missing-ok':action==='negative-seq-frame'?'seq':undefined});
 if(['no-reply','parallel','missing-close','missing-socket-close','missing-websocket-close'].includes(action))f.scope.request.receipt_deadline_ms=Date.now()+200;
 const c=await f.open(),method='sessions.describe',params={key:f.scope.parent,agentId:'work-commander'};
 if(action==='config-after-open')writeFileSync(f.config,'{}');
 if(action==='scope-after-open')f.scope.request.source_commit='b'.repeat(40);
 if(action==='source-after-open')f.options.source.commit='b'.repeat(40);
 if(['missing-close','missing-socket-close','missing-websocket-close','stop-throws','authority-revoked'].includes(action))await assert.rejects(c.close);
 else if(action==='parallel'){
  const first=assert.rejects(()=>c.read(method,params));await assert.rejects(()=>c.read(method,params));await first;await assert.rejects(c.close);
 }else{await assert.rejects(()=>c.read(['agent','sessions.abort'].includes(action)?action:method,{...params,...(action==='foreign-parent'?{key:'agent:work-commander:other'}:{})}));await assert.rejects(c.close);}
 assert.equal(f.connections(),1);assert.equal(f.frames.some(f=>['agent','sessions.abort'].includes(f.method)),false);assert.equal(f.wire().readyState,WS.CLOSED);
});
