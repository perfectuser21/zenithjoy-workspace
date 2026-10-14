import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo='perfectuser21/zenithjoy-workspace';
const root=new URL('../../../../',import.meta.url);
const files=['single','batch','maintenance'];
for(const name of files)test(`正式${name}定义完整绑定真实固定字节及精确入口`,()=>{
 const d=JSON.parse(readFileSync(new URL(`${name}.json`,import.meta.url)));
 assert.equal(d.source,undefined,'源文件不得自引用commit');
 assert.equal(d.capability_id,'2173a385-a743-41f3-bb7d-d0e4b1d51d4e');
 assert.ok(d.activities.length>0);
 assert.equal(d.runtime.script.host,'mmv');
 assert.equal(d.runtime.script.cwd,null);
 assert.deepEqual(d.runtime.script.env,{});
 assert.ok(d.runtime.script.commands.length>0);
 for(const command of d.runtime.script.commands){
   assert.ok(command.startsWith('/usr/bin/python3 /Users/administrator/.local/share/'));
   assert.ok(command.endsWith('--execution-script "$0"'));
   assert.ok(!command.includes('<serial>'));
 }
 const sources=new Set();
 for(const a of d.activities){
   assert.equal(a.executor_kind,'code');assert.ok(a.acceptance.length>0);assert.ok(a.steps.length>0);
   for(const obj of [a,...a.steps]){
     if(obj!==a)assert.ok(obj.dod.readback.type);
     const bindings=[obj.implementation,...(obj.implementation_bindings||[])].filter(Boolean);
     assert.ok(bindings.length>0);
     for(const b of bindings){
       assert.equal(b.kind,'code');assert.equal(b.repo,repo);assert.match(b.revision,/^[a-f0-9]{40}$/);
       const bytes=execFileSync('git',['show',`${b.revision}:${b.path}`],{cwd:root});
       assert.equal(b.digest,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
       sources.add(`${b.revision}:${b.path}`);
     }
   }
 }
 // 发布定义覆盖执行时实际安装的全部8个手机文件及2个控制文件。
 for(const path of ['dispatch.py','preflight.py','deploy.py','collector.py','ocr.swift','publish.mjs','mirror.mjs','runner.py','openclaw_native.py','openclaw_commander.py'])
   assert.ok([...sources].some(s=>s.endsWith('/'+path)),`缺少实际安装绑定${path}`);
 const phoneFiles=['dispatch.py','preflight.py','deploy.py','collector.py','ocr.swift','publish.mjs','mirror.mjs','runner.py'];
 const legacy='4f899cab6425341646e27c5fca20979b8ac42be7';
 const diagnostic='864154c57e88e8085d2add741a79103a28891a44';
 const control='f38c5a5635d2f57554efcfee4b09163d10cfe39b';
 const phone=d.runtime.script.commands.find(c=>c.includes('/phone-account-patrol/'))?.match(/releases\/([a-f0-9]{40})\//)?.[1]??d.input_schema.properties.phone_source_revision.const;
 assert.ok([legacy,diagnostic].includes(phone));
 const requiredPhoneVersions=new Set([phone,...(name==='single'?[diagnostic]:[])]);
 for(const revision of requiredPhoneVersions)for(const file of phoneFiles)
   assert.ok(sources.has(`${revision}:scripts/phone-account-patrol/${file}`),`缺真实版本依赖${revision}:${file}`);
 for(const file of ['openclaw_native.py','openclaw_commander.py'])
   assert.ok(sources.has(`${control}:scripts/phone-account-patrol/${file}`));
 if(name==='maintenance')assert.equal(d.input_schema.properties.phone_source_revision.const,diagnostic,'f38维护实际current864，不能声明只运行旧4f');
 assert.equal(sources.size,requiredPhoneVersions.size*8+2,'实现依赖必须完整且没有未说明的额外版本');
});
