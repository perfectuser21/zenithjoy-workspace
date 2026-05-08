# Sprint PRD — Path 4 客户私域 AI 接管 — Sprint 1（thin 第一刀 / skeleton 贯穿）

## OKR 对齐

- **对应 OKR**：ZenithJoy 产品全线上线 — AI 双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：Path 4 (Notion `35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`) 从 `not_started` → `skeleton`（6 个 thin Feature 全部贯穿，端到端 smoke 全绿，Lead 自验 evidence 写入），ZenithJoy 4 条 Journey 中第 3 条进入可面客户演示态。

## 背景

ZenithJoy walking skeleton 已建立 4 条 Journey 作战图（Path 1 客户首次成功 / Path 2 客户智能获客 / Path 4 客户私域 AI 接管 / 未来 Path 3）。Path 1 已通过 sprint 2.1a / 2.1b 完成视频真发能力通用化，Path 2 sprint 进行中。

**Path 4 的真实痛点**：客户拉到微信好友后没人维护——客户公司单兵作战的"千客户服务能力"瓶颈在私域日常触达。需要 AI 接管个微，自动写朋友圈+私聊草稿，飞书 Bitable 当审核台批准后真发，端到端完成 1-N 私域营销闭环。

**已就绪的基础**：
- xian-pc 桌面 PoC `wechat_bot.py` / `wechat_rpa.py` 已手动验证 wxauto4+pyautogui 路径通（监听私信 / 鼠标键盘 RPA 发消息均 work）
- OpenRouter DeepSeek key 已存 `~/.credentials/openrouter.env`，已 ping 通（11 token / $0.0000046）
- Path 1 zenithjoy-agent 协议（NodeJS Agent + 中台 SSE + spawn 子进程模式）成熟
- Path 2 飞书多租户 OAuth 框架可复用
- rog-xian Lead 自检机已就绪（sprint 2.1a/2.1b 既定惯例）

**本 sprint 第一刀**：把 PoC 重写进 zenithjoy repo（环境无关，可装 rog 自验 / 客户 PC worker），接 OpenRouter DeepSeek + 飞书 Bitable + zenithjoy-agent 协议，完成 6 step 端到端 thin 骨架。**A 路线护栏**强约束 — AI 一律不直接发，必须飞书人审。

## Golden Path（核心场景）

客户从 [zenithjoy 中台 Dashboard 点"绑定微信"按钮]
  → 经过 [扫码绑号 → 飞书自动建表 → AI 写草稿 → 飞书人审 → 系统真发 → 回执回写]
  → 到达 [客户在飞书 Bitable "互动记录" + "内容排期" 表里看到完整 1 条朋友圈 + 1 条私聊回复闭环，对应的真朋友圈 / 真私聊已发出]

**6 step 详情**：

### Step 1 — 扫码绑个微干净测试号

- **触发条件**：客户在 zenithjoy Dashboard 点"绑定微信"按钮 → 选择"个人微信"通道 → 选定要绑的客户机
- **系统处理**：客户机（Windows）上的 zenithjoy-agent 收到 task_dispatch（type=wechat_qr_bind）→ 通过新增的 `wechat-rpa` handler 启动本机 PC 微信客户端 → 客户端自动弹出登录二维码
- **可观测结果**：客户用手机扫 PC 微信客户端二维码 → 微信客户端登录成功 → Agent 监听到登录态变化 → 把"绑号成功 + 微信昵称 + 微信号 ID"事件回报中台 → Dashboard 该客户机的微信绑定状态变 `bound`

### Step 2 — 飞书 Bitable 三表自动初始化 + 客户名单手填

- **触发条件**：绑号成功事件触发"初始化飞书 CRM"任务
- **系统处理**：调用飞书 OpenAPI（多租户 OAuth 已在 Path 2 sprint 跑通）在客户已绑定的飞书空间自动建 3 张 Bitable：
  - **客户档案**（手填名单 SSOT，AI 只对名单内动手）：列 = 客户名 / 微信号 / 行业 / 备注 / 加入日期
  - **营销画像**（行业 / 受众 / 钩子文案 3 字段）：单行手填
  - **内容排期**（朋友圈草稿审核台）：列 = 草稿 ID / 生成时间 / 文案 / 排期时间 / 状态（pending_review / approved / published / failed / rate_limited）
  - **互动记录**（私聊草稿审核台 + 历史）：列 = 客户名 / 客户原话 / AI 草稿 / 生成时间 / 状态 / 真发时间
- **可观测结果**：客户登录飞书空间 → 看到 4 张表已就绪（客户档案 + 营销画像 + 内容排期 + 互动记录）→ 在客户档案表手填 3-5 个真实客户名单 + 在营销画像表手填 3 字段

### Step 3 — 名单内客户私聊 → AI 写回复草稿 → 写飞书

- **触发条件**：名单内客户在微信主动私聊客户的微信号
- **系统处理**：Agent 通过 wxauto4 监听到新消息 → 校验发送者在"客户档案"表名单内（不在则丢弃）→ 拼对话历史（最近 10 轮）+ 营销画像 prompt → 调 OpenRouter DeepSeek (`deepseek/deepseek-chat`) → 草稿写入飞书"互动记录"表，状态 `pending_review`
- **可观测结果**：客户打开飞书"互动记录"表能看到一行：[客户名] [客户原话] [AI 草稿] [pending_review] [生成时间]。**AI 草稿不直接发出**（A 路线护栏）

### Step 4 — 每日 09:00 朋友圈 AI 写文案草稿 → 写飞书

- **触发条件**：中台定时器每日 09:00（客户机时区）触发"今日朋友圈"任务
- **系统处理**：拼客户的"营销画像"表 3 字段 + 硬编码 prompt → 调 OpenRouter DeepSeek → 文案草稿写入飞书"内容排期"表，状态 `pending_review`
- **可观测结果**：客户在飞书"内容排期"表看到新一行：[草稿 ID] [生成时间 09:00] [文案] [排期时间空 = 待客户填] [pending_review]

### Step 5 — 飞书审批 → 真发（频控保护）

- **触发条件**：客户在飞书表把状态从 `pending_review` 改成 `approved`（"内容排期"或"互动记录"任意一张表都可触发）
- **系统处理**：中台轮询飞书（30 秒间隔） → 检测到 approved → 校验频控（见下）→ 派 task_dispatch 给客户机的 zenithjoy-agent → wechat-rpa handler spawn Python 子进程跑：
  - 朋友圈：`send_moment.py`（pyautogui RPA 控制 PC 微信客户端 → 朋友圈输入 → 选择**指定可见分组** → 发布）
  - 私聊：`send_chat.py`（搜索联系人 → 输入框粘贴 → 发送）
- **频控保护（硬编码上限）**：
  - 朋友圈：≤ 1 条/24h/号
  - 私聊：≤ 2 条/分钟/号，≤ 50 条/天/号
  - 单次操作间隔：≥ 1 秒
  - 主动发起新会话：thin 阶段 = 0（只回不主动）
  - 超限直接拒绝（不排队不重试），状态变 `rate_limited` 写下次允许时间
- **可观测结果**：真客户的微信收到 AI 草稿内容（朋友圈进真朋友圈分组可见 / 私信进真聊天框）

### Step 6 — 回执回写飞书

- **触发条件**：发送动作完成（成功 / 失败 / 频控拒绝）
- **系统处理**：Agent 把回执（status + 失败原因一句话）通过 SSE 回报中台 → 中台同步写飞书"内容排期"和"互动记录"表
- **可观测结果**：客户在飞书表看到状态从 `approved` → `published` / `failed` / `rate_limited`，failed 带一句失败原因（如 `wechat_disconnected` / `rate_limited` / `feishu_token_expired` / `unknown_rpa_error`）

## 边界情况

- **微信客户端未启动 / 进程崩溃**：Agent 启动 PC 微信失败或 wxauto4 失联 → 回报 `wechat_not_running` / `wechat_disconnected` → Dashboard 提示客户检查
- **客户机离线（Agent SSE 断开）**：中台标 `agent_offline`，到点的朋友圈任务**最多排 1 条**等 Agent 重连后再发（thin 阶段简单队列）
- **飞书 OpenAPI 失败**：建表失败 / 写入失败 / token 失效 → 回报 `feishu_api_error` + 具体错误码，绑号流程标记为 `partial`（绑号成功但 CRM 未就绪），人工修复后可重试
- **DeepSeek 调用失败**：OpenRouter 余额耗尽 / 超时 / 5xx → 草稿生成失败 → 飞书表写入"AI 生成失败"占位 + 重试按钮（点击重新触发生成）
- **频控超限**：拒绝发送 → 飞书表状态 `rate_limited` + 下次允许时间字段
- **AI 草稿被客户改写后再批准**：飞书表"文案"字段被客户改 → 系统按修改后的内容真发（不重新走 AI，把客户的修改作为最终事实）
- **AI 草稿不被批准（被客户拒绝 / 删除）**：状态保持 `pending_review` 或客户手动改 `rejected`，系统不发，朋友圈那条该日就跳过（不补发）
- **发送时客户机离线**：approved 但 Agent 离线 → 任务 enqueue，Agent 重连后处理；超过 24h 未处理 → 自动转 `failed` 状态 + 原因 `agent_offline_timeout`
- **私聊监听漏消息（Agent 重启或网络抖动）**：thin 阶段不补抓历史消息（只处理 Agent 在线期间的实时消息），客户回复延迟由客户接受
- **同一客户高频私聊（轰炸场景）**：private_msg 频控 ≤ 2 条/分钟/号意味着客户连续多发只回最早 2 条，其余进 `rate_limited`

## 范围限定

**在范围内**：
- 1 个干净测试微信号（thin 单号，多号矩阵加厚才上）
- 6 step 端到端贯穿（每步 thin，UI 丑、错误处理 0、性能不管）
- DeepSeek（OpenRouter 通道）作为 Path 4 全部 LLM 调用
- 飞书 Bitable 4 张表（客户档案 / 营销画像 / 内容排期 / 互动记录）
- A 路线护栏（人审，AI 不直接发）
- 频控硬编码上限（朋友圈 ≤1/24h，私聊 ≤2/分钟 ≤50/天/号）
- 朋友圈分组可见（非全部好友，避开 Lead 自验时人际尴尬）
- xian-rog 装 zenithjoy-agent 做 Lead 自验
- `golden-path-4-smoke.sh` 骨架（CI dryrun 跑到 Step 6 全绿；Lead 自验 REAL_PUBLISH=1 真发）
- CI lint 注册（`lint-feature-has-smoke` / `lint-tdd-commit-order`）
- Path 4 evidence 模板 `.agent-knowledge/path-4/lead-acceptance-sprint-1.md`

**不在范围内**：
- 多号矩阵 / 主动 outreach / 完全自主 AI agent（medium+ 才上）
- 朋友圈带图 / 视频内容（图先放飞书让客户填，AI 后续接 Path 1 Stage 4 图生成 — thicken 阶段）
- 客户分群 / 标签自动化（手填 SSOT）
- 实时增量好友同步（thin 一次性手动全量）
- 朋友圈点赞 / 评论 / 主动私聊新好友
- 跨平台联动（不接抖音、不接小红书）
- 高可用 / supervisor / 自动重连（thin 手动重启）
- 凭据下发服务（thin 手动写客户机 `.env`）
- 漏消息补抓 / 历史回填（thin 只处理 Agent 在线期间消息）
- 多客户场景 / SaaS 化部署（thin 单 Lead 单客户机自验）
- 个微号被封后的恢复方案（thin 阶段封了就换号，加厚阶段才设计养号）

## 假设

- [ASSUMPTION: rog-xian 已能 SSH 进（Tailscale 100.98.253.95），由 sprint 2.1a/2.1b 既定惯例确认]
- [ASSUMPTION: 客户机（Windows）能装 Python 3.11+ + NodeJS 20+ + 微信 PC 客户端 latest，Lead 自验 rog 上确认这些前置]
- [ASSUMPTION: 微信 PC 客户端窗口类名 `Qt51514QWindowIcon`（PoC 锁定）在 sprint 1 完成日仍然有效。如失效，第一刀加 `find_weixin.py` 探针自动定位新类名]
- [ASSUMPTION: 飞书 OpenAPI 多租户 OAuth 已在 Path 2 sprint 跑通，本 sprint 直接复用同一套企业绑定流程；Path 4 的 4 张 Bitable 建在客户已绑定的飞书空间内]
- [ASSUMPTION: thin 阶段单 Lead 跑自验，单客户场景；多客户/多号需要的运维加厚阶段才设计]
- [ASSUMPTION: OpenRouter DeepSeek 在本 sprint 周期（4-5 天）内余额充足；评估单次调用约 ¥0.0001（500-1000 token），thin 整周日均调用 < 50 次，余额 > $1 即可撑过]
- [ASSUMPTION: 飞书 OpenAPI 轮询 30 秒间隔不超 quota；如超，加厚阶段考虑 webhook 推送]
- [ASSUMPTION: PoC 桌面文件 `wechat_bot.py` / `wechat_rpa.py` 不直接 import / 复制，sprint 1 重写到 `services/agent/wechat-rpa/` 目录，避免硬编码 MiniMax key 入 git]

## 预期受影响文件

### 中台（apps/api）
- `apps/api/src/migrations/`: 新增 `wechat_publish_task` 表 migration + `agent_platform_sessions` 加 `platform=wechat_personal` 支持
- `apps/api/src/routes/wechat.ts`: 新增 `POST /api/wechat/qr-bind` / `POST /api/wechat/draft-review-poll` / `POST /api/wechat/scheduler-tick` 端点
- `apps/api/src/services/feishu-bitable.ts`: 扩展支持 Path 4 4 张表的 schema 注册和写入
- `apps/api/src/llm/openrouter.ts`: 新增（如不存在），OpenRouter DeepSeek 调用封装

### Dashboard（apps/dashboard）
- `apps/dashboard/src/pages/AgentMachines.tsx`（或对应页面）: 新增"绑定微信"按钮 + 通道选择（thin 仅显示"个人微信"选项）
- `apps/dashboard/src/api/wechat.api.ts`: Dashboard 调中台 wechat 端点

### Agent（services/agent）
- `services/agent/src/handlers/wechat-rpa.ts`: 新增 NodeJS handler，接受 task_dispatch（type=wechat_qr_bind / wechat_send_chat / wechat_send_moment / wechat_listen_start）→ spawn Python 子进程
- `services/agent/wechat-rpa/qr_bind.py`: 启动 PC 微信客户端 + 等扫码成功 → 输出登录态 JSON
- `services/agent/wechat-rpa/listen_chat.py`: 监听好友私信（wxauto4 GetAllMessage 轮询）+ 名单内过滤 + 调中台生成草稿
- `services/agent/wechat-rpa/send_chat.py`: 真发私聊（pyautogui RPA + 频控）
- `services/agent/wechat-rpa/send_moment.py`: 真发朋友圈到分组可见 + 频控
- `services/agent/wechat-rpa/rate_limiter.py`: 共享频控逻辑（基于 SQLite 状态表 / 文件锁，存在客户机本地）
- `services/agent/wechat-rpa/find_weixin.py`: 探针（如类名失效自动重定位）
- `services/agent/wechat-rpa/requirements.txt`: 锁版本（wxauto4 + pyautogui + pyperclip + pywin32 + requests）

### 测试 + smoke
- `tests/ws[1-6]/`: sprint contract RED 测试（contract 阶段定义 6 个 ws）
- `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`: 新建，跑 Step 1-6 dryrun
- `.github/workflows/`: 注册 `golden-path-4-smoke` 到 lint-feature-has-smoke + 测试 registry

### Evidence
- `.agent-knowledge/path-4/lead-acceptance-sprint-1.md`: Lead 自验 evidence 模板（rog-xian 真扫码 + 真发 + 真审记录）

### 文档（已在 prep 阶段完成，sprint 1 PR 同步带）
- `.claude/CLAUDE.md`: 第零纪律加 Path 4 作战图 + 6 步描述 + 微信通道分工 + 铁律 2 松绑（PR 描述声明）

## journey_type: user_facing
## journey_type_reason: 起点是客户在 zenithjoy Dashboard 点"绑定微信"按钮（apps/dashboard/），UI 起点最靠前；虽涉及 agent 协议（agent_remote 候选），按规则"起点最靠前 UI > tick > task dispatch > bridge"取 user_facing。Notion Journey Type 字段也已标 user_facing，一致。
