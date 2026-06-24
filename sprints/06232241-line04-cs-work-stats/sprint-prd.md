# Sprint PRD — Line04 客服工作汇总统计页（每台客服机今天/昨天 4 个数）

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — 客服可观测性（管理员看见每台客服机干了多少活）
- **当前进度**：客服工作汇总统计页 feature 7b5b403c = thin/building（0%，本 sprint 做出来）
- **本次推进预期**：thin → building，Golden Path 端到端可见 4 个数 + 今天/昨天切换

## 背景

对话原文已逐条落库（`zenithjoy.cs_memory_messages` 写 in/out），但缺「哪台客服处理的」身份字段、无聚合统计、无 stats 接口、无前台汇总页（Issue `ecf13d74`）。管理员当前无法一眼看到每台客服机的工作量。本 sprint 根治。
前提认知（用户已确认）：一个账户 = 一台机器 = 一个微信号客服（1:1），统计天然按「每客服微信号」分。

## Golden Path（核心场景）

管理员从 [打开「客服工作汇总」页] → 经过 [看每台客服机一张卡的 4 个数] → 到达 [切今天/昨天看两天的数]

具体：
1. 名单内客户私聊某客服微信 → 客服机自动回复 → 这两条消息（in/out）落库时**自动盖上该客服微信号身份章 `cs_wechat_id`**（身份解析链已存在：UUID→agents→env-id→machine→config）
2. 管理员打开 dashboard「客服工作汇总」页（挂 Line04 区下）
3. 看到**每台客服机一张卡**：客服名 / 微信号 / 在线状态 + 今天【接收 X 条 · 回复 Y 条 · 接待 Z 人 · 工作 W 分钟】+ 真发/演练标
4. 顶部切「昨天」→ 4 个数变为昨天的数（按**北京时区**算日界）

口径定义（钉死）：接收=count(role='in')；回复=count(role='out')；接待=distinct 客户数；工作时长=当天末条−首条消息时间（分钟）。

## 边界情况

- 某客服今天还没有任何消息 → 卡片显示 4 个 0（不报错、不消失）
- `cs_wechat_id` 为 NULL（老数据/解析失败）→ **不计入任何客服统计、接口不报错**（不串到别人头上）
- **数据隔离**：两个不同 `cs_wechat_id` 的消息各算各的，A 的数绝不出现在 B 的卡片
- **时区边界**：北京时区今天 00:30 的消息（中台美区当时为昨天）→ 仍归「今天」（防 #832 美区算错日界）

## 范围限定

**在范围内**：
- `cs_memory_messages` 加 `cs_wechat_id`（nullable，不回填历史）+ 索引 `(cs_wechat_id, created_at)`
- 落库时（appendMessage in/out 两处）盖当前客服身份章
- `GET /cs/stats?date=today|yesterday` 按北京时区聚合，返回每客服 4 个数
- dashboard「客服工作汇总」页（每客服一卡 + 今天/昨天切换 + 真发/演练标）

**不在范围内**（YAGNI）：
- 历史趋势图 / 折线图 / 任意日期范围（只今天/昨天两个值）
- 跨客服加总的总计行（1 账户=1 机器，无需跨机加总）
- 回填历史老消息身份
- 导出 / 下载
- S4 每日报告（另立 sprint，依赖本 sprint 的 /cs/stats）

## 假设

- [ASSUMPTION: 身份解析链 UUID→agents→env-id→machine→config 已可在 appendMessage 处取到当前客服微信号（Issue defe1a42/dd320e56 已修过）]
- [ASSUMPTION: 真发/演练标位来源沿用既有客服配置，stats 接口或前台可读到]
- [ASSUMPTION: 中台内部鉴权 X-Internal-Token 已存在，stats 接口复用，不新增凭据/外部 API]

## NFR 约束

<!-- 来源: decisions 表 category=nfr 不可达（Brain 离线），仅用 PrepPRD 显式值 -->
- 时区：日界一律按**北京时区（Asia/Shanghai）**聚合，禁用中台美区本地时间
- 向后兼容：`cs_wechat_id` nullable；NULL 不计入统计、不报错、不回填
- 可观测：统计口径每条 SELECT 断言带时间窗 `AND created_at > NOW() - interval '5 minutes'` 防假绿
- 数据隔离：按 `cs_wechat_id` 过滤，绝不跨客服串台

## 预期受影响文件

- `apps/api/db/migrations/2026XXXX_*_add_cs_wechat_id_to_cs_memory_messages.sql`：加列 + 索引（幂等 IF NOT EXISTS）
- `apps/api/src/services/wechat-draft.ts`：appendMessage 落 in/out 两处盖 `cs_wechat_id` 身份章
- `apps/api/src/routes/wechat.ts`：新增 `GET /cs/stats` 按北京时区聚合
- `apps/dashboard/src/pages/`：新增「客服工作汇总」页 + Line04 区路由挂载
- 回归测试：数据隔离 / 时区边界 / 口径正确（proven-to-fire 哨兵，commit 进 CI）

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment 产出（windows_cloud → smoke .sh + Playwright .spec.ts）。

**schema 断言铁律（避 db-no-time-window 误杀）**：列/nullable/索引存在性 → 必须用 `node -e` 读 migration 文件断言（`fs.readFileSync(...).includes('cs_wechat_id')`），**严禁 psql 查 information_schema / pg_indexes**。数据行断言 → psql/curl 且每条 SELECT 带 `AND created_at > NOW() - interval '5 minutes'`。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本
# 期望验收点（自然语言）：
#  1) schema：node 读 migration 文件断言含 cs_wechat_id + 索引 (cs_wechat_id, created_at)
#  2) 口径：seed 已知 in/out 消息(指定 cs_wechat_id+created_at) → GET /cs/stats?date=today
#           → jq 断言 received_count/reply_count/served_customers/work_duration_minutes 精确等于预期
#  3) 数据隔离：灌两个不同 cs_wechat_id → A 的数绝不出现在 B 卡片
#  4) 时区：灌一条北京 00:30 消息 → 仍归「今天」
#  5) 老数据兼容：cs_wechat_id=NULL 消息 → 不计入任何客服、接口不报错
#  6) Playwright(windows_cloud)：打开「客服工作汇总」页 → 客服卡片 4 数正确 → 点「昨天」数字变化
#  7) CI 全绿（含 lint-feature-has-smoke / lint-tdd-commit-order）
```

## journey_type: user_facing
## journey_type_reason: 推进物含 apps/dashboard/ 新汇总页（管理员可见交互），命中 user_facing 优先级
## target_environment: windows_cloud
## target_environment_reason: PrepPRD 明确 Final E2E 走 windows_cloud（GitHub Actions windows-latest 干净 VM 跑 Playwright + smoke）
## journey_id: bfeed805
## step_id: 7b5b403c（feature 客服工作汇总统计页 / Line04 客户私域 AI 接管）
