import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {queueRequest}=require('../leadgen-queue.js');
test('104队列领单缺真实sender/profile时在任何SQL前拒绝',async()=>{
 let queries=0;const pool={query:async()=>{queries++;throw Error('SQL不该执行');},connect:async()=>{queries++;throw Error('SQL不该执行');}};
 await assert.rejects(queueRequest(pool,{op:'claim_outreach',line:'jinuo',run:'fake104',limit:1}),/触达.*账号|触达.*profile/);
 assert.equal(queries,0);
});
test('104直接RPC写回缺本轮原始收件人正文hash证明时不允许落发送成功',async()=>{
 let queries=0;const pool={query:async()=>{queries++;throw Error('SQL不该执行');},connect:async()=>{queries++;throw Error('SQL不该执行');}};
 await assert.rejects(queueRequest(pool,{op:'write_outreach',line:'jinuo',run:'fake104',id:'e92b90f1-19d1-4121-a434-96e0ee46a493',receipt:{outcome:'sent'}}),/触达.*证明/);
 assert.equal(queries,0);
});
