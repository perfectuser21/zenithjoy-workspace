// services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs
//
// 归位根因守卫（0930，任务 45ee7653，决策 f425e3fd）。
//
// 0930 凌晨批 cmd09300230 实证：134 个视频 134 次「归位触发兜底重搜」，%C&A=0，12 词跑了
// 近 6 小时只出 4 条线索。真机探针（probe3）实锤根因：current-video-link 取链接的办法是
// 「分享→复制链接→deep link 打开一个空关键词的暂存搜索页→把剪贴板粘进搜索框解析」，
// 解析完之后它用 **另一个 deep link 重开视频详情页**——暂存搜索页（含键盘/输入页/空词结果页
// 三层）就这样留在返回栈里，压在原来那张视频详情页上面。于是采完评论后 back_to_results
// 按 4 次返回全落在暂存页上（搜索框里是分享文案，不是关键词），只能走 1.5-3 分钟的兜底重搜。
//
// 修法：解析完剪贴板后先按返回**退出暂存路线**，退到「打开暂存页之前的那张视频详情页」
// （用入口同一把尺子 _is_video_detail_xml 核验），退不回去才退回原来的 deep link 重开。
// 这样栈里只剩 结果页→详情页，back_to_results 一次返回就到。
//
// 这里用一台"假手机"（DOUYIN_ADB_BIN）把返回栈模型化：暂存路线按真机实测占 3 次返回。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
const execute = promisify(execFile);
import { writeFileSync, mkdtempSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const PKG = 'com.ss.android.ugc.aweme';
const KW = '人工智能';
const LINK = 'https://v.douyin.com/AbC123xyz/';

test('前置：zsh 可用（缺了就报红，绝不静默跳过）', () => {
  assert.equal(spawnSync('zsh', ['-c', 'exit 0']).error, undefined, '没有 zsh —— 本文件所有守卫都会静默失效');
});

const NODE_TAIL = 'class="android.widget.EditText" package="com.ss.android.ugc.aweme" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[120,120][1000,200]" />';
const XML_HEAD = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${PKG}" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1200,2664]">`;
const SHARE_BTN = `<node index="3" text="" resource-id="" class="android.widget.ImageView" package="${PKG}" content-desc="分享，按钮" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[1080,1500][1180,1600]" />`;
// 从结果页点进的视频详情页：顶部保留搜索框（装着原关键词）+ 分享按钮 + 播放键
// （播放键 content-desc 反映当前状态：「暂停视频，按钮」=已暂停，「播放视频，按钮」=在播放，0930 真机证据）
const playBtn = (state) => `<node index="4" text="" resource-id="" class="android.widget.ImageView" package="${PKG}" content-desc="${state === 'paused' ? '暂停视频' : '播放视频'}，按钮" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[560,1200][640,1280]" />`;
const detailXml = (state) => `${XML_HEAD}<node index="1" text="${KW}" resource-id="${PKG}:id/et_search_kw" ${NODE_TAIL}${SHARE_BTN}${playBtn(state)}</node></hierarchy>`;
// 分享面板：分享给 / 分享链接
const PANEL_XML = `${XML_HEAD}${SHARE_BTN}<node index="5" text="分享给" resource-id="" class="android.widget.TextView" package="${PKG}" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,1900][300,1960]" /><node index="6" text="分享链接" resource-id="" class="android.widget.TextView" package="${PKG}" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,2300][300,2360]" /></node></hierarchy>`;
// 暂存解析页：搜索框里是整段分享文案+短链，没有分享按钮、没有卡片
const SCRATCH_XML = `${XML_HEAD}<node index="1" text="8.28 复制打开抖音，看看【测试的作品】人工智能怎么学... ${LINK} :4pm 02/25 aNw:/ i@C.hb " resource-id="${PKG}:id/et_search_kw" ${NODE_TAIL}</node></hierarchy>`;
const FEED_XML = `${XML_HEAD}</node></hierarchy>`;

/**
 * 假手机：文件里存返回栈（每行一个页面，末行=顶）。
 *  results   → SearchResultActivity，dump=真结果页 fixture（关键词 人工智能）
 *  detail    → DetailActivity，dump=详情页；点分享→面板→点分享链接
 *  scratch_res/scratch_input/scratch_kbd → SearchResultActivity（暂存路线三层），dump=暂存页
 *  detail2   → deep link 重开的详情页
 *  feed      → MainActivity
 *  am start search/tabs?keyword=%20 → 压入三层暂存；am start aweme/detail → 压 detail2；
 *  am start search/tabs?keyword=<词> → 压 results（兜底重搜）；keyevent 4 → 出栈一层
 *  scratchPopTo: 暂存路线退完落在哪（默认 detail；'feed' 模拟退飞了）
 */
function makeFakePhone({ scratchPopTo = 'detail', playState = 'paused', centreNavigates = false, scratchLayers = 3 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cvl-leave-'));
  mkdirSync(join(dir, 'fx'));
  writeFileSync(join(dir, 'fx', 'detail.xml'), detailXml(playState));
  writeFileSync(join(dir, 'fx', 'panel.xml'), PANEL_XML);
  writeFileSync(join(dir, 'fx', 'scratch.xml'), SCRATCH_XML);
  writeFileSync(join(dir, 'fx', 'feed.xml'), FEED_XML);
  copyFileSync(join(FIXTURES, 'real-search-results-grid.xml'), join(dir, 'fx', 'results.xml'));
  writeFileSync(join(dir, 'fx', 'shot.png'), 'png');
  const stack = join(dir, 'stack');
  writeFileSync(stack, 'results\ndetail\n');
  writeFileSync(join(dir, 'panel'), '0');
  writeFileSync(join(dir, 'taps'), '0');
  writeFileSync(join(dir, 'deeplinks'), '0');
  writeFileSync(join(dir, 'media'), '0');
  writeFileSync(join(dir, 'centre'), '0');
  const reg = join(dir, 'r.tsv');
  writeFileSync(reg, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  const curl = join(dir, 'curl');
  writeFileSync(curl, `#!/bin/sh\nprintf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.douyin.com/video/7000000000000000001?previous_page=app_code_link\\r\\n\\r\\n'\n`, { mode: 0o755 });
  const adb = join(dir, 'adb');
  writeFileSync(adb, `#!/bin/sh
D=${dir}
top() { tail -n 1 "$D/stack"; }
pop() { n=$(wc -l < "$D/stack"); head -n $((n-1)) "$D/stack" > "$D/stack.new"; mv "$D/stack.new" "$D/stack"; }
push() { echo "$1" >> "$D/stack"; }
case "$*" in
  *get-state*) echo device ;;
  *getprop*) echo ANY-MODEL ;;
  *"am start"*"search/tabs?keyword=%20"*) [ ${scratchLayers} = 3 ] && push scratch_res; push scratch_input; push scratch_kbd ;;
  *"am start"*"search/tabs?keyword="*) push results ;;
  *"am start"*"aweme/detail/"*) n=$(cat "$D/deeplinks"); echo $((n+1)) > "$D/deeplinks"; push detail2 ;;
  *"input keyevent 4"*)
      t=$(top)
      if [ "$t" = "scratch_res" ] && [ "${scratchPopTo}" != "detail" ]; then
        pop; pop; push ${scratchPopTo}
      else
        pop
      fi ;;
  *"input keyevent 85"*)
      n=$(cat "$D/media"); echo $((n+1)) > "$D/media" ;;
  *"input tap"*)
      set -- $*; x=$6; y=$7
      t=$(top)
      if [ "$t" = "detail" ] || [ "$t" = "detail2" ]; then
        n=$(cat "$D/taps"); n=$((n+1)); echo $n > "$D/taps"
        if [ "$x" = "600" ] && [ "$y" = "1198" ]; then
          n=$(cat "$D/centre"); echo $((n+1)) > "$D/centre"
          if [ "${centreNavigates}" = "true" ]; then push visual_search; fi
        elif [ "$x" = "1130" ] && [ "$y" = "1550" ]; then
          echo 1 > "$D/panel"
        elif [ "$x" = "170" ] && [ "$y" = "2204" ]; then
          echo 0 > "$D/panel"
        fi
      fi ;;
  *"uiautomator dump"*)
      t=$(top)
      case "$t" in
        results) f=results.xml ;;
        detail|detail2) if [ "$(cat "$D/panel")" = "1" ]; then f=panel.xml; else f=detail.xml; fi ;;
        scratch_*) f=scratch.xml ;;
        *) f=feed.xml ;;
      esac
      cp "$D/fx/$f" "$D/remote.xml" ;;
  *"stat -c %s"*) wc -c < "$D/remote.xml" | tr -d ' ' ;;
  *screencap*) cp "$D/fx/shot.png" "$D/remote.png" ;;
  *" pull "*)
      set -- $*
      while [ "$1" != "pull" ]; do shift; done
      case "$2" in *.xml) cp "$D/remote.xml" "$3" ;; *) cp "$D/remote.png" "$3" ;; esac ;;
  *dumpsys*)
      case "$(top)" in
        results|scratch_*) echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.search.activity.SearchResultActivity}" ;;
        detail|detail2)    echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.detail.ui.DetailActivity}" ;;
        *)                 echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.main.MainActivity}" ;;
      esac ;;
  *) : ;;
esac
exit 0
`, { mode: 0o755 });
  const env = { ...process.env, HOME: dir, DOUYIN_PHONE_REGISTRY: reg, DOUYIN_ADB_BIN: adb, DOUYIN_CURL_BIN: curl, DOUYIN_SIPS_BIN: '/usr/bin/true', DOUYIN_PHONE_TMP_ROOT: join(dir, 'tmp') };
  const run = (args) => {
    const r = spawnSync('zsh', [SCRIPT, '--profile', 'legacy', ...args], { env, encoding: 'utf8', timeout: 180000 });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  return {
    run,
    dir,
    async runNetwork(args, curlPath) {
      try {
        const r = await execute('zsh', [SCRIPT, '--profile', 'legacy', ...args], {
          env: { ...env, DOUYIN_CURL_BIN: curlPath }, timeout: 20000,
        });
        return { code: 0, out: r.stdout.trim(), err: r.stderr.trim() };
      } catch (r) {
        return { code: r.code, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
      }
    },
    stack: () => readFileSync(stack, 'utf8').trim().split('\n'),
    deeplinks: () => Number(readFileSync(join(dir, 'deeplinks'), 'utf8').trim()),
    taps: () => Number(readFileSync(join(dir, 'taps'), 'utf8').trim()),
    media: () => Number(readFileSync(join(dir, 'media'), 'utf8').trim()),
    centre: () => Number(readFileSync(join(dir, 'centre'), 'utf8').trim()),
  };
}

test('取完链接后返回栈只剩 结果页→详情页（暂存路线已退干净，不再 deep link 重开）', () => {
  const ph = makeFakePhone();
  const r = ph.run(['current-video-link', 'cvl1']);
  assert.equal(r.code, 0, `current-video-link 失败: ${r.err}`);
  assert.match(r.out, /video_id=7000000000000000001/, r.out);
  assert.deepEqual(ph.stack(), ['results', 'detail'],
    `暂存路线没退干净/多压了一层，栈=${ph.stack().join('>')}——这就是 back_to_results 次次走兜底重搜的根因`);
  assert.equal(ph.deeplinks(), 0, '正常路径不该再用 deep link 重开视频（它把暂存页留在栈里）');
});

test('取完链接后 back-to-results 一次返回就到结果页，不触发兜底重搜', () => {
  const ph = makeFakePhone();
  assert.equal(ph.run(['current-video-link', 'cvl2']).code, 0);
  const r = ph.run(['back-to-results', '4', KW, 'btr2']);
  assert.equal(r.code, 0, `back-to-results 失败: ${r.err}`);
  assert.doesNotMatch(r.out, /recovered_via=research/, `还在走兜底重搜: ${r.out}`);
  assert.match(r.out, /backs=1\b/, `应一次返回即到结果页: ${r.out}`);
});

test('退回原详情页后按状态恢复播放：暂停态用媒体键恢复，已在播放不再切换', () => {
  // 0930 fixtest-rc 实证：退回来的原页保留着取链接前被暂停的状态，多点一次 → 录到 -91 dB 死寂。
  const paused = makeFakePhone({ playState: 'paused' });
  assert.equal(paused.run(['current-video-link', 'cvl4']).code, 0);
  // UI 点击只用于分享按钮与分享链接；媒体键用于取链暂停、返回时暂停及恢复。
  assert.equal(paused.taps(), 2);
  assert.equal(paused.media(), 3, '暂停态退回后应恢复播放');
  const playing = makeFakePhone({ playState: 'playing' });
  assert.equal(playing.run(['current-video-link', 'cvl5']).code, 0);
  assert.equal(playing.taps(), 2);
  assert.equal(playing.media(), 2, '已在播放时不能再次切换');
});

test('proven-to-fire 反向：修复后真机验收日志（fixtest-rc，2 张作品）回放 → 0 次兜底重搜，rescan_rate=0', () => {
  const BATCH2 = new URL('../batch2.sh', import.meta.url).pathname;
  const log = join(FIXTURES, 'night-fixtest-rc-w1.txt');
  const r = spawnSync('zsh', ['-c', `BATCH2_LIB=1 source "${BATCH2}"; word_rescan_metrics "$1" "$2"`, 'zsh', log, '0'], { encoding: 'utf8' });
  const [count, links, rate] = r.stdout.trim().split(/\s+/).map(Number);
  assert.deepEqual([count, links, rate], [0, 2, 0], `修复后的真机日志不该有兜底重搜: ${r.stdout} ${r.stderr}`);
  assert.doesNotMatch(readFileSync(log, 'utf8'), /归位触发兜底重搜/);
});

test('暂存路线退飞了（底下不是详情页）→ 退回 deep link 重开兜底，取链接仍成功', () => {
  const ph = makeFakePhone({ scratchPopTo: 'feed' });
  const r = ph.run(['current-video-link', 'cvl3']);
  assert.equal(r.code, 0, `兜底路径也失败了: ${r.err}`);
  assert.equal(ph.deeplinks(), 1, '退不回详情页时必须用 deep link 重开兜底');
  assert.equal(ph.stack().at(-1), 'detail2', `兜底后应停在重开的详情页: ${ph.stack().join('>')}`);
});

// 2026-10-02 M4 positive5 原始回执：取链入口分享按钮存在，中央暂停之后进入识别画面 AI 页。
// 回放这条导航边界：暂停和恢复只能改变媒体状态，不能让本来正确的视频页丢失。
test('中央点击会导航识别画面时，完整取链和暂存页归位仍成功，媒体控制不触碰页面', () => {
  const ph = makeFakePhone({ centreNavigates: true });
  const r = ph.run(['current-video-link', 'cvl-centre-nav']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video_id=7000000000000000001/);
  assert.deepEqual(ph.stack(), ['results', 'detail']);
  assert.equal(ph.centre(), 0, '暂停与恢复不能靠坐标点击');
  assert.equal(ph.deeplinks(), 0, '正常归位不能增加详情页层级');
});

async function shortlinkNetworkFixture(t, mode) {
  const requests = [], sockets = new Set();
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url.startsWith('/video/') && mode === 'partial-header-timeout') return;
    if (req.url.startsWith('/video/')) { res.writeHead(200); res.end(); return; }
    if (mode === 'timeout-always' || (mode === 'timeout-once' && requests.length === 1)) return;
    res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/video/7000000000000000001` });
    res.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  // 两层暂存：外层原有两次back可恢复详情，不能靠恢复guard失败伪造HTTP封顶。
  const ph = makeFakePhone({ scratchLayers: 2 });
  const curl = join(ph.dir, 'real-curl-fixture');
  // 只替换公开短链目的地与20秒封顶为200ms；仍运行真正curl产生rc28/真实HTTP头。
  writeFileSync(curl, `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2).map(arg => arg === ${JSON.stringify(LINK)} ? 'http://127.0.0.1:${server.address().port}/short' : arg === '20' ? '0.2' : arg);
fs.appendFileSync(${JSON.stringify(join(ph.dir, 'curl-calls'))}, JSON.stringify(args)+'\\n');
if (${JSON.stringify(mode)} === 'non-timeout') process.exit(7);
const r = spawnSync('/usr/bin/curl', args, { encoding: 'utf8', env: { ...process.env, NO_PROXY: '127.0.0.1' } });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); process.exit(r.status || 0);
`, { mode: 0o755 });
  return { ph, curl, requests, calls: () => readFileSync(join(ph.dir, 'curl-calls'), 'utf8').trim().split('\n').map(JSON.parse) };
}

test('真实curl：同短链首次超时第二次成功，仅一次手机分享并正常归位', { timeout: 30000 }, async t => {
  const f = await shortlinkNetworkFixture(t, 'timeout-once');
  const r = await f.ph.runNetwork(['current-video-link', 'cvl-http-retry'], f.curl);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /video_id=7000000000000000001/);
  assert.equal(f.calls().length, 2);
  assert.ok(f.calls().every(args => args.at(-1).endsWith('/short')), '两次使用同一已复制URL');
  assert.deepEqual(f.requests.filter(row => row.path === '/short'), [{ method: 'HEAD', path: '/short' }, { method: 'HEAD', path: '/short' }]);
  assert.equal(f.ph.taps(), 2, '分享按钮和分享链接各一次，不因网络失败重复点击');
  assert.deepEqual(f.ph.stack(), ['results', 'detail']);
});

test('真实curl：持续超时两次封顶，仍拒绝输出视频身份', { timeout: 30000 }, async t => {
  const f = await shortlinkNetworkFixture(t, 'timeout-always');
  const r = await f.ph.runNetwork(['current-video-link', 'cvl-http-stop'], f.curl);
  assert.notEqual(r.code, 0);
  assert.equal(f.calls().length, 2);
  assert.equal(f.requests.length, 2);
  assert.doesNotMatch(r.out, /^video_id=/m);
  assert.equal(f.ph.taps(), 2);
});

test('短链非超时连接错误不得重复HTTP请求或放行身份', { timeout: 30000 }, async t => {
  const f = await shortlinkNetworkFixture(t, 'non-timeout');
  const r = await f.ph.runNetwork(['current-video-link', 'cvl-http-other'], f.curl);
  assert.notEqual(r.code, 0);
  assert.equal(f.calls().length, 1);
  assert.equal(f.requests.length, 0);
  assert.doesNotMatch(r.out, /^video_id=/m);
});

test('真实curl：非零退出即使已读到合法重定向ID也不得放行', { timeout: 30000 }, async t => {
  const f = await shortlinkNetworkFixture(t, 'partial-header-timeout');
  const r = await f.ph.runNetwork(['current-video-link', 'cvl-http-partial'], f.curl);
  assert.notEqual(r.code, 0, 'HTTP链尚未成功，不能吞掉curl返回码而放行部分头');
  assert.equal(f.calls().length, 2);
  assert.doesNotMatch(r.out, /^video_id=/m);
  assert.equal(f.ph.taps(), 2);
});
