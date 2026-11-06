import {nativePhoneTestPython,nativePhoneTestPilRoot} from './helpers/native-phone-test-python.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync,realpathSync,rmSync,cpSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex');
const api=await import('../native-phone-local-producer.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('actual fixed local producer is available; Worker cannot select executables or helper arguments',()=>{assert.equal(typeof api.startNativePhoneLocalProducer,'function');});
const names=['native-phone-local-producer.mjs','native-phone-search-step.py','native-phone-link-step.py','douyin-phone-adb','search-video-tab.py','clipboard-widget-cancel.py','discovery-metrics.js'];
async function fixture(t,{assertResources=async()=>true,duration=5000,cleanup=6000,includeUi=false,includeVision=false}={}){
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'native-local-'))),runtime=join(parent,'runtime'),directory=join(parent,'journal');mkdirSync(runtime,{mode:0o700});mkdirSync(directory,{mode:0o700});const fixedNames=[...names,...(includeUi?['native-phone-ui-step.py']:[]),...(includeVision?['native-phone-vision-step.py','locate-element.py']:[])];for(const name of fixedNames)copyFileSync(root+name,join(runtime,name));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const source={commit:'a'.repeat(40),files:fixedNames.map(path=>({path,sha256:sha(readFileSync(join(runtime,path)))}))},scope={task_id:randomUUID(),binding_id:randomUUID(),run_id:'douyin_video_discovery-fixture__a1',source_commit:source.commit,profile:'fixture',serial:'47.100.213.173:10001',activity:'collect_videos'};
 const python=nativePhoneTestPython(),module=await import(pathToFileURL(join(runtime,'native-phone-local-producer.mjs'))),options={root:runtime,directory,source,scope,python:{path:python,sha256:sha(readFileSync(python))},deadlineMs:Date.now()+duration,receiptDeadlineMs:Date.now()+cleanup,assertResources};return {module,options,runtime,directory};
}
test('real sandbox calibration and both actual helper transports close all three streams before a branded stop',async t=>{
 const f=await fixture(t),p=await f.module.startNativePhoneLocalProducer(f.options);t.after(()=>p.close());
 assert.equal(p.snapshot().calibrated,true);assert.equal(p.snapshot().leaves.length,2);assert.equal(p.snapshot().leaves[0].code,0);assert.notEqual(p.snapshot().leaves[1].code,0);
 const search=await p.local('native-phone-search-step.py',{operation:'filter-index',args:['time','one_week']});assert.equal(search.code,0);assert.match(search.stdout,/^[0-9]+ [0-9]+$/);
 const xml='<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="分享1，按钮" clickable="true" bounds="[10,10][40,40]"/></hierarchy>';
 const link=await p.local('native-phone-link-step.py',{operation:'detail',xml,width:720,height:1280});assert.deepEqual(link,{accepted:true,center:[25,25]});assert.equal(p.snapshot().pending,0);
 const stopped=await p.close();assert.equal(stopped.execution_stopped,true);assert.equal(stopped.leaves.length,4);assert.ok(stopped.leaves.every(l=>l.stdio_closed===true));assert.equal(p.verifyStopped(stopped),true);assert.equal(p.verifyStopped(structuredClone(stopped)),false);await assert.rejects(p.local('native-phone-link-step.py',{operation:'detail',xml,width:720,height:1280}),/CLOSED/);
});
test('unsupported helpers, Source override, invalid search argv and absent Pillow reject before launching any helper',async t=>{
 const f=await fixture(t),p=await f.module.startNativePhoneLocalProducer(f.options);t.after(()=>p.close());
 for(const [name,input]of [['/bin/sh',{operation:'detail'}],['native-phone-link-step.py',{operation:'detail',controller:'/tmp/worker'}],['native-phone-search-step.py',{operation:'filter-index',args:['time','one_week'],program:'id'}],['native-phone-search-step.py',{operation:'filter-option',args:['/tmp/x','0','0']}]])await assert.rejects(p.local(name,input),/INPUT|SOURCE_OVERRIDE|PILLOW_REQUIRED/);
 assert.equal(p.snapshot().leaves.length,2);assert.equal((await p.close()).execution_stopped,true);
});
test('a genuine returned helper rejection is a known failure and still closes without granting the failure as a stop proof',async t=>{
 const f=await fixture(t),p=await f.module.startNativePhoneLocalProducer(f.options);t.after(()=>p.close());let error;try{await p.local('native-phone-link-step.py',{operation:'field',xml:'not XML',width:720,height:1280});}catch(e){error=e;}
 assert.ok(error);assert.equal(f.module.nativePhoneLocalFailureReturned(error),true);assert.equal(f.module.nativePhoneLocalFailureReturned({...error}),false);assert.equal(p.snapshot().unknown,false);assert.equal((await p.close()).execution_stopped,true);
});
test('wrong frozen self Source or interpreter rejects before resource callback or calibration',async t=>{
 let reads=0;const f=await fixture(t,{assertResources:async()=>{reads++;return true;}});
 await assert.rejects(f.module.startNativePhoneLocalProducer({...f.options,source:{...f.options.source,files:f.options.source.files.map(x=>({...x,sha256:'0'.repeat(64)}))}}),/SOURCE/);assert.equal(reads,0);
 await assert.rejects(f.module.startNativePhoneLocalProducer({...f.options,python:{...f.options.python,sha256:'0'.repeat(64)}}),/SOURCE/);assert.equal(reads,0);
});
test('source drift after startup is sticky unknown and starts no new child',async t=>{
 const f=await fixture(t),p=await f.module.startNativePhoneLocalProducer(f.options);t.after(()=>p.close());const file=join(f.runtime,'native-phone-link-step.py');writeFileSync(file,readFileSync(file,'utf8')+'\n# changed after Source freeze\n');
 await assert.rejects(p.local('native-phone-link-step.py',{operation:'detail',xml:'<hierarchy/>',width:720,height:1280}),/SOURCE/);assert.equal(p.snapshot().leaves.length,2);assert.equal(p.snapshot().unknown,true);assert.equal((await p.close()).execution_stopped,false);
});
test('fixed third UI helper requires its own Source pin and never falls through to another parser',async t=>{
 const f=await fixture(t),p=await f.module.startNativePhoneLocalProducer(f.options);t.after(()=>p.close());
 await assert.rejects(p.local('native-phone-ui-step.py',{operation:'complete',xml:'<hierarchy/>'}),/SOURCE/);assert.equal(p.snapshot().leaves.length,2);assert.equal((await p.close()).execution_stopped,true);
});

test('actual fixed UI leaf parses original complete, fresh-share and exact foreground predicates',async t=>{
 const f=await fixture(t,{includeUi:true}),p=await f.module.startNativePhoneLocalProducer(f.options);t.after(()=>p.close());
 const packageName='com.ss.android.ugc.aweme',xml='<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="分享1，按钮" clickable="true"/></hierarchy>';
 for(const operation of ['complete','fresh-share'])assert.deepEqual(await p.local('native-phone-ui-step.py',{operation,package:packageName,xml}),{accepted:true});
 assert.deepEqual(await p.local('native-phone-ui-step.py',{operation:'foreground',package:packageName,foreground:'mCurrentFocus=Window{token u0 com.ss.android.ugc.aweme/.main.MainActivity}'}),{accepted:true});
 assert.deepEqual(await p.local('native-phone-ui-step.py',{operation:'foreground',package:packageName,foreground:'com.ss.android.ugc.aweme/.main.MainActivity other.package/.Other'}),{accepted:false});
 assert.deepEqual(await p.local('native-phone-ui-step.py',{operation:'complete',package:packageName,xml:'<hierarchy><node package="other.package"/></hierarchy>'}),{accepted:false});
 const before=p.snapshot().leaves.length;
 for(const input of [{operation:'complete',package:'other.package',xml},{operation:'complete',package:packageName,xml,controller:'/tmp/worker'},{operation:'foreground',package:packageName,foreground:'',xml},{operation:'complete',package:packageName,xml,argv:['--worker-code']}])await assert.rejects(p.local('native-phone-ui-step.py',input),/INPUT|SOURCE_OVERRIDE/);
 assert.equal(p.snapshot().leaves.length,before);assert.equal((await p.close()).execution_stopped,true);
});

test('last authority read remains inside pending deadline even after the real helper and streams already returned',async t=>{
 let mode=false,reads=0,release,reached;const waiting=new Promise(r=>release=r),atFinal=new Promise(r=>reached=r);
 const f=await fixture(t,{duration:700,cleanup:1000,assertResources:async()=>{if(mode&&++reads===2){reached();await waiting;}return true;}}),p=await f.module.startNativePhoneLocalProducer(f.options);mode=true;
 try{const work=p.local('native-phone-search-step.py',{operation:'filter-index',args:['time','one_week']}),reject=assert.rejects(work,/DEADLINE/);await atFinal;await reject;const closed=await p.close();assert.equal(closed.pending,1);assert.equal(closed.children,0);assert.equal(closed.unknown,true);assert.equal(closed.execution_stopped,false);release();await new Promise(r=>setTimeout(r,30));assert.equal(p.snapshot().pending,0);assert.equal(p.snapshot().unknown,true);assert.equal(p.verifyStopped(closed),false);}finally{release();await p.close();}
});
test('missing actual stdout close keeps the original job pending; a late close cannot wash away timeout',async t=>{
 const f=await fixture(t,{duration:700,cleanup:1000});const original=childProcess.spawn;let replay,seen=false;
 t.mock.method(childProcess,'spawn',(...args)=>{const child=original(...args);if(args[1]?.includes('native-phone-link-step.py')||args[1]?.some(x=>String(x).endsWith('/native-phone-link-step.py'))){const emit=child.stdout.emit;child.stdout.emit=function(event,...rest){if(event==='close'&&!seen){seen=true;replay=()=>emit.call(this,event,...rest);return false;}return emit.call(this,event,...rest);};}return child;});syncBuiltinESMExports();
 try{const p=await f.module.startNativePhoneLocalProducer(f.options);await assert.rejects(p.local('native-phone-link-step.py',{operation:'detail',xml:'<hierarchy/>',width:720,height:1280}),/DEADLINE/);const closed=await p.close();assert.equal(seen,true);assert.equal(closed.pending,1);assert.equal(closed.unknown,true);assert.equal(closed.execution_stopped,false);replay();await new Promise(r=>setTimeout(r,30));assert.equal(p.snapshot().pending,0);assert.equal(p.snapshot().unknown,true);assert.equal(p.snapshot().execution_stopped,false);}finally{replay?.();t.mock.restoreAll();syncBuiltinESMExports();}
});

test('filter-ready uses the actual Source-pinned complete Pillow package before any phone operation',async t=>{
 const f=await fixture(t,{includeVision:true}),python=nativePhoneTestPython();
 const path=nativePhoneTestPilRoot(python);
 const pilRoot=join(f.runtime,'PIL');cpSync(path,pilRoot,{recursive:true,filter:p=>!p.split('/').includes('__pycache__')});const files=[];const scan=(dir,prefix='')=>{for(const row of readdirSync(dir,{withFileTypes:true})){const rel=prefix?prefix+'/'+row.name:row.name;if(row.isDirectory())scan(join(dir,row.name),rel);else{assert.ok(row.isFile());files.push({path:rel,sha256:sha(readFileSync(join(dir,row.name)))});}}};scan(pilRoot);const spec=join(f.runtime,'pillow.json');writeFileSync(spec,JSON.stringify({root:pilRoot,files}));
 const p=await f.module.startNativePhoneLocalProducer({...f.options,python:{path:python,sha256:sha(readFileSync(python))},pillow:{path:spec,sha256:sha(readFileSync(spec))}});t.after(()=>p.close());
 assert.deepEqual(await p.local('native-phone-search-step.py',{operation:'filter-ready',args:[]}),{code:0,stdout:'',stderr:''});assert.equal(p.snapshot().leaves.length,3);
 const png=(width,height)=>{const crc=bytes=>{let x=0xffffffff;for(const byte of bytes){x^=byte;for(let b=0;b<8;b++)x=(x>>>1)^((x&1)?0xedb88320:0);}return (x^0xffffffff)>>>0;},chunk=(name,bytes)=>{const head=Buffer.alloc(8),end=Buffer.alloc(4);head.writeUInt32BE(bytes.length);head.write(name,4);end.writeUInt32BE(crc(Buffer.concat([Buffer.from(name),bytes])));return Buffer.concat([head,bytes,end]);},header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const rows=[];for(let y=0;y<height;y++)rows.push(Buffer.concat([Buffer.from([0]),randomBytes(width*3)]));return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);};
 for(const [name,width,height,mime] of [['small',1,1,'image/png'],['large',720,720,'image/jpeg']]){
  const bytes=png(width,height),path=join(f.runtime,name+'.png');writeFileSync(path,bytes,{mode:0o600});const value=await p.local('native-phone-vision-step.py',{operation:'encode',path,sha256:sha(bytes)});assert.equal(value.mime,mime);assert.equal(value.width,width);assert.equal(value.height,height);const encoded=Buffer.from(value.image_b64,'base64');if(mime==='image/png')assert.deepEqual(encoded,bytes);else assert.equal(encoded.subarray(0,2).toString('hex'),'ffd8');
 }
 const before=p.snapshot().leaves.length;await assert.rejects(p.local('native-phone-vision-step.py',{operation:'encode',path:'/tmp/worker',sha256:'0'.repeat(64),program:'id'}),/INPUT/);assert.equal(p.snapshot().leaves.length,before);
 writeFileSync(join(pilRoot,'Image.py'),readFileSync(join(pilRoot,'Image.py'),'utf8')+'\n# drift');await assert.rejects(p.local('native-phone-search-step.py',{operation:'filter-ready',args:[]}),/HELPER_FAILED/);assert.equal((await p.close()).execution_stopped,true);
});
