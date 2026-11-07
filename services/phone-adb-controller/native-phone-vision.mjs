// Finite Code grounding, never an agent/action executor. HTTP close is not a
// claim that remote inference or Android stopped. Factory owns every callback.
import https from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,openSync,closeSync,fsyncSync,fstatSync,lstatSync,realpathSync,writeSync,readdirSync,constants} from 'node:fs';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPreflightPng} from './preflight-phone-driver.mjs';
const endpoint='https://openrouter.ai/api/v1/chat/completions',model='bytedance/ui-tars-1.5-7b';
const system=`You are a GUI agent. You are given a task and a screenshot. You need to output the action to complete the task.

## Output Format
Thought: ...
Action: ...

## Action Space
click(start_box='<|box_start|>(x1,y1)<|box_end|>')

## Note
- Use Chinese in Thought part.
- Output only one action.
`;
const discoveryPrompts=Object.freeze({vtab:'顶部搜索结果标签栏中的「视频」标签',fbtn:'右上角的筛选按钮（漏斗图标）'}),sha=b=>createHash('sha256').update(b).digest('hex');
const collectionPrompts=Object.freeze({cicon:'视频右侧竖排图标中的评论图标：对话气泡形状，在红心点赞图标的正下方，气泡下方有评论数字。不要选屏幕最底部那条评论输入框。'});
const qualificationPrompts=Object.freeze({speed3:"播放速度菜单中的「'3.0'」倍速选项数字"});
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const fail=(code,unknown=false)=>Object.assign(Error('NATIVE_VISION_'+code),{code:'NATIVE_VISION_'+code,returned:!unknown,executionStopped:!unknown,resourceUnknown:unknown});
export function startNativePhoneVision({root,source,scope,context,directory,deadlineMs,receiptDeadlineMs,assertResources,credential,prepareImage,io,requestImpl=https.request}={}){
 const src=structuredClone(source),fixed=structuredClone(scope),c=structuredClone(context);
 const prompts=fixed?.workflow==='douyin_video_discovery'&&fixed.activity==='collect_videos'?discoveryPrompts:fixed?.workflow==='douyin_video_processing'&&fixed.activity==='collection'?collectionPrompts:fixed?.workflow==='douyin_video_processing'&&fixed.activity==='qualification'?qualificationPrompts:null;
 if(!src||!/^[a-f0-9]{40}$/.test(src.commit||'')||fixed?.source_commit!==src.commit||!['task_id','binding_id'].every(k=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fixed[k]||''))||!prompts||!c||!/^[-A-Za-z0-9_.]{1,80}$/.test(c.run||'')||!['width','height'].every(k=>Number.isSafeInteger(c[k])&&c[k]>0&&c[k]<=10000)||!Number.isSafeInteger(deadlineMs)||!Number.isSafeInteger(receiptDeadlineMs)||Date.now()>=deadlineMs||deadlineMs>=receiptDeadlineMs||fixed.run!==c.run||deadlineMs>fixed.worker_deadline_ms||receiptDeadlineMs>fixed.receipt_deadline_ms||!Number.isSafeInteger(fixed.worker_deadline_ms)||!Number.isSafeInteger(fixed.receipt_deadline_ms)||typeof assertResources!=='function'||typeof credential!=='function'||typeof prepareImage!=='function'||!io||['snapshot','readArtifact','wait'].some(k=>typeof io[k]!=='function')||typeof requestImpl!=='function')throw fail('SCOPE');
 if(!isAbsolute(root||'')||root!==realpathSync(root)||root!==dirname(fileURLToPath(import.meta.url))||!Array.isArray(src.files)||src.files.length>512||new Set(src.files.map(f=>f.path)).size!==src.files.length||['native-phone-vision.mjs','locate-element.py','preflight-phone-driver.mjs'].some(path=>!src.files.some(f=>f.path===path)))throw fail('SOURCE');
 function verifySource(){for(const f of src.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(x=>x==='.'||x==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw fail('SOURCE');const path=join(root,f.path),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=fstatSync(fd),b=readFileSync(fd),z=fstatSync(fd),s=lstatSync(path);if(!a.isFile()||![0,process.getuid()].includes(a.uid)||a.mode&0o022||realpathSync(path)!==path||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==s[k])||sha(b)!==f.sha256)throw fail('SOURCE');}finally{closeSync(fd);}}}verifySource();
 if(!isAbsolute(directory||'')||realpathSync(directory)!==resolve(directory))throw fail('DIRECTORY');const ds=lstatSync(directory);if(!ds.isDirectory()||ds.isSymbolicLink()||ds.uid!==process.getuid()||(ds.mode&0o777)!==0o700||readdirSync(directory).length)throw fail('DIRECTORY');
 const path=join(directory,'vision-'+randomUUID()+'.jsonl'),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600),identity=fstatSync(fd);let written='',fdClosed=false,sealed=false,unknown=false,closing,current=null,sequence=0;const jobs=new Set(),channels=new Set(),proofs=new WeakSet(),exchanges=[];
 const taint=()=>{unknown=true;};
 function journal(){const a=lstatSync(path),d=lstatSync(directory);if(a.isSymbolicLink()||a.dev!==identity.dev||a.ino!==identity.ino||a.uid!==process.getuid()||(a.mode&0o777)!==0o600||d.dev!==ds.dev||d.ino!==ds.ino||d.isSymbolicLink()||(d.mode&0o777)!==0o700||readFileSync(path,'utf8')!==written)throw fail('JOURNAL');}
 function record(row){if(fdClosed)throw fail('JOURNAL');try{journal();const text=JSON.stringify(row)+'\n',b=Buffer.from(text);let n=0;while(n<b.length){const k=writeSync(fd,b,n,b.length-n);if(k<1)throw fail('JOURNAL');n+=k;}fsyncSync(fd);written+=text;}catch(e){taint();throw e;}}
 function active(){if(sealed||unknown||Date.now()>=deadlineMs)throw fail(unknown?'UNKNOWN':'CLOSED',unknown);try{verifySource();journal();}catch(e){taint();throw e;}}
 async function admit(){active();try{if(await assertResources(structuredClone(fixed))!==true)throw fail('AUTHORITY',true);}catch(e){taint();throw fail('AUTHORITY',true);}active();}
 function destroy(){for(const item of channels)try{item.destroy();}catch{taint();}}
 function snapshot(){try{verifySource();journal();}catch{taint();}const p=Object.freeze({domain:'native-phone-vision/v1',sealed,unknown,pending:jobs.size,open_channels:channels.size,execution_stopped:sealed&&!unknown&&!jobs.size&&!channels.size&&fdClosed,remote_inference_stopped:'not_attested',remote_execution_stopped:'not_attested',exchanges:structuredClone(exchanges),journal:path});proofs.add(p);return p;}
 function finishJournal(){if(sealed&&!jobs.size&&!channels.size&&!fdClosed){try{record({event:'final',unknown});}catch{taint();}try{closeSync(fd);fdClosed=true;}catch{taint();}}}
 async function post(body,token){await admit();return new Promise((yes,no)=>{
  let req,res,socket,reqClosed=false,resClosed=false,socketClosed=false,ended=false,finished=false,error,status,timer;const parts=[];let bytes=0;
  const finish=()=>{if(finished||!reqClosed||(res&&!resClosed)||(socket&&!socketClosed))return;finished=true;clearTimeout(timer);if(!ended&&!error){taint();error=fail('RESPONSE_UNKNOWN',true);}const raw=Buffer.concat(parts);const row={status,request_closed:reqClosed,response_closed:res?resClosed:null,socket_closed:socket?socketClosed:null,response_sha256:sha(raw),error:error?.code};exchanges.push(row);try{record({event:'transport-returned',...row});}catch(e){error=e;}if(error)no(error);else yes({status,raw});};
  const abort=e=>{if(finished)return;error??=e;if(e.resourceUnknown)taint();try{req?.destroy();res?.destroy();socket?.destroy();}catch{taint();}finish();};
  try{record({event:'transport-start',endpoint,model,body_sha256:sha(body)});req=requestImpl(new URL(endpoint),{method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),Authorization:'Bearer '+token}},r=>{res=r;channels.add(r);status=r.statusCode;r.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)abort(fail('RESPONSE_LIMIT',true));else parts.push(chunk);});r.once('end',()=>{ended=true;});r.once('error',()=>abort(fail('NETWORK',true)));r.once('close',()=>{resClosed=true;channels.delete(r);finish();});});channels.add(req);req.once('socket',s=>{socket=s;channels.add(s);s.once('close',()=>{socketClosed=true;channels.delete(s);finish();});});req.once('error',()=>abort(fail('NETWORK',true)));req.once('close',()=>{reqClosed=true;channels.delete(req);finish();});timer=setTimeout(()=>abort(fail('DEADLINE',true)),Math.max(1,Math.min(90000,deadlineMs-Date.now())));current={abort};req.end(body);}catch(e){taint();abort(fail('REQUEST_UNKNOWN',true));if(!req){clearTimeout(timer);no(error);}}
 });}
 async function locate(input){
  active();if(jobs.size)throw fail('BUSY');if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).sort().join(',')!=='clear_cache,evidence_id,key,prompt'||input.clear_cache!==true||!Object.hasOwn(prompts,input.key)||input.prompt!==prompts[input.key]||typeof input.evidence_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$/.test(input.evidence_id)||!input.evidence_id.startsWith(c.run+'-'))throw fail('INPUT');
  const job={id:++sequence,done:null};jobs.add(job);let interrupt;const interrupted=new Promise((_,no)=>{interrupt=no;});interrupted.catch(()=>{});const timer=setTimeout(()=>{taint();current?.abort(fail('DEADLINE',true));interrupt(fail('DEADLINE',true));},Math.max(1,deadlineMs-Date.now()));
  const work=(async()=>{for(let attempt=1;attempt<=3;attempt++){
   try{await admit();const cap=await io.snapshot(input.evidence_id+'-l'+attempt+'-locate'),artifact=io.readArtifact(cap);if(artifact?.ext!=='png'||!Buffer.isBuffer(artifact.bytes)||artifact.sha256!==sha(artifact.bytes))throw fail('ARTIFACT');assertPreflightPng(artifact.bytes,{width:c.width,height:c.height});await admit();const image=await prepareImage(Buffer.from(artifact.bytes),{artifact});await admit();if(!image||!Buffer.isBuffer(image.bytes)||!image.bytes.length||image.bytes.length>12*1024*1024||!['image/png','image/jpeg'].includes(image.mime)||image.width!==c.width||image.height!==c.height)throw fail('IMAGE');if(image.mime==='image/png')assertPreflightPng(image.bytes,{width:c.width,height:c.height});
    const body=JSON.stringify({model,max_tokens:200,messages:[{role:'system',content:system},{role:'user',content:[{type:'image_url',image_url:{url:`data:${image.mime};base64,`+image.bytes.toString('base64')}},{type:'text',text:'## User Instruction\n点击'+input.prompt}]}]});await admit();const token=await credential();if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw fail('CREDENTIAL');await admit();const response=await post(body,token);await admit();if(response.status!==200)throw fail('HTTP');let text;try{text=JSON.parse(response.raw).choices[0].message.content;}catch{throw fail('RESPONSE');}if(typeof text!=='string')throw fail('RESPONSE');const pairs=[...text.matchAll(/\((\d+)\s*,\s*(\d+)\)/g)],last=pairs.at(-1);if(!last)throw fail('COORDINATE');const xy=last.slice(1).map(Number);
    // Preserve the legacy locate CLI's width/height + 1 and inclusive bounds.
    // The unchanged macro/compiler enforce their stricter actual tap bounds.
    if(xy.some(v=>!Number.isSafeInteger(v))||xy[0]<0||xy[1]<0||xy[0]>c.width+1||xy[1]>c.height+1)throw fail('COORDINATE_BOUNDS');record({event:'grounded',attempt,key:input.key,evidence_id:input.evidence_id,screenshot_sha256:artifact.sha256,response_sha256:sha(response.raw),coordinate:xy});return {coordinate:xy.join(' '),evidence:artifact.path,screenshot_sha256:artifact.sha256};
   }catch(e){if(unknown||e?.returned!==true||e?.executionStopped===false){taint();throw fail('DEPENDENCY_UNKNOWN',true);}if(attempt===3)throw e;await admit();await io.wait(800);await admit();}
  }})().finally(()=>{clearTimeout(timer);jobs.delete(job);current=null;finishJournal();});job.done=work;work.catch(()=>{});return Promise.race([work,interrupted]);
 }
 function seal(){if(!sealed){sealed=true;if(jobs.size){taint();current?.abort(fail('CANCELLED',true));}destroy();finishJournal();}return snapshot();}
 async function close(){if(closing)return closing;seal();closing=(async()=>{let timer;try{if(jobs.size||channels.size)await Promise.race([Promise.allSettled([...jobs].map(j=>j.done)),new Promise(r=>{timer=setTimeout(()=>{taint();destroy();r();},Math.max(0,receiptDeadlineMs-Date.now()));})]);}finally{clearTimeout(timer);finishJournal();}return snapshot();})();return closing;}
 record({event:'create',scope_sha256:sha(canonical(fixed)),source_sha256:sha(canonical(src)),deadline_ms:deadlineMs,receipt_deadline_ms:receiptDeadlineMs});
 return Object.freeze({locate,seal,close,snapshot,verifyStopped:p=>proofs.has(p)&&p.execution_stopped===true&&snapshot().execution_stopped===true});
}
