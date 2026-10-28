import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const api=await import('../qualification-maintenance-service.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
test('真实service/entry在authority未取得时给结构化BLOCK且进程非0，不把返回对象当成功',t=>{
 const home=mkdtempSync(join(tmpdir(),'maintenance-service-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 assert.equal(typeof api?.runMaintenance,'function');
 const entry=fileURLToPath(new URL('../qualification-maintenance.mjs',import.meta.url));
 for(const verb of ['preflight','close','readback']){
  const r=spawnSync(process.execPath,[entry,verb,'--maintenance-task-id','11111111-1111-4111-8111-111111111111'],{env:{...process.env,HOME:home},encoding:'utf8',timeout:5000});
  const result=JSON.parse(r.stdout);assert.equal(result.status,'blocked');assert.equal(result.stage,'authority');assert.equal(result.code,'MAINTENANCE_AUTHORITY_UNPROVEN');assert.notEqual(r.status,0);
 }
});
