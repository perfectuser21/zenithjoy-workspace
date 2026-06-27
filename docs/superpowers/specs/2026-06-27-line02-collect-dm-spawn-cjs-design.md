# Line02 采集/私信 handler 转 spawn 外部 .cjs — 设计

> Bug fix。根因已被 PR#923（扫码 handler）实证。Journey: Line02 智能获客 (afa6abca)。
> Decision: 94f3cc2b（bug-fix）+ 5776007e（架构A）。

## 问题
真机打包 .exe 上，`keyword-search-douyin`（采集）/ `douyin-dm-outreach`（私信）两个 handler
崩 "Invalid host defined options"。根因：二者走 `loadChromium()`（`new Function` 包 import
playwright-core），该 workaround 在 pkg 二进制内仍崩（Node18+ VFS 限制）。
PR#923 已证明唯一跑通 = spawn 外部 .cjs 从真实 FS `require('playwright-core')`。
扫码 handler 已转，这两个是掉队的。采集链第三环 `handleCrawlCommentsBurner` 已是 spawn
外部 .cjs（正确套路），不动。

## 设计（照 PR#923 同构）

### 单元 1：publishers/keyword-search-douyin.cjs（新建）
- 独立 Node 进程 `require('playwright-core')`。
- `connectOverCDP(http://localhost:<cdpPort>)` 连主号已开 CDP（**非** persistent context）。
- 取 contexts[0] → newPage → goto 搜索页 → 提取前 N 条视频 URL。
- Args: `<keyword> [cdpPort=19222] [maxVideos=5]`。
- 末行 stdout 输出 JSON `{ ok, keyword, video_urls, error? }`；stderr 打日志。

### 单元 2：publishers/douyin-dm-outreach.cjs（新建）
- 独立 Node 进程 `require('playwright-core')`。
- `launchPersistentContext`（burner profile，多级浏览器 fallback bundled→chrome→msedge，headful）。
- **承载完整三态编排**（跨进程无法只驱动页面）：goto 主页 → 点私信按钮（Semi UI 选择器）→
  contenteditable 输入文案 → 回车 → 看消息气泡判 sent；按钮不可点=limited；无气泡=failed。
- Args: `<profile_url> <message> <account_label> [userDataDirRoot]`。
- 末行 stdout 输出 JSON `{ ok, status, account_label, profile_url, error_code?, error? }`；stderr 打日志。
- profile/user-data-dir 约定与 qr-bind-burner getBurnerUserDataDir 一致。

### 单元 3：keyword-search-douyin.ts（改）
- 无 `chromiumLauncher`/`chromiumLoader` 注入（生产）→ spawn 单元1 的 .cjs，解析末行 JSON。
- 注入（单测）→ 走现有内部 `connectOverCDP` 逻辑不变（保持旧单测绿）。
- 加 `resolveKeywordSearchScript()`（pkg: process.execPath 同级 publishers/；dev: __dirname 推导），
  与 `resolveBurnerScript()` 同款查找。

### 单元 4：douyin-dm-outreach.ts（改）
- 无 `options.page` 注入（生产）→ spawn 单元2 的 .cjs，解析末行 JSON。
- 注入（单测）→ 走现有 `handleDouyinDmOutreach(payload, {page})` 三态编排不变（保持旧单测绿）。
- **删掉现已死的 `createRealDmPage` + `RealPage/RealLocator/RealContext` 类型**（真机逻辑搬进 .cjs）。
- 加 `resolveDmOutreachScript()` + spawn helper。

### 版本
- bump `2.0.36 → 2.0.37`（services/agent/package.json）。

### 打包
- `build-install-pack.sh:214 cp -r publishers/` 已自动带新 .cjs，无需改打包脚本。

## 测试策略
- **Unit（旧，保持绿）**：两个 handler 注入式单测走内部编排，断言不变。
- **Regression 守卫（新，proven-to-fire）**：照 qr-bind-douyin-burner.test.ts，对两个 handler 加断言：
  源码含 `spawn` + 指向各自 `publishers/*.cjs`、`resolve*Script()` 落点为 `publishers/*.cjs`、
  `.cjs` 文件真实存在。这是 CI 闸门（环境接缝守卫，与扫码 PR 同级）。
- **E2E 真机（CI 外，HANDOFF ②）**：rog 真机跑整条链（关键词→采集出名单→私信发出）= 终极 proven-to-fire。
- **.cjs 本身**：需真浏览器，不进 CI 单测；由「源码 spawn 断言 + .cjs 存在」守卫 + 真机run 兜底。

## 不做
- 不改 `handleCrawlCommentsBurner`（已正确）。
- 不改 `loadChromium`/playwright-launcher（仍服务注入式单测路径）。
- 不动频控/AI 打分/定时调度（HANDOFF ③，另立 sprint）。
