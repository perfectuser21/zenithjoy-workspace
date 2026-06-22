# Learning — Line04 微信客服 无审批自动回复闭环

**Sprint**: 06220821-line04-cs-no-approval-auto-reply
**Path**: Path 4 Step 3/5（名单内私聊自动回 + 自动代理总开关上下线播报）

## 问题

微信客服现状是「AI 出草稿 → 人工审 → 发」。要升级成「名单内无人审自动回」，
同时不能误回陌生人 / 不能营业时间外打扰 / 不能 UIA 重复读导致刷屏 / LLM 卡住时不能发占位。
决策逻辑若散在 Windows-only 的 `listen_chat.py` 里，Linux CI 根本测不到，只能靠真机，
回归脆弱。

## 解法

把所有「决策」抽成环境无关纯函数模块 `services/agent/wechat-rpa/auto_reply.py`（8 函数）：

- `decide_reply_route(in_whitelist, business_hours_ok, auto_agent_on, daily_count, daily_limit)`
  → 4 字面量 `auto/review/pending_human/skip_offhours`，优先级 OFF > 名单外 > 营业时间外 > 超额 > auto。
- `within_business_hours` 支持 `end="24:00"` 与跨午夜（start>end → `now>=start or now<end`）。
- `pick_reply_delay` 随机 1~5s 拟人；`is_duplicate` 进程内缓存按 (contact,text,窗) 去重。
- `llm_timeout_skip` >20s 跳过不发占位；`broadcast_action` 开关跳变上/下线/未配则 skip；
  `alert_on_failure` 失败告警 payload（带 also_feishu）；`build_receipt` 成功 auto_sent / 失败 send_failed 且不重发。

`listen_chat.py` 自动回闭环只调这些纯函数（拟人延迟改用 `pick_reply_delay`）；真送达 / 不抢焦点
仍是接缝层（`e2e-verify.ps1` 在 xian-rog 真机验），CI 绿 ≠ 接缝 done，未真验标 logic-done-pending。

## 关键坑

1. **配置存取**：`cs-config-store.ts` 的 `parseJsonbValue` 只认 object，标量 jsonb 读不回 →
   自动代理 5 键必须整体作为一个对象存在 `key='auto_agent'` 下（默认关：`auto_agent_enabled=false`）。
2. **DB CHECK 放开**：原 `wechat_publish_task` 两个匿名 CHECK（Postgres 默认命名
   `<table>_<column>_check`）须 `DROP CONSTRAINT IF EXISTS` + 显式命名重建，容 `system` +
   `auto_sent/pending_human/send_failed`，非法值仍 23514 拒。
3. **vitest 收集**：sprint oracle 在 `sprints/.../tests/` 不在 `apps/api` 的 include 内，
   合同命令 `cd apps/api && npx vitest run ../../sprints/.../...` 跑不到 →
   在 `apps/api/vitest.config.ts` 只加**本 sprint** 的窄 glob（不能加 `sprints/**` 否则全量 run 拉进 80 个他人测试）。
4. **build-modules 同步**：`ci-l4-runtime.yml` 对 `services/agent/wechat-rpa/` vs
   `build-modules/line04/wechat-rpa/` 做 `diff -r`，新增/改的 py 必须两边同步。
