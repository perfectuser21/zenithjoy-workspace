import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {captureCleanupReadback,verifyCleanupReadback} from '../discovery-cleanup-readback.mjs';

const honor='com.hihonor.android.launcher',weather='com.hihonor.android.totemweather',assistant='com.hihonor.assistant';
const original=readFileSync(new URL('./fixtures/honor-desktop-widgets-20261023.xml',import.meta.url));
const xml=packages=>'<hierarchy>'+packages.map(p=>`<node package="${p}"/>`).join('')+'</hierarchy>';
function rig(t,{launcher=honor,body=original}={}){
 const dir=mkdtempSync(join(tmpdir(),'honor-cleanup-widgets-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const run='honor_cleanup_regression',scope={run,run_id:'douyin_video_discovery-'+run+'__a1',source_commit:'a'.repeat(40),profile:'legacy',serial:'ANGYVB4402004137'},evidenceId=run+'-a1-cleanup-desktop';
 const pngFile=join(dir,evidenceId+'.png'),xmlFile=join(dir,evidenceId+'.xml');
 writeFileSync(pngFile,Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex'));writeFileSync(xmlFile,body);
 const request={runDir:dir,evidenceRoot:dir,scope,evidenceId,pngFile,xmlFile,close_stdout:'foreground=mCurrentFocus '+launcher+'/.Home',desktop_stdout:`launcher=${launcher}\nforeground_package=${launcher}\nforeground=mCurrentFocus ${launcher}/.Home`};
 return {dir,scope,request,capture:()=>captureCleanupReadback(request)};
}

test('原fd9 HONOR安全桌面XML含真实天气与助手widget，capture和独立verify均通过',t=>{
 assert.equal(createHash('sha256').update(original).digest('hex'),'aaff74158c940f567dedba44c8104baeba0dec8eb13f174acbd2f1eb70fe2561');
 const r=rig(t),proof=r.capture();assert.equal(proof.launcher,honor);assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope,digest:proof.digest}),true);
});
for(const widget of [weather,assistant])test('精确HONOR launcher允许原已证单个桌面widget：'+widget,t=>{
 const r=rig(t,{body:xml([honor,widget])}),proof=r.capture();assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope,digest:proof.digest}),true);
});
for(const [name,launcher,packages]of [
 ['其他launcher不能借用HONOR widgets','com.other.launcher',['com.other.launcher',weather,assistant]],
 ['伪HONOR子包不能借用widgets',honor+'.evil',[honor+'.evil',weather]],
 ['抖音foreign仍拒',honor,[honor,weather,assistant,'com.ss.android.ugc.aweme']],
 ['未证HONOR包仍拒',honor,[honor,weather,'com.hihonor.unknown.widget']],
])test(name,t=>{const r=rig(t,{launcher,body:xml(packages)});assert.throws(r.capture,/CLEANUP_NATIVE_READBACK_INVALID/);});

test('HONOR widgets不放宽前台/PNG/冻结scope/hash原守卫',t=>{
 const r=rig(t),proof=r.capture();
 assert.equal(verifyCleanupReadback({runDir:r.dir,scope:{...r.scope,serial:'OTHER'},digest:proof.digest}),false);
 writeFileSync(join(r.dir,'cleanup-readback','desktop.xml'),xml([honor,weather]));assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope,digest:proof.digest}),false);
 const foreground=rig(t);foreground.request.desktop_stdout=`launcher=${honor}\nforeground_package=com.ss.android.ugc.aweme\nforeground=mCurrentFocus com.ss.android.ugc.aweme/.Main`;assert.throws(foreground.capture,/CLEANUP_NATIVE_READBACK_INVALID/);
 const png=rig(t);writeFileSync(png.request.pngFile,'not-png');assert.throws(png.capture,/CLEANUP_NATIVE_READBACK_INVALID/);
});
