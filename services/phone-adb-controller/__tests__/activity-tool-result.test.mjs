import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const main=new URL('./fixtures/activity-tool-main.py',import.meta.url),program=new URL('../activity-tool-result.py',import.meta.url);
const hash=s=>createHash('sha256').update(s).digest('hex');
function run(mode){const dir=mkdtempSync(join(tmpdir(),'activity-result-'));try{
const code=`import pathlib,sys,json,time,fcntl,re,subprocess,importlib.util\nP=pathlib.Path(sys.argv[1]);mode=sys.argv[2]\ndef read(p):return json.loads(p.read_text())\ndef atomic(p,x):p.write_text(json.dumps(x))\ndef context():return {'cleanup_deadline_ms':int(time.time()*1000)+10000,'business_deadline_ms':int(time.time()*1000)+10000,'assigned_workflow':'102','tasks':{'102':{'task_id':'task','run_id':'run'}}},'preflight'\ndef task_authority(c):pass\ndef outreach_recovery(*a):return False\nREAD=set()\ndef invoke(*a):\n raise ValueError('LOCK_WRITE_SCOPE')\nsys.argv=['tools','brain','test-action','device-locks/acquire','{}']\nexec(compile(pathlib.Path(${JSON.stringify(main.pathname)}).read_text(),'tools.py','exec'))`;
return spawnSync('/usr/bin/python3',['-c',code,dir,mode],{encoding:'utf8'});
}finally{rmSync(dir,{recursive:true,force:true});}}
test('real original main demonstrates pre-dispatch local failure must reach the host as structured terminal stdout',()=>{const r=run('pre');assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).state,'terminal');});
test('permanent fixture is anchored to the exact real main source',()=>{const p=JSON.parse(readFileSync(new URL('./fixtures/activity-tool-main.provenance.json',import.meta.url)));assert.equal(hash(readFileSync(main)),p.fixture_sha256);});
