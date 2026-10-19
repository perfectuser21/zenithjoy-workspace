import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('真实Android command smoke保留Gradle完整失败原因及原非零退出码',()=>{
 const source=readFileSync(new URL('../smoke/agent-cmd-executor-smoke.sh',import.meta.url),'utf8');
 const line=source.split('\n').find(v=>v.startsWith('./gradlew '));
 assert.ok(line,'必须执行真实Gradle入口');
 const root=mkdtempSync(join(tmpdir(),'android-smoke-diagnostics-'));
 try{
  writeFileSync(join(root,'gradlew'),'#!/bin/sh\nprintf "ROOT_CAUSE: dependency resolution witness\\n"\nfor n in 1 2 3 4 5 6 7 8; do echo "diagnostic $n"; done\nexit 7\n',{mode:0o755});
  const result=spawnSync('/bin/bash',['-c','set -euo pipefail\n'+line],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,7,'构建失败不能变成通过');
  assert.ok(result.stdout.includes('ROOT_CAUSE: dependency resolution witness'),'不能把根因截掉只剩最后五行');
  for(let n=1;n<=8;n++)assert.ok(result.stdout.includes('diagnostic '+n),'原输出必须完整');
 }finally{rmSync(root,{recursive:true,force:true});}
});
