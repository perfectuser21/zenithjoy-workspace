import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const text=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const fn=text.slice(text.indexOf('record_sdk31_runtime() {'),text.indexOf('# 仅终止本eid'));
for(const [name,code,result,expected] of [
 ['known failure',64,{verified:false,execution_stop_unknown:false,phase:'failed',error:'exclusive creation refused'},'RECORD_CAPTURE_STRATEGY_UNVERIFIED'],
 ['unknown write',75,{verified:false,execution_stop_unknown:true,phase:'unknown',error:'transfer termination unproven'},'RECORD_CAPTURE_EXIT_UNVERIFIED'],
 ['malformed failure',64,'invalid json','RECORD_CAPTURE_EXIT_UNVERIFIED'],
 ['string false is not proof',64,{verified:false,execution_stop_unknown:'false',phase:'failed',error:'invalid typed proof'},'RECORD_CAPTURE_EXIT_UNVERIFIED'],
])test('controller classifies stage '+name,()=>{
 const d=mkdtempSync(join(tmpdir(),'stage-classification-'));try{
  const python=join(d,'python');writeFileSync(python,`#!/usr/bin/python3
import json,os,sys
if len(sys.argv)>1 and sys.argv[1].endswith('/runtime/scrcpy-runtime.py'):
 if sys.argv[2]=='verify': print('{"verified":true}');sys.exit(0)
 print(os.environ['FIXTURE_RESULT']);sys.exit(int(os.environ['FIXTURE_CODE']))
os.execv('/usr/bin/python3',['/usr/bin/python3',*sys.argv[1:]])
`,{mode:0o755});
  const script='set -eu\nLOCK_OWNER=owner\nSERIAL=device\nLOCK_DIR="$FIXTURE"\nEVIDENCE_ROOT="$FIXTURE"\nADB=/unused\nPYTHON_BIN="$FIXTURE/python"\ndie(){ print -u2 -- "$*"; exit 2; }\n'+fn+'\nrecord_sdk31_runtime own sdk33';
  const r=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,FIXTURE:d,FIXTURE_RESULT:typeof result==='string'?result:JSON.stringify(result),FIXTURE_CODE:String(code),DOUYIN_SDK33_RUNTIME_ROOT:d,PHONE_CONTROLLER_DIR:new URL('../',import.meta.url).pathname}});
  assert.equal(r.status,2);assert.match(r.stderr,new RegExp(expected));
  if(expected==='RECORD_CAPTURE_STRATEGY_UNVERIFIED')assert.doesNotMatch(r.stderr,/RECORD_CAPTURE_EXIT_UNVERIFIED/);
 }finally{rmSync(d,{recursive:true,force:true});}
});
