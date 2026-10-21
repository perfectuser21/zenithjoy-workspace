import test from 'node:test';
import assert from 'node:assert/strict';

test('caller true或序列化JSON不能成为collection phone authority能力',async()=>{
 const {collectionPhoneProofValid}=await import('../collection-phone-scope.mjs');
 for(const proof of [true,{verified:true},{protocol:'collection-phone-scope-v1',execution_stopped:true},JSON.parse('{"phone_authority_returned":true}')])assert.equal(collectionPhoneProofValid(proof),false);
});
