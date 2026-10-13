import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const message='明示fake批准正文';
const node=(value,input=false)=>`<node text="${value}" resource-id="${input?'com.ss.android.ugc.aweme:id/msg_et':'fake_bubble'}" class="${input?'android.widget.EditText':'android.widget.TextView'}"/>`;
function check(before,after,phase){const dir=mkdtempSync(join(tmpdir(),'fake-dm-delta-'));try{
 const fn=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8').match(/^_verify_private_message_delta\(\) \{[\s\S]*?^\}/m)?.[0];
 assert.ok(fn,'必须核验发送前后新气泡，旧grep不足以判定本轮成功');
 writeFileSync(join(dir,'before.xml'),'<hierarchy>'+before+'</hierarchy>');writeFileSync(join(dir,'after.xml'),'<hierarchy>'+after+'</hierarchy>');
 return spawnSync('zsh',['-c',`PYTHON_BIN=python3\n${fn}\n_verify_private_message_delta "$1" "$2" "$3" "$4"`,'fake',join(dir,'before.xml'),join(dir,'after.xml'),message,phase],{encoding:'utf8',timeout:5000});
 }finally{rmSync(dir,{recursive:true,force:true});}}
test('输入框同文不是旧消息；旧历史气泡在Send前必须拒绝',()=>{
 assert.equal(check(node(message,true),'','before').status,0);
 assert.notEqual(check(node(message,true)+node(message),'','before').status,0);
});
test('发送成功须新非输入气泡且输入已清空；未清空与旧气泡假成功被拒绝',()=>{
 assert.equal(check(node(message,true),node('',true)+node(message),'after').stdout.trim(),'sent');
 assert.notEqual(check(node(message,true),node(message,true),'after').status,0);
 assert.notEqual(check(node(message,true)+node(message),node('',true)+node(message),'after').status,0);
});
test('新互关/限流提示如实归类，不声称送达',()=>{
 assert.equal(check(node(message,true),node('',true)+node('暂无法给对方发送消息'),'after').stdout.trim(),'restricted');
 assert.equal(check(node(message,true),node('',true)+node('给陌生人发送消息过于频繁'),'after').stdout.trim(),'rate_limited');
});
test('二次fresh风险XML能覆盖延迟互关提示，读不到不能把首帧气泡当最终发送',()=>{
 assert.equal(check(node(message,true),node('',true)+node(message),'risk').stdout.trim(),'sent');
 assert.equal(check(node(message,true),node('',true)+node(message)+node('暂无法给对方发送消息'),'risk').stdout.trim(),'restricted');
 assert.notEqual(check(node(message,true),'','risk').status,0);
});
