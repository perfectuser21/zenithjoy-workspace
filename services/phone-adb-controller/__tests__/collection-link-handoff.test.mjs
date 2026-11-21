import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

const contract=YAML.parse(readFileSync(new URL('../../../product-map/contracts/douyin_video_processing.yaml',import.meta.url),'utf8'));
const collection=contract.activities.find(a=>a.key==='collection');
const skill=readFileSync(new URL('../skills/douyin-leadgen-activity-102-collection/SKILL.md',import.meta.url),'utf8');
const policy=collection.postconditions.find(p=>p.probe==='coll_video_binding_consistent').asserts;

test('采集入口方法与冻结合同同时声明已验收视频原件的有条件复用',()=>{
 for(const text of [skill,policy]){
  assert.match(text,/连续性.*已验收.*原件/);
  assert.match(text,/Task\/run.*VID.*设备.*锁/);
  assert.match(text,/原路径.*SHA-256/);
  assert.match(text,/不重复.*current-video-link/);
  assert.match(text,/无法证明.*重新.*取链/);
 }
 assert.doesNotMatch(skill,/采集 Agent 启动后再对当前页面重新核原生 VID/);
 assert.doesNotMatch(collection.preconditions.join('\n'),/采集执行时自己重新核原生VID/);
 assert.match(collection.preconditions.join('\n'),/START 不要求尚未生成的采集当前 UI 或取链回执/);
});

test('连续性证据未知或错身份不能用同标题替代，保留当前页面核对',()=>{
 for(const text of [skill,policy]){
  assert.match(text,/当前.*原生.*(?:UI|页面)/);
  assert.match(text,/切换视频.*外部接管.*未知/);
  assert.match(text,/同标题.*不能/);
 }
});

test('入口复用不代替逐评论原生身份、返回配对或主页取链',()=>{
 const binding=collection.postconditions.find(p=>p.probe==='coll_video_binding_consistent').asserts;
 assert.match(binding,/原生UID.*完整正文.*真实主页URL.*recipientEvidence.*返回评论页原件/);
 assert.match(skill,/入口复用.*不能替代.*逐评论/);
 assert.match(skill,/after-card.*主页.*取链/);
 assert.match(skill,/qualification与collection两个主span/);
});

test('现有技术身份读取器接受资格阶段原回执；错误VID、run和摘要均不通过',()=>{
 const dir=mkdtempSync(join(tmpdir(),'collection-link-handoff-'));
 try{
  const run='isolated-handoff-run',vid='7710119351617195327',file=join(dir,'qualification-native.json');
  const bytes=JSON.stringify({exit_code:0,args:['current-video-link',run+'-qual-link'],stdout:'resolved_url=https://www.douyin.com/video/'+vid});
  writeFileSync(file,bytes);
  const spec={expected_run:run,video_id:vid,video_identity:{path:file,sha256:createHash('sha256').update(bytes).digest('hex')}};
  const code=`import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('reader',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef no_network(url): raise AssertionError('no phone or network allowed')\ntry: print(json.dumps({'verified':m.native_video_identity(json.load(sys.stdin),resolve=no_network)}))\nexcept ValueError as e: print(json.dumps({'verified':False,'error':str(e)}))\n`;
  const read=input=>{
   const r=spawnSync('python3',['-c',code,new URL('../activity-native-identity.py',import.meta.url).pathname],{input:JSON.stringify(input),encoding:'utf8'});
   assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
  };
  assert.equal(read(spec).verified,true);
  assert.equal(read({...spec,video_id:'7710119351617195328'}).verified,false);
  assert.equal(read({...spec,expected_run:'different-run'}).error,'NATIVE_LINK_REQUEST_SCOPE');
  assert.equal(read({...spec,video_identity:{...spec.video_identity,sha256:'0'.repeat(64)}}).error,'ASSET_HASH_MISMATCH');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
