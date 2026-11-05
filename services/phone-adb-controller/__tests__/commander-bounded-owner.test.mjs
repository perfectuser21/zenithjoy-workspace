import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openClawCommander} from '../activity-commander.mjs';
const module=await import('../commander-bounded-owner.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===new URL('../commander-bounded-owner.mjs',import.meta.url).href)return {};
 throw error;
});
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),sha=x=>createHash('sha256').update(x).digest('hex');
const scope={workflow_key:'douyin_comment_scoring',run_id:'douyin_comment_scoring-bounded_owner__a1',binding_id:'11111111-1111-4111-8111-111111111111',task_id:'22222222-2222-4222-8222-222222222222',source_commit:'a'.repeat(40),commander_role:'observer'};
async function using(fn,{duration=4000}={}){
 assert.equal(typeof module.createBoundedCommanderOwner,'function','Commander needs a source-pinned nofork owner rather than an untracked Python wrapper');
 const home=realpathSync(mkdtempSync(join(tmpdir(),'commander-owner-')));
 const declared=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.find(host=>host.target==='mmv').executables.python;
 const path=realpathSync(process.env.DOUYIN_PYTHON_BIN||declared.path),python={path,sha256:sha(readFileSync(path))};
 const source={commit:scope.source_commit,files:['commander-bounded-owner.mjs','commander-owner-lock.mjs','commander-owner-state.mjs','activity-commander.mjs'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
 const deadlineMs=Date.now()+duration,cleanupDeadlineMs=deadlineMs+1000;
 const owner=module.createBoundedCommanderOwner({runtimeRoot:root,source,python,deadlineMs,cleanupDeadlineMs});
 try{await fn({home,source,python,owner,deadlineMs,cleanupDeadlineMs});}finally{const final=await owner.close();if(final.pending===0)rmSync(home,{recursive:true,force:true});}
}
test('openClawCommander uses a Code-owned reservation hook and always closes it',async()=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'commander-hook-'))),calls=[];
 try{
  const commander=openClawCommander({home,reserveOwner:async receipt=>{
   assert.equal(receipt,scope);calls.push('reserve');return {check:async()=>calls.push('check'),returned:async()=>calls.push('returned'),close:async()=>calls.push('close')};
  },execute:async(command,args)=>{
   calls.push('execute');const params=JSON.parse(args.at(-1));return {stdout:JSON.stringify({runId:params.idempotencyKey,status:'ok',payloads:[{text:'{"action":"none"}'}]})};
  }});
  assert.equal((await commander(scope)).action,'none');assert.deepEqual(calls,['reserve','check','execute','returned','close']);
 }finally{rmSync(home,{recursive:true,force:true});}
});
test('bounded observer reserves and archives through the original flock holder',{skip:process.platform!=='darwin'},()=>using(async({owner,home})=>{
 const reservation=await owner.reserveOwner(scope,{home});await reservation.check();
 const outcome=await reservation.returned('{"actual":"response bytes"}');
 assert.equal(existsSync(outcome.original_path),true);assert.equal(existsSync(outcome.receipt_path),true);
 await reservation.close();const stopped=await owner.close();
 assert.equal(stopped.execution_stopped,true);assert.equal(stopped.pending,0);assert.equal(stopped.calibration.fork_denied,true);
 assert.equal(stopped.leaves.every(leaf=>leaf.process_closed&&leaf.stdin_closed&&leaf.stdout_closed&&leaf.stderr_closed),true);
}));
test('one reservation cannot erase or overwrite an unresolved original owner',{skip:process.platform!=='darwin'},()=>using(async({owner,home})=>{
 const first=await owner.reserveOwner(scope,{home});await first.close();
 await assert.rejects(owner.reserveOwner(scope,{home}),/COMMANDER_OWNER/);
 const names=(await import('node:fs')).readdirSync(join(home,'.openclaw/leadgen-owner-turns'));
 assert.equal(names.filter(name=>name.endsWith('.pending.json')).length,1);
}));
test('sealed observer cannot acquire a new owner or launch a helper',{skip:process.platform!=='darwin'},()=>using(async({owner,home})=>{
 const closed=await owner.close();assert.equal(closed.execution_stopped,true);
 await assert.rejects(owner.reserveOwner(scope,{home}),/COMMANDER_OWNER/);
 assert.equal(owner.snapshot().leaves.length,0);
}));
test('wrong source identity is rejected before reserving any turn',{skip:process.platform!=='darwin'},()=>using(async({owner,home})=>{
 await assert.rejects(owner.reserveOwner({...scope,source_commit:'b'.repeat(40)},{home}),/COMMANDER_OWNER/);
 assert.equal(owner.snapshot().leaves.length,0);
}));
test('expired absolute deadline closes the owned helper and leaves its pending reservation',{skip:process.platform!=='darwin'},()=>using(async({owner,home,deadlineMs})=>{
 const reservation=await owner.reserveOwner(scope,{home});
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadlineMs-Date.now())+100));
 await assert.rejects(reservation.check(),/COMMANDER_OWNER/);
 const state=await owner.close();assert.equal(state.pending,0);
 const names=(await import('node:fs')).readdirSync(join(home,'.openclaw/leadgen-owner-turns'));
 assert.equal(names.filter(name=>name.endsWith('.pending.json')).length,1);
},{duration:1500}));
test('the parent keeps the shared flock FD after helper death until explicit close',{skip:process.platform!=='darwin'},()=>using(async({owner,home,source,python,deadlineMs,cleanupDeadlineMs})=>{
 const first=await owner.reserveOwner(scope,{home});
 const pid=owner.snapshot().leaves.find(leaf=>leaf.purpose==='owner').pid;assert.ok(pid>1);process.kill(pid,'SIGKILL');
 for(let i=0;i<40&&!owner.snapshot().leaves.find(leaf=>leaf.purpose==='owner').process_closed;i++)await new Promise(resolve=>setTimeout(resolve,5));
 const second=module.createBoundedCommanderOwner({runtimeRoot:root,source,python,deadlineMs,cleanupDeadlineMs});
 try{
  await assert.rejects(second.reserveOwner(scope,{home}),/COMMANDER_OWNER/);
  assert.equal(second.snapshot().leaves.find(leaf=>leaf.purpose==='owner').ready,false,'flock must still be held by the original parent FD');
 }finally{await second.close();}
 await first.close();
 const third=module.createBoundedCommanderOwner({runtimeRoot:root,source,python,deadlineMs,cleanupDeadlineMs});
 try{
  await assert.rejects(third.reserveOwner(scope,{home}),/COMMANDER_OWNER/);
  assert.equal(third.snapshot().leaves.find(leaf=>leaf.purpose==='owner').ready,true,'flock is free only after close; original pending still blocks reserve');
 }finally{await third.close();}
}));
