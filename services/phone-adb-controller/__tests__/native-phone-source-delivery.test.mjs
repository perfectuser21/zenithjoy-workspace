import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
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
 for(const name of ['MMV_JS_FILES','DEVICE_NODE_FILES']){
  const match=deploy.match(new RegExp(name+'=\\(([\\s\\S]*?)\\)'));
  assert.ok(match,`${name} is the actual deployment inventory`);
  const inventory=new Set(match[1].replace(/#[^\n]*/g,'').split(/\s+/));
  for(const file of dependencies)assert.ok(inventory.has(file),`${name} misses ${file}`);
 }
 const required=text('leadgen-rpc.mjs').match(/for\s*\(const path of (\[[\s\S]*?\])\)/);
 assert.ok(required,'actual RPC receiver source gate exists');
 const receiver=new Set([...required[1].matchAll(/'([^']+)'/g)].map(m=>m[1]));
 for(const file of dependencies){assert.ok(RPC_FILES.includes(file),`RPC misses ${file}`);assert.ok(receiver.has(file),`RPC receiver misses ${file}`);}
 const methods=collectMethods(repository);
 for(const [ref,activity] of Object.entries(methods.activities)){
  const bound=new Set(activity.code_bindings.map(row=>row.path));
  for(const file of dependencies)assert.ok(bound.has('services/phone-adb-controller/'+file),`${ref} misses ${file}`);
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
 assert.equal(policy.schema_version,1);assert.equal(policy.device_sources.length,1);
 const row=policy.device_sources[0];
 assert.equal(row.profile,'cloud-phone-test');assert.equal(row.serial,'47.100.213.173:10001');assert.equal(row.device_sdk,31);
 assert.equal(hash(row.review.path),row.review.sha256);assert.equal(hash(row.pillow.path),row.pillow.sha256);
 const programs=new Map(row.program_files.map(file=>[file.path,file.sha256]));
 assert.equal(programs.size,row.program_files.length);
 for(const name of ['sh','input','cmd','am','uiautomator','app_process','toybox','monkey'])assert.match(programs.get('/system/bin/'+name)||'',/^[a-f0-9]{64}$/);
 for(const name of ['uiautomator.jar','monkey.jar','android.test.runner.jar'])assert.ok(programs.has('/system/framework/'+name));
 assert.equal(programs.has('/system/framework/input.jar'),false,'missing ROM file cannot become a verified source');
 const pillow=JSON.parse(text(row.pillow.path));assert.equal(pillow.root,'/opt/homebrew/lib/python3.14/site-packages/PIL');
 assert.equal(new Set(pillow.files.map(file=>file.path)).size,pillow.files.length);
 assert.ok(pillow.files.length>0);for(const file of pillow.files)assert.match(file.sha256,/^[a-f0-9]{64}$/);
});
