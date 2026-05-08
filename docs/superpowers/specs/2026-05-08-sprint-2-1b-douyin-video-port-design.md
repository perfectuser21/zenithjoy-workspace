# Sprint 2.1b — 抖音视频真发能力通用化 Design Spec

- 日期: 2026-05-08
- 分支: `cp-05080845-ws2-sprint-21a-ws1` 基础上拉的 worktree `sprint-2-1b-douyin-video-port`
- 父 Sprint: 2.1a (transport type 字段修补 + dryrun + qr_bind)
- 类型: thin → thin++（同一 thickness 内补真发 selectors，不算 medium 升级）
- Journey: Path 1 客户首次成功 / Step 6 (中台派任务 + 真发 + 回执)
- Walking Skeleton Maturity: not_started → in_progress（首条 Journey 第一个真发的 PR）

---

## 1. Background — 为什么这个 sprint 必须做

### 1.1 Sprint 2.1a thin 已落地什么

Sprint 2.1a 在 Path 1 / Step 6 上交付了 thin 链路：

| 模块 | 状态 |
|---|---|
| `publish_tasks.type` 字段（schema + transport） | OK（2.1a transport patch 修通） |
| `handleDouyinPublishTask` 按 `payload.type` 选脚本 | OK |
| `publish-douyin-video.cjs` 真发版骨架（CDP connect / requireLogin / 风控关键词检测 / fail screenshot） | OK，但发布动作是 TODO 占位 |
| `publish-douyin-video-dryrun.cjs` | OK（开发机默认走它） |
| `qr-bind-douyin` handler（写 cookie_local_path + qr_login 状态） | OK |
| WS5 smoke `golden-path-1-smoke.sh` Step 6 走 type=video | OK，但卡在脚本占位返回 `PENDING_LEAD_VERIFICATION` 假 URL |

### 1.2 Thin 漏什么

`services/agent/publishers/douyin-publisher/publish-douyin-video.cjs` line 77-99 是真发的"心脏"，目前是 4 行 `_log` + 1 个写死的 `PENDING_LEAD_VERIFICATION` 假 URL：

```javascript
// 上传 video / 填标题 / 选标签 — selectors 用 data-testid / aria-label / role / text 优先
// TODO lead 自验时用真抖音选择器替换以下占位
_log('[DY-VIDEO-REAL] (TODO lead 自验填 selectors) 上传 video / 填标题 / 选标签 / 点真发布按钮');

// R1 风控检测 ...

// 真点发布按钮（lead 自验时这里要真选择器 + .click()）
// 此处骨架，lead 自验填 selectors。
_log('[DY-VIDEO-REAL] 提交发布请求...');

// 抓取最终视频 URL（lead 自验时填 selector / interceptor）
const videoUrl = `https://www.douyin.com/video/PENDING_LEAD_VERIFICATION`;
```

含义：rog 真机即便跑通 transport + qr-bind，也只能拿到一条假 URL 的"成功"回执 —— Step 6 实际从未真正发出过一条视频。

### 1.3 user-skill 完整版在哪

`/Users/administrator/.claude/skills/douyin-publisher/scripts/publish-douyin-video.cjs`（482 行）是生产已验证的版本，但它**写死了 xian-pc 特化路径**，不能直接搬：

| 写死的特化点 | 影响 |
|---|---|
| `WINDOWS_IP = '100.97.242.124'` | 只对 xian-pc 那台 Windows 生效 |
| `XIAN_MAC_HOST = 'xian-mac'` SCP 跳板 | 假设 mac mini → xian-mac → Windows 三段链路 |
| `WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\douyin-media'` | 写死 xuxia 用户目录 |
| `CDP_PORT = 19222` 客户端固定 | 客户机 Chrome 必须用这个端口 |
| Raw WebSocket CDP（手写 CDPClient class，140+ 行） | 不复用 zenithjoy agent 已有的 `playwright.connectOverCDP` |
| `--content <dir>` + title.txt/tags.txt/video.mp4 文件协议 | 与 zenithjoy 的 queue-file JSON 协议不兼容 |

### 1.4 通用化的产品意义

ZenithJoy 是要让"任意客户"装一个 Agent 就能真发。固化 xian-pc IP / xuxia 用户名 / xian-mac 跳板 — 任何其它客户机一上来就 fail。Sprint 2.1b 要把 user-skill 里 4 处 DOM 操作（**那部分是平台行为，对所有客户通用**）抽出来，用 zenithjoy 已有的 `playwright.connectOverCDP(ZENITHJOY_AGENT_CDP_URL)` 重写，让真发能力对任意 Agent 实例可用。

---

## 2. Scope — 要做的 3 步（机械执行）

全部改动只在 `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs` 及其新建 `__tests__/` 子目录内，不动 user-skill、不动 dashboard、不动中台。

### 2.1 减肥：删 thin 占位段

**文件**: `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs`

删除 line 77-99 的 TODO 占位 + 假 URL：

```javascript
// 上传 video / 填标题 / 选标签 — selectors 用 data-testid / aria-label / role / text 优先
// TODO lead 自验时用真抖音选择器替换以下占位
_log('[DY-VIDEO-REAL] (TODO lead 自验填 selectors) 上传 video / 填标题 / 选标签 / 点真发布按钮');

// R1 风控检测  ← 这段保留，不在删除范围
...

// 真点发布按钮（lead 自验时这里要真选择器 + .click()）
// 此处骨架，lead 自验填 selectors。
_log('[DY-VIDEO-REAL] 提交发布请求...');

// 抓取最终视频 URL（lead 自验时填 selector / interceptor）
const videoUrl = `https://www.douyin.com/video/PENDING_LEAD_VERIFICATION`;
```

**Commit message 必须含**：

```
replaces_old_thin: services/agent/publishers/douyin-publisher/publish-douyin-video.cjs:77-99
```

CI `lint-thicken-must-replace` 会用这个 marker 校验"减肥而非添加"。R1 风控关键词检测块（line 82-88）保留 — 那是 thin 已经写好的、需要保留到真发版的部分。

### 2.2 增肌：port 4 个 DOM 操作（playwright 等价封装 user-skill raw CDP 实现）

把 user-skill line 301-446 的 5 个步骤（上传 / 等处理 / 填标题 / 点发布 / 抓 URL）用 `page.locator` API 重写。**不搬 SCP / WINDOWS_IP / xian-mac / CDPClient class** —— zenithjoy 协议下 `queueData.video_path` 已经是客户机本地路径（agent runtime 已经在客户机上）。

#### 2.2.1 文件上传

**user-skill 原始（CDP raw）line 305-322**:
```javascript
const fileInputResult = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('input[type="file"]')` });
await cdp.send('DOM.setFileInputFiles', { backendNodeId: nodeResult.node.backendNodeId, files: [winVideoPath] });
```

**zenithjoy 等价（playwright）**:
```javascript
await page.setInputFiles('input[type="file"]', queueData.video_path);
```

注：`queueData.video_path` 来自中台下发的 queue-file，agent runtime 在客户机本地展开，不需要 SCP 跳板。

#### 2.2.2 等抖音处理视频（中间步骤，保留 user-skill 的 polling 思路）

**user-skill 原始 line 326-348**: 36 次 5s 轮询 `window.location.href`，等跳到 `/content/post/video` 或 `type=video`。

**zenithjoy 等价（playwright）**:
```javascript
// 抖音上传完成后，URL 会变成 /creator-micro/content/post/video，
// 同时标题输入框 hydrate 出来。两个信号取其一即可。
await page.waitForSelector('input[placeholder*="标题"]', { timeout: 60_000 });
```

60 秒 timeout（user-skill 是 3 分钟，zenithjoy 严格收紧；超时 → fail screenshot → R3 路径）。失败时 page.screenshot 存 `~/.zenithjoy/agent-fail-screenshots/` 已经在 thin 里实现，沿用。

#### 2.2.3 标题输入

**user-skill 原始 line 356-385**: 用 `Object.getOwnPropertyDescriptor` 拿 native setter，绕开 React 的受控 input，再 dispatch input + change 事件。

**zenithjoy 等价（playwright）**:
```javascript
const titleInput = page.locator('input[placeholder*="标题"]').first();
await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
await titleInput.fill(queueData.title);
```

`page.locator(...).fill()` 内部已经处理 React 受控 input（playwright 用 trusted events，比手写 native setter 更可靠）。

#### 2.2.4 发布按钮

**user-skill 原始 line 392-419**: querySelectorAll('button') + filter `text === '高清发布' || text === '发布' || text === '提交发布'`，再用 dispatchMouseEvent 真鼠标点击。

**zenithjoy 等价（playwright）**:
```javascript
// 优先用 getByRole + name 正则（最稳）；fallback 退回 text 选择器以匹配抖音 UI 改版
const publishBtn = page.getByRole('button', {
  name: /^(高清发布|发布|提交发布|确认发布)$/,
}).first();
await publishBtn.waitFor({ state: 'visible', timeout: 10_000 });
await publishBtn.click();
```

playwright 的 `.click()` 默认就是 trusted event，不需要手写 dispatchMouseEvent。

#### 2.2.5 抓最终 URL（user-skill 没明确实现这步，本 sprint design 决定）

**user-skill 现状 line 423-446**: sleep 30s → 检查 URL 是否跳到 `/content/manage`/`/content/upload`/`/content/post/`，跳到 = 成功，但**没拿到 douyin.com/video/<id> URL**，只是返回 success boolean。

**zenithjoy design 决定**:

抖音发布成功后会跳到作品管理页 `https://creator.douyin.com/creator-micro/content/manage` 或 `/creator-micro/home`。最近一条作品的真公开 URL 在管理页列表里能取到（item 上有 `<a href="//www.douyin.com/video/<id>">`）。

```javascript
// 等跳到 manage 或 home
await page.waitForURL(/\/creator-micro\/(content\/manage|home)/, { timeout: 60_000 });

// 从作品列表抓最近一条的公开 URL
const videoUrl = await page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('a[href*="douyin.com/video/"]'));
  if (!links.length) return null;
  const first = links[0];
  let href = first.getAttribute('href') || '';
  if (href.startsWith('//')) href = 'https:' + href;
  return href;
});

if (!videoUrl) {
  // fallback: 读不到列表 URL 时，至少返回管理页 URL 作为发布凭据，让 lead 自验肉眼确认
  // 本 sprint 不算 fail，但 ok.url_fallback=true 由 walking-skeleton smoke 接受
  return { ok: true, dryRun: false, url: page.url(), urlFallback: true, title: queueData.title };
}

return { ok: true, dryRun: false, url: videoUrl, title: queueData.title };
```

**urlFallback 决定的理由**：抖音作品管理页 hydrate 异步、列表渲染可能滞后；为不让 SPA 渲染时机引发 false-fail，允许 fallback 到管理页 URL（lead 自验肉眼能看到刚发的视频在列表第一条）。Smoke Step 6 PASS 条件：`ok===true` 且 `url` 含 `creator-micro` 或 `douyin.com/video`。

### 2.3 R1 风控检测保留

`publish-douyin-video.cjs` line 82-88 已经实现风控关键词检测 —— **不动**。继续在标题填写之前 / 发布按钮点击之前各跑一次（增肌后第二次跑安插在 `await publishBtn.click()` **之前**）。

---

## 3. 测试策略（4 档分类）

| 档位 | 工具 | 文件 | 何时跑 | 验证什么 |
|---|---|---|---|---|
| **E2E** | golden-path-1-smoke.sh | `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` | rog Windows lead 真机 | Step 6 PASS，回执含真 douyin.com/video URL（或 manage URL fallback） |
| **Integration** | vitest + child_process spawn | `services/agent/src/handlers/__tests__/douyin-publish.test.ts`（已有） | CI / 本机 | spawn 调用收到正确 `--queue-file <path>` args + queue file JSON 格式正确 |
| **Unit (新)** | vitest + playwright Page mock | `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs`（**本 sprint 新建**） | CI / 本机 | selector 函数（`findFileInput` / `findTitleInput` / `findPublishButton` / `extractPublishedUrl`）的 query 逻辑正确 |
| **真机自验** | lead 操作 + 文档勾选 | `sprints/2.1b/lead-acceptance-sprint-2.1b.md`（**本 sprint 新建**） | rog Windows lead | 完整 e2e 流程（扫码 → 派任务 → agent 真发 → 抖音公网真出现一条视频 → 回执 URL 可点开） |

### 3.1 Unit 测试设计（新文件）

为让 selector 逻辑可单测，重构 `publish-douyin-video.cjs` 把 4 个 selector 操作抽成纯函数，接受 `page` 参数：

```javascript
// 暴露给单测
async function uploadVideoFile(page, videoPath) { ... }
async function waitForUploadProcessed(page, timeoutMs = 60_000) { ... }
async function fillTitle(page, title) { ... }
async function clickPublishButton(page) { ... }
async function extractPublishedUrl(page) { ... }

module.exports = { uploadVideoFile, waitForUploadProcessed, fillTitle, clickPublishButton, extractPublishedUrl };
```

**单测样例**（位于 `__tests__/publish-douyin-video.test.cjs`）:
- `uploadVideoFile`：mock `page.setInputFiles`，断言 selector 是 `'input[type="file"]'`，断言传 `queueData.video_path`
- `fillTitle`：mock `page.locator(...).first().fill()`，断言 selector 是 `'input[placeholder*="标题"]'`
- `clickPublishButton`：mock `page.getByRole`，断言 args 是 `'button'` + `name: /^(高清发布|发布|提交发布|确认发布)$/`
- `extractPublishedUrl`：mock `page.evaluate`，给 fake DOM 返回 `<a href="//www.douyin.com/video/123">`，断言返回 `'https://www.douyin.com/video/123'`；给 0 个匹配 link，断言 fallback 到 `page.url()` + `urlFallback: true`

### 3.2 不写的测试（明确）

- 不写 mock 整个抖音上传流程的 happy path 集成测（要 mock 的 surface 太大，价值低）
- 不写 R1 风控关键词检测的单测（thin 已实现，这次不动那段代码）
- 不写 qr-login 的测（lib/qr-login.cjs 已有覆盖）

---

## 4. Out of Scope（明确列）

本 sprint **不做** 以下任何一项，列入 backlog：

1. **抖音风控规避**（IP 池 / 账号轮换 / 人类行为模拟） — 只保留 thin 已有的关键词检测
2. **多账号 cookie 管理** — 当前一个 agent 对应一个抖音账号，足够 Path 1
3. **真发失败重试 backoff** — 失败直接 ok:false，让中台层决定重派
4. **其他平台真发**（kuaishou/xhs/微博/...） — 铁律 2，Path 1 没真正通之前不写其它平台
5. **agent 死循环修** — Sprint 2.1a 已识别的独立 bug，不在本 sprint 范围
6. **qr_bind isLoggedIn 严格化** — Sprint 2.1a out-of-scope，沿用
7. **cover.jpg 上传** — thin → thick 升级时再做
8. **tags 自动添加** — thin → thick 升级时再做
9. **抖音作品标签 / 合集 / 定时发布** — 全部 thick 之外
10. **user-skill 那个 482 行版本的任何改动** — 它继续保留 xian-pc 特化用法，本 sprint 不动

---

## 5. Walking Skeleton 4 问 + 答案

| # | 问题 | 答案 |
|---|---|---|
| 1 | 本 sprint 推进哪条 Journey？ | Path 1 客户首次成功 / Notion: https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29 / 当前 Maturity: not_started → in_progress |
| 2 | 涉及几个角色？多角色拆多 sprint？ | **单角色**：客户 Agent runtime（services/agent/publishers/douyin-publisher/）。中台、Dashboard、CI 都不动 |
| 3 | 推进哪些 Feature？ | Feature「抖音视频真发」(Step 6) thin → thin++（同 thickness 内补 selectors，不算 medium 升级）；其它 5 步不动 |
| 4 | Feature 0 端到端 smoke = ? | `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` 跑到 Step 6，FAIL = 整 sprint FAIL。本 sprint 通过 = rog 真机执行 smoke Step 6，回执 url 含 `creator-micro` 或 `douyin.com/video` |

---

## 6. 加厚铁律 4 实施顺序（commit 顺序）

铁律 4：「先减肥再增肌，两段式 commit」。本 sprint 三段式（多一个 RED test commit 在最前 — TDD 纪律）：

### Commit 1 — RED test（写 fail unit + integration test 锁通用化契约）

```
test(douyin-video): 锁 selector 通用化契约（RED）

- 新建 services/agent/publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs
  含 uploadVideoFile / fillTitle / clickPublishButton / extractPublishedUrl 4 个单测，
  断言 selector 是平台通用形式（不含 xian-pc/xuxia/SCP/WINDOWS_IP 任何特化字符串）
- 此时这些函数还没从 publish-douyin-video.cjs 抽出，测试 require 时直接 fail（符合 RED）
- 不改 publish-douyin-video.cjs 实现
```

### Commit 2 — 减肥（删 thin 占位段）

```
refactor(douyin-video): 删 thin 占位段，腾位置给真 selectors

- 删 publish-douyin-video.cjs:77-99 的 4 行 TODO _log + PENDING_LEAD_VERIFICATION 假 URL
- R1 风控关键词检测块保留
- 不加新代码（增肌在下个 commit）

replaces_old_thin: services/agent/publishers/douyin-publisher/publish-douyin-video.cjs:77-99
```

CI `lint-thicken-must-replace` 检查 commit message 含 `replaces_old_thin:` marker。

### Commit 3 — 增肌（port 4 处 DOM 操作 + 抽函数 + RED 转 GREEN）

```
feat(douyin-video): port user-skill 真发 selectors（playwright 通用化版）

- 抽出 5 个 selector 函数（uploadVideoFile / waitForUploadProcessed /
  fillTitle / clickPublishButton / extractPublishedUrl）
- 主流程 publishDouyinVideoReal 调用这 5 个函数串起完整真发链
- module.exports 这 5 个函数让 commit 1 的单测 GREEN
- 抖音 SPA 异步：waitForLoadState('networkidle') + 60s timeout
- extractPublishedUrl 找不到列表 link 时 fallback 到管理页 URL（urlFallback:true）
- 不新增 SCP / WINDOWS_IP / xian-mac 任何特化代码（playwright connectOverCDP 已经在 lib/qr-login.cjs，复用 ZENITHJOY_AGENT_CDP_URL 环境变量）
```

---

## 7. 风险与回滚

| # | 风险 | Mitigation | 触发后回滚动作 |
|---|---|---|---|
| R1 | 抖音风控触发 | thin 已有的 `RISK_KEYWORDS` 关键词检测保留，触发时 `ok:false` 含 `'risk'` 关键词 | walking-skeleton 接受 R1 降级（ok:false + error 含 risk = sprint 不算 FAIL，hand-off 给手动复核） |
| R2 | 抖音 SPA 异步 hydrate 导致 selector 找不到 | `await page.waitForLoadState('networkidle')` + selector waitFor + 60s timeout + 多 fallback（getByRole 优先，text 选择器兜底） | 失败时 page.screenshot 存 `~/.zenithjoy/agent-fail-screenshots/`，lead 看截图判断是 hydrate 慢还是 selector 真坏 |
| R3 | 抖音 UI 改版 selector 失效 | fail screenshot + R1 关键词同机制；selector 改用 placeholder 模糊匹配（`placeholder*="标题"`）+ getByRole name 正则覆盖多种文案 | lead 看截图重新 sniff selector → 改 commit 3 的 5 个抽函数 → 重跑 smoke |
| R4 | extractPublishedUrl 抓不到真公开 URL | fallback 到管理页 URL，标 `urlFallback: true` | 不算 FAIL；后续 thicken 时再上 Network.responseReceived 监听 `/web/api/media/aweme/create_v2/` 拿真 itemId |
| R5 | 客户机 Chrome 19222 端口被占用 / 没启动 | `qr-login.cjs` 已有清晰报错，不在本 sprint 改 | 沿用现有错误信息 |

---

## 8. 完成判据（Done = ?）

全部满足：

- [ ] commit 1（RED test）push 后 CI `lint-tdd-commit-order` 不报错（test 文件先于 src 出现 ✅）
- [ ] commit 2（减肥）push 后 CI `lint-thicken-must-replace` 不报错（commit message 含 `replaces_old_thin:` marker ✅）
- [ ] commit 3（增肌）push 后单测全 GREEN
- [ ] commit 3 push 后 CI `lint-feature-has-smoke` 不报错（smoke 文件 Path 1 Step 6 已存在，没改 src 不需新加）
- [ ] rog Windows 真机执行 `golden-path-1-smoke.sh` Step 6，回执 `ok===true` 且 `url` 含 `creator-micro` 或 `douyin.com/video`
- [ ] `sprints/2.1b/lead-acceptance-sprint-2.1b.md` 全部 checkbox 由 lead 勾选
- [ ] PR 描述声明：「本 PR 把 Path 1 的 Step 6 从 ❌（占位 URL）推到 ✅（真发拿到真 URL）」

不满足任何一条 = sprint 未完成。
