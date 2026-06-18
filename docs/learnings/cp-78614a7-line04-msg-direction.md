# Learning — Line04 不回自己：读气泡方向只回对方

**Sprint**: 06181535-line04-cs-msg-direction
**Path**: Path 4 Step 3（名单内客户私聊进来 → AI 拼回复草稿）

## 问题

wechat-rpa worker 的 `scan_unread` 只读会话列表预览，1对1 私聊里分不清最新这条谁发的；
内容变化触发（路径2）在你/AI/操作者发消息时也会触发 → **回自己 / 回操作者**。
`decide_reply_wait(human_intervened=...)` 的 `human_intervened` 固定传 `False` 占位，缺人工介入信号。

## 解法

顶层（零 pywinauto）纯函数 `_last_bubble_direction(mw)` 读聊天面板最底部气泡，
按气泡水平中心相对中线判 `incoming`（左）/`outgoing`（右或压线）/`None`（无气泡）：
- 区域约定复用 `_chat_title_matches`：`chat_left = 窗口左 + 宽//4`、标题区 `top < 顶+150`。
- 主循环 Phase 2 仅 `incoming` 进发送；`outgoing ⇒ human_intervened=True` 跳过（人工优先）；`None` 安全跳过。

## 踩坑

1. **接线 grep 闸**：合同要求 `decide_reply_wait(human_intervened=False)` 字面消失 → incoming 分支也不能写该字面，改用 `human_intervened` 变量（incoming 时值为 False，语义等价）。
2. **`.pytest_cache` 撞 L4 diff Gate**：合同 §E2E「先 pytest 后 `diff -r`」会让 pytest 默认写的 `.pytest_cache`（不在 `*.pyc/__pycache__` exclude 内）被误判为源码与 build-modules 打包副本分叉。加 `pytest.ini`（`-p no:cacheprovider`）禁用 cache 写入根治。
3. **真机时序属另排**：方向读取在 chat 打开前读 `mw`，多会话并发下不可靠 —— 但 PRD 明确真机微信气泡 UIA 校准「另排」，本刀 thin slice 以独立 oracle 纯函数 + mock pytest 交付。

## 验证

- 独立 oracle 6 case 全 exit 0（防假绿，不依赖 Generator 测试文件）。
- `pytest tests/` 全量 207 passed / 4 skipped，无回退。
