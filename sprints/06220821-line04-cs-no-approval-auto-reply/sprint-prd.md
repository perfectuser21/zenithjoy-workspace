# Sprint PRD — 微信客服 无审批自动回复闭环（Line 04）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 微信客服自动化
- **当前进度**：真送达验证 + 名单 + 三层记忆 + 人设已就绪（thin）
- **本次推进预期**：从"出草稿等人审"推进到"名单内无审批自动回 + 开关播报"

## 背景

微信客服当前是"AI 出草稿、人工审批后发"。本 sprint 加「开启自动代理」总开关：开=名单内客户来消息在营业时间内 1~5 秒拟人延迟后自动回（无人审、真送达）；关=退回监控态（照常生成草稿写飞书，不发）。名单外消息只记 `pending_human`。开关跳变时主动给关键人发上线/下线播报。复用已验证的 B 方案真送达、客户名单、三层记忆、人设/知识库、send_chat.py 主动发送。

## Golden Path（核心场景）

入口（管理员配置开关）→ 名单内自动回 + 名单外记待转 → 出口（回执回写 + 开关播报）

1. 管理员在配置页填**关键人微信** + 设**营业时间**（默认 06:00–24:00）+ 打开**「开启自动代理」** → 系统保存 → 主动给关键人发上线通知（"🟢 智能客服已上线"），关键人微信真收到 → 自动代理 ON
2. 名单内客户私聊 → 系统读消息 → 校验【在飞书客户名单 ✅ + 营业时间内 ✅ + 自动代理 ON ✅】→ 三层记忆+人设+知识库组装 → DeepSeek(ToAPI) 生成回复 → 随机等 1~5 秒 → 不抢焦点自动发出 + 读回验证 → 客户真收到
3. 名单外的人私聊 → 识别不在名单 → 不生成不发 → 写一条 `pending_human` 到 DB/飞书"互动记录" → 管理员可见"有名单外消息待接管"
4. 发送完成 → 回执（成功/失败+原因）回写飞书"互动记录"/DB
5. 管理员关闭「开启自动代理」 → 主动给关键人发下线通知（"🔴 智能客服已下线，转人工接管"）→ 回退监控态

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- **监控态（自动代理 OFF，默认）**：名单内消息照常生成草稿写飞书（`pending_review`），不自动发
- **营业时间外**：不自动回，记 pending 待上班处理；窗口判定含跨午夜（24:00）
- **关键人未配置**：跳过上线/下线播报，记日志，不阻塞开关切换
- **AI 生成空/超时**：不发占位、跳过、记日志（复用 FAIL_PLACEHOLDER）
- **读回验证失败**：标 `send_failed`、记回执、不重发（防刷屏）

## 范围限定

**在范围内**：自动代理开关（默认关）+ 营业时间窗口 + 关键人配置 + 上线/下线播报；名单内无审批自动回（1~5s 延迟 + 真送达读回）；名单外 `pending_human`；回执回写；DB 放开 `approval_source` CHECK 容纳 `system` + 新增 `auto_sent`/`pending_human` 状态。

**不在范围内**：转人工接管 UI、朋友圈主动发（send_moment 完全不碰）、公司/子账号/客服-PC 权限后台、Agent 客户机封装、多客服实例、多条消息聚合回复。

## 假设

- [ASSUMPTION: 新配置键挂在已有 `wechat_cs_config`（key-value JSONB）：`auto_agent_enabled`(默认 false)/`business_hours_start`("06:00")/`business_hours_end`("24:00")/`key_contact_wechat`]
- [ASSUMPTION: 上线/下线播报复用 send_chat.py 的 `target` 定位关键人，主动发起会话]
- [ASSUMPTION: 名单来源 = 飞书"客户档案"已有名单 ability]

## 预期受影响文件

- `apps/dashboard/.../WechatCustomerServiceConfigPage.tsx` + `cs-config-store.ts`：新增 4 个配置键 UI
- `services/agent/wechat-rpa/`（模式路由 + 1~5s 延迟 + 营业时间判定 + 名单校验 + 播报触发）
- `wechat_publish_task` migration：放开 `approval_source` CHECK 容纳 `system`，新增 `auto_sent`/`pending_human` 状态
- `services/agent/wechat-rpa/send_chat.py`：复用主动发送（上线/下线播报）
- `.github/workflows/scripts/smoke/wechat-draft-auto-mode-smoke.sh`：扩三态覆盖

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；decisions 表 category=nfr（Brain API 本次未响应，留待 Proposer 复核）-->
- 拟人延迟：名单内自动回随机等待 1~5 秒
- 营业时间窗口：默认 06:00–24:00，必须支持跨午夜判定
- 频控/防刷屏：读回验证失败标 `send_failed` 不重发
- 版本要求：WeChat 4.1.8（line04 1.0.48 已部署）
- 可观测：失败/跳过/播报缺关键人 → 记日志；回执（成功/失败+原因）回写飞书+DB
- 租户隔离：多租户不串

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment 产出。

```bash
# 占位：proposer 按 target_environment 填入真实脚本
# 逻辑断言（CI / local_api）：扩 wechat-draft-auto-mode-smoke.sh
#   - 模式路由：ON+名单内+营业时间内→auto；OFF→review(监控)；名单外→pending_human；营业时间外→不发
#   - 1~5s 随机延迟 + 营业时间窗口判定（含跨午夜 24:00）单测
#   - 开关跳变播报：OFF→ON 发上线 / ON→OFF 发下线 / 关键人未配跳过+记日志
#   - DB migration：approval_source 容纳 system，auto_sent/pending_human 可写，租户隔离
#   - smoke：三态 + 名单外 pending_human + 回执回写 + 开关播报
# 接缝断言（windows_wechat / xian-rog 真机，未验只能标 logic-done-pending）：
#   - 打开自动代理 → 关键人微信真收到上线通知；关闭 → 真收到下线通知
#   - 名单内号发消息 → AI 1~5s 内自动回 → 真收到、窗口不抢焦点
#   - 名单外号发消息 → 不被自动回，且飞书/DB 出现一条 pending_human
#   - ToAPI 真出 reply（非 mock）
```

## journey_type: agent_remote
## journey_type_reason: 核心新能力 = wechat-rpa 远端 agent 协议自动收发 + send_chat.py 主动发送，配置页为已有页面复用
## target_environment: windows_wechat
## target_environment_reason: 接缝在 xian-rog 真机微信 4.1.8（Path4 个微 RPA 真送达/真收/不抢焦点），逻辑断言同 PR 走 CI smoke
## journey_id: bfeed805-deed-46c3-8624-87f0028101d4
## step_id: L04-无审批自动回复闭环（PrepPRD 新增 ability，thin）
