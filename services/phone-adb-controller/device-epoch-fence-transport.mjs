// 唯一受控host请求原语；不会启动/重启ADB，不提供任意命令或自动重试。
import {Socket} from 'node:net';import {join,resolve} from 'node:path';
import {lstatSync,realpathSync,readdirSync,openSync,fsyncSync,closeSync,constants} from 'node:fs';
import {digest as sha,canonical,writeAll} from './device-epoch-fence-reference.mjs';import {adbRequest,adbPayloadLength} from './adb-shell-v2-protocol.mjs';
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
export function parseDeviceInventory(raw){
 need(typeof raw==='string'&&!/[^\x20-\x7e\t\n]/.test(raw),'HOST_INVENTORY');if(!raw)return [];need(raw.endsWith('\n'),'HOST_INVENTORY');const ids=new Set();return raw.trimEnd().split('\n').map(line=>{const m=line.match(/^([A-Za-z0-9_.:-]+)[ \t]+(device|offline|unauthorized|bootloader|recovery|sideload)(?:[ \t]+(.*))?$/);need(m&&!ids.has(m[1]),'HOST_INVENTORY');ids.add(m[1]);return {serial:m[1],state:m[2],properties:m[3]??''};});
}
export function parseHostAction(operation,serial,response){
 if(operation==='inventory'){parseDeviceInventory(response);return {action_confirmed:true,action_error_code:null};}
 const text=typeof response==='string'?response.replace(/\r?\n$/,''):null;
 if(text===(operation==='connect'?'connected to ':'disconnected ')+serial)return {action_confirmed:true,action_error_code:null};
 const code=operation==='connect'&&text?.startsWith('failed to authenticate')?'HOST_AUTHENTICATION_FAILED':operation==='connect'&&text?.startsWith('cannot connect')?'HOST_CONNECT_REJECTED':'HOST_ACTION_UNCONFIRMED';
 return {action_confirmed:false,action_error_code:code};
}
export async function hostOperation({operation,scope,directory,readAuthority,checkOperationTime=()=>{}}={}){
 const q=structuredClone(scope),endpoint=q?.endpoint?.match(/^tcp:127\.0\.0\.1:([1-9]\d{0,4})$/);need(['inventory','disconnect','connect'].includes(operation)&&endpoint&&Number(endpoint[1])<=65535&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(q.serial||''),'HOST_SCOPE');
 let st;try{st=lstatSync(directory);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700&&realpathSync(directory)===resolve(directory)&&!readdirSync(directory).length,'HOST_JOURNAL');}catch{need(false,'HOST_JOURNAL');}
 need(typeof readAuthority==='function','HOST_AUTHORITY');
 const save=(name,b)=>{const now=lstatSync(directory);need(now.dev===st.dev&&now.ino===st.ino&&realpathSync(directory)===resolve(directory),'HOST_JOURNAL');const fd=openSync(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeAll(fd,b);fsyncSync(fd);}finally{closeSync(fd);}const d=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(d);}finally{closeSync(d);}return sha(b);};
 const service=operation==='inventory'?'host:devices-l':'host:'+operation+':'+q.serial;save('intent.json',Buffer.from(JSON.stringify({protocol:'device-epoch-fence-host-operation/v1',operation,service,scope:q,at:new Date().toISOString()})+'\n'));
 const socket=new Socket(),chunks=[];let eof=false,closed=false,error=null,writeAttempted=false,writeAcknowledged=false,size=0,body=null;
 const admit=async()=>{const a=await readAuthority();need(canonical(a?.scope)===canonical(q)&&a.authorized_action===operation&&Date.parse(a.lease_until)>Date.now()+1000,'HOST_AUTHORITY');};
 const deadline=Date.now()+15000,timer=setTimeout(()=>{error??='HOST_DEADLINE';socket.destroy();},15000);
 const closePromise=new Promise(r=>socket.once('close',hadError=>{closed=true;if(hadError||!eof)error??='HOST_SOCKET';r();}));
 socket.on('error',()=>{error??='HOST_SOCKET';});socket.on('end',()=>{eof=true;});socket.on('data',b=>{size+=b.length;if(size>65544){error??='HOST_LIMIT';socket.destroy();}else chunks.push(b);});
 try{await admit();need(Date.now()<deadline,'HOST_DEADLINE');await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',()=>j(Error('HOST_SOCKET')));socket.once('close',()=>j(Error('HOST_SOCKET')));socket.connect(Number(endpoint[1]),'127.0.0.1');});await admit();need(Date.now()<deadline,'HOST_DEADLINE');checkOperationTime();writeAttempted=true;await new Promise((r,j)=>socket.write(adbRequest(service),e=>e?j(Error('HOST_WRITE')):(writeAcknowledged=true,r())));await closePromise;need(!error&&eof&&closed,'HOST_SOCKET');
  const raw=Buffer.concat(chunks);need(raw.length>=8&&raw.subarray(0,4).toString()==='OKAY','HOST_ACK');const n=adbPayloadLength(raw.subarray(4,8),65536);need(raw.length===n+8,'HOST_PAYLOAD');body=raw.subarray(8).toString('utf8');need(Buffer.from(body).equals(raw.subarray(8)),'HOST_ENCODING');if(operation==='inventory')parseDeviceInventory(body);await admit();
 }catch(e){error??=/^HOST_[A-Z_]+$/.test(e.code||e.message||'')?(e.code??e.message):'HOST_UNKNOWN';}
 finally{if(!closed)socket.destroy();await closePromise;clearTimeout(timer);}
 const raw=Buffer.concat(chunks),action=error===null?parseHostAction(operation,q.serial,body):{action_confirmed:false,action_error_code:error},result={...action,protocol:'device-epoch-fence-host-operation/v1',operation,scope:q,write_attempted:writeAttempted,write_acknowledged:writeAcknowledged,wire_complete:error===null&&eof&&closed,error_code:error,peer_eof:eof,socket_closed:closed,pending:0,raw_sha256:save('host-response.raw',raw),response:body,original_execution_stopped:false,resource_authority:'not_attested',retry_allowed:false};save('result.json',Buffer.from(JSON.stringify(result)+'\n'));return result;
}
