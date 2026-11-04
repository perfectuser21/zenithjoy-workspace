import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
async function smoke(t,file,handler,extra={}) {
  const dir=mkdtempSync(join(tmpdir(),'current-api-smoke-'));
  writeFileSync(join(dir,'psql'),'#!/bin/sh\ncase "$*" in *string_agg*) printf "%s\\n" "${FIXTURE_INVALIDATE_DB_STATE:-burner:needs_rebind,control:active,primary:active}";; *) printf "%s\\n" "'+id+'";; esac\n',{mode:0o755});
  const calls=[],server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;calls.push({method:req.method,url:req.url,body});const [status,data,headers={}]=handler(req,body,server.address().port);res.writeHead(status,{'content-type':'application/json',...headers});res.end(Buffer.isBuffer(data)?data:JSON.stringify(data));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.close();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  return await new Promise((resolve,reject)=>{
    const child=spawn('bash',['.github/workflows/scripts/smoke/'+file],{cwd:root,env:{...process.env,PATH:dir+':'+process.env.PATH,API_BASE:base,SMOKE_API_BASE:base,API_PORT:String(server.address().port),ZENITHJOY_INTERNAL_TOKEN:'fixture-internal',SMOKE_SCRATCH_API:'1',...extra}});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(output));},15000);
    child.on('close',status=>{clearTimeout(timer);resolve({status,output,calls});});
  });
}
function license(req,body) {
  if(req.method==='GET')return req.headers['x-feishu-user-id']?[200,{license:null}]:[401,{}];
  if(req.method==='POST')return req.headers['x-feishu-user-id']?.includes('admin')?[200,{license_key:'fixture-license'}]:[403,{}];
  return [200,{status:'revoked'}];
}
test('license issuance missing a usable id cannot skip revocation and pass',async t=>{
  const r=await smoke(t,'dashboard-license-smoke.sh',license);assert.notEqual(r.status,0,r.output);
});
test('onboarding must establish a session and cannot pass the unauthenticated branch alone',async t=>{
  const r=await smoke(t,'android-onboarding-smoke.sh',req=>req.url.includes('/auth/')?[503,{}]:[401,{code:'UNAUTHORIZED'}],{TEST_SESSION_COOKIE:''});assert.notEqual(r.status,0,r.output);
});
test('CRM view preferences rejects authentication failures rather than calling them functional',async t=>{
  const r=await smoke(t,'line04-crm-view-prefs-smoke.sh',()=>[401,{}]);assert.notEqual(r.status,0,r.output);
});
test('license positive flow requires the actual created id to be revoked',async t=>{
  const r=await smoke(t,'dashboard-license-smoke.sh',(req,body)=>{
    if(req.method==='POST'&&req.headers['x-feishu-user-id']?.includes('admin'))return [200,{success:true,data:{id,license_key:'fixture-key'}}];
    if(req.method==='DELETE')return [200,{success:true,data:{id,status:'revoked'}}];
    return license(req,body);
  });assert.equal(r.status,0,r.output);assert.ok(r.calls.some(c=>c.method==='DELETE'&&c.url.endsWith(id)));
});
for(const bad of ['wrong-revocation-id','empty-license-key'])test('license rejects '+bad,async t=>{
  const r=await smoke(t,'dashboard-license-smoke.sh',(req,body)=>{
    if(req.method==='POST'&&req.headers['x-feishu-user-id']?.includes('admin'))return [200,{success:true,data:{id,license_key:bad==='empty-license-key'?'':'fixture-key'}}];
    if(req.method==='DELETE')return [200,{success:true,data:{id:'wrong-id',status:'revoked'}}];
    return license(req,body);
  });assert.notEqual(r.status,0,r.output);
});
function onboarding(mode){return (req,body,port)=>{
  if(req.url.includes('/auth/sign-up'))return [200,{user:{id:'fixture-user'}},{'set-cookie':'session=fixture; Path=/'}];
  if(req.url.endsWith('.apk'))return [200,mode==='html'?Buffer.from('<html>login</html>'):Buffer.from([0x50,0x4b,3,4,0,0])];
  if(!req.headers.cookie)return [401,{code:'UNAUTHORIZED'}];
  if(mode==='auth-denied')return [401,{code:'UNAUTHORIZED'}];
  return [200,{apk_url:`http://127.0.0.1:${port}/install-pack/android/zenithjoy-agent.apk`,license_key:'',deeplink:'zenithjoy://bind?api=wss%3A%2F%2Ffixture.example%2Fagent-ws'}];
};}
test('onboarding creates its own session and validates downloaded APK bytes',async t=>{
  const r=await smoke(t,'android-onboarding-smoke.sh',onboarding('good'),{TEST_SESSION_COOKIE:''});assert.equal(r.status,0,r.output);assert.ok(r.calls.some(c=>c.url.includes('/sign-up/email')));assert.ok(r.calls.some(c=>c.url.endsWith('.apk')));
});
for(const mode of ['auth-denied','html'])test('onboarding rejects '+mode,async t=>{
  const r=await smoke(t,'android-onboarding-smoke.sh',onboarding(mode),{TEST_SESSION_COOKIE:''});assert.notEqual(r.status,0,r.output);
});
function preferences(mode){let prefs;return (req,body)=>{
  if(req.method==='GET'&&!req.url.includes('?'))return [400,{error:{code:'CS_WECHAT_ID_REQUIRED'}}];
  if(req.method==='PUT'){
    const data=JSON.parse(body);if(!data.prefs)return [400,{error:{code:'PREFS_REQUIRED'}}];
    if(mode==='auth-denied')return [403,{}];
    if(mode!=='lost-write')prefs=data.prefs;
    return [200,{success:true,data:null}];
  }
  return [200,{success:true,data:{prefs:prefs??null}}];
};}
test('CRM view preferences requires a successful write and exact readback',async t=>{
  const r=await smoke(t,'line04-crm-view-prefs-smoke.sh',preferences('good'));assert.equal(r.status,0,r.output);
});
for(const mode of ['auth-denied','lost-write'])test('CRM preferences rejects '+mode,async t=>{
  const r=await smoke(t,'line04-crm-view-prefs-smoke.sh',preferences(mode));assert.notEqual(r.status,0,r.output);
});
for(const file of ['dashboard-license-smoke.sh','android-onboarding-smoke.sh','line04-crm-view-prefs-smoke.sh','burner-session-health-smoke.sh']) {
  test(file+' requires explicit disposable CI authorization before HTTP',async t=>{
    const r=await smoke(t,file,()=>[500,{}],{SMOKE_SCRATCH_API:''});assert.notEqual(r.status,0,r.output);assert.equal(r.calls.length,0);
  });
  test(file+' rejects non-loopback API before HTTP',async t=>{
    const r=await smoke(t,file,()=>[500,{}],{API_BASE:'https://example.invalid',SMOKE_API_BASE:'https://example.invalid'});assert.notEqual(r.status,0,r.output);assert.equal(r.calls.length,0);
  });
}
function invalidate(req,body){return JSON.parse(body).agent_id?[200,{success:true,data:{invalidated:1,reason:'DOUYIN_SESSION_EXPIRED'}}]:[401,{error:{code:'NO_TENANT_FOR_AGENT_CONTEXT'}}];}
test('burner invalidation requires success and exact DB scope readback',async t=>{
  const r=await smoke(t,'burner-session-health-smoke.sh',invalidate);assert.equal(r.status,0,r.output);
});
test('burner invalidation cannot accept repeated unauthorized HTTP responses',async t=>{
  const r=await smoke(t,'burner-session-health-smoke.sh',()=>[401,{error:{code:'NO_TENANT_FOR_AGENT_CONTEXT'}}]);assert.notEqual(r.status,0,r.output);
});
test('burner invalidation cannot pass a lost write or changed primary/control',async t=>{
  const r=await smoke(t,'burner-session-health-smoke.sh',invalidate,{FIXTURE_INVALIDATE_DB_STATE:'burner:active,control:active,primary:active'});assert.notEqual(r.status,0,r.output);
});
function video(req){
  if(req.url.endsWith('/history'))return [200,{data:[],total:0}];
  if(req.url.endsWith('/active'))return [200,[]];
  if(req.url.endsWith('/upload'))return [400,{error:'video file is required'}];
  return [500,{error:{code:'TOAPI_ERROR'}}];
}
test('AI video smoke checks deterministic reads/upload without issuing paid generation',async t=>{
  const r=await smoke(t,'ai-video-smoke.sh',video);assert.equal(r.status,0,r.output);assert.ok(!r.calls.some(c=>c.url.includes('/generate')));
});
for(const mode of ['bad-history','upload-auth-denied'])test('AI video smoke rejects '+mode,async t=>{
  const r=await smoke(t,'ai-video-smoke.sh',req=>mode==='bad-history'&&req.url.endsWith('/history')?[200,{data:{},total:0}]:mode==='upload-auth-denied'&&req.url.endsWith('/upload')?[401,{}]:video(req));assert.notEqual(r.status,0,r.output);
});
