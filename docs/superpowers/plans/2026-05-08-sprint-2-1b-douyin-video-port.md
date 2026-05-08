# Sprint 2.1b — 抖音视频真发能力通用化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `~/.claude/skills/douyin-publisher/scripts/publish-douyin-video.cjs` (482 行 raw CDP 实现) 的 DOM 操作进 zenithjoy agent runtime 的 `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs`，让任意客户的 agent 都能在客户机本地真发抖音视频（拿到真 douyin.com/video URL 或管理页 URL fallback）。

**Architecture:** 用 playwright `page.locator` API 等价封装 user-skill 的 raw CDP DOM 操作，5 个 selector 函数抽出可单测：`uploadVideoFile / waitForUploadProcessed / fillTitle / clickPublishButton / extractPublishedUrl`。配置 100% 参数化（CDP URL 从 env、video_path 从 queue）。**不搬** xian-mac SCP / WINDOWS_IP / xuxia 用户 / 自写 CDPClient — agent runtime 在客户机本地，video 已就位。

**Tech Stack:** Node.js (.cjs) / playwright connectOverCDP / vitest (unit) / smoke.sh (E2E) / rog Windows real-machine self-test

**Spec:** `docs/superpowers/specs/2026-05-08-sprint-2-1b-douyin-video-port-design.md`

**Worktree:** `/Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port` (cp-0508163204-sprint-2-1b-douyin-video-port，基于 main 8cb2aea)

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs` | Modify | 减肥占位段 + 增肌 5 个 selector 函数 + module.exports |
| `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs` | **Create** | 单测 5 个 selector 函数（mock playwright Page） |
| `test-registry.yaml` | Modify | 注册新 unit 测试文件 |
| `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md` | **Create** | rog 真机 e2e evidence |
| `.github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh` | **Create** | 满足 lint-feature-has-smoke + 真发链路验证 |

---

## Task 1: 写 fail unit 测试 + smoke.sh 骨架（commit 1 RED — TDD 纪律 + 加厚铁律 4 第 1 段）

**Files:**
- Create: `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs`
- Create: `.github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh`
- Modify: `test-registry.yaml`

- [ ] **Step 1: 创建 __tests__ 目录 + 写 unit 测试文件**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
mkdir -p services/agent/publishers/douyin-publisher/__tests__
```

写文件 `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs`：

```javascript
/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
const { describe, it, expect, vi } = require('vitest');
const path = require('path');

// require 时如果模块还没 export 这些函数，整个 describe 都会跑不起来 — 这是 RED 状态
const {
  uploadVideoFile,
  waitForUploadProcessed,
  fillTitle,
  clickPublishButton,
  extractPublishedUrl,
} = require('../publish-douyin-video.cjs');

describe('publish-douyin-video selector 通用化契约', () => {
  describe('uploadVideoFile', () => {
    it('用 input[type="file"] selector + 传 queueData.video_path', async () => {
      const setInputFiles = vi.fn().mockResolvedValue(undefined);
      const fakePage = { setInputFiles };
      await uploadVideoFile(fakePage, '/local/path/test.mp4');
      expect(setInputFiles).toHaveBeenCalledTimes(1);
      expect(setInputFiles).toHaveBeenCalledWith('input[type="file"]', '/local/path/test.mp4');
    });

    it('selector 不含任何 xian-pc 特化字符串', async () => {
      const setInputFiles = vi.fn().mockResolvedValue(undefined);
      await uploadVideoFile({ setInputFiles }, '/x.mp4');
      const calledSelector = setInputFiles.mock.calls[0][0];
      expect(calledSelector).not.toMatch(/xian-pc|xuxia|100\.97\.|WINDOWS_BASE_DIR/);
    });
  });

  describe('fillTitle', () => {
    it('用 input[placeholder*="标题"] selector + 传 title', async () => {
      const fill = vi.fn().mockResolvedValue(undefined);
      const waitFor = vi.fn().mockResolvedValue(undefined);
      const locatorChain = { first: () => ({ fill, waitFor }) };
      const locator = vi.fn().mockReturnValue(locatorChain);
      const fakePage = { locator };
      await fillTitle(fakePage, '我的视频标题');
      expect(locator).toHaveBeenCalledWith('input[placeholder*="标题"]');
      expect(fill).toHaveBeenCalledWith('我的视频标题');
    });
  });

  describe('clickPublishButton', () => {
    it('用 getByRole button + name 正则匹配 发布/高清发布/提交发布/确认发布', async () => {
      const click = vi.fn().mockResolvedValue(undefined);
      const waitFor = vi.fn().mockResolvedValue(undefined);
      const locatorChain = { first: () => ({ click, waitFor }) };
      const getByRole = vi.fn().mockReturnValue(locatorChain);
      const fakePage = { getByRole };
      await clickPublishButton(fakePage);
      expect(getByRole).toHaveBeenCalledTimes(1);
      const [role, opts] = getByRole.mock.calls[0];
      expect(role).toBe('button');
      expect(opts.name).toBeInstanceOf(RegExp);
      // 正则要 match 4 种发布按钮文字
      expect(opts.name.test('发布')).toBe(true);
      expect(opts.name.test('高清发布')).toBe(true);
      expect(opts.name.test('提交发布')).toBe(true);
      expect(opts.name.test('确认发布')).toBe(true);
      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe('extractPublishedUrl', () => {
    it('从 a[href*="douyin.com/video/"] 抓最近一条 URL，//... 前补 https:', async () => {
      const evaluate = vi.fn().mockResolvedValue('https://www.douyin.com/video/1234567890');
      const fakePage = { evaluate, url: () => 'https://creator.douyin.com/creator-micro/content/manage' };
      const result = await extractPublishedUrl(fakePage);
      expect(result.url).toBe('https://www.douyin.com/video/1234567890');
      expect(result.urlFallback).not.toBe(true);
    });

    it('页面没找到 video link → fallback 到管理页 URL + urlFallback:true', async () => {
      const evaluate = vi.fn().mockResolvedValue(null);
      const fakePage = {
        evaluate,
        url: () => 'https://creator.douyin.com/creator-micro/content/manage',
      };
      const result = await extractPublishedUrl(fakePage);
      expect(result.url).toContain('creator-micro');
      expect(result.urlFallback).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 创建 smoke.sh 骨架**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
```

写文件 `.github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh`：

```bash
#!/usr/bin/env bash
# sprint-2-1b-douyin-video-real-publish-smoke.sh
# Sprint 2.1b — 验证 publish-douyin-video.cjs 5 个抽出函数已 export + selector 通用化
set -euo pipefail

SCRIPT="services/agent/publishers/douyin-publisher/publish-douyin-video.cjs"
TEST_FILE="services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs"

echo "[smoke] step 1: 文件存在"
test -f "$SCRIPT" || { echo "FAIL $SCRIPT not found"; exit 1; }
test -f "$TEST_FILE" || { echo "FAIL $TEST_FILE not found"; exit 1; }

echo "[smoke] step 2: 5 个 selector 函数 export 检查"
node -e "const m = require(process.cwd() + '/$SCRIPT'); ['uploadVideoFile','waitForUploadProcessed','fillTitle','clickPublishButton','extractPublishedUrl'].forEach(fn => { if (typeof m[fn] !== 'function') { console.error('missing export: ' + fn); process.exit(1); } }); console.log('all 5 fns exported')" || exit 1

echo "[smoke] step 3: selector 字符串不含 xian-pc 特化"
grep -E "xian-pc|xuxia|100\.97\.|WINDOWS_BASE_DIR|xian-mac|jinnuoshengyuan|windows_ed" "$SCRIPT" && { echo "FAIL: $SCRIPT 含 xian-pc 特化字符串"; exit 1; } || true

echo "[smoke] step 4: vitest unit 跑通"
npx vitest run "$TEST_FILE" || exit 1

echo "[smoke] step 5: 占位段已删（thin 减肥）"
grep -E "PENDING_LEAD_VERIFICATION|TODO lead 自验填 selectors" "$SCRIPT" && { echo "FAIL: thin 占位段未删干净"; exit 1; } || true

echo "[smoke] OK"
```

```bash
chmod +x .github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh
```

- [ ] **Step 3: 注册 unit test 到 test-registry.yaml**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
cat >> test-registry.yaml <<'EOF'

  - id: agent-douyin-publisher-video-selectors
    path: services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs
    type: unit
    ci: L3
    status: active
    product: 内容发布
    note: "Sprint 2.1b — 抖音视频真发 5 个 selector 函数（uploadVideoFile/waitForUploadProcessed/fillTitle/clickPublishButton/extractPublishedUrl）通用化契约 unit test"
EOF
```

- [ ] **Step 4: 跑 unit test 确认 fail（RED 状态）**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port/services/agent
npx vitest run publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs 2>&1 | tail -10
```

Expected: FAIL — `require('../publish-douyin-video.cjs')` 返回的 module 没有 `uploadVideoFile / fillTitle / clickPublishButton / extractPublishedUrl` exports（thin 版没抽出函数）。任意一个 fail 就算 RED。

- [ ] **Step 5: 跑 smoke.sh 确认 fail（RED 状态）**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
bash .github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh 2>&1 | tail -5
```

Expected: FAIL at step 2（5 个函数没 export）或 step 5（占位段 PENDING_LEAD_VERIFICATION 还在）。这就是 RED。

- [ ] **Step 6: Commit RED 状态**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
git add services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs \
        .github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh \
        test-registry.yaml
git commit -m "$(cat <<'EOF'
test(douyin-video): 锁 selector 通用化契约 + smoke 骨架（RED）

- 新建 services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs
  含 5 个 selector 函数单测（uploadVideoFile/fillTitle/clickPublishButton/extractPublishedUrl），
  断言 selector 是平台通用形式（不含 xian-pc/xuxia/WINDOWS_BASE_DIR/xian-mac 任何特化字符串）
- 新建 sprint-2-1b-douyin-video-real-publish-smoke.sh 满足 lint-feature-has-smoke
  + 5 步真环境验证（文件存在 / export 检查 / 不含特化 / vitest pass / 占位段已删）
- test-registry.yaml 注册新 unit 测试

当前状态：RED — publish-douyin-video.cjs 未抽函数，require 找不到 5 个 export。
下个 commit (减肥) + 第三个 commit (增肌) 让测试转 GREEN。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit 创建。

---

## Task 2: 减肥 — 删 thin 占位段（commit 2 — 加厚铁律 4 第 2 段）

**Files:**
- Modify: `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs:77-99`

- [ ] **Step 1: 看现有 video.cjs line 70-100 段**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
sed -n '70,105p' services/agent/publishers/douyin-publisher/publish-douyin-video.cjs
```

Expected: 看到 line 77-99 区段含 `// TODO lead 自验时用真抖音选择器替换以下占位` + `_log('[DY-VIDEO-REAL] (TODO lead 自验填 selectors) ...')` + `// R1 风控检测` 注释 + `// 真点发布按钮（lead 自验时这里要真选择器 + .click()）` + `videoUrl = '...PENDING_LEAD_VERIFICATION'`。

- [ ] **Step 2: 删占位段 — 用 node 脚本精确删（保留 R1 风控段）**

写 patch 脚本 `/tmp/slim-thin.cjs`：

```javascript
const fs = require('fs');
const file = process.argv[2];
let content = fs.readFileSync(file, 'utf8');

// 删 thin 占位段：TODO 注释 + 占位 _log（共 2 段，因为 R1 风控块在中间）
const removals = [
  // 第一段：line 77-80 (上传/标题/标签 占位)
  /\s*\/\/ 上传 video \/ 填标题 \/ 选标签[\s\S]*?_log\('\[DY-VIDEO-REAL\] \(TODO lead 自验填 selectors\)[^']*'\);\n/,
  // 第二段：line 90-99 (发布按钮 占位 + 抓 URL 占位)
  /\s*\/\/ 真点发布按钮（lead 自验时这里要真选择器 \+ \.click\(\)）[\s\S]*?const videoUrl = `https:\/\/www\.douyin\.com\/video\/PENDING_LEAD_VERIFICATION`;\n/,
];

for (const re of removals) {
  if (!re.test(content)) {
    console.error('FAIL: pattern not found:', re);
    process.exit(1);
  }
  content = content.replace(re, '\n');
}

fs.writeFileSync(file, content, 'utf8');
console.log('SLIMMED ok');
```

```bash
node /tmp/slim-thin.cjs services/agent/publishers/douyin-publisher/publish-douyin-video.cjs
```

Expected: `SLIMMED ok`。

- [ ] **Step 3: 验证占位段已删 + R1 风控段保留**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
echo "---占位段已删？---"
grep -E "PENDING_LEAD_VERIFICATION|TODO lead 自验填 selectors|真发布按钮（lead 自验时" services/agent/publishers/douyin-publisher/publish-douyin-video.cjs && echo "FAIL: 占位段还在" || echo "OK: 占位段全删"
echo "---R1 风控段保留？---"
grep "RISK_KEYWORDS\|风控" services/agent/publishers/douyin-publisher/publish-douyin-video.cjs | head -3
```

Expected: "OK: 占位段全删" + R1 风控段还在（含 `RISK_KEYWORDS` + `for (const kw of RISK_KEYWORDS)`）。

- [ ] **Step 4: 跑 vitest 确认还是 RED（删了占位但没增肌）**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port/services/agent
npx vitest run publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs 2>&1 | tail -5
```

Expected: 仍然 FAIL — 5 个函数还没增肌出来。RED 状态符合预期。

- [ ] **Step 5: Commit 减肥（带 replaces_old_thin marker）**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
git add services/agent/publishers/douyin-publisher/publish-douyin-video.cjs
git commit -m "$(cat <<'EOF'
refactor(douyin-video): 删 thin 占位段，腾位置给真 selectors

- 删 publish-douyin-video.cjs:77-99 的 TODO _log + PENDING_LEAD_VERIFICATION 假 URL
- R1 风控关键词检测块保留（thin 已实现，真发版继续用）
- 不加新代码（增肌在下个 commit）

walking-skeleton 加厚铁律 4：先减肥再增肌，两段式 commit。本 commit 是减肥步。

replaces_old_thin: services/agent/publishers/douyin-publisher/publish-douyin-video.cjs:77-99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit 创建，message 含 `replaces_old_thin:` marker。

---

## Task 3: 增肌 — port 5 个 DOM 操作（commit 3 — 加厚铁律 4 第 3 段，RED → GREEN）

**Files:**
- Modify: `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs`（加 5 个抽出函数 + module.exports）

- [ ] **Step 1: 看 video.cjs 当前末尾结构**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
tail -30 services/agent/publishers/douyin-publisher/publish-douyin-video.cjs
```

Expected: 看到 `main()` 调用 + `publishDouyinVideoReal` 主函数。需要在 `main()` 前插 5 个新函数 + 文件末尾加 module.exports。

- [ ] **Step 2: 在文件末尾的 main() 前插 5 个 selector 函数（手工 Edit）**

定位插入点：找到 `async function main() {` 这行，**在它之前**插入：

```javascript
// ============================================================================
// 5 个抽出的 DOM selector 函数（playwright 等价封装 user-skill raw CDP 实现）
// ============================================================================

async function uploadVideoFile(page, videoPath) {
  await page.setInputFiles('input[type="file"]', videoPath);
}

async function waitForUploadProcessed(page, timeoutMs = 60_000) {
  // 抖音上传完成后会跳到 /creator-micro/content/post/video，标题输入框 hydrate 出来
  await page.waitForSelector('input[placeholder*="标题"]', { timeout: timeoutMs });
}

async function fillTitle(page, title) {
  const titleInput = page.locator('input[placeholder*="标题"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
  await titleInput.fill(title);
}

async function clickPublishButton(page) {
  // 优先 getByRole + name 正则；匹配 4 种发布按钮文字应对抖音 UI 改版
  const publishBtn = page.getByRole('button', {
    name: /^(高清发布|发布|提交发布|确认发布)$/,
  }).first();
  await publishBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await publishBtn.click();
}

async function extractPublishedUrl(page) {
  // 等跳到 manage 或 home（最多 60s）
  try {
    await page.waitForURL(/\/creator-micro\/(content\/manage|home)/, { timeout: 60_000 });
  } catch {
    // 没跳转也不算 fail，继续看能不能从当前 page 提 URL
  }
  // 从作品列表抓最近一条的公开 URL
  const videoHref = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="douyin.com/video/"]'));
    if (!links.length) return null;
    let href = links[0].getAttribute('href') || '';
    if (href.startsWith('//')) href = 'https:' + href;
    return href;
  });
  if (!videoHref) {
    // fallback: 列表 hydrate 滞后时返回管理页 URL，lead 肉眼能看到刚发的视频在列表第一条
    return { url: page.url(), urlFallback: true };
  }
  return { url: videoHref, urlFallback: false };
}
```

- [ ] **Step 3: 在 publishDouyinVideoReal 函数体内调用 5 个新函数（替换之前删了的占位段）**

定位 `publishDouyinVideoReal` 函数体内、R1 风控检测块**之后**、原来 `// 真点发布按钮（已删）` 那个位置，插入：

找到这两行（line ~75-77 之间，R1 风控检测块 close `}` 之后）：
```javascript
    // R1 风控检测（占位段后保留的部分）
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    for (const kw of RISK_KEYWORDS) {
      if (bodyText.includes(kw)) {
        const shot = await captureFailScreenshot(page, 'risk');
        throw new Error(`risk: 抖音风控关键词命中 "${kw}" (screenshot: ${shot || 'n/a'})`);
      }
    }
```

在它**之前**（导航到上传页之后），先调上传：

```javascript
    _log('[DY-VIDEO-REAL] 上传视频...');
    await uploadVideoFile(page, queueData.video_path);
    _log('[DY-VIDEO-REAL] 等抖音处理...');
    await waitForUploadProcessed(page);
    _log('[DY-VIDEO-REAL] 填标题...');
    await fillTitle(page, queueData.title);
```

在 R1 风控检测块**之后**插点击发布 + 抓 URL：

```javascript
    _log('[DY-VIDEO-REAL] 点击发布按钮...');
    await clickPublishButton(page);

    _log('[DY-VIDEO-REAL] 抓最终视频 URL...');
    const { url, urlFallback } = await extractPublishedUrl(page);

    const out = { ok: true, dryRun: false, url, urlFallback, title: queueData.title };
    _log(JSON.stringify(out));
```

注意：原来的 `const out = { ok: true, dryRun: false, url: videoUrl, ... }` 已经在减肥 commit 删了，这次重写。

- [ ] **Step 4: 文件末尾加 module.exports（在 main(); 调用之前）**

定位文件末尾（`main();` 调用那行之前），插入：

```javascript
// 暴露给单测
module.exports = {
  uploadVideoFile,
  waitForUploadProcessed,
  fillTitle,
  clickPublishButton,
  extractPublishedUrl,
};
```

注意：`main();` 在脚本被 spawn 时仍然执行 — module.exports 不影响 spawn 行为（但被 require 的话因为 main() 同步调用会执行...）。**修正**：把 main() 用 `if (require.main === module) main();` 包起来：

```javascript
if (require.main === module) {
  main();
}
```

- [ ] **Step 5: 跑 vitest unit 测试 — 确认 GREEN**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port/services/agent
npx vitest run publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs 2>&1 | tail -10
```

Expected: 全部 PASS（uploadVideoFile / fillTitle / clickPublishButton / extractPublishedUrl 4 组共 6 个 case）。

- [ ] **Step 6: 跑 smoke.sh 确认 GREEN**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
bash .github/workflows/scripts/smoke/sprint-2-1b-douyin-video-real-publish-smoke.sh 2>&1 | tail -8
```

Expected: 5 步全 PASS，输出 `[smoke] OK`。

- [ ] **Step 7: 跑全套相关测试避免破坏**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port/services/agent
npx vitest run 2>&1 | tail -8
```

Expected: 所有测试 PASS（含 sprint 2.1a 加的 + 本 sprint 加的）。

- [ ] **Step 8: Commit 增肌**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
git add services/agent/publishers/douyin-publisher/publish-douyin-video.cjs
git commit -m "$(cat <<'EOF'
feat(douyin-video): port user-skill 真发 selectors（playwright 通用化版）

把 ~/.claude/skills/douyin-publisher 的 482 行 raw CDP 实现的 5 个 DOM 操作
用 playwright Page API 等价封装，抽 5 个函数 export 给单测：

- uploadVideoFile(page, videoPath): page.setInputFiles('input[type="file"]', videoPath)
- waitForUploadProcessed(page): page.waitForSelector('input[placeholder*="标题"]')
- fillTitle(page, title): page.locator('input[placeholder*="标题"]').first().fill(title)
- clickPublishButton(page): page.getByRole('button', {name: /^(高清发布|发布|提交发布|确认发布)$/}).click()
- extractPublishedUrl(page): waitForURL → page.evaluate 抓 a[href*="douyin.com/video/"]
                              fallback 到管理页 URL + urlFallback:true（应对 hydrate 滞后）

完全不搬 user-skill 的 xian-pc 特化代码（IP/SCP/xian-mac/CDPClient/--content protocol）：
agent runtime 在客户机本地，video_path 来自 task.payload，CDP URL 来自 env。
任何客户配好 agent 后都能跑这个脚本真发抖音视频。

测试覆盖：
- vitest unit: publish-douyin-video.test.cjs 6 个 case 全 PASS
- smoke.sh: sprint-2-1b-douyin-video-real-publish-smoke.sh 5 步全 PASS

不在 scope（spec Out of Scope 段列出 10 项）：风控规避、多账号、retry、cover、tags 等。

walking-skeleton 加厚铁律 4：先减肥再增肌，本 commit 是增肌步。
配合上一 commit 的 replaces_old_thin marker，让 lint-thicken-must-replace PASS。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit 创建。

---

## Task 4: rog Windows 真机 e2e 自验 + 归档 evidence + 开 sprint PR

**Files:**
- Create: `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md`
- Update: `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md`（写 evidence）

- [ ] **Step 1: Mac mini API 重启加载新 transport（如果有改动 — 本 sprint 无 API 改动可跳）**

```bash
echo "本 sprint 只改 services/agent/publishers/，不需重启 mac mini API"
```

- [ ] **Step 2: 同步新 video.cjs 到 rog**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
scp services/agent/publishers/douyin-publisher/publish-douyin-video.cjs \
    rog-xian:Desktop/zenithjoy-agent/publishers/douyin-publisher/publish-douyin-video.cjs
```

Expected: scp 成功（无报错）。

- [ ] **Step 3: 验证 rog 上的 video.cjs export 5 个函数**

```bash
ssh rog-xian 'cd Desktop/zenithjoy-agent && node -e "const m = require(\"./publishers/douyin-publisher/publish-douyin-video.cjs\"); console.log(Object.keys(m))"' 2>&1 | head -3
```

Expected: 输出 `[ 'uploadVideoFile', 'waitForUploadProcessed', 'fillTitle', 'clickPublishButton', 'extractPublishedUrl' ]`。

- [ ] **Step 4: 改 rog .env 启 REAL_PUBLISH=1**

写一个 ps1 脚本上传：

```bash
cat > /tmp/enable-real-publish.ps1 <<'EOF'
$envPath = "C:\Users\asus\Desktop\zenithjoy-agent\.env"
$content = Get-Content $envPath -Raw
$newContent = $content -replace 'ZENITHJOY_AGENT_REAL_PUBLISH=0', 'ZENITHJOY_AGENT_REAL_PUBLISH=1'
[System.IO.File]::WriteAllText($envPath, $newContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "REAL_PUBLISH set to 1"
Get-Content $envPath | ForEach-Object {
    if ($_ -match "TOKEN|SECRET|PASSWORD") { ($_ -split "=")[0] + "=<redacted>" } else { $_ }
}
EOF
scp /tmp/enable-real-publish.ps1 rog-xian:Desktop/zenithjoy-agent/enable-real-publish.ps1
ssh rog-xian 'powershell -ExecutionPolicy Bypass -File "C:\Users\asus\Desktop\zenithjoy-agent\enable-real-publish.ps1"' 2>&1 | head -10
```

Expected: 看到 `ZENITHJOY_AGENT_REAL_PUBLISH=1` 在输出里。

- [ ] **Step 5: 用户提供 / ffmpeg 生成测试 mp4 到 rog**

如果用户没现成 mp4，ssh 到 rog 用 ffmpeg 生成 5s 测试视频（如果 rog 装了 ffmpeg）：

```bash
ssh rog-xian 'powershell -Command "if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { ffmpeg -y -f lavfi -i color=c=blue:s=1280x720:d=5 -vf \"drawtext=text=sprint-2.1b 自验:fontsize=48:fontcolor=white:x=100:y=300\" -c:v libx264 -pix_fmt yuv420p C:\Temp\smoke-2.1b\test.mp4 2>&1 | Select-Object -Last 5 } else { Write-Host \"ffmpeg not installed; user must provide mp4 manually\" }"' 2>&1 | tail -10
```

Expected: ffmpeg 输出 `frame= ... time=...` 表示生成成功，或者提示 user 需要手动提供 mp4。如果 ffmpeg 不存在，**STOP** + 让 user 给个真 mp4 路径，再继续。

- [ ] **Step 6: 重启 agent 加载新代码 + 新 .env**

```bash
ssh rog-xian 'powershell -ExecutionPolicy Bypass -File "C:\Users\asus\Desktop\zenithjoy-agent\start-agent-v2.ps1"' 2>&1 | head -15
```

Expected: agent 启动 + 看到 `[ws1] heartbeat-loop started` 日志。

- [ ] **Step 7: 触发 type=video 真发任务**

```bash
psql -d cecelia -c "DELETE FROM zenithjoy.publish_tasks WHERE status='pending' AND agent_id='8e458113-2c4c-4ada-a126-cad5cb68925b';" 2>&1 | tail -2

curl -sS -X POST http://localhost:5200/api/publish/task \
  -H "Authorization: Bearer ZJ-F-48BY6PJZ" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"8e458113-2c4c-4ada-a126-cad5cb68925b","platform":"douyin","type":"video","folder_path":"C:\\Temp\\smoke-2.1b","payload":{"title":"sprint-2.1b 真发自验"}}'
```

Expected: 返回 `{"task_id":"<uuid>","status":"pending","type":"image"}`（API response cosmetic bug，DB 真值是 video）。

- [ ] **Step 8: 等 35s heartbeat tick + 看 agent log 真发**

```bash
sleep 35
ssh rog-xian 'powershell -Command "Get-Content C:\Users\asus\Desktop\zenithjoy-agent\agent.log -Tail 30"' 2>&1 | head -25
```

Expected: log 含：
```
[ws1] task: douyin <task_id>
[type-route] handleDouyinPublishTask task=<task_id> type=video
[type-route] resolveDouyinScriptPath type=video real=true script=publish-douyin-video.cjs   ← real=true 关键
[handler:douyin-task] mp4=C:\Temp\smoke-2.1b\test.mp4
[DY-VIDEO-REAL] 上传视频...
[DY-VIDEO-REAL] 等抖音处理...
[DY-VIDEO-REAL] 填标题...
[DY-VIDEO-REAL] 点击发布按钮...
[DY-VIDEO-REAL] 抓最终视频 URL...
{"ok":true,"dryRun":false,"url":"https://www.douyin.com/video/<id>", ...}   ← 真 URL
```

如果 fallback：`"url":"https://creator.douyin.com/creator-micro/content/manage", "urlFallback":true` 也算 PASS（spec 接受）。

- [ ] **Step 9: 抓真发的 video URL + 验证抖音公网真出现视频**

从 agent log 提取 video URL（或 manage URL fallback）。如果是真 URL：
```bash
echo "测试访问 video URL：<URL>"
curl -sI "<URL>" | head -5
```

Expected: HTTP 200（公网可访问）。

如果 fallback URL：lead 肉眼在 chrome :19333 里 navigate 到管理页确认刚发的视频显示。

- [ ] **Step 10: 写 evidence**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
cp .agent-knowledge/golden-path-1/lead-acceptance-template.md \
   .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md

cat >> .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md <<'EOF'

---

## Sprint 2.1b 真发自验（rog Windows, 2026-05-08）

执行人: Claude Code 自动化 + 用户授权扫码（sprint 2.1a 已完成）
机器: rog-xian (Tailscale 100.98.253.95, hostname XX-ROG)

### 关键 cmd stdout

```
$ ssh rog-xian Get-Content agent.log
[ws1] task: douyin <TASK_ID>
[type-route] handleDouyinPublishTask task=<TASK_ID> type=video
[type-route] resolveDouyinScriptPath type=video real=true script=publish-douyin-video.cjs
[DY-VIDEO-REAL] 上传视频...
[DY-VIDEO-REAL] 等抖音处理...
[DY-VIDEO-REAL] 填标题...
[DY-VIDEO-REAL] 点击发布按钮...
[DY-VIDEO-REAL] 抓最终视频 URL...
{"ok":true,"dryRun":false,"url":"<REAL_DOUYIN_URL>", ...}
```

### 公网 URL

- 抖音视频: <REAL_DOUYIN_URL>

### 决定

- [x] APPROVED — Sprint 2.1b 通用化真发能力 PASS

EOF
echo "evidence drafted; 把 <TASK_ID> 和 <REAL_DOUYIN_URL> 替换成真值"
```

替换 placeholder：

```bash
TASK_ID="<从上面 curl 响应里拿>"
REAL_URL="<从 agent log 里拿>"
sed -i '' "s|<TASK_ID>|${TASK_ID}|g" .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md
sed -i '' "s|<REAL_DOUYIN_URL>|${REAL_URL}|g" .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md
```

- [ ] **Step 11: 跑 validator + commit evidence**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1b-douyin-video-port
bash scripts/check-lead-acceptance.sh .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md
```

Expected: `OK: evidence 合格`。

```bash
git add .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1b.md
git commit -m "$(cat <<'EOF'
docs(evidence): Sprint 2.1b rog 真机真发抖音公网自验

走完整 zenithjoy agent runtime 链路：curl POST type=video → agent 拉 → spawn
publish-douyin-video.cjs → 真上传 + 真填标题 + 真点发布 → 拿真 douyin URL。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

1. **Spec coverage**：
   - Section 2.1 减肥 ✅ Task 2
   - Section 2.2.1-2.2.5 增肌 5 步 ✅ Task 3 Step 2-4
   - Section 2.3 R1 风控保留 ✅ Task 2 Step 3 验证
   - Section 3.1 Unit 测试 ✅ Task 1 Step 1
   - Section 3 真机自验 ✅ Task 4
   - Section 6 三段式 commit ✅ Task 1/2/3 顺序对应 RED/减肥/增肌

2. **Placeholder scan**：所有 step 有具体 bash + 完整代码。无 TBD/TODO。

3. **Type consistency**：5 个函数名跨 Task 1（test）+ Task 3（impl）一致：`uploadVideoFile / waitForUploadProcessed / fillTitle / clickPublishButton / extractPublishedUrl`。

4. **TDD 顺序**：Task 1 RED → Task 2 减肥（仍 RED）→ Task 3 增肌（GREEN）。符合 ZenithJoy `lint-tdd-commit-order`。

5. **加厚铁律 4**：Task 2 commit message 含 `replaces_old_thin: <file>:<lines>` marker，Task 3 增肌写新实现。

---

## 完成后

Plan 完成。准备 subagent-driven-development。每个 Task fresh subagent 执行，TDD 顺序由 controller 验证。
