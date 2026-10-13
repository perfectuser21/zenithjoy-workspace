import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {outreachRequest:queueRequest}=require('../leadgen-outreach-orders.js');
test('104队列领单缺真实sender/profile时在任何SQL前拒绝',async()=>{
 let queries=0;const pool={query:async()=>{queries++;throw Error('SQL不该执行');},connect:async()=>{queries++;throw Error('SQL不该执行');}};
 await assert.rejects(queueRequest({op:'claim_outreach',line:'jinuo',run:'fake104',limit:1},{sourceCommit:'f'.repeat(40),client:pool}),/触达.*账号|触达.*profile/);
 assert.equal(queries,0);
});
test('104直接RPC写回缺本轮原始收件人正文hash证明时不允许落发送成功',async()=>{
 let queries=0;const pool={query:async()=>{queries++;throw Error('SQL不该执行');},connect:async()=>{queries++;throw Error('SQL不该执行');}};
 await assert.rejects(queueRequest({op:'write_outreach',line:'jinuo',run:'fake104',id:'recFAKEONLY123',receipt:{outcome:'sent'}},{sourceCommit:'f'.repeat(40),client:pool}),/触达.*证明/);
 assert.equal(queries,0);
});
test('原Feishu悬空回收不得重排104永久prepared；大小写别名视同一收件人',()=>{
 const lib=require('../next-outreach-lib.js');
 const prepared={last_modified_time:1,fields:{'状态':'触达中','抖音号':'ABC123','回复结果':'[104 prepared:fake104:'+'f'.repeat(40)+']'}};
 assert.equal(lib.isStaleInflight(prepared,10000000,1000),false);
 assert.equal(lib.recipientReserved([prepared],'abc123'),true);
});
