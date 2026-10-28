import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest} from '../runtime-definition.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
import {authorizeMaintenance} from '../qualification-maintenance-authority.mjs';
const api=await import('../qualification-maintenance-runtime.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
test('public runtime必须从本maintenance候选实际安装路径运行，开发树不能执行维护',async()=>{
 assert.equal(typeof api?.createMaintenanceRuntime,'function');
 await assert.rejects(api.createMaintenanceRuntime({authority:authorizeMaintenance(authorityFixture()),verb:'close'}),/MAINTENANCE_RUNTIME_NOT_INSTALLED/);
});
function deviceFixture(){
 const original={recording:{capture_audio_sdk:36,native_audio_restored:{state:'started',uid:10061,pid:13732,piid:5087,package_uid_verified:true}}};
 const observation={status:'observed',serial:'SER1',sdk:36,uid:10061,audio:{state:'started',uid:10061,pid:13732,piid:5087},processes:{capture_pids:[],unknown_capture_pids:[]},processes_after:{capture_pids:[],unknown_capture_pids:[]},projection:{state:'inactive'},projection_after:{state:'inactive'},foreground_verified:false,
 observed_at_ms:Date.now()-100,completed_at_ms:Date.now(),observer_sha256:digest(readFileSync(new URL('../qualification-maintenance-device.py',import.meta.url))),
 normalized_text_sha256:Object.fromEntries(['sdk','processes','projection','audio','package','foreground','owners','processes_after','projection_after'].map(k=>[k,'a'.repeat(64)]))};
 return {original,observation};
}
test('当前设备观察必须与原recording恢复UID/PID/PIID/state及实际reader字节相符，不靠observed标签',()=>{
 assert.equal(typeof api?.verifyRestoredDevice,'function');const f=deviceFixture();assert.equal(api.verifyRestoredDevice(f.original,f.observation,'SER1').status,'verified');
 for(const change of [x=>x.serial='OTHER',x=>x.observer_sha256='b'.repeat(64),x=>x.audio.piid++,x=>x.uid++,x=>x.processes_after.capture_pids=[399],x=>x.processes_after.unknown_capture_pids=[401],x=>x.projection.state='unknown',x=>x.completed_at_ms=0]){
  const f=deviceFixture();change(f.observation);assert.throws(()=>api.verifyRestoredDevice(f.original,f.observation,'SER1'),/MAINTENANCE_DEVICE_UNPROVEN/);
 }
});
