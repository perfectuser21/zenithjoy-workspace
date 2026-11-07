// Test-only actual WS protocol. Abort is explicitly denied, never a stop proof.
import assert from 'node:assert/strict';import {createServer as createHttpServer} from 'node:http';import {createHash} from 'node:crypto';import WS,{WebSocketServer} from 'ws';import {GatewayProtocolClient} from '@openclaw/gateway-client/browser';import {rawDataToString} from '@openclaw/gateway-client/websocket-data';const sha=v=>createHash('sha256').update(v).digest('hex');
export async function startNativeBoundaryGatewayFixture(t,intents){
 const server=createHttpServer(),wss=new WebSocketServer({server}),clients=new Set();let current,workerTurns=0;
 const hidden=run=>'internal-session-effects-'+run+'-'+sha(run).slice(0,16);
 const receipt=run=>({runId:run,sessionId:hidden(run),turnId:'fixture-'+run,requested:{provider:'openai',model:'gpt-6.1-sol'},effective:{provider:'openai',model:'gpt-6.1-sol'},successfulToolNames:[],rerouted:false});
 wss.on('connection',ws=>{clients.add(ws);ws.once('close',()=>clients.delete(ws));ws.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'fixture',ts:Date.now()}}));
  ws.on('message',async raw=>{const frame=JSON.parse(raw);let payload;
   if(frame.method==='connect')payload={protocol:4,server:{version:'2026.9.8'},auth:{role:'operator',scopes:['operator.read','operator.write']}};
   else if(frame.method==='agent'){
    if(frame.params.agentId==='skill-factory')workerTurns++;
    const intent=frame.params.agentId==='work-commander'?{action:'none'}:intents.shift();assert.notEqual(intent,undefined,'no extra Worker/model turn');
    current={run:frame.params.idempotencyKey,key:frame.params.sessionKey,sourceSession:frame.params.sessionId,text:JSON.stringify(typeof intent==='function'?await intent():intent)};
    assert.equal(frame.params.modelRun,true);assert.equal(frame.params.promptMode,'none');assert.equal(frame.params.deliver,false);
    ws.send(JSON.stringify({type:'res',id:frame.id,ok:true,payload:{runId:current.run,status:'accepted'}}));
    payload={runId:current.run,status:'ok',result:{payloads:[{text:current.text}],meta:{agentMeta:{sessionId:hidden(current.run),agentHarnessId:'openclaw',provider:'openai',model:'gpt-6.1-sol',terminalReceipt:receipt(current.run)}}}};
   }else if(frame.method==='agent.wait')payload={runId:current.run,status:'ok',startedAt:Date.now()-10,endedAt:Date.now(),terminalReply:{text:current.text},terminalReceipt:receipt(current.run)};
   else if(frame.method==='sessions.abort'){ws.send(JSON.stringify({type:'res',id:frame.id,ok:false,error:{code:'FIXTURE_STOP_UNAVAILABLE',message:'Boundary fixture deliberately cannot attest a remote abort'}}));return;}
   else if(frame.method==='sessions.list')payload={ts:Date.now(),sessions:[{key:current.key,sessionId:current.sourceSession}]};
   else throw Error('fixture method forbidden: '+frame.method);
   ws.send(JSON.stringify({type:'res',id:frame.id,ok:true,payload}));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const ws of clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));});
 return {fixtureWorkerTurns:()=>workerTurns,GatewayProtocolClient,rawDataToString,WebSocket:class extends WS{constructor(_url,protocols,options){super('ws://127.0.0.1:'+server.address().port,protocols,options);}}};
}

