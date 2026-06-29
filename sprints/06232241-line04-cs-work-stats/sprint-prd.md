# Sprint PRD — 客服工作汇总统计页（每台客服机今天/昨天 4 个工作数据）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 让管理员看得见每台客服机的工作量
- **当前进度**：客服工作汇总统计页 feature 7b5b403c thin/building
- **本次推进预期**：thin → building（做出每客服每日 4 数 + 汇总页）

## 背景

对话原文已落库（cs_memory_messages 存了 in/out 原文，feature aa2c0f73 done），但缺"哪台客服处理的"身份字段，因而无法聚合，没有 stats 接口，也没有前台汇总页（Issue ecf13d74）。本 sprint 根治：给消息盖客服身份章 + 提供按北京时区聚合的 stats 接口 + 前台汇总页。

前提认知（用户已确认）：**一个账户 = 一台机器 = 一个微信号客服（1:1）**，统计天然按"每客服微信号"分，无需跨机加总。

## Golden Path（核心场景）

管理员从 [打开「客服工作汇总」页] → 经过 [看每台客服机今天的 4 个工作数] → 到达 [切昨天看昨天的数]

具体：
1. 名单内客户私聊某客服微信 → 客服机自动回复 → 这两条消息（in/out）落库时**自动盖上该客服微信号身份章**（cs_wechat_id）
2. 管理员打开 dashboard「客服工作汇总」页（挂 Line04 区下）
3. 看到**每台客服机一张卡**：客服名 / 微信号 / 在线状态 + 真发/演练标 + 今天【接收 X 条 · 回复 Y 条 · 接待 Z 人 · 工作 W 分钟】
4. 顶部切「昨天」→ 4 个数变为昨天的数

口径（用户已确认）：
- 接收 = 当日该客服 `in` 消息条数
- 回复 = 当日该客服 `out` 消息条数
- 接待客人数 = 当日该客服去重客户数（distinct contact）
- 工作时长（分钟）= 当日该客服 末条 created_at − 首条 created_at

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。字段名锚点见上述口径：received_count / reply_count / served_customers / work_duration_minutes -->

## 边界情况

- 某客服今天没有任何消息 → 卡片显示 4 个 0（不报错、不消失）
- 消息 cs_wechat_id 为 NULL（老数据 / 解析失败）→ **不计入任何客服统计、接口不报错**（不串到别人头上）
- 两个不同客服微信号的数字**互不串台**（A 的数绝不出现在 B 的卡片）
- 日界按**北京时区**算（中台运行在美区，需防 #832 美区算错日界）

## 范围限定

**在范围内**：
- cs_memory_messages 加 nullable 字段 `cs_wechat_id` + 索引 `(cs_wechat_id, created_at)`
- 消息落库时（in/out 两处）盖当前客服身份章（复用已有身份解析链 UUID→agents→env-id→machine→config）
- `GET /cs/stats?date=today|yesterday` 按北京时区聚合，每客服返回 4 个数
- 前台「客服工作汇总」页：每客服一张卡 + 今天/昨天切换

**不在范围内**（YAGNI）：
- 历史趋势图 / 折线图 / 任意日期范围（只今天/昨天两个值）
- 跨客服加总的总计行
- **回填历史老消息身份**（用户已拍板不回填）
- 导出 / 下载
- S4 每日报告、S2 配置权限、S5 飞书表（各自另立 Sprint）

## 假设

- [ASSUMPTION: cs_memory_messages 现有列含 created_at，工作时长用其末−首计算]
- [ASSUMPTION: stats 接口走中台已有内部鉴权 X-Internal-Token，不新增外部 API/Key]
- [ASSUMPTION: 客服"在线状态/真发-演练标"复用已有 module health / config 数据源，stats 页只读展示]

## 预期受影响文件

- `apps/api/db/migrations/<新>.sql`：cs_memory_messages 加 nullable `cs_wechat_id` + 索引 `(cs_wechat_id, created_at)`
- `apps/api/src/services/wechat/tenant-memory.ts`：appendMessage INSERT 增加 cs_wechat_id 列
- `apps/api/src/services/wechat-draft.ts`（:352 in / :408 out）：落库前解析并传入当前客服身份章
- `apps/api/src/routes/wechat.ts`（或同级 cs 路由）：新增 `GET /cs/stats`，按北京时区聚合
- `apps/dashboard/src/pages/`：新增「客服工作汇总」页 + 路由
- `apps/dashboard/src/config/navigation.config.ts`：Line04 区下挂汇总页入口

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本次查询为空）+ PrepPRD 显式值；PrepPRD 优先 -->
- 时区：日界按**北京时区（Asia/Shanghai）**聚合，非中台所在美区时区
- 向后兼容：cs_wechat_id nullable；老数据 NULL 不计入统计、不报错；不回填历史
- 性能：加索引 `(cs_wechat_id, created_at)` 加速按客服+日聚合
- 全局 NFR（频控/超时/去重/真发 gate）保持全局，本 sprint 不动
- 可观测：身份解析失败时不得静默串台，落 NULL 即可（不报错）

## E2E 验收

> Planner 初稿留占位 + 自然语言验收点。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（DB 断言用 psql/curl，UI 用 Playwright）。

```bash
# 占位：proposer 将填入真实脚本（local_api 段 curl+psql / windows_cloud 段 Playwright .spec.ts）
# 期望验收点（自然语言）：
# 1. 灌已知 in/out 消息（指定 cs_wechat_id + created_at）→ GET /cs/stats?date=today
#    → 断言该客服 received_count / reply_count / served_customers / work_duration_minutes 精确等于预期值
# 2. 数据隔离：灌两个不同 cs_wechat_id 的消息 → A 的数绝不出现在 B 的卡片
# 3. 时区：灌一条「北京时区今天 00:30」消息（美区当时为昨天）→ 仍归「今天」
# 4. 老数据兼容：cs_wechat_id=NULL 的消息 → 不计入任何客服统计、接口不报错
# 5. Playwright（windows_cloud）：打开「客服工作汇总」页 → 看到该客服卡片 4 个数正确 → 点「昨天」数字变化
# 6. CI 全绿（含 lint-feature-has-smoke / lint-tdd-commit-order）
```

## journey_type: user_facing
## journey_type_reason: 核心交付物是 apps/dashboard/ 下「客服工作汇总」前台页面，管理员可见
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI 走 GitHub Actions windows-latest 干净 VM（项目 E2E 死规则：ZenithJoy 任何 UI/Dashboard → windows_cloud），PrepPRD 已指定 Playwright windows_cloud
## journey_id: bfeed805
## step_id: 7b5b403c
