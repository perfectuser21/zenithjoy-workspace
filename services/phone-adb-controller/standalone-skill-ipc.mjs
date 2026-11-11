// 本机单步工具传输；不启动模型或工作流，不签发业务完成/原生进程停止证明。
import {createServer,request} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {join,dirname,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {realpathSync,lstatSync,mkdtempSync,chmodSync,openSync,closeSync,fstatSync,readFileSync,writeFileSync,fsyncSync,unlinkSync,rmdirSync,existsSync,constants} from 'node:fs';
// 覆盖合法的≤2MiB指标JSON及≤1MiB原生XML；整个请求仍以4MiB字节硬上限拒绝。
const PROTOCOL='standalone-skill-ipc/v1',MAX_REQUEST=4*1024*1024,MAX_RESPONSE=8*1024*1024;
// 必须逐项审查，不允许按前缀或透传原始异常文本。
const PROVIDER_ERRORS=new Set(['EPOCH_STANDALONE_IDENTITY','EPOCH_SOURCE_COMPATIBILITY','EPOCH_BUSINESS_TASK','EPOCH_BUSINESS_BINDING','EPOCH_BUSINESS_TASK_RUN','EPOCH_BUSINESS_CENTRAL','EPOCH_LOCAL_HANDOFF','EPOCH_SOURCE_POLICY','EPOCH_LIVE_ROUTES','STANDALONE_NATIVE_ACCOUNT','STANDALONE_NATIVE_CARD','STANDALONE_NATIVE_CARD_IDENTITY','STANDALONE_NATIVE_COMMAND','STANDALONE_TOOL_QUOTA','STANDALONE_TOOL_COMMIT_UNKNOWN','STANDALONE_TOOL_KEYWORD','STANDALONE_TOOL_FILTER_SCOPE','STANDALONE_TOOL_BUSY','STANDALONE_TOOL_EVIDENCE_REUSED']);
const ERRORS=new Set([...PROVIDER_ERRORS,'IPC_REQUEST_INVALID','IPC_AUTHORITY','IPC_BUSY','IPC_CALL_FAILED','IPC_CLOSED','IPC_TIMEOUT','IPC_TRANSPORT','IPC_CONNECTION_INVALID','IPC_RESPONSE_INVALID']);
const fail=code=>{throw Object.assign(Error(code),{code});};
function privateDirectory(directory,code){
 try{const stat=lstatSync(directory);if(!isAbsolute(directory)||realpathSync(directory)!==directory||stat.isSymbolicLink()||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)fail(code);return stat;}catch{fail(code);}
}
function sameFile(a,b){return a.dev===b.dev&&a.ino===b.ino;}
function privateRead(path){
 let fd;
 try{
  if(!isAbsolute(path)||realpathSync(path)!==path)fail('IPC_CONNECTION_INVALID');privateDirectory(dirname(path),'IPC_CONNECTION_INVALID');
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const before=fstatSync(fd);
  if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o777)!==0o600||before.nlink!==1||before.size>4096)fail('IPC_CONNECTION_INVALID');
  const bytes=readFileSync(fd,'utf8'),after=fstatSync(fd),named=lstatSync(path);
  if(!sameFile(before,named)||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('IPC_CONNECTION_INVALID');
  return {bytes,stat:before};
 }catch{fail('IPC_CONNECTION_INVALID');}finally{if(fd!==undefined)closeSync(fd);}
}
function validBody(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='input,operation'&&typeof value.operation==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(value.operation)&&value.input&&typeof value.input==='object'&&!Array.isArray(value.input);}
function equalNonce(actual,expected){return typeof actual==='string'&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
export async function serveStandaloneSkillTools({directory,call}){
 const directoryStat=privateDirectory(directory,'IPC_DIRECTORY_INVALID');if(typeof call!=='function')fail('IPC_REQUEST_INVALID');
 const connectionPath=join(directory,'connection.json'),nonce=randomBytes(32).toString('hex');
 const tempRoot=realpathSync(process.platform==='darwin'?'/tmp':tmpdir()),socketDirectory=mkdtempSync(join(tempRoot,'zj-skill-'));
 chmodSync(socketDirectory,0o700);const socket=join(socketDirectory,'tool.sock');
 let busy=false,closed=false,closing,active,connectionStat,socketStat;
 const connection={protocol:PROTOCOL,socket,nonce},connectionBytes=JSON.stringify(connection)+'\n';
 function current(){
  if(closed)fail('IPC_CLOSED');const d=privateDirectory(directory,'IPC_CONNECTION_INVALID');if(!sameFile(d,directoryStat))fail('IPC_CONNECTION_INVALID');
  const c=privateRead(connectionPath);if(!sameFile(c.stat,connectionStat)||c.bytes!==connectionBytes)fail('IPC_CONNECTION_INVALID');
 }
 const server=createServer(async(req,res)=>{
  const reply=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json','connection':'close'});res.end(JSON.stringify(value));};
  try{current();}catch{return reply(503,{ok:false,error:'IPC_CLOSED'});}
  if(req.method!=='POST'||req.url!=='/tool'||req.headers['content-type']!=='application/json'){req.resume();return reply(400,{ok:false,error:'IPC_REQUEST_INVALID'});}
  if(!equalNonce(req.headers['x-standalone-nonce'],nonce)){req.resume();return reply(403,{ok:false,error:'IPC_AUTHORITY'});}
  const chunks=[];let size=0;
  try{for await(const bytes of req){size+=bytes.length;if(size>MAX_REQUEST){req.resume();return reply(413,{ok:false,error:'IPC_REQUEST_INVALID'});}chunks.push(bytes);}}catch{return reply(400,{ok:false,error:'IPC_REQUEST_INVALID'});}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{ok:false,error:'IPC_REQUEST_INVALID'});}
  if(!validBody(body))return reply(400,{ok:false,error:'IPC_REQUEST_INVALID'});
  if(busy)return reply(409,{ok:false,error:'IPC_BUSY'});busy=true;
  try{current();active=Promise.resolve().then(()=>call(body.operation,body.input));const result=await active,encoded=JSON.stringify({ok:true,result});if(Buffer.byteLength(encoded)>MAX_RESPONSE)fail('IPC_CALL_FAILED');reply(200,JSON.parse(encoded));}
  catch(error){reply(500,{ok:false,error:PROVIDER_ERRORS.has(error?.code)?error.code:'IPC_CALL_FAILED'});}finally{busy=false;active=undefined;}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1;
 try{
  if(Buffer.byteLength(socket)>100)fail('IPC_DIRECTORY_INVALID');
  await new Promise((yes,no)=>{server.once('error',no);server.listen(socket,yes);});chmodSync(socket,0o600);socketStat=lstatSync(socket);
  const fd=openSync(connectionPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,connectionBytes);fsyncSync(fd);connectionStat=fstatSync(fd);}finally{closeSync(fd);}
 }catch(error){
  if(server.listening)await new Promise(r=>server.close(r));
  if(existsSync(socket))unlinkSync(socket);rmdirSync(socketDirectory);throw error;
 }
 const close=()=>closing??=(async()=>{
  closed=true;const inFlight=active;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  if(inFlight)await inFlight.catch(()=>{}); // 仅等待provider返回，不据此签原生停止正证。
  const d=privateDirectory(directory,'IPC_CONNECTION_INVALID');if(!sameFile(d,directoryStat))fail('IPC_CONNECTION_INVALID');
  const c=privateRead(connectionPath);if(!sameFile(c.stat,connectionStat)||c.bytes!==connectionBytes)fail('IPC_CONNECTION_INVALID');unlinkSync(connectionPath);
  if(existsSync(socket)){const actual=lstatSync(socket);if(!sameFile(actual,socketStat))fail('IPC_CONNECTION_INVALID');unlinkSync(socket);}
  rmdirSync(socketDirectory);
  if(existsSync(connectionPath)||existsSync(socket))fail('IPC_CONNECTION_INVALID');return {ipc_closed:true};
 })();
 return {connectionPath,close};
}
export async function callStandaloneSkillTool(connectionPath,operation,input,{timeoutMs=360000}={}){
 const record=privateRead(connectionPath);let c;
 try{c=JSON.parse(record.bytes);}catch{fail('IPC_CONNECTION_INVALID');}
 if(!c||Object.keys(c).sort().join(',')!=='nonce,protocol,socket'||c.protocol!==PROTOCOL||!isAbsolute(c.socket)||!/^([a-f0-9]{64})$/.test(c.nonce||''))fail('IPC_CONNECTION_INVALID');
 privateDirectory(dirname(c.socket),'IPC_CONNECTION_INVALID');
 try{const socket=lstatSync(c.socket);if(!socket.isSocket()||socket.isSymbolicLink()||socket.uid!==process.getuid()||(socket.mode&0o777)!==0o600)fail('IPC_CONNECTION_INVALID');}catch{fail('IPC_CONNECTION_INVALID');}
 const body={operation,input};if(!validBody(body)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>360000)fail('IPC_REQUEST_INVALID');
 let raw;try{raw=JSON.stringify(body);}catch{fail('IPC_REQUEST_INVALID');}if(Buffer.byteLength(raw)>MAX_REQUEST)fail('IPC_REQUEST_INVALID');
 return new Promise((resolve,reject)=>{
  let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const req=request({socketPath:c.socket,path:'/tool',method:'POST',agent:false,headers:{'content-type':'application/json','x-standalone-nonce':c.nonce,'content-length':Buffer.byteLength(raw)}},res=>{
   const chunks=[];let size=0;res.on('data',bytes=>{size+=bytes.length;if(size>MAX_RESPONSE){res.destroy();finish(Object.assign(Error('IPC_RESPONSE_INVALID'),{code:'IPC_RESPONSE_INVALID'}));}else chunks.push(bytes);});
   res.on('error',()=>finish(Object.assign(Error('IPC_TRANSPORT'),{code:'IPC_TRANSPORT'})));
   res.on('end',()=>{let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return finish(Object.assign(Error('IPC_RESPONSE_INVALID'),{code:'IPC_RESPONSE_INVALID'}));}
    if(res.statusCode===200&&value?.ok===true&&Object.keys(value).sort().join(',')==='ok,result')return finish(null,value);
    const code=ERRORS.has(value?.error)?value.error:'IPC_RESPONSE_INVALID';finish(Object.assign(Error(code),{code}));
   });
  });
  const timer=setTimeout(()=>{finish(Object.assign(Error('IPC_TIMEOUT'),{code:'IPC_TIMEOUT'}));req.destroy();},timeoutMs);
  req.on('error',()=>finish(Object.assign(Error('IPC_TRANSPORT'),{code:'IPC_TRANSPORT'})));req.end(raw);
 });
}
