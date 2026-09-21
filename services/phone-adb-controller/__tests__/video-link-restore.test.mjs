// services/phone-adb-controller/__tests__/video-link-restore.test.mjs
//
// 「取完作品链接后，人到底回没回到视频详情页」的判定守卫。
//
// 0921 夜批 auto09212230 实证：current_video_link 用 deep link 重开视频后，
// 收尾守卫写的是 `[[ "$(foreground_package)" == *抖音包名* ]]`——**只验包名**。
// deep link 没生效时，人还停在「暂存搜索页」（复制链接后用来粘贴解析的那个搜索框），
// 而它同样是抖音包名，于是守卫放行、函数返回成功。
//
// 调用方 harvest-keyword.sh 据此以为已回到视频页，back 一次落到搜索输入页，
// 此后每个视频的 tap 坐标都打在错的页面上 —— w12 的 v2/v3/v4 连续三次
// 「评论区打不开」，整批 0 LEAD。
//
// 修法的关键不是再发明一把尺子：函数**入口**早就用 `_on_video_detail`
// （分享按钮存在且可点）判过"在不在详情页"，出口却换成了只验包名。
// 这里把那把尺子抽成纯判定并补上负向证据（树里不能有暂存搜索框 et_search_kw），
// 入口出口从此同一把尺。
//
// 宁可误判成「没恢复」丢掉当前这一个视频，也绝不能误判成「已恢复」污染后面所有视频。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const PKG = 'com.ss.android.ugc.aweme';

const wrap = (inner) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
  + `<node index="0" text="" class="android.widget.FrameLayout" package="${PKG}" bounds="[0,0][1200,2664]">`
  + inner + `</node></hierarchy>`;

/** 详情页右侧竖排的分享按钮——入口 _on_video_detail 用的就是这个判据 */
const SHARE_BTN = `<node index="0" text="" content-desc="分享6379，按钮" class="android.widget.ImageView" `
  + `clickable="true" bounds="[1060,1890][1140,1970]" />`;

/** 暂存搜索框：取自真实证据 auto09212230-w12-v2-oc-before.xml */
const SCRATCH_BOX = `<node index="1" text="9.76 复制打开抖音，看看【Brand财经社的作品】文科生的时代来了？ `
  + `https://v.douyin.com/hoZAsb98YwY/ :5pm" resource-id="${PKG}:id/et_search_kw" `
  + `class="android.widget.EditText" focused="true" bounds="[144,134][846,265]" />`;

const XML_VIDEO_DETAIL = wrap(SHARE_BTN
  + `<node index="1" text="@Brand财经社" class="android.widget.TextView" bounds="[40,2300][500,2360]" />`);

const XML_SCRATCH = wrap(`<node index="0" text="" resource-id="${PKG}:id/bz9" content-desc="返回" `
  + `class="android.widget.ImageView" bounds="[52,160][131,239]" />` + SCRATCH_BOX);

const XML_SEARCH_HOME = wrap(`<node index="0" text="" resource-id="${PKG}:id/et_search_kw" `
  + `class="android.widget.EditText" bounds="[144,134][846,265]" />`
  + `<node index="1" text="猜你想看" class="android.widget.TextView" bounds="[0,900][300,980]" />`
  + `<node index="2" text="展开更多历史" class="android.widget.TextView" bounds="[600,430][900,470]" />`);

/** 分享按钮在、但暂存搜索框也在（页面叠着没退干净） */
const XML_BOTH = wrap(SHARE_BTN + SCRATCH_BOX);

/** 分享按钮存在但不可点：页面还在加载，此时点下去就是空点 */
const XML_SHARE_NOT_CLICKABLE = wrap(`<node index="0" text="" content-desc="分享，按钮" `
  + `class="android.widget.ImageView" clickable="false" bounds="[1060,1890][1140,1970]" />`);

function makeRegistry(dir) {
  const p = join(dir, 'douyin-phone-profiles.tsv');
  writeFileSync(p, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  return p;
}

/** 调 detail-restored 子命令：退出码 0 = 判已恢复，非 0 = 判未恢复 */
function restored(xml, { writeFile = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vlrestore-'));
  const xmlPath = join(dir, 'ui.xml');
  if (writeFile) writeFileSync(xmlPath, xml);
  return new Promise((resolve) => {
    const p = spawn('zsh', [SCRIPT, '--profile', 'legacy', 'detail-restored', xmlPath], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: makeRegistry(dir) },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test('暂存搜索页必须判成「没恢复」——这正是 0921 夜批整批 0 LEAD 的起点', async () => {
  const r = await restored(XML_SCRATCH);
  assert.notEqual(r.code, 0,
    '取完链接后人还站在暂存搜索页却被判成已恢复 —— 后面每个视频都会在错的页面上瞎点');
});

test('搜索输入页也判没恢复（w12 的 v3/v4 就落在这里）', async () => {
  const r = await restored(XML_SEARCH_HOME);
  assert.notEqual(r.code, 0, '搜索输入页被判成视频详情页');
});

test('分享按钮在、暂存搜索框也在 → 判没恢复：负向证据一票否决', async () => {
  // 只看正向判据（有分享按钮）会把这种"页面叠着没退干净"的状态放行。
  // 树里只要还有 et_search_kw，就说明人没真正离开暂存搜索页。
  const r = await restored(XML_BOTH);
  assert.notEqual(r.code, 0, '树里还有暂存搜索框却判成已恢复');
});

test('分享按钮不可点 → 判没恢复：页面还在加载，这时点下去是空点', async () => {
  const r = await restored(XML_SHARE_NOT_CLICKABLE);
  assert.notEqual(r.code, 0, 'clickable=false 的分享按钮被当成详情页就绪');
});

test('真回到视频详情页 → 判已恢复', async () => {
  const r = await restored(XML_VIDEO_DETAIL);
  assert.equal(r.code, 0, `正常恢复被判成失败会白丢视频: ${r.err}`);
});

test('树文件读不到时判没恢复，不靠猜', async () => {
  const r = await restored('', { writeFile: false });
  assert.notEqual(r.code, 0, '拿不到树就该判没恢复——宁可丢一个视频也不能盲目继续');
});
