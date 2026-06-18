# Sprint Contract Draft (Round 2) — 客户智能获客：飞书企业信息文档 + 扩词 + 中台采集闭环（Path2 Step4）

> **验证 SSOT（v2 起，对齐 Reviewer obs-i 防漂移）**：所有可执行验证命令以 `contract-dod.md` 的 `[BEHAVIOR]` manual:bash 为**唯一真相源**（evaluator 直接跑那一份）。本文件每个 Golden Path Step 只写「可观测行为 + 硬阈值」并用 **Step 标签**引用对应 DoD `[BEHAVIOR]`，不再内嵌第二份 bash 拷贝。Step 标签即稳定 ID（contract-dod.md 中以 `StepN` 命名）。

## 已知约束（来自回归测试）

- [agent-burner-routes / _smoke-fake-agent-burner.ts] 既有 burner 派单/回报链统一 `{success,data,timestamp}` / `{success,error:{code,message},timestamp}` 包裹；fake-agent smoke 双门禁：`NODE_ENV!=production` 否则 404、`X-Smoke-Token` 否则 403。本 sprint 新端点 + report 端点沿用同包裹与同门禁。
- [lead-writer.ts] 飞书写表复用 `writeRecord(tenant_id, table_id, fields)`，顺序写、单条失败重试、整体 `lead_write_status=success|failed`。
- [feishu-token.ts] `getValidToken(tenantId)` 在 `expires_at < NOW+5min` 时自动刷新——Step4「token 失效自动刷新重试」复用它，不要新写刷新逻辑。
- [golden-path-2-smoke.sh / golden-path-2-dm-smoke.sh] 所有 DB 计数断言带时间窗 `created_at/updated_at > NOW() - interval`，禁止无时间窗计数（历史数据冒充）。
- [feishu-bitable-multitenant.ts] 当前飞书集成只有 Bitable，**没有 docx 创建/读取、没有 doc_token**——Step0 的企业信息 docx 建/读 + `enterprise_doc_token` 列均为本 sprint 净增。
- [tenant-context.ts] 租户隔离来自 `req.tenantId`（中间件注入）；本 sprint 所有读写 `WHERE tenant_id=$1`，对齐 PRD 租户隔离铁律。

## Response Schema（推导来源: api_registry 不可达（curl 返空） → 复用同 repo `apps/api/src/routes/agent-burner.ts` 字面约定 + PRD 字面）

> 统一 `{success, data, timestamp}` 成功包裹、`{success, error:{code,message}, timestamp}` 错误包裹；ID 一律 snake_case `<entity>_id`（既有端点 `data.task_id`），状态字段名一律 `status`。

### Endpoint 1: POST /api/acquisition/collect/expand（读文档 → 扩词，前置校验）
**body**: `{tenant_id, manual_keywords?: string[]}`（manual_keywords 非空 → 完全替代 AI 词）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"keywords": [{"word": "<string>", "source": "ai|manual|seed"}], "degraded": false}, "timestamp": "<iso>"}
```
- `data` 顶层 keys 必须 **完全等于** `["degraded","keywords"]`（jq `keys` 字母序）——schema 完整性硬卡（Reviewer obs-iii）
- `data.keywords` (array 长度==3, 必填): 来源——PRD Step1「扩出 3 个搜索关键词」
- `data.keywords[].word` (string, 必填) / `data.keywords[].source` (enum `ai`|`manual`|`seed`, 必填): 来源——PRD「显示词 + 来源(ai/manual)」+「降级用文档关键词种子兜底」(seed)
- `data.degraded` (boolean, 必填): DeepSeek 超时/限流/401 兜底时 true，否则 false——PRD Step1 失败兜底
**禁用字段名**: `id`(顶层裸)、`keyword`(单数顶层)、`words`、`terms`、`result`、`negation` —— 统一 `data.keywords[].word`
**Error (HTTP 400)**: `{"success": false, "error": {"code": "<CODE>", "message": "<string>"}, "timestamp": "<iso>"}`
- 错码: `FEISHU_NOT_BOUND`（未绑飞书）/ `NO_ENTERPRISE_DOC`（无企业信息文档）/ `EMPTY_DOC`（文档纯文本 < 20 字 / 全图片表格）

### Endpoint 2: POST /api/acquisition/collect/start（确认 → 派单）
**body**: `{tenant_id, keywords: string[]}`
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "status": "pending"}, "timestamp": "<iso>"}
```
- `data.task_id` (string uuid, 必填) / `data.status` (enum, ==`pending`): 来源——PRD「确认后派单，返回 task_id」
**禁用字段名**: `id`、`taskId`、`collect_id`、`result`
**Error (HTTP 400)**: `MISSING_KEYWORDS`（keywords 空）/ `FEISHU_NOT_BOUND`

### Endpoint 3: POST /api/acquisition/collect/cancel（取消）
**body**: `{tenant_id, task_id}`
**Success (HTTP 200)**: `{"success": true, "data": {"task_id": "<uuid>", "status": "cancelling"}, "timestamp": "<iso>"}`
- `data.status` (==`cancelling`): 来源——PRD Step2「取消按钮 → task cancelling → cancelled，已抓先落库不丢」
**Error**: `NO_COLLECT_TASK` (404)

### Endpoint 4: POST /api/acquisition/collect/report（客户机 Agent 增量回报 — 去重落库 + 写飞书）
**门禁**: `X-Smoke-Token`（CI fake-agent）或真 agent 鉴权。
**body**: `{task_id, agent_id, keyword, video_id, commenters: [{sec_uid?: string, nickname: string}], checkpoint?: {keyword_idx, video_idx, scroll_offset}, partial_reason?: string, terminal?: "done|partial|failed", error_code?: string}`
- `terminal` + `error_code`：终态回报。`terminal="partial"` → task.status=partial、task.error_code=`partial_reason`（如 `video_insufficient`）；`terminal="failed"` → task.status=failed、task.error_code=入参 `error_code`（抖音侧 `DOUYIN_RISK`/`DOUYIN_CAPTCHA`/`DOUYIN_NOT_LOGGED_IN`，字面落库以区分原因）。**终态前 commenters 已落库的 leads 必须留存**（已抓先落库不丢）。
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "inserted": 0, "deduped": 0, "lead_write_status": "success|pending|failed", "status": "running|done|partial|cancelled|failed"}, "timestamp": "<iso>"}
```
- `data.inserted` (int): 本批去重后新落库抖音号数；`data.deduped` (int): 本批命中既有 (tenant_id,sec_uid)/昵称 而仅累加 video_id 的数
- `data.lead_write_status` (enum `success`|`pending`|`failed`): 来源——PRD Step4，`pending`=「待补写飞书」(飞书失败但采集成功)
- `data.status` (enum 7 态): 回报后任务态；`terminal=failed` → `failed`，`terminal=partial` → `partial`
**禁用字段名**: `count`、`leads`、`written`、`ok`
**Error**: `NO_COLLECT_TASK` (404) / `MISSING_VIDEO_ID` (400)

### Endpoint 5: GET /api/acquisition/collect/:task_id（获客页查状态 — 7 态 + 计数 + 失败原因 + 抖音号）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "status": "running", "video_count": 0, "lead_count_raw": 0, "lead_count_deduped": 0, "error_code": null, "degraded": false, "leads": [{"sec_uid": "<string|null>", "nickname": "<string>", "profile_url": "<string|null>", "partial": false}]}, "timestamp": "<iso>"}
```
- `data.status` (enum 7 态, 必填): `pending`|`running`|`cancelling`|`cancelled`|`done`|`partial`|`failed` —— 来源 PRD Step5「7 态」
- `data.video_count` / `data.lead_count_raw` / `data.lead_count_deduped` (int, 必填): 来源 PRD Step5「几视频/几抖音号/去重前后」
- `data.error_code` (string|null): 失败/部分原因（partial:`video_insufficient` 等 / failed:`DOUYIN_RISK` 等），来源 PRD Step5「失败原因」可见 / `data.leads[].partial` (boolean): 残缺/待核标记——PRD Step3「sec_uid 缺失 → 昵称兜底、标残缺、无主页链接」
- `data.leads[].profile_url`: `sec_uid` 非空时 == `https://www.douyin.com/user/<sec_uid>`，残缺号 == null
**禁用字段名**: `state`、`videos`、`count`、`lead_count`(裸)、`error`(顶层 data 内)
**Error**: `NO_COLLECT_TASK` (404)

---

## 范围限定（本合同对 PRD NFR 的取舍 — Reviewer R1 问题2）

**移出范围**：PRD §NFR「单抖音号每天 ≤3 次采集」（明确作用对象 = 同 `sec_uid` 在滚动 24h 内的采集次数上限）。

**理由（descope，非遗漏）**：
1. 它是**跨任务、跨时间窗的 anti-ban 限流守卫**，与 PRD §「不在范围内」已显式声明的「跨任务去重」属同一类跨任务状态。
2. CLAUDE.md 第一刀纪律：本 sprint 第一刀只「1 个抖音小号 + 1 个对标视频 URL + 1 条评论触达」，该规模下日采集次数上限不会被触发；且「加厚(限流/矩阵)必须有真实封号/限流证据驱动」——无证据前不提前上限流守卫。
3. 故本合同不引入 `collect_count` / `rate_limited` 等字段与守卫断言，避免为未被第一刀行使的能力增加投机 schema（精简纪律 B50）。

**加厚触发**：出现真实抖音封号/限流证据后，单独开 Run 加「同 sec_uid 24h 采集次数上限」守卫 + BEHAVIOR（第 4 次被限）。

> PRD §Golden Path Step2 / §边界情况 的两条失败兜底（Agent 离线→pending 不丢；抖音风控→failed 区分原因）**仍在范围内**，本轮已补 [BEHAVIOR]（见 contract-dod.md Step2 三条）。

---

## Golden Path
绑飞书自动建企业信息 docx(存 doc_token) → 主理人在飞书写企业信息 → 获客页点「采集」(前置校验 + 读文档扩 3 词,可手输覆盖,降级兜底) → 确认派单返 task_id → 客户机 Agent 搜 7 视频/词 + 抓评论区抖音号(断点续抓/可取消/离线留 pending/风控 failed) → 增量回报按 (tenant_id,sec_uid) 去重落 DB(SSOT) → 写飞书 Leads(失败标「待补写飞书」) → 获客页看到 7 态 + 计数 + 失败原因 + 抖音号可点跳主页。

### Step 0: 绑飞书时系统自动建「企业信息」docx，存 doc_token
**来源**: `[FROM_PRD]` — Golden Path 第 0 条「绑飞书时系统自动建『企业信息』飞书文档(docx)，存 doc_token；主理人在飞书自由编辑」

**可观测行为**: 飞书 provision/rebuild 流程在建 Bitable 之外，新建一篇 docx 并把 `enterprise_doc_token` 写入 `tenant_feishu_bindings`；该 token 可被 expand 端点读出纯文本。

**硬阈值**: provision/rebuild 后 `tenant_feishu_bindings.enterprise_doc_token` 非空（2 分钟内更新）；token 可读出文本。
**验证**: contract-dod.md `[BEHAVIOR] Step0`（SSOT，可执行 manual:bash）。

---

### Step 1: 获客页点「采集」→ 前置校验 + 读文档扩 3 词（可手输覆盖 / 降级兜底）→ 确认派单返 task_id
**来源**: `[FROM_PRD]` — Golden Path 第 1 条全部子项（前置校验拦截 / 读文档提纯 / 空文档拦截 / DeepSeek 扩 3 词 / 手输优先 / 待确认显示词+来源 / 确认派单返 task_id / DeepSeek 失败有限重试后种子兜底标降级）

**可观测行为**: 未绑飞书/无文档/空文档 → 400 对应错码；正常 → expand 返 3 词 source=ai degraded=false 且 `data` keys 恰为 `["degraded","keywords"]`；manual_keywords 非空 → 3 词 source=manual；DeepSeek 失败 → 种子兜底 source=seed degraded=true；start 派单 → DB `acquisition_collect_tasks` 新增 status=pending，返 task_id；空 keywords → 400 MISSING_KEYWORDS。

**硬阈值**: 3 前置错码字面命中 / ai 词 3 个 source=ai degraded=false 且 data keys 完整 / manual 完全替代 / 降级 source=seed degraded=true / start 返 pending task_id 且 DB 5 分钟内 1 行 / 空 keywords 400。
**验证**: contract-dod.md `[BEHAVIOR] Step1 前置校验三错码` + `[BEHAVIOR] Step1 扩词` + `[BEHAVIOR] Step1 降级 + 派单`（SSOT）。

---

### Step 2: 派单 → Agent 搜 7 视频/词 + 抓评论抖音号（断点续抓 / 可取消 / partial / 离线 pending / 风控 failed）
**来源**: `[FROM_PRD]` — Golden Path 第 2 条 + §边界情况（每词 7 条 ≤7 天爆款、评论全抓、记进度位点断点续抓、取消按钮 cancelling→cancelled 已抓先落库、视频不足/0 评论记 partial+原因、**Agent 离线留 pending 不丢**、**抖音未登录/验证码/风控 failed 区分原因且已抓先落库**）
> 真机真搜真抓（抖音 Chrome CDP 19222 拟人滚动）由 **xian-pc 真机手验**（PRD 假设 3 + E2E 验收点 5），证据附 sprint，不入自动 E2E。自动 E2E 用 **fake-agent**（`/api/acquisition/collect/report` + `X-Smoke-Token`）验**编排 + 断点 + 取消 + partial + 离线 + failed区分 + 落库**。

**可观测行为**:
- 取消 → task status=cancelling，此前已落库的抖音号保留；report 带 checkpoint → `acquisition_collect_tasks.checkpoint` 持久化、重复 video_id 不重复落库（续抓不重来）；report partial → status=partial 且 error_code=partial_reason 可读。
- **Agent 离线**：pending 任务（离线 agent 未领取）即使已过 10min 也保留为 pending 不丢——sweep-timeouts 只转 stale running，不动 pending（PRD「不假死在 running」只针对 running）。
- **抖音风控**：report `terminal=failed,error_code=DOUYIN_RISK`（或 `DOUYIN_CAPTCHA`/`DOUYIN_NOT_LOGGED_IN`）→ task status=failed 且 error_code 字面命中以区分原因；终态前已抓 leads 留存。

**硬阈值**: 首批 inserted=1 / checkpoint 持久化 / 重复 (sec_uid,video) deduped=1 且 leads 仅 1 行 / cancel→cancelling 且已抓保留 / partial+原因可读 / 离线 pending 经 sweep 仍 pending 且行不丢 / failed 后 error_code∈{DOUYIN_RISK,DOUYIN_CAPTCHA,...} 字面命中且两值互异 + 已抓 leads≥1 留存。
**验证**: contract-dod.md `[BEHAVIOR] Step2 断点续抓 + 取消 + partial` + `[BEHAVIOR] Step2 Agent 离线→task 留 pending 不丢` + `[BEHAVIOR] Step2 抖音风控...→terminal=failed`（SSOT，三条）。

---

### Step 3: 增量回报 → 按 (tenant_id, sec_uid) 去重落 DB(SSOT)；sec_uid 缺失昵称兜底
**来源**: `[FROM_PRD]` — Golden Path 第 3 条（按 (tenant_id,sec_uid) 去重，重复仅累加来源 video_id；sec_uid 解析不出 → 昵称兜底入库、标残缺待核、按昵称弱去重、主页链接置空）

**可观测行为**: 同 sec_uid 第二个 video_id → 不新增行，`source_video_ids` 累加；sec_uid 缺失 → 按 nickname 入库 `partial=true`、`profile_url=NULL`，同昵称重复弱去重不新增。

**硬阈值**: 同 sec_uid 跨 2 video → 1 行 + source_video_ids 长度 2 / 缺 sec_uid → partial=t profile_url NULL / 同昵称弱去重 deduped。
**验证**: contract-dod.md `[BEHAVIOR] Step3 去重落库`（SSOT）。

---

### Step 4: DB 写成功 → 写飞书 Leads（失败标「待补写飞书」，采集成功 ≠ 飞书成功）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条（DB 成功后写飞书 Leads → 获客页可见；token 失效自动刷新重试；表被删/建表失败 → 已抓留 DB 标「待补写飞书」+ 提示重建；采集成功 ≠ 飞书写成功）

**可观测行为**: report 落 DB 成功后写飞书 Leads，正常 → `lead_write_status=success` 且 fake-feishu seen-records 出现该抖音号；fake-feishu 注入写失败 → `lead_write_status=pending`（待补写飞书），但 DB lead 仍在、task 不因飞书失败而 failed。

**硬阈值**: 飞书 ok → lead_write_status=success 且 seen-records 含该抖音号 / 飞书 fail → pending 且 DB lead 留存且 task 不 failed。
**验证**: contract-dod.md `[BEHAVIOR] Step4 写飞书`（SSOT）。

---

### Step 5: 获客页可见 7 态 + 计数 + 失败原因 + 抖音号可点跳主页；10min 超时兜底
**来源**: `[FROM_PRD]` — Golden Path 第 5 条（7 态 + 计数几视频/几抖音号/去重前后 + 失败原因 + 抖音号点跳 `https://www.douyin.com/user/<sec_uid>`、残缺号无链接 + 整体 10min 超时自动转 failed/partial 不假死）

**可观测行为**: GET 查状态端点返完整 schema（7 态枚举值 + 三计数 + error_code + leads 含 profile_url 规则）；**stale running**（started 早于 NOW-10min 仍 running）经一次 sweep 转终态（failed/partial）——pending 不受 10min 影响（见 Step2 离线规则）；未知 task_id → 404。

**硬阈值**: 状态 ∈ 7 态枚举 / 三计数为 number + error_code 字段存在 / 正常号 profile_url==douyin 链接、残缺号 null+partial / 超时 running 转 failed|partial / 未知 task 404。
**验证**: contract-dod.md `[BEHAVIOR] Step5 查状态`（SSOT）。

---

### Step 6: 双租户隔离（企业信息文档 / 采集任务 / leads 全 scope 到租户，互不串）
**来源**: `[FROM_PRD]` — 边界情况 + NFR「双租户：企业信息文档/采集任务/leads/去重全 scope 到租户，互不串」+ CLAUDE.md 租户隔离铁律。`[AI_ADDED]` 仅在于把铁律 codify 成跨租户串扰反向断言。
**理由**: 多租户串扰是「采集成功但数据进错客户表」的最危险假绿，必须有反向断言（A 的抖音号绝不出现在 B 的查询里）。

**可观测行为**: 租户 A、B 各跑采集，A 的 collect task / leads 仅 A 可查；同一 sec_uid 在 A、B 各落一行（去重按 (tenant_id,sec_uid) 不跨租户合并）；B 专属抖音号绝不出现在 A 的 leads。

**硬阈值**: 同 sec_uid 两租户各 1 行（去重不跨租户）/ B 专属抖音号在 A leads 计数 0 / 两租户 doc_token 不同。
**验证**: contract-dod.md `[BEHAVIOR] Step6 双租户隔离`（SSOT）。

---

## E2E 验收（最终 final-e2e 跑 — target_environment = windows_cloud · Dashboard 变体 C）

**journey_type**: user_facing
**target_environment**: windows_cloud

> ZenithJoy 获客页是 Dashboard UI（采集入口 + 7 态/计数/失败原因展示 + 抖音号跳主页），按 CLAUDE.md 死规则走 windows_cloud（GitHub Actions windows-latest）。Mode B = `apps/dashboard/e2e/acquisition-collect.spec.ts` Playwright 真实浏览器，用 `page.route()` stub `/api/acquisition/*`（沿用 `path-2-sprint-a.spec.ts` 既有 stub 模式，windows runner 无需起 postgres/后端）。
> 后端 Golden Path（扩词 + 派单 + 去重落库 + 写飞书 + 离线/风控兜底）链路由上面 Step 1~6 的 [BEHAVIOR] manual:bash 在 evaluator 本机（fake-agent + fake-feishu + fake-LLM）验，**与 Mode B UI 验证两层互补**。
> 真机真抓（xian-pc 抖音 CDP）证据另附 sprint，不入自动 E2E。

**写入 `sprints/06181904-acquisition-feishu-doc-collect/e2e-verify.ps1`**（e2e-windows.yml 调用）：

```powershell
# final-e2e — ZenithJoy 获客页采集 Dashboard E2E（windows-latest）
param([string]$BaseUrl = "http://localhost:5174")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\.."  # sprints/ 的上一层 = repo 根
$repoRoot  = Resolve-Path "$repoRoot\.."

# 1. 依赖（显式 WorkingDirectory + cmd.cmd shim）
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci" }
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install" }

# 2. build dashboard
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: dashboard build" }

# 3. vite preview（固定端口，与 baseURL 一致）
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow

# 4. 等就绪（Test-NetConnection 兼容 IPv4/IPv6）
$waited = 0
do { Start-Sleep -Seconds 1; $waited++; $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { Stop-Process -Id $server.Id -Force -EA SilentlyContinue; throw "FAIL: Vite 30s 未就绪" }

# 5. Playwright（stub /api/acquisition/*）
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e\acquisition-collect.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment @{ E2E_BASE_URL = $BaseUrl }
Stop-Process -Id $server.Id -Force -EA SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright 获客页 E2E exit=$($e2e.ExitCode)" }

# 6. 把截图归集进 sprint（evaluator 视觉自验）
New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
Copy-Item "$repoRoot\apps\dashboard\e2e\screenshots\*.png" "$scriptDir\screenshots\" -EA SilentlyContinue
Write-Host "✅ windows_cloud 获客页 E2E 通过"
exit 0
```

**对应 Playwright spec `apps/dashboard/e2e/acquisition-collect.spec.ts`（generator 写，stub 模式断言要点）**：
1. stub `POST /api/acquisition/collect/expand` → 返 3 词 source=ai；点 `[data-testid=acq-collect-button]` → `[data-testid=acq-expand-result]` 出现 3 词 + 来源标签（截图 `01-expand.png`）。
2. stub `POST /api/acquisition/collect/start` → task_id；点 `[data-testid=acq-confirm-button]` → 出现 `[data-testid=acq-task-status]`（截图 `02-dispatched.png`）。
3. stub `GET /api/acquisition/collect/:id` → status=done + video_count=7 + lead_count_raw=12 + lead_count_deduped=9 + 2 leads（1 正常 1 残缺）。断言：`acq-video-count`/`acq-lead-count-raw`/`acq-lead-count-deduped` 文本可见；`acq-lead-profile-link` 的 `href` == `https://www.douyin.com/user/MS4wNORMAL`；残缺号 `acq-lead-partial-badge` 可见且无链接（截图 `03-result.png`）。
4. stub `GET` 返 status=failed + error_code=DOUYIN_RISK → `[data-testid=acq-error-code]` 文本含 `DOUYIN_RISK`（截图 `04-failed.png`）。
> 每个 `expect(...).toBeVisible()/toHaveAttribute(...)` 必须带 timeout，禁止只 goto 不断言。

**PASS 标准**: e2e-verify.ps1 exit 0 + 4 张截图存在；**FAIL**: 任一 throw / Playwright 非 0 / Vite 未就绪。
**GHA workflow**: `.github/workflows/e2e-windows.yml`（已存在，`workflow_dispatch` + windows-latest，调 `$sprint_dir/e2e-verify.ps1`）。

**[CI_GAP]**: 现有 `e2e-windows.yml` 只 checkout + ffmpeg + 跑 ps1，**未装 Node/未 setup**。Generator 必须在 e2e-windows.yml 补 `actions/setup-node@v4`（node 20）step，否则 ps1 内 npm.cmd 不可用。（已读 workflow 内容确认此缺口。）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 扩词 + 前置校验 + 去重落库 + 飞书回写 + 7 态查询 + 离线/风控兜底 | `tests/acquisition-collect.test.ts` | expand 3 词/降级、dedup(sec_uid+昵称)、feishu pending 兜底、7 态 schema、离线 pending 保留判定、failed error_code 区分、租户隔离 | 模块/端点未实现 → import/HTTP/断言 FAIL |
