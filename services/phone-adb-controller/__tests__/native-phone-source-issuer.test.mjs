import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {cpSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=new URL('../',import.meta.url).pathname;
const block=(id,bytes=Buffer.alloc(0))=>{const b=Buffer.alloc(8);b.write(id);b.writeUInt32LE(bytes.length,4);return Buffer.concat([b,bytes]);};
async function fixture(t,{differentBytes=false,commands=false}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'phone-source-issuer-'))),runtime=join(dir,'runtime');cpSync(root,runtime,{recursive:true,filter:p=>!p.split('/').some(s=>['__tests__','node_modules','__pycache__'].includes(s))});t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const sdkFile='/system/bin/uiautomator',bytes=Buffer.from('synthetic fixture finite command source; not production\n'),review='synthetic fixture-only synchronous command review; does not authorize any production device\n';mkdirSync(join(runtime,'config/native-phone-reviews'),{recursive:true});writeFileSync(join(runtime,'config/native-phone-reviews/fixture.md'),review);
 const context={profile:'fixture',serial:'47.100.213.173:10001',width:720,height:1280,keywords:['悦升'],package:'com.ss.android.ugc.aweme'},row={...context,device_sdk:31,review:{path:'config/native-phone-reviews/fixture.md',sha256:sha(review)},program_files:[{path:sdkFile,sha256:sha(bytes)}],commands:['dump']};delete row.keywords;
 const policy=join(runtime,'config/native-phone-command-sources.json');writeFileSync(policy,JSON.stringify({schema_version:1,device_sources:[row]}));
 const shellFrame=(id,bytes)=>{const b=Buffer.alloc(5);b[0]=id;b.writeUInt32LE(bytes.length,1);return Buffer.concat([b,bytes]);};
 const connections=new Set(),requests=[],server=createServer(s=>{
  connections.add(s);s.on('error',()=>{});s.once('close',()=>connections.delete(s));let phase=0,buffer=Buffer.alloc(0);
  s.on('data',b=>{buffer=Buffer.concat([buffer,b]);while(true){
   if(phase<2){
    if(buffer.length<4)return;const n=parseInt(buffer.subarray(0,4).toString(),16);if(buffer.length<4+n)return;
    const service=buffer.subarray(4,4+n).toString();buffer=buffer.subarray(4+n);requests.push(service);
    if(commands&&phase===0&&service==='host-serial:'+context.serial+':features'){s.end(Buffer.from('OKAY0008shell_v2'));return;}
    if(commands&&phase===1&&service.startsWith('shell,v2,raw:')){assert.equal(service,"shell,v2,raw:exec /system/bin/uiautomator 'dump' '--compressed' '/sdcard/douyin-leadgen-ui-fixture.xml'");phase=3;s.write('OKAY');continue;}
    assert.equal(service,phase===0?'host:transport:'+context.serial:'sync:');phase++;s.write('OKAY');
   }else if(phase===3){
    if(buffer.length<5)return;assert.deepEqual(buffer.subarray(0,5),Buffer.from([4,0,0,0,0]));requests.push({id:'CloseStdin'});s.end(Buffer.concat([shellFrame(1,Buffer.from('actual finite fixture output')),shellFrame(3,Buffer.from([0]))]));return;
   }else{
    if(buffer.length<8)return;const id=buffer.subarray(0,4).toString(),n=buffer.readUInt32LE(4);if(buffer.length<8+n)return;
    const value=buffer.subarray(8,8+n).toString();buffer=buffer.subarray(8+n);requests.push({id,path:value});
    if(id==='RECV'){assert.ok(value===sdkFile||value==='/sdcard/douyin-leadgen-ui-fixture.xml');s.write(block('DATA',value===sdkFile?(differentBytes?Buffer.from('foreign image'):bytes):Buffer.from('<hierarchy fixture="synthetic"/>')));s.write(block('DONE'));}
    else{assert.equal(id,'QUIT');s.end();return;}
   }
  }});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of connections)s.destroy();await new Promise(r=>server.close(r));});
 const scope={protocol:'native-phone-adb-read/v1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',run_id:'douyin_video_discovery-fixture__a1',source_commit:'a'.repeat(40),profile:context.profile,serial:context.serial,epoch:1,endpoint:'tcp:127.0.0.1:'+server.address().port,worker_deadline_ms:Date.now()+1500,cleanup_deadline_ms:Date.now()+2000,claim:{claimed_by:'fixture-code',claimed_at:new Date().toISOString()}},names=['native-phone-command-source.mjs','native-phone-adb-read.mjs','adb-shell-v2.mjs','adb-shell-v2-protocol.mjs','runtime-definition.mjs','config/native-phone-command-sources.json','config/native-phone-reviews/fixture.md'];
 const source={commit:scope.source_commit,files:names.map(path=>({path,sha256:sha(readFileSync(join(runtime,path)))}))},readerModule=await import(pathToFileURL(join(runtime,'native-phone-adb-read.mjs'))),api=await import(pathToFileURL(join(runtime,'native-phone-command-source.mjs')));mkdirSync(join(dir,'ingress'),{mode:0o700});
 const reader=readerModule.createNativePhoneAdbRead({runtimeRoot:runtime,source,directory:join(dir,'ingress'),scope,readAuthority:async()=>({scope,claimed_by:scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(scope.cleanup_deadline_ms+2000).toISOString()})});t.after(()=>reader.close());return {api,readerModule,dir,context,runtime,source,scope,reader,requests,policy};
}
test('Code source issuer requires actual RECV/DONE/QUIT/EOF and frozen reviewed policy; JSON cannot issue a command capability',async t=>{
 const f=await fixture(t);assert.equal(typeof f.api.createNativePhoneSourceIssuer,'function');
 assert.throws(()=>f.api.createNativePhoneSourceIssuer({runtimeRoot:f.runtime,source:f.source,scope:f.scope,context:f.context,reader:{verified:true}}),/NATIVE_PHONE_COMMAND_SOURCE/);
 assert.throws(()=>f.api.createNativePhoneSourceIssuer({runtimeRoot:f.runtime,source:f.source,scope:{...f.scope,epoch:2},context:f.context,reader:f.reader}),/NATIVE_PHONE_COMMAND_SOURCE/);assert.equal(f.requests.length,0,'同一实例的外来epoch必须在读取目标设备前拒绝');
 const issuer=f.api.createNativePhoneSourceIssuer({runtimeRoot:f.runtime,source:f.source,scope:f.scope,context:f.context,reader:f.reader}),proof=await issuer.prepare(),read=f.api.readNativePhoneCommandSource(proof,{scope:f.scope});assert.equal(read.serial,f.scope.serial);assert.equal(read.remote_execution_stopped,'not_attested');assert.equal(f.reader.snapshot().channel_stopped,true);
 assert.throws(()=>f.api.readNativePhoneCommandSource({...proof},{scope:f.scope}),/SOURCE/);assert.throws(()=>f.api.readNativePhoneCommandSource(proof,{scope:{...f.scope,serial:'OTHER'}}),/SOURCE/);
 assert.equal(f.api.compileVerifiedNativePhoneCommand(proof,'dump',[],f.context),"exec /system/bin/uiautomator 'dump' '--compressed' '/sdcard/douyin-leadgen-ui-fixture.xml'");assert.throws(()=>f.api.compileVerifiedNativePhoneCommand(proof,'tap',['1','2'],f.context),/SOURCE/);await assert.rejects(issuer.prepare(),/SOURCE/);
 writeFileSync(f.policy,'{}');assert.throws(()=>f.api.readNativePhoneCommandSource(proof,{scope:f.scope}),/SOURCE/);
});
test('mismatched actual device bytes never issue source authority and cannot resend ingress',async t=>{
 const f=await fixture(t,{differentBytes:true});assert.equal(typeof f.api.createNativePhoneSourceIssuer,'function');const issuer=f.api.createNativePhoneSourceIssuer({runtimeRoot:f.runtime,source:f.source,scope:f.scope,context:f.context,reader:f.reader});await assert.rejects(issuer.prepare(),/SOURCE/);await assert.rejects(issuer.prepare(),/SOURCE/);assert.equal(f.requests.filter(r=>r.id==='RECV').length,1);
});

test('unbranded source JSON cannot create a finite native command observer before transport',async t=>{
 const f=await fixture(t),shell=await import(pathToFileURL(join(f.runtime,'adb-shell-v2.mjs')));assert.equal(typeof shell.createNativePhoneCommandObserver,'function');
 assert.throws(()=>shell.createNativePhoneCommandObserver({source:f.source,runtimeRoot:f.runtime,directory:f.runtime,scope:{...f.scope,protocol:'adb-shell-v2-observation/v1'},commandSource:{verified:true,execution_stopped:true},operation:'dump',args:[],context:f.context,readAuthority:async()=>{throw Error('MUST_NOT_READ_AUTHORITY');}}),/SOURCE/);assert.equal(f.requests.length,0);
});

test('actual reviewed command uses real shell-v2 features/EXIT/EOF and returns exact private wire data without whole-Android-stop claims',async t=>{
 const f=await fixture(t,{commands:true}),shell=await import(pathToFileURL(join(f.runtime,'adb-shell-v2.mjs'))),issuer=f.api.createNativePhoneSourceIssuer({runtimeRoot:f.runtime,source:f.source,scope:f.scope,context:f.context,reader:f.reader}),sourceCap=await issuer.prepare();
 const scope={...f.scope,protocol:'adb-shell-v2-observation/v1'},directory=join(f.runtime,'command-one');mkdirSync(directory,{mode:0o700});
 for(const [name,change]of [['endpoint',{endpoint:'tcp:127.0.0.1:1'}],['claim',{claim:{...scope.claim,claimed_by:'foreign'}}]]){const blocked=join(f.runtime,'blocked-'+name);mkdirSync(blocked,{mode:0o700});assert.throws(()=>shell.createNativePhoneCommandObserver({source:f.source,runtimeRoot:f.runtime,directory:blocked,scope:{...scope,...change},commandSource:sourceCap,operation:'dump',args:[],context:f.context,readAuthority:async()=>{throw Error('NO_READ');}}),/SOURCE/);}
 const observer=shell.createNativePhoneCommandObserver({source:f.source,runtimeRoot:f.runtime,directory,scope,commandSource:sourceCap,operation:'dump',args:[],context:f.context,readAuthority:async()=>({scope,claimed_by:scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(scope.cleanup_deadline_ms+2000).toISOString()})});
 try{const result=await observer.observeDump(),value=observer.readReviewedCommandReceipt(result,{scope});assert.equal(value.reviewed_command_returned,true);assert.equal(value.stdout.toString(),'actual finite fixture output');assert.equal(value.code,0);assert.equal(value.android_services,'not_attested');assert.throws(()=>observer.readReviewedCommandReceipt({...result},{scope}),/RECEIPT/);const closed=await observer.close();assert.equal(closed.pending,0);assert.equal(closed.open_sockets,0);assert.equal(observer.verifyWireReceipt(result,{scope}),true);}
 finally{await observer.close();await issuer.close();}
});

test('evidence RECV requires the same private reviewed source and never expands system-source paths',async t=>{
 const f=await fixture(t),issuer=f.api.createNativePhoneSourceIssuer({runtimeRoot:f.runtime,source:f.source,scope:f.scope,context:f.context,reader:f.reader}),cap=await issuer.prepare();
 const directory=join(f.dir,'evidence-read');mkdirSync(directory,{mode:0o700});const options={runtimeRoot:f.runtime,source:f.source,directory,scope:f.scope,readAuthority:async()=>({scope:f.scope,claimed_by:f.scope.claim.claimed_by,claimed_at:f.scope.claim.claimed_at,lease_until:new Date(f.scope.cleanup_deadline_ms+2000).toISOString()})};
 assert.throws(()=>f.readerModule.createNativePhoneEvidenceRead({...options,commandSource:{...cap}}),/SOURCE/);
 const r=f.readerModule.createNativePhoneEvidenceRead({...options,commandSource:cap});
 try{for(const path of ['/system/bin/uiautomator','/sdcard/foreign.xml','/sdcard/douyin-leadgen-ui-foreign.xml'])await assert.rejects(r.read(path),/PATH/);const receipt=await r.read('/sdcard/douyin-leadgen-ui-fixture.xml');assert.equal(r.readReceipt(receipt,{scope:f.scope}).bytes.toString(),'<hierarchy fixture="synthetic"/>');assert.equal((await r.close()).channel_stopped,true);}finally{await r.close();await issuer.close();}
});
