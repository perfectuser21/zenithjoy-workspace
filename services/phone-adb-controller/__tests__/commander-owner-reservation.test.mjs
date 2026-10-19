import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const modulePath=fileURLToPath(new URL('../activity-commander.mjs',import.meta.url));
const transportPath=fileURLToPath(new URL('../leadgen-skill-agent.mjs',import.meta.url));
const scope={run_id:'persistent-owner__a1',binding_id:'binding-one',source_commit:'a'.repeat(40)};
function child(home,mode){
 const script=`import {appendFileSync} from 'node:fs';
 import {openClawCommander} from ${JSON.stringify(modulePath)};
 import {runSkillAgent} from ${JSON.stringify(transportPath)};
 const home=process.argv[1],mode=process.argv[2],scope=${JSON.stringify(scope)};
 const execute=async()=>{appendFileSync(home+'/launches','launch\\n');const e=Error('transport timeout');e.code='ETIMEDOUT';throw e;};
 try{if(mode==='consult')await openClawCommander({home,execute})({...scope,activity:'scoring',phase:'before'});
 else await runSkillAgent({...scope,protocol:'leadgen-activity-v1',activity_key:'scoring',nonce:'b'.repeat(48),deadline_ms:Date.now()+20000,broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.0',text:'fixture'}},{home,verifyWorkspace:()=>true,execute});
 }catch(error){process.stdout.write(error.message);}`;
 return execFileSync(process.execPath,['--input-type=module','-e',script,home,mode],{encoding:'utf8'});
}

test('真实子进程重启不清未知owner，咨询与Skill接手均零新增CLI',()=>{
 const home=mkdtempSync(join(tmpdir(),'owner-restart-'));
 try{
  child(home,'consult');
  assert.match(child(home,'consult'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.match(child(home,'handoff'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.equal(readFileSync(join(home,'launches'),'utf8').trim().split('\n').length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('Skill父调用未知后新进程不能继续咨询同一owner',()=>{
 const home=mkdtempSync(join(tmpdir(),'owner-handoff-restart-'));
 try{
  child(home,'handoff');
  assert.match(child(home,'consult'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.equal(readFileSync(join(home,'launches'),'utf8').trim().split('\n').length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});
