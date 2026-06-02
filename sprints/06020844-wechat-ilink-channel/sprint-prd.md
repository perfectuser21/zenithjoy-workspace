# Sprint PRD — Path 4 Step 1 第一刀 — 微信 iLink 客户端通道（thin）

## OKR 对齐

- **对应 OKR**：ZenithJoy 产品全线上线 — AI 双线创作 + 小程序 + 网站 + Dashboard 可交付
- **本次推进预期**：Path 4 (Notion `35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`) 在 maturity=not_started 下完成 **Step 1（第一刀贯穿）**：把腾讯官方 iLink HTTP JSON 协议（github.com/Tencent/openclaw-weixin）移植进 ZenithJoy 自有 apps/api，跑通"扫码绑号 → 长轮询收私聊 → DeepSeek 生成回复 → 自动 sendmessage → 写飞书 Lead"最小闭环。第一刀只贯穿、不加厚；审核台 / 朋友圈 / 群聊 / 多媒体 / 频控 / 多号矩阵均留待加厚阶段。

## 背景

Path 4「客户私域 AI 接管」此前 sprint（`sprint-d-path4-private-ai-thin`）走的是 PoC 路线：xian-pc 桌面 `wechat_bot.py` / `wechat_rpa.py`（wxauto4 + pyautogui）走 PC 微信客户端 RPA，伴随**封号风险高 / 必须挂 Windows / hook 客户端**等硬约束。

腾讯于 2026-Q1 开源了 **openclaw-weixin**（github.com/Tencent/openclaw-weixin），其中暴露的 iLink HTTP JSON 协议（`ilinkai.weixin.qq.com`）是官方合规通道：
- 不 hook PC 微信客户端
- 不依赖 OpenClaw 网关本体
- 不依赖 Windows
- 走 Bearer token + 长轮询 getupdates / sendmessage / getconfig
- 仅支持单聊文字（群聊、朋友圈、媒体不在协议范围内）

**本 sprint 第一刀**：把 iLink 协议的 client / auth / 类型定义从 openclaw-weixin 移植到 `apps/api` 自有代码，实现「扫码登录拿 Bearer token → getupdates 长轮询收私聊 → callOpenRouter(DeepSeek) 生成回复 → sendmessage 自动回 → writeLead 写飞书 Lead 表」最小闭环。**自动化 E2E** 用 mock iLink HTTP server 跑 CI；**真实扫码收发**由 Lead 在 xian-rog 上手动自验留证据（截图 + DB 记录）。

**已就绪的基础**：
- `apps/api/src/llm/openrouter.ts` DeepSeek 调用封装（已成熟，含 cost 审计、CI maxTokens cap）
- `apps/api/src/services/lead-writer.ts` + `feishu-bitable-multitenant.ts` 写飞书 Lead 表链路（Path 2 Sprint B-1 已跑通 5 条评论 → 5 次 writeRecord）
- `apps/api/src/routes/wechat.ts` 已存在 wechatRouter（旧 RPA 路线的 qr-bind / draft-review-poll / scheduler-tick / draft-generate），本 sprint 新增 iLink 相关端点共存即可，不删旧端点
- `agent_platform_sessions` 表已有 `role` 字段（main / burner，Path 2 Sprint B-1 加），iLink token 直接复用 burner role
- OpenRouter DeepSeek key `~/.credentials/openrouter.env` 已就绪
- 飞书 multitenant OAuth + writeRecord 已在 Path 2 sprint 跑通
- xian-rog 是 Path 4 Lead 自检机（前一 sprint 已建立惯例）

**本 sprint 的差异化决策**（与前一 PoC 路线对比）：
- **协议层**：从 wxauto4 RPA（hook PC 客户端）→ iLink HTTP JSON（官方协议，无 hook）
- **运行环境**：从必须 Windows + PC 微信 → 任意能跑 Node.js 的机器（API 服务端常驻即可，xian-rog 只承担「人工扫码 + 凭证录入」前端动作）
- **审核台**：前 sprint A 路线护栏（AI 草稿不直发，飞书审批后真发） → 本 sprint **AI 自动回**（不走审核台，因第一刀只验通协议链路；审核台留加厚阶段）
- **内容范围**：前 sprint 朋友圈 + 私聊双通道 → 本 sprint **只单聊文字**（iLink 协议只支持文字单聊）

## Golden Path（核心场景）

主理人 / Lead 在 xian-rog 启动 iLink 扫码流程
  → 经过 [终端 / 页面弹二维码 → 测试个微号手机扫码 + 授权 → 系统拿到 Bearer token → 存 agent_platform_sessions(role=burner) → getupdates 长轮询常驻]
  → 任意外部微信号给测试个微号发一条私聊文字
  → 经过 [getupdates 收到消息 → callOpenRouter(DeepSeek) 生成回复 → sendmessage 自动回 → writeLead 写飞书 Lead 表]
  → 到达 [外部微信号几秒内看到 AI 回复（像真人客服在线）；主理人在飞书 Lead 表看到该次交互记录]

### Step A — 扫码登录拿 Bearer token（人工扫码 + 系统拿凭证）

- **触发条件**：主理人在 xian-rog 终端执行 `npm run wechat:ilink-login`（或对应入口）
- **系统处理**：
  - apps/api 调 iLink auth 接口拉登录二维码（链接 / 图片 / base64 由 openclaw-weixin auth 流程决定，落地时按官方协议实现）
  - 二维码渲染到终端（ASCII）或返回前端可展示的 URL
  - 主理人用【干净测试个微号】手机扫码 + 确认授权
  - iLink 服务端回 Bearer token + uin（X-WECHAT-UIN）+ session 元数据
  - 系统写 `agent_platform_sessions` 一行：`platform='wechat_personal_ilink'` / `role='burner'` / `status='bound'` / `extra_json={ token, uin, wxid, nickname, scanned_at }`
- **可观测结果**：终端显示「绑定成功 + 微信昵称 + uin」；DB `agent_platform_sessions` 出现一行 role=burner、status=bound 的 wechat_personal_ilink 记录

### Step B — getupdates 长轮询常驻 + 收私聊

- **触发条件**：Step A 成功后，系统启动后台长轮询循环（apps/api 内进程或独立 worker，第一刀进 apps/api 进程内即可）
- **系统处理**：
  - 用 Step A 拿到的 token + uin 构造请求头：`AuthorizationType: ilink_bot_token` / `Authorization: Bearer <token>` / `X-WECHAT-UIN: <uin>`
  - 周期调 `POST ilinkai.weixin.qq.com/getupdates`，body 含游标 `get_updates_buf`（首次空，后续用上一轮返回的游标）
  - 解析返回的 update 列表，过滤出「私聊文字消息」（type=text、scene=single）
  - 每条消息提取：`from_user_id` / `to_user_id` / `text` / `context_token`（sendmessage 回复时必填）/ `received_at`
- **可观测结果**：DB 或日志可见 getupdates 收到的私聊消息流；游标稳定推进，无漏抓

### Step C — DeepSeek 生成回复

- **触发条件**：Step B 收到一条私聊文字消息
- **系统处理**：
  - 拼简单 prompt（第一刀**不查历史**，单轮回复即可；prompt 含「你是一个友好的微信助手，请用一句话回复用户」+ 用户原话）
  - 调 `callOpenRouter({ prompt, purpose: 'wechat_ilink_chat_reply' })`（复用现有 openrouter.ts，CI maxTokens cap=20，prod 默认 1000）
  - 拿到 `content` 字符串作为回复
- **可观测结果**：`llm_audit` 表新增一行 `request_purpose='wechat_ilink_chat_reply'`、success=true

### Step D — sendmessage 自动回

- **触发条件**：Step C 拿到回复内容
- **系统处理**：
  - 构造 sendmessage 请求体：
    - `to_user_id` = Step B 的 `from_user_id`
    - `context_token` = Step B 的 `context_token`
    - `item_list` = `[{ type: 'text', text: <DeepSeek 回复> }]`
  - 可选先调 `getconfig` 拿 `typing_ticket`（按 openclaw-weixin 是否必需决定，第一刀按最小必要实现）
  - 调 `POST ilinkai.weixin.qq.com/sendmessage`
  - 处理返回：成功 → 记录 message_id；失败 → 记日志（不重试，第一刀 fail-fast）
- **可观测结果**：外部微信号在测试号聊天框看到 AI 回复一句话

### Step E — writeLead 写飞书 Lead 表

- **触发条件**：Step D 成功 sendmessage
- **系统处理**：
  - 调 `lead-writer.ts` writeLead（复用 Path 2 Sprint B-1 链路），一行记录含：
    - 发送方微信 ID（from_user_id）
    - 客户原话（Step B 的 text）
    - AI 回复（Step C 的 content）
    - 时间（Step B received_at）
    - context_token（便于排错追踪）
  - 写入失败重试 1 次（lead-writer 内部已实现）
- **可观测结果**：飞书 Bitable Lead 表出现一行新记录；DB（如 lead-writer 有本地镜像）有对应一行

### Step F — token 失效分支

- **触发条件**：getupdates / sendmessage 返回 `errcode=-14`（session timeout）
- **系统处理**：
  - 长轮询循环 catch 到 -14 → 把 `agent_platform_sessions` 该行 status 改为 `needs_rebind`（或类似明确状态）
  - 停止该 burner 的长轮询循环
  - 写日志告诉主理人「需重新扫码」
- **可观测结果**：DB status=needs_rebind；主理人按 Step A 重新跑扫码流程

## 边界情况

- **iLink 服务 5xx / 网络抖动**：长轮询 catch error → 退避重试（指数退避，上限 60 秒），不掉线；超 3 次连续失败 → 写日志告警但**不**改 session status（区别于 -14 session timeout）
- **getupdates 收到非私聊文字消息（群聊 / 图片 / 语音 / 通知）**：第一刀直接 skip（filter 在 client 内做）；日志记 `skipped: kind=<group|media|sys>`，便于加厚阶段补全
- **同一外部号在 1 秒内发多条消息**：第一刀按到达顺序逐条处理（不合并、不去重），每条都走完 C → D → E；后果是连续回 N 句，第一刀可接受（加厚阶段加节流）
- **DeepSeek 调用失败（OpenRouter 5xx / 超时 / 余额）**：catch → log → 跳过本条（不 sendmessage，不 writeLead）；下一条消息继续；不阻塞长轮询
- **sendmessage 返回非 -14 的失败（被风控 / 内容违规 / 参数错）**：log + skip writeLead（避免飞书出现"AI 已回但实际没回"的虚假记录）；继续长轮询
- **writeLead 失败（飞书 token 失效 / API 5xx）**：lead-writer 内部已重试 1 次；2 次都失败 → log，不阻塞主流程（消息已发出，飞书漏记是次要损失）
- **agent_platform_sessions 写入失败（DB 不可达）**：Step A 直接 fail，提示主理人检查 DB；不要把 token 仅留在内存
- **mock iLink 服务在 CI 偶发慢响应**：integration test 用 `nock` 或本地 fastify mock，response 控制在 ms 级；test timeout 设 30s 兜底
- **多个 burner 同时长轮询（虽然第一刀只 1 个）**：长轮询循环按 session_id 拆，循环之间不共享游标；agent_platform_sessions 一行一循环
- **主理人在 Step A 长时间未扫码（10 分钟超时）**：扫码二维码过期 → 给主理人「重试」入口（第一刀手动重新跑入口命令即可）

## 范围限定

**在范围内**：
- iLink HTTP 协议移植：auth（扫码登录拿 token） + client（getupdates 长轮询 / sendmessage / getconfig）+ types（消息 / 回复 / 错误码）
- 1 个测试个微号（burner role），存 `agent_platform_sessions`
- 收私聊文字 → DeepSeek 单轮回复 → 自动 sendmessage（**无审核台**，AI 直发）
- 写飞书 Lead 表（复用 lead-writer.ts）
- token 失效（errcode -14）→ status 标 needs_rebind + 日志告警
- 自动化 E2E：integration test 用 mock iLink HTTP server，覆盖 getupdates 解析 / sendmessage 构造 / DeepSeek 串接 / writeLead 调用 / -14 分支
- `golden-path-4-smoke.sh` 新建（或前 sprint 同名文件追加 Step A-F dryrun，按当前是否已存在决定；第一刀新建为主）
- xian-rog Lead 自验：真扫码 + 外部发私聊 + 看 AI 回 + 查飞书 → evidence 写入 `.agent-knowledge/path-4/ilink-step1-acceptance.md`（截图 + DB 记录 + 飞书行截图）
- CI lint 注册：`lint-feature-has-smoke` 加 ilink smoke、`lint-tdd-commit-order` 保证 commit-1 是 RED test
- PR 描述声明：「本 PR 把 Path 4 的 Step 1 从 ❌ 推到 ✅（thin 贯穿）」

**不在范围内**：
- **群聊 / 朋友圈 / 视频号 / 公众号**（iLink 协议明确不支持，加厚也不靠 iLink 走）
- **图片 / 语音 / 视频 / 文件 / 表情**（第一刀只文字）
- **审核台 / AI 草稿待审 / 飞书审批**（前一 sprint 是 A 路线护栏，本第一刀放开 AI 直发以验通协议；审核台留 Path 4 加厚阶段）
- **多轮对话上下文 / 历史拼接**（第一刀单轮回复）
- **频控**（≤2 条/分钟、≤50 条/天，本第一刀**完全没有**；加厚阶段加，并强制走审核台）
- **多号矩阵**（第一刀 1 号；多号 + role 隔离加厚阶段）
- **主动 outreach / 主动私聊新好友**（第一刀只**被动回**）
- **Dashboard UI**（第一刀扫码靠 CLI / 终端入口；Dashboard 集成留 Step 2 起加厚）
- **客户名单 SSOT / 名单过滤**（第一刀所有发来的私聊一律 AI 回；名单白名单加厚阶段加）
- **真实多客户 SaaS 化部署**（第一刀单 Lead 单测试号自验）
- **托管登录 / 免扫码续期**（必须人工扫码）
- **OpenClaw 网关集成**（明确不依赖；纯走 ilinkai.weixin.qq.com 域名）
- **PC 微信客户端 RPA / wxauto4 / pyautogui**（明确替换掉，本路线无 Windows / 无 hook）
- **migrations 新建**（复用 `agent_platform_sessions` + `role` 字段；若需要 `wechat_personal_ilink` 作为 platform 值的 CHECK 约束放开，第一刀以新增极小 migration 解决，不动大表 schema）

## 假设

- [ASSUMPTION: openclaw-weixin 仓库（github.com/Tencent/openclaw-weixin）在本 sprint 周期内可访问，且 src/auth + src/api/api.ts + src/api/types.ts 三处可参考移植；具体落地实现按其代码结构对齐，**不**走 npm 包依赖（避免引入大 transitive deps），按官方 Apache/MIT 协议在 apps/api 内重写 TypeScript client]
- [ASSUMPTION: `ilinkai.weixin.qq.com` 域名稳定，无 IP 白名单，xian-rog（国内 IP）与 CI（GitHub Actions / mock）均可访问；CI 不真连 ilink，全 mock]
- [ASSUMPTION: iLink Bearer token 一次扫码后续期机制由 iLink 自身保证（按官方协议 token 长期有效，仅在 session timeout 时返 -14）；本 sprint **不**实现 token 主动 refresh / 续期；如 token 24h 内会过期，加厚阶段再处理]
- [ASSUMPTION: `agent_platform_sessions` 表的 `platform` 字段当前 CHECK 约束允许新增 `wechat_personal_ilink` 值；若有 CHECK 约束写死 platform enum，本 sprint 新增极小 migration 放开 / 加值；migration 文件用今日日期前缀 `20260602_*_aps_platform_add_ilink.sql`]
- [ASSUMPTION: `lead-writer.ts` 当前 schema 字段与本 sprint 写入需求（发送方 / 原话 / AI 回复 / 时间 / context_token）兼容；若有字段差异，第一刀按 lead-writer 现有字段精简映射，不为 Path 4 第一刀单独扩列]
- [ASSUMPTION: xian-rog 已能 SSH 进，已装 Node.js 20+，前一 sprint 既定惯例]
- [ASSUMPTION: 干净测试个微号已经备好（手机可登），由 Lead 在 prep 阶段确认；不需要额外注册]
- [ASSUMPTION: OpenRouter DeepSeek 在本 sprint 周期（3-4 天）内余额充足；本 sprint 调用量极小（自验 < 30 次 / Lead，CI 全 mock 不调真实 OpenRouter）]
- [ASSUMPTION: 长轮询循环常驻在 apps/api 进程内可接受（不需要独立 worker 进程）；apps/api 现已有其他长循环（feishu-poll），iLink 长轮询同形态共存]
- [ASSUMPTION: ilinkai 协议错误码 `-14 session timeout` 由 openclaw-weixin types 暴露；本 sprint 按其文档实现；若实际错误码不同，第一刀可用 errcode + errmsg 字符串匹配兜底]

## 预期受影响文件

### 中台（apps/api）

- `apps/api/src/services/ilink-client.ts`（新增）：iLink HTTP client，封装 getupdates / sendmessage / getconfig 三个接口；处理 Bearer token 请求头、长轮询游标、errcode 解析（特别是 -14）
- `apps/api/src/services/ilink-auth.ts`（新增）：iLink 扫码登录流程，拉二维码 + 轮询登录态 + 拿 Bearer token + 解析 uin / wxid / nickname
- `apps/api/src/services/ilink-types.ts`（新增）：从 openclaw-weixin src/api/types.ts 移植的 TypeScript 类型（update / message / sendmessage request / errcode）
- `apps/api/src/services/ilink-poller.ts`（新增）：长轮询循环，绑定到一个 burner session，从 DB 读 token 启动循环；catch -14 标 needs_rebind；连接收消息 → AI 回 → writeLead 主流程
- `apps/api/src/routes/wechat.ts`（扩展）：新增 `POST /api/wechat/ilink-login-start`（返二维码）+ `GET /api/wechat/ilink-login-status?session_id=X`（查登录态）+ `POST /api/wechat/ilink-poller-start?session_id=X`（启动长轮询）；旧端点保留不动
- `apps/api/src/llm/openrouter.ts`（复用，不修改）
- `apps/api/src/services/lead-writer.ts`（复用，可能加 `writeWechatChatLead(...)` 一个薄包装函数）
- `apps/api/db/migrations/20260602_*_aps_platform_add_ilink.sql`（新增，仅当现有 platform CHECK 约束阻拦新值）：放开 platform 允许 `wechat_personal_ilink`
- `apps/api/src/cli/wechat-ilink-login.ts`（新增）：CLI 入口，xian-rog 跑 `npm run wechat:ilink-login` 进入；走 ilink-auth.ts，二维码渲染到终端，登录成功写 DB
- `apps/api/package.json`（新增 npm script）：`"wechat:ilink-login": "tsx src/cli/wechat-ilink-login.ts"`

### 测试 + smoke

- `apps/api/src/services/__tests__/ilink-client.test.ts`（新增）：unit + integration，mock iLink HTTP（nock / msw）测 getupdates 解析 / sendmessage 构造 / -14 分支
- `apps/api/src/services/__tests__/ilink-poller.test.ts`（新增）：端到端 integration，mock iLink + mock OpenRouter + mock 飞书，验证一条 mock 私聊跑完 B-C-D-E
- `apps/api/src/routes/__tests__/wechat-ilink.test.ts`（新增）：路由层测试，覆盖 ilink-login-start / ilink-poller-start
- `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`（新建或扩展）：含 Step A-F 的 mock 链路 dryrun（不真扫码）
- `tests/wsN/`：sprint contract 阶段定义的 RED 测试落点（由 contract 阶段决定具体 ws 数量与切分）

### Evidence

- `.agent-knowledge/path-4/ilink-step1-acceptance.md`（新建）：Lead 在 xian-rog 自验 evidence 模板，含真扫码截图 + 外部号发消息截图 + AI 回复截图 + 飞书 Lead 表行截图 + DB `agent_platform_sessions` 查询结果 + `llm_audit` 行截图

### 文档

- `.claude/CLAUDE.md`（可能）：若本 sprint 决定记录 iLink 路线为 Path 4 加厚的官方通道（替换 wxauto4 PoC 路线），在第零纪律的 Path 4 6 步描述里追加「Step 1 已落地 iLink HTTP 协议，wxauto4 PoC 路线降级为备用方案」一行。**第一刀不强制改 CLAUDE.md**，由 PR review 决定。

## journey_type: user_facing
## journey_type_reason: 客户视角（外部微信号给测试号发私聊后能看到 AI 自动回复）是本 sprint 的终态可观测点，UI / 用户感知是终点的核心；虽然第一刀 Dashboard 不集成（扫码靠 CLI），但「外部微信看到 AI 回复」是真实用户可见的产品体验，按规则归 user_facing。Path 4 Notion Journey Type 字段已标 user_facing，一致。

{"verdict":"DONE","sprint_dir":"sprints/06020844-wechat-ilink-channel"}
