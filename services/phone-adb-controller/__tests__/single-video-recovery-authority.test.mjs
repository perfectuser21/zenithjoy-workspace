import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const input={op:'recover_single_video',line:'jinuo',run:'single_video_recovery_ab68977b',decision_id:'ab68977b-2670-4a90-9d84-bdd3b25f3e04',maintenance_task_id:'1cbcc881-c52d-437a-ba11-701d849330a9',video_id:'7699316353698753663'};
async function factory(io){let exported;try{exported=require('../single-video-recovery-authority.js');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}assert.equal(typeof exported?.createAuthority,'function','默认生产authority adapter尚未交付');return exported.createAuthority(io);}
test('adapter不以请求中old_native_stopped/guard_held/actor/evidence为授权',async()=>{const a=await factory({brain:async()=>{throw Error('offline');}});await assert.rejects(a.readAuthority({...input,old_native_stopped:true,guard_held:true,actor:'root',evidence_sha256:'a'.repeat(64)}),/RECOVERY_REQUEST_INVALID/);});
test('Brain超时固定错误，不传播可能敏感异常',async()=>{const a=await factory({brain:async()=>{throw Error('secret-sentinel');}});await assert.rejects(a.readAuthority(input),e=>e.message==='RECOVERY_AUTHORITY_UNAVAILABLE'&&!e.message.includes('sentinel'));});
test('canonical批准缺失时不能拿相近决定或callerJSON代替',async()=>{const a=await factory({brain:async()=>[{id:'other',made_by:'user',status:'active',decision:'{}'}]});await assert.rejects(a.readAuthority(input),/RECOVERY_DECISION_NOT_FOUND/);});
test('默认HTTP origin固定，拒绝重定向/非Brain origin与截断分页',async()=>{const a=await factory({fetch:async(url,options)=>{assert.ok(String(url).startsWith('http://localhost:5221/api/brain/'));assert.equal(options.redirect,'error');return {ok:true,json:async()=>({decisions:[],has_more:true,next_cursor:'https://evil.example'})};}});await assert.rejects(a.readAuthority(input),/RECOVERY_DECISION_NOT_FOUND|RECOVERY_AUTHORITY_UNAVAILABLE/);});
