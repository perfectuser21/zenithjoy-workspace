import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {using} from './official-control-fixture.mjs';
import assert from 'node:assert/strict';
import {createServer as createTcpServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {createHash} from 'node:crypto';
import WS,{WebSocketServer} from 'ws';
import {GatewayProtocolClient} from '@openclaw/gateway-client/browser';
import {rawDataToString} from '@openclaw/gateway-client/websocket-data';

const sha=value=>createHash('sha256').update(value).digest('hex');
const shellFrame=(id,bytes)=>{const header=Buffer.alloc(5);header[0]=id;header.writeUInt32LE(bytes.length,1);return Buffer.concat([header,bytes]);};
const syncFrame=(id,bytes=Buffer.alloc(0))=>{const header=Buffer.alloc(8);header.write(id);header.writeUInt32LE(bytes.length,4);return Buffer.concat([header,bytes]);};

// A real ADB host protocol endpoint, never a macro/Worker result substitute.
// Every device response is explicitly synthetic and remains fixture-only.
export async function startNativePhoneAdbFixture(t,{serial,readFile,command}){
 const sockets=new Set(),requests=[];
 const server=createTcpServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));
  let phase='host',pending=Buffer.alloc(0),shellCommand;
  const fatal=error=>{socket.destroy(error);};
  socket.on('data',bytes=>{pending=Buffer.concat([pending,bytes]);void (async()=>{
   try{while(true){
    if(phase==='host'||phase==='selected'){
     if(pending.length<4)return;const length=parseInt(pending.subarray(0,4).toString(),16);assert.ok(Number.isSafeInteger(length)&&length>0);
     if(pending.length<length+4)return;const service=pending.subarray(4,length+4).toString();pending=pending.subarray(length+4);requests.push(service);
     if(service==='host:version'){socket.end('OKAY00040029');return;}
     if(service==='host:devices'){const body=serial+'\tdevice\n';socket.end('OKAY'+Buffer.byteLength(body).toString(16).padStart(4,'0')+body);return;}
     if(service==='host-serial:'+serial+':features'){socket.end('OKAY0008shell_v2');return;}
     if(phase==='host'){assert.equal(service,'host:transport:'+serial);phase='selected';socket.write('OKAY');continue;}
     if(service==='sync:'){phase='sync';socket.write('OKAY');continue;}
     assert.ok(service.startsWith('shell,v2,raw:'));shellCommand=service.slice('shell,v2,raw:'.length);phase='shell';socket.write('OKAY');continue;
    }
    if(phase==='shell'){
     if(pending.length<5)return;const id=pending[0],length=pending.readUInt32LE(1);if(pending.length<5+length)return;
     const body=pending.subarray(5,5+length);pending=pending.subarray(5+length);assert.equal(id,4);assert.equal(body.length,0);phase='finished';
     const result=await command(shellCommand);assert.ok(result&&Buffer.isBuffer(result.stdout));
     socket.end(Buffer.concat([shellFrame(1,result.stdout),shellFrame(2,result.stderr||Buffer.alloc(0)),shellFrame(3,Buffer.from([result.exit??0]))]));return;
    }
    if(phase==='sync'){
     if(pending.length<8)return;const id=pending.subarray(0,4).toString(),length=pending.readUInt32LE(4);if(pending.length<8+length)return;
     const path=pending.subarray(8,8+length).toString();pending=pending.subarray(8+length);requests.push({id,path});
     if(id==='QUIT'){assert.equal(length,0);socket.end();return;}
     assert.equal(id,'RECV');const actual=await readFile(path);assert.ok(Buffer.isBuffer(actual));socket.write(Buffer.concat([syncFrame('DATA',actual),syncFrame('DONE')]));continue;
    }
    return;
   }}catch(error){fatal(error);}
  })();});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 return {endpoint:'tcp:127.0.0.1:'+server.address().port,requests};
}

// Only text and official SDK terminal messages are synthetic. All protocol
// clients, source checks, receipt issuers and parent-loop brands stay real.
export async function startNativePhoneGatewayFixture(t,intents){
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
   else if(frame.method==='sessions.list')payload={ts:Date.now(),sessions:[{key:current.key,sessionId:current.sourceSession}]};
   else throw Error('fixture method forbidden: '+frame.method);
   ws.send(JSON.stringify({type:'res',id:frame.id,ok:true,payload}));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const ws of clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));});
 return {fixtureWorkerTurns:()=>workerTurns,GatewayProtocolClient,rawDataToString,WebSocket:class extends WS{constructor(_url,protocols,options){super('ws://127.0.0.1:'+server.address().port,protocols,options);}}};
}

// Loopback-only public ingress. The actual Handler, private Caller brands and
// distributed Skill bytes are loaded from the isolated runtime copy.
export async function usingNativePhonePublic(t,fn){
 return using(async f=>{
  f.q.serial='192.0.2.31:10001';f.routes.get('/api/brain/tasks/'+f.q.task_id).payload.device_serial=f.q.serial;
  const workflow=await import(pathToFileURL(join(f.runtimeRoot,'leadgen-workflow.mjs')));
  const env={HOME:f.options.home,WFR_RUN_DIR:join(f.runtimeRoot,'..'),WFR_TAG:f.q.run_tag,
   WFR_RUN_ID:f.q.run_id.replace(/__a1$/,''),WFR_ATTEMPT:'a1',P:f.q.profile,SERIAL:f.q.serial,
   WFR_HOSTKEY:'mmv',LEADGEN_LINE:f.q.line,LEADGEN_LIMIT:String(f.q.limit),
   WF_BRAIN_WORKFLOW:f.q.workflow_key,WF_BRAIN_TASK_ID:f.q.task_id,
   WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'600',
   LEADGEN_EXECUTION_MODE:'agent',LEADGEN_EXECUTION_TRANSPORT:'raw-model-v1',LEADGEN_MAX_TURNS:'64'};
  const frozen={execution_mode:'agent',execution_transport:'raw-model-v1',
   deployment:{source_commit:f.source.commit,target:'mmv'},agent_input:{workflow_key:f.q.workflow_key}};
  const handlers=workflow.createWorkflowHandlers({root:f.runtimeRoot,env,frozen,
   taskId:f.q.task_id,sourceCommit:f.source.commit,
   rpc:async()=>{throw Error('NO_OUTER_RPC');},execute:async()=>{throw Error('NO_OUTER_EXEC');}});
  return fn({...f,workflow,env,frozen,handlers});
 },{rawTransport:true,phone:true});
}
