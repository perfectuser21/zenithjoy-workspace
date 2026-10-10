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
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
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
function makeFakePhone({ resultsKeyword = KW, scratchPopTo = 'detail', playState = 'paused', interactiveCenter = false, copiedShareUrl = LINK, forbidHead = false, localHeadFails = false, peerUrl = null, returnSkeleton = false, unrecognizedGuide = false, videoTabSelected = true, scratchExtra = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cvl-leave-'));
  mkdirSync(join(dir, 'fx'));
  writeFileSync(join(dir, 'fx', 'detail.xml'), detailXml('playing'));
  writeFileSync(join(dir, 'play_state'), playState);
  writeFileSync(join(dir, 'media_keys'), '');
  writeFileSync(join(dir, 'center_taps'), '0');
  writeFileSync(join(dir, 'fx', 'panel.xml'), PANEL_XML);
  writeFileSync(join(dir, 'fx', 'scratch.xml'), SCRATCH_XML.replace(LINK,copiedShareUrl.replaceAll('&','&amp;')));
  writeFileSync(join(dir, 'fx', 'feed.xml'), FEED_XML);
  writeFileSync(join(dir, 'fx', 'results.xml'),readFileSync(join(FIXTURES, 'real-search-results-grid.xml'),'utf8').replace('text="人工智能" resource-id=', 'text="'+resultsKeyword+'" resource-id='));
  if (!videoTabSelected) {const p=join(dir,'fx','results.xml');writeFileSync(p,readFileSync(p,'utf8').replace(/(<node[^>]*text="视频"[^>]*selected=")true/g,'$1false'));}
  // 历史13节点实屏是复制成功guide；未知变体仅故障注入，不冒充实屏。
  const guideXml=readFileSync(join(FIXTURES,'real-keyword-return-skeleton-13.xml'),'utf8');
  writeFileSync(join(dir,'fx','return-skeleton.xml'),unrecognizedGuide?guideXml.replace('可以通过分享的链接找到我','故障注入：未知引导'):guideXml);
  writeFileSync(join(dir,'foreground_pages'),'');
  writeFileSync(join(dir,'dump_pages'),'');
  writeFileSync(join(dir, 'fx', 'shot.png'), 'png');
  const stack = join(dir, 'stack');
  writeFileSync(stack, 'results\ndetail\n');
  writeFileSync(join(dir, 'panel'), '0');
  writeFileSync(join(dir, 'taps'), '0');
  writeFileSync(join(dir, 'deeplinks'), '0');
  const reg = join(dir, 'r.tsv');
  writeFileSync(reg, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  const curl = join(dir, 'curl');
  writeFileSync(curl, localHeadFails?`#!/bin/sh\necho Operation_timed_out >&2\nexit 28\n`:forbidHead?`#!/bin/sh\necho HEAD_MUST_NOT_BE_CALLED >&2\nexit 99\n`:`#!/bin/sh\nprintf 'HTTP/1.1 302 Found\\r\\nLocation: https://www.douyin.com/video/7000000000000000001?previous_page=app_code_link\\r\\n\\r\\n'\n`, { mode: 0o755 });
  const adb = join(dir, 'adb');
  writeFileSync(adb, `#!/bin/sh
D=${dir}
top() { tail -n 1 "$D/stack"; }
pop() { n=$(wc -l < "$D/stack"); head -n $((n-1)) "$D/stack" > "$D/stack.new"; mv "$D/stack.new" "$D/stack"; }
push() { echo "$1" >> "$D/stack"; }
case "$*" in
  *get-state*) echo device ;;
  *getprop*) echo ANY-MODEL ;;
  *"am start"*"search/tabs?keyword=%20"*) push scratch_res; push scratch_input; i=0; while [ "$i" -lt "${scratchExtra}" ];do push scratch_input; i=$((i+1));done; push scratch_kbd ;;
  *"am start"*"search/tabs?keyword="*) push results ;;
  *"am start"*"aweme/detail/"*) n=$(cat "$D/deeplinks"); echo $((n+1)) > "$D/deeplinks"; push detail2; echo playing > "$D/play_state" ;;
  *"input keyevent 4"*)
      t=$(top)
      if [ "$t" = "scratch_res" ];then echo 1 > "$D/left_scratch";fi
      if [ "$t" = "scratch_res" ] && [ "${scratchPopTo}" != "detail" ]; then
        pop; pop; push ${scratchPopTo}
      else
        pop
      fi ;;
  *"input keyevent 127"*) echo paused > "$D/play_state";echo 127 >> "$D/media_keys" ;;
  *"input keyevent 126"*) echo playing > "$D/play_state";echo 126 >> "$D/media_keys" ;;
  *"input tap"*)
      t=$(top)
      if [ "$t" = "detail" ] || [ "$t" = "detail2" ]; then
        n=$(cat "$D/taps"); n=$((n+1)); echo $n > "$D/taps"
        set -- $*;while [ "$1" != "tap" ];do shift;done;x="$2";y="$3"
        if [ "$x $y" = "600 1198" ];then
          n=$(cat "$D/center_taps");echo $((n+1)) > "$D/center_taps"
          if [ "${interactiveCenter ? '1' : '0'}" = 1 ];then pop;push feed
          elif [ "$(cat "$D/play_state")" = playing ];then echo paused > "$D/play_state";else echo playing > "$D/play_state";fi
        elif [ "$x $y" = "1130 1550" ];then echo 1 > "$D/panel"
        elif [ "$x $y" = "170 2204" ];then echo 0 > "$D/panel";fi
      fi ;;
  *"uiautomator dump"*)
      t=$(top)
      if [ "${returnSkeleton ? 1 : 0}" = 1 ] && [ "$t" = detail ] && [ -f "$D/left_scratch" ];then
        echo detail_skeleton >> "$D/dump_pages";cp "$D/fx/return-skeleton.xml" "$D/remote.xml";exit 0
      fi
      echo "$t" >> "$D/dump_pages"
      case "$t" in
        results) f=results.xml ;;
        detail|detail2) if [ "$(cat "$D/panel")" = "1" ]; then f=panel.xml; else f=detail.xml; fi ;;
        scratch_*) f=scratch.xml ;;
        *) f=feed.xml ;;
      esac
      if [ "$f" = detail.xml ] && [ "$(cat "$D/play_state")" = paused ];then
        sed 's/播放视频，按钮/暂停视频，按钮/g' "$D/fx/$f" > "$D/remote.xml"
      else cp "$D/fx/$f" "$D/remote.xml";fi ;;
  *"stat -c %s"*) wc -c < "$D/remote.xml" | tr -d ' ' ;;
  *screencap*) cp "$D/fx/shot.png" "$D/remote.png" ;;
  *" pull "*)
      set -- $*
      while [ "$1" != "pull" ]; do shift; done
      case "$2" in *.xml) cp "$D/remote.xml" "$3" ;; *) cp "$D/remote.png" "$3" ;; esac ;;
  *dumpsys*)
      top >> "$D/foreground_pages"
      case "$(top)" in
        results|scratch_*) echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.search.activity.SearchResultActivity}" ;;
        outside) echo "  mCurrentFocus=Window{1 u0 com.android.launcher/com.android.launcher.MainActivity}" ;;
        detail|detail2)    echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.detail.ui.DetailActivity}" ;;
        *)                 echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.main.MainActivity}" ;;
      esac ;;
  *) : ;;
esac
exit 0
`, { mode: 0o755 });
  const env = { ...process.env, HOME: dir, DOUYIN_PHONE_REGISTRY: reg, DOUYIN_ADB_BIN: adb, DOUYIN_CURL_BIN: curl, DOUYIN_PYTHON_BIN: 'python3', DOUYIN_SIPS_BIN: '/usr/bin/true', DOUYIN_PHONE_TMP_ROOT: join(dir, 'tmp') };
  if(peerUrl){
    const runDir=join(dir,'run');mkdirSync(join(runDir,'runtime'),{recursive:true});
    writeFileSync(join(runDir,'run-definition.json'),'{}');
    writeFileSync(join(runDir,'runtime','leadgen-client.mjs'),`import fs from 'node:fs';if(process.argv[2]!=='resolve-share-link'||process.argv[3]!==${JSON.stringify(copiedShareUrl)})throw Error('WRONG_FRESH_URL');fs.appendFileSync(${JSON.stringify(join(dir,'peer-calls'))},process.argv[3]+'\\n');console.log(${JSON.stringify(peerUrl)});`);
    env.WFR_RUN_DIR=runDir;
  }
  const run = (args) => {
    const r = spawnSync('zsh', [SCRIPT, '--profile', 'legacy', ...args], { env, encoding: 'utf8', timeout: 180000 });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  return {
    run,
    stack: () => readFileSync(stack, 'utf8').trim().split('\n'),
    foregroundPages: () => readFileSync(join(dir,'foreground_pages'),'utf8').trim().split('\n'),
    guideDismissXml: (eid) => readFileSync(join(dir,'tmp','evidence','legacy',eid+'-t1-leave-guide-dismiss-b3.xml'),'utf8'),
    returnedGridXml: (eid) => readFileSync(join(dir,'tmp','evidence','legacy',eid+'-t1-returned-grid.xml'),'utf8'),
    dumpPages: () => readFileSync(join(dir,'dump_pages'),'utf8').trim().split('\n'),
    deeplinks: () => Number(readFileSync(join(dir, 'deeplinks'), 'utf8').trim()),
    taps: () => Number(readFileSync(join(dir, 'taps'), 'utf8').trim()),
    centerTaps: () => Number(readFileSync(join(dir, 'center_taps'), 'utf8').trim()),
    playback: () => readFileSync(join(dir, 'play_state'), 'utf8').trim(),
    mediaKeys: () => readFileSync(join(dir, 'media_keys'), 'utf8').trim().split('\n'),
    peerCalls: () => readFileSync(join(dir,'peer-calls'),'utf8').trim().split('\n'),
  };
}

test('本地短链HEAD超时后调用本run执行端取真实ID，保持原分享链并回原结果页',()=>{
 const ph=makeFakePhone({localHeadFails:true,peerUrl:'https://www.douyin.com/video/7000000000000000001'});
 const r=ph.run(['current-video-link','cvl-peer','人工智能']);
 assert.equal(r.code,0,r.err);assert.match(r.out,/video_id=7000000000000000001/);assert.ok(r.out.includes('short_url='+LINK));assert.match(r.out,/return_mode=results/);
 assert.deepEqual(ph.peerCalls(),[LINK]);assert.deepEqual(ph.stack(),['results']);
});

test('执行端返回伪域名时不能输出视频成功',()=>{
 const ph=makeFakePhone({localHeadFails:true,peerUrl:'https://evil.com/video/7000000000000000001'});
 const r=ph.run(['current-video-link','cvl-peer-invalid','人工智能']);assert.notEqual(r.code,0);assert.doesNotMatch(r.out,/video_id=/);
});

test('真实取链入口接受iesdouyin复制文案并保留ID、归位，不额外HEAD已有ID的长链接',()=>{
 const ph=makeFakePhone({copiedShareUrl:'https://www.iesdouyin.com/share/video/7619696979182935153/?region=CN&from=copy',forbidHead:true});
 const r=ph.run(['current-video-link','cvl-direct',KW]);
 assert.equal(r.code,0,r.err);assert.match(r.out,/video_id=7619696979182935153/);
 assert.match(r.out,/resolved_url=https:\/\/www\.douyin\.com\/video\/7619696979182935153/);
 assert.match(r.out,/^short_url=$/m);assert.match(r.out,/return_mode=results/);
 assert.match(r.out,/shared_url=https:\/\/www\.iesdouyin\.com\/share\/video\/7619696979182935153/);
 assert.deepEqual(ph.stack(),['results']);assert.equal(ph.deeplinks(),0);
});

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

test('暂停与归位只改变播放状态，不触发中央可点击元素；暂停或播放初态均能恢复播放', () => {
  for (const playState of ['paused','playing']) {
    const ph=makeFakePhone({playState});const r=ph.run(['current-video-link','cvl-state']);
    assert.equal(r.code,0,r.err);assert.equal(ph.playback(),'playing');
    assert.equal(ph.centerTaps(),0,'暂停/恢复播放不能靠中央点击');
    assert.ok(ph.mediaKeys().includes('127'));assert.ok(ph.mediaKeys().includes('126'));
  }
});

test('真实失败形状回放：视频中央是可点击内容时，取链仍须停留原详情并成功读回实际ID', () => {
  const ph=makeFakePhone({interactiveCenter:true});const r=ph.run(['current-video-link','cvl-interactive']);
  assert.equal(r.code,0,r.err);assert.match(r.out,/video_id=7000000000000000001/);
  assert.deepEqual(ph.stack(),['results','detail']);assert.equal(ph.centerTaps(),0);
  assert.equal(ph.playback(),'playing');
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

test('101取链可直接回本词真实搜索结果，无须重开详情，原默认归位行为保留',()=>{
 const ph=makeFakePhone();const r=ph.run(['current-video-link','cvl-results',KW]);assert.equal(r.code,0,r.err);assert.match(r.out,/video_id=7000000000000000001/);assert.match(r.out,/return_mode=results/);assert.equal(ph.stack().at(-1),'results');assert.equal(ph.deeplinks(),0);
});


test('keyword取链先退出暂存路线：真实入口只在粘贴读回时dump暂存两次，归位仍核验原词和视频tab',t=>{
 const ph=makeFakePhone();const r=ph.run(['current-video-link','cvl-fast-keyword',KW]);
 assert.equal(r.code,0,r.err);assert.match(r.out,/video_id=7000000000000000001/);assert.match(r.out,/return_mode=results/);
 assert.deepEqual(ph.stack(),['results']);assert.equal(ph.deeplinks(),0);
 const dumps=ph.dumpPages();assert.equal(dumps.filter(p=>p.startsWith('scratch_')).length,2,'归位不应反复dump暂存键盘/输入/结果页');
 assert.equal(dumps.filter(p=>p==='results').length,2,'仍需back_to_results和returned-grid两次真实结果核验');
 t.diagnostic(JSON.stringify({normal_keyword_dump_pages:dumps,scratch_dumps:dumps.filter(p=>p.startsWith('scratch_')).length,total_dumps:dumps.length}));
});

test('keyword跳出暂存落在feed：原有界归位仍核验真关键词，错误结果页不能伪成功',t=>{
 const ph=makeFakePhone({scratchPopTo:'feed'});const r=ph.run(['current-video-link','cvl-fast-fallback',KW]);
 assert.equal(r.code,0,r.err);assert.match(r.err,/leave-scratch: left scratch search route; results restoration still required/);
 const finalXml=ph.returnedGridXml('cvl-fast-fallback');assert.match(finalXml,/text="人工智能"[^>]*et_search_kw/);assert.match(finalXml,/<node[^>]*text="视频"[^>]*selected="true"/);
 assert.deepEqual(ph.stack(),['results']);assert.equal(ph.dumpPages().filter(x=>x==='results').length,2);assert.equal(ph.mediaKeys().filter(x=>x==='126').length,0);
 assert.match(r.out,/return_mode=results/);assert.deepEqual(ph.stack(),['results']);assert.equal(ph.deeplinks(),0);
 assert.ok(ph.foregroundPages().includes('feed'),'实际前台经过feed，不能凭导航交接宣称结果归位');
 assert.equal(ph.dumpPages().filter(p=>p==='feed').length,0,'results-only不应要求feed详情树');
 assert.equal(ph.dumpPages().filter(p=>p==='results').length,2,'失败兜底仍读回原词及returned-grid');
 const wrong=makeFakePhone({scratchPopTo:'feed',resultsKeyword:'其他词'});const bad=wrong.run(['current-video-link','cvl-fast-wrong-keyword',KW]);
 assert.notEqual(bad.code,0);assert.doesNotMatch(bad.out,/video_id=|return_mode=results/);assert.ok(wrong.dumpPages().includes('results'));
 t.diagnostic(JSON.stringify({fallback_dump_pages:ph.dumpPages(),wrong_keyword_exit:bad.code,wrong_keyword_success_output:false}));
});

// 真机2026-10-10原批前三条均三份13节点骨架；只回搜索结果时不该验收详情页。
test('results-only真实入口：正常详情归位不新增媒体键或详情树，最终原词视频tab仍核验',()=>{
 const ph=makeFakePhone();const r=ph.run(['current-video-link','cvl-results-only',KW]);assert.equal(r.code,0,r.err);
 assert.equal(ph.dumpPages().filter(x=>x==='detail').length,3);assert.equal(ph.mediaKeys().filter(x=>x==='126').length,0);
 assert.equal(ph.dumpPages().filter(x=>x==='results').length,2);assert.deepEqual(ph.stack(),['results']);assert.equal(ph.deeplinks(),0);
});
test('results-only真实13节点guide夹具：跳出暂存不读guide详情三波，最终原词视频tab通过',t=>{
 const ph=makeFakePhone({returnSkeleton:true});const r=ph.run(['current-video-link','cvl-results-skeleton',KW]);assert.equal(r.code,0,r.err);
 assert.equal(ph.dumpPages().filter(x=>x==='detail_skeleton').length,0);assert.equal(ph.mediaKeys().filter(x=>x==='126').length,0);
 assert.equal(ph.dumpPages().filter(x=>x==='results').length,2);assert.deepEqual(ph.stack(),['results']);assert.match(r.out,/video_id=7000000000000000001/);
 t.diagnostic(JSON.stringify({actual_dump_pages:ph.dumpPages(),media_keys:ph.mediaKeys(),stack:ph.stack()}));
});
test('results-only错误关键词或未选视频tab不能输出成功真实ID',()=>{
 for(const opts of [{returnSkeleton:true,resultsKeyword:'其他词'},{returnSkeleton:true,videoTabSelected:false}]){
 const ph=makeFakePhone(opts);const r=ph.run(['current-video-link','cvl-results-reject',KW]);assert.notEqual(r.code,0);assert.doesNotMatch(r.out,/video_id=/);}
});
test('results-only退到外部主屏明确失败，不盲退外部栈后伪成功',()=>{
 const ph=makeFakePhone({scratchPopTo:'outside'});const r=ph.run(['current-video-link','cvl-results-outside',KW]);assert.notEqual(r.code,0);assert.doesNotMatch(r.out,/video_id=/);
 assert.deepEqual(ph.stack(),['results','outside']);
});

test('results-only未知mode在任何ADB动作之前明确拒绝',()=>{
 const code=readFileSync(SCRIPT,'utf8').match(/^_leave_scratch_route\(\) \{[\s\S]*?^\}/m)[0];
 const r=spawnSync('zsh',['-c',`require_evidence_id(){ return 0; }; ADB=/usr/bin/false; SERIAL=SER1; ${code}\n_leave_scratch_route mode-test unknown-mode`],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/unknown.*mode/i);
});

test('非keyword已知复制guide额外BACK后独立错误新树仍拒绝，再深链恢复默认播放',()=>{
 const ph=makeFakePhone({returnSkeleton:true});const r=ph.run(['current-video-link','cvl-strict-guide']);assert.equal(r.code,0,r.err);
 assert.equal(ph.dumpPages().filter(x=>x==='detail_skeleton').length,1);
 const fresh=ph.guideDismissXml('cvl-strict-guide');
 assert.match(fresh,/text="人工智能"/);assert.doesNotMatch(fresh,/content-desc="分享/);
 assert.match(r.err,/share button absent/);assert.match(r.err,/falling back to deep link reopen/);
 assert.equal(ph.deeplinks(),1);assert.equal(ph.stack().at(-1),'detail2');
 assert.equal(ph.playback(),'playing');assert.equal(ph.mediaKeys().filter(x=>x==='126').length,0); // 默认deep link自动播放，不增126。
 assert.match(r.out,/video_id=7000000000000000001/);
});

test('非keyword未知13节点故障注入guide保持三波严格拒绝，再深链恢复默认播放',()=>{
 const ph=makeFakePhone({returnSkeleton:true,unrecognizedGuide:true});const r=ph.run(['current-video-link','cvl-strict-unknown']);assert.equal(r.code,0,r.err);
 assert.equal(ph.dumpPages().filter(x=>x==='detail_skeleton').length,3);
 assert.doesNotMatch(r.err,/guide-dismiss|guide dismiss/);
 assert.equal(ph.deeplinks(),1);assert.equal(ph.stack().at(-1),'detail2');
 assert.equal(ph.playback(),'playing');assert.equal(ph.mediaKeys().filter(x=>x==='126').length,0); // 默认deep link自动播放，不增126。
 assert.match(r.out,/video_id=7000000000000000001/);
});

test('results-only仍在搜索栈超过5次BACK：helper失败后原有界恢复真实原词视频tab',t=>{
 const ph=makeFakePhone({scratchExtra:4});const r=ph.run(['current-video-link','cvl-bounded-results',KW]);assert.equal(r.code,0,r.err);
 assert.match(r.err,/still on a search activity after 5 backs/);assert.match(r.err,/using bounded results restoration/);assert.deepEqual(ph.stack(),['results']);
 const xml=ph.returnedGridXml('cvl-bounded-results');assert.match(xml,/text="人工智能"[^>]*et_search_kw/);assert.match(xml,/<node[^>]*text="视频"[^>]*selected="true"/);
 assert.equal(ph.deeplinks(),0);assert.match(r.out,/return_mode=results/);t.diagnostic(JSON.stringify({bounded_fallback_dump_pages:ph.dumpPages()}));
});
