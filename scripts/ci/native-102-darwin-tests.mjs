// CI owns the temporary cluster and every child handle; no shared DB fallback.
import {spawn,execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,realpathSync,rmSync,lstatSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,isAbsolute} from 'node:path';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {NATIVE_102_DARWIN_SHARDS,native102DarwinInvocations} from './native-102-ci-selection.mjs';
import {nativePhoneTestPilRoot,nativePhoneTestImageArgs} from '../../services/phone-adb-controller/__tests__/helpers/native-phone-test-python.mjs';
import {nativePhoneTestMediaBinary} from '../../services/phone-adb-controller/__tests__/helpers/native-phone-test-media.mjs';
const require=createRequire(import.meta.url),{Pool}=require('pg');
const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const cancellation=new AbortController(),onTerm=()=>cancellation.abort(Error('CI_SIGTERM')),onInt=()=>cancellation.abort(Error('CI_SIGINT'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
const run=(command,args,{expectedTests=null,...options}={})=>new Promise((resolve,reject)=>{
 let error,output='';const child=spawn(command,args,{cwd:root,stdio:expectedTests===null?'inherit':['inherit','pipe','inherit'],signal:cancellation.signal,...options});
 child.once('error',value=>{error=value;});if(expectedTests!==null)child.stdout.on('data',bytes=>{process.stdout.write(bytes);output+=bytes;if(Buffer.byteLength(output)>2*1024*1024){error=Error('NATIVE_102_CI_FULL_FILE_OUTPUT_LIMIT');child.kill('SIGTERM');}});
 child.once('close',(code,signal)=>{if(error||code!==0||signal)return reject(error||Error('NATIVE_102_CI_CHILD_FAILED '+command+' code='+code+' signal='+signal));
  if(expectedTests!==null){const counts={};for(const key of ['tests','pass','fail','cancelled','skipped','todo']){const rows=[...output.matchAll(new RegExp('^# '+key+' ([0-9]+)$','gm'))];if(rows.length!==1)return reject(Error('NATIVE_102_CI_FULL_FILE_COUNT'));counts[key]=Number(rows[0][1]);}
   if(counts.tests!==expectedTests||counts.pass!==expectedTests||['fail','cancelled','skipped','todo'].some(k=>counts[k]!==0))return reject(Error('NATIVE_102_CI_FULL_FILE_COUNT'));
   console.log(JSON.stringify({event:'native102-ci-complete-file',suite:args.find(s=>s.endsWith('.test.mjs')),counts}));
  }resolve();});
});
if(process.platform!=='darwin')throw Error('NATIVE_102_CI_DARWIN_REQUIRED');
const shard=process.env.NATIVE_102_CI_SHARD;
if(!['1','2','3'].includes(shard))throw Error('NATIVE_102_CI_SHARD_REQUIRED');
const selectedSuites=NATIVE_102_DARWIN_SHARDS[shard];
const pgbin=process.env.PREFLIGHT_TEST_PG_BIN;
if(!isAbsolute(pgbin||''))throw Error('NATIVE_102_CI_EXPLICIT_PG_BIN_REQUIRED');
const directory=realpathSync(mkdtempSync(join(tmpdir(),'n102-ci-'))),data=join(directory,'pg');let pg,closed,pgLog='';
process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);
try{
 const requested=process.env.PREFLIGHT_TEST_PYTHON_BIN||execFileSync('/usr/bin/python3',['-I','-S','-c','import sys;print(sys.executable)'],{encoding:'utf8',timeout:10000}).trim();
 const python=realpathSync(requested),st=lstatSync(python),profile='(version 1)(allow default)(deny process-fork)';
 if(!isAbsolute(python)||!st.isFile()||(st.mode&0o022)||/[\r\n]/.test(python))throw Error('NATIVE_102_CI_PYTHON_INVALID');
 const minimal={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,LANG:'en_US.UTF-8'};
 const positive=spawnSync('/usr/bin/sandbox-exec',['-p',profile,python,'-I','-S','-c','print("nofork-ready")'],{env:minimal,encoding:'utf8',timeout:10000});
 const negative=spawnSync('/usr/bin/sandbox-exec',['-p',profile,python,'-I','-S','-c','import os;os.fork()'],{env:minimal,encoding:'utf8',timeout:10000});
 if(positive.status!==0||positive.signal||positive.stdout.trim()!=='nofork-ready'||negative.status!==1||negative.signal||!/Operation not permitted|Resource temporarily unavailable/.test(negative.stderr))throw Error('NATIVE_102_CI_PYTHON_NOFORK_UNVERIFIED');
 console.log(JSON.stringify({event:'native102-test-python',path:python,sha256:sha(readFileSync(python)),fork_denied:true}));
 execFileSync(join(pgbin,'initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],{stdio:'pipe',timeout:30000});
 const port=await freePort();
 pg=spawn(join(pgbin,'postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-k',directory],{stdio:['ignore','ignore','pipe']});
 closed=new Promise((resolve,reject)=>{pg.once('error',reject);pg.once('close',(code,signal)=>resolve({code,signal}));});
 pg.stderr.on('data',b=>{pgLog=(pgLog+b.toString()).slice(-65536);});
 const admin=new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',max:1,connectionTimeoutMillis:1000});
 try{
  let ready=false;
  for(let n=0;n<100;n++){
   if(pg.exitCode!==null||pg.signalCode!==null)throw Error('NATIVE_102_CI_PG_EXITED');
   try{await admin.query('SELECT 1');ready=true;break;}catch{await wait(100);}
  }
  if(!ready)throw Error('NATIVE_102_CI_PG_NOT_READY');
  await admin.query('CREATE DATABASE cecelia_scratch');
 }finally{await admin.end();}
 const fixture=join(directory,'fixture.json');
 writeFileSync(fixture,JSON.stringify({task_id:'7d85f6ba-873b-40fc-993f-932d24d61e5a',host:'127.0.0.1',port,user:'postgres',database:'cecelia_scratch',data}),{mode:0o600,flag:'wx'});
 const env={...process.env,PREFLIGHT_TEST_PYTHON_BIN:python,ZJ_NATIVE_103_PG_FIXTURE:fixture};
 console.log(JSON.stringify({event:'native102-private-pg-ready',shard,host:'127.0.0.1',port,database:'cecelia_scratch',owned_pid:pg.pid}));
 if(!isAbsolute(process.env.PREFLIGHT_TEST_PIL_ROOT||''))throw Error('NATIVE_102_CI_EXPLICIT_PIL_REQUIRED');
 const pil=nativePhoneTestPilRoot(python);
 const image=spawnSync('/usr/bin/sandbox-exec',['-p',profile,python,...nativePhoneTestImageArgs('import PIL\nfrom PIL import Image\nim=Image.new("RGB",(2,3)); print(PIL.__version__); print(im.size)',[],python)],{env:minimal,encoding:'utf8',timeout:10000});
 if(image.status!==0||image.signal||image.stdout.trim()!=='12.2.0\n(2, 3)')throw Error('NATIVE_102_CI_PIL_NOFORK_UNVERIFIED');
 for(const tool of ['ffmpeg','ffprobe']){
  if(!isAbsolute(process.env['PREFLIGHT_TEST_'+tool.toUpperCase()+'_BIN']||''))throw Error('NATIVE_102_CI_EXPLICIT_MEDIA_REQUIRED');
  const binary=nativePhoneTestMediaBinary(tool),result=spawnSync(binary,['-version'],{encoding:'utf8',timeout:10000});
  if(result.status!==0||result.signal||!result.stdout.startsWith(tool+' version '))throw Error('NATIVE_102_CI_MEDIA_UNVERIFIED');
  console.log(JSON.stringify({event:'native102-test-media',tool,path:binary,sha256:sha(readFileSync(binary))}));
 }
 const compiler=spawnSync('/usr/bin/clang',['--version'],{encoding:'utf8',timeout:10000});if(compiler.status!==0||compiler.signal)throw Error('NATIVE_102_CI_COMPILER_REQUIRED');
 console.log(JSON.stringify({event:'native102-test-pillow',root:pil,verified:true}));
 console.log(JSON.stringify({event:'native102-ci-selection',shard,suites:selectedSuites}));
 for(const batch of native102DarwinInvocations(shard))await run(process.execPath,batch.args,{env,expectedTests:batch.expectedTests});

}catch(error){
 // Only isolated test facts; no environment, raw request or credential directory.
 try{
  const artifacts=process.env.PREFLIGHT_TEST_PHONE_ARTIFACTS;
  if(!isAbsolute(artifacts||''))throw Error('NATIVE_102_CI_ARTIFACTS_REQUIRED');
  mkdirSync(artifacts,{recursive:true,mode:0o700});const st=lstatSync(artifacts);
  if(st.isSymbolicLink()||!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o022)||realpathSync(artifacts)!==artifacts)throw Error('NATIVE_102_CI_ARTIFACTS_UNSAFE');
  const failure=mkdtempSync(join(artifacts,'owner-failure-'));
  writeFileSync(join(failure,'native102-ci-failure.json'),JSON.stringify({event:'native102-ci-failed',owner_pid:process.pid,owned_pg_pid:pg?.pid??null,cancellation_requested:cancellation.signal.aborted,pg_log_sha256:sha(pgLog)})+'\n',{mode:0o600,flag:'wx'});
 }catch{console.error('NATIVE_102_CI_FAILURE_ARTIFACT_UNAVAILABLE');}
 throw error;
}finally{
 let stopped=true;
 if(pg){
  if(pg.exitCode===null&&pg.signalCode===null)pg.kill('SIGTERM');
  let result=await Promise.race([closed,wait(10000).then(()=>null)]);
  if(!result){if(pg.exitCode===null&&pg.signalCode===null)pg.kill('SIGKILL');result=await Promise.race([closed,wait(5000).then(()=>null)]);}
  stopped=Boolean(result);console.log(JSON.stringify({event:'native102-private-pg-close',shard,directory,owned_pid:pg.pid,result,stopped}));
 }
 if(stopped)rmSync(directory,{recursive:true,force:true});
 else{console.error('NATIVE_102_CI_PG_STOP_UNKNOWN directory='+directory+' log_sha256='+sha(pgLog));process.exitCode=1;}
 process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);
 if(cancellation.signal.aborted)process.exitCode=1;
}
