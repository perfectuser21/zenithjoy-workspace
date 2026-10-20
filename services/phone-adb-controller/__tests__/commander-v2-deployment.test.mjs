import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {fixture,start,copyCommanderFixture} from './fixtures/commander-runtime.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
test('部署准入拒绝业务已停但cleanup_pending且无delivery的包',()=>{
 const f=fixture(),dir=start(f);writeFileSync(join(dir,'runtime.json'),JSON.stringify({phase:'cleanup_pending',execution_stopped:true}));
 const guard=resolve('services/phone-adb-controller/deployment-guard.py'),forbidden=join(f.home,'installation-forbidden');
 writeFileSync(join(dir,'.worker.lock'),'');
 const script=`import runpy
from pathlib import Path
g=runpy.run_path(${JSON.stringify(guard)})
def no_authority(path):raise AssertionError('pending cleanup cannot query failure authority')
with g['commander_admission'](Path.home(),no_authority):Path(${JSON.stringify(forbidden)}).touch()
`;
 writeFileSync(join(f.home,'pgrep'),'#!/bin/sh\nexit 1\n',{mode:0o755});f.env.PATH=f.home+':'+process.env.PATH;
 const result=spawnSync('python3',['-c',script],{env:f.env,encoding:'utf8'});assert.notEqual(result.status,0,'cleanup pending deployment was admitted');assert.match(result.stderr,/FileNotFoundError:.*cleanup\.json/,'must execute the real consumer and reject the absent pending-cleanup proof');assert.equal(existsSync(forbidden),false,'zero installation after rejected admission');assert.equal(existsSync(join(f.home,'.openclaw/commander/.deploying')),false);
});
test('同一release ready按workflow固定摘要握手，多workflow未知或串用摘要均拒绝',()=>{
 const f=fixture();const workflows=Object.fromEntries(['workflow.meta','workflow_report.internal','douyin_video_publish.android'].map((key,i)=>[key,{snapshot_sha256:String(i+1).repeat(64)}]));
 const seal=releases=>{const result=spawnSync('python3',[join(f.dir,'wf-v2-io.py'),'manifest',f.dir,JSON.stringify(releases)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(readFileSync(join(f.dir,'runtime-manifest.json')));};
 const manifest=seal({'release-test':{workflows}});
 const ready=(key,snapshot,definition={})=>f.call('wf-launch.sh',['--ready'],{workflow_key:key,definition:{...f.definition,snapshot_sha256:snapshot,runtime_snapshot_sha256:manifest.runtime_snapshot_sha256,...definition}});
 for(const [key,value] of Object.entries(workflows)){
  const result=ready(key,value.snapshot_sha256);assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{protocol:'commander-v2',ready:true,release_id:'release-test',snapshot_sha256:value.snapshot_sha256,runtime_snapshot_sha256:manifest.runtime_snapshot_sha256});
 }
 for(const [key,snapshot,definition] of [['missing.workflow','1'.repeat(64),{}],['workflow.meta','2'.repeat(64),{}],['workflow.meta','1'.repeat(64),{release_id:'missing-release'}],['workflow.meta','1'.repeat(64),{runtime_snapshot_sha256:'f'.repeat(64)}]])assert.notEqual(ready(key,snapshot,definition).status,0);
 for(const invalid of [null,[],{'workflow.meta':{}},{'workflow.meta':{snapshot_sha256:null}},{'workflow.meta':{snapshot_sha256:'invalid'}}]){
  // 显式新shape损坏时不得退回旁边碰巧匹配的旧字段。
  seal({'release-test':{workflows:invalid,workflow_key:'workflow.meta',snapshot_sha256:'1'.repeat(64)}});
  assert.notEqual(ready('workflow.meta','1'.repeat(64)).status,0);
  assert.notEqual(ready('workflow.meta','invalid').status,0);
 }
 seal({'release-test':{workflows}});writeFileSync(join(f.dir,'wf-agent-lib.py'),'# component changed');assert.notEqual(ready('workflow.meta','1'.repeat(64)).status,0);
 assert.equal(existsSync(join(f.home,'wf-agent-runs')),false,'ready must not start any run');
});

test('Commander fixture仅复制已发布文件，不带Skill安装器的原子临时文件',t=>{
 const root=mkdtempSync(join(tmpdir(),'commander-copy-stage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const src=join(root,'source'),dest=join(root,'dest'),skill=join(src,'skills/wf-test');mkdirSync(skill,{recursive:true});
 writeFileSync(join(skill,'SKILL.md'),'published-skill');writeFileSync(join(skill,'.skill-stage'),'unpublished');writeFileSync(join(src,'wf-v2.py'),'runtime');
 copyCommanderFixture(src,dest);
 assert.equal(existsSync(join(dest,'skills/wf-test/.skill-stage')),false,'unpublished installer staging file entered the runtime fixture');
 assert.equal(readFileSync(join(dest,'skills/wf-test/SKILL.md'),'utf8'),'published-skill');assert.equal(readFileSync(join(dest,'wf-v2.py'),'utf8'),'runtime');
 assert.throws(()=>copyCommanderFixture(join(root,'missing'),join(root,'must-not-exist')),/ENOENT/);
});

test('Commander fixture枚举Skill暂存后文件消失，不吞正式文件的读取失败',t=>{
 const root=mkdtempSync(join(tmpdir(),'commander-copy-disappearing-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const src=join(root,'source'),dest=join(root,'dest'),skill=join(src,'skills/wf-test');mkdirSync(skill,{recursive:true});
 const staging=join(skill,'.skill-disappearing');writeFileSync(staging,'temporary');writeFileSync(join(skill,'SKILL.md'),'published');
 const original=fs.cpSync;let removed=false;
 t.mock.method(fs,'cpSync',(from,to,options)=>original(from,to,{...options,filter:(path,target)=>{
  if(path===staging){fs.unlinkSync(path);removed=true;}
  return options.filter?options.filter(path,target):true;
 }}));syncBuiltinESMExports();
 try{copyCommanderFixture(src,dest);}finally{t.mock.restoreAll();syncBuiltinESMExports();}
 assert.equal(removed,true,'the test must observe removal after enumeration');assert.equal(readFileSync(join(dest,'skills/wf-test/SKILL.md'),'utf8'),'published');
});
