import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('mirror.mjs',import.meta.url),'utf8');
function render(snapshot){
 const match=source.match(/const paragraph=([^;]+);/);
 assert.ok(match,'镜子必须保留可核对的实际调度说明');
 return new Function('snapshot','recent','label','return '+match[1])(snapshot,true,()=> '核验时间');
}
test('设备正文显示实际22点计划与中央执行器，避免旧09点说明',()=>{
 const body=render({schedule_status:'active',schedule:'每天22:00（Asia/Shanghai）'});
 assert.match(body,/22:00/);
 assert.doesNotMatch(body,/09:00/);
 assert.match(body,/主理人/);
 assert.match(body,/中央Brain/);
});
test('暂停状态仍保留已登记的计划时间与历史身份提示',()=>{
 const body=render({schedule_status:'paused',schedule:'每天22:00（Asia/Shanghai）'});
 assert.match(body,/暂停/);
 assert.match(body,/22:00/);
 assert.match(body,/不代表仍在登录/);
});
