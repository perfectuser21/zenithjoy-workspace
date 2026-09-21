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
// 所以这里守的是一条死规矩：**判「已恢复」必须同时拿到正向和负向证据**。
//   · 正向：前台 Activity 确实是详情页（真机存在 DetailActivity 与 UltraDetailActivity
//     两种，硬编码单个必漏）
//   · 负向：树里没有暂存搜索框 et_search_kw
// 宁可误判成「没恢复」丢掉当前这一个视频，也绝不能误判成「已恢复」污染后面所有视频。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;

const PKG = 'com.ss.android.ugc.aweme';
const FG_DETAIL = `${PKG}/${PKG}.detail.ui.DetailActivity`;
const FG_ULTRA = `${PKG}/${PKG}.detail.ultra.ui.UltraDetailActivity`;
const FG_SEARCH = `${PKG}/${PKG}.search.activity.SearchResultActivity`;

/** 暂存搜索页：搜索框里躺着上一个视频的复制口令（取自真实证据 w12-v2-oc-before.xml） */
const XML_SCRATCH = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
  + `<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${PKG}" bounds="[0,0][1200,2664]">`
  + `<node index="0" text="" resource-id="${PKG}:id/bz9" class="android.widget.ImageView" content-desc="返回" bounds="[52,160][131,239]" />`
  + `<node index="1" text="9.76 复制打开抖音，看看【Brand财经社的作品】文科生的时代来了？ https://v.douyin.com/hoZAsb98YwY/ :5pm" `
  + `resource-id="${PKG}:id/et_search_kw" class="android.widget.EditText" focused="true" bounds="[144,134][846,265]" />`
  + `</node></hierarchy>`;

/** 搜索输入页：猜你想看 / 历史词（w12-v3、v4 落到的那个页面） */
const XML_SEARCH_HOME = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
  + `<node index="0" text="" class="android.widget.FrameLayout" package="${PKG}" bounds="[0,0][1200,2664]">`
  + `<node index="0" text="" resource-id="${PKG}:id/et_search_kw" class="android.widget.EditText" bounds="[144,134][846,265]" />`
  + `<node index="1" text="猜你想看" class="android.widget.TextView" bounds="[0,900][300,980]" />`
  + `<node index="2" text="展开更多历史" class="android.widget.TextView" bounds="[600,430][900,470]" />`
  + `</node></hierarchy>`;

/** 正常的视频详情页：右侧竖排有评论、有作者信息，没有搜索框 */
const XML_VIDEO_DETAIL = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
  + `<node index="0" text="" class="android.widget.FrameLayout" package="${PKG}" bounds="[0,0][1200,2664]">`
  + `<node index="0" text="" content-desc="评论" class="android.widget.ImageView" bounds="[1060,1590][1140,1670]" />`
  + `<node index="1" text="@Brand财经社" class="android.widget.TextView" bounds="[40,2300][500,2360]" />`
  + `<node index="2" text="1.0万" class="android.widget.TextView" bounds="[1070,1680][1130,1720]" />`
  + `</node></hierarchy>`;

function makeRegistry(dir) {
  const p = join(dir, 'douyin-phone-profiles.tsv');
  writeFileSync(p, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  return p;
}

/** 调 detail-restored 子命令：退出码 0 = 判已恢复，非 0 = 判未恢复 */
function restored(foreground, xml) {
  const dir = mkdtempSync(join(tmpdir(), 'vlrestore-'));
  const xmlPath = join(dir, 'ui.xml');
  writeFileSync(xmlPath, xml);
  return new Promise((resolve) => {
    const p = spawn('zsh', [SCRIPT, '--profile', 'legacy', 'detail-restored', foreground, xmlPath], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: makeRegistry(dir) },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test('暂存搜索页必须判成「没恢复」——这正是 0921 夜批整批 0 LEAD 的起点', async () => {
  const r = await restored(FG_SEARCH, XML_SCRATCH);
  assert.notEqual(r.code, 0,
    '取完链接后人还站在暂存搜索页却被判成已恢复 —— 后面每个视频都会在错的页面上瞎点');
});

test('只验包名不算数：抖音包名 + 搜索输入页 → 判没恢复', async () => {
  // 暂存搜索页、搜索输入页都是抖音自己的页面，包名一模一样。
  // 旧守卫 `foreground_package == *aweme*` 对这两个页面全部放行，这就是 bug 本体。
  const r = await restored(FG_SEARCH, XML_SEARCH_HOME);
  assert.notEqual(r.code, 0, '包名是抖音就判已恢复 —— 守卫等于没有');
});

test('真回到视频详情页（DetailActivity）→ 判已恢复', async () => {
  const r = await restored(FG_DETAIL, XML_VIDEO_DETAIL);
  assert.equal(r.code, 0, `正常恢复被判成失败会白丢视频: ${r.err}`);
});

test('UltraDetailActivity 也是详情页 —— 两种都得认，硬编码一种必漏', async () => {
  // 真机实证：同一条链上两台机分别落在 detail.ui.DetailActivity 与
  // detail.ultra.ui.UltraDetailActivity，只认其中一个会把正常恢复误判成失败。
  const r = await restored(FG_ULTRA, XML_VIDEO_DETAIL);
  assert.equal(r.code, 0, `UltraDetailActivity 没被认成详情页: ${r.err}`);
});

test('前台根本不是抖音 → 判没恢复', async () => {
  const r = await restored('com.hihonor.android.launcher/.unihome.UniHomeLauncher', XML_VIDEO_DETAIL);
  assert.notEqual(r.code, 0, '人已经被切出抖音了还判已恢复');
});

test('树文件读不到时判没恢复，不靠猜', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vlrestore-none-'));
  const r = await new Promise((resolve) => {
    const p = spawn('zsh', [SCRIPT, '--profile', 'legacy', 'detail-restored', FG_DETAIL, join(dir, 'missing.xml')], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: makeRegistry(dir) },
    });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err: err.trim() }));
  });
  assert.notEqual(r.code, 0, '拿不到树就该判没恢复——宁可丢一个视频也不能盲目继续');
});
