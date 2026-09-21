// services/phone-adb-controller/__tests__/back-to-results.test.mjs
//
// 采收循环处理完一个视频后的**归位**守卫。
//
// 0922 02:00 夜批实证（上一刀 PR#1932 已上机后的第一批）：current_video_link 内部的
// 恢复守卫已经生效、链路能自我恢复了（w2 的 v4 回到详情页并采到 3 条评论，而前一批
// 是 v2/v3/v4 全灭），但**掉页本身还在发生**——v2/v3 的 oc-before.xml 仍是暂存解析页。
//
// 根因在调用方：harvest-keyword.sh 的几个「跳过」分支都只 `back` 一次，而取过链接的
// 视频栈里比「直接点开卡片」多压一层（current_video_link 用 deep link 重开），
// 一次退不回结果页，人落在暂存解析页上，后面每个视频的 tap 坐标全打在错页面。
//
// 所以归位**不能数 back 次数**——数字写死在任何一条路径上都会退多或退少。
// 改成退到「真的看见搜索结果页」为止，这里守的就是这条。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const HARVEST = new URL('../harvest-keyword.sh', import.meta.url).pathname;
const PKG = 'com.ss.android.ugc.aweme';

test('前置：zsh 可用（缺了就报红，绝不静默跳过）', () => {
  assert.equal(spawnSync('zsh', ['-c', 'exit 0']).error, undefined,
    '没有 zsh —— 本文件所有守卫都会静默失效，请在 CI 里装上（别改成 skip）');
});

function judge(foreground) {
  const dir = mkdtempSync(join(tmpdir(), 'b2r-'));
  const reg = join(dir, 'r.tsv');
  writeFileSync(reg, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  return new Promise((resolve) => {
    const p = spawn('zsh', [SCRIPT, '--profile', 'legacy', 'on-search-results', foreground], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: reg },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test('搜索结果页 → 判已归位', async () => {
  const r = await judge(`${PKG}/${PKG}.search.activity.SearchResultActivity`);
  assert.equal(r.code, 0, `结果页没被认出来: ${r.err}`);
});

test('视频详情页 → 判没归位（还差一层没退）', async () => {
  const r = await judge(`${PKG}/${PKG}.detail.ui.DetailActivity`);
  assert.notEqual(r.code, 0, '停在详情页却判成已回结果页——下一个视频会点在错页面上');
});

test('暂存解析页所在的搜索页 → 判没归位', async () => {
  // 0922 夜批里人就落在这儿。它跟结果页同属搜索模块但不是同一个 Activity，
  // 只按包名或"含 search"判会把它放过去。
  const r = await judge(`${PKG}/${PKG}.search.activity.SearchActivity`);
  assert.notEqual(r.code, 0, '暂存解析页被当成结果页');
});

test('人已经被切出抖音 → 判没归位', async () => {
  const r = await judge('com.hihonor.android.launcher/.unihome.UniHomeLauncher');
  assert.notEqual(r.code, 0, '都不在抖音里了还判已归位');
});

// ── 接线守卫 ──────────────────────────────────────────────────────────────
// 判定对不对是一回事，调用方用不用它是另一回事——本 bug 的形状恰恰是「调用方
// 自己数 back 次数」。把 harvest-keyword.sh 改回裸 back，上面几条依然全绿。
test('接线守卫：采收循环的归位必须走 back-to-results，不能自己数 back 次数', () => {
  const src = readFileSync(HARVEST, 'utf8');
  const lines = src.split('\n');
  const bad = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /--profile "\$P" back\b/.test(l) && !/back-to-results/.test(l))
    // 评论面板内部的恢复（back 一次再重开面板）不算归位，那是面板层的操作
    .filter(([n]) => {
      const ctx = lines.slice(Math.max(0, n - 6), n).join('\n');
      return !/open-comments|评论面板|card-link/.test(ctx);
    });
  assert.deepEqual(bad.map(([n]) => n), [],
    `这些行还在自己数 back 次数归位（取过链接的视频栈里多一层，数字必然退多或退少）：\n`
    + bad.map(([n, l]) => `  ${HARVEST}:${n}  ${l.trim()}`).join('\n'));

  assert.ok(/back-to-results/.test(src), 'harvest-keyword.sh 根本没用 back-to-results');
});

// ── 真行为测试（假 adb）──────────────────────────────────────────────────
// 读源码的守卫抓不住"把验证挪个位置"这类变异。这里直接让脚本对着一台假手机跑，
// 断言它的**行为**：退到结果页就停、退不到就报错。

/** 假 adb：前 N 次 dumpsys 报详情页，之后报结果页；keyevent 4 推进计数 */
function makeFakeAdb(dir, { backsUntilResults, neverResults = false }) {
  const stateFile = join(dir, 'backs');
  writeFileSync(stateFile, '0');
  const p = join(dir, 'adb');
  writeFileSync(p, `#!/bin/sh
case "$*" in
  *get-state*)  echo device ;;
  *getprop*)    echo ANY-MODEL ;;
  *"input keyevent 4"*)
      n=$(cat ${stateFile}); echo $((n+1)) > ${stateFile} ;;
  *dumpsys*)
      n=$(cat ${stateFile})
      if [ "${neverResults ? 1 : 0}" = "1" ] || [ "$n" -lt "${backsUntilResults}" ]; then
        echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.detail.ui.DetailActivity}"
      else
        echo "  mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.search.activity.SearchResultActivity}"
      fi ;;
  *) echo "" ;;
esac
exit 0
`, { mode: 0o755 });
  return { path: p, backs: () => Number(readFileSync(stateFile, 'utf8').trim()) };
}

function runBackToResults(opts, maxArg) {
  const dir = mkdtempSync(join(tmpdir(), 'b2r-run-'));
  const reg = join(dir, 'r.tsv');
  writeFileSync(reg, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  const adb = makeFakeAdb(dir, opts);
  const args = [SCRIPT, '--profile', 'legacy', 'back-to-results'];
  if (maxArg) args.push(String(maxArg));
  return new Promise((resolve) => {
    const p = spawn('zsh', args, { env: { ...process.env, DOUYIN_PHONE_REGISTRY: reg, DOUYIN_ADB_BIN: adb.path } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim(), backs: adb.backs() }));
  });
}

test('真行为：已经在结果页 → 一次 back 都不按', async () => {
  const r = await runBackToResults({ backsUntilResults: 0 });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.backs, 0, '人已经在结果页了还乱按返回——会退出搜索结果');
});

test('真行为：差两层 → 按两次就停，不多按', async () => {
  // 多按一次就退出结果页了，下一个视频的卡片坐标随即失效。
  const r = await runBackToResults({ backsUntilResults: 2 });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.backs, 2, `按了 ${r.backs} 次（应为 2）——归位没在看见结果页时停手`);
  assert.match(r.out, /backs=2/);
});

test('真行为：怎么退都回不到结果页 → 报失败，绝不假装已归位', async () => {
  // 这条是本 bug 的形状：调用方拿到"成功"就接着点下一个视频，全打在错页面上。
  const r = await runBackToResults({ neverResults: true }, 3);
  assert.notEqual(r.code, 0, '退不回结果页却返回成功');
  assert.match(r.err, /still off the search result page/);
});
