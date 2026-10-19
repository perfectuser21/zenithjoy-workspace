import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {judgeSteps} from '../step-judge.mjs';

// Catch the real seam: a successful relocated tab must satisfy the unchanged
// generated checkpoint, rather than merely print video_tab=1 for a retry file.
const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const body=source.split('  search-video-tab)\n')[1]?.split('\n    ;;\n  collect-comments)')[0];
assert.ok(body);
const spec=JSON.parse(readFileSync(new URL('../plans/douyin_video_discovery.steps.json',import.meta.url)));
const checkpoint=spec.steps.find(s=>s.key==='douyin_video_discovery.collect_videos.switch_video_tab');
assert.ok(checkpoint);
const before=readFileSync(new URL('./fixtures/search-tabs-before-reorder.xml',import.meta.url),'utf8');
const moved=readFileSync(new URL('./fixtures/search-tabs-after-reorder.xml',import.meta.url),'utf8');
const selected=xml=>xml.replace(/<node\b[^>]*>/g,node=>node.replace(/selected="(?:true|false)"/,`selected="${node.includes('text="视频"')?'true':'false'}"`));

function run({first= moved,last=selected(moved),wanted=1,publicationFailure=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'vtab-checkpoint-'));
 const eid='checkpoint-src1-vtab';
 try{
  for(const [name,xml] of Object.entries({before,first,last,moved}))writeFileSync(join(dir,name+'.xml'),xml);
  writeFileSync(join(dir,'adb'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  const script=`set -e
check_target(){ :; }
wait_ms(){ :; }
require_evidence_id(){ :; }
foreground_package(){ print com.ss.android.ugc.aweme; }
snapshot_evidence(){ print fixture > "$CASE_DIR/failure.png"; print "$CASE_DIR/failure.png"; }
die(){ print -u2 -- "$*"; exit 2; }
locate_cached(){ return 1; }
ui_evidence(){ /bin/cp "$CASE_DIR/first.xml" "$EVIDENCE_ROOT/$1.xml"; print "$EVIDENCE_ROOT/$1.xml"; }
_ui_evidence_wave(){
 local input=before
 [[ "$1" == *tabs-retry ]] && input=moved
 if [[ "$1" == *aftertab-retry ]]; then
  input=last
  if [[ "$PUBLICATION_FAILURE" == 1 ]]; then
   /bin/mv "$EVIDENCE_ROOT/$CASE_EID-aftertab.xml" "$CASE_DIR/retained-first.xml"
   /bin/mkdir "$EVIDENCE_ROOT/$CASE_EID-aftertab.xml"
  fi
 fi
 /bin/cp "$CASE_DIR/$input.xml" "$EVIDENCE_ROOT/$1.xml"
 print "$EVIDENCE_ROOT/$1.xml"
}
set -- search-video-tab "$CASE_EID"
${body}
`;
  const result=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,CASE_DIR:dir,CASE_EID:eid,PUBLICATION_FAILURE:publicationFailure?'1':'0',EVIDENCE_ROOT:dir,ADB:join(dir,'adb'),SERIAL:'offline-fixture',PYTHON_BIN:'python3'}});
  const judged=judgeSteps({spec:{steps:[checkpoint]},stage:'collect_videos',ctx:{tag:'checkpoint',evidenceDir:dir,metrics:{sources_succeeded:wanted}}});
  const get=name=>{try{return readFileSync(join(dir,name),'utf8');}catch{return null;}};
  return {...result,checkpoint:judged.steps[0],canonical:get(eid+'-aftertab.xml'),firstArchive:get(eid+'-aftertab-first.xml'),retry:get(eid+'-aftertab-retry.xml')};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('重定位成功提交最终canonical XML，真实固定checkpoint计数恰为1',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.equal(r.checkpoint.observed,1);assert.equal(r.checkpoint.pass,true);assert.equal(r.canonical,selected(moved));assert.equal(r.firstArchive,moved);assert.equal(r.retry,selected(moved));assert.match(r.stdout,/evidence=.*checkpoint-src1-vtab-aftertab\.xml/);
});
test('首点已选中保持原canonical证据，不增加重定位',()=>{
 const r=run({first:selected(before)});assert.equal(r.status,0,r.stderr);assert.equal(r.checkpoint.observed,1);assert.equal(r.checkpoint.pass,true);assert.equal(r.canonical,selected(before));assert.equal(r.retry,null);assert.match(r.stdout,/video_tab_relocalized=0/);
});
test('canonical目标为目录时提交失败，保重试原件且不能报动作成功',()=>{
 const r=run({publicationFailure:true});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/video_tab=1/);assert.equal(r.checkpoint.observed,0);assert.equal(r.checkpoint.pass,false);assert.equal(r.retry,selected(moved));
});
test('最终仍未选中不发布通过checkpoint',()=>{
 const r=run({last:moved});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/video_tab=1/);assert.equal(r.checkpoint.observed,0);assert.equal(r.checkpoint.pass,false);assert.equal(r.canonical,moved);
});
test('两个成功来源配额只有一个来源证据时仍失败，不双计retry或first原件',()=>{
 const r=run({wanted:2});assert.equal(r.status,0,r.stderr);assert.equal(r.checkpoint.observed,1);assert.equal(r.checkpoint.pass,false);
});
