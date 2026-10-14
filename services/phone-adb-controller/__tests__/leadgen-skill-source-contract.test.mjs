import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const flows=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const numbers={douyin_video_discovery:'101',douyin_video_processing:'102',douyin_comment_scoring:'103',douyin_lead_outreach:'104'};
const sharedOwner='douyin_video_processing';
function document(key){return yaml.load(readFileSync(root+'product-map/contracts/'+key+'.yaml','utf8'));}

test('四首版Skill存在、身份可解析，原Activity及代码绑定保留',()=>{
  for(const flow of flows){
    const current=document(flow);
    const entry='services/phone-adb-controller/skills/douyin-leadgen-'+numbers[flow]+'/SKILL.md';
    assert.ok(readFileSync(root+entry,'utf8').includes('name: douyin-leadgen-'+numbers[flow]));
    for(const activity of current.activities.filter(a=>!a.ref)){
      const code=activity.implementation_bindings.filter(b=>b.kind==='code');
      assert.ok(code.some(b=>b.path==='services/phone-adb-controller/leadgen-workflow.mjs'),'配套Skill不能替掉正式代码执行入口');
      const bindings=activity.implementation_bindings.filter(b=>b.kind==='skill');
      assert.equal(bindings.length,1);
      const binding=bindings[0];
      assert.equal(binding.repo,'perfectuser21/zenithjoy-workspace');
      assert.equal(binding.revision,'contract');
      assert.ok(binding.path.startsWith('services/phone-adb-controller/skills/'));
      const text=readFileSync(root+binding.path,'utf8');
      const front=yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
      assert.equal(binding.name,front.name);
      assert.equal(binding.version,front.metadata.version);
    }
  }
});

test('101共享102预检/收尾，接手文档明确Activity范围与原部署门禁',()=>{
  const discovery=document(flows[0]);
  assert.equal(discovery.activities[0].ref,sharedOwner+'.preflight');
  assert.equal(discovery.activities.at(-1).ref,sharedOwner+'.cleanup');
  for(const flow of flows){
    const text=readFileSync(root+'services/phone-adb-controller/skills/douyin-leadgen-'+numbers[flow]+'/SKILL.md','utf8');
    assert.ok(text.includes('mode=activity'),'不能把整流程调用冒作单Activity接手');
    const map=JSON.parse(readFileSync(root+'services/phone-adb-controller/skills/douyin-leadgen-'+numbers[flow]+'/references/runtime-calls.json','utf8'));
    assert.equal(map.workflow_key,flow);
    assert.equal(map.full_flow_entry,'leadgen-run.sh');
    assert.equal(map.single_activity_public_entry_available,false);
    assert.equal(map.raw_queue_cli_authorized,false);
  }
});

test('Skill和引用文件进入设备及MMV的实际发布清单，103不要求手机锁',()=>{
  const path=root+'services/phone-adb-controller/deploy.sh';
  const source=readFileSync(path,'utf8');
  const prefix=source.slice(0,source.indexOf('# 在任何SSH前核验部署源字节'));
  const names=execFileSync('/bin/bash',['-c',prefix+'\nprintf "%s\\n" "${DEVICE_RPC_PROBE_FILES[@]}" "${MMV_RUNTIME_FILES[@]}"',path],{encoding:'utf8'}).trim().split('\n');
  for(const number of Object.values(numbers))for(const suffix of ['SKILL.md','references/reuse-map.json','references/runtime-calls.json']){
    const name='skills/douyin-leadgen-'+number+'/'+suffix;
    assert.equal(names.filter(x=>x===name).length,2,'设备与MMV必须各自发布 '+name);
    assert.ok(readFileSync(root+'services/phone-adb-controller/'+name).length);
  }
  const scoring=JSON.parse(readFileSync(root+'services/phone-adb-controller/skills/douyin-leadgen-103/references/runtime-calls.json','utf8'));
  assert.ok(scoring.guards[0].includes('不取手机'),'103不得锁serial=none或占真实手机');
});
