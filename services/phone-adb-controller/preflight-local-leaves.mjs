// Fixed Python leaf only; no zsh/controller/managed-client outer is executed here.
import {spawn} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync,appendFileSync} from 'node:fs';import {join,isAbsolute} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const profile='(version 1)(allow default)(deny process-fork)',sandbox='/usr/bin/sandbox-exec',sha=b=>createHash('sha256').update(b).digest('hex');
function pinned(path,expected){if(!isAbsolute(path||'')||!/^[a-f0-9]{64}$/.test(expected||''))throw Error('PREFLIGHT_LOCAL_PIN');const actual=realpathSync(path),st=lstatSync(actual);if(!st.isFile()||(st.mode&0o022)||sha(readFileSync(actual))!==expected)throw Error('PREFLIGHT_LOCAL_PIN');return actual;}
function execute(args,{input='',env,deadline,onStart=()=>{}}){if(Date.now()>=deadline)return Promise.reject(Error('PREFLIGHT_LOCAL_CLOSED'));return new Promise((resolve,reject)=>{
 if(Date.now()>=deadline)return reject(Error('PREFLIGHT_LOCAL_CLOSED'));
 const child=spawn(sandbox,['-p',profile,...args],{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',tainted=false,failed;
 const timer=setTimeout(()=>{tainted=true;child.kill('SIGKILL');},Math.max(1,deadline-Date.now()));
 child.once('spawn',()=>{try{onStart(child.pid);}catch(error){failed=error;child.kill('SIGKILL');}});child.once('error',error=>{failed=error;});
 for(const [stream,which] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',b=>{if(which==='stdout')stdout+=b;else stderr+=b;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>6*1024*1024){tainted=true;child.kill('SIGKILL');}});
 child.stdin.on('error',()=>{});child.stdin.end(input);
 child.once('close',(code,signal)=>{clearTimeout(timer);if(failed)return reject(failed);resolve({stdout,stderr,code,signal,tainted});});
});}
export async function startPreflightLocalLeaves({root,directory,python,sourceFiles,deadlineMs,env=process.env}){
 if(process.platform!=='darwin')throw Error('PREFLIGHT_NOFORK_UNSUPPORTED');
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<=Date.now())throw Error('PREFLIGHT_LOCAL_CLOSED');
 const binary=pinned(python?.path,python?.sha256),helper=pinned(join(root,'preflight-local-step.py'),sourceFiles?.['preflight-local-step.py']);
 const clean={...env};for(const k of Object.keys(clean))if(/^(DYLD_|LD_|PYTHON|NODE_|SSH_)/.test(k))delete clean[k];
 const positive=await execute(['/usr/bin/true'],{env:clean,deadline:Math.min(deadlineMs,Date.now()+2000)}),negative=await execute(['/bin/sh','-c','/usr/bin/true & wait'],{env:clean,deadline:Math.min(deadlineMs,Date.now()+2000)});
 if(positive.code!==0||positive.signal||positive.tainted||negative.code===0||negative.signal||negative.tainted||!/fork: (Operation not permitted|Resource temporarily unavailable)/.test(negative.stderr))throw Error('PREFLIGHT_NOFORK_UNVERIFIED');
 const ledger=join(directory,'preflight-local-leaves-'+randomUUID()+'.jsonl'),leaves=[];let sealed=false,unknown=false,inflight;
 const record=x=>{try{appendFileSync(ledger,JSON.stringify(x)+'\n',{mode:0o600});}catch(error){unknown=true;throw error;}};
 const active=()=>{if(sealed||Date.now()>=deadlineMs)throw Error('PREFLIGHT_LOCAL_CLOSED');};
 const snapshot=()=>({sealed,execution_stopped:sealed&&!inflight&&!unknown&&leaves.every(l=>l.started_at&&l.ended_at&&!l.tainted),leaves:structuredClone(leaves),ledger});
 const run=async(operation,input)=>{
  active();if(inflight||!['ui','route','lock'].includes(operation)||typeof input!=='string'||Buffer.byteLength(input)>5*1024*1024)throw Error('PREFLIGHT_LOCAL_OPERATION');
  pinned(binary,python.sha256);
  const required=['preflight-local-step.py',...(operation==='route'?['adb-existing-route.py']:operation==='lock'?['phone-lock-root.py','phone-lock-helper.py']:[])];
  for(const file of required){const path=join(root,file);if(lstatSync(path).isSymbolicLink())throw Error('PREFLIGHT_LOCAL_PIN');pinned(path,sourceFiles[file]);}
  const leaf={id:randomUUID(),operation,boundary:'darwin-sandbox-deny-process-fork-v1',intent_at:new Date().toISOString()};record({event:'intent',...leaf});leaves.push(leaf);
  const job=execute([binary,'-I','-S',helper,operation],{input,env:clean,deadline:deadlineMs,onStart:pid=>{leaf.pid=pid;leaf.started_at=new Date().toISOString();record({event:'started',...leaf});}});inflight=job;
  try{const result=await job;Object.assign(leaf,{ended_at:new Date().toISOString(),code:result.code,signal:result.signal,tainted:result.tainted});record({event:'returned',...leaf});if(result.code!==0||result.signal||result.tainted)throw Error('PREFLIGHT_LOCAL_REQUEST_FAILED');return result.stdout;}
  catch(error){unknown=true;throw Error('PREFLIGHT_LOCAL_REQUEST_FAILED');}finally{inflight=null;}
 };
 const seal=async()=>{sealed=true;await inflight?.catch(()=>{});return snapshot();};
 return {run,seal,close:seal,snapshot};
}
