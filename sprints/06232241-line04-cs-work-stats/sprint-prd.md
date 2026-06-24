# Sprint PRD — 客服工作汇总统计页（每台客服机今天/昨天 4 个工作数据）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 客服工作可观测化
- **当前进度**：feature 7b5b403c 客服工作汇总统计页 = thin/building
- **本次推进预期**：thin → building（做出第一版可看的汇总页 + /cs/stats 接口）

## 背景

对话原文已落库（cs_memory_messages 有 in/out + created_at），但缺「哪台客服处理的」身份字段，无聚合、无 stats 接口、无前台汇总页（Issue ecf13d74）。本 sprint 让管理员在中台一眼看到每台客服机今天/昨天干了多少活。前提认知：1 账户 = 1 机器 = 1 微信号客服（1:1），统计天然按每客服微信号分。

## Golden Path（核心场景）

管理员从 [打开「客服工作汇总」页] → 经过 [看每台客服机一张卡的今天数据] → 到达 [切昨天看另一天的数]

具体：
1. 名单内客户私聊某客服微信 → 客服机自动回复 → 这两条消息（in/out）落库时**自动盖上该客服微信号身份章**（cs_wechat_id）
2. 管理员打开 dashboard「客服工作汇总」页（挂 Line04 区下）
3. 看到**每台客服机一张卡**：客服名 / 微信号 / 在线状态 + 今天【接收 X 条 · 回复 Y 条 · 接待 Z 人 · 工作 W 分钟】+ 真发/演练标
4. 顶部切「昨天」→ 4 个数变为昨天的数（按北京时区算日界）

口径（钉死）：接收=count(in)、回复=count(out)、接待=distinct 客户、工作时长=当天该客服末条 − 首条（分钟）。

## NFR 约束

<!-- 来源: PrepPRD 显式（decisions?category=nfr 无返回，全用 PrepPRD） -->
- 时区：按**北京时区（Asia/Shanghai）**聚合日界，中台部署在美区也必须以北京日界归日（防 #832 美区算错日界）
- 向后兼容：cs_wechat_id **nullable**，老数据 NULL **不计入统计、不报错、不回填**
- 全局 NFR（频控/超时/去重/真发 gate）保持全局，本 sprint 不动
- 不新增任何外部 API / Key（纯 DB 读 + 前台展示），鉴权复用 X-Internal-Token

## 边界情况

- 某客服今天还没有任何消息 → 卡片显示 4 个 0（不报错、不消失）
- cs_wechat_id 为 NULL（老数据/身份解析失败）→ 不计入任何客服统计（不串到别人头上、接口不报错）
- 两个不同 cs_wechat_id 的消息 → 各算各的，A 的数绝不出现在 B 的卡片

## 范围限定

**在范围内**：cs_wechat_id 字段 + 索引；落库时盖身份章；GET /cs/stats（today/yesterday，北京时区）；前台「客服工作汇总」页 + 今天/昨天切换。
**不在范围内**（YAGNI）：历史趋势/折线图、任意日期范围、跨客服总计行、回填历史老消息身份、导出/下载。

## 假设

- [ASSUMPTION: 身份解析链（UUID→agents→env-id→machine→config）已存在（Issue defe1a42/dd320e56 修过），appendMessage 处可直接取当前客服微信号]
- [ASSUMPTION: journey_id 取 PrepPRD 锚定的 Line04 bfeed805]

## 预期受影响文件

- `apps/api/db/migrations/<新>_add_cs_wechat_id_to_cs_memory_messages.sql`：加 cs_wechat_id（nullable）+ 索引 (cs_wechat_id, created_at)
- `apps/api/src/services/wechat-draft.ts`：appendMessage 的 in/out 两处落库时写 cs_wechat_id
- `apps/api/src/routes/wechat.ts`：新增 GET /cs/stats（按北京时区聚合，date=today|yesterday）
- `apps/dashboard/src/pages/<新>CsWorkStatsPage.tsx` + `apps/dashboard/src/api/`：客服工作汇总页 + 今天/昨天切换
- `apps/dashboard/src/components/DynamicSidebar.tsx`：Line04 区挂新页路由

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（schema 存在性断言用 node 读 migration 文件；数据行断言用 psql/curl 带时间窗；UI 用 Playwright）。

```bash
# 占位：proposer 按 target_environment 填入真实脚本
# 期望验收点（自然语言）：
#  1. schema 断言（禁用 information_schema）：node -e 读 migration 文件，断言含 'cs_wechat_id' + nullable + 索引 (cs_wechat_id, created_at)
#  2. 口径精确：seed 已知 in/out 消息（指定 cs_wechat_id + created_at）→ GET /cs/stats?date=today
#     → jq 断言 received_count/reply_count/served_customers/work_duration_minutes 精确等于预期
#  3. 数据隔离：灌两个不同 cs_wechat_id 的消息 → A 的数绝不出现在 B 的卡片
#  4. 时区：灌「北京今天 00:30」消息（美区当时为昨天）→ 仍归「今天」
#  5. 老数据兼容：cs_wechat_id=NULL 的消息 → 不计入任何客服统计、接口不报错
#  6. Playwright(windows_cloud)：打开「客服工作汇总」页 → 卡片 4 个数正确 → 点「昨天」数字变化
#  注：所有数据行 SELECT 必须带 AND created_at > NOW() - interval '5 minutes' 防假绿
```

## journey_type: user_facing
## journey_type_reason: 新增 apps/dashboard/ 「客服工作汇总」页，命中 user_facing 优先链首条
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI（Playwright），按死规则 ZenithJoy 任何 UI 走 GitHub Actions windows-latest 干净 sandbox
## journey_id: bfeed805
## step_id: L04-S3
