# 抖音运营员 Session CI E2E 验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `scripts/sessions/verify-operator-douyin.js` + `.github/workflows/douyin-operator-session-e2e.yml`，在 windows-latest CI 上用 Playwright headless 验证 `DOUYIN_OPERATOR_SESSION` session 有效（无需扫码），FAIL 时 Bark + 飞书双渠道告警。

**Architecture:** 独立 ESM 脚本读取 `DOUYIN_OPERATOR_SESSION` env（Playwright storageState JSON），写临时文件后启动 headless chromium，以 storageState 加载 context，导航至 creator.douyin.com，等 SPA settle 后检查 URL 非 /login + 拦截 user/info API 响应，FAIL 时发告警并截图。CI workflow 跑在 `windows-latest`，使用 `services/agent` 的 playwright@1.49，手动触发 + 每周日定时。

**Tech Stack:** Node.js 20, ESM, playwright@1.49（来自 services/agent），GitHub Actions windows-latest

---

### Task 1: 写验证脚本 verify-operator-douyin.js

**Files:**
- Create: `scripts/sessions/verify-operator-douyin.js`

- [ ] **Step 1: 创建脚本文件**

创建 `scripts/sessions/verify-operator-douyin.js`，完整内容如下：

```js
#!/usr/bin/env node
/**
 * 抖音运营员 Session E2E 验证
 *
 * 从 DOUYIN_OPERATOR_SESSION 环境变量读取 Playwright storageState，
 * 启动 headless Chrome，导航到 creator.douyin.com，
 * 确认已登录（URL 不含 /login + creator user/info API 返回正常）。
 *
 * PASS → exit 0 + douyin-session-pass.png
 * FAIL → exit 1 + douyin-session-fail.png + Bark + 飞书告警
 */

import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';

const CREATOR_URL = 'https://creator.douyin.com/creator-micro/home';
const SPA_SETTLE_MS = 3000;
const NAV_TIMEOUT_MS = 30000;
const BARK_URL = process.env.BARK_URL || 'https://api.day.app/QU7ktbzPJxZbNx9pEHcstW';
const FEISHU_BOT_WEBHOOK = process.env.FEISHU_BOT_WEBHOOK || '';

async function barkNotify(title, body) {
  const encoded = `${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  const url = `${BARK_URL}/${encoded}?group=ZenithJoy`;
  return new Promise((resolve) => {
    https.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
  });
}

async function sendFeishuAlert(title, content) {
  if (!FEISHU_BOT_WEBHOOK) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${content}` } });
  return new Promise((resolve) => {
    try {
      const u = new URL(FEISHU_BOT_WEBHOOK);
      const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const req = https.request(options, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.write(payload);
      req.end();
    } catch { resolve(0); }
  });
}

async function main() {
  const sessionRaw = process.env.DOUYIN_OPERATOR_SESSION;
  if (!sessionRaw) {
    console.error('[FAIL] DOUYIN_OPERATOR_SESSION 环境变量未设置');
    process.exit(1);
  }

  let storageState;
  try {
    storageState = JSON.parse(sessionRaw);
  } catch {
    console.error('[FAIL] DOUYIN_OPERATOR_SESSION 不是合法 JSON');
    process.exit(1);
  }

  const cookies = storageState.cookies ?? [];
  console.log(`[info] storageState 已解析，共 ${cookies.length} 个 cookies`);

  // 快速过期检查（不用启动浏览器）
  const sessionid = cookies.find(c => c.name === 'sessionid');
  if (sessionid?.expires) {
    const exp = new Date(sessionid.expires * 1000);
    if (exp < new Date()) {
      const msg = `sessionid 已过期（${exp.toISOString().slice(0,10)}）`;
      console.error(`[FAIL] ${msg}`);
      await Promise.allSettled([
        barkNotify('抖音运营员 Session 失效', msg + ' — 请重新扫码'),
        sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret'),
      ]);
      process.exit(1);
    }
    console.log(`[info] sessionid 有效期至 ${new Date(sessionid.expires * 1000).toISOString().slice(0,10)}`);
  }

  // 写临时 storageState 文件
  const tmpFile = path.join(os.tmpdir(), `douyin-operator-session-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(storageState));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: tmpFile,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    // 拦截 user/info API
    let apiStatus = null;
    let apiOk = false;
    context.on('response', async (resp) => {
      if (resp.url().includes('/web/api/base/creator/user/info')) {
        apiStatus = resp.status();
        try {
          const body = await resp.json();
          apiOk = body.status_code === 0 || !!body.user_info || !!body.creator_info;
        } catch { apiOk = resp.status() === 200; }
      }
    });

    const page = await context.newPage();
    console.log(`[info] 导航至 ${CREATOR_URL} ...`);
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    console.log(`[info] 等待 SPA settle (${SPA_SETTLE_MS}ms)...`);
    await page.waitForTimeout(SPA_SETTLE_MS);

    const finalUrl = page.url();
    console.log(`[info] 最终 URL: ${finalUrl}`);

    const isOnLoginPage = /\/login(\b|\/|$)/i.test(finalUrl);

    if (isOnLoginPage) {
      await page.screenshot({ path: 'douyin-session-fail.png', fullPage: false }).catch(() => {});
      const msg = `导航后停在登录页（${finalUrl}）`;
      console.error(`[FAIL] ${msg}`);
      await Promise.allSettled([
        barkNotify('抖音运营员 Session 失效', 'CI 验证失败 — 请重新扫码'),
        sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret'),
      ]);
      process.exit(1);
    }

    // 等待 API 响应
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'douyin-session-pass.png', fullPage: false }).catch(() => {});

    console.log(`[info] user/info API: status=${apiStatus ?? '未捕获'} ok=${apiOk}`);

    if (apiStatus !== null && !apiOk) {
      const msg = `user/info API 返回异常（HTTP ${apiStatus}）`;
      console.error(`[FAIL] ${msg}`);
      await Promise.allSettled([
        barkNotify('抖音运营员 Session 失效', msg + ' — 请重新扫码'),
        sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret'),
      ]);
      process.exit(1);
    }

    console.log('');
    console.log('============================================');
    console.log('  PASS: 抖音运营员 session 有效');
    console.log(`  URL: ${finalUrl}`);
    if (apiStatus) console.log(`  API: ${apiStatus} ok=${apiOk}`);
    console.log('============================================');

  } finally {
    await browser?.close();
    fs.rmSync(tmpFile, { force: true });
  }
}

main().catch(async (err) => {
  console.error('[FAIL] 未预期异常:', err.message);
  await Promise.allSettled([
    barkNotify('抖音运营员 Session 验证异常', err.message.slice(0, 100)),
    sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证异常', err.message.slice(0, 200)),
  ]).catch(() => {});
  process.exit(1);
});
```

- [ ] **Step 2: 在 worktree 目录确认文件已写入**

```bash
ls -la scripts/sessions/verify-operator-douyin.js
```

Expected: 文件存在，大小 > 2000 bytes

- [ ] **Step 3: 本地语法检查（Node.js ESM）**

```bash
node --input-type=module < scripts/sessions/verify-operator-douyin.js 2>&1 | head -5
```

Expected: `[FAIL] DOUYIN_OPERATOR_SESSION 环境变量未设置`（正常退出 1，说明脚本语法没问题）

- [ ] **Step 4: commit 脚本**

```bash
git add scripts/sessions/verify-operator-douyin.js
git commit -m "feat(sessions): 新增 verify-operator-douyin.js — Playwright headless 验证运营员 session

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 写 CI workflow

**Files:**
- Create: `.github/workflows/douyin-operator-session-e2e.yml`

- [ ] **Step 1: 创建 workflow 文件**

创建 `.github/workflows/douyin-operator-session-e2e.yml`，完整内容如下：

```yaml
name: Douyin Operator Session — E2E 验证

on:
  workflow_dispatch:
    inputs:
      debug:
        description: '打印 session cookie 数量（不打印值）'
        required: false
        default: 'false'
  schedule:
    # 每周日北京午夜（UTC 16:00 = 北京 00:00+8）
    - cron: '0 16 * * 0'

jobs:
  verify-operator-session:
    name: 验证抖音运营员 Session（无扫码）
    runs-on: windows-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: services/agent/package-lock.json

      - name: Install agent dependencies（含 playwright）
        working-directory: services/agent
        run: npm ci

      - name: Install Playwright chromium browser
        working-directory: services/agent
        run: npx playwright install chromium --with-deps

      - name: Run operator session E2E verify
        env:
          DOUYIN_OPERATOR_SESSION: ${{ secrets.DOUYIN_OPERATOR_SESSION }}
          FEISHU_BOT_WEBHOOK: ${{ secrets.FEISHU_BOT_WEBHOOK }}
          BARK_URL: https://api.day.app/QU7ktbzPJxZbNx9pEHcstW
        run: node scripts/sessions/verify-operator-douyin.js

      - name: Upload session screenshot
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: douyin-session-screenshot-${{ github.run_number }}
          path: |
            douyin-session-pass.png
            douyin-session-fail.png
          if-no-files-found: ignore
          retention-days: 14
```

- [ ] **Step 2: 验证 YAML 格式**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/douyin-operator-session-e2e.yml')); print('YAML OK')"
```

Expected: `YAML OK`

- [ ] **Step 3: commit workflow**

```bash
git add .github/workflows/douyin-operator-session-e2e.yml
git commit -m "feat(ci): 新增 douyin-operator-session-e2e workflow — windows-latest Playwright 无扫码验证

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: push + PR

- [ ] **Step 1: push 分支**

```bash
git push origin cp-20260529-douyin-operator-session-ci
```

Expected: 分支推送成功

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "feat(ci): 抖音运营员 session CI E2E 验证（无扫码）" \
  --body "$(cat <<'EOF'
## Summary
- 新增 `scripts/sessions/verify-operator-douyin.js`：Playwright headless 验证 DOUYIN_OPERATOR_SESSION storageState 能无扫码访问 creator.douyin.com
- 新增 `.github/workflows/douyin-operator-session-e2e.yml`：windows-latest，手动触发 + 每周日定时，FAIL 时 Bark + 飞书告警

## Test plan
- [ ] 手动触发 workflow_dispatch，确认 verify-operator-session job PASS
- [ ] 截图 artifact 显示 creator dashboard（非登录页）
- [ ] CI 全绿

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL 打印

- [ ] **Step 3: 触发手动 E2E 验证**

```bash
gh workflow run douyin-operator-session-e2e.yml --repo perfectuser21/zenithjoy-workspace
```

或在 GitHub UI 点 `workflow_dispatch`，等待 job 完成后下载截图 artifact 确认。

- [ ] **Step 4: 确认 CI 全绿后 enable auto-merge**

```bash
PR_NUM=$(gh pr list --head cp-20260529-douyin-operator-session-ci --json number -q '.[0].number')
gh pr merge "$PR_NUM" --auto --squash
```
