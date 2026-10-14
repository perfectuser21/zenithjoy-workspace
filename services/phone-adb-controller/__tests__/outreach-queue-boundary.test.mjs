import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);const {outreachRequest:queueRequest}=require('../leadgen-outreach-orders.js');
test('104队列领单缺真实sender/profile时在任何SQL前拒绝',async()=>{
 let queries=0;const pool={query:async()=>{queries++;throw Error('SQL不该执行');},connect:async()=>{queries++;throw Error('SQL不该执行');}};
 await assert.rejects(queueRequest({op:'claim_outreach',line:'jinuo',run:'fake104',limit:1},{sourceCommit:'f'.repeat(40),client:pool}),/触达.*账号|触达.*profile/);
 assert.equal(queries,0);
});
function fakeOriginalOrders(){
 const source='f'.repeat(40),directory=mkdtempSync(join(tmpdir(),'fake-order-lock-'));
 const orders=require('../leadgen-outreach-orders.js');
 const rows=['ABC123','abc123'].map((id,i)=>({record_id:'recFAKEONLY12'+i,fields:{'状态':'待触达','发送状态':'未发送','抖音号':id,'主页链接':'https://v.douyin.com/FAKEONLY/','AI判断理由':'[A]','抖音昵称':'fake'+i}}));
 const client={all:async()=>structuredClone(rows),get:async id=>structuredClone(rows.find(r=>r.record_id===id)),put:async(id,fields)=>{Object.assign(rows.find(r=>r.record_id===id).fields,fields);}};
 const message='明确fake审批正文',digest=createHash('sha256').update(message).digest('hex');
 const deps={sourceCommit:source,client,eligibleOrders:async(_route,rows)=>rows.map(r=>r.record_id),policy:async()=>({template:{id:'fake-B',version:'B',message,message_sha256:digest}}),lock:(line,fn)=>orders.withOrderLock(line,fn,{directory})};
 const input={line:'jinuo',run:'fake104',profile:'jinoshengyuan-work',sender_douyin_id:'langzi63485',limit:1};
 return {rows,deps,input,source,digest,clean:()=>rmSync(directory,{recursive:true,force:true})};
}
test('真实原订单adapter同recipient两个大小写别名、两个run竞争仅领一单',async()=>{
 const f=fakeOriginalOrders();try{
 const raced=await Promise.allSettled([queueRequest({...f.input,op:'claim_outreach'},f.deps),queueRequest({...f.input,run:'fakeOther',op:'claim_outreach'},f.deps)]);
 assert.equal(raced.filter(r=>r.status==='fulfilled').flatMap(r=>r.value).length,1);
 for(const r of raced.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/领单锁忙/);
 const b=await queueRequest({...f.input,run:'fakeOther',op:'claim_outreach'},f.deps);assert.equal(b.length,0);
 assert.equal(f.rows.filter(r=>r.fields['状态']==='触达中').length,1);
 }finally{f.clean();}
});
test('原Feishu永久预留提交但回复丢失，重启/cleanup不能重新获得发送许可',async()=>{
 const f=fakeOriginalOrders();try{
 const [order]=await queueRequest({...f.input,op:'claim_outreach'},f.deps);
 const input={...f.input,id:order.id,op:'prepare_outreach',script_id:'fake-B',script_version:'B',message_sha256:f.digest,target_douyin_id:order.douyin_id,profile_url:order.profile_url};
 const put=f.deps.client.put;f.deps.client.put=async(id,fields)=>{await put(id,fields);if(fields['回复结果']?.startsWith('[104 prepared:'))throw Error('fake commit reply lost');};
 await assert.rejects(queueRequest(input,f.deps),/reply lost/);f.deps.client.put=put;
 await assert.rejects(queueRequest(input,f.deps),/首次发送许可证/);
 assert.equal((await queueRequest({...f.input,id:order.id,op:'release_outreach'},f.deps)).released,0);
 assert.match(f.rows[0].fields['回复结果'],/^\[104 prepared:/);
 }finally{f.clean();}
});
test('原订单claim之后收件人/链接改变，prepare必须拒绝并且不给phone许可',async()=>{
 const f=fakeOriginalOrders();try{const [order]=await queueRequest({...f.input,op:'claim_outreach'},f.deps);
 f.rows[0].fields['抖音号']='EVIL999';
 await assert.rejects(queueRequest({...f.input,id:order.id,op:'prepare_outreach',script_id:'fake-B',script_version:'B',message_sha256:f.digest,target_douyin_id:order.douyin_id,profile_url:order.profile_url},f.deps),/订单.*变化|身份/);
 }finally{f.clean();}
});
test('原订单prepare PUT后正文变更，必须保永久挂起而非给发送许可',async()=>{
 const f=fakeOriginalOrders();try{const [order]=await queueRequest({...f.input,op:'claim_outreach'},f.deps),put=f.deps.client.put;
 f.deps.client.put=async(id,fields)=>{await put(id,fields);if(fields['回复结果']?.startsWith('[104 prepared:'))f.rows[0].fields['话术内容']='被并发改写';};
 await assert.rejects(queueRequest({...f.input,id:order.id,op:'prepare_outreach',script_id:'fake-B',script_version:'B',message_sha256:f.digest,target_douyin_id:order.douyin_id,profile_url:order.profile_url},f.deps),/预留.*未知|读回/);
 assert.match(f.rows[0].fields['回复结果'],/^\[104 prepared:/);
 }finally{f.clean();}
});
test('已restricted或rate_limited的104原订单终态仍永久防大小写别名再次发送',()=>{
 const lib=require('../next-outreach-lib.js');
 for(const outcome of ['restricted','rate_limited'])assert.equal(lib.recipientReserved([{fields:{'状态':'触达受阻','抖音号':'ABC123','回复结果':`[104 ${outcome}:fake104:${'f'.repeat(40)}]`}}],'abc123'),true);
});
test('两个选单入口共享一次构建的normalized reserved Set，避免逐候选重扫全表',()=>{
 const lib=require('../next-outreach-lib.js');
 const result=lib.reservedRecipientSet([{fields:{'状态':'已触达','抖音号':'ABC123'}},{fields:{'状态':'触达中','抖音号':'abc123'}},{fields:{'状态':'待触达','抖音号':'READY999'}}]);
 assert.ok(result instanceof Set);assert.deepEqual([...result],['abc123']);
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
