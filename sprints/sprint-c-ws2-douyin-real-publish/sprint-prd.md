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
| 1 | 抖音真发 publisher (image) | Step 6 | new → thin | 替换 `publish-douyin-image-dryrun.cjs`，真发到公网 |
| 2 | 抖音真发 publisher (video) | Step 6 | new → thin | 真发到公网，根治"视频发成图文" bug 的根本方案 |
| 3 | Step 6 中台派任务 + Agent 路由 + 回执 | Step 6 | thin → medium | 含 Agent type 路由层修复 + 4 环节日志 + 真发 publisher 接入 |
| 4 | Step 5 AI 生成内容 | Step 5 | thin → medium | 错误处理、超时重试、prompt 校验、Claude API 失败 fallback |
| 5 | Lead 客户机自验机制 | （横切，所有 step）| new → thin | `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1.md` 模板 + xian-rog Windows 真机执行流程 + 后续 sprint 复用 |

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
  - Step 5 真链路调 Claude API（不是 mock）？或者 CI 用 mock + Lead 自验时换真 API key？
  - Step 6 在 CI 仍 dryrun（避免污染公网）；但 dryrun 必须真填字段、真到达"等待发布"页（不是空 exit 0）
  - Agent 路由层有日志：能从 stdout/log 看到 type=video → 选了 video 脚本（不是 fallback image）
  - Lead 自验 evidence 文件存在 + 含真发抖音视频公网 URL + 截图

## 4. Lead 客户机自验（v9 — 来自 5 问 Q5，铁律 7）

- **worker_machine**：`xian-rog`（ASUS ROG Windows 玩家机，更接近真实客户场景；不能用本机 Mac mini 替代）
- **checklist**（≥5 步，按客户视角顺序）：
  1. 从本地 ssh / Tailscale 到 xian-rog（Windows 客户机视角）
  2. 在 xian-rog 浏览器打开 ZenithJoy Dashboard 真账号注册（Step 1）
  3. 在 xian-rog 下载并安装客户端 + Agent，Agent 自动连接中台（Step 2）
  4. 填画像 3 字段（Step 3）
  5. 扫码绑定快手账号（Step 4，可保留 dryrun）+ 配置抖音真账号 cookie/token
  6. 触发 AI 生成 1 条**视频** type 内容（Step 5）
  7. 中台派任务 → Agent 执行真发抖音视频脚本 → 真发到抖音公网（Step 6）
  8. 在抖音 App / 网页验证视频真出现 + 抓回执 URL
  9. 把 cmd stdout + 抖音公网 URL 截图归档
- **evidence_path**：`.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1.md`
- **完成判据**：
  - evidence 文件存在
  - 含 cmd stdout 摘录（每步关键命令的输出）
  - 含抖音公网视频 URL（lead 在浏览器/App 看得见的真实视频）
  - lead 在 xian-rog 真跑过全链路
  - **未自验或证据为空 = sprint 不能 deliver 给用户测真账号，整 sprint FAIL**

## 5. Golden Path（核心场景）

**入口**：客户在 xian-rog Windows 机器上，从 0 开始，**没有任何 ZenithJoy 账号、没装任何东西**。

**关键步骤**：
1. 客户访问 ZenithJoy Dashboard，注册邮箱+密码 → 自动签发 free license + free tenant（Step 1，沿用 thin，本 sprint 不改）
2. 客户下载 ZenithJoy 客户端 + Agent，安装 → Agent 自动连接中台 heartbeat（Step 2，沿用 thin）
3. 客户填画像表单 3 字段：行业 / 受众 / 风格（Step 3，沿用 thin）
4. 客户扫码绑定快手（Step 4，沿用 thin）+ **本 sprint 新增**：配置抖音账号 cookie/token（最简方式，UI 临时 OK）
5. 客户在 Dashboard 点击「生成内容」，**指定 type=video**，中台调 Claude API 生成视频脚本/标题/标签（Step 5 medium：超时重试 + 错误处理 + prompt 校验）
6. 中台 publish_task 表写入 `{type: video, platform: douyin, payload: {...}}`，Agent 拉任务 → **路由到 `publish-douyin-video.cjs`（不是 image dryrun！）** → 真发到抖音公网（Step 6 medium）
7. Agent 抓抖音返回的视频 URL，回填 publish_task.receipt → 中台 dashboard 显示「发布成功 + 视频 URL」（Step 6 medium）

**出口**：客户在抖音 App 看见自己刚发的视频，在 ZenithJoy Dashboard 看见 ✅ 状态 + 抖音 URL。

## 边界情况

- **抖音风控**：账号被风控 / cookie 失效 → 客户视角看到清晰错误"抖音登录失效，请重新扫码"。不允许静默失败
- **Claude API 失败**：超时 / 429 / 5xx → Step 5 重试 3 次 + 兜底返回"AI 临时不可用，请稍后再试"
- **Agent 路由 bug 类回退**：type=video 但 video 脚本不存在 → 客户视角清晰报错"该平台暂不支持 video 类型"，**严禁悄悄 fallback 到 image**（这是昨天 P0 bug 的根因之一）
- **真发到一半失败**（如视频上传成功但发布按钮失败）→ Agent 必须返回 partial 状态 + 草稿 URL，不允许"看起来成了"
- **网络分区**：xian-rog 跟中台失联 → Agent 本地缓存任务，恢复连接后续传

## 范围限定

**在范围内**：
- 抖音 image / video 真发 publisher（替换对应 dryrun）
- Step 6 中台派任务 + Agent 路由 + 回执 thin → medium（含 type 路由 4 环节日志）
- Step 5 AI 生成 thin → medium（错误处理 + 超时重试 + prompt 校验）
- Lead 自验机制建立（模板 + xian-rog 真机执行流程 + 证据归档）
- 抖音账号 cookie/token 配置 UI（最简，丑 OK）

**不在范围内**（明确排除，本 sprint 不做）：
- 其他 7 平台（快手 / 小红书 / 视频号 / 公众号 / 头条 / 知乎 / 微博）的真发 — 保持 thin / 占位
- 抖音 article 类型真发 — 保持 dryrun / 占位
- 注册 UI 优化（→ Sprint 2.2）
- 画像 UI medium / 客户端安装 medium / 扫码绑定 medium（→ Sprint 2.3）
- super-admin / 运营后台
- 性能压测、监控告警、回滚预案（→ thick/mature 阶段）

## 假设

- [ASSUMPTION 1]：xian-rog 通过 Tailscale ssh / hostname 可达，凭据在 1Password CS Vault；如果不可达，本 sprint 必须先建立可达性才能 deliver
- [ASSUMPTION 2]：抖音真账号已注册或 lead 能在 xian-rog 上完成账号注册 + 取 cookie；如果没账号，sprint 必须含"账号注册" sub-feature
- [ASSUMPTION 3]：Agent 选脚本逻辑代码在 `apps/agent/src/` 或 `packages/agent/`，具体文件 + line 由 Proposer 在 contract 阶段定位
- [ASSUMPTION 4]：Step 5 thin 已经接真 Claude API（不是 mock），medium 升级是加错误处理 / 超时 / 校验，而非替换 mock。如果 thin 实际仍 mock，medium 范围扩大到"接真 API"
- [ASSUMPTION 5]：抖音平台对自动化发布的策略允许（不会立即风控）— 如果 lead 自验时被风控，本 sprint 的 evidence 标准从"真视频公网可见"降级为"真发布请求 + 抖音返回的处理中状态 + 后续验证截图"，不算 sprint FAIL

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
