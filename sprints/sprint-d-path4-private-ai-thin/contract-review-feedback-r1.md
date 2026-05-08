# 合同审查反馈（第 1 轮 — Reviewer 对抗审查）

> 合同草案：`contract-draft.md`（commit f6d649d，548 行）
> 审查者：Evaluator（站在"如何用空 stub 蒙混过关"视角）
> Verdict: **REVISION**（16 条 must-fix + 4 条 optional）

---

## 必须修改（must-fix）

### A. 命令不可执行 / 假设错误（最严重，直接导致验证失败）

#### 1. ws1 验证 1: `psql cecelia` 数据库名错

```
psql cecelia -c "\d wechat_publish_task"
```

zenithjoy 不用 cecelia DB。Generator 必须先 grep `apps/api/.env*` / `apps/api/src/db/` 定位 zenithjoy 真 DB 名（推测 `zenithjoy` 或 `zenithjoy_workspace`，但请实证），然后所有 psql 命令统一改名。

#### 2. ws1 验证 2 / ws3 / ws4: API server 端口假设 `localhost:3000` 可能错

```
cd apps/api && npm run dev &
... curl localhost:3000/api/wechat/qr-bind ...
```

zenithjoy `apps/api` 实际监听端口需要 grep `apps/api/src/index.ts` 或 `apps/api/.env` 确认。盲写 3000 大概率错。统一从 `process.env.API_PORT` 读 + 在合同顶部声明默认值。

#### 3. ws2 鸡生蛋：ssh rog-xian 假设 zenithjoy-agent 已部署

```
ssh rog-xian "cd C:/zenithjoy-agent && python services/agent/wechat-rpa/qr_bind.py --dryrun"
```

Sprint 1 第一刀**还没把 agent 部署到 rog**。所有 ws2/ws3/ws5 的 ssh rog-xian Python 命令在 CI 第一次跑时**100% fail**，因为 `C:/zenithjoy-agent` 不存在。

**修法**：
- 在 ws1 添加部署脚本 `scripts/deploy-agent-to-rog.sh`（rsync zenithjoy-agent + Python deps）
- ws2/3/5 验证命令前置一步：`bash scripts/deploy-agent-to-rog.sh && ssh rog-xian "..."`
- 或者改 dryrun 命令在本地 Mac mini 跑（用 `python services/agent/wechat-rpa/qr_bind.py --dryrun --simulate-windows`），rog 真扫只用于 Lead 自验

#### 4. ws3 验证 2: `apps/api/logs/llm.log` 文件路径不存在

```
LOG_TAIL=$(tail -50 apps/api/logs/llm.log | grep "openrouter.*deepseek-chat")
```

zenithjoy 用 pino + stdout，**没有 llm.log 文件**。这条命令必 fail。

**修法**：
- 改成 grep stdout（CI 用 `npm run dev 2>&1 | tee /tmp/api.log` 然后 tail /tmp/api.log）
- 或在 ws1 实现 LLM 调用 audit DB 表（推荐 — 可被 SQL 验证）：`SELECT cost FROM llm_audit WHERE model='deepseek/deepseek-chat' ORDER BY id DESC LIMIT 1`

#### 5. ws3 验证 4 / ws4 验证 4: `OPENROUTER_FORCE_5XX=1` mock 开关合同没说要实现

```
OPENROUTER_FORCE_5XX=1 ssh rog-xian "..."
```

这是 fault injection 开关，但 contract-draft 的"功能描述"没要求 ws3 实现这个开关。Generator 看不到这个开关的需求 → 不实现 → 测试 fail（环境变量不生效）。

**修法**：在 ws1 OpenRouter 封装的"行为描述"加：必须支持 `OPENROUTER_FORCE_5XX=1` 注入故障（仅 NODE_ENV=test/development 生效，生产忽略）。

#### 6. ws5 防作弊 1: `PYAUTOGUI_DEBUG=1` 不是真实功能

```
RESULT=$(ssh rog-xian "REAL_PUBLISH=0 PYAUTOGUI_DEBUG=1 ... | grep pyautogui.click")
```

pyautogui 库**没有 PYAUTOGUI_DEBUG=1 这种环境变量**。这条命令实际不会让 pyautogui 输出 debug 信息。

**修法**：
- 用 `python -m trace --trace ... 2>&1 | grep "pyautogui\.\(click\|write\|press\)"` 真追踪函数调用
- 或在 send_*.py 顶部 `if os.getenv('REAL_PUBLISH', '0') == '0': pyautogui = MagicMock()` 然后测 `MagicMock 实例的 method_calls`

#### 7. ws5 防作弊 2: rate_limit.db 路径错（rog 用户名不是 Administrator）

```
ssh rog-xian "test -f C:/Users/Administrator/.zenithjoy-agent/rate_limit.db"
```

rog-xian hostname=XX-ROG，user 可能是 `xuxia`（与 xian-pc 同 user）或别的，**不是 Administrator**。

**修法**：先 `ssh rog-xian "echo %USERPROFILE%"` 拿到真路径再写 fixed 路径，或全部用 `~/.zenithjoy-agent/` 让 shell 展开。

---

### B. 防作弊不够严（错误实现能蒙混过关）

#### 8. ws1 防作弊：`grep -A 30 "wechat-rpa" ... | grep spawn` 太弱

一个空 stub 这样写就能过：

```typescript
// services/agent/src/handlers/wechat-rpa.ts
import { spawn } from 'child_process'; // ← grep 命中
export async function handleWechatRpa(task) {
  return { ok: false, reason: 'not_implemented' }; // 永远不真 spawn
}
```

**修法**：加运行时实证 — `npm test -- wechat-rpa.handler.test.ts` 必须包含"派一个 wechat_qr_bind task → 验证 spawn 真被调用 → 子进程 stdout 含 dryrun JSON"的端到端测试。

#### 9. ws3 防作弊 2：`grep import wxauto4` 防不住运行时 mock

```python
# listen_chat.py
import wxauto4  # ← grep 命中，但下一行 monkey-patch 全部 mock
import unittest.mock as mock
wxauto4.WeChat = mock.MagicMock()
```

**修法**：listen_chat.py 启动时调 `wxauto4.__version__` 写到 stderr 日志，验证命令 grep 真版本号字符串（mock 不会有真版本号，会抛 AttributeError）。

#### 10. ws3 防作弊：`grep "send_first_message|initiate_new_chat|主动发起"` 关键词太窄

可以用同义词绕过：`proactive_send` / `cold_outreach` / `initiate_conversation` / `outbound_message` / `start_chat` / `bulk_send`。

**修法**：改成 import 级别白名单 — `services/agent/wechat-rpa/__init__.py` 导出 `__all__ = ['qr_bind', 'listen_chat', 'send_chat', 'send_moment', 'rate_limiter', 'find_weixin']`，验证命令 `python -c "import services.agent.wechat_rpa; print(services.agent.wechat_rpa.__all__)"` 与白名单严格匹配。同时 grep 任何含 `def send_to(` `def proactive_` `def outbound_` `def initiate_` `def start_chat_with_` 的 def 全 fail。

#### 11. ws6 防作弊 1：`grep "^echo '?Step.*PASS'?$"` 占位扫描太弱

可被绕过：
```bash
printf "Step %d PASS\n" 1     # ← printf 不被 grep
true && echo "Step 1 PASS"    # ← true 短路绕过
RESULT="Step 1 PASS" && echo "$RESULT"  # ← 变量绕过
```

**修法**：改成"每个 Step 必须有真实命令 + grep 命中关键 binary"——即 smoke 脚本 grep `curl|psql|node|python|ssh|playwright` 出现次数 ≥ 6（每 step 至少一次）。

#### 12. ws6 evidence 模板检查不强

```
grep -E "^## (Checklist|Evidence|真扫码|真发|真审)" .agent-knowledge/path-4/lead-acceptance-sprint-1.md
```

模板存在 + 章节标题在就 PASS，但**章节内容可以是空 placeholder**。Lead 可以提交空模板被绿。

**修法**：sprint 完成时，evidence 必须含真实证据：
- 真实 cookie / wechat 登录态 dump（≥100 字节非空字符串）
- 真实 wechat_id（不能是 `test_wechat_001` / `placeholder`）
- 真实 sent_at 时间戳（ISO 8601 格式且在 sprint 完成日 ±2 天内）
- 真实飞书表 record_id（飞书 API 验证存在）

类似 sprint 2.1a 的 cad08a7 commit message：`真 cookie：default.json 13844 bytes / 45 cookies（非空登录态，真扫码 dump）` — 这种实证级别。

---

### C. 依赖关系不清晰（导致并行实现误读）

#### 13. ws2-ws5 依赖的 seed/count/get script 在哪个 ws 实现没说

合同 ws3-5 验证大量用 `node apps/api/scripts/seed-feishu-customer.js` / `count-feishu-interaction.js` / `get-feishu-schedule.js` 等，但**没说这些 script 谁写**。

**修法**：在 ws2"行为描述"末尾加：实现以下 fixture script（CI 测试用），列清单：
- `apps/api/scripts/seed-feishu-customer.js`
- `apps/api/scripts/seed-feishu-profile.js`
- `apps/api/scripts/seed-feishu-schedule.js`
- `apps/api/scripts/update-feishu-schedule.js`
- `apps/api/scripts/count-feishu-interaction.js`
- `apps/api/scripts/count-feishu-schedule.js`
- `apps/api/scripts/get-feishu-interaction.js`
- `apps/api/scripts/get-feishu-schedule.js`

并要求每个 script 支持 `--help` 显示用法，便于调试。

#### 14. ws6 依赖 ws1-5 全部完成才能跑

合同 ws6 验证 `bash golden-path-4-smoke.sh` 自然依赖前 5 个 ws 的实现。但合同没说"ws6 验证执行的前置 = ws1-5 全部 PR 已合"。

**修法**：合同顶部"Workstream DAG"段加显式依赖图：

```
ws1 → ws2 → (ws3 || ws4) → ws5 → ws6（顺序合并 PR）

ws3 与 ws4 可并行实现（都依赖 ws1+ws2，互不依赖），但合并顺序仍需 ws3 先 ws4 后（避免分支冲突）。
ws6 验证只能在 ws1-5 全部 dryrun 通过后跑（CI 用 needs 关键字 enforce）。
```

---

### D. 业务规则漏洞（A 路线护栏 + 频控）

#### 15. ws3/ws4 防作弊：approved 来源未校验

合同只校验"AI 生成的草稿状态必须 pending_review"，但漏了：**草稿从 pending_review → approved 的来源必须是飞书 API**（用户在飞书表手动改），不能是程序自己改。

否则 buggy 实现可以：
```typescript
const draft = await generateDraft();
draft.status = 'approved'; // ← AI 自己批准自己
await saveDraft(draft);
await sendToWechat(draft); // ← A 路线护栏破
```

**修法**：
- DB 层 `wechat_publish_task` 加 `approval_source` 字段（only `feishu_user` / `feishu_api`，禁止 `system` / `auto`）
- 加一条防作弊验证：`SELECT COUNT(*) FROM wechat_publish_task WHERE status='approved' AND approval_source NOT IN ('feishu_user','feishu_api')` 必须 = 0

#### 16. ws5 频控漏洞：SQLite 多脚本并发竞争

```python
# rate_limiter.py 当前隐含逻辑：
def can_send(action, wechat_id):
    cursor.execute("SELECT COUNT(*) FROM sends WHERE ...")
    count = cursor.fetchone()[0]
    if count >= LIMIT: return False
    cursor.execute("INSERT INTO sends ...")  # ← 中间窗口期被并发突破
```

两个 send_*.py 子进程并发跑 can_send，都查到 count=0，都允许发送 → 实际超频。

**修法**：
- SQLite `BEGIN IMMEDIATE` 事务包住 SELECT + INSERT
- 或文件锁 `fcntl.flock`（Windows 用 `msvcrt.locking`）
- 加并发测试：`python -c "from concurrent.futures import ThreadPoolExecutor; with ThreadPoolExecutor(10) as e: results = list(e.map(can_send_call, range(10)))" → results 中 True 数 ≤ 上限`

---

## 可选改进（optional）

### O1. evidence 文件命名对齐 sprint-2.1a/b 规范

合同写 `lead-acceptance-sprint-1.md`，但 sprint-c (2.1a/b) 用 `lead-acceptance-sprint-2.1a.md` 带版本号。建议改成 `lead-acceptance-sprint-d-1.md`（前缀对应 sprint 目录 sprint-d-）或 `lead-acceptance-path4-sprint-1.md`（明确 Path 4）。

### O2. cron 时区明确

`0 9 * * *` 是 server 时区还是 UTC？客户机在不同时区时怎么办？thin 阶段允许"按 server 时区"，但合同应在 ws4 行为描述中明示。

### O3. CI 调 OpenRouter 真烧钱

每次 CI 跑都真调 DeepSeek 会有成本累积。CI 模式建议 `max_tokens=20`，避免长 reasoning。也加 monthly cost 上限，超限 CI 跳过 LLM 调用走 mock。

### O4. ws6 task-plan.json + tests/ 骨架产出未明示

按 sprint 2.1a 实际产出 (`task-plan.json` + `tests/ws[1-5]/`)，本合同 APPROVED 后还需 Proposer 倒推这些。建议在合同末尾"APPROVE 后产出"段加：
- `task-plan.json` (DAG)
- `tests/ws1-ws6/*.test.ts` 骨架（RED）
- `contract-dod-ws[1-6].md`（细分到每个 ws 的 DoD）

---

## 总结

合同覆盖度好（PRD 6 step → 6 ws，验证命令 41 条），但**16 条 must-fix 要 Generator 修订**：

- A 类（命令不可执行）：7 条 — 直接 fail
- B 类（防作弊不严）：5 条 — buggy 实现能蒙混
- C 类（依赖不清）：2 条 — 并行实现会误读
- D 类（业务规则漏洞）：2 条 — A 路线护栏 + 频控可被绕

**优先级**：A 类必修（不修 CI 全 fail），B 类必修（不修 thin 第一刀就破护栏），C 类应修（不修后续 ws 实现错位），D 类必修（A 路线护栏是 sprint 1 核心 spec 之一，破了等于没意义）。

---

## verdict

```json
{"verdict": "REVISION", "feedback_path": "sprints/sprint-d-path4-private-ai-thin/contract-review-feedback-r1.md", "issues_count": 16}
```
