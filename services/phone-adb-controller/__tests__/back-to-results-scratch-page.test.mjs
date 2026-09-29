// services/phone-adb-controller/__tests__/back-to-results-scratch-page.test.mjs
//
// back_to_results 误判"暂存草稿页"为"真搜索结果页"的判定守卫。
//
// 0929 真机实证(xian-m4, legacy账号, 关键词"人工智能")：手动复现"点开卡1→
// current-video-link取链接→back_to_results→重新扫描卡片"全流程，
// back_to_results 报告 back_to_results=1 backs=1（自认成功），但重新扫描
// 拿到的 UI 树 fixture(real-search-results-grid.xml 之外的那份，见下)跟
// current-video-link 内部草稿页解析步骤的 UI 树**逐字节完全相同**——证明
// back_to_results 判"到位了"的那一刻，人根本没离开过草稿页。
//
// 根因：`_is_search_results_fg` 只判"是不是搜索结果这一类 Activity"——草稿页
// (current-video-link 内部用 search/tabs?keyword=%20 打开、用来粘贴剪贴板解析
// 短链的临时页)跟真结果页是**同一个 Activity**，包名+Activity名完全无法区分。
// 12个关键词的真实 batch2.sh 日志显示：每个词4张卡片，卡1能处理，卡2/3/4
// **100%**报"视频链接解析失败(VID=空 VURL=空)"——因为 back_to_results 提前
// 报告成功，调用方复用的还是最初扫描时记下的坐标，点在了草稿页上。
//
// 修法：新增纯判定 _search_kw_matches(关键词, UI树) —— 真结果页搜索框里是干净
// 的原始关键词（如"人工智能"）；草稿页搜索框里是一整段分享文案+短链+追踪码
// （如"6.43 复制打开抖音，看看【作者】标题... https://v.douyin.com/xxx ..."）。
// back_to_results 传入关键词时，Activity 判真之后再核一遍这把尺子，两关都过
// 才算真的回到结果页。
//
// ## fixtures/ 全是真机证据，不是编的
// real-search-results-grid.xml / scratch-page-after-back-to-results.xml
// 都是 2026-09-29 在 xian-m4 legacy 账号上手动复现时的原始 dump，
// 后者跟 current-video-link 内部草稿页解析步骤的 UI 树逐字节相同。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;

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

/** 调 search-kw-matches 子命令：退出码 0 = 判匹配，非 0 = 判不匹配 */
function judge(keyword, xmlPath) {
  const dir = mkdtempSync(join(tmpdir(), 'kwmatch-'));
  return new Promise((resolve) => {
    const p = spawn('zsh', [SCRIPT, '--profile', 'legacy', 'search-kw-matches', keyword, xmlPath], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: makeRegistry(dir) },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

const fixture = (name) => join(FIXTURES, name);

// ── 真机证据回放 ──────────────────────────────────────────────────────────

test('真机证据：草稿解析页(back_to_results曾在此误判成功) → 判不匹配', async () => {
  // fixture = 0929真机复现，跟 current-video-link 内部草稿页解析步骤的 UI 树
  // 逐字节相同。搜索框里是分享文案+短链+追踪码，不是干净的原始关键词。
  const r = await judge('人工智能', fixture('scratch-page-after-back-to-results.xml'));
  assert.notEqual(r.code, 0, '草稿页被判成搜索框文字匹配关键词');
  assert.equal(r.out, 'kw_matches=0');
});

test('真机证据：真结果页(关键词"人工智能") → 判匹配', async () => {
  // fixture = 0929真机复现，正常搜索"人工智能"后的结果页，搜索框里是干净关键词。
  const r = await judge('人工智能', fixture('real-search-results-grid.xml'));
  assert.equal(r.code, 0, `真结果页被判成不匹配会让 back_to_results 白白多退好几次: ${r.err}`);
  assert.equal(r.out, 'kw_matches=1');
});

test('真结果页拿错误关键词去核对 → 判不匹配（防止判据形同虚设）', async () => {
  // 用真结果页的 fixture，但故意传一个不对的关键词——确认判据真的在比较文字，
  // 不是随便过。
  const r = await judge('失业了学什么技术', fixture('real-search-results-grid.xml'));
  assert.notEqual(r.code, 0, '传错关键词还能判匹配，说明判据没有真的在比较');
  assert.equal(r.out, 'kw_matches=0');
});

test('搜索框节点读不到时判不匹配，不是误判成功（宁可多退几次，不能假阳性）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kwmissing-'));
  const p = join(dir, 'ui.xml');
  writeFileSync(p, `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">`
    + `<node index="0" text="" class="android.widget.FrameLayout" bounds="[0,0][1200,2664]" /></hierarchy>`);
  return judge('人工智能', p).then((r) => {
    assert.notEqual(r.code, 0, '树里没有搜索框节点却判成匹配');
    assert.equal(r.out, 'kw_matches=0');
  });
});

test('UI 树文件读不到时判不匹配（拿不到证据宁可多退，不能盲目放行）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kwnope-'));
  const r = await judge('人工智能', join(dir, 'nope.xml'));
  assert.notEqual(r.code, 0, '拿不到树就该判不匹配');
  assert.equal(r.out, 'kw_matches=0');
});

// ── 接线守卫 ──────────────────────────────────────────────────────────────
// 上面锁的是"判定对不对"。但本 bug 的形状恰恰是：判定能力可以有，出口没接线，
// 只测判定函数是漏的——把 back_to_results 的关键词核对段删掉，上面每一条依然全绿。

test('接线守卫：back_to_results 传了关键词时必须真的调用 _search_kw_matches', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf('back_to_results() {');
  assert.ok(start > 0, '没找到 back_to_results 函数——被重构了？这条守卫要跟着改');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, '函数结构变了');
  const body = src.slice(start, end);

  assert.match(body, /_search_kw_matches/,
    'back_to_results 内部没有调用 _search_kw_matches——这就是本 bug 的原样复现: '
    + '只验 Activity 类型，分不清真结果页和草稿页');
  assert.match(body, /_ui_evidence_wave/,
    '核对关键词前必须先真的 dump 一份 UI 树，不能凭空判断');
});

test('接线守卫：harvest-keyword.sh 里 back-to-results 调用必须带上 $KWTXT', () => {
  const kwPath = new URL('../harvest-keyword.sh', import.meta.url).pathname;
  const src = readFileSync(kwPath, 'utf8');
  // 只匹配真正的调用行(以 $C ... back-to-results 开头)，不匹配注释里提到
  // "back-to-results"这个词的说明文字。
  const calls = src.match(/\$C --profile "\$P" back-to-results[^\n]*/g) || [];
  assert.ok(calls.length > 0, 'harvest-keyword.sh 里找不到 back-to-results 调用——脚本被重构了？');
  const withoutKeyword = calls.filter((line) => !line.includes('$KWTXT'));
  assert.equal(withoutKeyword.length, 0,
    `harvest-keyword.sh 里有 back-to-results 调用没传 $KWTXT，退回去时不会核实关键词，`
    + `会重新踩到本 bug: ${JSON.stringify(withoutKeyword)}`);
});
