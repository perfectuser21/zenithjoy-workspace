import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRpc,RPC_FILES} from '../leadgen-client.mjs';
test('候选跨机RPC只读同SHA候选目录，不能落到正式安装',async()=>{
 const frozen={deployment:{source_commit:'a'.repeat(40),environment:'staging:'+('a'.repeat(40))},files:Object.fromEntries(RPC_FILES.map(p=>['runtime/'+p,'b'.repeat(64)]))};
 let call;const rpc=createRpc({frozen,execute:async(...args)=>{call=args;return {code:0,stdout:'{"ok":true}',stderr:''};}});
 await rpc({kind:'verify'});
 assert.match(call[1].at(-1),/phone-candidates\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/runtime/);
 assert.doesNotMatch(call[1].at(-1),/cd ~\/\.openclaw\/leadgen-scripts/);
});
test('非法候选SHA不能拼进SSH命令',()=>{
 assert.throws(()=>createRpc({frozen:{deployment:{source_commit:'$(touch bad)',environment:'staging:'+('a'.repeat(40))},files:Object.fromEntries(RPC_FILES.map(p=>['runtime/'+p,'b'.repeat(64)]))}}));
});
test('未知环境或环境SHA错配不允许回落正式RPC',()=>{
 for(const environment of ['staging','unknown','staging:'+'b'.repeat(40)]){
  assert.throws(()=>createRpc({frozen:{deployment:{source_commit:'a'.repeat(40),environment},files:Object.fromEntries(RPC_FILES.map(p=>['runtime/'+p,'b'.repeat(64)]))}}));
 }
});
