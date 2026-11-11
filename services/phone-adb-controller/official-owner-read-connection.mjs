import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {loadOfficialGatewayDependencies} from './official-gateway-dependencies.mjs';
import {readOfficialGatewayPolicy,verifyOfficialGatewayRuntime} from './official-gateway-runtime.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=()=>Error('OFFICIAL_OWNER_READ_CONNECTION_UNKNOWN');
const routes=new WeakMap();
export function captureOwnerGatewayRoute(environment=process.env){
 const env=Object.freeze({...environment}),route=Object.freeze({environment:env});let pin;
 try{
  const path=env.OPENCLAW_CONFIG_PATH,st=lstatSync(path),bytes=readFileSync(path);
  pin={path,dev:st.dev,ino:st.ino,sha256:hash(bytes)};
 }catch{pin=null;}
 routes.set(route,()=>{
  const port=Number(env.OPENCLAW_GATEWAY_PORT),path=env.OPENCLAW_CONFIG_PATH;
  if(!pin||!/^\d+$/.test(env.OPENCLAW_GATEWAY_PORT||'')||port<1||port>65535||env.OPENCLAW_GATEWAY_URL
   ||!path?.startsWith('/')||realpathSync(path)!==path||!env.OPENCLAW_STATE_DIR?.startsWith('/')
   ||realpathSync(env.OPENCLAW_STATE_DIR)!==env.OPENCLAW_STATE_DIR||!env.OPENCLAW_GATEWAY_TOKEN||/[\r\n]/.test(env.OPENCLAW_GATEWAY_TOKEN))throw fail();
  const st=lstatSync(path),bytes=readFileSync(path),config=JSON.parse(bytes);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.dev!==pin.dev||st.ino!==pin.ino||hash(bytes)!==pin.sha256
   ||config.gateway?.mode!=='local'||config.gateway?.bind!=='loopback'||config.gateway?.port!==port||config.gateway?.remote
   ||config.gateway?.auth?.mode!=='token'||config.gateway?.auth?.token!==env.OPENCLAW_GATEWAY_TOKEN)throw fail();
  return {url:'ws://127.0.0.1:'+port,token:env.OPENCLAW_GATEWAY_TOKEN,config_path:path,config_sha256:pin.sha256};
 });return route;
}
export function createOwnerReadConnectionFactory({runtimeRoot,source,gatewayRoute,authorize=async()=>true,gatewayDependencies,runtimePolicy=readOfficialGatewayPolicy}={}){
 const fixed=structuredClone(source),sourceHash=hash(canonical(fixed)),route=routes.get(gatewayRoute);
 return async({request,parent,child,assertCurrent})=>{
  const end=request.receipt_deadline_ms,scopeHash=hash(canonical(request)),childHash=hash(canonical(child));
  const current=()=>{
   assertCurrent();
   if(Date.now()>=end||hash(canonical(request))!==scopeHash||hash(canonical(child))!==childHash||hash(canonical(source))!==sourceHash||typeof route!=='function')throw fail();
   return route();
  };
  const checkSource=()=>{
   if(runtimeRoot!==dirname(fileURLToPath(import.meta.url))||realpathSync(runtimeRoot)!==runtimeRoot)throw fail();
   if(!Array.isArray(fixed?.files)||request.source_commit!==fixed.commit)throw fail();
   const names=new Set();
   for(const entry of fixed.files){
    if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||names.has(entry.path)||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw fail();
    names.add(entry.path);const path=runtimeRoot+'/'+entry.path,st=lstatSync(path);
    if(!st.isFile()||st.isSymbolicLink()||realpathSync(path)!==path||st.uid!==process.getuid()||(st.mode&0o022)||hash(readFileSync(path))!==entry.sha256)throw fail();
   }
   if(!names.has('official-owner-read-connection.mjs'))throw fail();
   const policy=runtimePolicy({runtimeRoot,source:fixed});
   return policy;
  };
  let ws,req,socket,client,allocations=0,requestClosed=false,websocketClosed=false,socketClosed=false,closing=false,fatal=null,shutdown=false;
  let helloResolve,helloReject,closedResolve,interrupt;const hello=new Promise((r,j)=>{helloResolve=r;helloReject=j;});hello.catch(()=>{});
  const interrupted=new Promise((_,j)=>{interrupt=j;});interrupted.catch(()=>{});const closed=new Promise(r=>{closedResolve=r;});
  const pending=new Map(),seen=new Set();let expected,reading=false,closePromise;
  const marks=()=>({request_closed:requestClosed,websocket_closed:websocketClosed,socket_closed:socketClosed});
  const finish=()=>{if(Object.values(marks()).every(Boolean))closedResolve();};
  const poison=()=>{fatal??=fail();helloReject(fatal);interrupt(fatal);};
  const guard=()=>{current();if(fatal||closing)throw fail();};
  const stop=fn=>{try{fn();}catch{poison();}};
  let timer=setTimeout(()=>{poison();stop(()=>client?.stop());stop(()=>ws?.terminate());stop(()=>req?.destroy());stop(()=>socket?.destroy());},Math.max(0,end-Date.now()));
  const close=()=>closePromise??=(async()=>{
   closing=true;stop(()=>client?.stop());if(ws&&!websocketClosed)stop(()=>ws.terminate());if(req&&!requestClosed)stop(()=>req.destroy());if(socket&&!socketClosed)stop(()=>socket.destroy());
   let closeTimer;if(allocations)await Promise.race([closed,new Promise(r=>{closeTimer=setTimeout(r,Math.max(0,end-Date.now()));})]);clearTimeout(closeTimer);clearTimeout(timer);timer=null;
   current();checkSource();
   let authorityTimer;try{if(await Promise.race([authorize(request),new Promise((_,reject)=>{authorityTimer=setTimeout(()=>reject(fail()),Math.max(0,end-Date.now()));})])!==true)throw fail();}finally{clearTimeout(authorityTimer);}
   current();checkSource();current();
   if(fatal||allocations!==1||pending.size||!Object.values(marks()).every(Boolean))throw fail();
   return Object.freeze({protocol:'official-owner-read-connection/v1',source_sha256:sourceHash,scope_sha256:scopeHash,route_sha256:hash(canonical({url:route().url,config_sha256:route().config_sha256})),connection_count:allocations,reconnect_count:0,pending_request_count:pending.size,...marks(),shutdown_seen:shutdown,restart_seen:false,closed_at_ms:Date.now()});
  })();
  try{
   const selected=current();const policy=checkSource();if(await Promise.race([authorize(request),interrupted])!==true)throw fail();guard();
   const deps=gatewayDependencies??await Promise.race([loadOfficialGatewayDependencies({runtimeRoot,source:fixed}),interrupted]);guard();
   const params={minProtocol:4,maxProtocol:4,client:{id:'cli',version:'2026.8.1',platform:process.platform,mode:'cli',instanceId:randomUUID()},role:'operator',scopes:['operator.read','operator.write'],caps:[],auth:{token:selected.token}};
   expected={method:'connect',params};
   client=new deps.GatewayProtocolClient({createSocket(handlers){
    guard();if(++allocations!==1)throw fail();
    ws=new deps.WebSocket(selected.url,{handshakeTimeout:Math.max(1,end-Date.now()),followRedirects:false,perMessageDeflate:false,maxPayload:2*1024*1024});
    req=ws._req;if(!req)throw fail();req.once('close',()=>{requestClosed=true;finish();});req.once('socket',s=>{socket=s;s.once('close',()=>{socketClosed=true;finish();});if(closing)s.destroy();});
    ws.on('open',handlers.open);ws.on('message',data=>{
     try{
      const text=deps.rawDataToString(data),frame=JSON.parse(text);
      if(!frame||typeof frame!=='object'||Array.isArray(frame)||!['event','res'].includes(frame.type)||frame.type==='event'&&(typeof frame.event!=='string'||!frame.event||frame.seq!==undefined&&(!Number.isInteger(frame.seq)||frame.seq<0))||frame.type==='res'&&(typeof frame.id!=='string'||!frame.id||typeof frame.ok!=='boolean'))throw fail();
      if(frame.type==='event'&&['shutdown','server.shutdown','restart','server.restart'].includes(frame.event)){shutdown=true;throw fail();}
      if(frame.type==='res'){if(!pending.has(frame.id))throw fail();pending.delete(frame.id);}
      handlers.message(text);
     }catch{poison();stop(()=>ws.terminate());}
    });
    ws.on('close',(code,reason)=>{websocketClosed=true;finish();if(!closing)poison();handlers.close(code,reason.toString());});
    ws.on('error',()=>{poison();handlers.error(fail());});
    return {isOpen:()=>ws.readyState===deps.WebSocket.OPEN,send(data){
     guard();const frame=JSON.parse(data);
     if(!expected||pending.size||frame.type!=='req'||typeof frame.id!=='string'||!frame.id||seen.has(frame.id)||frame.method!==expected.method||canonical(frame.params)!==canonical(expected.params))throw fail();
     seen.add(frame.id);pending.set(frame.id,frame.method);expected=null;ws.send(data);
    },close:(code,reason)=>ws.close(code,reason)};
   },createRequestId:randomUUID,buildConnectPlan:context=>{guard();if(typeof context.nonce!=='string'||!context.nonce||!Number.isSafeInteger(context.challengeTs))throw fail();return context;},buildConnectParams:()=>structuredClone(params),
   onHello:helloResolve,onConnectError:poison,onSocketFactoryError:poison,onParseError:poison,resolveClose:()=>({retry:false,notify:true}),onClose:()=>{if(!closing)poison();},handshake:{mode:'require-challenge',timeoutMs:Math.max(1,end-Date.now())},reconnect:{initialMs:100,multiplier:1,maxMs:100},requestTimeoutMs:Math.max(1,end-Date.now())});
   client.start();const accepted=await Promise.race([hello,interrupted]);guard();
   if(accepted.protocol!==4||accepted.auth?.role!=='operator'||canonical(accepted.auth.scopes)!==canonical(params.scopes)||accepted.server?.version!==policy.gateway_version)throw fail();
   if(!gatewayDependencies)verifyOfficialGatewayRuntime({runtimeRoot,source:fixed,gatewayVersion:accepted.server.version});guard();
   const allowed={'sessions.describe':{key:parent,agentId:'work-commander'},'chat.history':{sessionKey:parent,limit:1},'tools.invoke':{name:'subagents',sessionKey:parent,args:{action:'list'}}};
   return Object.freeze({async read(method,args){
    guard();if(reading||!Object.hasOwn(allowed,method)||canonical(args)!==canonical(allowed[method])){poison();throw fail();}
    reading=true;expected={method,params:structuredClone(allowed[method])};const start=Date.now();
    try{const body=await Promise.race([client.request(method,allowed[method],{timeoutMs:Math.max(1,end-Date.now())}),interrupted]);guard();if(pending.size)throw fail();return {body,request_id:[...seen].at(-1),start_ms:start,end_ms:Date.now()};}
    catch{poison();throw fail();}finally{reading=false;}
   },close});
  }catch{
   poison();try{await close();}catch{}throw fail();
  }
 };
}
