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
 // 运行闭包来自固定版本部署器的真实 FILES，而非把部署器当作运行依赖。
 const deploymentFiles=revision=>JSON.parse(execFileSync('python3',['-c',
   "import ast,json,sys; tree=ast.parse(sys.stdin.read()); print(json.dumps(next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets))))"],
   {input:execFileSync('git',['show',`${revision}:scripts/phone-account-patrol/deploy.py`],{cwd:root}),encoding:'utf8'}));
 const legacy='4f899cab6425341646e27c5fca20979b8ac42be7';
 const diagnostic='864154c57e88e8085d2add741a79103a28891a44';
 const control='f38c5a5635d2f57554efcfee4b09163d10cfe39b';
 const phone=d.runtime.script.commands.find(c=>c.includes('/phone-account-patrol/'))?.match(/releases\/([a-f0-9]{40})\//)?.[1]??d.input_schema.properties.phone_source_revision.const;
 assert.ok([legacy,diagnostic].includes(phone));
 const phoneSchema=d.input_schema.properties.phone_source_revision;
 const phoneVersions=Object.hasOwn(phoneSchema,'const')?[phoneSchema.const]:phoneSchema.enum;
 assert.ok(Array.isArray(phoneVersions)&&phoneVersions.length>0&&phoneVersions.every(v=>[legacy,diagnostic].includes(v)));
 const requiredPhoneVersions=new Set([...phoneVersions,...(name==='single'?[diagnostic]:[])]);
 const expected=new Set();
 for(const revision of requiredPhoneVersions){
   const installed=deploymentFiles(revision);
   assert.ok(installed.includes('SKILL.md'));
   assert.ok(!installed.includes('deploy.py'),'部署工具不得冒充已安装运行代码');
   for(const file of installed.filter(file=>file!=='SKILL.md')){
     expected.add(`${revision}:scripts/phone-account-patrol/${file}`);
     assert.ok(sources.has(`${revision}:scripts/phone-account-patrol/${file}`),`缺真实版本依赖${revision}:${file}`);
   }
 }
 for(const file of ['openclaw_native.py','openclaw_commander.py'])
   assert.ok(sources.has(`${control}:scripts/phone-account-patrol/${file}`));
 if(name==='maintenance')assert.equal(d.input_schema.properties.phone_source_revision.const,diagnostic,'f38维护实际current864，不能声明只运行旧4f');
 for(const file of ['openclaw_native.py','openclaw_commander.py'])expected.add(`${control}:scripts/phone-account-patrol/${file}`);
 assert.deepEqual([...sources].sort(),[...expected].sort(),'绑定须精确等于实际部署的运行代码闭包');
});

// 新回归契约验证旧固定代码，保留历史用例，拒绝把运行代码换成HEAD。
test('跨Python回归契约保留历史用例并在真实固定代码上执行',()=>{
 const program=`import ast,hashlib,pathlib,subprocess,sys,tempfile,tarfile,io,shutil,os
root=pathlib.Path(sys.argv[1]); revision='864154c57e88e8085d2add741a79103a28891a44'
fixture=root/'services/phone-adb-controller/patrol/contracts/regression/test_failure_evidence.py'
source=fixture.read_bytes()
old=subprocess.check_output(['git','show',revision+':scripts/phone-account-patrol/test_failure_evidence.py'],cwd=root)
def cases(raw):
 tree=ast.parse(raw); klass=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='FailureEvidenceTests'); return {n.name:n for n in klass.body if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
prior,current=cases(old),cases(source)
assert set(prior)<=set(current),'不可删除或跳过原用例'
for name,node in prior.items():
 if name!='test_deeply_nested_diagnostic_cannot_break_failure_reporting': assert ast.dump(node)==ast.dump(current[name]),'无关原用例被改变: '+name
assert len(current)>=len(prior)+3,'须确定性覆盖两解析分支与错误输出反例'
with tempfile.TemporaryDirectory(prefix='portable-failure-contract-') as directory:
 archive=subprocess.check_output(['git','archive',revision,'scripts/phone-account-patrol'],cwd=root)
 subprocess.run(['tar','-x','-C',directory],input=archive,check=True)
 target=pathlib.Path(directory)/'scripts/phone-account-patrol'
 code=['runner.py','collector.py','dispatch.py','preflight.py','publish.mjs','ocr.swift','mirror.mjs']
 before={name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in code}
 (target/'test_failure_evidence.py').write_bytes(source)
 subprocess.run(['python3','-m','unittest','test_failure_evidence'],cwd=target,check=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
 assert before=={name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in code},'回归不得改运行字节'
`;
 execFileSync('python3',['-c',program,root.pathname],{encoding:'utf8',stdio:'pipe'});
});

for(const name of ['single','batch'])test(`${name}默认当前864并精确兼容旧4f入口`,()=>{
 const d=JSON.parse(readFileSync(new URL(`${name}.json`,import.meta.url)));
 const old='4f899cab6425341646e27c5fca20979b8ac42be7',current='864154c57e88e8085d2add741a79103a28891a44',control='f38c5a5635d2f57554efcfee4b09163d10cfe39b';
 const command=revision=>`/usr/bin/python3 /Users/administrator/.local/share/phone-account-patrol/releases/${revision}/runner.py ${name==='single'?'phone --serial {{phone_serial}}':'batch'} --execution-script "$0"`;
 assert.equal(d.runtime.entrypoint,command(current));
 assert.deepEqual(d.input_schema.properties.phone_source_revision,{enum:[old,current]});
 assert.deepEqual(d.input_schema.properties.source_revision,{enum:name==='single'?[old,current,control]:[old,current]});
 assert.deepEqual(d.input_schema.properties.control_source_revision,{const:control});
 assert.deepEqual(d.runtime.script.commands,[command(current),command(old),...(name==='single'?[`/usr/bin/python3 /Users/administrator/.local/share/infra-workflow-commander/releases/${control}/openclaw_native.py recovery-phone --demand-task-id {{recovery_demand_id}} --serial {{phone_serial}} --execution-script "$0"`]:[])]);
});
