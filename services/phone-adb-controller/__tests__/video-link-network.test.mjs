import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
function run({firstFail=false,alwaysFail=false,downstreamTimeout=false,intermediateRedirect=false,externalRedirect=false,duplicateLocation=false,existingEvidence=false,peerReady=false,redirectUrl='https://www.douyin.com/video/7000000000000000001',rc=28,message='Resolving timed out after 10000 milliseconds'}={}){
 const source=controller.match(/resolve_content_short_url\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(source,'生产controller须区分DNS/网络错误并有界解析');
 const dir=mkdtempSync(join(tmpdir(),'link-network-')),curl=join(dir,'curl'),calls=join(dir,'calls');
 writeFileSync(curl,`#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
n=$(wc -l < "$CALLS")
if [ "$ALWAYS_FAIL" = 1 ] || { [ "$FIRST_FAIL" = 1 ] && [ "$n" -eq 1 ]; };then printf '%s\\n' "$ERROR_MESSAGE" >&2;exit "$ERROR_RC";fi
if [ "$DUPLICATE_LOCATION" = 1 ];then printf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.douyin.com/video/7000000000000000001\\r\\nLocation: https://www.douyin.com/video/7000000000000000002\\r\\n\\r\\n';exit 0;fi
if [ "$EXTERNAL_REDIRECT" = 1 ];then printf 'HTTP/1.1 302 Found\\r\\nLocation: https://example.com/video/7000000000000000001\\r\\n\\r\\n';exit 0;fi
if [ "$INTERMEDIATE_REDIRECT" = 1 ] && [ "$n" -eq 1 ];then printf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.iesdouyin.com/share/redirect/\\r\\n\\r\\n';exit 0;fi
printf 'HTTP/1.1 302 Found\\r\\nLocation: %s\\r\\n\\r\\n' "$REDIRECT_URL"
if [ "$DOWNSTREAM_TIMEOUT" = 1 ];then case "$*" in *-sSIL*) printf 'Resolving timed out after 5010 milliseconds\\n' >&2;exit 28;; esac;fi
`,{mode:0o755});
 if(existingEvidence)writeFileSync(join(dir,'fixture-resolve.json'),'immutable-original',{mode:0o600});
 if(peerReady){mkdirSync(join(dir,'runtime'));writeFileSync(join(dir,'run-definition.json'),'{}');writeFileSync(join(dir,'runtime/leadgen-client.mjs'),'');writeFileSync(join(dir,'node'),`#!/bin/sh
printf called > "$WFR_RUN_DIR/peer-called"
/bin/echo https://www.douyin.com/video/7000000000000000001
`,{mode:0o755});}
 const result=spawnSync('zsh',['-c',`set -eu; [[ -z "$TEST_PEER_BIN" ]] || export PATH="$TEST_PEER_BIN:$PATH"; die(){ print -u2 -- "$1";exit 2; }; wait_ms(){ :; }; ${source}; resolve_content_short_url https://v.douyin.com/test/ fixture`],{env:{...process.env,TEST_PEER_BIN:peerReady?dir:'',PATH:peerReady?dir+':'+process.env.PATH:process.env.PATH,WFR_RUN_DIR:peerReady?dir:'',DUPLICATE_LOCATION:duplicateLocation?'1':'0',PYTHON_BIN:'python3',REDIRECT_URL:redirectUrl,CURL:curl,EVIDENCE_ROOT:dir,CALLS:calls,FIRST_FAIL:firstFail?'1':'0',ALWAYS_FAIL:alwaysFail?'1':'0',DOWNSTREAM_TIMEOUT:downstreamTimeout?'1':'0',INTERMEDIATE_REDIRECT:intermediateRedirect?'1':'0',EXTERNAL_REDIRECT:externalRedirect?'1':'0',ERROR_RC:String(rc),ERROR_MESSAGE:message},encoding:'utf8'});
 return {...result,evidenceRoot:dir,peerCalled:existsSync(join(dir,'peer-called')),calls:readFileSync(calls,'utf8').trim().split('\n')};
}
test('DNS timeout两次后明确归因，不能变成缺video ID；总网络预算不增长',()=>{
 const r=run({alwaysFail:true});assert.equal(r.status,2);assert.match(r.stderr,/LINK_RESOLVE_DNS_TIMEOUT.*curl_rc=28/);assert.equal(r.calls.length,2);
 for(const args of r.calls){assert.match(args,/--max-time 10/);assert.match(args,/--connect-timeout 5/);}
});
test('瞬时DNS失败后第二次HEAD可恢复，保留真实成功redirect',()=>{const r=run({firstFail:true,rc:6,message:'Could not resolve host: v.douyin.com'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/video/7000000000000000001');assert.equal(r.calls.length,2);assert.match(r.stderr,/LINK_RESOLVE_DNS.*curl_rc=6/);});
test('第一轮解析成功不增加请求，连接失败归因不冒充DNS',()=>{assert.equal(run().calls.length,1);const r=run({alwaysFail:true,rc:7,message:'Failed to connect'});assert.match(r.stderr,/LINK_RESOLVE_CONNECT.*curl_rc=7/);assert.doesNotMatch(r.stderr,/LINK_RESOLVE_DNS/);});
test('current-video-link生产入口实际使用新解析器且保留COPY_STALE护栏',()=>{assert.match(controller,/resolved_url="\$\(resolve_content_short_url "\$short_url" "\$evidence_id"\)"/);assert.match(controller,/clip_guard_check "\$shared_url"/);});
test('真实首跳已有视频ID时不访问落地页，后续DNS失败不能丢掉已验证ID',()=>{
 const r=run({downstreamTimeout:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/video/7000000000000000001');assert.equal(r.calls.length,1);assert.doesNotMatch(r.calls[0],/-sSIL|--location/);
});
test('仅在首跳没有内容ID时追踪实际抖音中间跳转，仍只请求两次',()=>{
 const r=run({intermediateRedirect:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/video/7000000000000000001');assert.equal(r.calls.length,2);assert.match(r.calls[1],/https:\/\/www\.iesdouyin\.com\/share\/redirect\//);
});
test('站外跳转即使包含相似视频ID也不充当已验证抖音链接',()=>{const r=run({externalRedirect:true});assert.equal(r.status,2);assert.match(r.stderr,/LINK_RESOLVE_UNTRUSTED_REDIRECT/);assert.equal(r.calls.length,1);});

test('Android101真实iesdouyin分享跳转通过严格同视频指标并封存原redirect',()=>{
 const videoId='7699406826379298531',actual=`https://www.iesdouyin.com/share/video/${videoId}/?region=CN&from=copy`;
 const r=run({redirectUrl:actual});assert.equal(r.status,0,r.stderr);
 const {buildObservation}=require('../discovery-metrics.js');
 const scope={run:'real101',run_id:'douyin_video_discovery-real101__a1',profile:'legacy',source_commit:'a'.repeat(40),line_key:'jinuo',video_id:videoId,video_url:r.stdout.trim(),observed_at:'2026-10-23T04:54:51.365Z',evidence_id:'real101-candidate1-link-t1',xml:'<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢183，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论8，按钮"/></hierarchy>'};
 const metrics=buildObservation(scope);
 assert.equal(metrics.likes.value,183);assert.equal(metrics.comment_total.value,8);
 assert.equal(scope.video_url,`https://www.douyin.com/video/${videoId}`);
 const original=JSON.parse(readFileSync(join(r.evidenceRoot,'fixture-resolve.json'),'utf8'));
 assert.equal(original.redirect_url,actual);assert.equal(original.canonical_url,scope.video_url);assert.equal(original.content_id,videoId);
 assert.equal(original.http_status,302);assert.equal(r.calls.length,1);assert.equal(statSync(join(r.evidenceRoot,'fixture-resolve.json')).mode&0o777,0o600);
});

const invalidRedirects=[
 'http://www.douyin.com/video/7000000000000000001',
 'https://user@www.douyin.com/video/7000000000000000001',
 'https://www.douyin.com:444/video/7000000000000000001',
 'https://www.douyin.com.evil.com/video/7000000000000000001',
 'https://evil-douyin.com/video/7000000000000000001',
 'https://fake.douyin.com/video/7000000000000000001',
 'https://www.douyin.com/video/7000000000000000001/evil',
 'https://www.douyin.com/video/7000000000000000001x',
 'https://www.douyin.com/video/123456789012345',
 'https://www.douyin.com/video/1234567890123456789012345',
 'https://www.douyin.com/video/7000000000000000001/note/7000000000000000002',
 'https://www.douyin.com/redirect?url=/video/7000000000000000001'
];
for(const redirectUrl of invalidRedirects)test('实际HEAD拒绝非受信/歧义内容路径且不借RPC放行 '+redirectUrl,()=>{
 const r=run({redirectUrl,peerReady:true});assert.notEqual(r.status,0);assert.equal(r.peerCalled,false);assert.ok(r.calls.length<=2);
 assert.equal(existsSync(join(r.evidenceRoot,'fixture-resolve.json')),false);
});
test('query/fragment中的其他ID不改变pathname内容身份，note保持note',()=>{
 const r=run({redirectUrl:'https://www.iesdouyin.com/share/note/7000000000000000001/?next=/video/7000000000000000002#video/7000000000000000003'});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/note/7000000000000000001');
 assert.equal(JSON.parse(readFileSync(join(r.evidenceRoot,'fixture-resolve.json'))).content_type,'note');
});
test('两个Location头拒绝歧义且不走RPC，原redirect证据不可覆盖',()=>{
 const ambiguous=run({duplicateLocation:true,peerReady:true});assert.notEqual(ambiguous.status,0);assert.match(ambiguous.stderr,/AMBIGUOUS_REDIRECT/);assert.equal(ambiguous.peerCalled,false);
 const existing=run({existingEvidence:true});assert.notEqual(existing.status,0);assert.equal(readFileSync(join(existing.evidenceRoot,'fixture-resolve.json'),'utf8'),'immutable-original');
});
test('本地合法HEAD不调用RPC；仅原两次网络失败才进已有冻结peer兜底',()=>{
 assert.equal(run({peerReady:true}).peerCalled,false);
 const r=run({peerReady:true,alwaysFail:true});assert.equal(r.status,0,r.stderr);assert.equal(r.peerCalled,true);assert.equal(r.calls.length,2);
});
