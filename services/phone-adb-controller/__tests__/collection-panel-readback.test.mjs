// 原完整controller+真实进程；仅ADB/手机UI树为隔离边界，不改controller/函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {verifiedCollectionPanelFailure} from '../collection-acceptance-probe.mjs';
const eid='current-run-v7681632828384394203-collection-screen1';
const controller=new URL('../douyin-phone-adb',import.meta.url).pathname;
async function fixture(t){
 const d=realpathSync(mkdtempSync(join(tmpdir(),'actual-collection-panel-')));t.after(()=>rmSync(d,{recursive:true,force:true}));
 const sockets=new Set(),server=createServer(c=>{sockets.add(c);c.on('error',()=>{});c.on('close',()=>sockets.delete(c));let b='';c.on('data',v=>{b+=v;if(b.length<4||b.length<4+parseInt(b.slice(0,4),16))return;const q=b.slice(4),value=q==='host:version'?'0029':q==='host:devices'?'FIXTURE-PHONE\tdevice\n':null;if(value===null)return c.end('FAIL0003bad');c.end('OKAY'+Buffer.byteLength(value).toString(16).padStart(4,'0')+value);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();server.close();});
 const source=join(d,'adb.c'),adb=join(d,'adb');
 writeFileSync(source,`#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\nint main(int n,char**a){if(n==2&&!strcmp(a[1],"version")){puts("Android Debug Bridge version 1.0.41");return 0;}if(!strcmp(a[n-1],"get-state")){puts("device");return 0;}if(!strcmp(a[n-1],"ro.product.model")){puts("MODEL");return 0;}if(n>4&&!strcmp(a[n-4],"stat")){puts("999");return 0;}for(int i=1;i<n;i++)if(!strcmp(a[i],"pull")){char p[4096];snprintf(p,sizeof p,"%s/tree.xml",getenv("PANEL_FIXTURE_DIR"));FILE*in=fopen(p,"rb"),*out=fopen(a[n-1],"wb");if(!in||!out)return 4;int c;while((c=fgetc(in))!=EOF)fputc(c,out);fclose(in);fclose(out);return 0;}for(int i=1;i<n;i++)if(!strcmp(a[i],"size")){puts("Physical size: 1200x2664");return 0;}return 0;}\n`);
 const cc=spawnSync('cc',[source,'-o',adb],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 const reg=join(d,'profiles');writeFileSync(reg,'p\tFIXTURE-PHONE\tMODEL\t1199\t2663\n');
 const env={...process.env,HOME:d,PANEL_FIXTURE_DIR:d,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_ADB_BIN:adb,DOUYIN_PYTHON_BIN:'python3',DOUYIN_PHONE_TMP_ROOT:join(d,'phone'),DOUYIN_PHONE_LOCK_TEST_MODE:'1',ADB_SERVER_SOCKET:'tcp:127.0.0.1:'+server.address().port};
 const run=()=>new Promise(resolve=>{const p=spawn('zsh',[controller,'--profile','p','collect-comments',eid],{env});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',status=>resolve({status,stdout,stderr}));});
 return {d,run};
}
test('真实collect-comments读新XML确认面板关闭时给精确语义及原件hash，不泛化设备失败',async t=>{
 const f=await fixture(t),xml='<hierarchy><node text="首页" package="com.ss.android.ugc.aweme" /></hierarchy>';writeFileSync(join(f.d,'tree.xml'),xml);
 const r=await f.run();assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/COLLECTION_COMMENT_PANEL_READBACK_FAILED/);const path=join(f.d,'phone/evidence/p/'+eid+'-comments.xml');assert.equal(readFileSync(path,'utf8'),xml);assert.match(r.stderr,new RegExp('xml_sha256='+createHash('sha256').update(xml).digest('hex')));
});
test('真实collect-comments面板仍开不会因验收期待而伪造关闭失败',async t=>{
 const f=await fixture(t);writeFileSync(join(f.d,'tree.xml'),'<hierarchy><node text="暂无评论" package="com.ss.android.ugc.aweme" /></hierarchy>');
 const r=await f.run();assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stderr,/COLLECTION_COMMENT_PANEL_READBACK_FAILED/);assert.match(r.stdout,/evidence=.*collection-screen1-comments.xml/);
});

test('精确closed语义拒旧run同VID/旧op/hash漂移/仅marker，接受本次原controller证据',async t=>{
 const f=await fixture(t);writeFileSync(join(f.d,'tree.xml'),'<hierarchy><node text="首页" package="com.ss.android.ugc.aweme" /></hierarchy>');const startedAt=Date.now(),r=await f.run();
 const context={evidenceRoot:join(f.d,'phone/evidence/p'),videoId:'7681632828384394203',owner:'current-run',attempt:'a1',startedAt};
 assert.equal(verifiedCollectionPanelFailure({...r,code:r.status},context),true);
 for(const changed of [{...context,owner:'old-run'},{...context,startedAt:Date.now()+1000},{...context,attempt:''}])assert.equal(verifiedCollectionPanelFailure({...r,code:r.status},changed),false);
 assert.equal(verifiedCollectionPanelFailure({...r,code:r.status,stderr:r.stderr.replace('comment panel is not open; run open-comments first','')},context),false);
 const archived=Buffer.from(r.stderr.match(/xml_path_b64=([A-Za-z0-9+/=]+)/)[1],'base64').toString();writeFileSync(archived,'changed');assert.equal(verifiedCollectionPanelFailure({...r,code:r.status},context),false);
});
