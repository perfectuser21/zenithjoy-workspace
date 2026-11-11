import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {RPC_FILES,rpcSource} from '../leadgen-client.mjs';
import {NATIVE_PHONE_FILES} from '../native-phone-runtime.mjs';
import {collectMethods} from '../../../scripts/product-map/leadgen-methods.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),repository=resolve(root,'../..');
const text=path=>readFileSync(resolve(root,path),'utf8');
const hash=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
const policy=JSON.parse(text('config/native-phone-command-sources.json'));
const dependencies=[...new Set([...NATIVE_PHONE_FILES,'douyin-phone-adb','search-video-tab.py','clipboard-widget-cancel.py','locate-element.py','config/native-phone-command-sources.json',...policy.device_sources.flatMap(row=>[row.review.path,row.pillow.path])])];

test('cold phone source reaches both deployed inventories, RPC and every shared Activity binding',()=>{
 const deploy=text('deploy.sh');
 const start=deploy.indexOf('MMV_JS_FILES=('),end=deploy.indexOf('# 在任何SSH前核验部署源字节');assert.ok(start>0&&end>start);
 const names=['MMV_JS_FILES','MMV_PROBE_FILES','MMV_RUNTIME_FILES','DEVICE_NODE_FILES','DEVICE_RPC_PROBE_FILES','DEVICE_PLAN_FILES','DEVICE_SH_FILES','DEVICE_CTL_FILES','DEVICE_CTL_DIRS','RPC_FILES'];
 const script=deploy.slice(start,end)+'\n'+names.map(name=>`printf '%s\\0' '${name}' "\${${name}[@]}" '@END@'`).join('\n');
 const values=execFileSync('/bin/bash',['-c',script],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean),groups={};
 for(let i=0;i<values.length;){const name=values[i++],entries=[];while(values[i]!=='@END@'&&i<values.length)entries.push(values[i++]);assert.equal(values[i++],'@END@');groups[name]=entries;}
 const count=(entries,file)=>entries.filter(value=>value===file).length;
 const controllers=['douyin-phone-adb','search-video-tab.py','clipboard-widget-cancel.py','locate-element.py'];
 for(const file of controllers){
  assert.equal(count(groups.DEVICE_CTL_FILES,file),1,`${file} retains its existing controller installer`);
  for(const name of ['MMV_JS_FILES','MMV_PROBE_FILES','DEVICE_NODE_FILES','DEVICE_RPC_PROBE_FILES'])assert.equal(count(groups[name],file),0,`${file} must not be installed through ordinary ${name}`);
 }
 assert.deepEqual(groups.DEVICE_CTL_DIRS,['bin-harvest','.local/bin'],'paired controller execution paths remain unchanged');
 const policyFiles=['config/native-phone-command-sources.json',...policy.device_sources.flatMap(row=>[row.review.path,row.pillow.path])];
 for(const file of policyFiles){
  for(const name of ['MMV_JS_FILES','DEVICE_NODE_FILES'])assert.equal(count(groups[name],file),0,`${file} is data, not a Node program`);
  for(const name of ['MMV_PROBE_FILES','DEVICE_RPC_PROBE_FILES'])assert.equal(count(groups[name],file),1,`${file} uses the existing data/probe validator`);
 }
 const device=[...groups.DEVICE_SH_FILES,...groups.DEVICE_NODE_FILES,...groups.DEVICE_PLAN_FILES,...groups.DEVICE_RPC_PROBE_FILES,...groups.DEVICE_CTL_FILES];
 for(const [name,inventory]of [['MMV_RUNTIME_FILES',groups.MMV_RUNTIME_FILES],['actual M4 manifest arguments',device]]){
  assert.equal(new Set(inventory).size,inventory.length,`${name} must not hide duplicate deployed paths`);
  for(const file of dependencies)assert.equal(count(inventory,file),1,`${name} must contain exactly one ${file}`);
 }
 const required=text('leadgen-rpc.mjs').match(/for\s*\(const path of (\[[\s\S]*?\])\)/);
 assert.ok(required,'actual RPC receiver source gate exists');
 const receiver=new Set([...required[1].matchAll(/'([^']+)'/g)].map(m=>m[1]));
 for(const file of dependencies){assert.ok(RPC_FILES.includes(file),`RPC misses ${file}`);assert.ok(receiver.has(file),`RPC receiver misses ${file}`);}
 const methods=collectMethods(repository);
 for(const [ref,activity] of Object.entries(methods.activities)){
  const bound=new Set(activity.code_bindings.map(row=>row.path));
  const xian=policy.device_sources.find(row=>row.profile==='xiaolongxia');
  const only101=xian?[xian.review.path,xian.pillow.path]:[];
  const consumes101=['douyin_video_processing.preflight','douyin_video_discovery.collect_videos','douyin_video_processing.cleanup'].includes(ref);
  for(const file of dependencies.filter(file=>consumes101||!only101.includes(file)))assert.ok(bound.has('services/phone-adb-controller/'+file),`${ref} misses ${file}`);
 }
});

test('RPC frozen source refuses any missing phone dependency instead of falling back',()=>{
 const frozen={deployment:{source_commit:'a'.repeat(40)},files:Object.fromEntries(RPC_FILES.map(file=>['runtime/'+file,hash(file)]))};
 const source=rpcSource(frozen);
 for(const file of dependencies){
  assert.equal(source.files.find(row=>row.path===file)?.sha256,hash(file));
  const changed={...frozen,files:{...frozen.files}};delete changed.files['runtime/'+file];
  assert.throws(()=>rpcSource(changed),/冻结发布缺远端依赖/);
 }
});

test('actual device policy binds the reviewed command entrypoints and local Pillow inventory',()=>{
 assert.equal(policy.schema_version,1);
 for(const row of policy.device_sources){
 assert.equal(hash(row.review.path),row.review.sha256);assert.equal(hash(row.pillow.path),row.pillow.sha256);
 const programs=new Map(row.program_files.map(file=>[file.path,file.sha256]));
 assert.equal(programs.size,row.program_files.length);
 for(const name of ['sh','input','cmd','am','uiautomator','app_process','toybox','monkey'])assert.match(programs.get('/system/bin/'+name)||'',/^[a-f0-9]{64}$/);
 for(const name of ['uiautomator.jar','monkey.jar','android.test.runner.jar'])assert.ok(programs.has('/system/framework/'+name));
 assert.equal(programs.has('/system/framework/input.jar'),false,'missing ROM file cannot become a verified source');
 const pillow=JSON.parse(text(row.pillow.path));assert.equal(pillow.root,'/opt/homebrew/lib/python3.14/site-packages/PIL');
 assert.equal(new Set(pillow.files.map(file=>file.path)).size,pillow.files.length);
 assert.ok(pillow.files.length>0);for(const file of pillow.files)assert.match(file.sha256,/^[a-f0-9]{64}$/);
 }
});

test('101 Drive admits the granted xian-m4 phone with its own reviewed ROM and Pillow source',()=>{
 const matches=policy.device_sources.filter(row=>row.profile==='xiaolongxia'&&row.serial==='ANGYVB4311010223');
 assert.equal(matches.length,1,'the real 101 surface must not stop at NATIVE_PHONE_SOURCE');
 const row=matches[0],cloud=policy.device_sources.find(row=>row.profile==='cloud-phone-test');
 assert.equal(row.device_sdk,35);assert.equal(row.width,1200);assert.equal(row.height,2664);
 assert.notDeepEqual(row.program_files,cloud.program_files,'a physical ROM cannot inherit cloud-phone source attestations');
 assert.notEqual(row.review.path,cloud.review.path);assert.notEqual(row.pillow.path,cloud.pillow.path);
 assert.equal(hash(row.review.path),row.review.sha256);assert.equal(hash(row.pillow.path),row.pillow.sha256);
 for(const command of ['wake','unlock','open-app','telecom','dump-file','screenshot-file','search','open-detail','close-app','home-resolve'])assert.ok(row.commands.includes(command),command+' is needed by the existing 101 sequence');
});


test('M4 Pillow uses a private content-addressed root and retains every reviewed source byte',()=>{
 const row=policy.device_sources.find(row=>row.profile==='xiaolongxia'),pillow=JSON.parse(text(row.pillow.path));
 const digest=createHash('sha256').update(JSON.stringify(pillow.files.map(({path,sha256})=>({path,sha256})))).digest('hex');
 assert.equal(pillow.files.length,132);assert.equal(digest,'9a1c85a313b8e6ccecb01bc6d43f6a395f4ac0046aed61b8db0c4336fb119172');
 assert.equal(pillow.root,'/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-dependencies/pillow-xian-m4-'+digest.slice(0,16)+'/PIL');
 assert.equal(hash('native-phone-search-step.py'),'ed0d36c9198a098baf004984534cb835fb8bf7cc098adada8c0ed24502cd65b5','original complete-inventory predicate stays unchanged');
 assert.equal(hash(row.pillow.path),row.pillow.sha256);
});
