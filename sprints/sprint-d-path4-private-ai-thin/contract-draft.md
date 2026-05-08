# Sprint 1 合同草案（第 2 轮 — 修订自 r1 反馈 16 must-fix + 4 optional）

> Sprint: Path 4 客户私域 AI 接管 — Sprint 1（thin 第一刀 / skeleton 贯穿）
> PRD: `sprints/sprint-d-path4-private-ai-thin/sprint-prd.md`
> Journey: Path 4 (Notion `35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`)
> Maturity: not_started → skeleton

---

## 全局事实（修订自 r1 反馈，已实证）

| 项 | 事实 | 实证来源 |
|---|---|---|
| DB 名 | `cecelia`（zenithjoy 与 cecelia 共享 brain DB） | `apps/api/src/db/connection.ts: database: process.env.DATABASE_NAME \|\| 'cecelia'` |
| API 端口 | `5200`（process.env.PORT 默认） | `apps/api/src/index.ts: const PORT = process.env.PORT \|\| 5200` |
| Migration 目录 | `apps/api/db/migrations/`（不是 src/migrations） | `find apps/api -name "*.sql"` |
| Migration 命名 | `YYYYMMDD_HHMMSS_<name>.sql`（如 `20260508_014306_publish_tasks_add_type.sql`） | 既往 5 条 migration |
| rog-xian USER | `asus`（不是 Administrator），USERPROFILE = `C:\Users\asus` | `ssh rog-xian "echo %USERNAME% %USERPROFILE%"` |
| rog agent 路径 | `C:\Users\asus\zenithjoy-agent\`（已部署，含 .env / build/ / publishers/ / install-and-start.bat） | `ssh rog-xian "dir %USERPROFILE%\zenithjoy-agent /b"` |

**所有 ssh rog-xian 命令统一前缀**：`cd %USERPROFILE%\\zenithjoy-agent && ...`（CMD shell）或 `cd $USERPROFILE/zenithjoy-agent && ...`（如果 ssh 落入 git-bash）。

---

## Workstream DAG（依赖关系，r1 反馈 #14 修订）

```
ws1（基础设施 — DB + 路由 + Agent 协议 + LLM audit + 部署 script）
    ↓
ws2（绑号 + 飞书 4 表 + Dashboard 入口 + 8 个 fixture script）
    ↓
ws3（私聊草稿，依赖 ws1+ws2）   ws4（朋友圈草稿，依赖 ws1+ws2）
    ↓ ←————— 可并行实现，但合并顺序 ws3 先 ws4 后 ——————↓
                ws5（审批轮询 + 真发 + 频控）
                          ↓
                ws6（smoke + evidence + CI 防作弊）
```

**强制依赖**：ws6 验证只能在 ws1-5 全部 PR 已合且 dryrun 通过后跑（CI workflow 用 `needs: [ws1, ws2, ws3, ws4, ws5]` enforce）。

---

## 本次实现的功能

- **ws1** DB schema + 中台路由 + Agent 协议扩展 + LLM audit DB + rog 部署脚本（基础设施）
- **ws2** 个微扫码绑号 + 飞书 Bitable 4 表自动初始化 + Dashboard 绑微信入口 + 8 个 fixture script
- **ws3** DeepSeek 私聊回复草稿生成 + wxauto4 监听 + 写飞书互动记录
- **ws4** DeepSeek 朋友圈文案草稿生成 + 写飞书内容排期 + 中台定时触发（server 时区）
- **ws5** 飞书审批轮询 + Python wechat_rpa 真发（朋友圈/私聊）+ 频控保护硬编码上限（含并发安全）
- **ws6** golden-path-4-smoke.sh + Lead 自验 evidence 模板（含真实证据强校验）+ CI 防作弊校验

---

## 验收标准（DoD）

### ws1: DB schema + 中台路由 + Agent 协议扩展 + LLM audit + rog 部署脚本

**行为描述**：

1. 新建 migration `apps/api/db/migrations/20260508_<HHMMSS>_create_wechat_publish_task.sql`：
   - 表 `wechat_publish_task`：`task_id UUID PRIMARY KEY`，`platform TEXT NOT NULL DEFAULT 'wechat_personal'`（CHECK in `('wechat_personal')`），`type TEXT NOT NULL`（CHECK in `('moment','chat')`），`target_user TEXT`（type=chat 时非空），`content_draft TEXT NOT NULL`，`approval_status TEXT NOT NULL DEFAULT 'pending_review'`（CHECK in `('pending_review','approved','rejected','published','failed','rate_limited')`），**`approval_source TEXT`**（CHECK in `('feishu_user','feishu_api')`，approval_status='approved' 时非空，**禁 system/auto，r1 #15 修订**），`rate_limit_status TEXT`，`next_allowed_at TIMESTAMPTZ`，`receipt_status TEXT`，`receipt_error TEXT`，`feishu_record_id TEXT`，`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`，`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - 表 `llm_audit`（**r1 #4 修订** — 替代不存在的 llm.log）：`id BIGSERIAL PK`，`provider TEXT NOT NULL`，`model TEXT NOT NULL`，`prompt_tokens INTEGER`，`completion_tokens INTEGER`，`cost NUMERIC(12,8)`，`request_purpose TEXT`，`error TEXT`，`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `agent_platform_sessions` 表加枚举值 `wechat_personal`（如类型校验在代码层而非 DB 层，则在 zod schema 加）

2. 中台 3 个端点（zod 校验入参，listen on PORT=5200）：
   - `POST /api/wechat/qr-bind`：req `{platform: 'wechat_personal', agent_id: string}` → resp `{task_id: UUID, status: 'dispatched'}`
   - `POST /api/wechat/draft-review-poll`：req 空，response `{polled: number, dispatched: number}`
   - `POST /api/wechat/scheduler-tick`：req `{force?: bool, customer?: string}` → resp `{generated: number, skipped: Array<{customer, reason}>}`

3. zenithjoy-agent 协议扩展：`services/agent/src/handlers/wechat-rpa.ts` 注册新 handler，task type 之一：`wechat_qr_bind` / `wechat_listen_start` / `wechat_send_chat` / `wechat_send_moment` → spawn Python 子进程（`services/agent/wechat-rpa/<file>.py`），传入 stdin JSON，从 stdout 读 JSON 作为 receipt

4. **OpenRouter 封装** `apps/api/src/llm/openrouter.ts`（**r1 #5 修订**）：
   - 标准 fetch POST `https://openrouter.ai/api/v1/chat/completions`，model `deepseek/deepseek-chat`
   - 从 `~/.credentials/openrouter.env` 读 `OPENROUTER_API_KEY`（生产从 GitHub Secret）
   - 调用成功 → 写 `llm_audit` 表（成本/token 记账）
   - 失败重试：超时 30s，5xx 1 次重试
   - **支持 `OPENROUTER_FORCE_5XX=1` 注入故障**（仅 NODE_ENV=test/development 生效，生产忽略）
   - **CI 模式（process.env.CI=='true'）**：`max_tokens=20`（避免烧钱，r1 #O3）

5. **rog 部署脚本** `scripts/deploy-agent-to-rog.sh`（**r1 #3 修订**）：
   - rsync `services/agent/` 到 rog `~/zenithjoy-agent/`（已确认路径存在）
   - 在 rog 上 `pip install -r services/agent/wechat-rpa/requirements.txt`
   - 写 rog `~/zenithjoy-agent/.env`（中台 URL + agent_id + 客户机字段）
   - 输出 ✅ DEPLOYED 或 ❌ FAILED + 原因

**硬阈值**：
- migration 必须真在 `apps/api/db/migrations/` 下，文件名格式 `YYYYMMDD_HHMMSS_*.sql`
- 表字段全部带 NOT NULL/CHECK 约束（关键字段不能 NULL）
- 3 端点 zod 校验，不合法返回 400 + 字段名
- agent handler 注册可被 spawn-test 跑通（端到端测试 dispatch 一个 wechat_qr_bind dryrun task → 子进程退出 0 + stdout JSON）

**验证命令**（修订自 r1 #1 #2 #4 #5 #8）：

```bash
# === Happy 1: migration 跑过且 wechat_publish_task 表 + approval_source 字段就位 ===
psql cecelia -c "\d wechat_publish_task" 2>&1 \
  | tee /tmp/ws1.schema.txt \
  | grep -E "approval_source.*text" \
  && grep -E "task_id|platform|type|approval_status|rate_limit_status|receipt_status|feishu_record_id" /tmp/ws1.schema.txt \
  && echo "PASS: wechat_publish_task 含 approval_source（A 路线护栏）+ 7 核心字段" \
  || (echo "FAIL: wechat_publish_task 缺字段或 approval_source 缺失"; exit 1)

# === Happy 2: llm_audit 表存在（替代不存在的 llm.log）===
psql cecelia -c "\d llm_audit" 2>&1 | grep -E "provider|model|prompt_tokens|cost" \
  && echo "PASS: llm_audit 表 4 核心字段齐" \
  || (echo "FAIL: llm_audit 缺字段"; exit 1)

# === Happy 3: API 端点存在（PORT=5200）+ zod 校验生效 ===
cd apps/api && npm run dev > /tmp/ws1.api.log 2>&1 &
SERVER_PID=$!
sleep 4
# 缺字段应该 400
STATUS=$(curl -s -o /tmp/ws1.qrbind.json -w "%{http_code}" \
  -X POST localhost:5200/api/wechat/qr-bind \
  -H "Content-Type: application/json" -d '{}')
ERR=$(cat /tmp/ws1.qrbind.json)
kill $SERVER_PID 2>/dev/null
[ "$STATUS" = "400" ] && echo "$ERR" | grep -E "platform|agent_id" \
  && echo "PASS: qr-bind 缺字段 400 + 错误信息含字段名" \
  || (echo "FAIL: 期望 400 + 字段名错误，实际 $STATUS / $ERR"; exit 1)

# === Happy 4: agent handler 真 spawn (运行时端到端测试，r1 #8 修订) ===
cd services/agent && npm test -- --testPathPattern=wechat-rpa.handler 2>&1 \
  | tee /tmp/ws1.handler.test.log \
  | grep -E "spawn.*qr_bind|child_process.*python.*qr_bind\.py" \
  && grep -E "PASS.*wechat_qr_bind dryrun" /tmp/ws1.handler.test.log \
  && echo "PASS: handler 端到端测试真 spawn Python 子进程且 receipt 正确" \
  || (echo "FAIL: handler 测试未真 spawn Python 或 receipt 错"; exit 1)

# === Happy 5: OpenRouter 封装支持 OPENROUTER_FORCE_5XX (r1 #5 修订) ===
NODE_ENV=test OPENROUTER_FORCE_5XX=1 node -e "
const {callOpenRouter} = require('./apps/api/src/llm/openrouter');
(async () => {
  try {
    await callOpenRouter({prompt: 'test'});
    console.error('FAIL: OPENROUTER_FORCE_5XX 未生效');
    process.exit(1);
  } catch (e) {
    if (!/5xx|503|simulated/.test(e.message)) {
      console.error('FAIL: 错误不是模拟 5xx: ' + e.message);
      process.exit(1);
    }
    console.log('PASS: OPENROUTER_FORCE_5XX=1 注入 5xx 故障生效');
  }
})();
"

# === Happy 6: 部署脚本可执行 ===
bash -n scripts/deploy-agent-to-rog.sh \
  && bash scripts/deploy-agent-to-rog.sh --check-only 2>&1 | grep -E "rog-xian.*reachable|target.*~/zenithjoy-agent" \
  && echo "PASS: deploy-agent-to-rog.sh 语法合法且 --check-only 探活通过" \
  || (echo "FAIL: 部署脚本不可用"; exit 1)

# === 边界 1: 不存在 task 返回 404 ===
cd apps/api && npm run dev > /tmp/ws1.api.log 2>&1 &
SERVER_PID=$!
sleep 4
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "localhost:5200/api/wechat/draft-review-poll?task_id=00000000-0000-0000-0000-000000000000")
kill $SERVER_PID 2>/dev/null
[ "$STATUS" = "404" ] && echo "PASS: 不存在 task 404" \
  || (echo "FAIL: 期望 404，实际 $STATUS"; exit 1)

# === 防作弊 1: approval_source CHECK 约束生效 ===
psql cecelia -c "INSERT INTO wechat_publish_task (task_id, type, content_draft, approval_status, approval_source) VALUES ('11111111-1111-1111-1111-111111111111', 'moment', 'test', 'approved', 'system')" 2>&1 \
  | grep -E "violates check constraint|invalid.*approval_source" \
  && echo "PASS: approval_source CHECK 拒绝 system 值" \
  || (echo "FAIL: approval_source 允许 system 写入 — A 路线护栏破"; exit 1)

# === 防作弊 2: CI 模式 max_tokens 限制 (r1 #O3) ===
CI=true node -e "
const {callOpenRouter} = require('./apps/api/src/llm/openrouter');
const captured = [];
const origFetch = global.fetch;
global.fetch = (url, opts) => { captured.push(JSON.parse(opts.body)); return Promise.resolve({ok:true,json:async()=>({choices:[{message:{content:'OK'}}],usage:{}})}); };
(async () => {
  await callOpenRouter({prompt: 'x'});
  global.fetch = origFetch;
  if (captured[0]?.max_tokens > 20) {
    console.error('FAIL: CI 模式 max_tokens=' + captured[0].max_tokens + ' > 20');
    process.exit(1);
  }
  console.log('PASS: CI 模式 max_tokens=' + captured[0]?.max_tokens + ' ≤ 20');
})();
"
```

---

### ws2: 个微扫码绑号 + 飞书 4 表 + Dashboard + 8 fixture script

**行为描述**：

1. **Python `qr_bind.py`**：启动 PC 微信客户端 → 等弹码 → 等扫码成功 → 输出 JSON `{"ok": true, "wechat_id": "...", "nickname": "..."}` 或失败 `{"ok": false, "reason": "wechat_not_running|..."}`
   - 必须支持 `--dryrun` 参数（CI 用，**在 Mac mini 也可跑**，不真启微信，输出 mock JSON `{"ok": true, "wechat_id": "test_wechat_001", "nickname": "测试号", "dryRun": true}`）
   - 必须支持 `--simulate-no-wechat` 模拟微信未装

2. NodeJS handler 接到 `wechat_qr_bind` task → spawn `qr_bind.py` → 把输出回报中台 → 中台写 `agent_platform_sessions`（platform=wechat_personal, status=bound）

3. **飞书 Bitable 4 表自动初始化** `apps/api/src/services/feishu-bitable.ts` 扩展：
   - 函数 `createPath4Bitables({appId, appToken})` → 创建 4 张表
   - schema：
     - **客户档案**: 字段 `客户名 / 微信号 / 行业 / 备注 / 加入日期`
     - **营销画像**: 字段 `行业 / 受众 / 钩子文案`（单行）
     - **内容排期**: 字段 `草稿 ID / 生成时间 / 文案 / 排期时间 / 状态`
     - **互动记录**: 字段 `客户名 / 客户原话 / AI 草稿 / 生成时间 / 状态 / 真发时间`
   - 函数 `getPath4BitableSchema()` 返回上述 schema 元数据

4. **Dashboard** `apps/dashboard/src/pages/AgentMachines.tsx`（或对应页面）：
   - 新增"绑定微信"按钮（每台已绑中台的 agent 机器一个）
   - 通道下拉：`个人微信`（thin 仅此选项）/`企业微信`（disabled, 显示 "加厚阶段开放"）
   - 点击 → 调 `POST /api/wechat/qr-bind` → 显示二维码（rog 屏幕 / 客户机屏幕 / Dashboard 嵌入图都行，thin 阶段最简单：toast "请在客户机扫码"）

5. **8 个 fixture script**（**r1 #13 修订**，全部支持 `--help`）：
   - `apps/api/scripts/seed-feishu-customer.js --name=<n> --wechat_id=<id>`
   - `apps/api/scripts/seed-feishu-profile.js --customer=<c> --industry=<i> --audience=<a> --hook=<h>`
   - `apps/api/scripts/seed-feishu-schedule.js --customer=<c> --content=<x> --status=<s>` → 输出 schedule_id
   - `apps/api/scripts/update-feishu-schedule.js --id=<id> --status=<s>`
   - `apps/api/scripts/count-feishu-interaction.js [--customer=<c>] [--status=<s>] [--status_in=a,b]`
   - `apps/api/scripts/count-feishu-schedule.js [--status=<s>] [--date_today]`
   - `apps/api/scripts/get-feishu-interaction.js --customer=<c> --latest [--field=<f>]`
   - `apps/api/scripts/get-feishu-schedule.js --customer=<c> --latest [--field=<f>]`

6. **Playwright UI 测试** `apps/dashboard/e2e/wechat-bind-button.spec.ts`：
   - 真模拟从打开 Dashboard → 找到 agent 机器卡片 → 点"绑定微信" → 通道选"个人微信" → 触发 API → 收到 task_id（**user_facing journey 入口完整链路，r1 #15 修订**）
   - case 1（visible）：按钮真渲染可见可点
   - case 2（happy）：点击后 API 返回 200 + task_id
   - case 3（disabled）：企微选项 disabled

**硬阈值**：
- qr_bind.py dryrun 在本机 Mac mini 也能跑（不依赖 Windows / 微信 PC 装）
- 飞书 4 表全部建成（缺一张 fail）
- 8 个 fixture script 全部支持 --help
- Dashboard playwright 3 case 全过

**验证命令**（修订自 r1 #3 #13 #15）：

```bash
# === Happy 1: qr_bind.py dryrun 在本机 Mac mini 跑通（r1 #3 修订）===
python3 services/agent/wechat-rpa/qr_bind.py --dryrun \
  | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL: ok 不为 true'
assert out.get('dryRun') is True, 'FAIL: 缺 dryRun'
assert out.get('wechat_id'), 'FAIL: 缺 wechat_id'
assert out.get('nickname'), 'FAIL: 缺 nickname'
print('PASS: qr_bind dryrun (本机) 输出 ' + out['wechat_id'])
"

# === Happy 2: 飞书 4 表实创（真调飞书 API） ===
source ~/.credentials/feishu.env
node -e "
const {createPath4Bitables} = require('./apps/api/src/services/feishu-bitable');
(async () => {
  const result = await createPath4Bitables({
    appId: process.env.FEISHU_TEST_APP_ID,
    appToken: process.env.FEISHU_TEST_APP_TOKEN
  });
  const expected = ['客户档案', '营销画像', '内容排期', '互动记录'];
  for (const name of expected) {
    if (!result.tables.find(t => t.name === name)) {
      console.error('FAIL: 缺表 ' + name);
      process.exit(1);
    }
  }
  console.log('PASS: 飞书 4 表全建');
})();
"

# === Happy 3: Dashboard playwright 3 case 全过（user_facing 入口完整链路） ===
cd apps/dashboard && npx playwright test e2e/wechat-bind-button.spec.ts \
  && echo "PASS: Dashboard 绑微信 e2e 3 case 通过（visible + happy + disabled）" \
  || (echo "FAIL: Dashboard e2e 失败"; exit 1)

# === Happy 4: 8 个 fixture script 全部 --help 通过（r1 #13）===
for s in seed-feishu-customer seed-feishu-profile seed-feishu-schedule update-feishu-schedule \
         count-feishu-interaction count-feishu-schedule get-feishu-interaction get-feishu-schedule; do
  node apps/api/scripts/${s}.js --help 2>&1 | grep -E "Usage|usage:" \
    || (echo "FAIL: $s 无 --help"; exit 1)
done
echo "PASS: 8 fixture script 全部含 --help"

# === 边界 1: 微信客户端未装时报错 ===
python3 services/agent/wechat-rpa/qr_bind.py --simulate-no-wechat \
  | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False, 'FAIL: 期望 ok:false'
assert out.get('reason') == 'wechat_not_running', 'FAIL: reason ' + str(out.get('reason'))
print('PASS: 未装微信正确报 wechat_not_running')
"

# === 防作弊 1: 客户档案 schema 字段全（r1 #B14 修订，5 字段不只 3）===
node -e "
const {getPath4BitableSchema} = require('./apps/api/src/services/feishu-bitable');
const s = getPath4BitableSchema();
const required = {客户档案:['客户名','微信号','行业','备注','加入日期'], 营销画像:['行业','受众','钩子文案'], 内容排期:['草稿 ID','生成时间','文案','排期时间','状态'], 互动记录:['客户名','客户原话','AI 草稿','生成时间','状态','真发时间']};
for (const [tbl, fields] of Object.entries(required)) {
  const got = s[tbl].fields.map(f => f.name);
  for (const f of fields) {
    if (!got.includes(f)) { console.error('FAIL: ' + tbl + ' 缺字段 ' + f); process.exit(1); }
  }
}
console.log('PASS: 4 表 schema 字段全');
"

# === 防作弊 2: Dashboard 按钮真渲染可见可点（r1 #15 user_facing 入口）===
cd apps/dashboard && npx playwright test e2e/wechat-bind-button.spec.ts --grep "visible" \
  && cd ../.. \
  && echo "PASS: 绑微信按钮真可见可点击" \
  || (echo "FAIL: 按钮 hidden 或不可点"; exit 1)
```

---

### ws3: DeepSeek 私聊回复草稿 + wxauto4 监听 + 写飞书互动记录

**行为描述**：

1. Python `listen_chat.py`：
   - **真 import wxauto4**，启动时调 `wxauto4.__version__` 写到 stderr（**r1 #9 修订**）
   - wxauto4 GetAllMessage 轮询好友私信 → 校验发送者在飞书"客户档案"表名单内（不在则丢弃）→ POST 到中台 `/api/wechat/draft-generate`
   - 支持 `--dryrun --inject-message='{"sender":"客户A","wechat_id":"test_a","content":"在吗"}'` CI 模式（不真启 wxauto4）

2. 中台 `POST /api/wechat/draft-generate`：拼对话历史（最近 10 轮）+ 营销画像 prompt → 调 OpenRouter DeepSeek → **草稿写飞书"互动记录"表，状态 `pending_review`，approval_source NULL（A 路线护栏起点）**

3. 失败处理：OpenRouter 5xx / timeout → 飞书表写"AI 生成失败"占位 + 失败原因 → 状态仍 `pending_review`（人审决定要不要重试）

4. **services/agent/wechat-rpa/__init__.py 必须存在 + 有严格 `__all__` 白名单**（**r1 #10 修订**）：
   ```python
   __all__ = ['qr_bind', 'listen_chat', 'send_chat', 'send_moment', 'rate_limiter', 'find_weixin']
   ```

**硬阈值**：
- 名单内消息 → 写飞书（互动记录表行数 +1）；名单外消息 → 不写
- AI 草稿状态必须 `pending_review` + `approval_source IS NULL`（A 路线护栏起点）
- DeepSeek 调用真实进行，cost 写 `llm_audit` 表（不是 log file）
- 失败 → 飞书写"AI 生成失败"占位 + `pending_review`

**验证命令**（修订自 r1 #4 #5 #9 #10 #15）：

```bash
# === Happy 1: 名单内客户消息触发草稿生成 ===
source ~/.credentials/openrouter.env
node apps/api/scripts/seed-feishu-customer.js --name="客户A" --wechat_id="test_a"

python3 services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{"sender":"客户A","wechat_id":"test_a","content":"在吗"}'
sleep 10
ROWS=$(node apps/api/scripts/count-feishu-interaction.js --customer="客户A" --status="pending_review")
[ "$ROWS" -ge "1" ] && echo "PASS: 名单内消息生成 pending_review 草稿 (rows=$ROWS)" \
  || (echo "FAIL: 草稿未生成"; exit 1)

# === Happy 2: DeepSeek 真调用 → cost 写 llm_audit 表（r1 #4 修订，从 DB 验证）===
COST_ROW=$(psql cecelia -t -c "SELECT model, cost, request_purpose FROM llm_audit WHERE provider='openrouter' AND model='deepseek/deepseek-chat' AND request_purpose='wechat_chat_draft' ORDER BY id DESC LIMIT 1")
echo "$COST_ROW" | grep -E "deepseek/deepseek-chat.*0\.0[0-9]+" \
  && echo "PASS: llm_audit 含 DeepSeek 真调用记录: $COST_ROW" \
  || (echo "FAIL: 未见 llm_audit 记录"; exit 1)

# === Happy 3: listen_chat.py 真 import wxauto4 + 输出真版本号到 stderr（r1 #9 修订）===
ssh rog-xian "cd %USERPROFILE%\\zenithjoy-agent && \
  python services/agent/wechat-rpa/listen_chat.py --dryrun-print-version 2>&1" \
  | grep -E "wxauto4 version: [0-9]+\.[0-9]+" \
  && echo "PASS: listen_chat.py 真 import wxauto4 输出真版本号" \
  || (echo "FAIL: 未见 wxauto4 真版本号 — 可能纯 mock 实现"; exit 1)

# === Happy 4: __init__.py __all__ 严格白名单（r1 #10 修订）===
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import importlib.util
spec = importlib.util.spec_from_file_location('wr', 'services/agent/wechat-rpa/__init__.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
expected = {'qr_bind','listen_chat','send_chat','send_moment','rate_limiter','find_weixin'}
got = set(m.__all__)
assert got == expected, f'FAIL: __all__ 不匹配 expected={expected} got={got}'
print('PASS: __all__ 白名单严格匹配')
"

# === 边界 1: 名单外好友消息丢弃 ===
BEFORE=$(node apps/api/scripts/count-feishu-interaction.js)
python3 services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{"sender":"陌生人","wechat_id":"unknown_x","content":"嗨"}'
sleep 5
AFTER=$(node apps/api/scripts/count-feishu-interaction.js)
[ "$BEFORE" = "$AFTER" ] && echo "PASS: 名单外消息未泄漏 (count $BEFORE → $AFTER)" \
  || (echo "FAIL: 名单外消息泄漏"; exit 1)

# === 边界 2: OpenRouter 5xx 写"AI 生成失败"（r1 #5 修订）===
NODE_ENV=development OPENROUTER_FORCE_5XX=1 \
  python3 services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{"sender":"客户A","wechat_id":"test_a","content":"测试故障"}'
sleep 10
ROW=$(node apps/api/scripts/get-feishu-interaction.js --customer="客户A" --latest --field="AI 草稿")
echo "$ROW" | grep "AI 生成失败" \
  && echo "PASS: OpenRouter 5xx 时写占位文案" \
  || (echo "FAIL: fallback 未生效: $ROW"; exit 1)

# === 防作弊 1: AI 草稿绝不能越过 pending_review (A 路线护栏) ===
NON_PENDING=$(psql cecelia -t -c "SELECT COUNT(*) FROM wechat_publish_task WHERE type='chat' AND approval_status NOT IN ('pending_review','rate_limited','rejected')")
[ "$(echo $NON_PENDING | tr -d ' ')" = "0" ] && echo "PASS: ws3 草稿 0 条越过 pending_review" \
  || (echo "FAIL: $NON_PENDING 条越过 pending_review — A 路线护栏破"; exit 1)

# === 防作弊 2: approval_source 在 ws3 阶段必须 NULL（不允许 system 自批）===
SELF_APPROVED=$(psql cecelia -t -c "SELECT COUNT(*) FROM wechat_publish_task WHERE type='chat' AND approval_status='approved' AND approval_source IS NULL")
[ "$(echo $SELF_APPROVED | tr -d ' ')" = "0" ] && echo "PASS: 0 条 chat 草稿 approved 且 approval_source NULL" \
  || (echo "FAIL: $SELF_APPROVED 条违规 — system 自批"; exit 1)

# === 防作弊 3: 主动发起会话 def 黑名单（r1 #10 修订）===
FOUND=$(grep -rE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_)" services/agent/wechat-rpa/ | wc -l)
[ "$FOUND" = "0" ] && echo "PASS: 无主动发起会话 def" \
  || (echo "FAIL: $FOUND 个主动发起 def — thin 阶段不允许"; exit 1)
```

---

### ws4: DeepSeek 朋友圈文案草稿 + 写飞书内容排期 + 中台定时触发

**行为描述**：

1. 中台调度器 `apps/api/src/services/scheduler.ts` 注册 cron `0 9 * * *`（**server 时区**，**r1 #O2 修订** — thin 阶段不做客户机时区，加注释 `// thin: server 时区，加厚后改客户机时区`）

2. cron 触发时调 `POST /api/wechat/scheduler-tick {force: false}`，对所有已绑微信且营销画像齐全的客户：
   - 拼营销画像 3 字段 + 硬编码 prompt → 调 OpenRouter DeepSeek
   - 文案草稿写飞书"内容排期"表，状态 `pending_review`，**`approval_source IS NULL`**
   - DB 写 `wechat_publish_task`（type=moment，status=pending_review）

3. 跳过场景：
   - 营销画像未填齐（任一字段为空）→ skipped + reason `profile_missing`
   - 同一客户当日已生成过草稿 → skipped + reason `already_generated_today`（按 created_at::date = today 去重）

4. CI 模式：`max_tokens=20`（OpenRouter 封装统一处理，r1 #O3）

**硬阈值**：
- cron 表达式严格 `0 9 * * *`，server 时区
- 草稿必须用画像字段（DeepSeek 输出含画像关键词的概率 ≥ 80%，用 LLM-as-judge 验证而非硬关键词，**r1 反馈中我自己提出的 LLM 容易 false negative 改进**）
- 当日去重：第二次手动触发同客户 → `skipped`
- approval_source 必须 NULL（草稿生成时刻）

**验证命令**（修订自 r1 #2 #15 + 自我修订关键词检查）：

```bash
# === Happy 1: 手动触发 scheduler-tick 生成草稿 ===
source ~/.credentials/openrouter.env
node apps/api/scripts/seed-feishu-profile.js --customer="客户A" \
  --industry="美妆代购" --audience="25-35女性白领" --hook="正品保障+免税价"

cd apps/api && npm run dev > /tmp/ws4.api.log 2>&1 &
sleep 4
TICK_RES=$(curl -s -X POST localhost:5200/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" -d '{"force": true}')
kill %1 2>/dev/null
echo "$TICK_RES" | grep -E "\"generated\":[1-9]" \
  && echo "PASS: scheduler-tick 生成 ≥1 条草稿" \
  || (echo "FAIL: 未生成草稿: $TICK_RES"; exit 1)

# === Happy 2: 飞书内容排期表收到草稿 ===
sleep 5
ROWS=$(node apps/api/scripts/count-feishu-schedule.js --status="pending_review" --date_today)
[ "$ROWS" -ge "1" ] && echo "PASS: 飞书内容排期 pending_review rows=$ROWS" \
  || (echo "FAIL: 飞书排期表无草稿"; exit 1)

# === Happy 3: 草稿真用画像（用 LLM-as-judge 替代硬关键词）===
LATEST_DRAFT=$(node apps/api/scripts/get-feishu-schedule.js --customer="客户A" --latest --field="文案")
echo "$LATEST_DRAFT" | python3 -c "
import sys, json, urllib.request, os
draft = sys.stdin.read().strip()
profile = '行业=美妆代购,受众=25-35女性白领,钩子=正品保障+免税价'
prompt = f'草稿:{draft}\\n画像:{profile}\\n判断草稿是否对应该画像（YES/NO）：'
key = open(os.path.expanduser('~/.credentials/openrouter.env')).read().split('=',1)[1].strip()
req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',
  data=json.dumps({'model':'deepseek/deepseek-chat','messages':[{'role':'user','content':prompt}],'max_tokens':5}).encode(),
  headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
res = json.loads(urllib.request.urlopen(req,timeout=20).read())['choices'][0]['message']['content'].strip()
assert 'YES' in res.upper(), f'FAIL: LLM judge 判定草稿不对应画像 ({res}): {draft}'
print('PASS: LLM judge 判草稿对应画像')
"

# === 边界 1: 画像未配置时跳过 ===
node apps/api/scripts/seed-feishu-profile.js --customer="客户B" --industry="" --audience="" --hook=""
TICK_RES=$(curl -s -X POST localhost:5200/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" -d '{"force": true, "customer": "客户B"}')
echo "$TICK_RES" | grep -E "skipped.*profile_missing|画像未配置" \
  && echo "PASS: 画像缺失正确跳过" \
  || (echo "FAIL: 应跳过却生成: $TICK_RES"; exit 1)

# === 边界 2: 同日重复触发去重 ===
TICK_RES=$(curl -s -X POST localhost:5200/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" -d '{"force": true, "customer": "客户A"}')
echo "$TICK_RES" | grep -E "skipped.*already_generated_today" \
  && echo "PASS: 当日重复触发去重" \
  || (echo "FAIL: 当日重复应跳: $TICK_RES"; exit 1)

# === 防作弊 1: cron 0 9 * * * 严格注册（r1 #O2，server 时区）===
grep -rE "cron.*['\"]0 9 \* \* \*['\"]" apps/api/src/services/scheduler.ts \
  && grep -E "thin.*server 时区" apps/api/src/services/scheduler.ts \
  && echo "PASS: cron 0 9 * * * 注册且注释 server 时区" \
  || (echo "FAIL: cron 表达式或时区注释缺失"; exit 1)

# === 防作弊 2: ws4 朋友圈草稿 0 条越过 pending_review (A 路线护栏) ===
SELF_APPROVED=$(psql cecelia -t -c "SELECT COUNT(*) FROM wechat_publish_task WHERE type='moment' AND approval_status='approved' AND approval_source IS NULL")
[ "$(echo $SELF_APPROVED | tr -d ' ')" = "0" ] && echo "PASS: 0 条 moment 草稿 approved 且 source NULL" \
  || (echo "FAIL: $SELF_APPROVED 条违规 — system 自批朋友圈"; exit 1)
```

---

### ws5: 飞书审批轮询 + Python wechat_rpa 真发 + 频控保护（含并发安全）

**行为描述**：

1. 中台 `POST /api/wechat/draft-review-poll`（30 秒一次轮询，cron `*/30 * * * * *` 或 setInterval）：
   - 拉取飞书"内容排期"+"互动记录"表中状态变 `approved` 的草稿
   - 校验 DB `wechat_publish_task` 对应记录 → 写 `approval_source = 'feishu_user'`（A 路线护栏 enforce）
   - 校验频控（spawn `rate_limiter.py can_send`）
   - 通过 → 派 task_dispatch 给客户机的 zenithjoy-agent

2. **Python `send_chat.py`**：
   - 读 stdin JSON `{"target": "客户A", "wechat_id": "test_a", "message": "..."}`
   - **REAL_PUBLISH=0 → 不真调 pyautogui**（mock 用 `unittest.mock.MagicMock`，**r1 #6 修订**），输出 mock 成功 JSON
   - REAL_PUBLISH=1 → pyautogui 真控 PC 微信
   - 输出 `{"ok": true/false, "sent_at": ISO8601, "dryRun": bool, "reason"?: ...}`

3. **Python `send_moment.py`**：同上，朋友圈到指定 `visible_group`（thin 阶段固定一个分组名 "AI 测试"）

4. **Python `rate_limiter.py`**（**r1 #16 修订** — 并发安全）：
   - SQLite 路径：`~/.zenithjoy-agent/rate_limit.db`（**让 shell 展开 ~ ，r1 #7 修订**）
   - 表 `sends (id, wechat_id, action, sent_at)`
   - **`can_send(action, wechat_id)` 用 `BEGIN IMMEDIATE` 事务包 SELECT + INSERT**（防并发竞争）
   - 硬编码上限：朋友圈 ≤1/24h/号、私聊 ≤2/分钟/号 + ≤50/天/号、单次操作间隔 ≥1s、主动发起新会话 = 0
   - 子命令 `reset --wechat_id=<x>` 清除该号所有记录（CI 测试用）
   - 子命令 `version` 输出 `rate_limiter v1.0`（防作弊用）

5. 频控超限 → 状态 `rate_limited` + `next_allowed_at` 字段（不排队不重试）

6. rejected 草稿 → 不派 task_dispatch（status 保持 rejected）

**硬阈值**：
- 30 秒轮询周期
- 飞书 approved → 60 秒内派出 task_dispatch（≤2 个轮询周期）
- 频控并发安全（10 并发 can_send，True 数 ≤ 上限）
- REAL_PUBLISH=0 → pyautogui 0 次真调用（运行时 mock 验证）

**验证命令**（修订自 r1 #6 #7 #16）：

```bash
# === Happy 1: 飞书 approved 触发派发 + approval_source 写 feishu_user (A 路线护栏 enforce) ===
SCHED_ID=$(node apps/api/scripts/seed-feishu-schedule.js \
  --customer="客户A" --content="今日朋友圈测试" --status="pending_review")
node apps/api/scripts/update-feishu-schedule.js --id="$SCHED_ID" --status="approved"

cd apps/api && npm run dev > /tmp/ws5.api.log 2>&1 &
sleep 4
curl -s -X POST localhost:5200/api/wechat/draft-review-poll
sleep 5
kill %1 2>/dev/null

# DB 校验
SOURCE=$(psql cecelia -t -c "SELECT approval_source FROM wechat_publish_task WHERE feishu_record_id='$SCHED_ID'")
[ "$(echo $SOURCE | tr -d ' ')" = "feishu_user" ] && echo "PASS: approval_source=feishu_user 写入" \
  || (echo "FAIL: approval_source 不是 feishu_user: $SOURCE"; exit 1)

# === Happy 2: send_moment.py REAL_PUBLISH=0 dryrun（不真调 pyautogui，r1 #6 修订）===
cat <<'EOF' > /tmp/ws5.send_moment_input.json
{"content":"测试朋友圈","visible_group":"AI 测试"}
EOF
RESULT=$(REAL_PUBLISH=0 \
  python3 -m trace --trace --count -f /tmp/ws5.trace \
  services/agent/wechat-rpa/send_moment.py < /tmp/ws5.send_moment_input.json 2>/tmp/ws5.trace.txt)
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL: ok 不为 true'
assert out.get('dryRun') is True, 'FAIL: 缺 dryRun'
assert out.get('sent_at'), 'FAIL: 缺 sent_at'
print('PASS: send_moment dryrun 输出正确')
"

# === Happy 3: REAL_PUBLISH=0 时 pyautogui 0 次真调用（trace 验证，r1 #6 修订）===
PYAUTOGUI_CALLS=$(grep -cE "pyautogui\.\(click\|write\|press\|hotkey\)" /tmp/ws5.trace.txt 2>/dev/null || echo 0)
[ "$PYAUTOGUI_CALLS" = "0" ] && echo "PASS: REAL_PUBLISH=0 pyautogui 0 次调用" \
  || (echo "FAIL: REAL_PUBLISH=0 时 pyautogui 调了 $PYAUTOGUI_CALLS 次 — 防作弊破"; exit 1)

# === Happy 4: send_chat.py REAL_PUBLISH=0 dryrun ===
RESULT=$(echo '{"target":"客户A","wechat_id":"test_a","message":"嗨"}' | \
  REAL_PUBLISH=0 python3 services/agent/wechat-rpa/send_chat.py)
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL'
assert out.get('dryRun') is True, 'FAIL: 缺 dryRun'
print('PASS: send_chat dryrun')
"

# === 边界 1: 朋友圈 24h 频控（r1 #16 — 路径修正用 ~）===
python3 services/agent/wechat-rpa/rate_limiter.py reset --wechat_id=test_a
echo '{"content":"first","visible_group":"AI 测试"}' | REAL_PUBLISH=0 python3 services/agent/wechat-rpa/send_moment.py > /dev/null
RESULT=$(echo '{"content":"second","visible_group":"AI 测试"}' | REAL_PUBLISH=0 python3 services/agent/wechat-rpa/send_moment.py)
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False, 'FAIL: 应拒绝'
assert out.get('reason') == 'rate_limited', 'FAIL: reason'
assert out.get('next_allowed_at'), 'FAIL: 缺 next_allowed_at'
print('PASS: 朋友圈 24h 频控生效')
"

# === 边界 2: 私聊分钟级频控 ===
python3 services/agent/wechat-rpa/rate_limiter.py reset --wechat_id=test_a
for i in 1 2; do
  echo "{\"target\":\"客户A\",\"wechat_id\":\"test_a\",\"message\":\"msg$i\"}" | \
    REAL_PUBLISH=0 python3 services/agent/wechat-rpa/send_chat.py > /dev/null
done
RESULT=$(echo '{"target":"客户A","wechat_id":"test_a","message":"msg3"}' | \
  REAL_PUBLISH=0 python3 services/agent/wechat-rpa/send_chat.py)
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False and out.get('reason') == 'rate_limited', 'FAIL'
print('PASS: 私聊分钟频控生效')
"

# === 边界 3: rejected 草稿不派 ===
SCHED_ID=$(node apps/api/scripts/seed-feishu-schedule.js --content="不该发" --status="pending_review")
node apps/api/scripts/update-feishu-schedule.js --id="$SCHED_ID" --status="rejected"
cd apps/api && npm run dev > /tmp/ws5.api.log 2>&1 &
sleep 4
curl -s -X POST localhost:5200/api/wechat/draft-review-poll
sleep 3
kill %1 2>/dev/null
DISPATCH=$(grep -E "$SCHED_ID|wechat_send_moment.*$SCHED_ID" services/agent/logs/dispatch.log 2>/dev/null || echo "")
[ -z "$DISPATCH" ] && echo "PASS: rejected 草稿未派" \
  || (echo "FAIL: rejected 被派: $DISPATCH"; exit 1)

# === 防作弊 1: rate_limit.db 真持久化文件存在（r1 #7 修订，shell 展开 ~）===
[ -f ~/.zenithjoy-agent/rate_limit.db ] && echo "PASS: rate_limit.db 真持久化（本机）" \
  || (echo "FAIL: rate_limit.db 不存在 — 频控可能纯内存"; exit 1)

# === 防作弊 2: 频控并发安全（10 并发 can_send，True 数 ≤ 上限，r1 #16 修订）===
python3 services/agent/wechat-rpa/rate_limiter.py reset --wechat_id=test_a
TRUE_COUNT=$(python3 -c "
from concurrent.futures import ThreadPoolExecutor
from services.agent.wechat_rpa.rate_limiter import can_send
with ThreadPoolExecutor(10) as e:
  results = list(e.map(lambda _: can_send('chat', 'test_a'), range(10)))
print(sum(1 for r,_ in results if r))
")
# 私聊上限 2/分钟，10 并发 True 数应 ≤ 2
[ "$TRUE_COUNT" -le "2" ] && echo "PASS: 10 并发 can_send 通过数=$TRUE_COUNT ≤ 2 (chat 分钟上限)" \
  || (echo "FAIL: 10 并发通过 $TRUE_COUNT 次 > 2 — 频控并发漏洞"; exit 1)

# === 防作弊 3: 主动发起新会话 = 0（r1 #10 修订，def 黑名单已在 ws3 校验，此处再校验 ws5 不引入）===
FOUND=$(grep -rE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" services/agent/wechat-rpa/ | wc -l)
[ "$FOUND" = "0" ] && echo "PASS: ws5 仍无主动发起会话 def" \
  || (echo "FAIL: $FOUND 个主动发起 def"; exit 1)
```

---

### ws6: golden-path-4-smoke.sh + Lead 自验 evidence + CI 防作弊校验

**行为描述**：

1. 新建 `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`，端到端跑 Step 1-6（CI 默认 `REAL_PUBLISH=0`，Lead 自验 `REAL_PUBLISH=1`）
2. smoke 必须 step-by-step 输出 `Step N ✅` 标记，每个 step 真调 curl/psql/node/python/ssh/playwright（不 echo 占位）
3. **Lead 自验 evidence 模板** `.agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md`（**r1 #O1 文件名修订**），结构对齐 `golden-path-1/lead-acceptance-sprint-2.1a.md`
4. CI 注册：
   - `test-registry.yaml` 加 ws1-ws6 测试目录
   - `lint-feature-has-smoke` 校验 Path 4 改动必须含 smoke
   - `lint-tdd-commit-order` 校验每 ws 第一个 commit 是 test commit
   - GitHub Actions workflow `golden-path-4-smoke.yml` 用 `needs: [ws1, ws2, ws3, ws4, ws5]` enforce 依赖（**r1 #14 修订**）

5. **Evidence 真实证据强校验**（**r1 #12 修订**），sprint 完成时 evidence 必须含：
   - 真实 cookie/wechat 登录态 dump（≥ 100 字节非空）
   - 真实 wechat_id（不能是 `test_wechat_001` / `placeholder`）
   - 真实 sent_at ISO8601 时间戳（在 sprint 完成日 ±2 天内）
   - 真实飞书 record_id（飞书 API 验证存在）

**硬阈值**：
- smoke 6 step 全真执行
- evidence 含 4 类真实证据
- CI 依赖关系正确

**验证命令**（修订自 r1 #11 #12 #14 #O1 #O4）：

```bash
# === Happy 1: smoke dryrun 全绿 ===
REAL_PUBLISH=0 bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh \
  && echo "PASS: smoke dryrun 全绿" \
  || (echo "FAIL: smoke dryrun 失败"; exit 1)

# === Happy 2: smoke 6 step 全输出 ✅ ===
OUTPUT=$(REAL_PUBLISH=0 bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh 2>&1)
for step in 1 2 3 4 5 6; do
  echo "$OUTPUT" | grep -E "Step $step.*✅|Step $step.*PASS" \
    || (echo "FAIL: Step $step 标记缺失"; exit 1)
done
echo "PASS: smoke 6 step 全标记"

# === Happy 3: smoke 真调 binary（r1 #11 修订）===
BINARY_HITS=$(grep -cE "(curl|psql|node |python3?|ssh|playwright)" .github/workflows/scripts/smoke/golden-path-4-smoke.sh)
[ "$BINARY_HITS" -ge "6" ] && echo "PASS: smoke 真调 binary 出现 $BINARY_HITS 次（每 step 至少一次）" \
  || (echo "FAIL: smoke binary 调用 $BINARY_HITS < 6 — 可能假实现"; exit 1)

# === Happy 4: evidence 模板存在且文件名对齐（r1 #O1 修订）===
test -f .agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md \
  && grep -E "^## (Checklist|Evidence|真扫码|真发|真审|Worker Machine)" .agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md \
  && echo "PASS: evidence 模板存在 + 章节齐" \
  || (echo "FAIL: evidence 模板路径或章节缺"; exit 1)

# === Happy 5: CI 注册到 test-registry ===
for ws in ws1 ws2 ws3 ws4 ws5 ws6; do
  grep -E "tests/$ws/" test-registry.yaml \
    || (echo "FAIL: $ws 未注册"; exit 1)
done
echo "PASS: ws1-ws6 全部注册"

# === Happy 6: CI workflow needs 依赖（r1 #14 修订）===
grep -E "needs:.*\[(ws1.*ws2.*ws3.*ws4.*ws5|ws1, ws2, ws3, ws4, ws5)\]" .github/workflows/golden-path-4-smoke.yml \
  && echo "PASS: workflow needs 依赖 ws1-5 enforce" \
  || (echo "FAIL: workflow 未声明 needs 依赖"; exit 1)

# === 边界 1: smoke 中途失败退出码非 0 ===
OPENROUTER_API_KEY=invalid_test_key_$(date +%s) REAL_PUBLISH=0 \
  bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
RC=$?
[ "$RC" -ne "0" ] && echo "PASS: smoke 中途失败正确退 $RC" \
  || (echo "FAIL: smoke 该失败却退 0"; exit 1)

# === 防作弊 1: smoke 不允许 echo / printf 占位（r1 #11 修订强化）===
PLACEHOLDER=$(grep -cE "^[[:space:]]*(echo|printf)[[:space:]]+['\"]?(Step|✅|PASS).*['\"]?" .github/workflows/scripts/smoke/golden-path-4-smoke.sh)
ALLOWED_PLACEHOLDER=12  # 6 step × 2 行（开始 + 结束）允许的标记输出
[ "$PLACEHOLDER" -le "$ALLOWED_PLACEHOLDER" ] && echo "PASS: smoke echo/printf 占位 $PLACEHOLDER ≤ $ALLOWED_PLACEHOLDER" \
  || (echo "FAIL: $PLACEHOLDER 行 echo/printf 占位 — smoke 没真跑"; exit 1)

# === 防作弊 2: lint-feature-has-smoke Path 4 注册 ===
grep -rE "golden-path-4|path-4|wechat-rpa" .github/workflows/lint-*.yml \
  && echo "PASS: lint 校验 Path 4" \
  || (echo "FAIL: lint 未注册 Path 4"; exit 1)

# === 防作弊 3: ws1-ws6 commit 1 是 test (TDD 顺序) ===
for ws in ws1 ws2 ws3 ws4 ws5 ws6; do
  FIRST=$(git log --reverse --oneline cp-05082012-path4-sprint-1-prd..HEAD | grep -E "($ws|wechat.*$ws)" | head -1)
  echo "$FIRST" | grep -E "test\(" \
    || (echo "FAIL: $ws 第一个相关 commit 不是 test: $FIRST"; exit 1)
done
echo "PASS: ws1-ws6 TDD commit 顺序合规"

# === 防作弊 4: Lead 自验机锁定 rog-xian + 真实证据强校验（r1 #12 修订）===
EVIDENCE=.agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md
grep -E "rog-xian|100\.98\.253\.95|XX-ROG" $EVIDENCE \
  || (echo "FAIL: evidence 未锁 rog-xian"; exit 1)
# Sprint 完成（合 PR 时）evidence 必须含 4 类真实证据
COOKIE_LEN=$(grep -A 5 "cookie" $EVIDENCE | grep -oE "[A-Za-z0-9_-]{50,}" | head -1 | wc -c)
WECHAT_ID=$(grep -E "wechat_id:.*[a-z0-9_]+" $EVIDENCE | grep -vE "test_wechat_001|placeholder" | head -1)
SENT_AT=$(grep -oE "sent_at:.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}" $EVIDENCE | head -1)
RECORD_ID=$(grep -oE "feishu_record_id:.*rec[A-Za-z0-9]{6,}" $EVIDENCE | head -1)

# Sprint 1 PRD push 阶段允许 evidence 是模板（占位 OK）
# Sprint 1 final merge 阶段必须真实证据填充
if [ "${LEAD_ACCEPTANCE_VALIDATION:-skip}" = "strict" ]; then
  [ "$COOKIE_LEN" -ge "50" ] || (echo "FAIL: cookie 字段未填真实数据（< 50 字节）"; exit 1)
  [ -n "$WECHAT_ID" ] || (echo "FAIL: wechat_id 是占位"; exit 1)
  [ -n "$SENT_AT" ] || (echo "FAIL: sent_at 时间戳缺失"; exit 1)
  [ -n "$RECORD_ID" ] || (echo "FAIL: feishu_record_id 缺失"; exit 1)
  echo "PASS: evidence 4 类真实证据全部填充"
else
  echo "PASS (template only): evidence 模板就位，final merge 时 LEAD_ACCEPTANCE_VALIDATION=strict 校验真实证据"
fi
```

---

## 技术实现方向（高层）

### 数据库
- migration `apps/api/db/migrations/20260508_<HHMMSS>_create_wechat_publish_task.sql`
- migration `apps/api/db/migrations/20260508_<HHMMSS>_create_llm_audit.sql`
- DB 名 `cecelia`（共享，已实证）
- 不修改现有 publish_tasks（Path 1 抖音用），新表独立避免污染

### LLM 调用
- `apps/api/src/llm/openrouter.ts`：fetch POST openrouter.ai/api/v1，model `deepseek/deepseek-chat`
- 调用 → 写 `llm_audit` DB 表（r1 #4 修订）
- 故障注入 `OPENROUTER_FORCE_5XX` 仅 NODE_ENV=test/development 生效（r1 #5）
- CI (process.env.CI) max_tokens=20（r1 #O3）

### Agent 协议
- 复用 zenithjoy-agent 现有 SSE/task/progress/receipt 协议
- 新增 task type：`wechat_qr_bind` / `wechat_listen_start` / `wechat_send_chat` / `wechat_send_moment`
- handler `wechat-rpa.ts`：spawn Python 子进程，stdin JSON 入参，stdout JSON 出参

### Python 子进程
- 单文件单职责 + `__init__.py` 严格 `__all__` 白名单（r1 #10）
- 共享 `rate_limiter.py` SQLite (`~/.zenithjoy-agent/rate_limit.db`，shell 展开 ~) + BEGIN IMMEDIATE 并发安全（r1 #16）
- `REAL_PUBLISH=0` → unittest.mock.MagicMock 替代 pyautogui（r1 #6）
- 不直接 import xian-pc 桌面 PoC 文件

### 飞书 Bitable
- 复用 Path 2 OAuth 框架（apps/api/src/services/feishu-bitable.ts）
- 4 张表名固定中文：客户档案 / 营销画像 / 内容排期 / 互动记录
- schema 定义 + create + 8 fixture script（r1 #13）

### 频控
- 硬编码上限：朋友圈 ≤1/24h、私聊 ≤2/分钟 ≤50/天、操作间隔 ≥1s、主动发起 = 0
- BEGIN IMMEDIATE 事务 + 10 并发测试（r1 #16）

### 部署
- `scripts/deploy-agent-to-rog.sh` rsync 到 rog `~/zenithjoy-agent/`（r1 #3，rog 已有此目录）

---

## 不在本次范围内

- 多号矩阵 / 主动 outreach / 完全自主 AI agent（medium+）
- 朋友圈带图 / 视频内容（thicken 阶段）
- 客户分群 / 标签自动化（thin 手填 SSOT）
- 实时增量好友同步（thin 一次性手动全量）
- 朋友圈点赞 / 评论 / 主动私聊新好友
- 跨平台联动（不接抖音、小红书）
- 高可用 / supervisor / 自动重连
- 凭据下发服务（thin 手动写客户机 .env）
- 漏消息补抓 / 历史回填
- 多客户 / SaaS 化
- 个微号封号恢复（thin 阶段封了换号）
- Path 4B 客户私域维护（4A 通后下一 sprint）

---

## journey_type: user_facing
## journey_type_reason: 起点 apps/dashboard/，UI 起点最靠前（Path 4 Notion Journey Type 已标 user_facing）

## Lead 自验机：rog-xian (Tailscale 100.98.253.95, hostname XX-ROG, USER=asus, USERPROFILE=C:\Users\asus, agent 已部署在 ~/zenithjoy-agent/)

## Workstream DAG：
ws1（基础设施）→ ws2（绑号 + 飞书表 + Dashboard + 8 fixture script）→ (ws3 私聊 || ws4 朋友圈) → ws5（审批 + 真发 + 频控）→ ws6（smoke + evidence + CI）

---

## APPROVE 后产出（r1 #O4 修订）

合同 APPROVED 后 Proposer 倒推：
- `task-plan.json` — 6 ws 任务 DAG
- `tests/ws1/`、`tests/ws2/`、`tests/ws3/`、`tests/ws4/`、`tests/ws5/`、`tests/ws6/` — RED 测试骨架
- `contract-dod-ws1.md` ... `contract-dod-ws6.md` — 细分到每 ws 的 DoD（包含本合同对应 ws 的全部验证命令）
