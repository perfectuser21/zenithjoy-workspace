# Sprint Contract Draft (Round 1) — 客户智能获客：飞书企业信息文档 + 扩词 + 中台采集闭环（Path2 Step4）

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
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "inserted": 0, "deduped": 0, "lead_write_status": "success|pending|failed", "status": "running|done|partial|cancelled|failed"}, "timestamp": "<iso>"}
```
- `data.inserted` (int): 本批去重后新落库抖音号数；`data.deduped` (int): 本批命中既有 (tenant_id,sec_uid)/昵称 而仅累加 video_id 的数
- `data.lead_write_status` (enum `success`|`pending`|`failed`): 来源——PRD Step4，`pending`=「待补写飞书」(飞书失败但采集成功)
**禁用字段名**: `count`、`leads`、`written`、`ok`
**Error**: `NO_COLLECT_TASK` (404) / `MISSING_VIDEO_ID` (400)

### Endpoint 5: GET /api/acquisition/collect/:task_id（获客页查状态 — 7 态 + 计数 + 失败原因 + 抖音号）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "status": "running", "video_count": 0, "lead_count_raw": 0, "lead_count_deduped": 0, "error_code": null, "degraded": false, "leads": [{"sec_uid": "<string|null>", "nickname": "<string>", "profile_url": "<string|null>", "partial": false}]}, "timestamp": "<iso>"}
```
- `data.status` (enum 7 态, 必填): `pending`|`running`|`cancelling`|`cancelled`|`done`|`partial`|`failed` —— 来源 PRD Step5「7 态」
- `data.video_count` / `data.lead_count_raw` / `data.lead_count_deduped` (int, 必填): 来源 PRD Step5「几视频/几抖音号/去重前后」
- `data.error_code` (string|null) / `data.leads[].partial` (boolean): 残缺/待核标记——PRD Step3「sec_uid 缺失 → 昵称兜底、标残缺、无主页链接」
- `data.leads[].profile_url`: `sec_uid` 非空时 == `https://www.douyin.com/user/<sec_uid>`，残缺号 == null
**禁用字段名**: `state`、`videos`、`count`、`lead_count`(裸)、`error`(顶层 data 内)
**Error**: `NO_COLLECT_TASK` (404)

---

## Golden Path
绑飞书自动建企业信息 docx(存 doc_token) → 主理人在飞书写企业信息 → 获客页点「采集」(前置校验 + 读文档扩 3 词,可手输覆盖,降级兜底) → 确认派单返 task_id → 客户机 Agent 搜 7 视频/词 + 抓评论区抖音号(断点续抓/可取消) → 增量回报按 (tenant_id,sec_uid) 去重落 DB(SSOT) → 写飞书 Leads(失败标「待补写飞书」) → 获客页看到 7 态 + 计数 + 失败原因 + 抖音号可点跳主页。

### Step 0: 绑飞书时系统自动建「企业信息」docx，存 doc_token
**来源**: `[FROM_PRD]` — Golden Path 第 0 条「绑飞书时系统自动建『企业信息』飞书文档(docx)，存 doc_token；主理人在飞书自由编辑」

**可观测行为**: 飞书 provision 流程在建 Bitable 之外，新建一篇 docx 并把 `enterprise_doc_token` 写入 `tenant_feishu_bindings`；该 token 可被 expand 端点读出纯文本。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
# 模拟 provision 后状态：binding 已写 enterprise_doc_token
seed_acq prov 1
TOK=$(psql "$DB" -At -c "SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND enterprise_doc_token IS NOT NULL")
[ -n "$TOK" ] || { echo "FAIL: enterprise_doc_token 未入库"; exit 1; }
# provision 入口（rebuild）真的会建 docx 并回填 token（验证 provision 代码路径，而非只读 seed）
psql "$DB" -c "UPDATE zenithjoy.tenant_feishu_bindings SET enterprise_doc_token=NULL WHERE tenant_id='$TENANT_ID'" >/dev/null
curl -sf -X POST "$API_BASE/api/feishu/oauth/rebuild" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}" >/dev/null
NEWTOK=$(psql "$DB" -At -c "SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND enterprise_doc_token IS NOT NULL AND updated_at > NOW() - interval '2 minutes'")
[ -n "$NEWTOK" ] || { echo "FAIL: rebuild 未重建 docx / 未回填 token"; exit 1; }
echo OK
```

**硬阈值**: provision/rebuild 后 `tenant_feishu_bindings.enterprise_doc_token` 非空（2 分钟内更新）；token 可读出文本。

---

### Step 1: 获客页点「采集」→ 前置校验 + 读文档扩 3 词（可手输覆盖 / 降级兜底）→ 确认派单返 task_id
**来源**: `[FROM_PRD]` — Golden Path 第 1 条全部子项（前置校验拦截 / 读文档提纯 / 空文档拦截 / DeepSeek 扩 3 词 / 手输优先 / 待确认显示词+来源 / 确认派单返 task_id / DeepSeek 失败有限重试后种子兜底标降级）

**可观测行为**: 未绑飞书/无文档/空文档 → 400 对应错码；正常 → expand 返 3 词 source=ai degraded=false；manual_keywords 非空 → 3 词 source=manual；DeepSeek 失败 → 种子兜底 source=seed degraded=true；start 派单 → DB `acquisition_collect_tasks` 新增 status=pending，返 task_id。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
# 前置校验：未绑飞书 → FEISHU_NOT_BOUND
seed_acq nobind 1
psql "$DB" -c "DELETE FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID'" >/dev/null
C=$(curl -s -o /tmp/acq_e1.json -w '%{http_code}' -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
[ "$C" = "400" ] && jq -e '.error.code=="FEISHU_NOT_BOUND"' /tmp/acq_e1.json || { echo "FAIL: 未绑飞书未拦截"; exit 1; }
# 前置校验：无企业文档 → NO_ENTERPRISE_DOC
seed_acq nodoc 0
C=$(curl -s -o /tmp/acq_e2.json -w '%{http_code}' -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
[ "$C" = "400" ] && jq -e '.error.code=="NO_ENTERPRISE_DOC"' /tmp/acq_e2.json || { echo "FAIL: 无文档未拦截"; exit 1; }
# 前置校验：空文档（纯文本 < 20 字）→ EMPTY_DOC
seed_acq empty 1; set_enterprise_doc "$TENANT_ID" "图"
C=$(curl -s -o /tmp/acq_e3.json -w '%{http_code}' -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
[ "$C" = "400" ] && jq -e '.error.code=="EMPTY_DOC"' /tmp/acq_e3.json || { echo "FAIL: 空文档未拦截"; exit 1; }
# 正常扩词：fake-LLM 返 3 词 → source=ai degraded=false + schema 完整性 + 禁用字段
seed_acq ok 1; set_enterprise_doc "$TENANT_ID" "行业:家装全屋定制 受众:30-45 岁新房业主 卖点:环保板材 钩子:免费上门量房设计"
curl -sf -X POST "${FAKE_LLM_BASE}/__test/llm-mode" -H "Content-Type: application/json" -d '{"mode":"ok"}' >/dev/null
RESP=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
echo "$RESP" | jq -e '.success==true and (.data.keywords|length==3) and (.data.keywords|all(.source=="ai")) and (.data.degraded==false)' || { echo "FAIL: ai 扩词 schema 不符"; exit 1; }
echo "$RESP" | jq -e '(.data.keyword|not) and (.data.words|not) and (.data.result|not) and (.data.negation|not)' || { echo "FAIL: 出现禁用字段"; exit 1; }
# 手输覆盖：manual_keywords 完全替代 → source=manual
RESP=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"manual_keywords\":[\"装修\",\"软装\",\"定制柜\"]}")
echo "$RESP" | jq -e '(.data.keywords|map(.word)==["装修","软装","定制柜"]) and (.data.keywords|all(.source=="manual"))' || { echo "FAIL: 手输未完全替代"; exit 1; }
# 降级兜底：fake-LLM 返 401 → 有限重试后种子兜底 source=seed degraded=true
curl -sf -X POST "${FAKE_LLM_BASE}/__test/llm-mode" -H "Content-Type: application/json" -d '{"mode":"fail"}' >/dev/null
RESP=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
echo "$RESP" | jq -e '.data.degraded==true and (.data.keywords|length==3) and (.data.keywords|all(.source=="seed"))' || { echo "FAIL: 降级未走种子兜底"; exit 1; }
# 派单：confirm → task_id + DB pending
RESP=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/start" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"keywords\":[\"装修\",\"软装\",\"定制柜\"]}")
echo "$RESP" | jq -e '.success==true and (.data.task_id|type=="string") and .data.status=="pending"' || { echo "FAIL: 派单未返 task_id/pending"; exit 1; }
TID=$(echo "$RESP" | jq -r '.data.task_id')
CNT=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE id='$TID' AND tenant_id='$TENANT_ID' AND status='pending' AND created_at > NOW() - interval '5 minutes'")
[ "$CNT" = "1" ] || { echo "FAIL: collect task 未落库 cnt=$CNT"; exit 1; }
# 派单守卫：keywords 空 → 400 MISSING_KEYWORDS
C=$(curl -s -o /tmp/acq_e4.json -w '%{http_code}' -X POST "$API_BASE/api/acquisition/collect/start" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"keywords\":[]}")
[ "$C" = "400" ] && jq -e '.error.code=="MISSING_KEYWORDS"' /tmp/acq_e4.json || { echo "FAIL: 空 keywords 未拦截"; exit 1; }
echo OK
```

**硬阈值**: 3 前置错码字面命中 / ai 词 3 个 source=ai degraded=false / manual 完全替代 / 降级 source=seed degraded=true / start 返 pending task_id 且 DB 5 分钟内 1 行 / 空 keywords 400。

---

### Step 2: 派单 → Agent 搜 7 视频/词 + 抓评论抖音号（断点续抓 / 可取消 / partial）
**来源**: `[FROM_PRD]` — Golden Path 第 2 条（每词 7 条 ≤7 天爆款、评论全抓、记进度位点断点续抓、取消按钮 cancelling→cancelled 已抓先落库、视频不足/0 评论记 partial+原因、Agent 离线留 pending、抖音风控 failed 区分原因）
> 真机真搜真抓（抖音 Chrome CDP 19222 拟人滚动）由 **xian-pc 真机手验**（PRD 假设 3 + E2E 验收点 5），证据附 sprint，不入自动 E2E。自动 E2E 用 **fake-agent**（`/api/acquisition/collect/report` + `X-Smoke-Token`）验**编排 + 断点 + 取消 + partial + 落库**。

**可观测行为**: cancel → task status=cancelling，此前已落库的抖音号保留；report 带 checkpoint → `acquisition_collect_tasks.checkpoint` 持久化、重复 video_id 不重复落库（续抓不重来）；report partial_reason → status=partial 且原因可读。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
seed_acq step2 1; seed_collect_task "$TENANT_ID" running
# 先报一批抖音号（已抓）
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"装修\",\"video_id\":\"v100\",\"commenters\":[{\"sec_uid\":\"MS4wS2A\",\"nickname\":\"业主A\"}],\"checkpoint\":{\"keyword_idx\":0,\"video_idx\":1,\"scroll_offset\":800}}" | jq -e '.data.inserted==1' || { echo "FAIL: 首批未落库"; exit 1; }
# 断点续抓：checkpoint 持久化
CP=$(psql "$DB" -At -c "SELECT checkpoint->>'video_idx' FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
[ "$CP" = "1" ] || { echo "FAIL: checkpoint 未持久化 cp=$CP"; exit 1; }
# 续抓重复 video_id 同 sec_uid → 不重复落库（deduped，不 inserted）
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"装修\",\"video_id\":\"v100\",\"commenters\":[{\"sec_uid\":\"MS4wS2A\",\"nickname\":\"业主A\"}]}" | jq -e '.data.inserted==0 and .data.deduped==1' || { echo "FAIL: 续抓重复未去重"; exit 1; }
LCNT=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND sec_uid='MS4wS2A'")
[ "$LCNT" = "1" ] || { echo "FAIL: 同 sec_uid 落了 $LCNT 行（应 1）"; exit 1; }
# 取消：cancelling，已抓保留
curl -sf -X POST "$API_BASE/api/acquisition/collect/cancel" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"task_id\":\"$COLLECT_TASK_ID\"}" | jq -e '.data.status=="cancelling"' || { echo "FAIL: 取消未置 cancelling"; exit 1; }
ST=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID' AND updated_at > NOW() - interval '5 minutes'")
[ "$ST" = "cancelling" ] || { echo "FAIL: 状态非 cancelling st=$ST"; exit 1; }
KEPT=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID'")
[ "$KEPT" -ge 1 ] || { echo "FAIL: 取消后已抓抖音号丢失"; exit 1; }
# partial：视频不足/0 评论 → status=partial + 原因
seed_collect_task "$TENANT_ID" running
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"冷门词\",\"video_id\":\"v0\",\"commenters\":[],\"partial_reason\":\"video_insufficient\",\"terminal\":\"partial\"}" | jq -e '.data.status=="partial"' || { echo "FAIL: partial 未置位"; exit 1; }
PR=$(psql "$DB" -At -c "SELECT error_code FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
[ "$PR" = "video_insufficient" ] || { echo "FAIL: partial 原因未记 pr=$PR"; exit 1; }
echo OK
```

**硬阈值**: 首批 inserted=1 / checkpoint 持久化 / 重复 (sec_uid,video) deduped=1 且 leads 仅 1 行 / cancel→cancelling 且已抓保留 / partial+原因可读。

---

### Step 3: 增量回报 → 按 (tenant_id, sec_uid) 去重落 DB(SSOT)；sec_uid 缺失昵称兜底
**来源**: `[FROM_PRD]` — Golden Path 第 3 条（按 (tenant_id,sec_uid) 去重，重复仅累加来源 video_id；sec_uid 解析不出 → 昵称兜底入库、标残缺待核、按昵称弱去重、主页链接置空）

**可观测行为**: 同 sec_uid 第二个 video_id → 不新增行，`source_video_ids` 累加；sec_uid 缺失 → 按 nickname 入库 `partial=true`、`profile_url=NULL`，同昵称重复弱去重不新增。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
seed_acq step3 1; seed_collect_task "$TENANT_ID" running
# 同 sec_uid 两个不同 video_id → 仅累加 source_video_ids，不新增行
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vA\",\"commenters\":[{\"sec_uid\":\"MS4wDUP\",\"nickname\":\"张三\"}]}" >/dev/null
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vB\",\"commenters\":[{\"sec_uid\":\"MS4wDUP\",\"nickname\":\"张三\"}]}" | jq -e '.data.inserted==0 and .data.deduped==1' || { echo "FAIL: 跨视频同 sec_uid 未去重"; exit 1; }
ROWS=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND sec_uid='MS4wDUP'")
VIDS=$(psql "$DB" -At -c "SELECT jsonb_array_length(source_video_ids) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND sec_uid='MS4wDUP'")
[ "$ROWS" = "1" ] && [ "$VIDS" = "2" ] || { echo "FAIL: 去重/累加错 rows=$ROWS vids=$VIDS"; exit 1; }
# sec_uid 缺失 → 昵称兜底 partial=true profile_url NULL
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vC\",\"commenters\":[{\"nickname\":\"匿名李四\"}]}" | jq -e '.data.inserted==1' || { echo "FAIL: 昵称兜底未入库"; exit 1; }
PARTIAL=$(psql "$DB" -At -c "SELECT partial FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='匿名李四' AND sec_uid IS NULL")
LINK=$(psql "$DB" -At -c "SELECT coalesce(profile_url,'NULL') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='匿名李四' AND sec_uid IS NULL")
[ "$PARTIAL" = "t" ] && [ "$LINK" = "NULL" ] || { echo "FAIL: 残缺标记错 partial=$PARTIAL link=$LINK"; exit 1; }
# 同昵称弱去重：再报「匿名李四」无 sec_uid → 不新增
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vD\",\"commenters\":[{\"nickname\":\"匿名李四\"}]}" | jq -e '.data.inserted==0 and .data.deduped==1' || { echo "FAIL: 昵称弱去重失效"; exit 1; }
echo OK
```

**硬阈值**: 同 sec_uid 跨 2 video → 1 行 + source_video_ids 长度 2 / 缺 sec_uid → partial=t profile_url NULL / 同昵称弱去重 deduped。

---

### Step 4: DB 写成功 → 写飞书 Leads（失败标「待补写飞书」，采集成功 ≠ 飞书成功）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条（DB 成功后写飞书 Leads → 获客页可见；token 失效自动刷新重试；表被删/建表失败 → 已抓留 DB 标「待补写飞书」+ 提示重建；采集成功 ≠ 飞书写成功）

**可观测行为**: report 落 DB 成功后写飞书 Leads，正常 → `lead_write_status=success` 且 fake-feishu seen-records 出现该抖音号；fake-feishu 注入写失败 → `lead_write_status=pending`（待补写飞书），但 DB lead 仍在、task 不因飞书失败而 failed。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
curl -sf -X POST "${FEISHU_API_BASE}/__test/reset" >/dev/null
seed_acq step4 1; seed_collect_task "$TENANT_ID" running
# 正常写飞书成功
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vF1\",\"commenters\":[{\"sec_uid\":\"MS4wFEISHU\",\"nickname\":\"飞书业主\"}]}" | jq -e '.data.lead_write_status=="success"' || { echo "FAIL: 飞书写未 success"; exit 1; }
sleep 1
curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_acq_leads" | jq -e '[.records[]|select(.["抖音号"]=="MS4wFEISHU")]|length>=1' || { echo "FAIL: 飞书 Leads 无该抖音号"; exit 1; }
# 飞书写失败 → 待补写飞书 pending，DB lead 仍在，task 不 failed
curl -sf -X POST "${FEISHU_API_BASE}/__test/set-write-mode" -H "Content-Type: application/json" -d '{"mode":"fail"}' >/dev/null
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vF2\",\"commenters\":[{\"sec_uid\":\"MS4wPENDING\",\"nickname\":\"待补业主\"}]}" | jq -e '.data.lead_write_status=="pending"' || { echo "FAIL: 飞书失败未标 pending"; exit 1; }
WS=$(psql "$DB" -At -c "SELECT feishu_write_status FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND sec_uid='MS4wPENDING'")
[ "$WS" = "pending" ] || { echo "FAIL: DB lead 未标待补写 ws=$WS"; exit 1; }
TST=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
[ "$TST" != "failed" ] || { echo "FAIL: 飞书失败连累 task=failed（采集成功≠飞书成功被违反）"; exit 1; }
curl -sf -X POST "${FEISHU_API_BASE}/__test/set-write-mode" -H "Content-Type: application/json" -d '{"mode":"ok"}' >/dev/null
echo OK
```

**硬阈值**: 飞书 ok → lead_write_status=success 且 seen-records 含该抖音号 / 飞书 fail → pending 且 DB lead 留存且 task 不 failed。

---

### Step 5: 获客页可见 7 态 + 计数 + 失败原因 + 抖音号可点跳主页；10min 超时兜底
**来源**: `[FROM_PRD]` — Golden Path 第 5 条（7 态 + 计数几视频/几抖音号/去重前后 + 失败原因 + 抖音号点跳 `https://www.douyin.com/user/<sec_uid>`、残缺号无链接 + 整体 10min 超时自动转 failed/partial 不假死）

**可观测行为**: GET 查状态端点返完整 schema（7 态枚举值 + 三计数 + error_code + leads 含 profile_url 规则）；超时任务（started 早于 NOW-10min 仍 running）经一次 tick/扫描后转终态（failed/partial）；未知 task_id → 404。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
seed_acq step5 1; seed_collect_task "$TENANT_ID" running
# 落 2 抖音号（1 正常 1 残缺）+ 视频计数
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"k\",\"video_id\":\"vV1\",\"commenters\":[{\"sec_uid\":\"MS4wNORMAL\",\"nickname\":\"正常号\"},{\"nickname\":\"残缺号\"}],\"terminal\":\"done\"}" >/dev/null
RESP=$(curl -sf "$API_BASE/api/acquisition/collect/$COLLECT_TASK_ID")
echo "$RESP" | jq -e '.success==true and (["pending","running","cancelling","cancelled","done","partial","failed"]|index(.data.status)) != null' || { echo "FAIL: status 非 7 态枚举"; exit 1; }
echo "$RESP" | jq -e '(.data.video_count|type=="number") and (.data.lead_count_raw|type=="number") and (.data.lead_count_deduped|type=="number") and (.data|has("error_code"))' || { echo "FAIL: 计数/error_code schema 缺"; exit 1; }
# 正常号 profile_url == douyin user 链接；残缺号 profile_url null + partial true
echo "$RESP" | jq -e '[.data.leads[]|select(.sec_uid=="MS4wNORMAL")]|any(.profile_url=="https://www.douyin.com/user/MS4wNORMAL")' || { echo "FAIL: 正常号主页链接错"; exit 1; }
echo "$RESP" | jq -e '[.data.leads[]|select(.nickname=="残缺号" and .sec_uid==null)]|any(.profile_url==null and .partial==true)' || { echo "FAIL: 残缺号链接/标记错"; exit 1; }
# 禁用字段反向：data 不得含 state/videos/count
echo "$RESP" | jq -e '(.data.state|not) and (.data.videos|not) and (.data.count|not)' || { echo "FAIL: 出现禁用字段"; exit 1; }
# 10min 超时兜底：制造一条 11 分钟前 started 仍 running 的任务 → 扫描后转终态
seed_collect_task "$TENANT_ID" running
psql "$DB" -c "UPDATE zenithjoy.acquisition_collect_tasks SET started_at = NOW() - interval '11 minutes', updated_at = NOW() - interval '11 minutes' WHERE id='$COLLECT_TASK_ID'" >/dev/null
curl -sf -X POST "$API_BASE/api/acquisition/collect/sweep-timeouts" -H "X-Smoke-Token: $SMOKE_TOKEN" >/dev/null
TST=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='$COLLECT_TASK_ID'")
case "$TST" in failed|partial) ;; *) echo "FAIL: 超时未转终态 st=$TST"; exit 1;; esac
# 未知 task_id → 404 NO_COLLECT_TASK
C=$(curl -s -o /tmp/acq404.json -w '%{http_code}' "$API_BASE/api/acquisition/collect/00000000-0000-0000-0000-000000000000")
[ "$C" = "404" ] && jq -e '.error.code=="NO_COLLECT_TASK"' /tmp/acq404.json || { echo "FAIL: 未知 task 未 404"; exit 1; }
echo OK
```

**硬阈值**: 状态 ∈ 7 态枚举 / 三计数为 number + error_code 字段存在 / 正常号 profile_url==douyin 链接、残缺号 null+partial / 超时任务转 failed|partial / 未知 task 404。

---

### Step 6: 双租户隔离（企业信息文档 / 采集任务 / leads 全 scope 到租户，互不串）
**来源**: `[FROM_PRD]` — 边界情况 + NFR「双租户：企业信息文档/采集任务/leads/去重全 scope 到租户，互不串」+ CLAUDE.md 租户隔离铁律。`[AI_ADDED]` 仅在于把铁律 codify 成跨租户串扰反向断言。
**理由**: 多租户串扰是「采集成功但数据进错客户表」的最危险假绿，必须有反向断言（A 的抖音号绝不出现在 B 的查询里）。

**可观测行为**: 租户 A、B 各跑采集，A 的 collect task / leads 仅 A 可查；同一 sec_uid 在 A、B 各落一行（去重按 (tenant_id,sec_uid) 不跨租户合并）；GET A 的 task 用 B 身份/B 的 task_id 查不到对方数据。

**验证命令**:
```bash
source sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh
seed_acq tenantA 1; TA="$TENANT_ID"; AA="$AGENT_ID"; seed_collect_task "$TA" running; CTA="$COLLECT_TASK_ID"
seed_acq tenantB 1; TB="$TENANT_ID"; AB="$AGENT_ID"; seed_collect_task "$TB" running; CTB="$COLLECT_TASK_ID"
# 同一 sec_uid 两租户各报一次
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$CTA\",\"agent_id\":\"$AA\",\"keyword\":\"k\",\"video_id\":\"vT1\",\"commenters\":[{\"sec_uid\":\"MS4wSHARED\",\"nickname\":\"共享号\"}]}" >/dev/null
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$CTB\",\"agent_id\":\"$AB\",\"keyword\":\"k\",\"video_id\":\"vT2\",\"commenters\":[{\"sec_uid\":\"MS4wSHARED\",\"nickname\":\"共享号\"}]}" >/dev/null
# 去重不跨租户：A、B 各 1 行（共 2 行）
A_ROWS=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TA' AND sec_uid='MS4wSHARED'")
B_ROWS=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TB' AND sec_uid='MS4wSHARED'")
[ "$A_ROWS" = "1" ] && [ "$B_ROWS" = "1" ] || { echo "FAIL: 跨租户去重串了 A=$A_ROWS B=$B_ROWS"; exit 1; }
# A 的 leads 里绝不含 B 专属抖音号（反向断言）
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$CTB\",\"agent_id\":\"$AB\",\"keyword\":\"k\",\"video_id\":\"vT3\",\"commenters\":[{\"sec_uid\":\"MS4wONLYB\",\"nickname\":\"仅B\"}]}" >/dev/null
LEAK=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$TA' AND sec_uid='MS4wONLYB'")
[ "$LEAK" = "0" ] || { echo "FAIL: B 的抖音号串进 A leak=$LEAK"; exit 1; }
# 企业文档 token 不串
DTA=$(psql "$DB" -At -c "SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TA'")
DTB=$(psql "$DB" -At -c "SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TB'")
[ "$DTA" != "$DTB" ] || { echo "FAIL: 两租户企业文档 token 相同（串了）"; exit 1; }
echo OK
```

**硬阈值**: 同 sec_uid 两租户各 1 行（去重不跨租户）/ B 专属抖音号在 A leads 计数 0 / 两租户 doc_token 不同。

---

## E2E 验收（最终 final-e2e 跑 — target_environment = windows_cloud · Dashboard 变体 C）

**journey_type**: user_facing
**target_environment**: windows_cloud

> ZenithJoy 获客页是 Dashboard UI（采集入口 + 7 态/计数/失败原因展示 + 抖音号跳主页），按 CLAUDE.md 死规则走 windows_cloud（GitHub Actions windows-latest）。Mode B = `apps/dashboard/e2e/acquisition-collect.spec.ts` Playwright 真实浏览器，用 `page.route()` stub `/api/acquisition/*`（沿用 `path-2-sprint-a.spec.ts` 既有 stub 模式，windows runner 无需起 postgres/后端）。
> 后端 Golden Path（扩词 + 派单 + 去重落库 + 写飞书）链路由上面 Step 1~6 的 [BEHAVIOR] manual:bash 在 evaluator 本机（fake-agent + fake-feishu + fake-LLM）验，**与 Mode B UI 验证两层互补**。
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
| 扩词 + 前置校验 + 去重落库 + 飞书回写 + 7 态查询 | `tests/acquisition-collect.test.ts` | expand 3 词/降级、dedup(sec_uid+昵称)、feishu pending 兜底、7 态 schema、租户隔离 | 模块/端点未实现 → import/HTTP/断言 FAIL |
