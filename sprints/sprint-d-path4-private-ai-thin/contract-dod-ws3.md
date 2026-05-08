---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: DeepSeek 私聊回复草稿 + wxauto4 监听 + 写飞书互动记录

**范围**: Python listen_chat.py 真 import wxauto4（启动打印版本号到 stderr）+ 名单内过滤 + dryrun 注入；中台 /api/wechat/draft-generate 拼对话历史 + 营销画像 → DeepSeek → 飞书互动记录（pending_review，approval_source NULL — A 路线护栏起点）；def 黑名单 enforce 不允许主动发起会话
**大小**: M
**依赖**: ws1, ws2

## ARTIFACT 条目

- [ ] [ARTIFACT] listen_chat.py 存在 + 真 import wxauto4
  Test: grep -E "^(from wxauto4|import wxauto4)" services/agent/wechat-rpa/listen_chat.py

- [ ] [ARTIFACT] listen_chat.py 启动打印 wxauto4.__version__
  Test: grep -E "wxauto4\.__version__" services/agent/wechat-rpa/listen_chat.py

- [ ] [ARTIFACT] /api/wechat/draft-generate 端点
  Test: grep -E "/api/wechat/draft-generate" apps/api/src/routes/wechat.ts

- [ ] [ARTIFACT] 主动发起会话 def 黑名单 = 0
  Test: grep -rcE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" services/agent/wechat-rpa/ | awk -F: '{sum+=$2} END { exit (sum > 0) }'

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/listen-chat.test.ts`、`tests/ws3/draft-generate.test.ts`、`tests/ws3/a-route-guardrail.test.ts`，覆盖：

- listen_chat.py --dryrun-print-version → stderr 含 'wxauto4 version: X.Y'（运行时实证非 mock）
- listen_chat.py --dryrun --inject-message 名单内客户消息 → 飞书互动记录 pending_review +1
- listen_chat.py --dryrun --inject-message 名单外消息 → 飞书互动记录行数不变（before == after）
- OPENROUTER_FORCE_5XX=1 + NODE_ENV=development 注入 → 飞书表写'AI 生成失败'占位 + 状态保持 pending_review
- llm_audit 表含 DeepSeek 真调用记录（model='deepseek/deepseek-chat'，cost > 0）
- A 路线护栏 SQL: SELECT COUNT FROM wechat_publish_task WHERE type='chat' AND approval_status NOT IN ('pending_review','rate_limited','rejected') = 0
- A 路线护栏 SQL: SELECT COUNT FROM wechat_publish_task WHERE type='chat' AND approval_status='approved' AND approval_source IS NULL = 0
