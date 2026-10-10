import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
function run({firstFail=false,alwaysFail=false,downstreamTimeout=false,intermediateRedirect=false,externalRedirect=false,rc=28,message='Resolving timed out after 10000 milliseconds'}={}){
 const source=controller.match(/resolve_content_short_url\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(source,'生产controller须区分DNS/网络错误并有界解析');
 const dir=mkdtempSync(join(tmpdir(),'link-network-')),curl=join(dir,'curl'),calls=join(dir,'calls');
 writeFileSync(curl,`#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
n=$(wc -l < "$CALLS")
if [ "$ALWAYS_FAIL" = 1 ] || { [ "$FIRST_FAIL" = 1 ] && [ "$n" -eq 1 ]; };then printf '%s\\n' "$ERROR_MESSAGE" >&2;exit "$ERROR_RC";fi
if [ "$EXTERNAL_REDIRECT" = 1 ];then printf 'HTTP/1.1 302 Found\\r\\nLocation: https://example.com/video/7000000000000000001\\r\\n\\r\\n';exit 0;fi
if [ "$INTERMEDIATE_REDIRECT" = 1 ] && [ "$n" -eq 1 ];then printf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.iesdouyin.com/share/redirect/\\r\\n\\r\\n';exit 0;fi
printf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.douyin.com/video/7000000000000000001\\r\\n\\r\\n'
if [ "$DOWNSTREAM_TIMEOUT" = 1 ];then case "$*" in *-sSIL*) printf 'Resolving timed out after 5010 milliseconds\\n' >&2;exit 28;; esac;fi
`,{mode:0o755});
 const result=spawnSync('zsh',['-c',`set -eu; die(){ print -u2 -- "$1";exit 2; }; wait_ms(){ :; }; ${source}; resolve_content_short_url https://v.douyin.com/test/ fixture`],{env:{...process.env,CURL:curl,EVIDENCE_ROOT:dir,CALLS:calls,FIRST_FAIL:firstFail?'1':'0',ALWAYS_FAIL:alwaysFail?'1':'0',DOWNSTREAM_TIMEOUT:downstreamTimeout?'1':'0',INTERMEDIATE_REDIRECT:intermediateRedirect?'1':'0',EXTERNAL_REDIRECT:externalRedirect?'1':'0',ERROR_RC:String(rc),ERROR_MESSAGE:message},encoding:'utf8'});
 return {...result,calls:readFileSync(calls,'utf8').trim().split('\n')};
}
test('DNS timeout两次后明确归因，不能变成缺video ID；总网络预算不增长',()=>{
 const r=run({alwaysFail:true});assert.equal(r.status,2);assert.match(r.stderr,/LINK_RESOLVE_DNS_TIMEOUT.*curl_rc=28/);assert.equal(r.calls.length,2);
 for(const args of r.calls){assert.match(args,/--max-time 10/);assert.match(args,/--connect-timeout 5/);}
});
test('瞬时DNS失败后第二次HEAD可恢复，保留真实成功redirect',()=>{const r=run({firstFail:true,rc:6,message:'Could not resolve host: v.douyin.com'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/video/7000000000000000001');assert.equal(r.calls.length,2);assert.match(r.stderr,/LINK_RESOLVE_DNS.*curl_rc=6/);});
test('第一轮解析成功不增加请求，连接失败归因不冒充DNS',()=>{assert.equal(run().calls.length,1);const r=run({alwaysFail:true,rc:7,message:'Failed to connect'});assert.match(r.stderr,/LINK_RESOLVE_CONNECT.*curl_rc=7/);assert.doesNotMatch(r.stderr,/LINK_RESOLVE_DNS/);});
test('current-video-link生产入口实际使用新解析器且保留COPY_STALE护栏',()=>{assert.match(controller,/resolved_url="\$\(resolve_content_short_url "\$short_url" "\$evidence_id"\)"/);assert.match(controller,/clip_guard_check "\$short_url"/);});
test('真实首跳已有视频ID时不访问落地页，后续DNS失败不能丢掉已验证ID',()=>{
 const r=run({downstreamTimeout:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/video/7000000000000000001');assert.equal(r.calls.length,1);assert.doesNotMatch(r.calls[0],/-sSIL|--location/);
});
test('仅在首跳没有内容ID时追踪实际抖音中间跳转，仍只请求两次',()=>{
 const r=run({intermediateRedirect:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'https://www.douyin.com/video/7000000000000000001');assert.equal(r.calls.length,2);assert.match(r.calls[1],/https:\/\/www\.iesdouyin\.com\/share\/redirect\//);
});
test('站外跳转即使包含相似视频ID也不充当已验证抖音链接',()=>{const r=run({externalRedirect:true});assert.equal(r.status,2);assert.match(r.stderr,/LINK_RESOLVE_UNTRUSTED_REDIRECT/);assert.equal(r.calls.length,1);});
