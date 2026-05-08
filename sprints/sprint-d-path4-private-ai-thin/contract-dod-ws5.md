---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: 飞书审批轮询 + Python wechat_rpa 真发 + 频控保护（含并发安全）

**范围**: 中台 30s 一次轮询飞书 approved 草稿 → 写 DB approval_source='feishu_user' → 校验频控 → spawn task_dispatch；Python send_chat.py + send_moment.py（REAL_PUBLISH=0 走 unittest.mock.MagicMock，不真调 pyautogui）；rate_limiter.py SQLite + BEGIN IMMEDIATE 并发安全 + 硬编码上限（朋友圈 ≤1/24h、私聊 ≤2/分钟 + ≤50/天、操作间隔 ≥1s、主动发起 = 0）
**大小**: L
**依赖**: ws1, ws2, ws3, ws4

## ARTIFACT 条目

- [ ] [ARTIFACT] send_chat.py / send_moment.py / rate_limiter.py 全部存在
  Test: for f in send_chat send_moment rate_limiter; do test -f services/agent/wechat-rpa/${f}.py || exit 1; done

- [ ] [ARTIFACT] rate_limiter.py 含 BEGIN IMMEDIATE 事务
  Test: grep -E "BEGIN IMMEDIATE|begin\(.*immediate" services/agent/wechat-rpa/rate_limiter.py

- [ ] [ARTIFACT] feishu-poll.ts 含 30s 轮询周期
  Test: grep -E "30.*1000|setInterval.*30000|cron.*\*/30" apps/api/src/services/feishu-poll.ts

- [ ] [ARTIFACT] REAL_PUBLISH=0 走 mock 路径
  Test: grep -E "REAL_PUBLISH|MagicMock|unittest\.mock" services/agent/wechat-rpa/send_moment.py

## BEHAVIOR 索引（实际测试在 tests/ws5/）

见 `tests/ws5/send-moment-dryrun.test.ts`、`tests/ws5/rate-limiter.test.ts`、`tests/ws5/feishu-poll.test.ts`，覆盖：

- 飞书 approved → 5s 内 DB approval_source='feishu_user' 写入（A 路线护栏 enforce）
- REAL_PUBLISH=0 send_moment.py → JSON {ok:true, dryRun:true, sent_at:ISO}
- python -m trace --trace 验证 REAL_PUBLISH=0 时 pyautogui.click/write/press/hotkey 调用次数 = 0
- 朋友圈 24h 频控：第 2 条同 wechat_id → {ok:false, reason:'rate_limited', next_allowed_at}
- 私聊分钟级频控：第 3 条 1 分钟内 → rate_limited
- 私聊天级频控：第 51 条 24h 内 → rate_limited
- rejected 飞书草稿不派 task_dispatch（dispatch.log 无对应 record_id）
- ~/.zenithjoy-agent/rate_limit.db 真持久化文件存在（重启不清空）
- 10 并发 ThreadPoolExecutor can_send → True 数 ≤ 上限（chat ≤ 2）
- 主动发起会话 def 黑名单 = 0（不引入新主动发起函数）
