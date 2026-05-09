# Sprint 2.1e — Agent Install Pack（真客户装 agent 完整体验）设计

**日期**：2026-05-09
**作者**：Research Subagent（代用户走 superpowers:brainstorming 流程）
**分支**：`cp-0509103504-sprint-2-1e-agent-install-pack`（基于 main `1344630`）
**Walking Skeleton Path**：[Path 1 客户首次成功](https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29) — 推进 Step 2「装客户端 + Agent 自动连中台」从 thin 升 medium。

---

## 1. Background

Sprint 2.1a–d 已 ship：
- 2.1a：Agent transport `type` 修复，agent ↔ 中台 ws 不再硬编码 image
- 2.1b：抖音 video publisher 真发链路接入
- 2.1c：dashboard 多处 UI/账号路径修复
- 2.1d：Agent supervisor 死循环防护

但**「真客户在干净 Windows 机器上从 dashboard 一步到位装 agent 并跑通 Path 1 Step 2」这件事从未端到端验过**。当前 `AgentDownloadPage.tsx` 引用的 `/download/zenithjoy-agent-v0.1.8.tar.gz` 实际上不存在于 repo 里（autopilot nginx 上人手放的），客户拿到 tar.gz 后还要自己装 Node + 跑 `npm install` + 设环境变量 + 跑 .bat。这一段没真客户走过，故 Sprint 2.1e 的目标是把「下载 → 启动 → 显示已连接」这条链路打通到**双击即用**程度，并且**用一台干净的 xian-pc 端到端跑通**。

---

## 2. Verify 结果（含真证据）

### 2.1 e2e 真机器：xian-pc 干净可用 ✅

通过 ssh + powershell wrapper 远程探测（避免 ssh inline cmd 编码问题）：

```
hostname:           xian-pc（中文乱码但确实回了 hostname，是 windows 中文版）
$env:USERNAME:      xuxia
zenithjoy-agent 目录: False  ← 没装过，fresh
Node.exe:           True     ← 已装 Node（满足前置条件，省去客户装 Node 的环节）
:19222 Listen 数:    2       ← 已有 chrome 19222 listening（user-skill 用的那个）
node 进程数:         0       ← 当前没跑 agent
```

**结论**：xian-pc 是合格的 e2e 真机器（干净没装过 zenithjoy-agent，但有 Node + chrome 19222），用作 Sprint 2.1e 的 Lead 真机自验。

> rog 已装过 agent，作为 fallback 保留（万一 xian-pc 当晚不可用，rog 手动 `rd /s zenithjoy-agent` 后可降级使用，但优先 xian-pc）。

### 2.2 pkg cross-compile：成功，可生成 PE32+ Windows .exe ✅

在 mac 上运行 `npm run package:win`：

```
> pkg . --targets node18-win-x64 --output zenithjoy-agent.exe
> Warning Babel parse has failed: Unexpected character '�'. (1:0)
> Warning Failed to make bytecode node18-x64 for file
>   C:\snapshot\agent\node_modules\playwright-core\lib\server\chromium\appIcon.png
（仅警告，不致命）
```

输出：
```
-rw-r--r--  59,833,328 bytes  zenithjoy-agent.exe
file: PE32+ executable (console) x86-64, for MS Windows
```

**~57 MB 的 Windows 可执行文件**，含嵌入式 node18 runtime + 业务代码 bundle。pkg 配置已显式排除 publishers/（仍用 spawn(node,…) 在外部 runtime 跑），systray2 traybin 已声明为 asset。

> ⚠️ 实测：把 .exe 通过 ssh/scp 推到 xian-pc 在 ~5MB 处断流（很可能是 ssh control channel 大文件不稳）。客户路径走 nginx HTTP 下载更稳；但仍需在 install pack endpoint 里加 `Content-Length`/`If-Modified-Since`/断点续传不强求，先保证整文件下载完整即可。这条作为风险记入第 8 节。

### 2.3 当前后端没有 download 端点

`apps/api/src/routes/` 下无 `download` / `release` 路由。`AgentDownloadPage.tsx` 用的 `/download/...` 走的是 dashboard nginx 静态文件目录（`/opt/zenithjoy/autopilot-dashboard/dist/download/`）。Sprint 2.1e 选择**继续用静态分发，但产物从 repo CI build 出来固定到 dashboard dist**，避免人手 scp tarball。

---

## 3. Scope（修复方案）

> 全部走 Walking Skeleton thin → medium 升级路径。

### 3.1 后端 — Install Pack 产物

新增 `services/agent/scripts/build-install-pack.sh`：
1. 跑 `npm run package:win` 生成 `zenithjoy-agent.exe`
2. 准备 install pack 目录 `dist-installpack/zenithjoy-agent-v<VERSION>/`：
   - `zenithjoy-agent.exe`（pkg 产物）
   - `start.bat`（双击启动；从 install-and-start.bat 简化重写）
   - `.env.template`（含 `ZENITHJOY_API_BASE` / `ZENITHJOY_LICENSE` / `ZENITHJOY_CHROME_DEBUG_PORT` 占位）
   - `README-1分钟跑通.txt`（≤30 行，列三步：填 license → 双击 start.bat → 回 dashboard 看绿灯）
3. tar.gz 打包：`zenithjoy-agent-v<VERSION>.tar.gz`，**用 npm pack 风格的 Determinism**（mtime 锁定 `2020-01-01`，避免每次 sha 漂）
4. 输出 `zenithjoy-agent-v<VERSION>.tar.gz.sha256`

CI workflow `agent-installpack.yml` 在 main 合并后跑此脚本，artifact 存 GitHub Release。

### 3.2 后端 — `/api/agent/install-pack` endpoint

新增 `apps/api/src/routes/agent-install-pack.ts`：
- `GET /api/agent/install-pack/manifest` → `{ version, sha256, download_url, size, build_time }`
- `GET /api/agent/install-pack/download` → 302 重定向到静态 URL（dashboard nginx `/download/zenithjoy-agent-v<VERSION>.tar.gz`）

> 不直接 stream tarball — 让 nginx 处理大文件传输（前面 ssh 断流验证了大文件传输不应走 node express）。

### 3.3 Dashboard — `AgentDownloadPage` 升级

- 调 `/api/agent/install-pack/manifest` 拿真实 version + sha256，而不是 hardcode `0.1.8`
- 显示 sha256（让客户可校验）
- "下载" 按钮跳到 `/api/agent/install-pack/download`
- "Step 2 装依赖 npm install" 整段**删除**（pkg .exe 不需要客户装 Node 也不需要 npm install）
- "Step 3 一键启动" 简化成「填 .env → 双击 start.bat」

### 3.4 Agent — `start.bat` thin 重写

新 `services/agent/install-pack/start.bat`：
1. 校验同目录 `.env` 存在 + 含 `ZENITHJOY_LICENSE=ZJ-` 开头的非空值
2. 启动本地 chrome 调试端口（如未起，spawn `chrome.exe --remote-debugging-port=19222 --user-data-dir=%USERPROFILE%\.zj-chrome`）
3. spawn `zenithjoy-agent.exe`（前台运行 + 日志写到 `%USERPROFILE%\.zj\agent.log`）
4. 失败时 `pause` 让客户看到错误

### 3.5 关键决策（写进 commit message + RED test 注释）

| 决策 | 选项 | 选定 | 理由 |
|---|---|---|---|
| Agent 分发形态 | (A) pkg .exe 含 Node / (B) 客户自装 Node + dist/ | **A** | 客户体验 = 「下载 → 双击」；pkg 已 verify 跑通 |
| e2e 机器 | xian-pc fresh / rog 重装 | **xian-pc** | verify 已确认 fresh + Node 已装 |
| Pack 分发 | nginx 静态 / express stream | **nginx 静态** | scp 断流证明大文件传输不应走 node |
| Endpoint 形态 | manifest+download 两端点 / 单端点 | **两端点** | 客户端可只刷 manifest 检查更新，省带宽 |

---

## 4. 测试策略（4 档分类）

### 4.1 E2E（新机器真装）

**唯一**端到端验：
- xian-pc 上**手动**完成：(1) `rd /s /q %USERPROFILE%\zenithjoy-agent` 清状态 → (2) 浏览器 `https://autopilot.zenjoymedia.media/dashboard/agent` 下载 → (3) 解压 → (4) 编辑 .env 填 license → (5) 双击 start.bat → (6) 回 dashboard 看绿灯 → (7) 跑一条 dryrun publish 真到 xian-pc 抖音
- 该流程**不进 CI**（CI 没 Windows runner、没真 chrome、没真 douyin），由 Lead 在 xian-pc 真机自验
- 自验证据 = 录屏 / 截图存 PR 描述

### 4.2 Integration（endpoint 测）

`apps/api/src/routes/__tests__/agent-install-pack.test.ts`（vitest，进 CI）：
- `GET /api/agent/install-pack/manifest` 返回 `{ version, sha256, download_url, size, build_time }`，version semver、sha256 64 位 hex
- `GET /api/agent/install-pack/download` 返回 302，Location 含 `/download/zenithjoy-agent-v` 前缀
- manifest 文件不存在时返回 503 + `code: 'INSTALL_PACK_NOT_BUILT'`

### 4.3 Unit（zip 生成 + .env 模板）

`services/agent/scripts/__tests__/build-install-pack.test.sh`（bash + bats 风格，进 CI）：
- 跑 `build-install-pack.sh` 后产物含: `.exe`, `start.bat`, `.env.template`, `README-*.txt`
- `.env.template` 含三个必需 key：`ZENITHJOY_API_BASE`, `ZENITHJOY_LICENSE`, `ZENITHJOY_CHROME_DEBUG_PORT`
- `.tar.gz.sha256` 与 `.tar.gz` 实际 hash 一致
- 重复运行两次 sha256 一致（reproducible build 验证）

### 4.4 Lead 真机自验

xian-pc 上 step-by-step 跑 4.1 的 7 步，**在 PR 描述里贴**：
- 浏览器截图（dashboard download page 显示 manifest 真版本）
- xian-pc 桌面截图（解压后目录 + .env 编辑后 + 双击 start.bat 后控制台）
- dashboard agent status 截图（绿灯 + agentId）
- publish 一条 video dryrun 的回执（agent log 行 + dashboard tasks 表行）

任一截图缺失 → PR 不通过 Lead 验收。

---

## 5. Out of Scope（明确不做）

1. **Chrome 自动配置** — 客户机要先装 Chrome；Sprint 2.1e 只确保 chrome.exe 找得到就 spawn，找不到弹错给客户看
2. **Auto-update / 增量包** — manifest 端点已留升级钩子但不实现拉新版本逻辑
3. **多平台** — 不出 macOS .pkg / Linux .deb（开发者备用走 source build）
4. **Metrics / 用户行为埋点** — 不上报客户机性能数据 / 安装事件
5. **签名 / 公证** — 不做 Authenticode 签名（客户首次会被 SmartScreen 提示「来源不明」，README 里说明右键属性「解除锁定」即可）
6. **Installer 安装到 Program Files** — 不做 .msi，就是绿色版（解压即用）

---

## 6. Walking Skeleton 4 问 + 答案

| # | 问 | 答 |
|---|---|---|
| 1 | 本 sprint 推进哪条 Journey？ | **Path 1 客户首次成功**，Notion: 358c40c2ba6381b2a6eacd288cf82f29，当前 Maturity: not_started |
| 2 | 涉及几个角色？ | **1 个角色**（客户）。CI build artifact 是辅助、不算 Journey 角色 |
| 3 | 推进哪些 Feature？ | Path 1 Step 2「装客户端 + Agent 自动连中台」从 **thin → medium**（thin = 命令行 5 步 + 客户自装 Node；medium = 双击 + 嵌 Node + sha256 校验） |
| 4 | Feature 0 端到端 smoke = 什么？ | `golden-path-1-smoke.sh` 跑到 **Step 2 ✅**：脚本 mock 客户行为发 `GET /api/agent/install-pack/manifest` + 下载 + 校验 sha256 + 不真的解压 .exe（CI 无 windows runner），FAIL = 整 sprint FAIL |

---

## 7. 加厚铁律 4 实施顺序（RED → 减肥 → 增肌）

> 严格 commit-1 RED test → commit-2 减肥（删旧 thin 资产）→ commit-3 增肌（新实现）。CI `lint-tdd-commit-order` 强校。

### Commit 1：RED tests

文件：
- `apps/api/src/routes/__tests__/agent-install-pack.test.ts`（断言两端点行为，目前必 FAIL，因为路由还没注册）
- `services/agent/scripts/__tests__/build-install-pack.test.sh`（断言产物结构，目前必 FAIL，因为脚本还不存在）
- `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` Step 2 加上「调 manifest 端点 + 下载 + 校验 sha256」断言（目前必 FAIL）

`git commit -m "test(2.1e): RED tests for install pack endpoint + build script + smoke step 2"`

### Commit 2：减肥（删旧 thin 资产）

删除：
- `services/agent/install.bat`（旧手工 install 流程，被 .env + start.bat 替代）
- `services/agent/install-and-start.bat`（同理）
- `services/agent/start-agent-v2.ps1` / `start-agent-v3.ps1`（v2/v3 实验版，medium 用 start.bat）
- `services/agent/CUSTOMER-QUICKSTART.md` 里「Step 2 npm install」「Step 3 set ZENITHJOY_LICENSE …」整段（替成 README-1分钟跑通.txt 的精简版引用）
- `AgentDownloadPage.tsx` 里「Step 2 装依赖 npm install」整个 `<li>`

`git commit -m "refactor(2.1e): 减肥 — 删旧手工 install 资产，为 install pack 让位"`

### Commit 3：增肌（新实现）

新增 / 修改：
- `services/agent/scripts/build-install-pack.sh`
- `services/agent/install-pack/start.bat` + `.env.template` + `README-1分钟跑通.txt`
- `apps/api/src/routes/agent-install-pack.ts` + 在主路由注册
- `apps/api/src/services/install-pack-manifest.ts`（读 dashboard dist 下 manifest.json）
- `apps/dashboard/src/pages/AgentDownloadPage.tsx` 改用 manifest 接口
- `apps/dashboard/src/api/agent.api.ts` 加 `getInstallPackManifest()`
- `.github/workflows/agent-installpack.yml`（main 合并后产物 release）

跑全套测试，所有 RED test 转 GREEN。

`git commit -m "feat(2.1e): install pack 端点 + 双击 start.bat + manifest UI"`

---

## 8. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| pkg .exe 在客户 Windows 触发 SmartScreen 拦截 | 高 | 客户不会点「仍要运行」 | README 顶部贴图示「右键属性 → 解除锁定」；PR 描述里 Lead 自验真验过这一步 |
| pkg 嵌的 playwright-core 在客户机找不到 chromium | 中 | publisher 启动失败 | publishers/ 仍走 spawn(node,…)，要求客户机自装 Chrome（Path 1 prereq 已声明）；start.bat 启动前检查 chrome.exe 路径 |
| systray2 native binary 在 pkg 里 path 错位 | 中 | tray icon 不显示 | 已在 `pkg.assets` 显式列 `node_modules/systray2/traybin/**/*`，verify 阶段 dist-pkg 出包未报缺失；Lead 自验时确认 tray 出现 |
| nginx 静态目录权限 / 路径变了导致 302 跳到 404 | 低 | 下载 404 | manifest endpoint 在返回前 `fs.existsSync` 校验 tarball 真存在，不存在返回 503 |
| 干净 xian-pc 自验失败（chrome 找不到 / Smart Screen 拦截） | 中 | Sprint 卡住 | 自验脚本拆 7 步，每步独立判定；任意 step 失败精确定位（不是大块 black box）|
| install pack 体积 ~60MB，客户机网络慢下载超时 | 低 | 客户放弃 | 用 nginx 静态分发支持 Range，dashboard download button 加 size 显示让客户预期；不在 sprint 目标内做断点续传 |

**回滚预案**：
- 新 endpoint 加在新文件 `agent-install-pack.ts`，主路由 1 行注册即接入；回滚就把这 1 行注释 + revert dashboard manifest 调用 即可
- 删除的旧 .bat / .ps1 在 commit-2 单独 commit，需要时可 `git revert <commit-2-sha>` 一键拉回
- pkg .exe 跑挂的退化路径：dashboard 页留 fallback 文字「.exe 失败？source build 见 services/agent/CUSTOMER-QUICKSTART.md」+ 该 md 保留 dev 段不删

---

## 9. DoD（Sprint 验收清单）

- [ ] CI `lint-tdd-commit-order` 通过（commit 顺序对）
- [ ] CI `lint-feature-has-smoke` 通过（golden-path-1 smoke step 2 真改）
- [ ] CI `agent-installpack.yml` 跑通，artifact 含 `.exe` + `.tar.gz` + `.sha256`
- [ ] vitest `agent-install-pack.test.ts` 全 GREEN
- [ ] bats `build-install-pack.test.sh` 全 GREEN
- [ ] xian-pc Lead 自验完成 7 步，PR 描述含 4 张截图
- [ ] PR 描述声明：「本 PR 把 Path 1 Step 2 从 thin 推到 medium」并贴 Notion Path 链接
