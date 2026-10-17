import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const body=source.split('  search-video-tab)\n')[1]?.split('\n    ;;\n  collect-comments)')[0];
assert.ok(body,'must exercise the actual production search-video-tab case');
const fixture=name=>readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const before=fixture('search-tabs-before-reorder.xml');
const moved=fixture('search-tabs-after-reorder.xml');
const selected=xml=>xml.replace(/<node\b[^>]*>/g,node=>node.replace(/selected="(?:true|false)"/,`selected="${node.includes('text="视频"')?'true':'false'}"`));
const absent=xml=>xml.replace(/<node\b[^>]*text="视频"[^>]*\/>/g,'');
const duplicate=xml=>xml.replace('</hierarchy>',xml.match(/<node\b[^>]*text="视频"[^>]*\/>/)[0]+'</hierarchy>');

function run({initial=before,first=moved,retry=moved,last=selected(moved),unreadable=false,shotMissing=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'vtab-reorder-'));
 try{
  for(const [name,xml]of Object.entries({initial,first,retry,last}))writeFileSync(join(dir,name+'.xml'),xml);
  writeFileSync(join(dir,'adb'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TAP_LOG"\n',{mode:0o700});
  const script=`set -e\ncheck_target(){ :; }\nwait_ms(){ :; }\nrequire_evidence_id(){ :; }\nforeground_package(){ print com.ss.android.ugc.aweme; }\nsnapshot_evidence(){ [[ "$SHOT_MISSING" == 1 ]] || print synthetic-offline-fixture > "$CASE_DIR/diagnostic.png"; print -- "$CASE_DIR/diagnostic.png"; }\ndie(){ print -u2 -- "$*"; exit 2; }\nlocate_cached(){ print '184 140'; }\n_ui_evidence_wave(){
 if [[ "$1" == *aftertab-retry ]]; then print -- "$CASE_DIR/last.xml";\n elif [[ "$1" == *tabs-retry ]]; then print -- "$CASE_DIR/retry.xml";
 elif [[ "$INITIAL_UNREADABLE" == 1 ]]; then return 1;
 else print -- "$CASE_DIR/initial.xml"; fi
}\nui_evidence(){
 if [[ "$1" == *aftertab-retry ]]; then print -- "$CASE_DIR/last.xml";
 else print -- "$CASE_DIR/first.xml"; fi
}\nset -- search-video-tab evidence\n${body}\n`;
  const result=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,CASE_DIR:dir,TAP_LOG:join(dir,'taps'),INITIAL_UNREADABLE:unreadable?'1':'0',ADB:join(dir,'adb'),SERIAL:'fixture-device',EVIDENCE_ROOT:dir,SHOT_MISSING:shotMissing?'1':'0'}});
  let taps=[];try{taps=readFileSync(join(dir,'taps'),'utf8').trim().split('\n').filter(Boolean);}catch{}
  return {...result,taps};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('真实页签重排：首次点184，随后从新树定位到291并验证视频选中',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.deepEqual(r.taps,['-s fixture-device shell input tap 184 140','-s fixture-device shell input tap 291 140']);assert.match(r.stdout,/video_tab=1/);assert.match(r.stdout,/video_tab_relocalized=1/);assert.match(r.stdout,/evidence=.*aftertab-retry|evidence=.*last.xml/);
});
test('首点已正确时不增加任何点击或重试',()=>{
 const r=run({first:selected(before)});assert.equal(r.status,0,r.stderr);assert.equal(r.taps.length,1);assert.match(r.stdout,/video_tab_relocalized=0/);
});
test('新位置仍未选中时最多两次点击并失败，不能报视频已就绪',()=>{
 const r=run({last:moved});assert.notEqual(r.status,0);assert.equal(r.taps.length,2);assert.doesNotMatch(r.stdout,/video_tab=1/);assert.match(r.stderr,/failure_xml=.*failure.xml/);assert.match(r.stderr,/failure_screenshot=.*diagnostic.png/);assert.match(r.stderr,/failure_foreground=.*failure.foreground.txt/);
});
test('重定位新树没有视频页签则不再点击',()=>{
 const r=run({retry:absent(moved)});assert.notEqual(r.status,0);assert.equal(r.taps.length,1);
});
test('重定位新树有重复视频页签则不猜第一个位置',()=>{
 const r=run({retry:duplicate(moved)});assert.notEqual(r.status,0);assert.equal(r.taps.length,1);
});
test('初始树页签歧义时拒绝点击',()=>{
 const r=run({initial:duplicate(before),first:selected(before)});assert.notEqual(r.status,0);assert.equal(r.taps.length,0);
});
test('原树不可读的视觉兜底仍保留选中后验，成功只点击一次',()=>{
 const r=run({unreadable:true,first:selected(before)});assert.equal(r.status,0,r.stderr);assert.equal(r.taps.length,1);assert.match(r.stdout,/coord_source=vision/);
});

test('诊断截图不可用时保留原失败而不把不存在文件报成截图证据',()=>{
 const r=run({last:moved,shotMissing:true});assert.notEqual(r.status,0);assert.match(r.stderr,/video tab is not selected after tap/);assert.match(r.stderr,/failure_screenshot=unavailable/);assert.equal(r.taps.length,2);
});
