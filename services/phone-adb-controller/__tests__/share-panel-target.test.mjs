import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const src=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/cloud-share-panel-desc.xml',import.meta.url),'utf8');
function locate(xml){const fn=src.match(/^share_panel_link_target\(\) \{[\s\S]*?\n\}/m)?.[0];assert.ok(fn,'controller must select real share action from XML');const dir=mkdtempSync(join(tmpdir(),'share-panel-'));try{const f=join(dir,'panel.xml');writeFileSync(f,xml);return spawnSync('zsh',['-c',`set -eu;${fn};share_panel_link_target "$XML" 720 1280`],{encoding:'utf8',env:{...process.env,XML:f,PYTHON_BIN:'/usr/bin/python3'}});}finally{rmSync(dir,{recursive:true,force:true});}}
test('real cloud desc action selects clickable center rather than contact row',()=>{const r=locate(fixture);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'648 1095');});
test('legacy text label uses nearest clickable parent',()=>{const x=fixture.replace('<node text="" package=', '<node package="com.ss.android.ugc.aweme" enabled="true" clickable="true" bounds="[595,1031][702,1159]"><node text="分享链接" package=').replace('content-desc="分享链接" enabled="true" clickable="true"','content-desc="" enabled="true" clickable="false"').replace('/></node></hierarchy>','/></node></node></hierarchy>');const r=locate(x);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'648 1095');});
for(const [name,xml] of [
 ['missing header',fixture.replace('text="分享给"','text="其他"')],
 ['foreign package',fixture.replaceAll('com.ss.android.ugc.aweme','evil.package')],
 ['disabled target',fixture.replace('content-desc="分享链接" enabled="true"','content-desc="分享链接" enabled="false"')],
 ['offscreen target',fixture.replace('[595,1031][702,1159]','[595,1031][802,1159]')],
 ['no clickable target',fixture.replace('clickable="true"','clickable="false"')],
 ['contact nickname collision',fixture.replace('id/function_container','id/contacts')],
 ['ambiguous actions',fixture.replace('/></node></hierarchy>','/><node package="com.ss.android.ugc.aweme" text="分享链接" enabled="true" clickable="true" bounds="[450,1031][550,1159]"/></node></hierarchy>')]
])test('reject '+name,()=>{const r=locate(xml);assert.notEqual(r.status,0);assert.equal(r.stdout,'');});

test('selector and live current-video-link entry points remain connected',()=>{assert.match(src,/^share_panel_link_target\(\) \{/m);assert.match(src,/^_current_video_link_once\(\) \{/m);const live=src.match(/^_current_video_link_once\(\) \{[\s\S]*?^\}/m)?.[0];assert.match(live,/link_center="\$\(share_panel_link_target/);assert.doesNotMatch(live,/link_y1 - 96/);});

test('reject broad clickable ancestor containing an unnamed clickable sibling',()=>{const x=fixture.replace('<node text="" package=', '<node package="com.ss.android.ugc.aweme" enabled="true" clickable="true" bounds="[0,1031][720,1159]"><node package="com.ss.android.ugc.aweme" enabled="true" clickable="true" bounds="[247,1031][470,1100]"/><node text="" package=').replace('content-desc="分享链接" enabled="true" clickable="true"','content-desc="分享链接" enabled="true" clickable="false"').replace('/></node></hierarchy>','/></node></node></hierarchy>');const r=locate(x);assert.notEqual(r.status,0);assert.equal(r.stdout,'');});
