import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readBrain} from '../device-epoch-fence-review.mjs';

const path='/api/brain/tasks/11111111-1111-4111-8111-111111111111';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(t){
 const original={fetch:globalThis.fetch,token:process.env.BRAIN_INTERNAL_TOKEN,timeout:AbortSignal.timeout,now:Date.now};
 process.env.BRAIN_INTERNAL_TOKEN='fixture-epoch-read';
 t.after(()=>{globalThis.fetch=original.fetch;AbortSignal.timeout=original.timeout;Date.now=original.now;if(original.token===undefined)delete process.env.BRAIN_INTERNAL_TOKEN;else process.env.BRAIN_INTERNAL_TOKEN=original.token;});
 return original;
}
function socket(){return Object.assign(new TypeError('private transport detail'),{cause:{code:'UND_ERR_SOCKET'}});}

test('同一授权GET真实悬挂10秒后在原Activity绝对截止内仅重读一次',{timeout:20000},async t=>{
 const original=fixture(t),requests=[];
 const server=createServer((req,res)=>{
  requests.push({method:req.method,path:req.url,token:req.headers['x-internal-token']});
  if(requests.length===1)return;
  res.writeHead(200,{'Content-Type':'application/json'});res.end('{"task":{"id":"original-task"}}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 globalThis.fetch=(url,options)=>{const u=new URL(url);assert.equal(u.origin,'http://127.0.0.1:5221');u.port=String(server.address().port);return original.fetch(u,options);};
 const deadlineMs=Date.now()+18000;
 assert.deepEqual(await readBrain(path,{deadlineMs,maxAttempts:2}),{task:{id:'original-task'}});
 assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].method,'GET');assert.ok(Date.now()<deadlineMs);
});

test('重读只使用原截止剩余额度且原预算对象不变',async t=>{
 fixture(t);let now=100000,calls=0;Date.now=()=>now;const timeouts=[];
 AbortSignal.timeout=ms=>{timeouts.push(ms);return new AbortController().signal;};
 globalThis.fetch=async()=>{calls++;if(calls===1){now+=10000;throw socket();}return json({ok:true});};
 const budget=Object.freeze({deadlineMs:115000,maxAttempts:2});
 assert.deepEqual(await readBrain(path,budget),{ok:true});assert.deepEqual(timeouts,[10000,5000]);assert.deepEqual(budget,{deadlineMs:115000,maxAttempts:2});
});

test('原截止耗尽不启动第二次GET',async t=>{
 fixture(t);let now=100000,calls=0;Date.now=()=>now;
 globalThis.fetch=async()=>{calls++;now=110000;throw socket();};
 await assert.rejects(()=>readBrain(path,{deadlineMs:110000,maxAttempts:2}));assert.equal(calls,1);
});

test('两次允许的socket失败仍拒绝且不出现第三次GET',async t=>{
 fixture(t);let calls=0;globalThis.fetch=async()=>{calls++;throw socket();};
 await assert.rejects(()=>readBrain(path,{deadlineMs:Date.now()+30000,maxAttempts:2}));assert.equal(calls,2);
});

for(const [name,response] of [
 ['403',()=>new Response('{}',{status:403,headers:{'Content-Type':'application/json'}})],
 ['非JSON内容类型',()=>new Response('{}',{headers:{'Content-Type':'text/plain'}})],
 ['非法JSON',()=>new Response('private malformed body',{headers:{'Content-Type':'application/json'}})],
 ['超限body',()=>new Response('x'.repeat(8*1024*1024+1),{headers:{'Content-Type':'application/json'}})],
 ['body阶段socket',()=>({status:200,headers:new Headers({'Content-Type':'application/json'}),text:async()=>{throw socket();}})],
 ['外来TimeoutError',()=>{throw new DOMException('foreign timer','TimeoutError');}],
 ['调用方取消',()=>{throw new DOMException('caller cancelled','AbortError');}],
 ])test(name+'不得通过后续200重读变成功',async t=>{
 fixture(t);let calls=0;globalThis.fetch=async()=>{calls++;return calls===1?response():json({incorrect:true});};
 await assert.rejects(()=>readBrain(path,{deadlineMs:Date.now()+30000,maxAttempts:2}));assert.equal(calls,1);
});

for(const budget of [{deadlineMs:'9999999999999',maxAttempts:2},{maxAttempts:2},{deadlineMs:Date.now()+30000,maxAttempts:3},{deadlineMs:0,maxAttempts:2}])test('无效或过期预算在GET之前拒绝 '+JSON.stringify(budget),async t=>{
 fixture(t);let calls=0;globalThis.fetch=async()=>{calls++;return json({incorrect:true});};
 await assert.rejects(()=>readBrain(path,budget));assert.equal(calls,0);
});

test('默认verify-epoch读取仍只有一次GET和原10秒计时器',async t=>{
 fixture(t);let calls=0;const timeouts=[];
 AbortSignal.timeout=ms=>{timeouts.push(ms);return new AbortController().signal;};
 globalThis.fetch=async()=>{calls++;throw socket();};
 await assert.rejects(()=>readBrain(path));assert.equal(calls,1);assert.deepEqual(timeouts,[10000]);
});

test('原截止后的迟到200不能变成授权成功',async t=>{
 fixture(t);let now=100000,calls=0;Date.now=()=>now;
 globalThis.fetch=async()=>{calls++;now=110000;return json({incorrect:true});};
 await assert.rejects(()=>readBrain(path,{deadlineMs:110000,maxAttempts:2}),e=>e.epoch_diagnostic.failure==='timeout');assert.equal(calls,1);
});
