// Fixed original recipient parser in an owned nofork leaf; original bounded HEAD
// resolver owns HTTP. Neither receives Worker programs, rows, URLs-as-proof or SQL.
import {createNativeCollectionHistoryPredicate} from './native-collection-history-proof.mjs';
import {createRequire} from 'node:module';
import {nativeAuthorityProjectionMatches} from './native-activity-authority.mjs';
import {startNativePhoneLinkResolver} from './native-phone-link-resolver.mjs';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,writeSync,fsyncSync,readdirSync,constants} from 'node:fs';
import {join,dirname,resolve,isAbsolute,basename} from 'node:path';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const fail=reason=>Object.assign(Error('NATIVE_COLLECTION_DEPENDENCIES_'+reason),{code:'NATIVE_COLLECTION_DEPENDENCIES_'+reason,executionStopped:false});
const returnedFailures=new WeakSet();export const nativeCollectionDependencyFailureReturned=e=>returnedFailures.has(e);
const dependencyHandles=new WeakMap();
export function readNativeCollectionDependencies(handle,{source,scope}={}){const p=dependencyHandles.get(handle);if(!p||p.source!==canonical(source)||p.scope!==canonical(scope))throw fail('UNBRANDED');p.check();return p.dependencies;}
const profile='(version 1)(allow default)(deny process-fork)';
const required=['native-collection-dependencies.mjs','queued-recipient-evidence.js','nickname-match-lib.js','native-activity-authority.mjs','native-phone-link-resolver.mjs','leadgen-agent-artifacts.mjs'];
function pin(path,expected,max=32*1024*1024){
 if(!isAbsolute(path||'')||resolve(path)!==path||!/^[a-f0-9]{64}$/.test(expected||''))throw fail('SOURCE');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const a=fstatSync(fd),s=lstatSync(path),b=readFileSync(fd),z=fstatSync(fd);if(!a.isFile()||s.isSymbolicLink()||realpathSync(path)!==path||![0,process.getuid()].includes(a.uid)||(a.mode&0o022)||a.size>max||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==s[k])||sha(b)!==expected)throw fail('SOURCE');return a;}finally{closeSync(fd);}
}
export async function startNativeCollectionDependencies({root,directory,source,scope,python,deadlineMs,receiptDeadlineMs,assertAuthority,requestImpl}={}){
 const src=structuredClone(source),fixed=structuredClone(scope),py=structuredClone(python);
 if(process.platform!=='darwin')throw fail('NOFORK_UNSUPPORTED');
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 if(!src||!/^[a-f0-9]{40}$/.test(src.commit||'')||!Array.isArray(src.files)||src.files.length>512||new Set(src.files.map(f=>f.path)).size!==src.files.length||!fixed||!uuid.test(fixed.task_id||'')||!uuid.test(fixed.binding_id||'')||fixed.source_commit!==src.commit||!/^[-A-Za-z0-9_.]{1,150}$/.test(fixed.run_id||'')||!/^[-A-Za-z0-9_.]{1,80}$/.test(fixed.profile||'')||typeof fixed.serial!=='string'||!fixed.serial||fixed.serial==='none'||!Number.isSafeInteger(deadlineMs)||!Number.isSafeInteger(receiptDeadlineMs)||deadlineMs>=receiptDeadlineMs||Date.now()>=deadlineMs||typeof assertAuthority!=='function')throw fail('SCOPE');
 if(!isAbsolute(root||'')||realpathSync(root)!==root||root!==dirname(fileURLToPath(import.meta.url)))throw fail('SOURCE');
 const pins=new Map();for(const f of src.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(v=>v==='.'||v==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw fail('SOURCE');pins.set(f.path,f.sha256);}
 if(required.some(name=>!pins.has(name)))throw fail('SOURCE');
 const systemPins=Object.fromEntries(['/usr/bin/sandbox-exec','/usr/bin/true','/bin/sh'].map(path=>[path,sha(readFileSync(path))]));
 const verifySource=()=>{for(const f of src.files)pin(join(root,f.path),f.sha256,8*1024*1024);pin(py?.path,py?.sha256);for(const[path,hash]of Object.entries(systemPins))pin(path,hash);};verifySource();
 const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(directory)!==resolve(directory)||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||readdirSync(directory).length)throw fail('DIRECTORY');
 const path=join(directory,'local-'+randomUUID()+'.jsonl'),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600),identity=fstatSync(fd),dir=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(dir);}finally{closeSync(dir);}
 const artifactBytes=readFileSync(join(root,'leadgen-agent-artifacts.mjs'));if(sha(artifactBytes)!==pins.get('leadgen-agent-artifacts.mjs'))throw fail('SOURCE');
 const templates=[...artifactBytes.toString('utf8').matchAll(/\nfunction footerProof\([\s\S]*?\n const script=`([\s\S]*?)`;/g)];
 // The original footer template currently contains no JS escapes or template
 // expressions. Refuse a changed representation rather than evaluate JS/code.
 if(templates.length!==1||templates[0][1].includes('${')||templates[0][1].includes('\\'))throw fail('FOOTER_SOURCE');const footerScript=templates[0][1],footerCache=new Set();
 let claim=null;
 const cache=new Map(),require=createRequire(import.meta.url),original=require('./queued-recipient-evidence.js'),{decodeXmlEntities}=require('./nickname-match-lib.js');
 let written='',sealed=false,unknown=false,fdClosed=false,calibrated=false,closing,closeWanted=false;
 const jobs=new Set(),children=new Set(),packets=new WeakSet(),leaves=[];
 const taint=()=>{unknown=true;};
 function verifyJournal(){const s=lstatSync(path),d=lstatSync(directory);if(s.isSymbolicLink()||s.dev!==identity.dev||s.ino!==identity.ino||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||d.dev!==st.dev||d.ino!==st.ino||d.isSymbolicLink()||(d.mode&0o777)!==0o700||readFileSync(path,'utf8')!==written)throw fail('JOURNAL');}
 function record(value){if(fdClosed)throw fail('JOURNAL');try{verifyJournal();const text=JSON.stringify(value)+'\n',bytes=Buffer.from(text);let n=0;while(n<bytes.length){const count=writeSync(fd,bytes,n,bytes.length-n);if(count<1)throw fail('JOURNAL');n+=count;}fsyncSync(fd);written+=text;}catch(e){taint();throw e;}}
 function active(){if(sealed||Date.now()>=deadlineMs)throw fail('CLOSED');if(unknown)throw fail('UNKNOWN');try{verifySource();verifyJournal();}catch(e){taint();throw e;}if(sealed||Date.now()>=deadlineMs)throw fail('CLOSED');}
 function closeJournal(){if(closeWanted&&!jobs.size&&!children.size&&!fdClosed){try{record({event:'final',unknown,leaves:leaves.length});}catch{taint();}try{closeSync(fd);fdClosed=true;}catch{taint();}}}
 async function resources(){active();try{const value=await assertAuthority(structuredClone(fixed));if(!nativeAuthorityProjectionMatches(value,{source:src,scope:fixed}))throw fail('AUTHORITY');const pair=canonical({claimed_by:value.claimed_by,claimed_at:value.claimed_at});if(claim&&pair!==claim)throw fail('CLAIM_CHANGED');claim??=pair;}catch(e){taint();throw e;}active();}
 function stopChildren(){for(const child of children)try{child.kill('SIGKILL');}catch{taint();}}
 const clean={PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1'};
 async function leaf(role,binary,args,input){
  await resources();const item={id:randomUUID(),role,scope_sha256:sha(canonical(fixed)),argv_sha256:sha(canonical([binary,...args])),input_sha256:sha(input),intent_at:Date.now()};record({event:'intent',...item});leaves.push(item);active();
  const result=await new Promise((yes,no)=>{let child,exit,finished=false,failed,total=0,childTimer;const streams=new Set(),out=[],err=[];
   const finish=()=>{if(finished||!exit||streams.size!==3)return;finished=true;clearTimeout(childTimer);children.delete(child);Object.assign(item,exit,{stdio_closed:true,ended_at:Date.now()});try{record({event:'returned',...item,stdout_sha256:sha(Buffer.concat(out)),stderr_sha256:sha(Buffer.concat(err))});}catch(e){failed=e;}if(failed||exit.signal||!Number.isInteger(exit.code)){taint();no(failed||fail('LEAF_UNKNOWN'));}else yes({...exit,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});};
   try{active();child=spawn('/usr/bin/sandbox-exec',['-p',profile,binary,...args],{env:clean,stdio:['pipe','pipe','pipe']});children.add(child);if(role==='original-footer-parser')childTimer=setTimeout(()=>{failed=fail('FOOTER_TIMEOUT');taint();try{child.kill('SIGKILL');}catch{taint();}},Math.max(1,Math.min(3000,deadlineMs-Date.now())));child.once('spawn',()=>{try{item.pid=child.pid;record({event:'started',...item});}catch(e){failed=e;try{child.kill('SIGKILL');}catch{taint();}}});child.once('error',()=>{failed=fail('SPAWN_UNKNOWN');taint();});for(const[s,key]of[[child.stdin,'stdin'],[child.stdout,'stdout'],[child.stderr,'stderr']]){s.once('close',()=>{streams.add(key);finish();});s.on('error',e=>{if(key==='stdin'&&e.code==='EPIPE')return;failed=fail('STREAM_UNKNOWN');taint();try{child.kill('SIGKILL');}catch{}});if(key!=='stdin')s.on('data',b=>{total+=b.length;if(total>(role==='original-footer-parser'?32768:2*1024*1024)){failed=fail('OUTPUT_LIMIT');taint();try{child.kill('SIGKILL');}catch{}}else(key==='stdout'?out:err).push(b);});}child.once('close',(code,signal)=>{exit={code,signal};finish();});child.stdin.end(input);}catch(e){taint();if(child){try{child.kill('SIGKILL');}catch{}no(fail('SPAWN_UNKNOWN'));}else no(e);}
  });await resources();return result;
 }
 function runOwned(fn){
  active();if(jobs.size)throw fail('BUSY');const job={work:null,cancel:null};jobs.add(job);let reject;
  const interrupted=new Promise((_,no)=>{reject=no;});interrupted.catch(()=>{});job.cancel=()=>{if(!jobs.has(job))return;taint();stopChildren();reject(fail('DEADLINE'));};
  const timer=setTimeout(job.cancel,Math.max(1,deadlineMs-Date.now()));
  job.work=Promise.resolve().then(fn).finally(()=>{clearTimeout(timer);jobs.delete(job);closeJournal();});job.work.catch(()=>{});return Promise.race([job.work,interrupted]);
 }
 function snapshot(){try{verifySource();verifyJournal();}catch{taint();}const packet=Object.freeze({domain:'native-collection-parser-nofork/v1',sealed,pending:jobs.size,children:children.size,unknown,execution_unknown:unknown,execution_stopped:sealed&&!unknown&&calibrated&&!jobs.size&&!children.size&&fdClosed,calibrated,leaves:structuredClone(leaves),journal:path});packets.add(packet);return packet;}
 function seal(){if(!sealed){sealed=true;if(jobs.size){taint();for(const j of jobs)j.cancel();}stopChildren();}return snapshot();}
 async function close(){if(closing)return closing;closeWanted=true;seal();closing=(async()=>{let timer;try{if(jobs.size)await Promise.race([Promise.allSettled([...jobs].map(j=>j.work)),new Promise(r=>{timer=setTimeout(()=>{taint();r();},Math.max(0,receiptDeadlineMs-Date.now()));})]);}finally{clearTimeout(timer);closeJournal();}return snapshot();})();return closing;}
 record({event:'create',scope_sha256:sha(canonical(fixed)),source_sha256:sha(canonical(src)),deadline_ms:deadlineMs,receipt_deadline_ms:receiptDeadlineMs});
 try{const positive=await runOwned(()=>leaf('calibration-positive','/usr/bin/true',[],'')),negative=await runOwned(()=>leaf('calibration-negative','/bin/sh',['-c','/usr/bin/true & wait'],''));if(positive.code!==0||positive.signal||negative.code===0||negative.signal||!/fork: (Operation not permitted|Resource temporarily unavailable)/.test(negative.stderr))throw fail('NOFORK_UNVERIFIED');calibrated=true;}catch(e){taint();await close();throw fail('INITIALIZATION_UNKNOWN');}
 const resolver=startNativePhoneLinkResolver({root,source:src,scope:fixed,deadlineMs,receiptDeadlineMs,requestImpl,assertResources:async()=>{await resources();return true;}});
 let serial=Promise.resolve(),pendingHttp=0,httpUnknown=false;const combined=new WeakSet();
 const parserKey=(profile,returned,args)=>sha(canonical({profile,returned,args}));
 function input(profile,returned,args){
  if(typeof profile!=='string'||typeof returned!=='string'||Buffer.byteLength(profile)>4*1024*1024||Buffer.byteLength(returned)>4*1024*1024||!args||Object.keys(args).sort().join(',')!=='commentBody,commentEncoding,douyinId,nickname'||!['xml_raw','canonical'].includes(args.commentEncoding)||['nickname','douyinId','commentBody'].some(k=>typeof args[k]!=='string'||!args[k]))throw fail('INPUT');
  return {profile,returned,nickname:args.nickname,douyinId:args.douyinId,commentBody:args.commentEncoding==='xml_raw'?decodeXmlEntities(args.commentBody):args.commentBody};
 }
 async function prime(profile,returned,args){
  const value=input(profile,returned,args),key=parserKey(profile,returned,args);
  return runOwned(async()=>{const result=await leaf('original-recipient-parser',py.path,['-I','-S','-c',original.recipientNativePython],JSON.stringify(value));if(result.code!==0){const e=fail('PARSER_REJECTED');returnedFailures.add(e);throw e;}let parsed;try{parsed=JSON.parse(result.stdout);}catch{taint();throw fail('RESULT_UNKNOWN');}cache.set(key,parsed);return structuredClone(parsed);});
 }
 const recipientNative=Object.freeze({parseNative(profile,returned,args){active();input(profile,returned,args);const value=cache.get(parserKey(profile,returned,args));if(!value)throw fail('UNPRIMED');return structuredClone(value);}});
 async function prepareRecipient(e,commentBody){if(!e?.raw||!e.scope||typeof commentBody!=='string'||sha(commentBody)!==e.scope.comment_body_sha256)throw fail('INPUT');return prime(e.raw.profile,e.raw.returned,{nickname:e.scope.nickname,douyinId:e.scope.douyin_id,commentBody,commentEncoding:e.scope.comment_encoding});}
 function footerKey(bytes,metadata){if(!Buffer.isBuffer(bytes)||bytes.length>4*1024*1024||!metadata||Object.keys(metadata).sort().join(',')!=='file,run,sha256,video_id'||metadata.run!==fixed.run||!/^\d{16,24}$/.test(metadata.video_id||'')||typeof metadata.file!=='string'||!basename(metadata.file).startsWith(fixed.run+'-v'+metadata.video_id+'-collection-')||!metadata.file.endsWith('.xml')||sha(bytes)!==metadata.sha256)throw fail('FOOTER_INPUT');return canonical(metadata);}
 async function prepareFooter(bytes,metadata){const key=footerKey(bytes,metadata),input=Buffer.from(bytes);return runOwned(async()=>{const result=await leaf('original-footer-parser',py.path,['-I','-S','-c',footerScript],input);if(result.code!==0){const e=fail('FOOTER_REJECTED');returnedFailures.add(e);throw e;}footerCache.add(key);return true;});}
 function verifyFooter(bytes,metadata){active();return footerCache.has(footerKey(bytes,metadata));}
 let historyPredicate;
 function historyArguments(metadata){if(!metadata||Object.keys(metadata).join()!=='douyin_id'||typeof metadata.douyin_id!=='string')throw fail('HISTORY_INPUT');return metadata.douyin_id;}
 function history(){active();return historyPredicate??=createNativeCollectionHistoryPredicate({root,source:src,runOwned:({role,script,stdin})=>runOwned(()=>leaf(role,py.path,['-I','-S','-c',script],stdin))});}
 async function prepareHistoryIdentity(profileBytes,returnedBytes,metadata){const oid=historyArguments(metadata);try{return await history().prepare(profileBytes,returnedBytes,oid);}catch(error){if(error.code==='NATIVE_COLLECTION_HISTORY_REJECTED')returnedFailures.add(error);throw error;}}
 function verifyHistoryIdentity(profileBytes,returnedBytes,metadata){return history().verify(profileBytes,returnedBytes,historyArguments(metadata));}
 function resolveHistoryUrl(url){active();pendingHttp++;const work=serial.then(async()=>{await resources();const canonicalUrl=await resolver.resolveShareLink(url);await resources();const match=canonicalUrl.match(/^https:\/\/www\.douyin\.com\/(video|note)\/([0-9]{16,24})$/);if(!match)throw fail('HTTP_RESULT');return {content_type:match[1],content_id:match[2],resolved_url:canonicalUrl};});serial=work.catch(()=>{});return work.finally(()=>pendingHttp--);}
 function allSnapshot(){const local=snapshot(),http=resolver.snapshot();const proof=Object.freeze({domain:'native-collection-dependencies/v1',local,http,pending_http:pendingHttp,execution_unknown:local.execution_unknown||http.unknown||httpUnknown,execution_stopped:local.execution_stopped&&http.execution_stopped&&!pendingHttp&&!httpUnknown});combined.add(proof);return proof;}
 const parserClose=close,parserSeal=seal;let allClosing;
 function allSeal(){parserSeal();resolver.seal();if(pendingHttp)httpUnknown=true;return allSnapshot();}
 async function allClose(){return allClosing??=(async()=>{if(pendingHttp)httpUnknown=true;await Promise.all([parserClose(),resolver.close()]);return allSnapshot();})();}
 const handle=Object.freeze({prime,prepareRecipient,prepareFooter,verifyFooter,prepareHistoryIdentity,verifyHistoryIdentity,recipientNative,resolveHistoryUrl,seal:allSeal,close:allClose,snapshot:allSnapshot,verifyStopped:p=>combined.has(p)&&p.execution_stopped===true&&allSnapshot().execution_stopped===true});
 dependencyHandles.set(handle,{source:canonical(src),scope:canonical(fixed),check:active,dependencies:Object.freeze({recipientNative,prepareRecipient,prepareFooter,verifyFooter,prepareHistoryIdentity,verifyHistoryIdentity,resolveHistoryUrl})});return handle;
}
