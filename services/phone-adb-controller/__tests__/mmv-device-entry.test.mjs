import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';

const header='profile\tserial\tmodel\twidth\theight\tenabled\n';
const row='cloud-phone-test\t47.100.213.173:10001\tSM-F900F\t720\t1280\ttrue\n';

// 入口边界回归，所有允许入口都止于真实缺正式plan；不mock PG/公司账号预检。
function fixture(t,registry=header+row){
  const home=mkdtempSync(join(tmpdir(),'mmv-device-entry-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const app=join(home,'app'),bin=join(home,'.local/bin');
  mkdirSync(app);mkdirSync(bin,{recursive:true});
  copyFileSync(new URL('../leadgen-run.sh',import.meta.url),join(app,'leadgen-run.sh'));
  writeFileSync(join(bin,'hostname'),'#!/bin/sh\nprintf "r10-7\\n"\n',{mode:0o755});
  const path=join(home,'registry.tsv');writeFileSync(path,registry);
  const adb=join(bin,'adb');writeFileSync(adb,'#!/bin/sh\nprintf \"Android Debug Bridge version 1.0.41\\n\"\n',{mode:0o755});
  const env={...process.env,HOME:home,ZDOTDIR:home,DOUYIN_PHONE_REGISTRY:path,DOUYIN_ADB_BIN:adb};
  for(const key of ['LEADGEN_MMV_DEVICE_RUNTIME','DOUYIN_ADB_PORT','ADB_SERVER_SOCKET','BRAIN_URL'])delete env[key];
  return {home,app,env};
}

function launch(f,extra={},flow='douyin_video_processing',profile='cloud-phone-test',serial='47.100.213.173:10001'){
  return spawnSync('/bin/zsh',[join(f.app,'leadgen-run.sh'),flow,profile,serial,'unbound-company','entrytest'],
    {env:{...f.env,...extra},encoding:'utf8',timeout:8000});
}

async function bridge(t,response='0029'){
  // 独立子进程提供本地协议夹具；没有ADB/手机/租户或Brain调用。
  const source=`const net=require('node:net');const s=net.createServer(c=>c.once('data',b=>{
    if(b.toString()!=='000chost:version')return c.destroy();
    c.end('OKAY0004'+${JSON.stringify(response)});
  }));s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  const child=spawn(process.execPath,['-e',source],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const port=await new Promise((resolve,reject)=>{
    child.stdout.once('data',b=>resolve(Number(b.toString().trim())));
    child.once('error',reject);child.once('exit',code=>reject(Error('fixture exited '+code)));
  });
  return {LEADGEN_MMV_DEVICE_RUNTIME:'1',DOUYIN_ADB_PORT:String(port),ADB_SERVER_SOCKET:`tcp:127.0.0.1:${port}`};
}

test('MMV默认仍拒手机；原mmv-scoring/none不要求手机配置',t=>{
  const f=fixture(t);
  const denied=launch(f);assert.equal(denied.status,1);assert.match(denied.stderr,/MMV只执行独立评论评分/);
  const scoring=launch(f,{},'douyin_comment_scoring','mmv-scoring','none');
  assert.equal(scoring.status,1);assert.match(scoring.stderr,/正式发布计划缺失/);
});

test('显式MMV设备入口核已启用唯一registry+既有端口后仍要求原正式冻结plan',async t=>{
  const f=fixture(t),route=await bridge(t);
  const out=launch(f,route);
  assert.equal(out.status,1,out.stderr);
  assert.match(out.stderr,/正式发布计划缺失/,'必须越过技术入口，但不能伪造正式业务前置');
  assert.equal(out.stdout.trim(),'');
  assert.equal(existsSync(join(f.home,'.config/zenithjoy/ledger')),false);
});

test('显式flag不能绕过registry禁用、重复profile、重复serial或无显式enabled',async t=>{
  const route=await bridge(t);
  for(const registry of [header+row.replace('true','false'),header+row+row,
    header+row+'other-profile\t47.100.213.173:10001\tmodel\t720\t1280\ttrue\n',
    'profile\tserial\ncloud-phone-test\t47.100.213.173:10001\n',
    header+row.replace('cloud-phone-test','foreign-profile')]){
    const f=fixture(t,registry),out=launch(f,route);
    assert.equal(out.status,1,out.stderr);assert.match(out.stderr,/MMV_DEVICE_REGISTRY/);
    assert.equal(out.stdout.trim(),'');
  }
});

test('设备入口缺显式端口、socket端口不一致或远端host时，在业务prepare前拒绝',async t=>{
  const f=fixture(t),route=await bridge(t);
  for(const extra of [{...route,DOUYIN_ADB_PORT:''},{...route,ADB_SERVER_SOCKET:'tcp:localhost:5037'},
    {...route,ADB_SERVER_SOCKET:`tcp:foreign-host:${route.DOUYIN_ADB_PORT}`}]){
    const out=launch(f,extra);assert.equal(out.status,1);assert.match(out.stderr,/MMV_DEVICE_ADB_ROUTE/);
    assert.equal(out.stdout.trim(),'');
  }
});

test('既有socket协议未知只读拒绝，不调用adb创建或重启服务',async t=>{
  const f=fixture(t),route=await bridge(t,'002a');
  const forbidden=join(f.home,'.local/bin/adb');
  writeFileSync(forbidden,`#!/bin/sh\nprintf called > '${f.home}/adb-was-called'\nexit 99\n`,{mode:0o755});
  const out=launch(f,{...route,DOUYIN_ADB_BIN:forbidden});
  assert.equal(out.status,1);assert.match(out.stderr,/MMV_DEVICE_ADB_UNAVAILABLE/);
  assert.equal(existsSync(join(f.home,'adb-was-called')),false);
});


test('MMV设备入口拒绝可自动启动ADB的localhost路径',async t=>{
  const f=fixture(t),route=await bridge(t);
  const out=launch(f,{...route,ADB_SERVER_SOCKET:`tcp:localhost:${route.DOUYIN_ADB_PORT}`});
  assert.equal(out.status,1);assert.match(out.stderr,/MMV_DEVICE_ADB_ROUTE/);
  assert.doesNotMatch(out.stderr,/正式发布计划缺失/);
});


test('MMV设备入口拒不匹配或未知的本地ADB客户端，不调用设备命令',async t=>{
  const f=fixture(t),route=await bridge(t);
  for(const version of ['Android Debug Bridge version 1.0.40','unknown']){
    writeFileSync(f.env.DOUYIN_ADB_BIN,'#!/bin/sh\n[ "$1" = version ] || exit 97\nprintf "%s\\n" "'+version+'"\n',{mode:0o755});
    const out=launch(f,route);assert.equal(out.status,1);
    assert.match(out.stderr,/MMV_DEVICE_ADB_CLIENT/);
    assert.doesNotMatch(out.stderr,/正式发布计划缺失/);
  }
});
