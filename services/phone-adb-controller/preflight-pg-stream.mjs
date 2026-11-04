// One request, one parent-owned SSH leaf. No remote command or local listening socket.
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {readFileSync,realpathSync,lstatSync,statSync,appendFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const sandbox='/usr/bin/sandbox-exec',profile='(version 1)(allow default)(deny process-fork)';
const hash=b=>createHash('sha256').update(b).digest('hex');
function pin(path,digest,{secret=false}={}){
 if(!isAbsolute(path||'')||!/^[a-f0-9]{64}$/.test(digest||''))throw Error('PREFLIGHT_TRANSPORT_PIN');
 const l=lstatSync(path),r=realpathSync(path),s=statSync(r);
 if(l.isSymbolicLink()||!s.isFile()||(s.mode&(secret?0o077:0o022))||s.uid!==process.getuid()&&s.uid!==0||hash(readFileSync(r))!==digest)throw Error('PREFLIGHT_TRANSPORT_PIN');return r;
}
function probe(args,env,deadline){
 if(Date.now()>=deadline)return Promise.reject(Error('PREFLIGHT_TRANSPORT_DEADLINE'));
 return new Promise((resolve,reject)=>{
  if(Date.now()>=deadline)return reject(Error('PREFLIGHT_TRANSPORT_DEADLINE'));
  const p=spawn(sandbox,['-p',profile,...args],{env,stdio:['ignore','pipe','pipe']});let stderr='';
  const timer=setTimeout(()=>p.kill('SIGKILL'),Math.max(1,Math.min(2000,deadline-Date.now())));
  p.stderr.on('data',b=>{stderr+=b;if(stderr.length>32000)p.kill('SIGKILL');});p.once('error',reject);
  p.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stderr});});
 });
}
export async function createPreflightPgStream({directory,policy,deadlineMs,env=process.env}){
 if(process.platform!=='darwin')throw Error('PREFLIGHT_NOFORK_UNSUPPORTED');
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs-Date.now()<100||!isAbsolute(directory||''))throw Error('PREFLIGHT_TRANSPORT_DEADLINE');
 if(policy?.ssh_bin!=='/usr/bin/ssh'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(policy.hostname||'')||policy.hostname.split('.').some(n=>Number(n)>255)
   ||!/^[-a-zA-Z0-9_.]{1,200}$/.test(policy.hostkey_alias||'')||!/^[-a-zA-Z0-9_]{1,64}$/.test(policy.user||'')
   ||![policy.port,policy.pg_port].every(p=>Number.isSafeInteger(p)&&p>0&&p<=65535))throw Error('PREFLIGHT_TRANSPORT_POLICY');
 const binary=pin(policy.ssh_bin,policy.ssh_sha256),identity=pin(policy.identity,policy.identity_sha256,{secret:true}),known=pin(policy.known_hosts,policy.known_hosts_sha256);
 const clean={...env};for(const key of Object.keys(clean))if(/^(DYLD_|LD_|PYTHON|NODE_OPTIONS$|NODE_PATH$|SSH_|GIT_SSH|DISPLAY$)/.test(key))delete clean[key];
 const positive=await probe(['/usr/bin/true'],clean,deadlineMs),negative=await probe(['/bin/sh','-c','/usr/bin/true & wait'],clean,deadlineMs);
 if(positive.code!==0||positive.signal||negative.code===0||negative.signal||!/fork: (Operation not permitted|Resource temporarily unavailable)/.test(negative.stderr))throw Error('PREFLIGHT_NOFORK_UNVERIFIED');
 let sealed=false,used=false,unknown=false,child,leaf,returned,resolveReturned,stream;
 const ledger=join(directory,'preflight-pg-leaf-'+randomUUID()+'.jsonl');
 const record=entry=>{try{appendFileSync(ledger,JSON.stringify(entry)+'\n',{mode:0o600});}catch(error){unknown=true;throw error;}};
 const assertActive=()=>{if(sealed||Date.now()>=deadlineMs)throw Error('PREFLIGHT_TRANSPORT_CLOSED');};
 const snapshot=()=>({sealed,execution_stopped:sealed&&!unknown&&(!used||Boolean(leaf?.ended_at)),leaves:leaf?[structuredClone(leaf)]:[],ledger});
 const streamFactory=()=>{
  assertActive();if(used)throw Error('PREFLIGHT_TRANSPORT_RECONNECT_FORBIDDEN');used=true;
  const options=['BatchMode=yes','IdentitiesOnly=yes','IdentityAgent=none','StrictHostKeyChecking=yes',`UserKnownHostsFile=${known}`,'GlobalKnownHostsFile=/dev/null',`HostKeyAlias=${policy.hostkey_alias}`,'ProxyCommand=none','ProxyJump=none','LocalCommand=none','PermitLocalCommand=no','ControlMaster=no','ControlPath=none','ControlPersist=no','ForwardAgent=no','ForwardX11=no','ClearAllForwardings=yes','CanonicalizeHostname=no','UpdateHostKeys=no','AddKeysToAgent=no','RequestTTY=no','EscapeChar=none','PKCS11Provider=none','PasswordAuthentication=no','KbdInteractiveAuthentication=no'];
  const args=['-F','/dev/null',...options.flatMap(v=>['-o',v]),'-i',identity,'-p',String(policy.port),'-l',policy.user,'-W',`127.0.0.1:${policy.pg_port}`,policy.hostname];
  returned=new Promise(r=>{resolveReturned=r;});let connecting=false,timer;
  stream=new Duplex({read(){child?.stdout.resume();},write(b,enc,done){if(!child||sealed)return done(Error('PREFLIGHT_TRANSPORT_CLOSED'));child.stdin.write(b,enc,done);},final(done){child?.stdin.end();done();},destroy(error,done){if(child&&!leaf?.ended_at)child.kill('SIGKILL');done(error);}});
  stream.setNoDelay=()=>stream;stream.setKeepAlive=()=>stream;
  stream.ref=()=>{child?.ref();child?.stdout.ref?.();child?.stdin.ref?.();return stream;};stream.unref=()=>{child?.unref();child?.stdout.unref?.();child?.stdin.unref?.();return stream;};
  stream.connect=()=>{
   if(connecting)throw Error('PREFLIGHT_TRANSPORT_RECONNECT_FORBIDDEN');assertActive();connecting=true;
   // Recheck sensitive pins at first spawn; no SSH/config helper is permitted outside this leaf.
   pin(binary,policy.ssh_sha256);pin(identity,policy.identity_sha256,{secret:true});pin(known,policy.known_hosts_sha256);
   leaf={id:randomUUID(),kernel_nofork:true,started_at:null,ended_at:null};record({event:'intent',...leaf});
   assertActive();
   child=spawn(sandbox,['-p',profile,binary,...args],{env:clean,stdio:['pipe','pipe','pipe']});
   timer=setTimeout(()=>{unknown=true;child.kill('SIGKILL');},Math.max(1,deadlineMs-Date.now()));
   child.once('spawn',()=>{leaf.started_at=new Date().toISOString();leaf.pid=child.pid;try{record({event:'started',...leaf});stream.emit('connect');}catch(error){stream.destroy(error);}});
   child.stdout.on('data',b=>{if(!stream.push(b))child.stdout.pause();});child.stdout.on('end',()=>stream.push(null));
   child.stdin.on('error',error=>{if(!stream.destroyed)stream.destroy(error);});
   let stderrBytes=0;child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>32000){unknown=true;child.kill('SIGKILL');}});
   child.once('error',()=>{unknown=true;stream.destroy(Error('PREFLIGHT_SSH_SPAWN_FAILED'));});
   child.once('close',(code,signal)=>{clearTimeout(timer);leaf.ended_at=new Date().toISOString();leaf.code=code;leaf.signal=signal;try{record({event:'returned',...leaf});}catch{}resolveReturned();if(code!==0&&!stream.destroyed)stream.destroy(Error('PREFLIGHT_SSH_REQUEST_FAILED'));});
   return stream;
  };return stream;
 };
 const close=async()=>{sealed=true;if(used&&!child){unknown=true;resolveReturned?.();}if(child&&!leaf.ended_at)child.kill('SIGKILL');await returned;return snapshot();};
 return {stream:streamFactory,assertActive,snapshot,seal:async()=>{sealed=true;if(child&&!leaf.ended_at)await returned;return snapshot();},close};
}
