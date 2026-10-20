import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,existsSync,realpathSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareTransport} from './fixtures/m4-deploy-transport.mjs';
const service=new URL('../',import.meta.url).pathname;
const quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
function run(t,{badSyntax=false,missing=false}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'m4-deploy-batch-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {home,env}=prepareTransport(root),source=join(root,'source');mkdirSync(source);
 const files={'a.sh':'#!/bin/sh\ntrue\n','log-stream-push.sh':'#!/bin/sh\ntrue\n','z.sh':'#!/bin/sh\ntrue\n',
  'one.mjs':badSyntax?'const = ;\n':'export const value=1;\n','two.mjs':'export const value=2;\n',
  'skills/first/SKILL.md':'---\nname: real-payload\n---\nSkill bytes\n','checks/test.json':'{"ok":true}\n',
  'plans/test.plan':'#!/bin/sh\ntrue\n','plans/test.steps.json':'{"steps":[]}\n'};
 for(const [p,bytes] of Object.entries(files)){mkdirSync(join(source,p,'..'),{recursive:true});if(!(missing&&p==='one.mjs'))writeFileSync(join(source,p),bytes,{mode:0o640});}
 // Execute the actual production M4 four-loop block, never a second installer.
 const deploy=readFileSync(join(service,'deploy.sh'),'utf8');
 const block=deploy.slice(deploy.indexOf('echo "=== [3/3]'),deploy.indexOf('echo "=== [4/4]'));
 const helpers=existsSync(join(service,'deployment-functions.sh'))
  ?`source ${quote(join(service,'deployment-functions.sh'))}\n`
  :deploy.slice(deploy.indexOf('push_atomic() {'),deploy.indexOf('//never-match')<0?deploy.indexOf('# 固定源SQL'):0);
 const special=join(root,'special.log');
 const script=`set -euo pipefail\nD=${quote(source)}\nDEPLOY_TOOL_DIR=${quote(service)}\nFAILED=0\n${helpers}
remote_md5(){ printf '%s\\n' before >> ${quote(special)}; printf old; }
kickstart_if_changed(){ printf '%s\\n' kickstart >> ${quote(special)}; }
DEVICE_SH_FILES=(a.sh log-stream-push.sh z.sh)
DEVICE_NODE_FILES=(one.mjs two.mjs)
DEVICE_RPC_PROBE_FILES=(skills/first/SKILL.md checks/test.json)
DEVICE_PLAN_FILES=(plans/test.plan plans/test.steps.json)
${block}
printf 'FINAL_FAILED=%s\\n' "$FAILED"
`;
 const started=performance.now(),r=spawnSync('bash',['-c',script],{env,encoding:'utf8',timeout:30000});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);const calls=readFileSync(join(root,'transport.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 t.diagnostic(JSON.stringify({ssh:calls.filter(x=>x.kind==='ssh').length,scp:calls.filter(x=>x.kind==='scp').length,elapsed_ms:performance.now()-started}));
 return {root,home,source,files,result:r,calls,elapsed:performance.now()-started,special:readFileSync(special,'utf8')};
}
test('M4 actual ordinary deployment uses bounded transport while preserving every payload and stream barrier',t=>{
 const r=run(t);assert.match(r.result.stdout,/FINAL_FAILED=0/);
 for(const [p,b] of Object.entries(r.files)){assert.equal(readFileSync(join(r.home,'bin-harvest',p),'utf8'),b);assert.equal(statSync(join(r.home,'bin-harvest',p)).mode&0o777,p.endsWith('.sh')?0o751:0o640);}
 assert.equal(r.special,'before\nkickstart\n');
 assert.ok(r.calls.filter(x=>x.kind==='scp').length<=2,'ordinary M4 payload must be uploaded once; stream retains its separate upload');
 assert.ok(r.calls.filter(x=>x.kind==='ssh').length<=8,'bulk staging/install must bound actual SSH process launches');
});
for(const options of [{badSyntax:true},{missing:true}])test('M4 syntax failure or required missing source preserve FAILED and continue to later real bytes '+JSON.stringify(options),t=>{
 const r=run(t,options);assert.match(r.result.stdout,/FINAL_FAILED=1/);
 assert.equal(readFileSync(join(r.home,'bin-harvest','two.mjs'),'utf8'),r.files['two.mjs']);
 assert.equal(readFileSync(join(r.home,'bin-harvest','plans/test.steps.json'),'utf8'),r.files['plans/test.steps.json']);
 assert.equal(r.special,'before\nkickstart\n');
});
function bundle(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'m4-pack-reject-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source'),home=join(root,'home');mkdirSync(source);mkdirSync(home);mkdirSync(join(source,'nested'));
 writeFileSync(join(source,'first.json'),'{"ok":true}\n');writeFileSync(join(source,'nested/last.json'),'{"last":true}\n');
 const archive=join(root,'payload.tar'),tool=join(service,'deployment-m4-payload.py');
 const r=spawnSync('python3',[tool,'pack',source,archive,'--probe','first.json','nested/last.json'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 return {root,source,home,archive,tool};
}
for(const mutation of ['truncate','extra','duplicate','link','escape','hash','paired'])test('M4 entire staged bundle rejects '+mutation+' before any live file replacement',t=>{
 const f=bundle(t);const code=`import io,json,tarfile,pathlib,sys\np=pathlib.Path(sys.argv[1]);kind=sys.argv[2]\nif kind=='truncate':p.write_bytes(p.read_bytes()[:100]);sys.exit()\nwith tarfile.open(p) as t: rows=[(m.name,t.extractfile(m).read()) for m in t.getmembers()]\nif kind=='extra':rows.append(('payload/unexpected.json',b'{}'))\nif kind=='duplicate':rows.append(rows[-1])\nif kind=='escape':rows.append(('../escape',b'bad'))\nif kind in ('hash','paired'):\n plan=json.loads(rows[0][1]);plan[0]['sha256']='0'*64 if kind=='hash' else plan[0]['sha256']\n if kind=='paired':plan[0]['path']='douyin-phone-adb'\n rows[0]=(rows[0][0],json.dumps(plan).encode())\nwith tarfile.open(p,'w') as t:\n for name,data in rows:\n  m=tarfile.TarInfo(name);m.size=len(data);t.addfile(m,io.BytesIO(data))\n if kind=='link':\n  m=tarfile.TarInfo('payload/link');m.type=tarfile.SYMTYPE;m.linkname='../outside';t.addfile(m)\n`;
 const changed=spawnSync('python3',['-c',code,f.archive,mutation],{encoding:'utf8'});assert.equal(changed.status,0,changed.stderr);
 const hash=createHash('sha256').update(readFileSync(f.archive)).digest('hex');
 const r=spawnSync('python3',[f.tool,'install',f.archive,hash,'after','1'],{env:{...process.env,HOME:f.home},encoding:'utf8'});
 assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,/M4_PAYLOAD_INVALID/);assert.equal(existsSync(join(f.home,'bin-harvest/first.json')),false);
});
test('later destination parent link is rejected before the first ordinary target is replaced',t=>{
 const f=bundle(t),root=join(f.home,'bin-harvest'),outside=join(f.root,'outside');mkdirSync(root);mkdirSync(outside);symlinkSync(outside,join(root,'nested'));
 const hash=createHash('sha256').update(readFileSync(f.archive)).digest('hex');
 const r=spawnSync('python3',[f.tool,'install',f.archive,hash,'after','1'],{env:{...process.env,HOME:f.home},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(existsSync(join(root,'first.json')),false,'preflight all destination parents before replacing any file');
});
test('missing remote syntax interpreter is FAILED and continues like the original SSH exit127',t=>{
 const f=bundle(t),hash=createHash('sha256').update(readFileSync(f.archive)).digest('hex');
 const code=`import importlib.util,sys,types\nspec=importlib.util.spec_from_file_location('batch',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ncount=0\ndef run(*a,**k):\n global count\n count+=1\n if count==1:raise FileNotFoundError('fixture interpreter missing')\n return types.SimpleNamespace(returncode=0,stderr='')\nm.subprocess.run=run\nsys.exit(m.install(types.SimpleNamespace(archive=sys.argv[2],sha256=sys.argv[3],phase='after',has_zsh='1')))\n`;
 const r=spawnSync('python3',['-c',code,f.tool,f.archive,hash],{env:{...process.env,HOME:f.home},encoding:'utf8'});
 assert.equal(r.status,3,r.stderr);assert.equal(readFileSync(join(f.home,'bin-harvest/nested/last.json'),'utf8'),'{"last":true}\n');
});
test('pre-existing same-directory temporary file is refused without deleting another writer bytes',t=>{
 const f=bundle(t),root=join(f.home,'bin-harvest');mkdirSync(root);const temp=join(root,'.first.json.deploy-new');writeFileSync(temp,'other writer');
 const hash=createHash('sha256').update(readFileSync(f.archive)).digest('hex');
 const r=spawnSync('python3',[f.tool,'install',f.archive,hash,'after','1'],{env:{...process.env,HOME:f.home},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(readFileSync(temp,'utf8'),'other writer');assert.equal(existsSync(join(root,'first.json')),false);
});
