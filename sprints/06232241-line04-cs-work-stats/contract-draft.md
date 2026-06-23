# Sprint Contract Draft (Round 1) — 客服工作汇总统计页

> journey_type: **user_facing** ｜ target_environment: **windows_cloud**
> 一句话：给客服消息盖「客服微信号」身份章 → 按北京时区每客服每日聚合 4 个数 → 前台汇总页每客服一张卡 + 今天/昨天切换。

> **target_environment 路由说明（preempt v9.0 #6）**：Golden Path Step 1 虽含「微信」语境，但**本 sprint 不触碰真机微信 RPA**（listen_chat 读真机微信不在范围）。盖身份章在 **API 落库边界**验证（`POST /api/wechat/draft-generate` → `cs_memory_messages`，stamp oracle，不依赖真机微信），属 Mode A（API+DB，linux job）。最终交付物是 **Dashboard 前台页**，UI E2E 走 **windows_cloud** Playwright（ZenithJoy UI 死规则）。故 `windows_cloud` 正确，**非** windows_wechat——无任何 BEHAVIOR 需真机微信，不存在「GHA 无微信 → 假绿」。

## Golden Path

[名单客户私聊某客服 → 客服机自动回复，in/out 落库时盖 cs_wechat_id 身份章]
→ [管理员打开 dashboard「客服工作汇总」页]
→ [看到每台客服机一张卡：客服名/微信号/在线状态/真发-演练标 + 今天 4 数（接收·回复·接待·工作分钟）]
→ [顶部切「昨天」→ 4 个数变为昨天的数]

---

## Response Schema（推导来源: `[NEW_PATTERN]` — registry 不可达，按 wechat.ts 现有约定 `{ok:true,...}` / `{error,message}` 推导；字段名锚点取自 PRD 口径）

### Endpoint: `GET /api/wechat/cs/stats?date=today|yesterday`

鉴权：复用现有 `X-Internal-Token`（或 `Authorization: Bearer`）→ `ZENITHJOY_INTERNAL_TOKEN`（PRD 假设：走中台已有内部鉴权，不新增外部 API/Key）。

**Success (HTTP 200)**:
```json
{
  "ok": true,
  "date": "today",
  "stats": [
    {
      "cs_wechat_id": "wxid_csA",
      "cs_name": "客服小美",
      "online": true,
      "mode": "real",
      "received_count": 3,
      "reply_count": 2,
      "served_customers": 2,
      "work_duration_minutes": 20
    }
  ]
}
```
- `ok` (boolean, 必填): 来源——api_registry 不可达，按 wechat.ts 现有 `{ok:true,...}` 约定 `[NEW_PATTERN]`
- `date` (string, 必填): 回显请求的 `today` / `yesterday`，来源——`[AI_ADDED]`（防造假：让 evaluator 确认聚合用的是请求的那一天，不是另一天的缓存）
- `stats` (array, 必填): 每客服一行。**只含 `cs_wechat_id` 非 NULL 的客服**（PRD：NULL 身份不计入任何客服）。来源——PRD「每台客服机一张卡」
  - `cs_wechat_id` (string, 必填): 客服微信号身份章。PRD 口径分组键
  - `cs_name` (string\|null): 客服名，复用已有 cs 配置数据源（可空）。来源——PRD 卡片「客服名」
  - `online` (boolean): 在线状态，**只读复用**已有 module health/config。来源——PRD 卡片「在线状态」（**接缝**，见下）
  - `mode` (string, `"real"`\|`"dryrun"`): 真发/演练标，**只读复用**已有 config（`auto_agent_enabled` 等）。来源——PRD 卡片「真发/演练标」（**接缝**，见下）
  - `received_count` (number, 必填): 当日该客服 `in` 条数。PRD 口径「接收」
  - `reply_count` (number, 必填): 当日该客服 `out` 条数。PRD 口径「回复」
  - `served_customers` (number, 必填): 当日该客服去重 `contact` 数。PRD 口径「接待客人数」
  - `work_duration_minutes` (number, 必填): 当日该客服 `末条 created_at − 首条 created_at` 取分钟。PRD 口径「工作时长」

**禁用字段名**（generator 严禁漂移到这些同义替换，Reviewer/oracle 反向 `!has()` 校验）:
`in_count` / `out_count` / `wechat_id`（裸名，必须 `cs_wechat_id`） / `duration` / `customers` / `served` / `count` / `sum` / `total` / `messages`

**Error (HTTP 400 — `date` 非 today/yesterday)**:
```json
{ "error": "INVALID_DATE", "message": "date 必须是 today 或 yesterday" }
```
（沿用 wechat.ts 现有 `{error:'UPPER_SNAKE', message}` 错误约定）

---

## 已知约束（来自回归测试 / 现有代码）

- [tenant-memory.ts → `appendTenantMessage`] 写 `zenithjoy.cs_memory_messages (tenant_id, contact, role, text)`，role CHECK in('in','out')，`created_at TIMESTAMPTZ DEFAULT now()`、`msg_day DATE DEFAULT now()::date`（**美区墙钟，不能直接当北京日界用** → 聚合必须显式 `AT TIME ZONE 'Asia/Shanghai'`）。
- [migration 20260618_153000] `cs_memory_messages` 现**无 `cs_wechat_id` 列**，本 sprint 新增 nullable 列 + 索引 `(cs_wechat_id, created_at)`。
- [wechat-draft.ts:352 / :408] 真实自动回复 in/out 落库目前调 `contact-memory.appendMessage` → 写 **`zenithjoy.wechat_messages`（contact_key/sender_name/direction/content）**，**不是** `cs_memory_messages`。⚠️ 见下「接缝清单 #1」——盖章必须落到被 stats 聚合的那张表。
- [cs-account-config-store.ts] 身份解析链：`agent_id → license_machines.machine_id（或经 agents.id UUID 折算）→ service_agents.machine_id → wechat_id（= cs_wechat_id 身份章值）`。解不到 → null（落 NULL，向后兼容，不报错）。
- [wechat.ts] 现有 cs 路由统一 `{ok:true,...}` 成功 / `{error, message}` 4xx-5xx 失败；agent-facing 路由不挂 superAdminGuard，stats 为管理员读 → 挂 internal-auth。

---

## 接缝清单（v9.3 — 碰真实世界的点，CI 绿 ≠ done，必须真目标验）

> 写断言前自问「这功能在哪几个点碰真实世界」。下列为本 sprint 的接缝；逻辑断言（聚合 SQL/口径/北京时区转换）环境无关，CI/psql-seed 绿 = 真 done。

| # | 接缝 | 碰真实世界在哪 | 真目标验证方式 | 当前判定 |
|---|---|---|---|---|
| 1 | **in/out 落库盖 cs_wechat_id 身份章** | 真实自动回复路径（`POST /api/wechat/draft-generate` → wechat-draft:352/:408）+ 身份解析链（agent_id→machine→service_agents→wechat_id）。今天该路径写 `wechat_messages` 无章 → generator 须改写到被 stats 聚合的 `cs_memory_messages` 并盖章 | seed `license_machines`+`service_agents`+`wechat_cs_account_config(whitelist=[sender])`，带 `X-Tenant-Id` POST `/draft-generate{agent_id}` → 断言 `cs_memory_messages` 出现 `role='in' AND cs_wechat_id=<解析出的微信号> AND created_at>now()-5min` 的行（见 oracle `stamp`）。`out` 行需 LLM 成功 → 有 OpenRouter key 的真目标补验 | `in` 章可真验（LLM 无关）；`out` 章 **logic-done-pending**（需真目标 LLM key） |
| 2 | **卡片 `online`/`mode`（在线/真发-演练）** | 只读复用已有 module health / config 真实数据源 | 在接了真实 health/config 的目标上断言某已知在线客服 `online==true`、已开真发客服 `mode=="real"` | 数据层只断言**存在+类型**（boolean/枚举）；真实值 **logic-done-pending**（需真 health 源） |

> 逻辑断言（CI 绿=done）：`received_count`/`reply_count`/`served_customers`/`work_duration_minutes` 口径数学、A/B 互不串台、NULL 不计入、北京时区日界（`AT TIME ZONE 'Asia/Shanghai'` 是显式 SQL，与服务器所在美区无关）、昨天聚合、空数据日不报错。**禁止写死环境假设值**（屏幕坐标/假版本/假 env），本 sprint 无此类硬编码。

---

## Golden Path Steps（每步：来源 + 可观测行为 + 验证命令 + 硬阈值）

### Step 1: 名单客户私聊客服 → 自动回复，in/out 落库盖 cs_wechat_id 身份章
**来源**: `[FROM_PRD]` — Golden Path 第 1 条「这两条消息（in/out）落库时自动盖上该客服微信号身份章（cs_wechat_id）」

**可观测行为**: 经身份解析链解析出该客服微信号后，落库的 in/out 行 `cs_wechat_id` = 该微信号；解不到 → 落 NULL、不报错、不串到别人头上。

**验证命令**（接缝 #1，真目标；`in` 章 LLM 无关）:
```bash
# 完整 seed 身份链 + 名单 → POST 真实 /draft-generate → 断言 cs_memory_messages 'in' 行盖章
bash sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh stamp
# 期望: PASS stamp（cs_memory_messages 出现 role='in' 且 cs_wechat_id=解析微信号、created_at 在 5 分钟窗内）
```
**硬阈值**: in 行 cs_wechat_id 精确等于身份链解析出的微信号；5 分钟时间窗内；解不到身份 → 该行 cs_wechat_id IS NULL（不报错）。可执行：见 `stamp` 子命令（含 `created_at > now() - interval '5 minutes'` 时间窗 + `jq -e` 断言）。

---

### Step 2: cs_memory_messages 加 nullable cs_wechat_id + 索引
**来源**: `[FROM_PRD]` — 范围内「cs_memory_messages 加 nullable 字段 cs_wechat_id + 索引 (cs_wechat_id, created_at)」

**可观测行为**: migration 后该列存在且 nullable（老数据为 NULL 不报错）；索引 `(cs_wechat_id, created_at)` 存在。

**验证命令**:
```bash
psql "$DATABASE_URL" -t -A -c "SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='cs_memory_messages' AND column_name='cs_wechat_id'" | grep -qx 'YES' || { echo "FAIL: cs_wechat_id 缺失或非 nullable"; exit 1; }
psql "$DATABASE_URL" -t -A -c "SELECT 1 FROM pg_indexes WHERE schemaname='zenithjoy' AND tablename='cs_memory_messages' AND indexdef ILIKE '%cs_wechat_id%created_at%'" | grep -qx '1' || { echo "FAIL: (cs_wechat_id, created_at) 索引缺失"; exit 1; }
echo OK
```
**硬阈值**: `is_nullable = YES` 且索引 def 含 `cs_wechat_id` + `created_at`。

---

### Step 3: GET /api/wechat/cs/stats 按北京时区每客服聚合 4 个数
**来源**: `[FROM_PRD]` — 范围内「GET /cs/stats?date=today|yesterday 按北京时区聚合，每客服返回 4 个数」+ 口径四定义

**可观测行为**: 灌入已知 in/out 消息（指定 cs_wechat_id + created_at）后，该客服行 `received_count/reply_count/served_customers/work_duration_minutes` 精确等于预期；A 的数绝不出现在 B 卡片；NULL 身份不计入；北京 00:30（美区昨天）归今天；空数据日不报错。

**验证命令**（逻辑断言，CI/psql-seed 绿=done）:
```bash
SH=sprints/06232241-line04-cs-work-stats/scripts/cs-stats-verify.sh
bash "$SH" math        # 3/2/2/20 + 字段名锁定 + 禁用字段反向
bash "$SH" isolation   # A=3 / B=1 互不串台
bash "$SH" null        # NULL 身份不计入任何客服、接口不报错
bash "$SH" tz          # 北京 00:30 归今天、不串昨天（防 #832 美区日界）
bash "$SH" yesterday   # 昨天聚合正确、今天的不串昨天
bash "$SH" empty-zero  # 无消息日接口不报错、返回 stats 数组
```
**硬阈值**: 六个子命令全部 exit 0；每个内含 `jq -e` 精确等值断言 + 时间窗 + 禁用字段反向 `!has()`。

---

### Step 4: 前台「客服工作汇总」页 — 每客服一张卡 + 今天/昨天切换
**来源**: `[FROM_PRD]` — Golden Path 第 2-4 条 + 范围内「前台『客服工作汇总』页：每客服一张卡 + 今天/昨天切换」+「挂 Line04 区下」

**可观测行为**: 打开页面 → 每客服一张卡，卡内可见 微信号 + 4 个数；点「昨天」→ 4 个数变为昨天值；某客服 0 消息 → 卡显示 4 个 0（不报错/不消失）；A、B 两卡数字互不串台。导航 Line04/私域区下有入口。

**验证命令**（Mode B — windows_cloud Playwright，见 `## E2E 验收`）:
```bash
# 见下方 e2e-verify.ps1 + apps/dashboard/e2e/cs-work-stats.spec.ts（page.route 拦 /api/wechat/cs/stats，断言渲染+切换）
```
**硬阈值**: Playwright spec 全绿（卡片 4 数 `toHaveText` 精确匹配 mock 响应、点「昨天」后数字变化、空卡显示 4 个 0、A/B 不串台），exit 0。导航入口断言 `navigation.config.ts` 含 cs-stats 条目挂 Line04。

---

## E2E 验收（final-e2e — target_environment = windows_cloud，Playwright Dashboard）

> 与本仓库现有约定一致（navigation.config.ts:238「纯前端表单，page.route 拦后端验证；E2E 在 windows job 跑」）：UI E2E 用 `page.route` 拦 `/api/wechat/cs/stats` 验**渲染 + 今天/昨天切换 + 不串台 + 空卡 4 零**；**数据口径正确性**由 Mode A 数据 oracle（`scripts/cs-stats-verify.sh`，真 API+DB+psql 时间窗）保证。两层分工，互不替代。

**Playwright spec**: `apps/dashboard/e2e/cs-work-stats.spec.ts`（generator 写，本合同给契约）
- 断言 1（01-initial.png）: 打开 `/wechat/cs-stats` → 至少 2 张 `[data-testid="cs-stat-card"]` 可见；A 卡 `[data-testid="cs-stat-received"]` `toHaveText('3')`、reply `2`、served `2`、minutes `20`
- 断言 2（不串台）: A 卡内不出现 B 的微信号/数字；B 卡 received `1`
- 断言 3（空卡）: 0 消息客服卡四个数均 `toHaveText('0')`
- 断言 4（02-action.png → 03-result.png）: 点 `[data-testid="cs-stats-tab-yesterday"]` → 重新请求 `date=yesterday` → A 卡 received 由 `3` 变 `1`（mock 昨天响应）

**运行脚本**: `sprints/06232241-line04-cs-work-stats/scripts/e2e-verify.ps1`（windows-latest，变体 C：build dashboard + vite preview:5174 + playwright test）
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
**PASS**: `e2eProc.ExitCode -eq 0` 且所有 spec 通过 ｜ **FAIL**: 任意 step exit≠0 / Vite 30s 未就绪 / 任一 `toHaveText` 不匹配

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| stats 聚合口径 | `tests/cs-stats.test.ts` | 4 数口径数学 / 北京时区日界 / NULL 不计入 / A-B 不串台 / 禁用字段名 | → 模块/函数未实现 → N failures |

---

## journey_type: user_facing
## target_environment: windows_cloud
