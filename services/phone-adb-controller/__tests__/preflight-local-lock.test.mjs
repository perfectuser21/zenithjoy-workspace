import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,realpathSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const helper=new URL('../preflight-local-step.py',import.meta.url).pathname;
function invoke(root,operation,owner='fresh_fixture',epoch='00000000-0000-4000-8000-000000000001',receipt=null){
 const code=`import importlib.util,sys,json\ns=importlib.util.spec_from_file_location('fixed',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntry: print(json.dumps(m.lock_record(sys.argv[2], 'SERIAL',sys.argv[3],sys.argv[4],sys.argv[5],receipt=json.loads(sys.argv[6]))))\nexcept Exception: sys.exit(2)\n`;
 return spawnSync('/usr/bin/python3',['-I','-S','-c',code,helper,root,operation,owner,epoch,JSON.stringify(receipt)],{encoding:'utf8'});
}
test('pure lock operation is fresh/exact: refuses adoption and foreign renew, preserves original owner',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'preflight-lock-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const acquired=invoke(dir,'acquire');assert.equal(acquired.status,0,acquired.stderr);assert.equal(JSON.parse(acquired.stdout).lock,'acquired');
 assert.equal(readFileSync(join(dir,'SERIAL.lock/owner'),'utf8').trim(),'fresh_fixture');
 assert.notEqual(invoke(dir,'acquire').status,0);assert.notEqual(invoke(dir,'refresh','other_fixture').status,0);
 assert.notEqual(invoke(dir,'refresh','fresh_fixture','00000000-0000-4000-8000-000000000002').status,0);
 assert.equal(invoke(dir,'refresh').status,0);assert.equal(readFileSync(join(dir,'SERIAL.lock/owner'),'utf8').trim(),'fresh_fixture');
 writeFileSync(join(dir,'SERIAL.lock/standalone_review_required'),'fresh_fixture\n');
 assert.notEqual(invoke(dir,'acquire').status,0);assert.equal(existsSync(join(dir,'SERIAL.lock/standalone_review_required')),true);
});

test('fresh lock emits the original independent receipt schema and failed adoption is also recorded',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'preflight-lock-receipt-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'fresh_fixture-lock-acquire.json'),receipt={path,run:'fresh_fixture',profile:'fixture',serial:'SERIAL'};
 assert.equal(invoke(dir,'acquire','fresh_fixture',undefined,receipt).status,0);
 assert.equal(invoke(dir,'acquire','fresh_fixture',undefined,receipt).status,2);
 const doc=JSON.parse(readFileSync(path));assert.equal(doc.schema,'lock_receipt_v1');assert.equal(doc.events.length,2);
 assert.equal(doc.events[0].result,'ok');assert.equal(doc.events[1].result,'fail');assert.equal(doc.latest.readback_owner,'fresh_fixture');
 assert.equal(doc.latest.epoch,'00000000-0000-4000-8000-000000000001');
});

test('fixed lock endpoint preserves migrated-root checks and the mandatory original receipt in a private root',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'preflight-lock-endpoint-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'.migration-complete.json'),JSON.stringify({schema_version:1,state:'complete',source_sha256:'a'.repeat(64),legacy_root:join(dir,'empty-legacy')}));
 const request={root:dir,serial:'SERIAL',operation:'acquire',owner:'fresh_fixture',epoch:'00000000-0000-4000-8000-000000000001',receipt:{path:join(dir,'fresh_fixture-lock-acquire.json'),run:'fresh_fixture',profile:'fixture',serial:'SERIAL'}};
 // The only external boundary replaced is the production home root selector; original root validation and lock/receipt functions stay real.
 const code=`import importlib.util,sys,io
s=importlib.util.spec_from_file_location('fixed',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=m.peer
roots=p('phone-lock-root');roots.verify_root=roots.verify
m.peer=lambda name: roots if name=='phone-lock-root' else p(name)
sys.stdin=io.StringIO(sys.argv[2]);sys.argv=['fixed','lock'];m.main()
`;
 const p=spawnSync('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny process-fork)','/usr/bin/python3','-I','-S','-c',code,helper,JSON.stringify(request)],{encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).readback_owner,'fresh_fixture');
 assert.equal(JSON.parse(readFileSync(request.receipt.path)).latest.readback_owner,'fresh_fixture');
 const denied=spawnSync('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny process-fork)','/usr/bin/python3','-I','-S','-c',code,helper,JSON.stringify(request)],{encoding:'utf8'});assert.notEqual(denied.status,0);
 const doc=JSON.parse(readFileSync(request.receipt.path));assert.equal(doc.events.length,2);assert.equal(doc.latest.result,'fail');assert.equal(doc.latest.readback_owner,'fresh_fixture');
});

test('fresh scoped release requires the same epoch and emits original release receipt',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'preflight-lock-release-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 assert.equal(invoke(dir,'acquire').status,0);
 assert.equal(invoke(dir,'release','fresh_fixture','00000000-0000-4000-8000-000000000002').status,2);
 assert.equal(readFileSync(join(dir,'SERIAL.lock/owner'),'utf8').trim(),'fresh_fixture');
 const path=join(dir,'fresh_fixture-lock-release.json'),receipt={path,run:'fresh_fixture',profile:'fixture',serial:'SERIAL'};
 const released=invoke(dir,'release','fresh_fixture',undefined,receipt);assert.equal(released.status,0,released.stderr);
 assert.equal(JSON.parse(released.stdout).lock,'released');assert.equal(existsSync(join(dir,'SERIAL.lock')),false);
 const doc=JSON.parse(readFileSync(path));assert.equal(doc.schema,'lock_receipt_v1');assert.equal(doc.latest.result,'ok');assert.equal(doc.latest.readback_owner,'none');
});

test('scoped release refuses a changed inventory before removing any owner field',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'preflight-lock-extra-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));assert.equal(invoke(dir,'acquire').status,0);
 writeFileSync(join(dir,'SERIAL.lock/foreign-evidence'),'preserve');assert.equal(invoke(dir,'release').status,2);assert.equal(readFileSync(join(dir,'SERIAL.lock/owner'),'utf8').trim(),'fresh_fixture');
});

test('quarantine only writes this exact owner epoch marker and never releases or renews it',t=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'preflight-lock-quarantine-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));assert.equal(invoke(dir,'acquire').status,0);
 assert.equal(invoke(dir,'quarantine','foreign_fixture').status,2);const alias=dir+'-alias';symlinkSync(dir,alias);t.after(()=>rmSync(alias,{force:true}));assert.equal(invoke(alias,'quarantine').status,2);
 assert.equal(invoke(dir,'quarantine','fresh_fixture','00000000-0000-4000-8000-000000000002').status,2);assert.equal(existsSync(join(dir,'SERIAL.lock/standalone_review_required')),false);
 const ts=readFileSync(join(dir,'SERIAL.lock/acquired_at'),'utf8'),result=invoke(dir,'quarantine');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).lock,'quarantined');assert.equal(readFileSync(join(dir,'SERIAL.lock/standalone_review_required'),'utf8').trim(),'fresh_fixture');assert.equal(readFileSync(join(dir,'SERIAL.lock/acquired_at'),'utf8'),ts);assert.equal(invoke(dir,'release').status,2);
});
