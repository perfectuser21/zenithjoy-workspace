# Sprint PRD — Path 2 客户智能获客 · Sprint B-1 抖音小号绑定 + 评论区抓取

## OKR 对齐

- **对应 KR**：[ASSUMPTION: Brain `/api/brain/context` 当前不可达 / 不返回 active KR 列表；本 sprint 暂归到「ZenithJoy Walking Skeleton — Path 2 客户智能获客」Maturity 推进维度（Notion Path 2 Journey ID `35ac40c2-ba63-81ed-8df4-f3fa0b64f5bf`）]
- **当前进度**：Path 2 Maturity = `not_started` 名义（Notion 字段未更新）；实际 Step 1-4 已 thin done（Sprint A 4 PR 交付：#267 #274 #276 + architecture hotfix #278 #279 #280）
- **本次推进预期**：Sprint B-1 推进 Path 2 Step 5（抖音小号绑定）+ Step 6 part 1（评论区抓取写飞书 Lead 表）。完成后 Path 2 6 步全部 thin done → Notion Maturity 应改为 `skeleton`（按 walking-skeleton skill 1.5 入门标准）。

## 背景

ZenithJoy walking skeleton Path 2 客户智能获客的第二段（Sprint B 拆 3 sub-sprint，本次 B-1）。

Sprint A 已交付：客户能通过 dashboard 0-touch 绑自己的飞书企业（POST `/api/feishu/bind` + app credentials），系统自动在客户飞书 workspace 建好 3 张 Bitable 表（获客画像 / 对标视频 / Lead 名单），客户能在飞书填获客画像 + 对标视频 URL。

Sprint B-1 终端价值：客户提供 1 个对标视频 URL → 系统用客户的抖音小号去该视频评论区**抓 5 条评论**（评论者抖音 ID + 评论内容 + 来源视频 URL）→ **真写到客户飞书的 Lead 表 5 行**。客户在飞书 Lead 表能直接看到抓到的潜客。

约束来源：
- 抖音创作者后台**没有 app credentials flow**（跟飞书不同），绑账号必须 Playwright + CDP 真扫码（Path 1 既定模式 `qr-bind-douyin.ts`）
- 抖音小号必须**与 Path 1 主号 session 物理隔离**（不同 user-data-dir + cookie / `agent_platform_sessions.role` 区分）— 防小号被封连坐主号导致客户发布业务崩
- Lead 表写入**复用 Sprint A architecture** 的 multitenant Bitable 服务（`feishu-bitable-multitenant.ts` + `feishu-token.ts` getValidToken），不重写
- 22 bug 教训：评论抓取必须真客户机环境（Windows Edge headless via ssh rog），不是 mac dev mode

## Golden Path（核心场景）

用户/系统从 [客户已完成 Sprint A 飞书绑定 + 在飞书填好 1 个对标视频 URL] → 经过 [扫码绑 1 个抖音小号 + 系统抓视频评论区前 5 条] → 到达 [客户飞书 Lead 表新增 5 行潜客记录]

具体 10 步：

1. 客户在 dashboard 已登录 + 已 0-touch 绑飞书 + 已在飞书「对标视频」表填 1 行 URL（**Sprint A 的产物，前置条件**）
2. 客户在 dashboard 看到「绑抖音小号」入口（侧边菜单或绑飞书页同位置）
3. 客户点「绑抖音小号」→ Agent 客户端弹出独立 Chrome 实例（与 Path 1 主号 Chrome session 完全隔离）
4. Chrome 自动跳到抖音创作者后台扫码登录页
5. 客户用**专用小号手机**（不要主号）扫码 → Agent 检测扫码完成 → cookie/session 存到本地路径 `~/.zenithjoy-agent/sessions/douyin/burner/<account_label>.json`
6. 中台 `agent_platform_sessions` 表新增一行：`platform=douyin, account_label=<lead 自定义>, role=burner, status=active`
7. 客户在 dashboard 看到「抖音小号已绑定 ✓」+ 显示小号昵称（从扫码 session 拿）
8. 客户点 dashboard「开始抓取评论」按钮（按客户已选的对标视频）→ 后端调 Agent → Agent 用 burner session 的 Chrome 加载抖音视频页 → 抓评论区前 5 条评论
9. Agent 把 5 条评论结构化（评论者抖音 ID + 评论内容 + 时间）→ 上报中台 → 中台用 Sprint A 的 multitenant Bitable 服务写**客户飞书 Lead 表** 5 行（评论者抖音 ID / 评论内容 / 来源视频 URL / 抓取时间 / 状态='已抓取'）
10. dashboard 显示「抓取完成 5 条 → 看飞书 Lead 表」+ 飞书 Bitable 文档链接 → 客户打开飞书看到 5 条新潜客记录

## 边界情况

- 客户飞书未绑（Sprint A 未完成）→ dashboard「绑抖音小号」按钮 disabled + 提示先完成飞书绑定
- 客户飞书「对标视频」表为空 → dashboard「开始抓取」按钮 disabled + 提示先在飞书填 1 个视频 URL
- 抖音小号扫码超时（5 分钟未扫）→ Agent task 状态 = expired，dashboard 提示重试
- 抖音视频 URL 不存在或被删 → Agent 加载页面报错（视频不可用）→ 上报中台 → dashboard 显示「视频不可访问」
- 评论区为空（视频 0 评论）→ Agent 抓 0 条 → 中台不写 Lead 表 → dashboard 显示「该视频暂无评论」
- 抖音反爬触发（小号被风控）→ Agent CDP 检测异常（页面跳登录或验证码）→ 上报中台 → dashboard 提示「小号被风控，请稍后重试或换号」
- 飞书 Bitable Lead 表写入失败（token 过期 / API 超时）→ 后端按 Sprint A architecture 自动重新拿 tenant_access_token + 重试 → 重试 2 次后仍失败上报 dashboard
- 同一视频重复抓取 → 评论可能重复（同 commenter_id + 同 comment_text）→ 飞书 Lead 表暂不去重（thin 接受重复）
- 客户绑了小号但小号 session 过期（cookie 失效，比如 30 天后）→ Agent 抓评论时检测到登录态丢失 → 上报中台 → dashboard 提示「小号 session 已失效，请重新扫码」

## 范围限定

**在范围内**：
- `agent_platform_sessions` 表加 `role` 字段（main / burner）migration
- Agent 端绑小号扫码 handler（复用 Path 1 `qr-bind-douyin.ts` 加 role 参数 OR 新加 `qr-bind-douyin-burner.ts` 文件 — 由 Generator 在合同阶段决定 architecture，但**不动 Path 1 既有 main 绑定行为**）
- Agent 端评论抓取脚本：Playwright CDP 加载抖音视频页 + 抓评论区前 5 条 + 上报中台
- 中台触发评论抓取的 endpoint（dashboard → 中台 → Agent task 派发）
- 中台 lead-writer service：调 Sprint A 既有 multitenant Bitable 服务写飞书 Lead 表 5 行
- Dashboard 「绑抖音小号」按钮 + 状态展示
- Dashboard 「开始抓取评论」按钮 + 进度展示 + 抓取完成跳转飞书 Bitable 链接
- `golden-path-2-b1-smoke.sh`（CI 用 fake-agent stub + 真飞书 Bitable）
- Lead 客户机自验：xian-rog 上 Playwright launchPersistentContext + 一次扫码 + cookie 持久化 + 评论抓取 + 飞书 Lead 表 5 行真截图

**不在范围内**：
- ❌ Step 6 part 2：抖音公开回评 + 私信发送（带企微号文案）→ 推到 Sprint B-2
- ❌ Step 6 part 3：企微 webhook 端点 + AI 首答 + Lead 状态机 → 推到 Sprint B-3
- ❌ 评论去重逻辑（thin 接受重复，加厚到 medium 时再加）
- ❌ 多对标视频批量抓取（thin 阶段一次 1 视频，加厚到 medium 时支持批量）
- ❌ 多抖音小号轮询（thin 阶段绑 1 个小号，加厚到 medium 时扩 3-5 个）
- ❌ 智能筛精准评论者（thin 抓前 5 条，加厚到 medium 时按关键词/画像匹配筛）
- ❌ Agent 客户端 UI 改造（仍用现 Path 1 .bat 启动 + cmd 输出，不改）
- ❌ 不动 Sprint A `feishu-app-bind.ts` / `feishu-bitable-multitenant.ts` / `feishu-token.ts`（复用 service 函数，不改 service）
- ❌ 不动 Path 1 `qr-bind-douyin.ts` 既有 main 绑定行为（如果选择文件复用，加 role 参数 + 默认 'main' 兼容旧调用）

### 数据模型

**`agent_platform_sessions` 表加字段**（migration `<date>_agent_platform_sessions_add_role.sql`）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `role` | TEXT | `'main'` | `main` / `burner`，区分主号 vs 小号 |

`account_label` 字段已存在（Path 1 用），继续用作小号自定义名（客户起名如「装修小号 1」）。

**飞书 Lead 表行结构**（客户飞书 Bitable，Sprint A 已建表，本 sprint 写入数据）：

| 字段（飞书表头）| 类型 | 本 sprint 写入 |
|---|---|---|
| 评论者抖音 ID | 单行文本 | ✓ Agent 抓 |
| 评论内容 | 多行文本 | ✓ Agent 抓 |
| 来源视频 URL | URL | ✓ 客户填的对标视频 URL |
| 抓取时间 | 日期时间 | ✓ 中台写入时取当前时间 |
| 状态 | 单选 | ✓ 默认 `已抓取`（Sprint B-2/B-3 才会更新到 `已私信` / `已加企微` / `已 AI 首答` / `已转化`）|
| 加企微时间 | 日期时间 | ❌ 留空，Sprint B-3 写 |

## 假设

- [ASSUMPTION: 客户提前在自己飞书企业的「对标视频」Bitable 表里至少填 1 行 URL（Sprint A 的产物 + 客户自己运营动作）。本 sprint 不引导客户怎么找对标视频]
- [ASSUMPTION: 客户有专用抖音小号（不是日常主号）。22 bug 教训提示 lead 自验机器要用 xian-rog 而不是日常机器，sprint 文档里也提示客户务必用专用小号防封号]
- [ASSUMPTION: 抖音创作者后台 (creator.douyin.com) 在 ZenithJoy Agent 客户机所在地区可达 + 不被 IP 封禁（rog 在西安电信网络已验过 Path 1 主号扫码可行）]
- [ASSUMPTION: 抖音视频公开评论区抓取（Playwright CDP 加载页面 + 滚动 + 解析 DOM）在抖音反爬阈值之下（Path 1 publisher 类似机制已稳定运行，评论抓取流量更小，应该 OK）]
- [ASSUMPTION: 抖音小号扫码后 cookie/session 持久化的 user-data-dir 路径稳定（Windows `C:\Temp\zj-douyin-burner-v1` 不被系统清理）]
- [ASSUMPTION: 飞书 Lead 表的列顺序 / 字段 ID 在 Sprint A 建表时已固定，本 sprint 写入时按 Sprint A 既定 field_id 写]
- [ASSUMPTION: Agent 客户端启动时已加载 Path 1 burner-aware 配置（看 cookie 路径 + role 区分），lead 自验文档会写明 lead 在 rog 上需要重启 Agent 让新 schema 生效]
- [ASSUMPTION: 同一抖音小号同时只能在一个 Chrome session 里活跃（Path 1 既定），所以 Agent 一次只抓 1 视频]

## 预期受影响文件

**新增**：
- `apps/api/db/migrations/20260510_xxxxxx_agent_platform_sessions_add_role.sql`：`role` 字段
- `services/agent/scripts/douyin-comment-crawl.cjs`：抖音视频评论区抓取脚本（Playwright CDP）
- `apps/api/src/routes/agent-burner.ts`：Dashboard 触发评论抓取的 endpoint（POST `/api/agent/burner/crawl-comments`）
- `apps/api/src/services/lead-writer.ts`：Lead 表写入 service（调用 Sprint A multitenant Bitable service）
- `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx` 或 在现有 dashboard 页加「绑抖音小号」组件
- `apps/dashboard/src/pages/CommentCrawlPage.tsx` 或集成到飞书绑定页 / dashboard 主页
- `.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh`：CI smoke
- `.agent-knowledge/path-2/lead-acceptance-sprint-b1.md`：Lead 客户机自验真证据归档

**改造（小改）**：
- `services/agent/src/handlers/qr-bind-douyin.ts`：加 `role` 参数（默认 `'main'`，向后兼容 Path 1）—— **或者**新建 `qr-bind-douyin-burner.ts`（由 Generator 在合同阶段定 architecture）
- `services/agent/src/index.ts` 或 handler dispatcher：注册新 burner 绑定 + 评论抓取 task type
- `apps/api/src/app.ts` 路由 mount

**不动**（防撞 Path 1 + Sprint A）：
- `apps/api/src/services/feishu-bitable-multitenant.ts`（Sprint A architecture）
- `apps/api/src/services/feishu-token.ts`（Sprint A architecture）
- `apps/api/src/routes/feishu-oauth.ts` 的 `/bind` `/rebuild` `/status` route（Sprint A）
- `apps/dashboard/src/pages/FeishuBindTenant.tsx` 既有逻辑（Sprint A）
- Path 1 `qr-bind-douyin.ts` 既有 main 绑定行为（不改 default behavior，只加可选 role 参数 OR 新建 burner 文件）
- `agent_platform_sessions` 表已有列 + 既有 unique constraint（只 ALTER TABLE ADD COLUMN role）

## journey_type: user_facing
## journey_type_reason: 涉及 `apps/dashboard/` 客户操作（绑抖音小号 + 触发评论抓取 + 看进度）+ Agent 客户机扫码 + 客户在飞书 Bitable 看 Lead 表，是终端客户面的 walking skeleton 路径
