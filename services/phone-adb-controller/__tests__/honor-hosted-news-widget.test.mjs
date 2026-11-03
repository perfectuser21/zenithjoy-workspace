import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureCleanupReadback,verifyCleanupReadback} from '../discovery-cleanup-readback.mjs';

const launcher='com.hihonor.android.launcher',news='com.ss.android.article.news';
// 本次实机层级与坐标；省略正文、个人图标和无关属性。
const hosted=`<hierarchy><node class="android.widget.FrameLayout" package="${launcher}" bounds="[0,0][1200,2664]"><node class="com.hihonor.uikit.hwscrollview.widget.HwScrollView" package="${launcher}" resource-id="${launcher}:id/workspace" bounds="[0,0][1200,2664]"><node class="android.view.ViewGroup" package="${launcher}" resource-id="${launcher}:id/workspace_screen" bounds="[0,0][1200,2241]"><node class="android.appwidget.AppWidgetHostView" package="${launcher}" bounds="[40,1877][320,2209]"><node class="android.widget.RelativeLayout" package="${news}" bounds="[78,1915][281,2170]"><node class="android.widget.TextView" package="${news}" bounds="[101,2107][257,2163]"/></node></node></node></node></node></hierarchy>`;
function rig(t,xml){
 const dir=mkdtempSync(join(tmpdir(),'hosted-news-widget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const run='hosted_widget',scope={run,run_id:'douyin_video_discovery-'+run+'__a1',source_commit:'a'.repeat(40),profile:'xiaolongxia',serial:'ANGYVB4311010223'},evidenceId=run+'-a1-cleanup-desktop';
 const pngFile=join(dir,evidenceId+'.png'),xmlFile=join(dir,evidenceId+'.xml');
 writeFileSync(pngFile,Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex'));writeFileSync(xmlFile,xml);
 const request={runDir:dir,evidenceRoot:dir,scope,evidenceId,pngFile,xmlFile,close_stdout:'foreground=mCurrentFocus '+launcher+'/.Home',desktop_stdout:`launcher=${launcher}\nforeground_package=${launcher}\nforeground=mCurrentFocus ${launcher}/.Home`};
 return {dir,scope,request,capture:()=>captureCleanupReadback(request)};
}
test('实机荣耀工作区托管头条widget可完成capture与独立读回',t=>{
 const r=rig(t,hosted),proof=r.capture();
 assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope,digest:proof.digest}),true);
 writeFileSync(r.request.xmlFile,'<hierarchy/>');
 // 原件已归档，独立读回不依赖可变的输入文件。
 assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope,digest:proof.digest}),true);
 writeFileSync(join(r.dir,'cleanup-readback','desktop.xml'),hosted.replace(news,'com.ss.android.ugc.aweme'));
 assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope,digest:proof.digest}),false);
});
for(const [name,xml] of [
 ['独立头条窗口',`<hierarchy><node package="${launcher}"/><node package="${news}"/></hierarchy>`],
 ['有效widget旁的头条覆盖窗口',hosted.replace('</hierarchy>',`<node package="${news}" bounds="[0,0][1200,2664]"/></hierarchy>`)],
 ['伪造widget类名',hosted.replace('android.appwidget.AppWidgetHostView','android.widget.FrameLayout')],
 ['缺工作区锚',hosted.replace(':id/workspace_screen',':id/other')],
 ['伪造外部host',hosted.replace(`class="android.appwidget.AppWidgetHostView" package="${launcher}"`,`class="android.appwidget.AppWidgetHostView" package="${news}"`)],
 ['越出host边界',hosted.replace('[101,2107][257,2163]','[0,0][1200,2664]')],
 ['缺host边界',hosted.replace(' bounds="[40,1877][320,2209]"','')],
 ['抖音伪装成widget',hosted.replaceAll(news,'com.ss.android.ugc.aweme')],
 ['未证第三方widget',hosted.replaceAll(news,'com.other.widget')],
 ['另一launcher借用例外',hosted.replaceAll(launcher,'com.other.launcher')],
])test('托管widget例外仍拒绝'+name,t=>{const r=rig(t,xml);assert.throws(r.capture,/CLEANUP_NATIVE_READBACK_INVALID/);});
