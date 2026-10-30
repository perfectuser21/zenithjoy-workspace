import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function setup(t) {
  const root=mkdtempSync(join(tmpdir(),'zj-dashboard-stage-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const base=join(root,'base'), bin=join(root,'bin'), bundle=join(root,'bundle');
  for(const x of [base,bin,join(base,'dist'),join(bundle,'dist')]) mkdirSync(x,{recursive:true});
  writeFileSync(join(base,'nginx.conf'),'legacy nginx config\n');
  writeFileSync(join(base,'dist/index.html'),'old page'); mkdirSync(join(base,'dist/assets')); writeFileSync(join(base,'dist/assets/old-hash.js'),'old javascript'); mkdirSync(join(bundle,'dist/assets')); writeFileSync(join(bundle,'dist/assets/new-hash.js'),'new javascript');
  const fake=`#!${process.execPath} --
const fs=require('fs'),p=require('path'),args=process.argv.slice(2),name=p.basename(process.argv[1]);
if(name==='df'){console.log('Filesystem 1024-blocks Used Available Capacity Mounted');console.log('fixture 99999999 1 '+(process.env.FAKE_FREE_KB||'9999999')+' 1% /');process.exit(0)}
if(name==='mv'){const a=args.filter(x=>x!=='-Tf');fs.renameSync(a[0],a[1]);process.exit(0)}
if(name==='docker'){if(args[0]==='inspect'){console.log('true');process.exit(0)}if(args.includes('-t')&&fs.readFileSync(p.join(process.env.ZJ_DASHBOARD_BASE,'nginx.conf'),'utf8').includes('invalid_directive'))process.exit(1);const marker=p.join(process.env.ZJ_DASHBOARD_BASE,'signal-sent');if(args.includes('reload')&&process.env.TEST_SIGNAL&&!fs.existsSync(marker)){fs.writeFileSync(marker,'sent');process.kill(process.ppid,process.env.TEST_SIGNAL)}process.exit(0)}
if(name==='curl'){let link='c'.repeat(40);try{link=fs.readlinkSync(p.join(process.env.ZJ_DASHBOARD_BASE,'dist/_releases/current'))}catch{}const url=args.at(-1);if(url.endsWith('/api/creative-canvas/status'))process.stdout.write(process.env.FAIL_PROXY?'502':'401');else if(url==='http://localhost:521/')process.stdout.write(fs.readFileSync(p.join(process.env.ZJ_DASHBOARD_BASE,'dist/_releases/current/index.html')));else console.log(JSON.stringify({sha:link}));process.exit(0)}
`;
  for(const cmd of ['docker','curl','mv','df']) writeFileSync(join(bin,cmd),fake,{mode:0o755});
  let counter=0, lastRun='';
  function deploy(sha,{badConfig=false,badHash=false,lowDisk=false,signal,failProxy=false}={}) {
    lastRun=`${++counter}-1`;
    writeFileSync(join(bundle,'dist/index.html'),'page '+sha);
    writeFileSync(join(bundle,'dist/release-sha.json'),JSON.stringify({sha}));
    writeFileSync(join(bundle,'nginx.conf'),`server {\n    root /usr/share/nginx/html/_releases/current;\n        root /usr/share/nginx/html/_shared_assets;\n${badConfig?' invalid_directive on;\n':''}}\n`);
    const archive=join(root,'bundle.tar.gz');let p=spawnSync('tar',['-czf',archive,'-C',bundle,'dist','nginx.conf']);assert.equal(p.status,0);
    const input=readFileSync(archive),hash=createHash('sha256').update(input).digest('hex');
    return spawnSync('bash',[resolve('scripts/deploy/hk-dashboard-staging.sh'),sha,badHash?'0'.repeat(64):hash,lastRun],{input,encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,ZJ_DASHBOARD_BASE:base,ZJ_DASHBOARD_HEALTH_ATTEMPTS:'1',ZJ_DASHBOARD_HEALTH_INTERVAL:'0',...(failProxy?{FAIL_PROXY:'1'}:{}),...(lowDisk?{FAKE_FREE_KB:'1024'}:{}),...(signal?{TEST_SIGNAL:signal}:{})}});
  }
  function rollback(sha,run=lastRun) { return spawnSync('bash',[resolve('scripts/deploy/hk-dashboard-staging.sh'),sha,'rollback',run],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,ZJ_DASHBOARD_BASE:base}}); }
  return {base,bundle,deploy,rollback,runId:()=>lastRun};
}
test('首次从旧布局切换并保留旧页面，之后支持同版本安全重试',t=>{const f=setup(t),sha='a'.repeat(40);let x=f.deploy(sha);assert.equal(x.status,0,x.stderr);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),sha);assert.equal(readFileSync(join(f.base,'dist/index.html'),'utf8'),'old page');x=f.deploy(sha);assert.equal(x.status,0,x.stderr);});
test('错误摘要不影响当前网页和配置',t=>{const f=setup(t),x=f.deploy('a'.repeat(40),{badHash:true});assert.notEqual(x.status,0);assert.equal(readFileSync(join(f.base,'nginx.conf'),'utf8'),'legacy nginx config\n');assert.equal(readFileSync(join(f.base,'dist/index.html'),'utf8'),'old page');});
test('Nginx 配置校验失败后恢复此前指针和配置',t=>{const f=setup(t),old='a'.repeat(40);assert.equal(f.deploy(old).status,0);const previous=readFileSync(join(f.base,'nginx.conf'),'utf8');const x=f.deploy('b'.repeat(40),{badConfig:true});assert.notEqual(x.status,0);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),old);assert.equal(readFileSync(join(f.base,'nginx.conf'),'utf8'),previous);});

test('磁盘不足时拒绝接收和切换',t=>{const f=setup(t),x=f.deploy('a'.repeat(40),{lowDisk:true});assert.notEqual(x.status,0);assert.match(x.stderr,/disk space/);assert.equal(readFileSync(join(f.base,'nginx.conf'),'utf8'),'legacy nginx config\n');});

for(const signal of ['SIGTERM','SIGHUP','SIGPIPE'])test(`收到 ${signal} 后恢复旧版本并实际读回旧 SHA`,t=>{const f=setup(t),old='a'.repeat(40);assert.equal(f.deploy(old).status,0);const x=f.deploy('b'.repeat(40),{signal});assert.notEqual(x.status,0);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),old);assert.match(x.stderr,new RegExp('Previous dashboard restored sha='+old));});

test('API 代理验收失败时恢复并读回旧 SHA',t=>{const f=setup(t),old='a'.repeat(40);assert.equal(f.deploy(old).status,0);const x=f.deploy('b'.repeat(40),{failProxy:true});assert.notEqual(x.status,0);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),old);assert.match(x.stderr,new RegExp('Previous dashboard restored sha='+old));});

test('旧页面的哈希资源在新版本上线后仍保留',t=>{const f=setup(t);assert.equal(f.deploy('a'.repeat(40)).status,0);assert.equal(readFileSync(join(f.base,'dist/_shared_assets/assets/old-hash.js'),'utf8'),'old javascript');assert.equal(readFileSync(join(f.base,'dist/_shared_assets/assets/new-hash.js'),'utf8'),'new javascript');});
test('画布嵌套版本资源在新版本和回退后仍供旧标签使用',t=>{const f=setup(t),assets=join(f.bundle,'dist/assets/comfy');mkdirSync(join(assets,'v1'),{recursive:true});writeFileSync(join(assets,'v1/entry.js'),'version one');assert.equal(f.deploy('a'.repeat(40)).status,0);rmSync(join(assets,'v1'),{recursive:true});mkdirSync(join(assets,'v2'));writeFileSync(join(assets,'v2/entry.js'),'version two');assert.equal(f.deploy('b'.repeat(40)).status,0);assert.equal(f.rollback('b'.repeat(40)).status,0);for(const [version,content] of [['v1','version one'],['v2','version two']])assert.equal(readFileSync(join(f.base,'dist/_shared_assets/assets/comfy',version,'entry.js'),'utf8'),content);});
test('同名不同内容资源冲突时拒绝覆盖和切换',t=>{const f=setup(t),old='a'.repeat(40);assert.equal(f.deploy(old).status,0);writeFileSync(join(f.base,'dist/_shared_assets/assets/new-hash.js'),'different');const x=f.deploy('b'.repeat(40));assert.notEqual(x.status,0);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),old);assert.equal(readFileSync(join(f.base,'dist/_shared_assets/assets/new-hash.js'),'utf8'),'different');});

test('公网 smoke 失败后按候选回退并读回旧 SHA',t=>{const f=setup(t),old='a'.repeat(40),next='b'.repeat(40);assert.equal(f.deploy(old).status,0);assert.equal(f.deploy(next).status,0);const x=f.rollback(next);assert.equal(x.status,0,x.stderr);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),old);assert.match(x.stdout,new RegExp('Previous dashboard restored sha='+old));});

test('同 SHA 重试的回滚恢复重试前状态，而非更早版本',t=>{const f=setup(t),a='a'.repeat(40),b='b'.repeat(40);assert.equal(f.deploy(a).status,0);assert.equal(f.deploy(b).status,0);assert.equal(f.deploy(b).status,0);const x=f.rollback(b);assert.equal(x.status,0,x.stderr);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),b);assert.match(x.stdout,new RegExp('restored sha='+b));});
test('C 后重发 B 回滚应恢复 C，过期 run 无权回滚',t=>{const f=setup(t),b='b'.repeat(40),c='c'.repeat(40);assert.equal(f.deploy(b).status,0);const oldRun=f.runId();assert.equal(f.deploy(c).status,0);assert.equal(f.deploy(b).status,0);assert.notEqual(f.rollback(b,oldRun).status,0);assert.equal(f.rollback(b).status,0);assert.equal(readlinkSync(join(f.base,'dist/_releases/current')),c);});

test('共享资源复制先预检空间，中断不暴露半文件且重试成功',t=>{
  const f=setup(t),root=join(f.base,'asset-test'),old=join(root,'old'),fresh=join(root,'new'),dest=join(root,'out/assets');
  mkdirSync(old,{recursive:true});mkdirSync(fresh,{recursive:true});writeFileSync(join(fresh,'hash.js'),'complete asset bytes');
  const script=readFileSync(resolve('scripts/deploy/hk-dashboard-staging.sh'),'utf8');
  const source=script.split("<<'PYASSETS'\n")[1].split('\nPYASSETS')[0];
  function run(mode){
    const prefix=mode==='low'?"import os,types\nos.statvfs=lambda p: types.SimpleNamespace(f_bavail=0,f_frsize=4096)\n":mode==='interrupt'?"import shutil\ndef fail(inp,out,n):\n out.write(inp.read(3)); raise OSError('interrupted')\nshutil.copyfileobj=fail\n":"";
    return spawnSync('python3',['-c',prefix+source,old,fresh,dest],{encoding:'utf8'});
  }
  assert.notEqual(run('low').status,0);assert.notEqual(run('interrupt').status,0);
  assert.throws(()=>readFileSync(join(dest,'hash.js')));
  assert.equal(run('normal').status,0);assert.equal(readFileSync(join(dest,'hash.js'),'utf8'),'complete asset bytes');
});
