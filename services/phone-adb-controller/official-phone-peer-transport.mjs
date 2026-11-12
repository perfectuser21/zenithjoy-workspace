import {spawn,spawnSync} from 'node:child_process';
import {openSync,readFileSync,fstatSync,closeSync,realpathSync,lstatSync,constants} from 'node:fs';
import {userInfo} from 'node:os';

import {encodePhonePeerBootstrap} from './official-phone-peer-wire.mjs';
import {peerHash} from './official-phone-peer-protocol.mjs';
const fail=code=>Object.assign(Error('OFFICIAL_PHONE_PEER_TRANSPORT_'+code),{executionStopped:false,externalEffect:'unknown'});
export function freezePhonePeerSsh(){
 const path='/usr/bin/ssh';let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const before=fstatSync(fd);if(!before.isFile()||before.uid!==0||before.mode&0o022||before.nlink!==1||realpathSync(path)!==path)throw fail('SSH_SOURCE');const bytes=readFileSync(fd),after=fstatSync(fd);if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==after.size)throw fail('SSH_SOURCE');if(process.platform==='darwin'){const signature=spawnSync('/usr/bin/codesign',['--verify','--strict',path],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',timeout:5000,maxBuffer:65536});if(signature.status!==0||signature.error||signature.signal)throw fail('SSH_SOURCE');}return Object.freeze({path,sha256:peerHash(bytes)});}finally{if(fd!==undefined)closeSync(fd);}
}
function safeTransportEnvironment(){
 const result={HOME:realpathSync(userInfo().homedir),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C'};const socket=process.env.SSH_AUTH_SOCK;if(socket&&!/[\r\n\0]/.test(socket)&&socket.startsWith('/')){try{const st=lstatSync(socket);if(st.isSocket()&&st.uid===process.getuid()&&realpathSync(socket)===socket)result.SSH_AUTH_SOCK=socket;}catch{}}return result;
}
export function createFixedPhonePeerTransport({descriptor,deadline_ms,ssh,spawnProcess=spawn}){
 if(descriptor.host!=='xian-m4'||descriptor.runtime_root!==`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${descriptor.deployment.source_commit}/runtime`||Date.now()>=deadline_ms)throw fail('SCOPE');
 const actual=freezePhonePeerSsh();if(ssh?.path!==actual.path||ssh.sha256!==actual.sha256)throw fail('SSH_SOURCE');
 const script=descriptor.runtime_root+'/official-phone-peer-host.mjs';
 const child=spawnProcess(actual.path,['-T','-o','ControlMaster=no','-o','ControlPath=none','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','xian-m4',`/opt/homebrew/bin/node '${script}' --stdio`],{env:safeTransportEnvironment(),stdio:['pipe','pipe','pipe'],detached:false});
 let first=true,poisoned=false,current=null,buffer='',stderr='',actualClose=null,closedResolve;const closed=new Promise(r=>{closedResolve=r;});
 const reject=error=>{poisoned=true;if(current){clearTimeout(current.timer);const {no}=current;current=null;no(error);}};
 child.stdout.on('data',bytes=>{buffer+=bytes.toString('utf8');if(Buffer.byteLength(buffer)>16*1024*1024)return reject(fail('OUTPUT_LIMIT'));let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;if(!current){reject(fail('UNSOLICITED'));continue;}try{const value=JSON.parse(line);clearTimeout(current.timer);const {yes}=current;current=null;yes(value);}catch{reject(fail('FRAME'));}}});
 child.stderr.on('data',bytes=>{if(stderr.length<16000)stderr+=bytes.toString('utf8').slice(0,16000-stderr.length);});
 child.on('error',()=>reject(fail('START')));child.stdin.on('error',()=>reject(fail('INPUT')));
 child.on('close',(code,signal)=>{actualClose={closed:true,code,signal,stderr_sha256:peerHash(stderr)};if(current)reject(fail('CLOSE'));closedResolve(actualClose);});
 const exchange=frame=>new Promise((yes,no)=>{if(poisoned||current||actualClose||Date.now()>=deadline_ms)return no(fail('STATE'));let line;try{line=first?encodePhonePeerBootstrap(frame):JSON.stringify(frame);}catch(error){return no(error);}if(Date.now()>=deadline_ms)return no(fail('DEADLINE'));first=false;const timer=setTimeout(()=>reject(fail('DEADLINE')),Math.max(1,deadline_ms-Date.now()));current={yes,no,timer};child.stdin.write(line+'\n',error=>{if(error)reject(fail('INPUT'));});});
 return Object.freeze({exchange,async close(){child.stdin.end();let timer;try{const result=await Promise.race([closed,new Promise((_,no)=>{timer=setTimeout(()=>no(fail('CLOSE_DEADLINE')),Math.max(1,deadline_ms-Date.now()));})]);if(poisoned||current||buffer.length)throw fail('CLOSE_UNVERIFIED');return result;}finally{clearTimeout(timer);}},snapshot:()=>({poisoned,buffered_bytes:Buffer.byteLength(buffer),pid:child.pid,closed:actualClose!==null,pending:current!==null})});
}
