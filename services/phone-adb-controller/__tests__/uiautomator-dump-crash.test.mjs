import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const wave=controller.match(/_ui_evidence_wave\(\) \{[\s\S]*?\n\}/)?.[0];
const hasZsh=spawnSync('zsh',['-c','exit 0']).status===0;

function runWave(t,mode){
 const dir=mkdtempSync(join(tmpdir(),'uiauto137-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const adb=join(dir,'adb'),remote=join(dir,'remote.xml'),count=join(dir,'count');
 writeFileSync(adb,`#!/bin/sh
case "$*" in
  *"shell rm -f "*) if [ "$CASE_MODE" != retained ]; then rm -f "$CASE_REMOTE"; fi; exit 0;;
  *"REMOTE_UI_ABSENT_V1"*) if [ ! -e "$CASE_REMOTE" ]; then printf REMOTE_UI_ABSENT_V1; exit 0; else exit 1; fi;;
  *"shell uiautomator dump --compressed "*)
    n=$(cat "$CASE_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$CASE_COUNT"
    if [ "$CASE_MODE" = always137 ] || [ "$n" -eq 1 ]; then
      printf '<hierarchy><node package="com.ss.android.ugc.aweme" text="old"/></hierarchy>' > "$CASE_REMOTE"
      exit 137
    fi
    if [ "$CASE_MODE" = wrongpackage ]; then
      printf '<hierarchy><node package="com.android.launcher" text="fresh"/></hierarchy>' > "$CASE_REMOTE"
    else
      printf '<hierarchy><node package="com.ss.android.ugc.aweme" text="fresh"/></hierarchy>' > "$CASE_REMOTE"
    fi
    exit 0;;
  *"shell stat -c %s "*) wc -c < "$CASE_REMOTE" 2>/dev/null | tr -d ' ' || echo 0; exit 0;;
  *"shell stat -c %Y "*) if [ "$CASE_MODE" = stale ]; then echo 1; else stat -f %m "$CASE_REMOTE" 2>/dev/null || echo 0; fi; exit 0;;
  *"shell date +%s"*) date +%s; exit 0;;
  *" pull "*) for last; do :; done; cp "$CASE_REMOTE" "$last"; exit 0;;
esac
exit 2`);chmodSync(adb,0o755);
 const script=`set -euo pipefail; setopt EXTENDED_GLOB
ADB=$CASE_ADB; SERIAL=NO-DEVICE; REMOTE_UI=/sdcard/douyin-leadgen-ui-test.xml; EVIDENCE_ROOT=$CASE_DIR
require_evidence_id(){ :; }; wait_ms(){ :; }
foreground_package(){ print 'com.ss.android.ugc.aweme/.SearchResultActivity'; }
_foreground_is_exact_douyin(){ [[ "$1" == 'com.ss.android.ugc.aweme/.SearchResultActivity' ]]; }
_is_complete_douyin_xml(){ grep -q 'package="com.ss.android.ugc.aweme"' "$1"; }
${wave}
_ui_evidence_wave evidence`;
 const result=spawnSync('zsh',['-c',script],{encoding:'utf8',timeout:3000,env:{...process.env,CASE_ADB:adb,CASE_DIR:dir,CASE_REMOTE:remote,CASE_COUNT:count,CASE_MODE:mode}});
 return {...result,dumpCount:Number(readFileSync(count,'utf8').trim())};
}

test('UiAutomation code137后必须拒绝该次XML，清除后只接受第二次完整新鲜层级',{skip:!hasZsh},t=>{
 assert.ok(wave,'控制器目标函数必须存在');
 const r=runWave(t,'first137');assert.equal(r.status,0,`stdout=${r.stdout} stderr=${r.stderr}`);
 assert.match(readFileSync(r.stdout.trim(),'utf8'),/text="fresh"/);
 assert.equal(r.dumpCount,2,'失败叶之后仅一次受控重试');
});

test('三次UiAutomation code137均不得接受遗留XML',{skip:!hasZsh},t=>{
 const r=runWave(t,'always137');assert.notEqual(r.status,0,'重复崩溃必须继续fail-closed');assert.equal(r.dumpCount,3);
});

for(const mode of ['stale','wrongpackage','retained'])test(`崩溃后的${mode} XML不得作为新鲜抖音层级`,{skip:!hasZsh},t=>{
 const r=runWave(t,mode);assert.notEqual(r.status,0);
});
