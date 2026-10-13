import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../smoke/structured-workbench-smoke.sh',import.meta.url),'utf8');
const failFunction=source.match(/^fail\(\) \{[^\n]+\}$/m)?.[0];
assert.ok(failFunction,'必须执行实际fail函数');

test('fixture_up stdout静默时实际fail仍将失败原因交给CI stderr',()=>{
 const result=spawnSync('bash',['-c',`${failFunction}\nfixture_up(){ fail 'known startup failure'; }\nfixture_up >/dev/null`],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/FAIL: known startup failure/);
});
test('真实start_api未就绪错误保留实际启动日志且exit1，健康条件不伪造成功',()=>{
 const directory=mkdtempSync(join(tmpdir(),'wb-startup-diagnostic-'));
 try {
  const start=source.indexOf('start_api() {'),end=source.indexOf('\nlogin_cookie()',start);
  assert.ok(start>=0&&end>start);
  // 仅隔离依赖：curl永远不就绪，node模拟已退出API进程；执行真实start_api/fail。
  const script=`${failFunction}\n${source.slice(start,end)}\n`+
   `curl(){ return 1; }\nnode(){ printf '%s\\n' 'fixture startup cause: database unavailable' >&2; }\n`+
   `kill(){ wait "$API_PID"; return 1; }\nfixture_up(){ start_api 5620 "$1"; }\nfixture_up "$1" >/dev/null`;
  const result=spawnSync('bash',['-c',script,'fixture',join(directory,'api.log')],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/fixture startup cause: database unavailable/);assert.match(result.stderr,/FAIL: apps\/api 未在 40s 内就绪/);assert.match(result.stderr,/5620/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
