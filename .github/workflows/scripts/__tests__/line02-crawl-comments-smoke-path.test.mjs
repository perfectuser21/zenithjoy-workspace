import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const source=resolve('.github/workflows/scripts/smoke/line02-crawl-comments-smoke.sh');
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'crawl-smoke-path-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const scripts=join(root,'.github/workflows/scripts/smoke');
  const publishers=join(root,'services/agent/publishers');
  const profile=join(root,'profile'),bin=join(root,'bin'),trace=join(root,'trace');
  for(const dir of [scripts,publishers,profile,bin])mkdirSync(dir,{recursive:true});
  copyFileSync(source,join(scripts,'line02-crawl-comments-smoke.sh'));
  // Both child executables are local inert fixtures. They cannot contact a service.
  writeFileSync(join(publishers,'keyword-search-douyin.cjs'),`
    require('fs').appendFileSync(process.env.TRACE,'keyword\\n');
    console.log(JSON.stringify({video_urls:['fixture://video']}));
    process.exit(process.env.FAIL_STAGE==='keyword'?3:0);
  `);
  writeFileSync(join(publishers,'crawl-comments-douyin.cjs'),`
    require('fs').appendFileSync(process.env.TRACE,'crawl\\n');
    if(process.argv[2]!=='fixture://video')process.exit(9);
    console.log(JSON.stringify({ok:true,commenters:[{nickname:'fixture',comment_text:'fixture'}]}));
    process.exit(process.env.FAIL_STAGE==='crawl'?4:0);
  `);
  writeFileSync(join(bin,'timeout'),'#!/bin/sh\nshift\nexec "$@"\n',{mode:0o755});
  const run=(extra={})=>{
    const env={...process.env,PATH:bin+':'+process.env.PATH,NODE_EXE:process.execPath,ZJ_MAIN_DATA_DIR:profile,TRACE:trace,...extra};
    if(!Object.hasOwn(extra,'PUBLISHERS_DIR'))delete env.PUBLISHERS_DIR;
    return spawnSync('bash',[join(scripts,'line02-crawl-comments-smoke.sh')],{cwd:root,env,encoding:'utf8',timeout:10000});
  };
  return {root,profile,trace,run};
}
test('默认发布器路径指向仓库根下的现有实现并按顺序执行两个隔离子进程',t=>{
  const f=fixture(t),r=f.run();
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.deepEqual(readFileSync(f.trace,'utf8').trim().split('\n'),['keyword','crawl']);
  assert.match(r.stdout,/smoke PASS/);
});
test('显式 PUBLISHERS_DIR 仍可覆盖默认路径',t=>{
  const f=fixture(t),other=join(f.root,'alternate');
  cpSync(join(f.root,'services/agent/publishers'),other,{recursive:true});
  rmSync(join(f.root,'services/agent/publishers'),{recursive:true});
  const r=f.run({PUBLISHERS_DIR:other});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.deepEqual(readFileSync(f.trace,'utf8').trim().split('\n'),['keyword','crawl']);
});
test('缺少登录目录变量仍失败，且不启动任何子进程',t=>{
  const f=fixture(t),r=f.run({ZJ_MAIN_DATA_DIR:''});
  assert.notEqual(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/ZJ_MAIN_DATA_DIR 未设置/);
  assert.equal(existsSync(f.trace),false);
});
for(const stage of ['keyword','crawl']) test(stage+' 子进程输出看似成功但返回非零仍失败',t=>{
  const f=fixture(t),r=f.run({FAIL_STAGE:stage});
  assert.notEqual(r.status,0,r.stdout+r.stderr);
  assert.doesNotMatch(r.stdout,/smoke PASS/);
  assert.deepEqual(readFileSync(f.trace,'utf8').trim().split('\n'),stage==='keyword'?['keyword']:['keyword','crawl']);
});
