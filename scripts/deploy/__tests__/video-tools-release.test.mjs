import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, chmodSync, readFileSync, lstatSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createPlan, validateReadback, writePrepared, mergeImage, inheritPrepared} from '../video-tools-release.mjs';

const sha='a'.repeat(40), image='sha256:'+'b'.repeat(64);
function roster(){return {schema_version:1,source_commit:sha,origin:'https://zenithjoy.tech',
  providers:{DASHSCOPE_API_KEY:'wan-secret',ALIYUN_ACCESS_KEY_ID:'ali-id',ALIYUN_ACCESS_KEY_SECRET:'ali-secret'},
  users:[{id:'staff-one',email:'one@example.com',token:'a'.repeat(40)},{id:'staff-two',email:'two@example.com',token:'b'.repeat(40)}]};}
test('每人独立网络、实例、卷和token；API overlay绑定用户身份',()=>{
  const p=createPlan(roster(),{sha,image});
  const services=Object.values(p.compose.services);
  assert.equal(services.length,2);
  assert.equal(new Set(services.map(s=>s.volumes[0])).size,2);
  assert.equal(new Set(services.map(s=>s.networks[0])).size,2);
  assert.equal(new Set(services.map(s=>s.environment.ZENITHJOY_CANVAS_TOKEN)).size,2);
  assert.ok(services.every(s=>s.image===image && !s.ports && s.read_only && s.mem_limit==='1g'));
  assert.ok(services.every(s=>s.environment.ZENITHJOY_CANVAS_API==='http://zenithjoy-api-prod:5200'));
  const api=p.apiOverlay.services['zenithjoy-api-prod'];
  assert.deepEqual(Object.keys(JSON.parse(api.environment.CREATIVE_CANVAS_INSTANCES)).sort(),['staff-one','staff-two']);
  assert.ok(api.networks.includes('zenithjoy-net'));
  assert.equal(api.environment.DASHSCOPE_API_KEY,'wan-secret');
});
test('缺生产provider凭据、重复用户/token或未知来源不能生成就绪配置',()=>{
  for(const mutate of [r=>delete r.providers.DASHSCOPE_API_KEY,r=>r.users[1].token=r.users[0].token,r=>r.users[1].id=r.users[0].id,r=>r.source_commit='c'.repeat(40),r=>r.origin='http://zenithjoy.tech']){
    const r=roster();mutate(r);assert.throws(()=>createPlan(r,{sha,image}));
  }
  assert.throws(()=>createPlan(roster(),{sha,image:'canvas:latest'}));
});
test('独立读回拒绝共享网络、错误镜像、身份或缺失健康检查',()=>{
  const p=createPlan(roster(),{sha,image});
  const containers=Object.values(p.compose.services).map(s=>({name:s.container_name,image,healthy:true,ports:[],networks:s.networks,volume:s.volumes[0].split(':')[0],token:s.environment.ZENITHJOY_CANVAS_TOKEN,api:s.environment.ZENITHJOY_CANVAS_API}));
  const api={environment:p.apiOverlay.services['zenithjoy-api-prod'].environment,networks:p.apiOverlay.services['zenithjoy-api-prod'].networks};
  assert.equal(validateReadback(p,{containers,api}).verified,true);
  for(const mutate of [d=>d.containers[0].healthy=false,d=>d.containers[0].image='wrong',d=>d.containers[0].networks.push(d.containers[1].networks[0]),d=>d.containers[0].token='wrong',d=>d.api.environment.CREATIVE_CANVAS_INSTANCES='{}']){
    const d=structuredClone({containers,api});mutate(d);assert.throws(()=>validateReadback(p,d));
  }
});
test('prepare只写固定版本私有工件，不覆盖旧配置或接触现役.env',t=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'video-release-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const r=join(dir,'roster.json');writeFileSync(r,JSON.stringify(roster()),{mode:0o600});
  const p=createPlan(roster(),{sha,image});writePrepared(dir,r,p);
  assert.equal(lstatSync(join(dir,sha,'video-tools.json')).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,sha,'video-tools.json'),'utf8')),p.apiOverlay);
  const different=createPlan({...roster(),providers:{...roster().providers,DASHSCOPE_API_KEY:'different'}},{sha,image});
  assert.throws(()=>writePrepared(dir,r,different));
  chmodSync(r,0o644);assert.throws(()=>writePrepared(dir,r,p));
});
test('staging精确测试员工保留旧staff/实例/token，隔离数据且不能带进生产',()=>{
  const r={...roster(),environment:'staging',origin:'https://staging-autopilot.zenjoymedia.media'};
  const base={environment:{STAFF_EMAILS:'old@example.com',CREATIVE_CANVAS_INSTANCES:JSON.stringify({old:'http://old-private:8188'}),CREATIVE_CANVAS_SERVICE_TOKENS:JSON.stringify({old:'z'.repeat(40)})},networks:['zenithjoy-net','old-canvas-private']};
  const p=createPlan(r,{sha,image,base}),e=p.apiOverlay.services['zenithjoy-api-staging'].environment;
  assert.equal(JSON.parse(e.CREATIVE_CANVAS_INSTANCES).old,'http://old-private:8188');
  assert.equal(JSON.parse(e.CREATIVE_CANVAS_SERVICE_TOKENS).old,'z'.repeat(40));
  assert.equal(e.STAFF_EMAILS,'old@example.com,one@example.com,two@example.com');
  assert.ok(Object.values(p.compose.services).every(s=>s.environment.ZENITHJOY_CANVAS_API==='http://zenithjoy-api-staging:5200'&&s.volumes[0].startsWith('zj-canvas-stage-user-')));
  assert.throws(()=>createPlan(roster(),{sha,image,base}));
});
test('staging固定overlay绑定已加载镜像，改plan后无法合并',t=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'video-stage-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const r={...roster(),environment:'staging'},path=join(dir,'roster.json');writeFileSync(path,JSON.stringify(r),{mode:0o600});
  const p=createPlan(r,{sha,image});writePrepared(dir,path,p);mergeImage(dir,sha,image,'zenithjoy-api-staging');
  const out=JSON.parse(readFileSync(join(dir,sha,'image.json')));assert.equal(out.services['zenithjoy-api-staging'].image,image);
  writeFileSync(join(dir,sha,'canvas-plan.json'),JSON.stringify({...p,image:'changed'}));
  assert.throws(()=>mergeImage(dir,sha,image,'zenithjoy-api-staging'));
});
test('staging同身份升级要求独立验证的停止交接，复用本人卷并保留旁人',()=>{
  const r={...roster(),environment:'staging'},first=createPlan(r,{sha,image});
  const e=first.apiOverlay.services['zenithjoy-api-staging'].environment;
  const base={environment:e,networks:first.apiOverlay.services['zenithjoy-api-staging'].networks};
  const next='c'.repeat(40),r2={...r,source_commit:next};
  assert.throws(()=>createPlan(r2,{sha:next,image,base}),/maintenance handoff/);
  const instances=JSON.parse(e.CREATIVE_CANVAS_INSTANCES),tokens=JSON.parse(e.CREATIVE_CANVAS_SERVICE_TOKENS);
  base.stopped_handoffs=Object.fromEntries(r.users.map(u=>[u.id,{instance:instances[u.id],token:tokens[u.id]}]));
  const second=createPlan(r2,{sha:next,image,base});
  assert.deepEqual(Object.keys(first.compose.volumes),Object.keys(second.compose.volumes));
  assert.notDeepEqual(Object.keys(first.compose.services),Object.keys(second.compose.services));
});
test('普通生产API新版本冻结继承已激活能力，回退原overlay不变',t=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'video-inherit-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'roster.json');writeFileSync(path,JSON.stringify(roster()),{mode:0o600});
  const plan=createPlan(roster(),{sha,image});writePrepared(dir,path,plan);
  const overlay=readFileSync(join(dir,sha,'video-tools.json'),'utf8'),meta=JSON.parse(readFileSync(join(dir,sha,'video-tools-prepared.json')));
  writeFileSync(join(dir,sha,'release.json'),JSON.stringify({sha,verified:true,video_tools_sha256:meta.overlay_sha256}),{mode:0o600});
  const next='c'.repeat(40);inheritPrepared(dir,sha,next);
  assert.equal(readFileSync(join(dir,next,'video-tools.json'),'utf8'),overlay);
  const inherited=JSON.parse(readFileSync(join(dir,next,'video-tools-prepared.json')));
  assert.equal(inherited.api_source_commit,next);assert.equal(inherited.source_commit,sha);
  assert.equal(readFileSync(join(dir,sha,'video-tools.json'),'utf8'),overlay);
  assert.throws(()=>inheritPrepared(dir,sha,sha));
});
test('真实AI验收身份仅进入staging前端名单，生产名单不扩展',()=>{
  const stage=readFileSync('.github/workflows/deploy-dashboard-staging.yml','utf8');
  const prod=readFileSync('.github/workflows/promote-dashboard-prod.yml','utf8');
  assert.ok(stage.includes('VITE_STAFF_EMAILS:')&&stage.includes('ai-acceptance@zenithjoy.test'));
  assert.ok(!prod.includes('ai-acceptance@zenithjoy.test'));
  // Match the release job's pinned PyYAML parser; that job intentionally does
  // not install the application npm workspaces.
  const workflow=JSON.parse(execFileSync('python3',['-c','import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',
    '.github/workflows/promote-prod-hk.yml'],{encoding:'utf8'}));
  assert.deepEqual(workflow.jobs['promote-prod-hk'].needs,['admission']);
  assert.ok(workflow.jobs['promote-prod-hk'].steps.some(s=>s.if==='inputs.video_tools'&&s.run.includes('hk-canvas-production.sh')));
});
