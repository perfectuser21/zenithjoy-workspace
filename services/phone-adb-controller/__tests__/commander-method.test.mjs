import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('历史方法实际目录/双gate/解析执行与错误边界（明确隔离fixture，无生产写入）',()=>{
 const result=spawnSync('python3',[new URL('./commander-method.test.py',import.meta.url).pathname],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
