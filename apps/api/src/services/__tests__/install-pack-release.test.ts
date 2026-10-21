import {describe,it,expect,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publishCandidate,promoteCandidate,rollbackManifest,installPackContract} from '../install-pack-release';
const sha='b'.repeat(40), digest='a'.repeat(64);
const modules=['line01-publish','line02-lead-gen','line04-wechat-cs','line05-video'].map(line_id=>({line_id,filename:line_id+'-v1.0.0.tar.gz',sha256:digest,cos_url:`https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules/candidates/${sha}/${digest}/${line_id}-v1.0.0.tar.gz`}));
const bundle=createHash('sha256').update(JSON.stringify({source_sha:sha,sha256:digest,modules})).digest('hex');
const manifest={modules,bundle_sha256:bundle,version:'3.0.0',source_sha:sha,sha256:digest,size:123,build_time:'2026-10-21T00:00:00Z',
 download_url:'/download/pack.tar.gz',cos_url:`https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/candidates/${sha}/${digest}/pack.tar.gz`};
function acceptance(){const c=installPackContract();return {run:{id:'run-1',run_key:'package-verify',gp_id:'agent-install',status:'adjudicated',detail:{source_repo:'perfectuser21/zenithjoy-workspace',environment:'staging',release_targets:['install-pack'],source_sha:sha,observed_source_sha:sha,package_sha256:digest,observed_package_sha256:digest,bundle_sha256:bundle,observed_bundle_sha256:bundle,spec_sha:c.spec_sha,gate_verdict:'绿'}},checks:c.checks.map(c=>({...c,run_id:'run-1',result:'通过',note:'evidence://actual-package-install'}))};}
const dirs:string[]=[];
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'install-pack-release-'));dirs.push(root);return path.join(root,'manifest.json');}
afterEach(()=>dirs.splice(0).forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
const request={source_sha:sha,sha256:digest,acceptance_run_key:'package-verify',expected_current_manifest_sha256:null};
describe('安装包候选与正式分发',()=>{
 it('构建只保存不可变候选，正式manifest保持原字节',()=>{
  const file=fixture();fs.writeFileSync(file,'{"version":"old"}');publishCandidate(file,manifest);
  expect(fs.readFileSync(file,'utf8')).toBe('{"version":"old"}');
  expect(()=>publishCandidate(file,{...manifest,size:124})).toThrow(/immutable/);
 });
 it.each(['status','source','package','observed','check','missing'])('错误验收 %s 不写正式manifest',async kind=>{
  const file=fixture();publishCandidate(file,manifest);const r=acceptance();
  if(kind==='status')r.run.status='in_review';if(kind==='source')r.run.detail.source_sha='c'.repeat(40);
  if(kind==='package')r.run.detail.package_sha256='c'.repeat(64);if(kind==='observed')r.run.detail.observed_package_sha256='c'.repeat(64);
  if(kind==='check')r.checks[0].result='无法验证';if(kind==='missing')r.checks=[];
  await expect(promoteCandidate(file,request,async()=>r)).rejects.toThrow();expect(fs.existsSync(file)).toBe(false);
 });
 it('同包真实验收晋级，CAS冲突拒绝，回退仅恢复保存的原正式字节',async()=>{
  const file=fixture();const old={version:'2.0.0',sha256:'d'.repeat(64),download_url:'/download/old.tar.gz',size:2,build_time:'old'};
  fs.writeFileSync(file,JSON.stringify(old));publishCandidate(file,manifest);
  await expect(promoteCandidate(file,request,async()=>acceptance())).rejects.toThrow(/changed/);
  await promoteCandidate(file,{...request,expected_current_manifest_sha256:createHash('sha256').update(JSON.stringify(old)).digest('hex')},async()=>acceptance());
  expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(digest);
  expect(()=>rollbackManifest(file,{expected_current_manifest_sha256:'0'.repeat(64)})).toThrow(/changed/);
  rollbackManifest(file,{expected_current_manifest_sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  expect(fs.readFileSync(file,'utf8')).toBe(JSON.stringify(old));
 });
 it('同源码但不同产物不能覆盖候选，也不接受可覆盖的正式COS地址',()=>{
  const file=fixture();expect(()=>publishCandidate(file,{...manifest,cos_url:'https://example.com/pack.tar.gz'})).toThrow();
  expect(()=>publishCandidate(file,{...manifest,source_sha:'../main'})).toThrow();
 });
 it('core包相同但完整manifest已经切换，旧revision不能晋级或回退',async()=>{
  const file=fixture();publishCandidate(file,manifest);
  const old=JSON.stringify({sha256:digest,bundle_sha256:'1'.repeat(64)});fs.writeFileSync(file,old);
  const revision=createHash('sha256').update(old).digest('hex');
  const current=JSON.stringify({sha256:digest,bundle_sha256:'2'.repeat(64)});fs.writeFileSync(file,current);
  await expect(promoteCandidate(file,{...request,expected_current_manifest_sha256:revision},async()=>acceptance())).rejects.toThrow(/changed/);
  expect(()=>rollbackManifest(file,{expected_current_manifest_sha256:revision})).toThrow(/changed/);
  expect(fs.readFileSync(file,'utf8')).toBe(current);
 });

 it('候选写入中断不留下半个不可变文件，恢复后能重试',()=>{
  const file=fixture();const write=vi.spyOn(fs,'writeFileSync').mockImplementationOnce(()=>{throw Error('ENOSPC fixture');});
  expect(()=>publishCandidate(file,manifest)).toThrow(/ENOSPC/);write.mockRestore();
  expect(()=>publishCandidate(file,manifest)).not.toThrow();
 });

});
