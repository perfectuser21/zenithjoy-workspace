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

test('接线守卫：重试耗尽后必须有确定性兜底重搜，不能只靠 back 键赌栈深度', () => {
  // 0929真机实证：单靠"多按几次返回键"赌不赢——实测按满4次后落在了跟本次
  // 搜索完全不相干的历史搜索页("会计信息系统生命周期")，说明长时间在线设备
  // 的 back 栈深度不可预期。必须有不依赖历史状态的确定性兜底：重新发起本次
  // 搜索的意图(deep link)，不是继续加大 back 次数。
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf('back_to_results() {');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  assert.match(body, /search\/tabs\?keyword=/,
    '重试耗尽后没有重新发起搜索意图兜底——单靠 back 键次数赌不赢深度不可预期的历史栈');
  assert.match(body, /recovered_via=research/,
    '兜底重搜成功时要显式标注 recovered_via，方便排障时区分"正常归位"和"靠重搜救回来的"');
});

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

test('接线守卫：harvest-keyword.sh 主循环全部归位调用必须全部走封装函数', () => {
  const kwPath = new URL('../harvest-keyword.sh', import.meta.url).pathname;
  const src = readFileSync(kwPath, 'utf8');
  // 主循环里所有归位动作都必须走 back_to_results_and_maybe_rescan(不能有裸调
  // $C ... back-to-results)——裸调不会在命中 recovered_via=research 时重扫卡片，
  // 会重新踩到"卡片坐标失效后仍在瞎点"这个问题(见下一条测试)。
  const bareCalls = (src.match(/^\s*\$C --profile "\$P" back-to-results[^\n]*/gm) || []);
  // 上面这个正则要求行首(允许前导空白)就是裸调——封装函数内部那一处是
  // `btr_out="$($C --profile "$P" back-to-results ...)"`，行首是 btr_out=，不匹配。
  assert.equal(bareCalls.length, 0,
    `harvest-keyword.sh 主循环里有裸调 back-to-results(没走封装函数)，命中兜底重搜时`
    + `不会重扫卡片: ${JSON.stringify(bareCalls)}`);

  const wrapperCalls = src.match(/back_to_results_and_maybe_rescan "\$TAG-v\$i-btr"/g) || [];
  // 0929 rebase到main后发现主分支并发合并的PR(#2011"先判后采")又新增了一处裸调用——
  // 数量断言故意留在这里而不是只判断">0"，就是为了让这类"新增调用点没跟上封装函数"
  // 的情况在CI里报红，不是宽松地"只要有一些走了封装函数就算过"。
  // 阶段3把评论打不开/零评论的提前归位并入提取函数后的统一尾部；
  // 图文、无身份、已采、判定不通过、采集返回这5个出口仍逐一受封装守卫。
  assert.equal(wrapperCalls.length, 5,
    `期望主循环5处归位调用都用封装函数，实际找到 ${wrapperCalls.length} 处`
    + `(数量对不上说明有调用点被漏改、或者脚本结构变了/main并发合并引入了新调用点，`
    + `需要人工核对每一处)`);
});

test('接线守卫：back_to_results_and_maybe_rescan 命中兜底重搜必须重扫卡片,重扫成功保留 i 从下一张继续', () => {
  const kwPath = new URL('../harvest-keyword.sh', import.meta.url).pathname;
  const src = readFileSync(kwPath, 'utf8');
  const start = src.indexOf('back_to_results_and_maybe_rescan() {');
  assert.ok(start > 0, '找不到 back_to_results_and_maybe_rescan 函数——被重构了？');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);

  assert.match(body, /recovered_via=research/,
    '没有检测 recovered_via=research——兜底重搜发生了也不知道，会继续拿旧坐标瞎点');
  assert.match(body, /search-video-cards/,
    '命中兜底重搜后没有重新扫描卡片——原坐标已经跟着重搜动作一起失效了');
  assert.match(body, /CARD_ARR=\(/,
    '没有把重扫结果写回 CARD_ARR——外层循环还是用着旧的失效坐标');
  // 0930 事故翻案: 原守卫要求重扫后 i=0 从头处理——同一搜索词+同筛选列表顺序稳定，从头处理
  // 等于把刚处理过的视频 1 再点一遍，取链接后又回不到结果页，形成死循环(真机三台各重扫 116~160 次)。
  // 现在要求: 重扫成功那一支绝不清零 i，且有重扫次数上限保证必然终止。
  const okStart = body.indexOf('if [[ -n "$newcards" ]]', body.indexOf('recovered_via=research'));
  const okEnd = body.indexOf('else', okStart);
  assert.ok(okStart > 0 && okEnd > okStart, '找不到重扫成功分支');
  assert.doesNotMatch(body.slice(okStart, okEnd), /\bi=0\b/,
    '重扫成功后把 i 清零从头处理——会把处理过的卡再点一遍，0930 夜间死循环就是这么来的');
  assert.match(body, /RESCANS > RESCAN_MAX/, '关键词重扫没有次数上限，无法保证必然终止');
  assert.match(src, /RESCAN_MAX="\$\{HARVEST_RESCAN_MAX:-3\}"/, '重扫上限默认值应为 3');
});

test('接线守卫：兜底重搜后重扫卡片前必须先切回视频tab(否则永远扫到0张)', () => {
  // 0929真机复现: douyin-phone-adb的兜底重搜只重新发起了open-search同等的搜索意图，
  // 落地页默认是"综合"tab不是"视频"tab。search-video-cards前置要求必须在视频tab
  // (见该子命令自己的注释)，不切tab直接扫永远是空结果——真机实测连续2个关键词
  // 都命中这条路径，"重新扫描未拿到卡片"。
  const kwPath = new URL('../harvest-keyword.sh', import.meta.url).pathname;
  const src = readFileSync(kwPath, 'utf8');
  const start = src.indexOf('back_to_results_and_maybe_rescan() {');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);

  // 只看真实调用行(以 $C ... 开头)，不被注释文本里提前出现的关键词误导
  const vtabIdx = body.indexOf('$C --profile "$P" search-video-tab');
  const scanIdx = body.indexOf('$C --profile "$P" search-video-cards');
  assert.ok(vtabIdx > 0, '兜底重搜命中后没有切回视频tab——重新扫描注定扫到0张卡片');
  assert.ok(vtabIdx < scanIdx, 'search-video-tab 必须在 search-video-cards 之前执行，顺序反了等于没切');
});
