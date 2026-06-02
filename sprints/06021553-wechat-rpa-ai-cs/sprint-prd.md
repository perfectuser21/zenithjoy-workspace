# Sprint PRD — Path 4 客户私域 AI 接管 · 微信 4.0 RPA 换 pywinauto + 自动回复模式

## OKR 对齐

- **对应 Journey**：客户私域 AI 接管（Path 4），Brain journey_id=`bfeed805-deed-46c3-8624-87f0028101d4`，Notion=`35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`
- **当前进度**：Path 4 Sprint 1 ws3 已交付（listen_chat.py + send_chat.py + rate_limiter.py + wechat-draft.ts + wechat-rpa.ts handler 均已落库），但 listen_chat.py/send_chat.py 用的是 **wxauto4 库**——2026-06-02 在 xian-pc 微信 4.0 上已确认 wxauto4 读不到新消息，为失效库
- **本次推进**：把 Python 层换成 **2026-06-02 xian-pc 已真机验证的 pywinauto 配方**（`element_info.name` 解析未读 → `select()` 打开 → `chat_input_field` 填 → `name=='发送'` 点击）；并给 `generateChatDraft` 加自动回复模式（返回 `reply` 文本供 listener 直发，审核台模式不变）

## 背景

Path 4 目标是让挂着微信 4.0 桌面端的运营机**隐形冒充本人自动回客户私聊**。现状：
- 监听层 `listen_chat.py` 用 `wxauto4.GetAllMessage` → 微信 4.0 上拿不到消息（根本原因已确认）
- 发送层 `send_chat.py` 用 `pyautogui` 硬坐标序列 → 脆弱，坐标校准依赖截图
- find_weixin.py 是空 stub，返回 NotImplementedError

2026-06-02 xian-pc（Windows 10 + 微信 4.0 + Python 3.12 + pywinauto）人工验证了完整配方：用 UIAutomation 读会话列表 `element_info.name`、`select()` 打开、`automation_id=='chat_input_field'` 写字、`name=='发送'` 点击，全链路通过。这是 2026-06-02 前已穷尽的唯一"隐形冒充本人"路线（官方 ClawBot/iLink 收不到客户私聊；企微看得出是"客服"；Hook/WeChatFerry 只能跑 3.9.x 且腾讯封登录）。

`wechat-draft.ts` 的 `generateChatDraft` 现在只返回 `{ok, status:'pending_review', task_id, draft_id}`——生成的 `aiContent` 没有暴露出来，listener 拿不到文本，无法自动发送。需要加一个 `mode:'auto'` 入参，在保持默认审核台行为不变的前提下额外返回 `reply` 字段。

## Golden Path（核心场景）

从 [运营机：微信 4.0 已登录 + 讲述人解锁过 + zenithjoy-agent 连中台] → 经过 [listen_chat 真模式循环扫未读 → 发现私聊 → POST draft-generate(auto) → 取 reply → RPA 自动回] → 到达 [客户看到"运营本人"的回复，感知不到是 AI]

具体 6 步：

1. zenithjoy-agent 以登录微信的 Windows 用户身份 spawn `listen_chat.py`（真模式，无 `--dryrun`）
2. 客户给运营微信发私聊 → 会话列表该条目出现 `[N条]` 未读标记
3. `scan_unread()` 通过 `element_info.name` 解析出 `{sender, content}`，过滤公众号/服务号等系统账号
4. `listen_chat.py` POST `中台/api/wechat/draft-generate` 带 `mode:'auto'` → 中台 `generateChatDraft` 从飞书拉该客户最近 10 轮互动记录 + 营销画像 → 调 OpenRouter DeepSeek 生成回复 → 写飞书互动记录 pending_review → 返回 `{ok:true, ..., reply:'生成的文本'}`
5. `listen_chat.py` 拿到 `reply` 文本 → 调 `reply_in_chat(mw, item, reply)`：`item.select()` 打开会话 → `chat_input_field.set_text(reply)` → `name=='发送'` 按钮 `click_input()` → 验证输入框清空=发送成功
6. 客户收到消息，显示为运营本人发出（隐形 AI）；飞书互动记录留有 `pending_review` 草稿存档供人工审阅

## 边界情况

- 讲述人未解锁 / UI 自动化被屏蔽 → `Desktop(backend='uia').windows()` 找不到 `mmui::MainWindow` 或 ListItem 列表为空 → 报警"请重做讲述人解锁"
- 微信未登录 → 检测到 `mmui::LoginWindow` → 报警"微信未登录"；不重试
- 客户发信人不在飞书"客户档案"名单 → `generateChatDraft` 返回 `{ok:false, reason:'not_in_whitelist'}` → listener 跳过不发，不入已回列表
- OpenRouter / DeepSeek 超时 5xx → `aiContent` 落 FAIL_PLACEHOLDER → `reply` 字段为空或为占位文本 → listener 检测 `reply` 为空/占位时跳过自动发送（不发占位文案给客户）
- 频控限制命中（`rate_limiter.can_send('chat', wechat_id)` 返回 false）→ listener 跳过当前消息，记 `next_allowed_at`
- `click_input()` 拒绝访问（非登录用户身份运行）→ 抛 `PermissionError` → 脚本报错退出 + stderr 说明需要用登录用户身份运行
- 发送后 `edit.get_value() != ''`（输入框未清空）→ 认为发送失败 → 不加入已回集合 → 下次循环重试（受频控约束）
- 同一 `(sender, content)` 不重复处理（`replied` set 内去重）

## 范围限定

**在范围内**：

- `services/agent/wechat-rpa/listen_chat.py`：**删除 wxauto4 全部依赖**，真模式换成 pywinauto `scan_unread + reply_in_chat` 配方；保留 `--dryrun / --inject-message / --dryrun-print-version` CLI 结构和 WECHAT_DRAFT_API_DRYRUN 环境变量降级；POST draft-generate 改带 `mode:'auto'`；拿 `reply` 字段发送
- `services/agent/wechat-rpa/send_chat.py`：**删除 pyautogui 硬坐标序列**，真发逻辑换成 pywinauto `reply_in_chat` 配方；保留频控 + stdin JSON 接口
- `services/agent/wechat-rpa/find_weixin.py`：实现 `get_main_window()` → `Desktop(backend='uia').windows()` 枚举 `mmui::MainWindow`；删除 `NotImplementedError` stub
- `apps/api/src/services/wechat-draft.ts`：`GenerateChatDraftParams` 加可选 `mode?: 'auto' | 'review'`（默认 `'review'`）；`GenerateChatDraftSuccess` 加可选 `reply?: string`；`mode=='auto'` 时把 `aiContent` 赋给 `reply` 返回；默认审核台行为**不变**（approval_source 仍 NULL，approval_status 仍 pending_review）
- `services/agent/wechat-rpa/requirements.txt`：换成 `pywinauto`（删 `wxauto4`）
- 单元测试 `services/agent/wechat-rpa/tests/test_scan_unread.py`：纯函数测 `scan_unread` 解析逻辑，喂 mock `element_info.name` 字符串
- 单元测试 `services/agent/wechat-rpa/tests/test_rate_limiter.py`（已有或补充）：频控上限逻辑
- CI 路径：`listen_chat --dryrun --inject-message` 保持绿
- 集成测试 `apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts`：mock 飞书 + mock openrouter，验证 `mode:'auto'` 返回 `reply` 文本 + 飞书最近 10 轮上下文

**不在范围内**：

- ❌ wxauto4 任何形式保留（禁止）
- ❌ 讲述人自动解锁（需人工或开机脚本，无法远程）
- ❌ 主动发起新会话（thin 阶段只被动回）
- ❌ 群聊、朋友圈、图片/语音/文件消息处理
- ❌ 多号矩阵、滚动读历史消息
- ❌ 真机微信 E2E 进 CI（Linux 沙箱无微信 4.0，CI 只跑 dryrun + 单测 + integration）
- ❌ send_moment.py 改造（不在本 sprint）
- ❌ qr_bind.py 改造（不在本 sprint）
- ❌ wechat-rpa.ts NodeJS handler 逻辑变动（已有 spawn 结构保留）

### 数据模型变更

无新表/字段。`wechat_publish_task` 表结构不变（approval_source 仍 NULL，approval_status 仍 pending_review）。

`GenerateChatDraftResult` TypeScript 接口扩展：

| 原字段 | 变化 |
|---|---|
| `ok: true` | 不变 |
| `status: 'pending_review'` | 不变 |
| `task_id: string` | 不变 |
| `draft_id: string` | 不变 |
| `reply?: string` | **新增**，仅 `mode=='auto'` 且 AI 生成非空时填充 |

## 假设

- [ASSUMPTION: pywinauto 在 xian-pc（Windows 10 + Python 3.12）已通过 `pip install pywinauto -i https://pypi.tuna.tsinghua.edu.cn/simple` 装好，配方 2026-06-02 真机验证全链路通过，Generator 不需要自行验证 Windows 行为]
- [ASSUMPTION: 讲述人解锁是运营机前置操作，不是代码职责；脚本只检测失效并报警]
- [ASSUMPTION: zenithjoy-agent 在 xian-pc 始终以登录微信的 Windows 用户会话（非 SYSTEM、非服务账户）spawn Python 子进程，`click_input()` 的"会话登录用户身份"天然满足]
- [ASSUMPTION: CI（Linux）上 pywinauto import 会失败；listen_chat.py 的 `--dryrun` 路径和 `scan_unread` 纯函数测试完全不 import pywinauto（零依赖）；集成测试环境只跑 TypeScript 侧，不跑 Python 真模式]
- [ASSUMPTION: `generateChatDraft` 的飞书名单校验、历史拉取、OpenRouter 调用逻辑完全复用现有实现，不重写；`mode:'auto'` 只是在成功路径末尾额外暴露 aiContent]
- [ASSUMPTION: 自动回模式下，若 aiContent 为 FAIL_PLACEHOLDER（AI 失败占位），listener 侧检测到 reply 为 FAIL_PLACEHOLDER 时自行跳过发送，不把错误占位发给客户]

## 预期受影响文件

**改造**（已有文件，替换核心实现）：
- `services/agent/wechat-rpa/listen_chat.py`：删 wxauto4 真模式，换 pywinauto scan_unread + reply_in_chat + mode:'auto' POST
- `services/agent/wechat-rpa/send_chat.py`：删 pyautogui 硬坐标，换 pywinauto reply_in_chat
- `services/agent/wechat-rpa/find_weixin.py`：删 NotImplementedError stub，实现 get_main_window()
- `services/agent/wechat-rpa/requirements.txt`：wxauto4 → pywinauto
- `apps/api/src/services/wechat-draft.ts`：GenerateChatDraftParams/Result 扩展 mode + reply 字段

**新增**（测试）：
- `services/agent/wechat-rpa/tests/test_scan_unread.py`：scan_unread 纯函数单测（不 import pywinauto）
- `apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts`：mode:'auto' integration

**不动**：
- `services/agent/wechat-rpa/rate_limiter.py`（完整复用）
- `services/agent/wechat-rpa/qr_bind.py`、`send_moment.py`
- `services/agent/src/handlers/wechat-rpa.ts`（NodeJS spawn 层不变）
- `apps/api/src/routes/wechat-draft-router.ts`（路由层不变）
- `apps/api/src/llm/openrouter.ts`（LLM 调用层不变）

## 验收标准

- [ ] `scan_unread` 纯函数单测绿：喂 `'于瑾\n[1条] \n您好\n15:26\n'` 解析出 `{sender:'于瑾', content:'您好'}`；喂 `'公众号\n[1条] \n广告\n11:09\n'` 被过滤；喂无 `[N条]` 条目不出现在结果
- [ ] 频控单测绿：`can_send('chat', ...)` 在同 wechat_id 第 3 次调用（超分钟 ≤2 限）返回 `(False, next_allowed_at)`
- [ ] `listen_chat --dryrun --inject-message='{"sender":"test","wechat_id":"wx123","content":"你好"}' WECHAT_DRAFT_API_DRYRUN=1` 退出码 0，stdout 含 `"dryRun":true`
- [ ] `apps/api` auto-reply integration：mock 飞书返回 1 条互动记录 + mock openrouter 返回文本 → `generateChatDraft({..., mode:'auto'})` 返回 `{ok:true, reply:'<文本>'}`，reply 不为空、不为 FAIL_PLACEHOLDER
- [ ] 代码无 wxauto4 任何 import / reference（grep 全库为 0）
- [ ] listen_chat.py 真模式核心函数：`get_main_window` 用 `element_info.class_name=='mmui::MainWindow'`；`scan_unread` 用 `control_type='ListItem'` + `element_info.name` 解析；`reply_in_chat` 用 `automation_id=='chat_input_field'` set_text + `name=='发送'` click_input
- [ ] 真机自验（xian-pc，Lead 在 2026-06-02 已完成）：讲述人解锁 → 客户发"你好" → listener 读到 → DeepSeek 生成 → 自动发出 → 客户收到；截图 + 飞书互动记录存档于 `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md`

## journey_type: user_facing
## journey_type_reason: 最终用户可见结果为客户私聊窗口收到"运营本人"发出的 AI 回复，属于 Path 4 端到端客户感知链路

{"verdict":"DONE","sprint_dir":"sprints/06021553-wechat-rpa-ai-cs"}
