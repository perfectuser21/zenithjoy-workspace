# Sprint 1 合同草案（第 1 轮 — Generator 起草）

> Sprint: Path 4 客户私域 AI 接管 — Sprint 1（thin 第一刀 / skeleton 贯穿）
> PRD: `sprints/sprint-d-path4-private-ai-thin/sprint-prd.md`
> Journey: Path 4 (Notion `35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`)
> Maturity: not_started → skeleton
> Workstream DAG: ws1 → ws2 → ws3 → ws4 → ws5 → ws6（线性，每个 ws 完成 push 一个 PR）

## 本次实现的功能（按 6 个 workstream 切）

- **ws1**: DB schema + 中台路由 + zenithjoy-agent 协议扩展（基础设施）
- **ws2**: 个微扫码绑号 + 飞书 Bitable 4 表自动初始化 + Dashboard 绑微信入口
- **ws3**: DeepSeek 私聊回复草稿生成 + wxauto4 监听 + 写飞书互动记录
- **ws4**: DeepSeek 朋友圈文案草稿生成 + 写飞书内容排期 + 中台定时触发
- **ws5**: 飞书审批轮询 + Python wechat_rpa 真发（朋友圈/私聊）+ 频控保护硬编码上限
- **ws6**: golden-path-4-smoke.sh + Lead 自验 evidence 模板 + CI 防作弊校验

---

## 验收标准（DoD）

### ws1: DB schema + 中台路由 + Agent 协议扩展（基础设施）

**行为描述**：
- 新建 migration 加 `wechat_publish_task` 表（task_id / platform=wechat_personal / type=moment|chat / target_user / content_draft / approval_status / rate_limit_status / receipt_status / receipt_error / created_at / updated_at）
- `agent_platform_sessions` 表加 `platform=wechat_personal` 支持（不需要新 schema，只在枚举/类型校验放行）
- 中台新增 `POST /api/wechat/qr-bind` / `POST /api/wechat/draft-review-poll` / `POST /api/wechat/scheduler-tick` 端点（zod 校验入参）
- zenithjoy-agent 协议扩展：handlers 注册新 handler `wechat-rpa`，接受 task_dispatch type 之一：`wechat_qr_bind` / `wechat_listen_start` / `wechat_send_chat` / `wechat_send_moment`
- handler 实现是 NodeJS 主进程 `spawn` Python 子进程的骨架（Python 子进程文件本 ws 不实现，留 stub 文件标记 ws3-5 实现）

**硬阈值**：
- migration 在 `apps/api/src/migrations/` 下，命名前缀严格按 zenithjoy 既往 NNN_*.sql 格式（参考最新一条 migration 的 NNN+1）
- 表字段必须完整且带 NOT NULL 约束（`task_id` PRIMARY KEY，`platform` / `type` / `approval_status` 非空）
- 3 个 API 端点全部 zod 校验入参，错误返回 400 + 具体字段名
- agent handler 注册必须能被现有 zenithjoy-agent 路由表识别（grep 验证）

**验证命令**：

```bash
# === Happy path 1: migration 跑通且表结构正确 ===
psql cecelia -c "\d wechat_publish_task" 2>&1 | grep -E "task_id|platform|type|approval_status|rate_limit_status|receipt_status" \
  && echo "PASS: wechat_publish_task 表 6 个核心字段齐" \
  || (echo "FAIL: wechat_publish_task 表字段缺失"; exit 1)

# === Happy path 2: API 端点存在且 zod 校验生效 ===
# 启动 API server
cd apps/api && npm run dev &
SERVER_PID=$!
sleep 3
# 缺字段应该 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/wechat/qr-bind \
  -H "Content-Type: application/json" -d '{}')
kill $SERVER_PID
[ "$STATUS" = "400" ] && echo "PASS: qr-bind 缺字段返回 400" \
  || (echo "FAIL: 期望 400，实际 $STATUS"; exit 1)

# === Happy path 3: agent handler 注册 ===
grep -rE "wechat-rpa|wechat_qr_bind|wechat_send_(chat|moment)|wechat_listen_start" \
  services/agent/src/handlers/ services/agent/src/index.ts \
  | tee /dev/stderr | wc -l | awk '{ if ($1 < 4) { print "FAIL: handler 注册不全（期望 ≥4 个引用）"; exit 1 } else { print "PASS: handler 注册 " $1 " 处" } }'

# === 边界 1: 不存在 task 返回 404 ===
cd apps/api && npm run dev &
sleep 3
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3000/api/wechat/draft-review-poll?task_id=nonexistent-uuid")
kill %1
[ "$STATUS" = "404" ] && echo "PASS: 不存在 task 404" \
  || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)

# === 防作弊: handler 不能是 stub-only（必须 spawn Python 子进程的真实代码） ===
grep -A 30 "wechat-rpa" services/agent/src/handlers/wechat-rpa.ts \
  | grep -E "spawn|execFile|child_process" \
  && echo "PASS: handler 含真 spawn 调用" \
  || (echo "FAIL: handler 未见 spawn — 是空 stub"; exit 1)
```

---

### ws2: 个微扫码绑号 + 飞书 Bitable 4 表 + Dashboard 入口

**行为描述**：
- Python `qr_bind.py` 实现：启动 PC 微信客户端 → 等弹码 → 等扫码成功 → 输出 JSON `{"ok": true, "wechat_id": "...", "nickname": "..."}` 或 `{"ok": false, "reason": "wechat_not_running|..."}`
- NodeJS handler 接到 `wechat_qr_bind` task → spawn `qr_bind.py` → 把输出回报中台 → 中台写 `agent_platform_sessions`（platform=wechat_personal, status=bound）
- 飞书 Bitable 4 表自动初始化：客户档案 / 营销画像 / 内容排期 / 互动记录（schema 见 PRD），通过飞书 OpenAPI `app_table_create` 在客户已绑定的飞书空间内创建
- Dashboard `apps/dashboard/src/pages/AgentMachines.tsx`（或对应页面）新增"绑定微信"按钮 + 通道下拉（thin 仅"个人微信"选项，企微选项 disabled 显示"加厚阶段开放"）

**硬阈值**：
- `qr_bind.py` 必须支持 `--dryrun` 参数（CI 用），dryrun 时不真启微信，输出 mock JSON `{"ok": true, "wechat_id": "test_wechat_001", "nickname": "测试号", "dryRun": true}`
- 飞书 4 表全部建成（缺一张视为失败）
- Dashboard 按钮存在且通道下拉有"个人微信"选项

**验证命令**：

```bash
# === Happy path 1: qr_bind.py dryrun 输出格式正确 ===
ssh rog-xian "cd C:/zenithjoy-agent && python services/agent/wechat-rpa/qr_bind.py --dryrun" \
  | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL: ok 不为 true'
assert out.get('dryRun') is True, 'FAIL: 缺 dryRun:true 标记'
assert out.get('wechat_id'), 'FAIL: 缺 wechat_id'
assert out.get('nickname'), 'FAIL: 缺 nickname'
print('PASS: qr_bind dryrun 输出格式正确 wechat_id=' + out['wechat_id'])
"

# === Happy path 2: 飞书 4 表实创（真调飞书 API） ===
source ~/.credentials/feishu.env
node -e "
const {createPath4Bitables} = require('./apps/api/src/services/feishu-bitable');
(async () => {
  const result = await createPath4Bitables({appId: process.env.FEISHU_TEST_APP_ID});
  const expected = ['客户档案', '营销画像', '内容排期', '互动记录'];
  for (const name of expected) {
    if (!result.tables.find(t => t.name === name)) {
      console.error('FAIL: 缺表 ' + name);
      process.exit(1);
    }
  }
  console.log('PASS: 飞书 4 表全部创建');
})();
"

# === Happy path 3: Dashboard 按钮存在 ===
cd apps/dashboard && npx playwright test e2e/wechat-bind-button.spec.ts \
  && echo "PASS: Dashboard 绑微信按钮 + 通道下拉 e2e 通过" \
  || (echo "FAIL: Dashboard e2e 失败"; exit 1)

# === 边界 1: 微信客户端未装时报错码 ===
ssh rog-xian "cd C:/zenithjoy-agent && python services/agent/wechat-rpa/qr_bind.py --simulate-no-wechat" \
  | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False, 'FAIL: 期望 ok:false'
assert out.get('reason') == 'wechat_not_running', 'FAIL: reason 不对 ' + str(out.get('reason'))
print('PASS: 未装微信时正确报错 wechat_not_running')
"

# === 防作弊 1: 飞书表必须含 PRD 规定的字段（不能空表） ===
node -e "
const {getPath4BitableSchema} = require('./apps/api/src/services/feishu-bitable');
const s = getPath4BitableSchema();
const customerFields = s['客户档案'].fields.map(f => f.name);
const required = ['客户名', '微信号', '行业'];
for (const r of required) {
  if (!customerFields.includes(r)) { console.error('FAIL: 客户档案缺字段 ' + r); process.exit(1); }
}
console.log('PASS: 客户档案 schema 含必备字段');
"

# === 防作弊 2: Dashboard 按钮必须真渲染（不是 hidden 元素） ===
cd apps/dashboard && npx playwright test e2e/wechat-bind-button.spec.ts --grep "visible" \
  && echo "PASS: 绑微信按钮真可见可点击" \
  || (echo "FAIL: 按钮可能 hidden"; exit 1)
```

---

### ws3: DeepSeek 私聊回复草稿 + wxauto4 监听 + 写飞书互动记录

**行为描述**：
- Python `listen_chat.py` 实现：wxauto4 GetAllMessage 轮询好友私信 → 校验发送者在飞书"客户档案"表名单内（不在则丢弃）→ POST 到中台 `/api/wechat/draft-generate`
- 中台 `/api/wechat/draft-generate` 端点：拼对话历史（最近 10 轮）+ 营销画像 prompt → 调 OpenRouter DeepSeek (`deepseek/deepseek-chat`) → 草稿写入飞书"互动记录"表，状态 `pending_review`
- OpenRouter 调用封装 `apps/api/src/llm/openrouter.ts` 新增（如不存在），从 `~/.credentials/openrouter.env` 读 `OPENROUTER_API_KEY`，model 默认 `deepseek/deepseek-chat`，超时 30s

**硬阈值**：
- `listen_chat.py` 必须支持 `--dryrun --inject-message='{"sender":"客户A","content":"在吗"}'` CI 模式（不真启 wxauto4）
- 名单内消息 → 写飞书（互动记录表行数 +1）；名单外消息 → 不写（行数不变）
- DeepSeek 调用真实进行（非 mock），cost 记录到日志
- 失败（OpenRouter 5xx / timeout）→ 飞书表写"AI 生成失败"占位 + 状态 `pending_review` + 失败原因字段

**验证命令**：

```bash
# === Happy path 1: 名单内客户消息触发草稿生成 ===
source ~/.credentials/openrouter.env
# 准备测试客户在飞书名单
node apps/api/scripts/seed-feishu-customer.js --name="客户A" --wechat_id="test_a"

# 触发 dryrun 模拟消息进入
ssh rog-xian "python services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{\"sender\":\"客户A\",\"wechat_id\":\"test_a\",\"content\":\"在吗\"}'"

# 等中台处理（max 10s）
sleep 10
# 查飞书互动记录表是否新增草稿
ROWS=$(node apps/api/scripts/count-feishu-interaction.js --customer="客户A" --status="pending_review")
[ "$ROWS" -ge "1" ] && echo "PASS: 名单内客户消息触发草稿，pending_review 行数=$ROWS" \
  || (echo "FAIL: 草稿未生成"; exit 1)

# === Happy path 2: DeepSeek 真调用（验证 cost 落在合理区间） ===
LOG_TAIL=$(tail -50 apps/api/logs/llm.log | grep "openrouter.*deepseek-chat" | tail -1)
echo "$LOG_TAIL" | grep -E "cost.*0\.0[0-9]+|tokens.*[0-9]+" \
  && echo "PASS: DeepSeek 真调用且 cost 落在合理区间" \
  || (echo "FAIL: 未见 OpenRouter DeepSeek 调用日志或 cost 异常"; exit 1)

# === 边界 1: 名单外好友消息丢弃 ===
BEFORE=$(node apps/api/scripts/count-feishu-interaction.js)
ssh rog-xian "python services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{\"sender\":\"陌生人\",\"wechat_id\":\"unknown_x\",\"content\":\"嗨\"}'"
sleep 5
AFTER=$(node apps/api/scripts/count-feishu-interaction.js)
[ "$BEFORE" = "$AFTER" ] && echo "PASS: 名单外消息未写飞书 (before=after=$BEFORE)" \
  || (echo "FAIL: 名单外消息泄漏到飞书"; exit 1)

# === 边界 2: OpenRouter 5xx 时写"AI 生成失败" ===
# 注入故障开关（test 环境支持）
OPENROUTER_FORCE_5XX=1 ssh rog-xian "python services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{\"sender\":\"客户A\",\"wechat_id\":\"test_a\",\"content\":\"测试故障\"}'"
sleep 10
ROW=$(node apps/api/scripts/get-feishu-interaction.js --customer="客户A" --latest)
echo "$ROW" | grep "AI 生成失败" \
  && echo "PASS: OpenRouter 故障时写占位文案" \
  || (echo "FAIL: 故障 fallback 未生效"; exit 1)

# === 防作弊 1: AI 生成的草稿状态必须是 pending_review (不能是 approved 或 published) ===
NON_PENDING=$(node apps/api/scripts/count-feishu-interaction.js --status_in="approved,published")
[ "$NON_PENDING" = "0" ] && echo "PASS: ws3 不允许 AI 草稿越过 pending_review" \
  || (echo "FAIL: 发现 $NON_PENDING 条 AI 草稿越过 pending_review — A 路线护栏破了"; exit 1)

# === 防作弊 2: listen_chat.py 真调用了 wxauto4 (非纯 mock) ===
ssh rog-xian "grep -rE 'from wxauto4|import wxauto4|WeChat\\(\\)' services/agent/wechat-rpa/listen_chat.py" \
  && echo "PASS: listen_chat.py 真 import wxauto4" \
  || (echo "FAIL: listen_chat.py 未见 wxauto4 — 可能假实现"; exit 1)
```

---

### ws4: DeepSeek 朋友圈文案草稿 + 写飞书内容排期 + 中台定时触发

**行为描述**：
- 中台定时器每日 09:00（客户机时区）调 `POST /api/wechat/scheduler-tick`，对所有已绑微信的客户生成今日朋友圈草稿
- 端点逻辑：拼客户的"营销画像"3 字段 + 硬编码 prompt → 调 OpenRouter DeepSeek → 文案草稿写飞书"内容排期"表，状态 `pending_review`
- 营销画像未填齐（任一字段为空）→ 跳过该客户 + 在 `internal_logs` 表记 `画像未配置`，**不**写飞书占位
- 同一客户当日已生成过草稿 → 不重复（按 created_at 当日去重）

**硬阈值**：
- 调度器使用 cron 表达式 `0 9 * * *`（与现有 zenithjoy 调度器对齐 — 看 apps/api/src/services/scheduler.ts 已有的实现）
- DeepSeek prompt 必须包含 3 个画像字段且能从草稿内容反查（grep 验证）
- 当日去重：第二次手动触发同一客户应返回 `skipped: already_generated_today`

**验证命令**：

```bash
# === Happy path 1: 手动触发 scheduler-tick 生成草稿 ===
source ~/.credentials/openrouter.env
# 准备已配置画像的测试客户
node apps/api/scripts/seed-feishu-profile.js --customer="客户A" \
  --industry="美妆代购" --audience="25-35女性白领" --hook="正品保障+免税价"

# 触发
TICK_RES=$(curl -s -X POST localhost:3000/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" -d '{"force": true}')
echo "$TICK_RES" | grep -E "generated.*[1-9]|customers.*[1-9]" \
  && echo "PASS: scheduler-tick 触发并生成草稿" \
  || (echo "FAIL: scheduler-tick 未生成草稿: $TICK_RES"; exit 1)

# === Happy path 2: 飞书内容排期表收到草稿 ===
sleep 5
ROWS=$(node apps/api/scripts/count-feishu-schedule.js --status="pending_review" --date_today)
[ "$ROWS" -ge "1" ] && echo "PASS: 飞书内容排期 pending_review 行数=$ROWS" \
  || (echo "FAIL: 飞书排期表无草稿"; exit 1)

# === Happy path 3: 草稿真用了画像字段 ===
LATEST_DRAFT=$(node apps/api/scripts/get-feishu-schedule.js --customer="客户A" --latest --field=content)
echo "$LATEST_DRAFT" | grep -E "美妆|代购|免税|正品|白领|女性" \
  && echo "PASS: 草稿包含画像关键词" \
  || (echo "FAIL: 草稿与画像无关 — 可能 prompt 没拼或 LLM 跑飞: $LATEST_DRAFT"; exit 1)

# === 边界 1: 画像未配置时跳过 ===
node apps/api/scripts/seed-feishu-profile.js --customer="客户B" --industry="" --audience="" --hook=""
TICK_RES=$(curl -s -X POST localhost:3000/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" -d '{"force": true, "customer": "客户B"}')
echo "$TICK_RES" | grep -E "skipped.*画像未配置|skipped.*profile_missing" \
  && echo "PASS: 画像未配置正确跳过" \
  || (echo "FAIL: 应跳过却生成了: $TICK_RES"; exit 1)

# === 边界 2: 同日重复触发返回 skipped ===
TICK_RES=$(curl -s -X POST localhost:3000/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" -d '{"force": true, "customer": "客户A"}')
echo "$TICK_RES" | grep -E "skipped.*already_generated_today|already.*today" \
  && echo "PASS: 当日重复触发正确去重" \
  || (echo "FAIL: 当日重复应跳过却生成了: $TICK_RES"; exit 1)

# === 防作弊 1: cron 表达式严格对齐 09:00 ===
grep -rE "scheduler.*0 9 \* \* \*|cron.*'0 9 \* \* \*'" apps/api/src/services/ \
  && echo "PASS: cron 0 9 * * * 注册" \
  || (echo "FAIL: 未见 0 9 * * * cron 表达式"; exit 1)

# === 防作弊 2: 草稿状态必须 pending_review (A 路线护栏) ===
NON_PENDING=$(node apps/api/scripts/count-feishu-schedule.js --status_in="approved,published")
[ "$NON_PENDING" = "0" ] && echo "PASS: ws4 不允许草稿越过 pending_review" \
  || (echo "FAIL: 发现 $NON_PENDING 条朋友圈草稿越过 pending_review"; exit 1)
```

---

### ws5: 飞书审批轮询 + Python wechat_rpa 真发 + 频控保护

**行为描述**：
- 中台 `POST /api/wechat/draft-review-poll`（30 秒一次轮询调度器触发）：拉取飞书"内容排期"+"互动记录"表中状态 `approved` 的草稿 → 校验频控 → 派 task_dispatch 给客户机的 zenithjoy-agent
- Python `send_chat.py`：spawn 后接受 stdin JSON `{"target": "客户A", "wechat_id": "test_a", "message": "..."}` → pyautogui 控制 PC 微信搜索联系人 → 粘贴 → 发送 → 输出 JSON `{"ok": true, "sent_at": "..."}` 或失败
- Python `send_moment.py`：spawn 后接受 stdin JSON `{"content": "...", "visible_group": "AI 测试"}` → pyautogui 真发朋友圈到指定可见分组
- Python `rate_limiter.py`：基于 SQLite（客户机本地 `~/.zenithjoy-agent/rate_limit.db`）记录每号每动作的发送时间，提供 `can_send(action, wechat_id) -> bool, reason`
- 频控硬编码上限：朋友圈 ≤1/24h/号、私聊 ≤2/分钟/号、≤50/天/号、单次操作间隔 ≥1s、主动发起新会话 = 0
- 所有 Python 脚本必须支持 `REAL_PUBLISH=0` 环境变量（dryrun，不真触发 pyautogui，输出 mock 成功 JSON）

**硬阈值**：
- 30 秒轮询间隔（与既有 zenithjoy 飞书 webhook fallback 轮询一致）
- 飞书表 approved → 中台必须在 60 秒内派出 task_dispatch（≤2 个轮询周期）
- 频控超限 → 状态 `rate_limited` + 下次允许时间字段（不排队不重试）
- REAL_PUBLISH=0 时所有 send_*.py 必须不真调 pyautogui（grep 校验）

**验证命令**：

```bash
# === Happy path 1: 飞书 approved 触发派发 ===
# 准备 1 条 pending_review 草稿
SCHED_ID=$(node apps/api/scripts/seed-feishu-schedule.js --customer="客户A" --content="今日朋友圈测试" --status="pending_review")
# 模拟客户在飞书改状态
node apps/api/scripts/update-feishu-schedule.js --id="$SCHED_ID" --status="approved"
# 触发轮询
curl -s -X POST localhost:3000/api/wechat/draft-review-poll
sleep 5
# 校验 task_dispatch 已派
DISPATCH_LOG=$(tail -50 services/agent/logs/dispatch.log | grep "wechat_send_moment" | tail -1)
echo "$DISPATCH_LOG" | grep -E "task_id.*$SCHED_ID|wechat_send_moment" \
  && echo "PASS: approved 草稿在 5s 内被派发" \
  || (echo "FAIL: approved 未触发 task_dispatch"; exit 1)

# === Happy path 2: send_moment.py REAL_PUBLISH=0 dryrun ===
RESULT=$(ssh rog-xian "cd C:/zenithjoy-agent && \
  REAL_PUBLISH=0 echo '{\"content\":\"测试朋友圈\",\"visible_group\":\"AI 测试\"}' | \
  python services/agent/wechat-rpa/send_moment.py")
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL: ok 不为 true'
assert out.get('dryRun') is True, 'FAIL: 缺 dryRun:true 标记'
assert out.get('sent_at'), 'FAIL: 缺 sent_at'
print('PASS: send_moment dryrun 输出正确')
"

# === Happy path 3: send_chat.py REAL_PUBLISH=0 dryrun ===
RESULT=$(ssh rog-xian "cd C:/zenithjoy-agent && \
  REAL_PUBLISH=0 echo '{\"target\":\"客户A\",\"wechat_id\":\"test_a\",\"message\":\"嗨\"}' | \
  python services/agent/wechat-rpa/send_chat.py")
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL: ok 不为 true'
assert out.get('dryRun') is True, 'FAIL: 缺 dryRun 标记'
print('PASS: send_chat dryrun 输出正确')
"

# === 边界 1: 朋友圈频控 (24h 内已发 1 条则拒绝第 2 条) ===
ssh rog-xian "python services/agent/wechat-rpa/rate_limiter.py reset --wechat_id=test_a"
# 第一条
ssh rog-xian "REAL_PUBLISH=0 echo '{\"content\":\"first\"}' | python services/agent/wechat-rpa/send_moment.py"
# 第二条应拒绝
RESULT=$(ssh rog-xian "REAL_PUBLISH=0 echo '{\"content\":\"second\"}' | python services/agent/wechat-rpa/send_moment.py")
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False, 'FAIL: 应拒绝却成功'
assert out.get('reason') == 'rate_limited', 'FAIL: reason 不对'
assert out.get('next_allowed_at'), 'FAIL: 缺 next_allowed_at'
print('PASS: 朋友圈 24h 频控生效')
"

# === 边界 2: 私聊频控 (1 分钟 ≤2 条) ===
ssh rog-xian "python services/agent/wechat-rpa/rate_limiter.py reset --wechat_id=test_a"
for i in 1 2; do
  ssh rog-xian "REAL_PUBLISH=0 echo '{\"target\":\"客户A\",\"wechat_id\":\"test_a\",\"message\":\"msg$i\"}' | python services/agent/wechat-rpa/send_chat.py" > /dev/null
done
# 第三条应拒绝
RESULT=$(ssh rog-xian "REAL_PUBLISH=0 echo '{\"target\":\"客户A\",\"wechat_id\":\"test_a\",\"message\":\"msg3\"}' | python services/agent/wechat-rpa/send_chat.py")
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False, 'FAIL: 第3条私聊应拒绝'
assert out.get('reason') == 'rate_limited', 'FAIL: reason 不对'
print('PASS: 私聊分钟级频控生效')
"

# === 边界 3: rejected 草稿不派 ===
SCHED_ID=$(node apps/api/scripts/seed-feishu-schedule.js --content="不该发的" --status="pending_review")
node apps/api/scripts/update-feishu-schedule.js --id="$SCHED_ID" --status="rejected"
curl -s -X POST localhost:3000/api/wechat/draft-review-poll
sleep 3
DISPATCH=$(tail -50 services/agent/logs/dispatch.log | grep "$SCHED_ID")
[ -z "$DISPATCH" ] && echo "PASS: rejected 草稿未派发" \
  || (echo "FAIL: rejected 草稿被派发: $DISPATCH"; exit 1)

# === 防作弊 1: REAL_PUBLISH=0 时 send_*.py 不能真调 pyautogui ===
RESULT=$(ssh rog-xian "cd C:/zenithjoy-agent && \
  REAL_PUBLISH=0 PYAUTOGUI_DEBUG=1 echo '{\"content\":\"x\",\"visible_group\":\"AI 测试\"}' | \
  python services/agent/wechat-rpa/send_moment.py 2>&1")
echo "$RESULT" | grep -E "pyautogui\.click|pyautogui\.write|pyautogui\.press|pyautogui\.hotkey" \
  && (echo "FAIL: REAL_PUBLISH=0 时 send_moment 真调了 pyautogui — 防作弊破"; exit 1) \
  || echo "PASS: REAL_PUBLISH=0 时 send_moment 未调 pyautogui"

# === 防作弊 2: 频控逻辑必须真持久化（不能纯内存） ===
ssh rog-xian "test -f C:/Users/Administrator/.zenithjoy-agent/rate_limit.db" \
  && echo "PASS: rate_limit.db 真持久化文件存在" \
  || (echo "FAIL: rate_limit.db 不存在 — 频控可能纯内存（重启绕过）"; exit 1)

# === 防作弊 3: 主动发起新会话 = 0 (thin 阶段) ===
grep -rE "send_first_message|initiate_new_chat|主动发起" services/agent/wechat-rpa/ \
  && (echo "FAIL: 发现主动发起会话代码 — thin 阶段不允许"; exit 1) \
  || echo "PASS: 无主动发起新会话代码"
```

---

### ws6: golden-path-4-smoke.sh + Lead 自验 evidence + CI 防作弊校验

**行为描述**：
- 新建 `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`，端到端跑 Step 1-6（CI 默认 `REAL_PUBLISH=0`，Lead 自验 `REAL_PUBLISH=1`）
- smoke 脚本必须 step-by-step 输出 ✅/❌ 标记当前推进到 Step N，FAIL 退出码非 0
- Lead 自验 evidence 模板 `.agent-knowledge/path-4/lead-acceptance-sprint-1.md`（参考 `golden-path-1/lead-acceptance-sprint-2.1a.md` 格式）
- CI 注册：`test-registry.yaml` 加 ws1-ws6 测试文件 + `lint-feature-has-smoke` 检查 Path 4 改动必须含 smoke + `lint-tdd-commit-order` 检查 commit-1 是 test commit-2 是实现

**硬阈值**：
- smoke 脚本 6 个 step 全部必须真执行（不是 `echo 'Step N PASS'`）
- CI 默认绿（`REAL_PUBLISH=0`），Lead 真验时（`REAL_PUBLISH=1`）扫码后也必须绿
- evidence 模板必须有真扫码 / 真发 / 真审 3 个证据章节

**验证命令**：

```bash
# === Happy path 1: smoke 脚本 dryrun 全绿 ===
REAL_PUBLISH=0 bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh \
  && echo "PASS: smoke dryrun 全绿" \
  || (echo "FAIL: smoke dryrun 失败"; exit 1)

# === Happy path 2: smoke 脚本必须真跑 6 个 step (输出含 Step 1-6 标记) ===
OUTPUT=$(REAL_PUBLISH=0 bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1)
for step in 1 2 3 4 5 6; do
  echo "$OUTPUT" | grep -E "Step $step.*✅|Step $step.*PASS" \
    || (echo "FAIL: Step $step 标记缺失"; exit 1)
done
echo "PASS: smoke 6 step 全部输出 ✅"

# === Happy path 3: evidence 模板存在且字段完整 ===
test -f .agent-knowledge/path-4/lead-acceptance-sprint-1.md \
  && grep -E "^## (Checklist|Evidence|真扫码|真发|真审)" .agent-knowledge/path-4/lead-acceptance-sprint-1.md \
  && echo "PASS: evidence 模板存在且字段完整" \
  || (echo "FAIL: evidence 模板缺失或字段不全"; exit 1)

# === Happy path 4: CI 注册到 test-registry.yaml ===
for ws in ws1 ws2 ws3 ws4 ws5 ws6; do
  grep -E "tests/$ws/" test-registry.yaml \
    || (echo "FAIL: $ws 未注册到 test-registry.yaml"; exit 1)
done
echo "PASS: ws1-ws6 全部注册到 test-registry.yaml"

# === 边界 1: smoke 脚本中途失败时退出码非 0 ===
# 故意制造 Step 3 失败（让 OpenRouter key 临时无效）
OPENROUTER_API_KEY=invalid_test_key REAL_PUBLISH=0 \
  bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
[ $? -ne 0 ] && echo "PASS: smoke 中途失败正确退出" \
  || (echo "FAIL: smoke 该失败却退 0"; exit 1)

# === 防作弊 1: smoke 不允许 echo 占位 ===
PLACEHOLDER=$(grep -E "^echo '?Step.*PASS'?$|^echo '?✅'?$" .github/workflows/scripts/smoke/golden-path-4-smoke.sh | wc -l)
[ "$PLACEHOLDER" = "0" ] && echo "PASS: smoke 无 echo 占位行" \
  || (echo "FAIL: 发现 $PLACEHOLDER 行 echo 占位 — smoke 没真跑"; exit 1)

# === 防作弊 2: lint-feature-has-smoke 注册校验 Path 4 ===
grep -E "golden-path-4-smoke|path-4|wechat-rpa" .github/workflows/lint-*.yml \
  && echo "PASS: lint-feature-has-smoke 含 Path 4 检查" \
  || (echo "FAIL: lint 未注册 Path 4"; exit 1)

# === 防作弊 3: tdd-commit-order 校验 ws1-ws6 commit 1 是 test ===
for ws in ws1 ws2 ws3 ws4 ws5 ws6; do
  FIRST_COMMIT=$(git log --reverse --oneline --grep="$ws" | head -1)
  echo "$FIRST_COMMIT" | grep -E "test\($ws\)|test\(.*$ws\)" \
    || (echo "FAIL: $ws 第一个 commit 不是 test commit: $FIRST_COMMIT"; exit 1)
done
echo "PASS: ws1-ws6 commit 1 全部是 test (RED) commit"

# === 防作弊 4: Lead 自验机器必须是 rog-xian (不能 mock) ===
grep "rog-xian" .agent-knowledge/path-4/lead-acceptance-sprint-1.md \
  && grep -E "Tailscale 100\.98\.253\.95|hostname.*XX-ROG" .agent-knowledge/path-4/lead-acceptance-sprint-1.md \
  && echo "PASS: evidence 锁定 rog-xian 真机" \
  || (echo "FAIL: evidence 未锁 rog-xian"; exit 1)
```

---

## 技术实现方向（高层）

### 数据库
- migration NNN_create_wechat_publish_task.sql：UUID 主键 + 状态枚举（pending_review/approved/published/failed/rate_limited/rejected）+ 频控字段（next_allowed_at）
- 不修改现有 publish_tasks 表（Path 1 抖音用），新表独立避免污染

### LLM 调用
- 新建 `apps/api/src/llm/openrouter.ts`：标准 fetch POST `https://openrouter.ai/api/v1/chat/completions`，model `deepseek/deepseek-chat`，从 `~/.credentials/openrouter.env` 读 key（生产从 GitHub Secret），cost/token 记日志
- 失败重试：超时 30s，5xx 1 次重试，仍失败写飞书"AI 生成失败"占位

### Agent 协议
- 复用 zenithjoy-agent 现有 SSE / task / progress / receipt 协议（Path 1 已成熟）
- 新增 task type：`wechat_qr_bind` / `wechat_listen_start` / `wechat_send_chat` / `wechat_send_moment`
- handler `wechat-rpa.ts`：从 task.payload 取 type → spawn 对应 Python 脚本（参数从 stdin JSON 传入）→ 子进程 stdout JSON 作为 receipt

### Python 子进程
- 单文件单职责：qr_bind / listen_chat / send_chat / send_moment / rate_limiter / find_weixin
- 共享 `rate_limiter.py` 通过 SQLite (`~/.zenithjoy-agent/rate_limit.db`) 跨脚本协调频控
- `REAL_PUBLISH=0` 环境变量统一 dryrun 入口（CI / 早期开发）
- 不直接 import xian-pc 桌面 PoC 文件（避免 MiniMax key 泄漏）

### 飞书 Bitable
- 复用 Path 2 的 OAuth 框架（apps/api/src/services/feishu-bitable.ts 现已 work）
- 4 张表名固定（中文）：客户档案 / 营销画像 / 内容排期 / 互动记录
- schema 在代码中定义（`getPath4BitableSchema`）+ `createPath4Bitables` 创建函数

### 频控
- 硬编码上限写在 `services/agent/wechat-rpa/rate_limiter.py` 顶部常量（thin 阶段不做配置化）
- SQLite 表：`sends (id INTEGER PK, wechat_id TEXT, action TEXT, sent_at TIMESTAMP)`
- `can_send(action, wechat_id)` 查窗口期内计数 → 比对上限

---

## 不在本次范围内

- 多号矩阵 / 主动 outreach / 完全自主 AI agent（medium+ 才上）
- 朋友圈带图 / 视频内容（图先放飞书让客户填，AI 后续接 Path 1 Stage 4 图生成 — thicken 阶段）
- 客户分群 / 标签自动化（thin 手填 SSOT）
- 实时增量好友同步（thin 一次性手动全量）
- 朋友圈点赞 / 评论 / 主动私聊新好友
- 跨平台联动（不接抖音、不接小红书）
- 高可用 / supervisor / 自动重连（thin 手动重启）
- 凭据下发服务（thin 手动写客户机 `.env`）
- 漏消息补抓 / 历史回填（thin 只处理 Agent 在线期间消息）
- 多客户场景 / SaaS 化部署（thin 单 Lead 单客户机自验）
- 个微号被封后的恢复方案（thin 阶段封了就换号，加厚阶段才设计养号）
- Path 4B 客户私域维护（4A 完成后的下一条 sprint）

---

## journey_type: user_facing
## journey_type_reason: 起点 apps/dashboard/，UI 起点最靠前；Notion Journey Type 一致

## Lead 自验机：rog-xian (Tailscale 100.98.253.95, hostname XX-ROG, Windows)

## Workstream DAG（线性，每 ws 单独 PR）：
ws1（基础设施）→ ws2（绑号 + 飞书表 + Dashboard）→ ws3（私聊草稿）→ ws4（朋友圈草稿）→ ws5（审批 + 真发 + 频控）→ ws6（smoke + evidence + CI）
