import test from 'node:test';import assert from 'node:assert/strict';
const subject=await import('../native-preflight-quarantine-review.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('通用预检只读隔离审查必须有正式入口，不能复用cloudN专属authority',()=>{
 assert.equal(typeof subject.inspectReview,'function');assert.equal(typeof subject.planReview,'function');assert.equal(typeof subject.applyReview,'function');
});
test('原Worker已派发或只读证据缺失时必须拒绝，不能信输入stopped=true',()=>{
 assert.equal(typeof subject.verifyPreflightEvidence,'function');
 assert.throws(()=>subject.verifyPreflightEvidence({execution_stopped:true,readonly:true}),/REVIEW/);
});
