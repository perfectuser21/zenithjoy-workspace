# Sprint PRD — WS2 Sprint 2.1：抖音真发 + Lead 自验机制

## OKR 对齐

- **对应 KR**：KR-1（"ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付"）
- **当前进度**：77%
- **本次推进预期**：80%（+3pp，把 Path 1 从 not_started 推进到 skeleton 并启动 mvp 第一步）

## 背景

WS1 sprint（2026-05-07）跑通 Path 1「客户首次成功路径」6 步 thin 骨架，但暴露 3 个生产级痛点：

1. **抖音 publisher 全是 dryrun**（`publish-douyin-image-dryrun.cjs` 等只填字段、不点发布按钮），客户视角无法真发到公网
2. **Agent type 路由 bug**：lead 体感"昨天发了视频，结果发成图文"。可能在 Dashboard→中台→Agent→脚本选择 4 个环节中某一处 type=video 被改成 image，或根本就没有 video 真发脚本
3. **Lead 没在客户机自验**（`.agent-knowledge/` 下无 lead-acceptance 记录），导致 P0 bug 在用户面前才暴露

按 walking-skeleton 铁律 7（lead 客户机自验）+ 加厚靠真实反馈：本 sprint 是 WS2 三段式拆分的第 1 个 mini-sprint，聚焦「抖音真发 + 修路由 bug + 建立 lead 自验机制」，把 Path 1 Step 5/6 thin → medium。

---

## 1. Journey 上下文（v9 — 来自 5 问 Q1）

- **Journey 名称**：客户首次成功路径
- **Notion URL**：https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29
- **当前 Maturity**：not_started → skeleton（本 sprint 启动后）→ mvp 第一步
- **Journey Type**：user_facing
- **端到端步骤**（共 6 步）：
  - Step 1: 注册（含 free license 自动签发）
  - Step 2: 装客户端 + Agent 自动连中台
  - Step 3: 画像诊断（行业/受众/风格 3 字段）
  - Step 4: 扫码绑定快手（Agent 弹登录窗）
  - Step 5: AI 生成 1 条内容（接 Claude API）
  - Step 6: 中台派任务 + 真发抖音 + 回执
- **E2E Test Path**：`.github/workflows/scripts/smoke/golden-path-1-smoke.sh`

## 2. Feature 清单（v9 — 来自 5 问 Q3）

| # | Feature 名称 | Journey Step | thickness from → to | 备注 |
|---|---|---|---|---|
| 1 | 抖音真发 publisher (image) | Step 6 | new → thin | 替换 `publish-douyin-image-dryrun.cjs`，真发到公网，**未登录时弹抖音扫码窗等待 lead 手机扫码** |
| 2 | 抖音真发 publisher (video) | Step 6 | new → thin | 真发视频到公网，根治"视频发成图文" bug，**同样支持未登录时弹扫码窗** |
| 3 | 抖音首次扫码绑定 UI | Step 4 扩展 | new → thin | Dashboard / Agent 弹抖音登录二维码 → lead 手机扫码 → cookie 落 Agent 本地（不入库不预置）。每个新客户首次必须走这一步 |
| 4 | Step 6 中台派任务 + Agent 路由 + 回执 | Step 6 | thin → medium | 含 Agent type 路由层修复 + 4 环节日志 + 真发 publisher 接入 + cookie 失效检测 |
| 5 | Step 5 AI 生成内容 | Step 5 | thin → medium | 错误处理、超时重试、prompt 校验、Claude API 失败 fallback。**Proposer 在 contract 阶段先查现状判断 thin 是否真已接 Claude API**，若仍 mock 则 medium 范围扩到"先接真 API" |
| 6 | Lead 客户机自验机制 | （横切，所有 step）| new → thin | `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1.md` 模板 + **xian-pc** Windows 真机执行流程 + lead 手机扫码协作流程 + 后续 sprint 复用 |

**加厚必填 `replaces_old_thin`**（按铁律 6 — 加厚先减肥再增肌，commit A 删旧 / commit B 写新）：

- Feature 1 / 2 真发 publisher 替换：
  - `apps/agent/scripts/publish-douyin-image-dryrun.cjs`
  - `apps/agent/scripts/publish-douyin-video-dryrun.cjs`（如存在；不存在则 Feature 2 是纯新建，不需要删旧）
- Feature 3 中台派任务 thin → medium 替换：
  - Agent 选脚本逻辑里硬编码默认走 image 的部分（疑点之一，sprint 中由 Generator 定位具体文件 + line）
  - Step 6 旧的 mock receipt 回执（CI 仍允许 mock，但客户路径必须真回执）
- Feature 4 Step 5 thin → medium 替换：
  - 任何硬编码 prompt 不校验输入的部分
  - 任何无超时直调 Claude API 的部分

## 3. Feature 0：Journey 端到端验证（v9 — 来自 5 问 Q4，gating）

- **smoke 路径**：`.github/workflows/scripts/smoke/golden-path-1-smoke.sh`
- **验证范围**：从 Step 1 跑到 Step 6（全 6 步）
- **gating 规则**：Feature 0 FAIL = 整 sprint FAIL，不论其他 Feature 状态
- **Reviewer 必挑战项**（Proposer 起草合同时必须含）：
  - smoke 真的从 Step 1 跑到 Step 6？没中间 `exit 0` 假装通过？
  - Step 5 真链路调 Claude API（不是 mock）？Proposer 已查明现状？
  - Step 6 在 CI 仍 dryrun（避免污染公网）；但 dryrun 必须真填字段、真到达"等待发布"页（不是空 exit 0）
  - Agent 路由层有日志：能从 stdout/log 看到 type=video → 选了 video 脚本（不是 fallback image）
  - 抖音 publisher 在未登录时真的弹扫码窗（不是静默失败 / 不是预置 cookie 跳过）
  - Lead 自验 evidence 文件存在 + 含真发抖音视频公网 URL + 弹扫码窗截图（证明走真实新客户路径）

## 4. Lead 客户机自验（v9 — 来自 5 问 Q5，铁律 7）

- **worker_machine**：`xian-pc`（西安 Windows PC，Tailscale 已通；xian-rog 当前 SSH 不可达本 sprint 不用，留待 xian-rog 接入后续 sprint 启用）
- **协作模式**：lead 在 Mac mini 上 ssh 到 xian-pc 远程操作 + lead 拿手机配合现场扫码（用户已确认愿意配合扫码）
- **checklist**（≥5 步，按真实新客户视角顺序，**严禁预置 cookie 跳过扫码**）：
  1. 从本地 Mac mini ssh / Tailscale 到 xian-pc（凭据 1Password CS Vault "Xian PC (node-pc-xian)"）
  2. 在 xian-pc 浏览器打开 ZenithJoy Dashboard，**用全新邮箱注册**（注册后自动签发 free license + tenant，Step 1 thin 不动）
  3. 在 xian-pc 下载并安装客户端 + Agent，Agent 自动连接中台 heartbeat（Step 2 thin 不动）
  4. 填画像 3 字段（Step 3 thin 不动）
  5. 在 Dashboard 触发"绑定抖音"→ Agent 在 xian-pc 弹出抖音登录二维码窗口（Step 4 扩展，Feature 3 新增）
  6. **lead 拿手机抖音 App 扫码登录** → cookie 落 Agent 本地工作目录（不入库、不预置）
  7. 在 Dashboard 触发"AI 生成内容" type=**video**（Step 5 medium）
  8. 中台 publish_task 写入 `{type:video, platform:douyin}` → Agent 拉任务 → **路由到 video 真发脚本**（不是 image fallback）→ 真发到抖音公网（Step 6 medium，Feature 2）
  9. 在 lead 手机抖音 App 验证视频真出现 + 抓抖音公网视频 URL
  10. 把每步 cmd stdout + 弹扫码窗截图 + 抖音公网视频 URL 截图归档
- **evidence_path**：`.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1.md`
- **完成判据**：
  - evidence 文件存在
  - 含 cmd stdout 摘录（每步关键命令的输出）
  - 含抖音公网视频 URL（lead 在手机抖音 App 看得见的真实视频，截图）
  - 含弹扫码窗截图（证明走的是真实"新客户首次扫码"路径，没有偷懒预置 cookie）
  - lead 在 xian-pc 真跑过全链路（ssh stdout + 手机扫码协作）
  - **未自验或证据为空 = sprint 不能 deliver 给用户测真账号，整 sprint FAIL**
  - **若 evidence 含预置 cookie 跳过扫码的痕迹 = 不算合格 lead 自验，整 sprint FAIL**（这是真实客户场景的核心特征）

## 5. Golden Path（核心场景）

**入口**：客户在 xian-pc Windows 机器上，从 0 开始，**没有任何 ZenithJoy 账号、没装任何东西、抖音也没登录过**。

**关键步骤**：
1. 客户访问 ZenithJoy Dashboard，注册邮箱+密码 → 自动签发 free license + free tenant（Step 1，沿用 thin，本 sprint 不改）
2. 客户下载 ZenithJoy 客户端 + Agent，安装 → Agent 自动连接中台 heartbeat（Step 2，沿用 thin）
3. 客户填画像表单 3 字段：行业 / 受众 / 风格（Step 3，沿用 thin）
4. 客户在 Dashboard 触发「绑定抖音」→ **Agent 弹出抖音登录二维码窗口** → 客户用手机抖音 App 扫码 → cookie 落 Agent 本地（Step 4 扩展，Feature 3 新增；快手扫码沿用 thin）
5. 客户在 Dashboard 点击「生成内容」，**指定 type=video**，中台调 Claude API 生成视频脚本/标题/标签（Step 5 medium：超时重试 + 错误处理 + prompt 校验）
6. 中台 publish_task 表写入 `{type: video, platform: douyin, payload: {...}}`，Agent 拉任务 → **路由到 `publish-douyin-video.cjs`（不是 image dryrun！）** → 用本地 cookie 真发视频到抖音公网（Step 6 medium）
7. Agent 抓抖音返回的视频 URL，回填 publish_task.receipt → 中台 dashboard 显示「发布成功 + 视频 URL」（Step 6 medium）

**出口**：客户在自己的手机抖音 App 看见刚发的视频（公网可见），在 ZenithJoy Dashboard 看见 ✅ 状态 + 抖音 URL。

**反 Golden Path**（本 sprint 必须明确不允许）：
- ❌ 不允许：在 xian-pc 上预置抖音 cookie，跳过 Step 4 扫码 — 这不是真实新客户场景
- ❌ 不允许：Step 6 中台下发 type=video 但 Agent 路由到 image 脚本（昨天的 P0 bug 根因）
- ❌ 不允许：发布失败但 Dashboard 显示成功

## 边界情况

- **抖音风控**：账号被风控 / cookie 失效 → 客户视角看到清晰错误"抖音登录失效，请重新扫码"。不允许静默失败
- **Claude API 失败**：超时 / 429 / 5xx → Step 5 重试 3 次 + 兜底返回"AI 临时不可用，请稍后再试"
- **Agent 路由 bug 类回退**：type=video 但 video 脚本不存在 → 客户视角清晰报错"该平台暂不支持 video 类型"，**严禁悄悄 fallback 到 image**（这是昨天 P0 bug 的根因之一）
- **真发到一半失败**（如视频上传成功但发布按钮失败）→ Agent 必须返回 partial 状态 + 草稿 URL，不允许"看起来成了"
- **网络分区**：xian-rog 跟中台失联 → Agent 本地缓存任务，恢复连接后续传

## 范围限定

**在范围内**：
- 抖音 image / video 真发 publisher（替换对应 dryrun，含未登录时弹扫码窗机制）
- 抖音首次扫码绑定 UI（Dashboard / Agent 弹码 + cookie 落本地）
- Step 6 中台派任务 + Agent 路由 + 回执 thin → medium（含 type 路由 4 环节日志 + cookie 失效检测）
- Step 5 AI 生成 thin → medium（错误处理 + 超时重试 + prompt 校验；若 thin 仍 mock 则扩到接真 API）
- Lead 自验机制建立（模板 + xian-pc 真机执行流程 + lead 手机扫码协作流程 + 证据归档）

**不在范围内**（明确排除，本 sprint 不做）：
- 其他 7 平台（快手 / 小红书 / 视频号 / 公众号 / 头条 / 知乎 / 微博）的真发 — 保持 thin / 占位
- 抖音 article 类型真发 — 保持 dryrun / 占位
- xian-rog 接入（Tailscale / 凭据入库 → 下个 sprint 单独处理）
- 注册 UI 优化（→ Sprint 2.2）
- 画像 UI medium / 客户端安装 medium / 快手扫码绑定 medium（→ Sprint 2.3）
- super-admin / 运营后台
- 性能压测、监控告警、回滚预案（→ thick/mature 阶段）
- 多账号、cookie 持久化、跨机迁移（→ thick 阶段）— 本 sprint 每次跑都重新扫码即可

## 假设

- [ASSUMPTION 1]：xian-pc 通过 Tailscale ssh 可达，凭据在 1Password CS Vault "Xian PC (node-pc-xian)"（用户已确认）
- [ASSUMPTION 2]：lead 拿手机抖音 App 配合扫码（用户已确认愿意配合），xian-pc 上有抖音真账号或 lead 用自己的抖音账号扫码即可
- [ASSUMPTION 3]：Agent 选脚本逻辑代码在 `apps/agent/src/` 或 `packages/agent/`，具体文件 + line 由 Proposer 在 contract 阶段定位
- [ASSUMPTION 4]：Step 5 thin 现状不确定（用户没法确认是真 Claude 还是 mock），**Proposer 在 contract 阶段必须先读代码查明现状**，再决定 Step 5 medium 的具体范围（接真 API or 加错误处理）
- [ASSUMPTION 5]：抖音平台对自动化发布的策略允许（不会立即风控）— 如果 lead 自验时被风控，本 sprint 的 evidence 标准从"真视频公网可见"降级为"真发布请求 + 抖音返回的处理中状态 + 后续验证截图"，不算 sprint FAIL
- [ASSUMPTION 6]：xian-pc 上"应该有一些抖音相关脚本"（用户提及）— Proposer 在 contract 阶段需 ssh 到 xian-pc 盘点 `~` 或常见目录下的现有脚本，可复用就复用，避免重复造轮子

## 预期受影响文件

- `apps/agent/scripts/publish-douyin-image-dryrun.cjs`：删除或保留为 fallback；新建 `publish-douyin-image.cjs` 真发版
- `apps/agent/scripts/publish-douyin-video.cjs`：新建（真发版）
- `apps/agent/src/`（具体文件待 Proposer 定位）：Agent 选脚本路由层，按 type 字段精确路由 + 4 环节日志
- `apps/api/src/`（中台 publish task 处理）：medium 升级 — 错误处理、retry、回执准确性
- `apps/api/src/`（Step 5 AI 生成）：medium 升级 — 超时重试、prompt 校验、Claude API 错误兜底
- `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1.md`：新建 lead 自验证据文件
- `.agent-knowledge/golden-path-1/lead-acceptance-template.md`：新建 lead 自验模板（后续 sprint 复用）
- `.github/workflows/scripts/smoke/golden-path-1-smoke.sh`：smoke 升级 — 加 type=video 路由验证；CI 仍允许 Step 6 dryrun
- Dashboard 抖音账号配置 UI（具体文件待 Proposer 定位）：最简 cookie/token 录入页
- `apps/api/db/migrations/`：可能新增 publish_task.routing_log 列（ASSUMPTION，由 Proposer 决定）

## journey_type: user_facing
## journey_type_reason: 涉及 Dashboard 客户操作 + 客户端安装 + 抖音真账号真发，端到端从客户视角贯穿，是 ZenithJoy 终端客户用的 path
