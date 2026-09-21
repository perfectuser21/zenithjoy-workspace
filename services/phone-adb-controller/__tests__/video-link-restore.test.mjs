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
// 修法不是再发明一把尺子：函数**入口** _on_video_detail（分享按钮存在且可点）
// 一直在用，出口却换成了只验包名。这里把那把尺子抽成纯判定，入口出口同一把。
//
// ## fixtures/ 全是真机证据，不是编的
//
// 第一版实现拿「顶部有搜索框 et_search_kw」当负向判据，自造用例全绿；
// 拿真机证据一回放，**正常详情页也被判死**——从搜索结果页点进的视频详情页，
// 顶部本来就保留搜索框，这条判据在所有样本上区分度为零，会让每个视频都跳过，
// 比原 bug 更糟。所以这里的 fixture 一律取自 evidence 目录的原始 dump。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const PKG = 'com.ss.android.ugc.aweme';

// douyin-phone-adb 是 zsh 脚本。缺 zsh 时**报红而不是 skip**——
// 一个在 CI 里永远跳过的守卫等于没有守卫，而它恰恰是这里最不能出的事
// （CI 装 zsh 的步骤在 .github/workflows/ci-l3-code.yml 的 openclaw-scripts-test）。
test('前置：zsh 可用（缺了就报红，绝不静默跳过）', () => {
  const r = spawnSync('zsh', ['-c', 'exit 0']);
  assert.equal(r.error, undefined,
    '没有 zsh —— 本文件所有守卫都会静默失效，请在 CI 里装上（别改成 skip）');
});

function makeRegistry(dir) {
  const p = join(dir, 'douyin-phone-profiles.tsv');
  writeFileSync(p, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  return p;
}

/** 调 detail-restored 子命令：退出码 0 = 判已恢复，非 0 = 判未恢复 */
function judge(xmlPath) {
  const dir = mkdtempSync(join(tmpdir(), 'vlrestore-'));
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

const fixture = (name) => join(FIXTURES, name);

/** 合成树：只用于真机样本覆盖不到的边界（如"分享按钮还没变可点"） */
const synth = (inner) => {
  const dir = mkdtempSync(join(tmpdir(), 'vlsynth-'));
  const p = join(dir, 'ui.xml');
  writeFileSync(p, `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
    + `<node index="0" text="" class="android.widget.FrameLayout" package="${PKG}" bounds="[0,0][1200,2664]">`
    + inner + `</node></hierarchy>`);
  return p;
};

// ── 真机证据回放 ──────────────────────────────────────────────────────────

test('真机证据：取完链接后停在暂存解析页 → 判没恢复（整批 0 LEAD 的起点）', async () => {
  // fixture = auto09212230-w12-v2-oc-before.xml 原样：搜索框里躺着 v1 的复制口令
  // 「9.76 复制打开抖音…https://v.douyin.com/hoZAsb98YwY/」，focused=true。
  // 当晚它被「只验包名」的守卫放行，v2/v3/v4 于是全在这个页面上瞎点。
  const r = await judge(fixture('scratch-page-after-link-copy.xml'));
  assert.notEqual(r.code, 0, '人还站在暂存解析页却被判成已恢复');
  assert.match(r.err, /scratch search box still holds the copied link/);
});

test('真机证据：搜索输入页 → 判没恢复（w12 的 v3/v4 就落在这里）', async () => {
  // fixture = auto09212230-w12-v3-oc-before.xml 原样（猜你想看 / 展开更多历史）
  const r = await judge(fixture('search-home-page.xml'));
  assert.notEqual(r.code, 0, '搜索输入页被判成视频详情页');
  assert.match(r.err, /share button absent/);
});

test('真机证据：从搜索结果进入的视频详情页 → 判已恢复', async () => {
  // fixture = backprobe-v1-vl-detail-guard-w1.xml 原样。
  // ⚠️ 这张树**顶部同样有 et_search_kw**——第一版实现正是栽在这里：
  // 拿"有搜索框"当否决条件，会把每一个正常视频都判死。
  const r = await judge(fixture('video-detail-from-search.xml'));
  assert.equal(r.code, 0, `正常详情页被判成失败会让每个视频都白丢: ${r.err}`);
});

test('顶部搜索框本身绝不能成为否决理由（真机样本里它无处不在）', async () => {
  const detail = readFileSync(fixture('video-detail-from-search.xml'), 'utf8');
  assert.ok(detail.includes('et_search_kw'),
    'fixture 变了：这条守卫的前提是「正常详情页也带搜索框」，没有就失去意义');
  assert.equal((await judge(fixture('video-detail-from-search.xml'))).code, 0);
});

// ── 合成边界（真机样本覆盖不到的） ────────────────────────────────────────

test('分享按钮还不可点 → 判没恢复：页面还在加载，这时点下去是空点', async () => {
  const r = await judge(synth(`<node index="0" text="" content-desc="分享，按钮" `
    + `class="android.widget.ImageView" clickable="false" bounds="[1060,1890][1140,1970]" />`));
  assert.notEqual(r.code, 0, 'clickable=false 的分享按钮被当成详情页就绪');
  assert.match(r.err, /not clickable yet/);
});

test('分享按钮在、但搜索框里还装着抖音短链 → 判没恢复：负向一票否决', async () => {
  const r = await judge(synth(`<node index="0" content-desc="分享6379，按钮" clickable="true" bounds="[1060,1890][1140,1970]" />`
    + `<node index="1" text="9.76 复制打开抖音 https://v.douyin.com/hoZAsb98YwY/" `
    + `resource-id="${PKG}:id/et_search_kw" class="android.widget.EditText" bounds="[144,134][846,265]" />`));
  assert.notEqual(r.code, 0, '两页叠着没退干净却判成已恢复');
});

test('树文件读不到时判没恢复，且说明是「读不到」不是「在暂存页」', async () => {
  // 断言到具体原因，这条才抓得住"去掉可读性检查"的变异：不然 grep 对不存在的文件
  // 本就会失败，判定顺带返回非 0，测试永远是绿的（假绿）。
  const dir = mkdtempSync(join(tmpdir(), 'vlmissing-'));
  const r = await judge(join(dir, 'nope.xml'));
  assert.notEqual(r.code, 0, '拿不到树就该判没恢复——宁可丢一个视频也不能盲目继续');
  assert.match(r.err, /ui tree unreadable/, `没说明是树读不到: ${r.err}`);
});

// ── 接线守卫 ──────────────────────────────────────────────────────────────
// 上面那些锁的是「判定对不对」。但本 bug 的形状恰恰是：判定能力一直都在
// （入口 _on_video_detail 用的就是它），**出口没用它**。只测判定函数是漏的——
// 把恢复段改回「不验证直接判成功」，上面每一条依然全绿。
test('接线守卫：deep link 恢复段必须真的调判定，不能只验包名', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf('if [[ "$content_type" == "video" ]]; then');
  assert.ok(start > 0, '没找到 deep link 恢复段——函数被重构了？这条守卫要跟着改');
  const end = src.indexOf('\n  else\n', start);
  assert.ok(end > start, '恢复段结构变了');
  const branch = src.slice(start, end);

  assert.match(branch, /am start .*android\.intent\.action\.VIEW/, '恢复段不再用 deep link 重开？');
  assert.match(branch, /_is_video_detail_xml/,
    'deep link 重开后没有用判定函数验证——这就是 0921 整批 0 LEAD 的原样复现');
  assert.match(branch, /die .*did not restore/,
    '验证没过却不 die：调用方大多 `|| true` 吞返回值，静默放行等于把后面每个视频一起拖下水');
});
