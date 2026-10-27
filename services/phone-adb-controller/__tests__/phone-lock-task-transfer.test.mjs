// Real task_list, actual remote shell/parser and throttled stdout; no devices/API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const helper=new URL('../phone-lock-helper.py',import.meta.url).pathname;
const python=spawnSync('/bin/sh',['-c','command -v python3'],{encoding:'utf8'}).stdout.trim();
function setup(t,tasks){
 const dir=mkdtempSync(join(tmpdir(),'lock-task-transfer-')),bin=join(dir,'bin');mkdirSync(bin);t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'tasks.json'),JSON.stringify(tasks));
 writeFileSync(join(bin,'curl'),`#!${python}\nimport os,sys\nif os.environ.get('CURL_FAIL'):sys.exit(22)\nsys.stdout.write(os.environ.get('BAD_JSON')or open(os.environ['FIXTURE_DIR']+'/tasks.json').read())\n`,{mode:0o755});
 const ssh=join(dir,'ssh');
 writeFileSync(ssh,`#!${python}\nimport os,sys,subprocess,time,json\nr=subprocess.run(['/bin/sh','-c',sys.argv[-1]],capture_output=True,timeout=10)\nopen(os.environ['FIXTURE_DIR']+'/wire-size','w').write(str(len(r.stdout)))\nif r.returncode:sys.stderr.buffer.write(r.stderr);sys.exit(r.returncode)\nb=r.stdout\nif os.environ.get('WIRE_RAW'):b=open(os.environ['FIXTURE_DIR']+'/tasks.json','rb').read()\nif os.environ.get('WIRE_CORRUPT'):b=b[:-4]+b'bad!'\nif os.environ.get('SLOW_STDOUT'):\n for i in range(0,len(b),2048):sys.stdout.buffer.write(b[i:i+2048]);sys.stdout.buffer.flush();time.sleep(.02)\nelse:sys.stdout.buffer.write(b)\n`,{mode:0o755});
 const env={...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_DIR:dir,DOUYIN_LOCK_SSH_BIN:ssh};
 const run=(extra={},code='print(json.dumps(m.task_list(),ensure_ascii=False))')=>spawnSync(python,['-c',`import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('phone_lock',${JSON.stringify(helper)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n${code}`],{env:{...env,...extra},encoding:'utf8',timeout:19000,maxBuffer:8*1024*1024});
 return {dir,run,env};
}
const row=(id='task')=>({id,status:'in_progress',task_type:'dev',claimed_by:'actor',claimed_at:'2026-10-27T00:00:00Z',payload:{device:{serial:'OTHER',profile:'other'},nested:{deviceSerial:'ANOTHER'}},result:{old_serial:'SERIAL-KEPT',details:'retain me'},description:'full row retained',title:'原始中文标题'});

test('large actual authority response crosses throttled link within unchanged15s and retains every field',{timeout:22000},t=>{
 const tasks=Array.from({length:27},(_,i)=>({...row('task-'+i),result:{old_serial:'SERIAL-KEPT',details:'原样保留大结果'.repeat(8000)}}));
 const f=setup(t,tasks),r=f.run({SLOW_STDOUT:'1'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),tasks);
 assert.ok(Number(readFileSync(join(f.dir,'wire-size'),'utf8'))<50000,'remote application transport must compress, not remove result/payload');
});
test('task owner payload result and unknown fields remain exactly intact',t=>{const tasks=[row()];const f=setup(t,tasks),r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),tasks);});
test('serial mentioned only in result still refuses lock reap',t=>{const f=setup(t,[row()]);const r=f.run({},"sys.argv=['helper','safe-to-reap','other-owner','SERIAL-KEPT','unmatched'];sys.exit(m.safe_to_reap())");assert.equal(r.status,1);assert.equal(r.stdout.trim(),'active-task');});
for(const [name,tasks] of [['duplicate ids',[row(),row()]],['invalid status',[{...row(),status:'completed'}]],['non-list',{tasks:[row()]}]])test('original malformed authority rows still refuse: '+name,t=>{const f=setup(t,tasks),r=f.run();assert.notEqual(r.status,0);});
for(const patch of [{CURL_FAIL:'1'},{BAD_JSON:'not json'},{WIRE_CORRUPT:'1'}])test('failed API or malformed/corrupt wire remains fail closed '+JSON.stringify(patch),t=>{const f=setup(t,[row()]),r=f.run(patch);assert.notEqual(r.status,0);});
test('full pages expand limit without filtering rows',t=>{const tasks=Array.from({length:200},(_,i)=>row('row-'+i));const f=setup(t,tasks),r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),tasks);});

test('successful remote command must return explicit transport envelope, never raw fallback',t=>{const f=setup(t,[row()]),r=f.run({WIRE_RAW:'1'});assert.notEqual(r.status,0);});

// Decode the actual transport envelope at its boundary; malformed cases must
// reject before any task or local-process decision can treat them as authority.
for(const mode of ['schema','bool-size','base64','size','digest','truncated','concatenated','trailing','oversize'])test('compressed authority decoder fails closed: '+mode,t=>{
 const f=setup(t,[]),code=`import base64,gzip,hashlib\nraw=b'[]'\nb=gzip.compress(raw,mtime=0)\nw={'version':1,'encoding':'gzip-base64','size':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'data':base64.b64encode(b).decode()}\nmode=${JSON.stringify(mode)}\nif mode=='schema':w['extra']='not allowed'\nif mode=='bool-size':w['size']=True\nif mode=='base64':w['data']='not base64!'\nif mode=='size':w['size']+=1\nif mode=='digest':w['sha256']='0'*64\nif mode=='truncated':w['data']=base64.b64encode(b[:-2]).decode()\nif mode=='concatenated':w['data']=base64.b64encode(b+b).decode()\nif mode=='trailing':w['data']=base64.b64encode(b+b'garbage').decode()\nif mode=='oversize':w['size']=64*1024*1024+1\ntry:m.decode_task_transport(json.dumps(w))\nexcept ValueError:sys.exit(0)\nraise AssertionError('invalid envelope accepted')`;
 const r=f.run({},code);assert.equal(r.status,0,r.stderr);
});

test('actual expanded payload above64MiB is refused even when declared small',t=>{
 const f=setup(t,[]),r=f.run({},"import gzip,base64,hashlib\nb=b'x'*(64*1024*1024+1)\nw={'version':1,'encoding':'gzip-base64','size':2,'sha256':hashlib.sha256(b'[]').hexdigest(),'data':base64.b64encode(gzip.compress(b,mtime=0)).decode()}\ntry:m.decode_task_transport(json.dumps(w))\nexcept ValueError:sys.exit(0)\nraise AssertionError('expanded bomb accepted')");assert.equal(r.status,0,r.stderr);
});
