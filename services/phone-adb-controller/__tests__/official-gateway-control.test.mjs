import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import WS,{WebSocketServer} from 'ws';
import {GatewayProtocolClient} from '@openclaw/gateway-client/browser';import {rawDataToString} from '@openclaw/gateway-client/websocket-data';
import {using} from './fixtures/official-control-fixture.mjs';
async function gateway(t,{delay=false,suppressRequestClose=false}={}){
 const http=createServer(),wss=new WebSocketServer({server:http}),frames=[],sockets=new Set();let seen;const arrived=new Promise(r=>seen=r);
 wss.on('connection',socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'fixture-challenge',ts:Date.now()}}));
  socket.on('message',raw=>{
   const f=JSON.parse(raw);frames.push(f);
   if(f.method==='connect'){
    assert.deepEqual(f.params.scopes,['operator.read']);assert.equal(f.params.auth.token,'fixture-gateway-token');
    socket.send(JSON.stringify({type:'res',id:f.id,ok:true,payload:{protocol:4,server:{version:'fixture'},auth:{role:'operator',scopes:['operator.read']}}}));
   }else{
    seen();if(!delay)socket.send(JSON.stringify({type:'res',id:f.id,ok:true,payload:{ts:Date.now(),sessions:[{key:f.params.search,sessionId:'fixture-session',updatedAt:Date.now()},{key:'foreign-session',sessionId:'not-visible'}]}}));
   }
  });
 });
 await new Promise(r=>http.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>http.close(r));});
 const replay=[];class ClientSocket extends WS{constructor(url,opts){assert.equal(url,'ws://127.0.0.1:18789');super('ws://127.0.0.1:'+http.address().port,opts);if(suppressRequestClose){const req=this._req,emit=req.emit;req.emit=function(event,...args){if(event==='close'){replay.push(()=>emit.call(req,event,...args));return false;}return emit.call(req,event,...args);};}}}
 return {frames,arrived,replay,dependencies:{WebSocket:ClientSocket,GatewayProtocolClient,rawDataToString}};
}
test('官方browser SDK经原Caller授权直连sessions.list，参数仅取原官方child绑定且三close后返回',async t=>{const g=await gateway(t);await using(async({instance,q})=>{const r=await instance.request({kind:'official_agent_read',request:q,operation:'sessions.list'});assert.equal(r.sessions.length,1);assert.equal(r.sessions[0].key,'agent:skill-factory:subagent:fixture');assert.equal(r.official_terminal_proof,false);assert.deepEqual(g.frames.map(f=>f.method),['connect','sessions.list']);assert.equal(g.frames[1].params.agentId,'skill-factory');assert.equal(instance.snapshot().pending,0);assert.equal((await instance.close()).execution_stopped,true);},{gatewayDependencies:g.dependencies,gatewayCredential:()=> 'fixture-gateway-token'});});
test('agent.wait官方要求write scope，读入口不能悄升级或发送其它方法',async t=>{const g=await gateway(t);await using(async({instance,q,count})=>{for(const operation of ['agent.wait','agent','sessions.abort','tools.invoke'])await assert.rejects(instance.request({kind:'official_agent_read',request:q,operation}),/UNSUPPORTED|SCOPE_REQUIRED/);assert.equal(g.frames.length,0);assert.equal(count(),0);},{gatewayDependencies:g.dependencies,gatewayCredential:()=> 'fixture-gateway-token'});});
test('Caller close中止真实在途WS，晚响应不交付；无重新连接',async t=>{const g=await gateway(t,{delay:true});await using(async({instance,q})=>{const work=instance.request({kind:'official_agent_read',request:q,operation:'sessions.list'}),rejected=assert.rejects(work,/CLOSED/);await Promise.race([g.arrived,work]);const s=await instance.close();await rejected;assert.equal(s.pending,0);assert.equal(s.execution_stopped,true);assert.deepEqual(g.frames.map(f=>f.method),['connect','sessions.list']);},{gatewayDependencies:g.dependencies,gatewayCredential:()=> 'fixture-gateway-token'});});
test('WS与socket关闭仍缺HTTP upgrade request close必须unknown，收尾有界',async t=>{const g=await gateway(t,{suppressRequestClose:true});await using(async({instance,q})=>{try{await assert.rejects(instance.request({kind:'official_agent_read',request:q,operation:'sessions.list'}),/DEADLINE|UNKNOWN/);const s=await instance.close();assert.equal(s.execution_stopped,false);assert.equal(s.execution_unknown,true);}finally{for(const f of g.replay)f();}},{shortDeadline:true,gatewayDependencies:g.dependencies,gatewayCredential:()=> 'fixture-gateway-token'});});
