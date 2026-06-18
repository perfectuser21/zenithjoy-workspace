# Sprint PRD — Line04 不回自己：消息方向检测（读气泡方向）

## OKR 对齐

- **对应 KR**：Line04 客户私域 AI 接管 — 回复质量护栏（不回自己/不回操作者）
- **当前进度**：客服回复行为参数（延迟/人工优先/版本守卫）已落地（#791）
- **本次推进预期**：补上「回复前判断消息方向」这道闸，根治回自己/回操作者两类弱智 bug

## 背景

现状 `scan_unread` 只读会话列表预览（名字 / [N条] / 最新消息 / 时间），1对1私聊里分不清最新这条谁发的；
路径2（内容变化触发）在你/AI/操作者发消息时也会触发 → 回自己。
`decide_reply_wait(human_intervened=...)` 的 `human_intervened` 当前固定传 `False` 占位（listen_chat 主循环 TODO），
缺「操作者手动介入」信号。本刀加一道方向检测闸，只对【对方发来】的最后一条消息才进生成+发送。

## Golden Path（核心场景）

用户私聊进来 → 系统扫到会话变化 → 开聊天读最后一条气泡方向 → 只对「对方发来（左对齐）」回复，对「我方/AI/操作者（右对齐）」跳过

具体：
1. 客户私聊进来 → 扫到会话变化 → 开聊天，读聊天区最后一条消息气泡
2. 最后气泡**左对齐**（气泡 rectangle 相对窗口中线偏左）= 对方发来 → 进入生成+发送回复流程
3. 最后气泡**右对齐**（相对窗口中线偏右）= 自己/AI/操作者发出 → 跳过，不回
4. 操作者刚手动回过（最右对齐气泡）→ 视为人工介入信号，本条 AI 回复跳过（接进 `decide_reply_wait` 的 `human_intervened`）

<!-- 方向判定的具体阈值/字段由 Proposer 读现有 _chat_title_matches / _verify_sent 的 UIA 气泡读取写法后推导，Planner 不定义技术规范。-->

## 边界情况

- 聊天区为空 / 读不到任何气泡 → 安全跳过（不回，宁可漏回不可回错）
- 气泡恰好压在窗口中线 → 按既定阈值归类（由实现侧定阈值，倾向判为「我方」更安全）
- 真实微信气泡 UIA 结构与 mock 不一致 → 不在本刀范围（见「不在范围内」）

## 范围限定

**在范围内**：
- `listen_chat.py` 加「读最后一条气泡方向」判定（复用现有 `_chat_title_matches`/`_verify_sent` 读 Text/rectangle 的 UIA 写法）
- 回复决策接入：只有「对方发来」才进生成+发送
- 修 `decide_reply_wait` 的 `human_intervened` 占位 — 操作者手动消息（右对齐气泡）= 人工介入信号
- 带 mock 气泡位置的 failing pytest（左对齐→回 / 右对齐→跳过 / 操作者右对齐→人工介入跳过）
- 同步 build-modules/line04（打包一致）；CI 全绿

**不在范围内**：
- 真机上对真实微信气泡 UIA 结构的最终确认与位置阈值校准（需 xian-pc 微信登录后 dump UIA）—— 单独一步另排
- 多号/群聊场景的方向判定（本刀只 1对1 私聊）

## 假设

- [ASSUMPTION: 现有 `_chat_title_matches`/`_verify_sent` 的 UIA 气泡读取模式可复用到「读聊天区最后一条气泡 rectangle」]
- [ASSUMPTION: 「右对齐=我方发出、左对齐=对方发来」这一微信 UI 约定成立，真机阈值留待校准步确认]
- [ASSUMPTION: base_repo = github zenithjoy-workspace；测试框架 pytest]

## 预期受影响文件

- `services/agent/wechat-rpa/listen_chat.py`：加气泡方向判定 + 接进回复决策 + 修 `decide_reply_wait` human_intervened 占位
- `services/agent/wechat-rpa/tests/test_msg_direction.py`（新增）：mock 气泡位置的方向判定单测
- `build-modules/line04/`（或对应打包产物）：同步打包一致

## E2E 验收

> 本刀交付物的验收 = 带 mock 气泡位置的 pytest 单测（在 CI 跑，真机校准另排）。Planner 初稿框定验收点，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment 填入。

```bash
# 占位：proposer 将填入真实命令（local_api → pytest）
# 期望验收点（自然语言）：
#  1. mock 最后气泡左对齐 → 方向判定返回「对方发来」→ 进入回复流程（应回）
#  2. mock 最后气泡右对齐 → 方向判定返回「我方/AI」→ 跳过（不回）
#  3. mock 操作者右对齐气泡 → human_intervened=True → 该条 AI 回复跳过（人工介入优先）
#  4. commit-1 为 failing pytest（定义完成），commit-2 实现转绿，CI 全绿
```

## journey_type: autonomous
## journey_type_reason: wechat-rpa worker 的回复决策逻辑（后端行为），本刀以 mock pytest 交付，无 UI、无远端协议/bridge 变更
## target_environment: local_api
## target_environment_reason: 本刀验收 = mock 气泡位置的 pytest 单测，在本地/CI 运行（pytest）；真机微信气泡校准另排（届时走 windows_wechat / xian-pc）
## journey_id: Line04（客户私域 AI 接管，来源 = task.payload.journey_id；未注入 UUID 时锚定 PrepPRD 标注的 Line04）
## step_id: Path4-Step3（名单内客户私聊进来 → AI 拼回复草稿；本刀为该步加「只回对方」方向闸）
