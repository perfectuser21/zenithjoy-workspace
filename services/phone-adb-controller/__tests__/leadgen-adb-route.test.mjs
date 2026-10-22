import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';

// 外部边界只模拟既有路由探测和手机；真实 preflight 负责顺序、客户端和环境传播。
function setup(t,{route='5042\n',routeError='',managed=false}={}) {
 const dir=mkdtempSync(join(tmpdir(),'leadgen-adb-preflight-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const registry=join(dir,'accounts');writeFileSync(registry,'legacy\t44997267357\n');
 const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'route-test',WFR_RUN_ID:'discovery-route-test',WFR_ATTEMPT:'1',P:'legacy',SERIAL:'ANGYVB4402004137',LEADGEN_LINE:'jinuo',DOUYIN_ACCOUNT_REGISTRY:registry,DOUYIN_PHONE_ADB:'/fixture/phone',DOUYIN_PYTHON_BIN:'python3',DOUYIN_ADB_BIN:'/fixture/adb',ANDROID_ADB_SERVER_PORT:'5037',ANDROID_ADB_SERVER_ADDRESS:'obsolete'};
 if(managed)env.ZJ_ADB_HOST_CONFIG=join(dir,'host-policy.json');
 const calls=[];let selected=false;
 const expectedClient=managed?join(dir,'adb-managed-client.py'):'/fixture/adb';
 const execute=async(command,args,options)=>{
  calls.push({command,args,env:{...options.env}});
  if(args[0]===join(dir,'adb-existing-route.py')){
   assert.equal(command,'python3');assert.deepEqual(args.slice(1),[env.SERIAL,expectedClient]);
   selected=true;return {code:routeError?2:0,stdout:route,stderr:routeError};
  }
  assert.ok(selected,'第一个原生设备命令之前必须核验既有路由');
  assert.equal(options.env.ADB_SERVER_SOCKET,'tcp:127.0.0.1:5042');
  assert.equal(options.env.DOUYIN_ADB_PORT,'5042');
  assert.equal(options.env.ANDROID_ADB_SERVER_PORT,undefined);
  assert.equal(options.env.ANDROID_ADB_SERVER_ADDRESS,undefined);
  let stdout='';
  if(command==='/fixture/phone'){
   const op=args[2]==='--lock-owner'?args[4]:args[2];
   stdout={preflight:'serial='+env.SERIAL+'\n','lock-acquire':'lock=acquired\n','lock-refresh':'lock=refreshed\n','account-current':'douyin_id=44997267357\n'}[op]||'';
  }else if(command!=='/bin/sleep'){
   assert.equal(command,expectedClient);stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  }
  return {code:0,stdout,stderr:''};
 };
 return {h:createHandlers({root:dir,env,execute,rpc:async()=>{throw Error('本测试不得RPC');}}),calls,env};
}
for(const managed of [false,true])test(`预检在首个adb前选既有5042并贯穿后续命令（managed=${managed}）`,async t=>{
 const {h,calls}=setup(t,{managed});const result=await h.preflight();assert.equal(result.device_verified,true);assert.equal(result.account_verified,true);
 assert.ok(calls.filter(c=>c.args.includes('get-state')).length===1);assert.ok(calls.some(c=>c.args.includes('KEYCODE_WAKEUP')));
});
for(const failure of ['ADB_ROUTE_TARGET_AMBIGUOUS','ADB_ROUTE_CONFIGURED_TARGET_MISMATCH','ADB_ROUTE_TARGET_OFFLINE','ADB_HOST_FORBIDDEN_SERVER','ADB_ROUTE_PROTOCOL_MISMATCH'])test(`既有route失败${failure}时零设备动作`,async t=>{
 const {h,calls}=setup(t,{routeError:failure});await assert.rejects(h.preflight(),new RegExp(failure));assert.equal(calls.length,1);
});
for(const route of ['','5042\n5037\n','65536\n','0\n','5042x\n'])test(`探测输出${JSON.stringify(route)}不合法时零设备动作`,async t=>{
 const {h,calls}=setup(t,{route});await assert.rejects(h.preflight(),/ADB_ROUTE_OUTPUT_INVALID/);assert.equal(calls.length,1);
});
