# Sprint PRD — 微信客服 无审批自动回复闭环（Line 04）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 微信智能客服从「出草稿等人审」升级为「名单内无人审自动回」
- **当前进度**：真送达验证 / 客户名单 / 三层记忆 / 人设知识库 已就绪（thin），出草稿仍需人审
- **本次推进预期**：新增「无审批自动回复闭环」ability（thin）——名单内自动回 + 名单外转待人工 + 自动代理总开关 + 关键人上下线播报

## 背景

微信客服现状是「AI 出草稿 → 客服人工审 → 发」。本 sprint 让名单内客户来消息时，在营业时间内、自动代理开启的前提下，AI 以 1~5 秒拟人延迟自动回复并真送达，全程无人审；名单外消息记一条待转人工；并加「开启自动代理」总开关（默认关=监控态，仍出草稿但不发）。复用已就绪的真送达验证（B 方案）、客户名单、三层记忆、人设/知识库、`send_chat.py` 主动发送。

## Golden Path（核心场景）

系统从 [名单内客户来消息] → 经过 [名单/营业时间/开关三重校验 → 组装上下文 → LLM 生成 → 拟人延迟 → 不抢焦点发送 → 读回验证] → 到达 [客户真收到 + 回执回写飞书/DB]

具体（单线性步骤序列）：

1. 管理员在配置页填**关键人微信**、设**营业时间**（默认 06:00–24:00，含跨午夜）、打开**「开启自动代理」**开关 → 系统保存 → **主动给关键人发上线播报**（如「🟢 智能客服已上线」，关键人真收到）→ 自动代理进入 ON
2. 名单内客户私聊 → 系统读到消息 → 校验「在名单内 ✅ + 营业时间内 ✅ + 自动代理 ON ✅」→ 三层记忆+人设+知识库组装 → DeepSeek(ToAPI) 生成回复 → **随机等 1~5 秒** → 不抢焦点自动发出 → 读回验证 → 客户真收到
3. 名单外的人私聊 → 系统识别不在名单 → 不生成不发 → 写一条 `pending_human` 到 DB + 飞书「互动记录」→ 管理员看到「有名单外消息待接管」
4. 发送完成 → 回执（成功/失败+原因）回写飞书「互动记录」/DB → 管理员可见
5. 管理员关闭「开启自动代理」→ 系统**主动给关键人发下线播报**（如「🔴 智能客服已下线，转人工」）→ 回退监控态

## 边界情况

- **监控态（开关 OFF，默认）**：名单内消息照常生成草稿写飞书（`pending_review`），但**不自动发**
- **营业时间外**：不自动回（记 pending 待上班处理）
- **关键人未配置**：跳过上下线播报，记一条日志，不阻塞开关切换
- **AI 空/超时**（>20s）：不发占位、跳过、记日志（复用 FAIL_PLACEHOLDER）
- **读回验证失败 / 微信掉线**：标 `send_failed`、记回执、**不重发**（防刷屏）+ 主动告警关键人 + 写飞书
- **消息重复读**（UIA 会重复读）：同 `(联系人, 消息文本, 时间窗)` 只回一次（去重幂等）
- **每日单号超额**（daily_limit>0 且超）：当天不再自动回 → 转 `pending_human`

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## NFR 约束

<!-- 来源：PrepPRD 用户显式确认（2026-06-22），主源；decisions 表副源本次为空 -->
- **频控-每分钟**：不设硬上限（`CHAT_PER_MINUTE_LIMIT=0`，靠回复延迟拟人）
- **频控-每日单号**：`daily_limit` 默认 0=不限，可配数字，超额转 `pending_human`
- **频控-操作间隔**：单次操作 ≥1 秒
- **回复延迟**：名单内消息后随机 1~5 秒再回（拟人）
- **去重/幂等**：同 `(联系人, 文本, 时间窗)` 只回一次（UIA 重复读防护，可靠性铁律）
- **LLM 超时**：DeepSeek(ToAPI) 生成 >20s → 跳过不发、记日志（不发占位）
- **可观测/告警**：发送失败（读回失败）/ 微信掉线 → 主动告警关键人微信 + 写飞书；自动发成功/失败均写 DB 回执
- **内容红线**：复用 persona 现有 `banned_phrases` 兜底，本 sprint 不单列红线配置
- **发送方式**：可见但不抢焦点（B 方案，非前台键鼠注入）
- **租户隔离**：读写一律按 `(tenant_id, contact)` 过滤，绝不跨租户（铁律）

## 范围限定

**在范围内**：名单内无审批自动回（拟人延迟+真送达）、名单外记 pending_human、「开启自动代理」开关（OFF=监控态出草稿不发）、营业时间窗口（含跨午夜）、关键人配置、开关跳变上下线播报、DB 放开 `approval_source` CHECK 容纳 `system` + 新增 `auto_sent`/`pending_human` 状态、上述 NFR。

**不在范围内**：转人工接管 UI、朋友圈主动发（`send_moment` 完全不碰）、公司/子账号/客服-PC 权限后台、Agent 客户机封装、多客服实例、多消息聚合回复。

## 假设

- [ASSUMPTION: 配置页 `WechatCustomerServiceConfigPage.tsx` + `cs-config-store.ts` + `wechat_cs_config`(key-value JSONB) 已存在，本次仅新增配置键 `auto_agent_enabled`/`business_hours_start`/`business_hours_end`/`key_contact_wechat`/`daily_limit`]
- [ASSUMPTION: `send_chat.py` 已支持 `target` 定位联系人，上下线播报与告警直接复用，无需新建发送通道]
- [ASSUMPTION: 飞书「客户档案」名单为 SSOT，名单内/外判定以该表为准；测试号准备见接缝清单]

## 预期受影响文件

- `services/agent/wechat-rpa/`（自动回复闭环逻辑：模式路由 / 延迟 / 去重 / 超时 / 告警；复用 `send_chat.py`）
- `apps/dashboard/`（`WechatCustomerServiceConfigPage.tsx` + `cs-config-store.ts` 新增 5 个配置键 + 开关跳变触发播报）
- DB migration（`wechat_publish_task.approval_source` CHECK 放开容纳 `system` + 新增 `auto_sent`/`pending_human` 状态）
- `.github/workflows/scripts/smoke/wechat-draft-auto-mode-smoke.sh`（扩展覆盖三态 + 名单外 + 回执 + 播报 + 去重 + 告警）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=`windows_wechat` 产出（逻辑断言走 CI smoke，接缝断言走 xian-rog 真机）。

```bash
# 占位：proposer 将填入真实脚本
# 逻辑断言（CI 绿即 done）：
#   - 模式路由单测：ON+名单内+营业时间→auto / OFF→review(监控) / 名单外→pending_human / 营业时间外→不发
#   - 1~5 秒随机延迟 + 营业时间窗口判定（含跨午夜 24:00）单测
#   - 开关跳变播报：OFF→ON 发上线 / ON→OFF 发下线 / 关键人未配则跳过记日志
#   - DB migration：approval_source 容 system、新状态可写、租户隔离不串
#   - NFR 单测：去重 / LLM 超时 20s 跳过 / daily_limit(0=不限/超额转 pending_human) / 失败·掉线告警关键人+飞书
#   - smoke 扩展：三态 + 名单外 pending_human + 回执回写 + 开关播报 + 去重 + 告警
# 接缝断言（xian-rog 真机必验，未验只能标 logic-done-pending）：
#   - 打开/关闭自动代理 → 关键人微信真收到上线/下线播报
#   - 名单内号发消息 → AI 1~5 秒内自动回、该号真收到、窗口不抢焦点
#   - 名单外号发消息 → 不被自动回，且飞书/DB 出现一条 pending_human
#   - 发送失败/掉线 → 告警真送达关键人微信
```

## journey_type: agent_remote
## journey_type_reason: 核心 ability 是远端 wechat-rpa agent 协议上的自动回复闭环（真送达/读回/主动发送），配置页仅为支撑入口，主战场在远端 agent。
## target_environment: windows_wechat
## target_environment_reason: 接缝必须在 xian-rog self-hosted runner 的真实微信 4.1.8 已登录环境验真送达；逻辑断言同 PR 走 CI smoke。
## journey_id: bfeed805-deed-46c3-8624-87f0028101d4
## step_id: L04-CS-no-approval-auto-reply（Line 04 客户私域 AI 接管 — 微信客服 无审批自动回复闭环，新增 thin ability）
