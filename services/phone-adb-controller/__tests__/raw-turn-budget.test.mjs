import test from 'node:test';
import assert from 'node:assert/strict';
const subject=await import('../raw-turn-budget.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('预检模型不能独占232秒Worker窗口；观察和原生工具有固定余量',()=>{
 assert.equal(typeof subject.rawModelTurnDeadline,'function');
 const now=100000,request={activity_key:'preflight',worker_deadline_ms:now+232000};
 const deadline=subject.rawModelTurnDeadline(request,now);
 assert.ok(deadline<=now+60000);assert.ok(request.worker_deadline_ms-deadline>=40000);
 assert.equal(subject.rawModelTurnDeadline(request,now+200000),null);
 assert.equal(request.worker_deadline_ms,now+232000);
});
