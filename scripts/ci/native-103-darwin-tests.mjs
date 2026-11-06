// CI owns the temporary cluster and every child handle; no shared DB fallback.
import {spawn,execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,realpathSync,rmSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,isAbsolute} from 'node:path';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PHONE_DARWIN_SUITES} from './native-phone-ci-selection.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const suites=['native-103-public-executor.test.mjs','native-103-transaction.test.mjs','native-103-producers.test.mjs','native-103-claim.test.mjs','native-103-control-scope.test.mjs','native-103-public.test.mjs','native-activity-authority.test.mjs','native-task-lease.test.mjs'];
const cancellation=new AbortController(),onTerm=()=>cancellation.abort(Error('CI_SIGTERM')),onInt=()=>cancellation.abort(Error('CI_SIGINT'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
const run=(command,args,options={})=>new Promise((resolve,reject)=>{
 let error;
 const child=spawn(command,args,{cwd:root,stdio:'inherit',signal:cancellation.signal,...options});child.once('error',value=>{error=value;});child.once('close',(code,signal)=>!error&&code===0&&!signal?resolve():reject(error||Error('NATIVE_103_CI_CHILD_FAILED '+command+' code='+code+' signal='+signal)));
});
if(process.platform!=='darwin')throw Error('NATIVE_103_CI_DARWIN_REQUIRED');
const pgbin=process.env.PREFLIGHT_TEST_PG_BIN;
if(!isAbsolute(pgbin||''))throw Error('NATIVE_103_CI_EXPLICIT_PG_BIN_REQUIRED');
const directory=realpathSync(mkdtempSync(join(tmpdir(),'n103-ci-'))),data=join(directory,'pg');let pg,closed,pgLog='';
process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);
try{
 const requested=process.env.PREFLIGHT_TEST_PYTHON_BIN||execFileSync('/usr/bin/python3',['-I','-S','-c','import sys;print(sys.executable)'],{encoding:'utf8',timeout:10000}).trim();
 const python=realpathSync(requested),st=lstatSync(python),profile='(version 1)(allow default)(deny process-fork)';
 if(!isAbsolute(python)||!st.isFile()||(st.mode&0o022)||/[\r\n]/.test(python))throw Error('NATIVE_103_CI_PYTHON_INVALID');
 const minimal={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,LANG:'en_US.UTF-8'};
 const positive=spawnSync('/usr/bin/sandbox-exec',['-p',profile,python,'-I','-S','-c','print("nofork-ready")'],{env:minimal,encoding:'utf8',timeout:10000});
 const negative=spawnSync('/usr/bin/sandbox-exec',['-p',profile,python,'-I','-S','-c','import os;os.fork()'],{env:minimal,encoding:'utf8',timeout:10000});
 if(positive.status!==0||positive.signal||positive.stdout.trim()!=='nofork-ready'||negative.status!==1||negative.signal||!/Operation not permitted|Resource temporarily unavailable/.test(negative.stderr))throw Error('NATIVE_103_CI_PYTHON_NOFORK_UNVERIFIED');
 console.log(JSON.stringify({event:'native103-test-python',path:python,sha256:sha(readFileSync(python)),fork_denied:true}));
 execFileSync(join(pgbin,'initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],{stdio:'pipe',timeout:30000});
 const port=await freePort();
 pg=spawn(join(pgbin,'postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-k',directory],{stdio:['ignore','ignore','pipe']});
 closed=new Promise((resolve,reject)=>{pg.once('error',reject);pg.once('close',(code,signal)=>resolve({code,signal}));});
 pg.stderr.on('data',b=>{pgLog=(pgLog+b.toString()).slice(-65536);});
 const admin=new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',max:1,connectionTimeoutMillis:1000});
 try{
  let ready=false;
  for(let n=0;n<100;n++){
   if(pg.exitCode!==null||pg.signalCode!==null)throw Error('NATIVE_103_CI_PG_EXITED');
   try{await admin.query('SELECT 1');ready=true;break;}catch{await wait(100);}
  }
  if(!ready)throw Error('NATIVE_103_CI_PG_NOT_READY');
  await admin.query('CREATE DATABASE cecelia_scratch');
 }finally{await admin.end();}
 const fixture=join(directory,'fixture.json');
 writeFileSync(fixture,JSON.stringify({task_id:'7d85f6ba-873b-40fc-993f-932d24d61e5a',host:'127.0.0.1',port,user:'postgres',database:'cecelia_scratch',data}),{mode:0o600,flag:'wx'});
 const env={...process.env,PREFLIGHT_TEST_PYTHON_BIN:python,ZJ_NATIVE_103_PG_FIXTURE:fixture};
 console.log(JSON.stringify({event:'native103-private-pg-ready',host:'127.0.0.1',port,database:'cecelia_scratch',owned_pid:pg.pid}));
 await run(process.execPath,['--test','--test-concurrency=1',...[...suites,...PHONE_DARWIN_SUITES].map(s=>'services/phone-adb-controller/__tests__/'+s)],{env});
 await run(python,['services/phone-adb-controller/__tests__/phone-lock-clean-bootstrap.test.py'],{env});
}finally{
 let stopped=true;
 if(pg){
  if(pg.exitCode===null&&pg.signalCode===null)pg.kill('SIGTERM');
  let result=await Promise.race([closed,wait(10000).then(()=>null)]);
  if(!result){if(pg.exitCode===null&&pg.signalCode===null)pg.kill('SIGKILL');result=await Promise.race([closed,wait(5000).then(()=>null)]);}
  stopped=Boolean(result);console.log(JSON.stringify({event:'native103-private-pg-close',directory,owned_pid:pg.pid,result,stopped}));
 }
 if(stopped)rmSync(directory,{recursive:true,force:true});
 else{console.error('NATIVE_103_CI_PG_STOP_UNKNOWN directory='+directory+' log_sha256='+sha(pgLog));process.exitCode=1;}
 process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);
 if(cancellation.signal.aborted)process.exitCode=1;
}
