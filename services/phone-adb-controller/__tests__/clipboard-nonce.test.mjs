import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
function run({copyFail=false,clearFail=false,leaveFail=false,inputFail=false,noProof=false}={}){
 const seed=controller.match(/seed_clipboard_nonce\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(seed,'必须实际验证nonce已写入clipboard');
 const guard=controller.match(/clip_guard_check\(\) \{[\s\S]*?\n\}/)[0];
 const dir=mkdtempSync(join(tmpdir(),'clipnonce-')),adb=join(dir,'adb');writeFileSync(join(dir,'last'),'https://v.douyin.com/Same/');writeFileSync(join(dir,'clip'),'https://v.douyin.com/Same/');writeFileSync(join(dir,'field'),'');
 writeFileSync(adb,`#!/bin/sh
case "$*" in
 *'input text '*) if [ "$INPUT_FAIL" != 1 ];then printf '%s' "$(printf '%s' "$*" | sed 's/.*input text //')" > "$D/field";fi;;
 *'keyevent 278'*) if [ "$COPY_FAIL" != 1 ];then cp "$D/field" "$D/clip";fi;;
 *'keyevent 67'*) if [ "$CLEAR_FAIL" != 1 ];then : > "$D/field";fi;;
 *'keyevent 279'*) cp "$D/clip" "$D/field";;
 esac
`,{mode:0o755});
 const script=`set -eu;setopt EXTENDED_GLOB;die(){ print -u2 -- "$1";exit 2; };wait_ms(){ :; };node_center(){print '100 100';};clip_state_file(){print "$D/last";};ui_evidence(){local value="$(cat "$D/field")";printf '<hierarchy><node text="%s" resource-id="com.ss.android.ugc.aweme:id/et_search_kw" clickable="true" bounds="[0,0][200,200]" /></hierarchy>' "$value" > "$EVIDENCE_ROOT/$1.xml";};_leave_scratch_route(){ [[ "$LEAVE_FAIL" != 1 ]];};${seed};${guard};proof="";${noProof?'':'proof="$(seed_clipboard_nonce fixture)" || exit 2;'} clip_guard_check https://v.douyin.com/Same/ "$proof";print OK`;
 return spawnSync('zsh',['-c',script],{env:{...process.env,D:dir,EVIDENCE_ROOT:dir,ADB:adb,SERIAL:'FAKE',PYTHON_BIN:'/usr/bin/python3',COPY_FAIL:copyFail?'1':'0',CLEAR_FAIL:clearFail?'1':'0',LEAVE_FAIL:leaveFail?'1':'0',INPUT_FAIL:inputFail?'1':'0'},encoding:'utf8'});
}
test('输入/清空/paste三次真实UI读回nonce且成功退回详情后，同URL合法重拷',()=>{const r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/OK/);});
for(const [name,options] of Object.entries({复制未生效:{copyFail:true},清空未生效:{clearFail:true},输入未生效:{inputFail:true},返回原详情失败:{leaveFail:true}}))test(name+'拒绝本次且不借expectedID放行',()=>{const r=run(options);assert.notEqual(r.status,0);assert.match(r.stderr,/CLIPBOARD_NONCE/);assert.doesNotMatch(r.stdout,/OK/);});
test('无本次nonce证明仍COPY_STALE；调用不能借旧cache跳过',()=>{const r=run({noProof:true});assert.notEqual(r.status,0);assert.match(r.stderr,/COPY_STALE/);});

test('真实入口nonce证明只在本次_once局部生效，先seed再copy，nonce残留不得当短链',()=>{
 const once=controller.slice(controller.indexOf('_current_video_link_once() {'),controller.indexOf('_current_video_link_once() {')+19000);
 assert.match(once,/nonce_proof=""/);assert.match(once,/nonce_proof="\$\(seed_clipboard_nonce "\$evidence_id"\)" \|\| die/);
 assert.ok(once.indexOf('seed_clipboard_nonce')<once.indexOf('share_xml='));
 assert.ok(once.indexOf('copied text did not contain a verified Douyin short link')<once.indexOf('clip_guard_check "$short_url" "$nonce_proof"'));
 assert.doesNotMatch(controller.match(/seed_clipboard_nonce\(\) \{[\s\S]*?\n\}/)[0],/clip_guard_record|last-clip.*rm|reopen_url/);
});
