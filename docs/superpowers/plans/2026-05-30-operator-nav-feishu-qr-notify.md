# Operator 导航 + 飞书 QR 推送 + 告警改飞书 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三项改进：超管导航加 Operator 入口；QR 扫码时截图推飞书卡片；session 失效告警改发飞书群。

**Architecture:** 纯改动，不引入新服务。飞书图片上传用 Cecelia App 凭据，推送统一走 ZENITHJOY_FEISHU_WEBHOOK（悦升云端总群）。

**Tech Stack:** React/TypeScript, Node.js CJS, Playwright, Feishu Bot API

---

## 文件结构

- Modify: `apps/dashboard/src/contexts/InstanceContext.tsx:32-68` — 加 feature flag
- Modify: `services/agent/publishers/qr-bind-operator.cjs:113-115` — 截图 + 飞书推送
- Modify: `scripts/sessions/verify-operator-douyin.js:25-55,83-84,135-136,151-152,175-176` — 移除 Bark，改飞书
- Modify: `.github/workflows/douyin-operator-session-e2e.yml:41-44` — 换 secret 名

---

## Task 1: 超管导航加 Operator 入口

**Files:**
- Modify: `apps/dashboard/src/contexts/InstanceContext.tsx:67`

- [ ] **Step 1: 在 features 对象末尾加一行**

在 `apps/dashboard/src/contexts/InstanceContext.tsx` 第 67 行（`'canvas': true,` 下方），加：

```typescript
    'operator-dashboard': true,  // /operator Session 健康监控（superAdmin only）
```

完整上下文（第 64-69 行变为）：
```typescript
    'content-clipper': true,
    'content': true,
    'platform-status': true,
    'publish-stats': true,
    'scraping': true,
    'tools': true,
    'canvas': true,
    'operator-dashboard': true,  // /operator Session 健康监控（superAdmin only）
  },
```

- [ ] **Step 2: 验证导航项已存在于配置**

确认 `apps/dashboard/src/config/navigation.config.ts` 第 273-280 行已有：
```typescript
{
  path: '/operator',
  icon: MonitorCheck,
  label: 'Session 健康监控',
  featureKey: 'operator-dashboard',
  requireSuperAdmin: true,
  component: 'OperatorPage',
},
```
如果存在，无需修改。

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/contexts/InstanceContext.tsx
git commit -m "feat(dashboard): 开启 operator-dashboard feature flag，超管导航显示 Session 健康监控入口

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: QR 弹窗截图 → 飞书互动卡片

**Files:**
- Modify: `services/agent/publishers/qr-bind-operator.cjs:113-115`

- [ ] **Step 1: 在 3 秒等待后插入截图 + 飞书推送函数**

在 `services/agent/publishers/qr-bind-operator.cjs` 顶部（第 16 行，`const os = require('os');` 之后）加辅助函数：

```javascript
const https = require('https');

async function sendFeishuQrCard(platform, screenshotBuffer) {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) return;

  try {
    // 1. 拿 app_access_token
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenJson = await tokenRes.json();
    const token = tokenJson.app_access_token;
    if (!token) throw new Error(`token 获取失败: ${JSON.stringify(tokenJson)}`);

    // 2. 上传图片（FormData/Blob 在 Node.js 18+ 是全局变量，无需 require）
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([screenshotBuffer], { type: 'image/png' }), 'qr.png');
    const imgRes = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const imgJson = await imgRes.json();
    const imageKey = imgJson.data?.image_key;
    if (!imageKey) throw new Error(`图片上传失败: ${JSON.stringify(imgJson)}`);

    // 3. 发飞书互动卡片
    const PLATFORM_DISPLAY = {
      douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书',
      shipinhao: '视频号', toutiao: '头条', weibo: '微博',
      zhihu: '知乎', gongzhonghao: '公众号',
    };
    const displayName = PLATFORM_DISPLAY[platform] || platform;
    const card = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: `🔑 ${displayName} 扫码绑定请求` }, template: 'blue' },
        elements: [
          { tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '二维码' } },
          { tag: 'div', text: { tag: 'plain_text', content: '请在 3 分钟内用手机扫描上方二维码' } },
        ],
      },
    };
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
    process.stderr.write(`[qr-bind-operator:${platform}] 飞书 QR 卡片已发送\n`);
  } catch (e) {
    process.stderr.write(`[qr-bind-operator:${platform}] 飞书推送失败（不影响扫码）: ${e.message}\n`);
  }
}
```

- [ ] **Step 2: 在 3 秒等待后调用截图 + 推送**

找到第 115 行（`await new Promise(r => setTimeout(r, 3000));`），在其后插入：

```javascript
    // 截图发飞书（失败不影响主流程）
    if (page && page.screenshot) {
      try {
        const qrBuf = await page.screenshot({ type: 'png' });
        await sendFeishuQrCard(platform, qrBuf);
      } catch (screenshotErr) {
        process.stderr.write(`[qr-bind-operator:${platform}] 截图失败: ${screenshotErr.message}\n`);
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add services/agent/publishers/qr-bind-operator.cjs
git commit -m "feat(agent): QR 弹窗截图后推飞书互动卡片到悦升云端总群

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Session 失效告警改发飞书群 + 移除 Bark

**Files:**
- Modify: `scripts/sessions/verify-operator-douyin.js`
- Modify: `.github/workflows/douyin-operator-session-e2e.yml`

- [ ] **Step 1: 替换常量声明（第 25-26 行）**

将：
```javascript
const BARK_URL = process.env.BARK_URL || 'https://api.day.app/QU7ktbzPJxZbNx9pEHcstW';
const FEISHU_BOT_WEBHOOK = process.env.FEISHU_BOT_WEBHOOK || '';
```
改为：
```javascript
const ZENITHJOY_FEISHU_WEBHOOK = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
```

- [ ] **Step 2: 删除 barkNotify 函数（第 29-35 行）**

删除整个 `barkNotify` 函数：
```javascript
async function barkNotify(title, body) {
  const encoded = `${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  const url = `${BARK_URL}/${encoded}?group=ZenithJoy`;
  return new Promise((resolve) => {
    https.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
  });
}
```

- [ ] **Step 3: 更新 sendFeishuAlert 函数（第 37-55 行）**

将 `FEISHU_BOT_WEBHOOK` 替换为 `ZENITHJOY_FEISHU_WEBHOOK`：
```javascript
async function sendFeishuAlert(title, content) {
  if (!ZENITHJOY_FEISHU_WEBHOOK) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${content}` } });
  return new Promise((resolve) => {
    try {
      const u = new URL(ZENITHJOY_FEISHU_WEBHOOK);
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
```

- [ ] **Step 4: 移除所有 barkNotify 调用（4 处）**

将每处 `Promise.allSettled([barkNotify(...), sendFeishuAlert(...)])` 改为直接 `await sendFeishuAlert(...)`：

第 82-85 行改为：
```javascript
      await sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret');
```

第 134-137 行改为：
```javascript
      await sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret');
```

第 150-153 行改为：
```javascript
      await sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret');
```

第 174-177 行改为：
```javascript
      await sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证异常', err.message.slice(0, 200));
```

- [ ] **Step 5: 更新 workflow 环境变量**

在 `.github/workflows/douyin-operator-session-e2e.yml` 的 `env:` 块，将：
```yaml
          FEISHU_BOT_WEBHOOK: ${{ secrets.FEISHU_BOT_WEBHOOK }}
          BARK_URL: https://api.day.app/QU7ktbzPJxZbNx9pEHcstW
```
改为：
```yaml
          ZENITHJOY_FEISHU_WEBHOOK: ${{ secrets.ZENITHJOY_FEISHU_WEBHOOK }}
```

（注意：当前 workflow 文件第 42-44 行只有 `DOUYIN_OPERATOR_SESSION`、`FEISHU_BOT_WEBHOOK`、`BARK_URL`，读取当前文件确认实际行号后修改）

- [ ] **Step 6: 添加 GitHub Secret**

```bash
gh secret set ZENITHJOY_FEISHU_WEBHOOK \
  --repo perfectuser21/zenithjoy-workspace \
  --body "https://open.feishu.cn/open-apis/bot/v2/hook/5a3d4500-95ec-43fb-a10d-89a350fe9eda"
```

- [ ] **Step 7: Commit**

```bash
git add scripts/sessions/verify-operator-douyin.js \
        .github/workflows/douyin-operator-session-e2e.yml
git commit -m "feat(e2e): session 失效告警改发飞书悦升云端总群，移除 Bark

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 同步添加 agent 所需 env vars 到 GHA Secret（FEISHU_APP_ID/SECRET）

**Files:**
- GitHub Secrets（仅配置，不改代码）

- [ ] **Step 1: 从 1Password 取 Cecelia Feishu App 凭据并写入 GHA Secret**

```bash
source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
FEISHU_APP_ID=$(op item get "Feishu (飞书)" --vault CS --fields notesPlain --reveal 2>/dev/null | grep FEISHU_APP_ID | cut -d= -f2 | tr -d '"')
FEISHU_APP_SECRET=$(op item get "Feishu (飞书)" --vault CS --fields notesPlain --reveal 2>/dev/null | grep FEISHU_APP_SECRET | cut -d= -f2 | tr -d '"')

gh secret set FEISHU_APP_ID --repo perfectuser21/zenithjoy-workspace --body "$FEISHU_APP_ID"
gh secret set FEISHU_APP_SECRET --repo perfectuser21/zenithjoy-workspace --body "$FEISHU_APP_SECRET"
```

注意：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是 agent 进程的运行时环境变量，在 xian-pc 上 agent 启动时需要从 `.env` 或系统环境注入。GitHub Secrets 这里是给 CI workflow 用的（如未来 CI 也需截图推送）。

- [ ] **Step 2: 确认所有 Secrets 到位**

```bash
gh secret list --repo perfectuser21/zenithjoy-workspace | grep -E "ZENITHJOY_FEISHU|FEISHU_APP"
```

Expected output（包含）：
```
FEISHU_APP_ID       ...
FEISHU_APP_SECRET   ...
ZENITHJOY_FEISHU_WEBHOOK  ...
```

---

## 验收

- [ ] 超管登录 Dashboard → 左侧"管理员"分组可见"Session 健康监控"
- [ ] xian-pc 触发抖音 QR 绑定 → 悦升云端总群收到带截图的飞书卡片
- [ ] 手动触发 `Douyin Operator Session — E2E 验证` workflow → 失败时悦升云端总群收到告警
- [ ] CI 全绿
