import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {usingPhoneQueue} from './fixtures/native-phone-queue-fixture.mjs';
const {Pool}=createRequire(import.meta.url)('pg');
test('actual idle PG error after seal is owned while pool end is held; it never fabricates a stop',async t=>{
 await usingPhoneQueue(t,async f=>{const api=await f.load('native-phone-queue.mjs');let activeSlot,arrived,ownedErrors=0;const closing=new Promise(r=>arrived=r),originalConnect=Pool.prototype.connect;
  t.mock.method(Pool.prototype,'connect',function(...args){if(activeSlot){activeSlot.actual=this;for(const[event,handler]of activeSlot.listeners)this.on(event,error=>{ownedErrors++;handler(error);});}return originalConnect.apply(this,args);});
  const createPool=async options=>{const a=await f.createPool(options),connect=a.pool.connect.bind(a.pool),end=a.pool.end.bind(a.pool),slot={listeners:[],actual:null};return {...a,pool:{...a.pool,on(event,handler){if(slot.actual)slot.actual.on(event,error=>{ownedErrors++;handler(error);});else slot.listeners.push([event,handler]);},async connect(){activeSlot=slot;try{return await connect();}finally{activeSlot=null;}},end(){arrived();return end();}}};};
  const runtime=api.createNativePhoneQueue({...f,createPool,directory:f.makeDirectory('idle-error'),assertAuthority:f.authority()});let work;
  try{await runtime.prepare();await runtime.begin(f.scope);f.holdClose();work=runtime.queue('discover',{video:f.video});const rejected=assert.rejects(work,/UNKNOWN|CLOSED|DEADLINE/);await closing;runtime.seal();await new Promise(r=>setTimeout(r,40));assert.equal(ownedErrors,1,'the actual PG Pool error must reach its Code owner');assert.ok(runtime.snapshot().pending>0);assert.equal(runtime.snapshot().execution_unknown,true);f.releaseClose();await rejected;await runtime.close();assert.equal(runtime.snapshot().execution_stopped,false);}finally{f.releaseClose();await work?.catch(()=>{});await runtime.close();t.mock.restoreAll();}
 });
});
