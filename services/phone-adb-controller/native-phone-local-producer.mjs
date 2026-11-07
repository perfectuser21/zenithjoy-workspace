// Code-owned fixed Python leaves. This domain never operates ADB or authorizes
// a Worker, a phone command, an Activity verdict, or an external side effect.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,writeSync,fsyncSync,readdirSync,constants} from 'node:fs';
import {join,dirname,resolve,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const fail=reason=>Object.assign(Error('NATIVE_PHONE_LOCAL_'+reason),{code:'NATIVE_PHONE_LOCAL_'+reason,executionStopped:false});
const returned=new WeakSet();export const nativePhoneLocalFailureReturned=e=>returned.has(e);
const profile='(version 1)(allow default)(deny process-fork)';
const originalHelpers=['native-phone-search-step.py','native-phone-link-step.py'];
const helpers=new Set([...originalHelpers,'native-phone-ui-step.py','native-phone-vision-step.py','native-phone-audio-step.py','native-phone-comment-step.py','native-phone-detail-step.py']);
const required=['native-phone-local-producer.mjs',...originalHelpers,'douyin-phone-adb','search-video-tab.py','clipboard-widget-cancel.py','discovery-metrics.js'];
const sourceFields=['controller','controller_sha256','widget_script','widget_sha256','metrics_script','metrics_sha256'];
const searchOps=new Set(['filter-ready','filter-index','filter-option','filter-verify','filter-action','tab','results-focus','controls','keyword','cards']);
const linkOps=new Set(['detail','fresh-share','copy-guide','field','share-target','extract-link','widget','metrics-descriptions']);
const bootstrap=`import hashlib,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);b=p.read_bytes()\nif hashlib.sha256(b).hexdigest()!=sys.argv[2]: raise ValueError('NATIVE_PHONE_LOCAL_HELPER_SOURCE')\nsys.argv=[str(p),*sys.argv[3:]]\nexec(compile(b,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})\n`;
function pin(path,expected,max=32*1024*1024){
 if(!isAbsolute(path||'')||resolve(path)!==path||!/^[a-f0-9]{64}$/.test(expected||''))throw fail('SOURCE');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const a=fstatSync(fd),s=lstatSync(path),b=readFileSync(fd),z=fstatSync(fd);if(!a.isFile()||s.isSymbolicLink()||realpathSync(path)!==path||![0,process.getuid()].includes(a.uid)||(a.mode&0o022)||a.size>max||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==s[k])||sha(b)!==expected)throw fail('SOURCE');return a;}finally{closeSync(fd);}
}
export async function startNativePhoneLocalProducer({root,directory,source,scope,python,pillow,deadlineMs,receiptDeadlineMs,assertResources}={}){
 const src=structuredClone(source),fixed=structuredClone(scope),py=structuredClone(python),pil=pillow==null?null:structuredClone(pillow);
 if(process.platform!=='darwin')throw fail('NOFORK_UNSUPPORTED');
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 if(!src||!/^[a-f0-9]{40}$/.test(src.commit||'')||!Array.isArray(src.files)||src.files.length>512||new Set(src.files.map(f=>f.path)).size!==src.files.length||!fixed||!uuid.test(fixed.task_id||'')||!uuid.test(fixed.binding_id||'')||fixed.source_commit!==src.commit||!/^[-A-Za-z0-9_.]{1,150}$/.test(fixed.run_id||'')||!/^[-A-Za-z0-9_.]{1,80}$/.test(fixed.profile||'')||typeof fixed.serial!=='string'||!fixed.serial||fixed.serial==='none'||!Number.isSafeInteger(deadlineMs)||!Number.isSafeInteger(receiptDeadlineMs)||deadlineMs>=receiptDeadlineMs||Date.now()>=deadlineMs||typeof assertResources!=='function')throw fail('SCOPE');
 if(!isAbsolute(root||'')||realpathSync(root)!==root||root!==dirname(fileURLToPath(import.meta.url)))throw fail('SOURCE');
 const pins=new Map();for(const f of src.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(v=>v==='.'||v==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw fail('SOURCE');pins.set(f.path,f.sha256);}
 if(required.some(name=>!pins.has(name)))throw fail('SOURCE');
 const systemPins=Object.fromEntries(['/usr/bin/sandbox-exec','/usr/bin/true','/bin/sh'].map(path=>[path,sha(readFileSync(path))]));
 const verifySource=()=>{for(const f of src.files)pin(join(root,f.path),f.sha256,8*1024*1024);pin(py?.path,py?.sha256);for(const[path,hash]of Object.entries(systemPins))pin(path,hash);if(pil)pin(pil.path,pil.sha256,2*1024*1024);};verifySource();
 const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(directory)!==resolve(directory)||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||readdirSync(directory).length)throw fail('DIRECTORY');
 const path=join(directory,'local-'+randomUUID()+'.jsonl'),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600),identity=fstatSync(fd),dir=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(dir);}finally{closeSync(dir);}
 let written='',sealed=false,unknown=false,fdClosed=false,calibrated=false,closing,closeWanted=false;
 const jobs=new Set(),children=new Set(),packets=new WeakSet(),leaves=[];
 const taint=()=>{unknown=true;};
 function verifyJournal(){const s=lstatSync(path),d=lstatSync(directory);if(s.isSymbolicLink()||s.dev!==identity.dev||s.ino!==identity.ino||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||d.dev!==st.dev||d.ino!==st.ino||d.isSymbolicLink()||(d.mode&0o777)!==0o700||readFileSync(path,'utf8')!==written)throw fail('JOURNAL');}
 function record(value){if(fdClosed)throw fail('JOURNAL');try{verifyJournal();const text=JSON.stringify(value)+'\n',bytes=Buffer.from(text);let n=0;while(n<bytes.length){const count=writeSync(fd,bytes,n,bytes.length-n);if(count<1)throw fail('JOURNAL');n+=count;}fsyncSync(fd);written+=text;}catch(e){taint();throw e;}}
 function active(){if(sealed||Date.now()>=deadlineMs)throw fail('CLOSED');if(unknown)throw fail('UNKNOWN');try{verifySource();verifyJournal();}catch(e){taint();throw e;}if(sealed||Date.now()>=deadlineMs)throw fail('CLOSED');}
 function closeJournal(){if(closeWanted&&!jobs.size&&!children.size&&!fdClosed){try{record({event:'final',unknown,leaves:leaves.length});}catch{taint();}try{closeSync(fd);fdClosed=true;}catch{taint();}}}
 async function resources(){active();try{if(await assertResources(structuredClone(fixed))!==true)throw fail('RESOURCE');}catch(e){taint();throw e;}active();}
 function stopChildren(){for(const child of children)try{child.kill('SIGKILL');}catch{taint();}}
 const clean={PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1'};
 async function leaf(role,binary,args,input){
  await resources();const item={id:randomUUID(),role,scope_sha256:sha(canonical(fixed)),argv_sha256:sha(canonical([binary,...args])),input_sha256:sha(input),intent_at:Date.now()};record({event:'intent',...item});leaves.push(item);active();
  const result=await new Promise((yes,no)=>{let child,exit,finished=false,failed,total=0;const streams=new Set(),out=[],err=[];
   const finish=()=>{if(finished||!exit||streams.size!==3)return;finished=true;children.delete(child);Object.assign(item,exit,{stdio_closed:true,ended_at:Date.now()});try{record({event:'returned',...item,stdout_sha256:sha(Buffer.concat(out)),stderr_sha256:sha(Buffer.concat(err))});}catch(e){failed=e;}if(failed||exit.signal||!Number.isInteger(exit.code)){taint();no(failed||fail('LEAF_UNKNOWN'));}else yes({...exit,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});};
   try{active();child=spawn('/usr/bin/sandbox-exec',['-p',profile,binary,...args],{env:clean,stdio:['pipe','pipe','pipe']});children.add(child);child.once('spawn',()=>{try{item.pid=child.pid;record({event:'started',...item});}catch(e){failed=e;try{child.kill('SIGKILL');}catch{taint();}}});child.once('error',()=>{failed=fail('SPAWN_UNKNOWN');taint();});for(const[s,key]of[[child.stdin,'stdin'],[child.stdout,'stdout'],[child.stderr,'stderr']]){s.once('close',()=>{streams.add(key);finish();});s.on('error',e=>{if(key==='stdin'&&e.code==='EPIPE')return;failed=fail('STREAM_UNKNOWN');taint();try{child.kill('SIGKILL');}catch{}});if(key!=='stdin')s.on('data',b=>{total+=b.length;if(total>(role==='native-phone-vision-step.py'?18:8)*1024*1024){failed=fail('OUTPUT_LIMIT');taint();try{child.kill('SIGKILL');}catch{}}else(key==='stdout'?out:err).push(b);});}child.once('close',(code,signal)=>{exit={code,signal};finish();});child.stdin.end(input);}catch(e){taint();if(child){try{child.kill('SIGKILL');}catch{}no(fail('SPAWN_UNKNOWN'));}else no(e);}
  });await resources();return result;
 }
 function runOwned(fn){
  active();if(jobs.size)throw fail('BUSY');const job={work:null,cancel:null};jobs.add(job);let reject;
  const interrupted=new Promise((_,no)=>{reject=no;});interrupted.catch(()=>{});job.cancel=()=>{taint();stopChildren();reject(fail('DEADLINE'));};
  const timer=setTimeout(job.cancel,Math.max(1,deadlineMs-Date.now()));
  job.work=Promise.resolve().then(fn).finally(()=>{clearTimeout(timer);jobs.delete(job);closeJournal();});job.work.catch(()=>{});return Promise.race([job.work,interrupted]);
 }
 function snapshot(){try{verifySource();verifyJournal();}catch{taint();}const packet=Object.freeze({domain:'native-phone-local-nofork/v1',sealed,pending:jobs.size,children:children.size,unknown,execution_unknown:unknown,execution_stopped:sealed&&!unknown&&calibrated&&!jobs.size&&!children.size&&fdClosed,calibrated,leaves:structuredClone(leaves),journal:path});packets.add(packet);return packet;}
 function seal(){if(!sealed){sealed=true;if(jobs.size){taint();for(const j of jobs)j.cancel();}stopChildren();}return snapshot();}
 async function close(){if(closing)return closing;closeWanted=true;seal();closing=(async()=>{let timer;try{if(jobs.size)await Promise.race([Promise.allSettled([...jobs].map(j=>j.work)),new Promise(r=>{timer=setTimeout(()=>{taint();r();},Math.max(0,receiptDeadlineMs-Date.now()));})]);}finally{clearTimeout(timer);closeJournal();}return snapshot();})();return closing;}
 record({event:'create',scope_sha256:sha(canonical(fixed)),source_sha256:sha(canonical(src)),deadline_ms:deadlineMs,receipt_deadline_ms:receiptDeadlineMs});
 try{const positive=await runOwned(()=>leaf('calibration-positive','/usr/bin/true',[],'')),negative=await runOwned(()=>leaf('calibration-negative','/bin/sh',['-c','/usr/bin/true & wait'],''));if(positive.code!==0||positive.signal||negative.code===0||negative.signal||!/fork: (Operation not permitted|Resource temporarily unavailable)/.test(negative.stderr))throw fail('NOFORK_UNVERIFIED');calibrated=true;}catch(e){taint();await close();throw fail('INITIALIZATION_UNKNOWN');}
 async function local(helperName,payload){
  if(!helpers.has(helperName)||!payload||Object.getPrototypeOf(payload)!==Object.prototype||typeof payload.operation!=='string')throw fail('INPUT');
  if(!pins.has(helperName))throw fail('SOURCE');
  if(sourceFields.some(k=>Object.hasOwn(payload,k)))throw fail('SOURCE_OVERRIDE');
  let argv,input;
  if(helperName==='native-phone-search-step.py'){
   if(Object.keys(payload).sort().join(',')!=='args,operation'||!searchOps.has(payload.operation)||!Array.isArray(payload.args)||payload.args.some(a=>typeof a!=='string'||a.includes('\0')))throw fail('INPUT');
   if(['filter-ready','filter-option','filter-verify','filter-action'].includes(payload.operation)&&!pil)throw fail('PILLOW_REQUIRED');
   argv=[join(root,'douyin-phone-adb'),pins.get('douyin-phone-adb'),pins.get('search-video-tab.py'),pil?.path||'',pil?.sha256||''];input=JSON.stringify(payload);
  }else if(helperName==='native-phone-detail-step.py'){
   const arity={'foreground-detail':1,'speed-prompt':0,'comment-count':1,'gate-dismiss':3,'card-copy-overlay':1};
   if(fixed.workflow!=='douyin_video_processing'||!['qualification','collection'].includes(fixed.activity)||Object.keys(payload).sort().join(',')!=='args,operation'||!Object.hasOwn(arity,payload.operation)||!Array.isArray(payload.args)||payload.args.length!==arity[payload.operation]||payload.args.some(v=>typeof v!=='string'||v.includes('\0')||Buffer.byteLength(v)>4*1024*1024))throw fail('INPUT');
   if(!pins.has('comment-count-evidence.py'))throw fail('SOURCE');argv=[join(root,'douyin-phone-adb'),pins.get('douyin-phone-adb'),join(root,'comment-count-evidence.py'),pins.get('comment-count-evidence.py')];input=JSON.stringify(payload);
  }else if(helperName==='native-phone-comment-step.py'){
   const fields={panel:'operation,xml',button:'operation,xml',detail:'operation,xml',profile:'nickname,operation,xml',recipient:'commentBody,douyinId,nickname,operation,profile,returned','comment-icon':'operation'};
   if(fixed.workflow!=='douyin_video_processing'||!['qualification','collection'].includes(fixed.activity)||!Object.hasOwn(fields,payload.operation)||Object.keys(payload).sort().join(',')!==fields[payload.operation]||Object.values(payload).some(v=>typeof v!=='string'||v.includes('\0')||Buffer.byteLength(v)>4*1024*1024))throw fail('INPUT');
   const dependencies=['douyin-phone-adb','queued-recipient-evidence.js','comment-count-evidence.py'];if(dependencies.some(path=>!pins.has(path)))throw fail('SOURCE');
   argv=dependencies.flatMap(path=>[join(root,path),pins.get(path)]);input=JSON.stringify(payload);
  }else if(helperName==='native-phone-audio-step.py'){
   const arity={foreground:1,uid:1,session:2,native:5};
   if(fixed.workflow!=='douyin_video_processing'||!['qualification','collection','cleanup'].includes(fixed.activity)||Object.keys(payload).sort().join(',')!=='args,operation'||!Object.hasOwn(arity,payload.operation)||!Array.isArray(payload.args)||payload.args.length!==arity[payload.operation]||payload.args.some(a=>typeof a!=='string'||a.includes('\0')))throw fail('INPUT');
   argv=[join(root,'douyin-phone-adb'),pins.get('douyin-phone-adb')];input=JSON.stringify(payload);
  }else if(helperName==='native-phone-vision-step.py'){
   if(Object.keys(payload).sort().join(',')!=='operation,path,sha256'||payload.operation!=='encode'||!isAbsolute(payload.path||'')||!/^[a-f0-9]{64}$/.test(payload.sha256||''))throw fail('INPUT');
   if(!pil||!pins.has('locate-element.py'))throw fail('SOURCE');
   argv=[join(root,'locate-element.py'),pins.get('locate-element.py'),join(root,'native-phone-search-step.py'),pins.get('native-phone-search-step.py'),pil.path,pil.sha256];input=JSON.stringify(payload);
  }else if(helperName==='native-phone-ui-step.py'){
   const foreground=payload.operation==='foreground';
   if(!['complete','fresh-share','foreground'].includes(payload.operation)||payload.package!=='com.ss.android.ugc.aweme'||Object.keys(payload).sort().join(',')!==(foreground?'foreground,operation,package':'operation,package,xml')||typeof payload[foreground?'foreground':'xml']!=='string')throw fail('INPUT');
   argv=[join(root,'douyin-phone-adb'),pins.get('douyin-phone-adb')];input=JSON.stringify(payload);
  }else{
   if(!linkOps.has(payload.operation))throw fail('INPUT');argv=[];input=JSON.stringify({...structuredClone(payload),controller:join(root,'douyin-phone-adb'),controller_sha256:pins.get('douyin-phone-adb'),widget_script:join(root,'clipboard-widget-cancel.py'),widget_sha256:pins.get('clipboard-widget-cancel.py'),metrics_script:join(root,'discovery-metrics.js'),metrics_sha256:pins.get('discovery-metrics.js')});
  }
  if(Buffer.byteLength(input)>(helperName==='native-phone-comment-step.py'?9:5)*1024*1024)throw fail('INPUT');
  return runOwned(async()=>{const value=await leaf(helperName,py.path,['-I','-S','-c',bootstrap,join(root,helperName),pins.get(helperName),...argv],input);if(value.code!==0){const e=fail('HELPER_FAILED');e.knownLocalFailure=true;e.exitCode=value.code;e.helper=helperName;returned.add(e);throw e;}try{return JSON.parse(value.stdout);}catch{taint();throw fail('RESULT_UNKNOWN');}});
 }
 return Object.freeze({local,seal,close,snapshot,verifyStopped:packet=>packets.has(packet)&&packet.execution_stopped===true&&snapshot().execution_stopped===true});
}
