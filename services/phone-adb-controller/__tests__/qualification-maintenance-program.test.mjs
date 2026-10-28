import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../qualification-maintenance-processes.py',import.meta.url));
function describe(executable,argv){const code='import importlib.util,json,sys\ns=importlib.util.spec_from_file_location("observer",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=json.loads(sys.stdin.read());print(json.dumps(m.describe_program(x["executable"],x["argv"])))';
 const r=spawnSync('python3',['-B','-I','-c',code,path],{input:JSON.stringify({executable,argv}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('只把真实解释器脚本位置作为代码身份，不把普通参数中路径升级为actor',t=>{
 const dir=mkdtempSync(join(tmpdir(),'maintenance-program-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const script=join(dir,'script.py');writeFileSync(script,'print("source")\n');
 const real=describe('/usr/bin/python3',['python3',script]);assert.equal(real.kind,'script');assert.equal(real.script.path,script);assert.match(real.script.sha256,/^[a-f0-9]{64}$/);
 const ordinary=describe('/usr/bin/python3',['python3','-c','print("not an actor")',script]);assert.equal(ordinary.kind,'inline');assert.equal(ordinary.script,undefined);
});
test('inline源码或凭据绝不回显，只输出摘要，未知flags不猜脚本',()=>{
 const result=describe('/usr/bin/python3',['python3','-c','SECRET_DO_NOT_OUTPUT=123']);assert.equal(result.kind,'inline');assert.ok(!JSON.stringify(result).includes('SECRET_DO_NOT_OUTPUT'));
 assert.equal(describe('/usr/bin/python3',['python3','--unreviewed-option','/tmp/whatever.py']).kind,'unclassified');
});
