import {nativePhoneTestPython} from './helpers/native-phone-test-python.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,realpathSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import {createServer,request} from 'node:http';
import {usingPhoneQueue} from './fixtures/native-phone-queue-fixture.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function fixture(t,fn){return usingPhoneQueue(t,async f=>{
 for(const path of ['native-collection-history-proof.mjs','queued-comment-history.js','douyin-phone-adb','native-collection-dependencies.mjs','native-phone-link-resolver.mjs','queued-recipient-evidence.js','nickname-match-lib.js','native-activity-authority.mjs'])if(!f.source.files.some(x=>x.path===path))f.source.files.push({path,sha256:sha(readFileSync(join(f.root,path)))});
 const api=await f.load('native-collection-dependencies.mjs'),python=nativePhoneTestPython(),options={root:f.root,source:f.source,scope:f.scope,directory:f.makeDirectory('collection-dependencies'),python:{path:python,sha256:sha(readFileSync(python))},deadlineMs:f.scope.worker_deadline_ms,receiptDeadlineMs:f.scope.receipt_deadline_ms,assertAuthority:f.authority()};
 const profile=readFileSync(new URL('./fixtures/honor-e1b-recipient/profile.xml',import.meta.url),'utf8'),returned=readFileSync(new URL('./fixtures/honor-e1b-recipient/returned.xml',import.meta.url),'utf8'),args={nickname:'测试评论人',douyinId:'fixture-account-102',commentBody:'测试完整评论 首评',commentEncoding:'canonical'};
 return fn({...f,api,options,profile,returned,args});
 });}
test('actual original parser runs in calibrated nofork leaf, callback only consumes exact primed XML and branded close',async t=>fixture(t,async f=>{
 const p=await f.api.startNativeCollectionDependencies(f.options);t.after(()=>p.close());
 assert.equal(f.api.readNativeCollectionDependencies(p,{source:f.source,scope:f.scope}).recipientNative,p.recipientNative);
 assert.throws(()=>f.api.readNativeCollectionDependencies({...p},{source:f.source,scope:f.scope}),/UNBRANDED/);
 assert.throws(()=>f.api.readNativeCollectionDependencies(p,{source:f.source,scope:{...f.scope,serial:'foreign'}}),/UNBRANDED/);
 assert.equal(p.snapshot().local.calibrated,true);assert.equal(p.snapshot().local.leaves.length,2);
 assert.throws(()=>p.recipientNative.parseNative(f.profile,f.returned,f.args),/UNPRIMED/);
 const result=await p.prime(f.profile,f.returned,f.args);assert.equal(result.native_profile_verified,true);assert.equal(result.returned_comment_verified,true);
 assert.deepEqual(p.recipientNative.parseNative(f.profile,f.returned,f.args),result);
 assert.throws(()=>p.recipientNative.parseNative(f.profile,f.returned,{...f.args,commentBody:'外来正文'}),/UNPRIMED/);
 await assert.rejects(p.prime(f.profile,f.returned,{...f.args,douyinId:'foreign'}),/PARSER_REJECTED/);
 const stopped=await p.close();assert.equal(stopped.execution_stopped,true);assert.equal(p.verifyStopped(stopped),true);assert.equal(p.verifyStopped(structuredClone(stopped)),false);assert.equal(stopped.local.leaves.length,4);assert.ok(stopped.local.leaves.every(x=>x.stdio_closed));
}));
test('same-VID history aliases use actual serialized HEAD requests and close all socket lifetimes',async t=>fixture(t,async f=>{
 let active=0,max=0,calls=0;const server=createServer((req,res)=>{assert.equal(req.method,'HEAD');calls++;max=Math.max(max,++active);setTimeout(()=>{active--;res.writeHead(302,{location:'https://www.douyin.com/video/'+f.video.videoId,connection:'close'});res.end();},10);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const p=await f.api.startNativeCollectionDependencies({...f.options,requestImpl:(url,opts,cb)=>{assert.equal(url.host,'v.douyin.com');return request({hostname:'127.0.0.1',port:server.address().port,path:url.pathname,...opts},cb);}});t.after(()=>p.close());
 const results=await Promise.all(['first','second'].map(x=>p.resolveHistoryUrl('https://v.douyin.com/'+x+'/')));
 assert.equal(calls,2);assert.equal(max,1);for(const result of results)assert.deepEqual(result,{content_type:'video',content_id:f.video.videoId,resolved_url:'https://www.douyin.com/video/'+f.video.videoId});
 const stopped=await p.close();assert.equal(stopped.execution_stopped,true);assert.equal(stopped.http.channels,0);assert.equal(stopped.http.exchanges.length,2);assert.ok(stopped.http.exchanges.every(x=>x.request_closed&&x.response_closed&&x.socket_closed));
}));
test('plain Task JSON never reaches a parser child or HTTP socket',async t=>fixture(t,async f=>{
 let requests=0;await assert.rejects(f.api.startNativeCollectionDependencies({...f.options,assertAuthority:async()=>({id:f.scope.task_id,status:'in_progress',claimed_by:'worker',claimed_at:new Date().toISOString()}),requestImpl:()=>{requests++;throw Error('must not request');}}),/INITIALIZATION_UNKNOWN/);assert.equal(requests,0);
}));
test('source drift is sticky unknown and cannot be washed by a later close',async t=>fixture(t,async f=>{
 const p=await f.api.startNativeCollectionDependencies(f.options);t.after(()=>p.close());const before=p.snapshot().local.leaves.length,file=join(f.root,'queued-recipient-evidence.js');writeFileSync(file,readFileSync(file,'utf8')+'\n// Source drift\n');
 await assert.rejects(p.prime(f.profile,f.returned,f.args),/SOURCE/);assert.equal(p.snapshot().local.leaves.length,before);assert.equal((await p.close()).execution_stopped,false);
}));
test('Source-owned original footer script runs as an actual nofork leaf and sync reader accepts only exact primed proof',async t=>fixture(t,async f=>{
 const p=await f.api.startNativeCollectionDependencies(f.options);t.after(()=>p.close());assert.equal(typeof p.prepareFooter,'function');assert.equal(typeof p.verifyFooter,'function');
 const xml=f.returned.replace('</node></node></hierarchy>','<node package="com.ss.android.ugc.aweme" class="android.widget.TextView" text="暂时没有更多了"/></node></node></hierarchy>'),bytes=Buffer.from(xml),meta={file:join(f.options.directory,f.scope.run+'-v'+f.video.videoId+'-collection-footer.xml'),sha256:sha(bytes),run:f.scope.run,video_id:f.video.videoId};
 assert.equal(p.verifyFooter(bytes,meta),false);await p.prepareFooter(bytes,meta);assert.equal(p.verifyFooter(bytes,meta),true);assert.equal(f.api.readNativeCollectionDependencies(p,{source:f.source,scope:f.scope}).verifyFooter(bytes,meta),true);
 const other={...meta,file:meta.file.replace('-footer.xml','-other.xml')};assert.equal(p.verifyFooter(bytes,other),false);
 const invalid=Buffer.from(f.returned),invalidMeta={...meta,sha256:sha(invalid)};await assert.rejects(p.prepareFooter(invalid,invalidMeta),/FOOTER_REJECTED/);assert.equal(p.verifyFooter(invalid,invalidMeta),false);const stopped=await p.close();assert.equal(stopped.execution_stopped,true);assert.ok(stopped.local.leaves.filter(l=>l.role==='original-footer-parser').every(l=>l.stdio_closed));
}));
test('history identity uses original stricter predicates in the same owned producer and never accepts an unprimed boolean',async t=>fixture(t,async f=>{
 for(const path of ['native-collection-history-proof.mjs','queued-comment-history.js','douyin-phone-adb'])if(!f.source.files.some(r=>r.path===path))f.source.files.push({path,sha256:sha(readFileSync(join(f.root,path)))});
 const p=await f.api.startNativeCollectionDependencies(f.options);t.after(()=>p.close());const profile=Buffer.from(f.profile),returned=Buffer.from(f.returned),meta={douyin_id:f.args.douyinId};
 assert.equal(typeof p.prepareHistoryIdentity,'function');assert.equal(p.verifyHistoryIdentity(profile,returned,meta),false);assert.equal(await p.prepareHistoryIdentity(profile,returned,meta),true);assert.equal(p.verifyHistoryIdentity(profile,returned,meta),true);assert.equal(f.api.readNativeCollectionDependencies(p,{source:f.source,scope:f.scope}).verifyHistoryIdentity(profile,returned,meta),true);
 const invalid=Buffer.from(f.returned.replace('text="1条评论"','text="评论 1.2万"').replace('com.ss.android.ugc.aweme:id/title','com.ss.android.ugc.aweme:id/ez-'));let error;try{await p.prepareHistoryIdentity(profile,invalid,meta);}catch(e){error=e;}assert.ok(error);assert.equal(f.api.nativeCollectionDependencyFailureReturned(error),true);assert.equal(p.verifyHistoryIdentity(profile,invalid,meta),false);const stop=await p.close();assert.equal(stop.execution_stopped,true);assert.ok(stop.local.leaves.filter(l=>l.role==='original-history-proof').every(l=>l.stdio_closed));
}));
