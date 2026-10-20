import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareTransport} from './fixtures/m4-deploy-transport.mjs';
const service=new URL('../',import.meta.url).pathname;
const quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
function run(t,{badSyntax=false,missing=false}={}){
 const root=mkdtempSync(join(tmpdir(),'m4-deploy-batch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
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
