import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const path='.github/workflows/scripts/smoke/commander-codex-agent-smoke.sh';
function run(fail){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'commander-bootstrap-')));
 try{
  mkdirSync(join(dir,'.github/workflows/scripts/smoke'),{recursive:true});mkdirSync(join(dir,'scripts'),{recursive:true});mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,path),readFileSync(new URL('../../../'+path,import.meta.url)));
  writeFileSync(join(dir,'scripts/ensure-skills-source.sh'),'printf "bootstrap:%s\\n" "$1" >> "$TRACE"\nexit "${BOOTSTRAP_EXIT:-0}"\n');
  for(const name of ['node','python3'])writeFileSync(join(dir,'bin',name),'#!/bin/sh\nprintf "'+name+':%s\\n" "$*" >> "$TRACE"\n',{mode:0o755});
  writeFileSync(join(dir,'bin/bash'),'#!/bin/sh\n[ \"$1\" = -n ] && exit 0\nexec /bin/bash \"$@\"\n',{mode:0o755});
  const trace=join(dir,'trace');const r=spawnSync('/bin/bash',[path],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,TRACE:trace,BOOTSTRAP_EXIT:String(fail)},timeout:10000});
  const lines=readFileSync(trace,'utf8').trim().split('\n');return {r,lines,dir};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('Commander回归先执行固定Skill安装核验，再保留完整原测试链',()=>{
 const {r,lines,dir}=run(0);assert.equal(r.status,0,r.stderr);assert.equal(lines[0],'bootstrap:'+dir);
 assert.ok(lines.some(x=>x.includes('commander-skill-contracts.test.js')));assert.ok(lines.some(x=>x.includes('commander-v2.test.mjs')));assert.ok(lines.some(x=>x.includes('deployment-prepare.test.mjs')));
});
test('固定Skill安装核验失败立即拒绝，不能继续测试或报PASS',()=>{
 const {r,lines}=run(23);assert.equal(r.status,23);assert.equal(lines.length,1);assert.ok(!r.stdout.includes('commander-codex-agent-smoke: PASS'));
});
