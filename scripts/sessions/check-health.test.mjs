import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlatform, PLATFORMS } from './check-health.js';
const p=PLATFORMS.find(p=>p.secretEnv==='DOUYIN_COOKIES');
const cookies=JSON.stringify([{name:'sessionid',value:'synthetic',expires:Date.now()/1000+86400}]);
const failRequest=()=>{throw new Error('unexpected network request');};
const run=(raw,extra={})=>checkPlatform(p,{env:raw===undefined?{}:{DOUYIN_COOKIES:raw},skipHttpCheck:false,request:failRequest,...extra});
test('all platform/account definitions are distinct and return full five-field schemas without credentials',async()=>{
 assert.equal(PLATFORMS.length,35);assert.equal(new Set(PLATFORMS.map(p=>p.secretEnv)).size,35);
 for(const platform of PLATFORMS){const result=await checkPlatform(platform,{env:{},request:failRequest});assert.equal(result.status,'missing');assert.deepEqual(Object.keys(result).sort(),['checkedAt','expiresAt','platform','secretEnv','status']);assert.ok(Number.isFinite(Date.parse(result.checkedAt)));}
});
test('malformed storage, missing cookies and expired credentials fail before HTTP',async()=>{
 assert.equal((await run('{invalid')).status,'invalid');assert.equal((await run('{}')).status,'invalid');assert.equal((await run('[]')).status,'expired');
 assert.equal((await run(JSON.stringify([{name:'sessionid',value:'synthetic',expires:1}]))).status,'expired');
});
test('offline cookie inspection cannot assert platform health',async()=>{
 const r=await run(cookies,{skipHttpCheck:true});assert.equal(r.status,'unknown');assert.ok(r.expiresAt);
});
test('real decision logic distinguishes valid, unauthorized, login redirect, malformed 200 and unavailable transport',async()=>{
 for(const [response,status] of [[{status:200,body:'{"status_code":0}'},'ok'],[{status:401,body:''},'expired'],[{status:403,body:''},'expired'],[{status:302,body:'',headers:{location:'/passport/login'}},'expired'],[{status:0,body:''},'unknown'],[{status:200,body:'<html>not logged in</html>'},'unknown']]){
  let calls=0;const r=await run(cookies,{request:async(url,cookie)=>{calls++;assert.equal(url,p.healthUrl);assert.equal(cookie,'sessionid=synthetic');return response;}});assert.equal(r.status,status);assert.equal(calls,1);
 }
});

test('Weibo/Zhihu main and subaccounts share the known error-envelope rejection', async () => {
 const accounts=PLATFORMS.filter(p=>/^(WEIBO|ZHIHU)_(COOKIES|SUB_[123])$/.test(p.secretEnv));
 assert.equal(accounts.length,8);
 for(const platform of accounts){
  for(const body of ['{"error":{"message":"failed"},"id":"fixture"}', '<html>login required</html>']){
   let calls=0;
   const result=await checkPlatform(platform,{env:{[platform.secretEnv]:JSON.stringify([{name:platform.keyCookies[0],value:'synthetic'}])},skipHttpCheck:false,
    request:async(url,cookie)=>{calls++;assert.equal(url,platform.healthUrl);assert.equal(cookie,platform.keyCookies[0]+'=synthetic');return {status:200,body};}});
   assert.equal(result.status,'unknown',platform.secretEnv+': '+body);assert.equal(calls,1);
  }
 }
});
