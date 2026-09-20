# Sprint Contract Draft (Round 1) — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

## 锚定父路声明

覆盖父路 line05/batch_mashup 第 1-4 步（加厚 thin→medium：文案驱动动态分段 / 素材在线播放预览 / 候选 200+ 缩略图拼贴虚拟滚动 / 选中才真实 ffmpeg 渲染 + 并发=1 队列 + 渲染失败态）。第 5 步（内容安全自查 + 结果页播放）已有 S4 实现，本 sprint 不动。

## GP-Anchor

GP-Anchor: line05/batch_mashup#step1-4

（已用 jq 核实 line05/batch_mashup 存在于 product-map/generated/product-map.json，返回 1。）

---

## Response Schema（推导来源: api_registry 推导 + PRD 字面）

统一响应信封（沿用 routes/mashup.ts 现有 `ok()`/`fail()`，字面不改）：
- 成功：`{ "success": true, "data": <endpoint-specific>, "error": null, "timestamp": <ISO8601> }`
- 失败：`{ "success": false, "data": null, "error": { "code": <string>, "message": <string> }, "timestamp": <ISO8601> }`
- 鉴权：请求头 `X-Upload-Token: <license_key>`，服务端 `validateLicense(token)` 反查 tenant，**绝不信客户端自报 tenant_id**（与 materials.ts / mashup.ts 同口径）。

### Endpoint 1（新增）: POST /api/mashup/templates/from-script
**Request**: `{ "script": <string 非空> }`
**Success (HTTP 200) data**:
```json
{"templateId":"<uuid>","segments":[{"slotKey":"seg1","roleTag":"开场","suggestedCount":2,"mapped":true}],"degraded":false,"source":"ai"}
```
- `templateId` (string, 必填): 新落库的 zenithjoy.mashup_templates 行 id
- `segments` (array, 必填): 动态分段（**非写死 4 段**），每段 `{slotKey, roleTag, suggestedCount, mapped}`
- `mapped` (boolean, 必填): roleTag 是否命中现有 ai_tags 词表；false = "兜底映射"（决策 f33415af）
- `degraded` (boolean, 必填): AI 服务不可用时 true
- `source` (string, 必填): `"ai"` | `"fallback"`；degraded=true ⇒ source="fallback"（静默降级固定模板，非阻断）
**禁用字段名**: `id`（用 templateId）、`slots`（对外用 segments）、`fallbackUsed`（用 degraded）
**Error (HTTP 4xx)**: `{ "error": { "code": "INVALID_BODY", ... } }`（script 缺失/空 → 400）

### Endpoint 2（新增）: GET /api/materials/:id/signed-url
**Success (HTTP 200) data**:
```json
{"materialId":"<uuid>","previewUrl":"<signed url>","mimeType":"video/mp4","playable":true}
```
- `previewUrl` (string, 必填): `storage.getSignedUrl(storage_key)` 新签发（支持前端过期自动重签）
- `playable` (boolean, 必填): mime_type 以 `video/` 开头即 true
**Error**: 素材不存在或不属于当前租户 → 404 `MATERIAL_NOT_FOUND`

### Endpoint 3（改造）: GET /api/mashup/runs/:id/candidates
**Success (HTTP 200) data**（在现有基础上新增 `generatedCount` 与每条候选 `thumbnailUrl`）:
```json
{"runId":"<uuid>","selectedCandidateId":null,"generatedCount":137,"candidates":[{"id":"<uuid>","score":2.3,"slotFill":{"seg1":"<mid>"},"thumbnailUrl":"<url|null>"}]}
```
- `generatedCount` (number, 必填): 该 run 实际候选数（"共生成 N 条候选"，如实显示，不承诺 200，决策 3ed368c3）
- `thumbnailUrl` (string|null, 必填字段): 缩略图拼贴 URL（抽帧自 video-frame-extract.ts；真实拼贴属接缝，见 ## 接缝清单）
POST /api/mashup/runs/:id/candidates 同步返回 `generatedCount` + 候选 `thumbnailUrl`；`targetCount` 上限沿用现有 HARD_MAX_TARGET_COUNT=300（≥200 已满足）。

### Endpoint 4（改造）: POST /api/mashup/candidates/:id/render
**Success (HTTP 200) data**（在现有 RenderResult 基础上新增队列/态字段，向后兼容）:
```json
{"jobId":"<uuid>","candidateId":"<uuid>","status":"rendering","queuePosition":0,"contentId":null,"safetyCheckStatus":null,"watermarkCheckStatus":null,"downloadUrl":null,"error":null}
```
- `status` (string, 必填): `"queued"` | `"rendering"` | `"completed"` | `"render_failed"`
- `queuePosition` (number, 必填): rendering/completed=0；queued≥1（"第 N 位"）
- 并发=1：已有 rendering 作业时新请求进 queued（hk-vps 4 核硬约束，决策 d6bedf80）
- `completed` 时回填 `contentId` / `safetyCheckStatus` / `watermarkCheckStatus` / `downloadUrl`（fail-closed：任一 gate ≠ passed ⇒ downloadUrl=null，沿用 S4）
- `render_failed` 时回填 `error`；对 render_failed 候选再次 POST render = 重试（重新入队/开渲，非死路）

---

## Golden Path

[粘贴文案] → [动态分段模板] → [素材在线预览选素材] → [浏览 200+ 候选缩略图] → [选中一条才真实 ffmpeg 渲染] → [结果页播放成片]

### Step 1: 客户粘贴文案 → 生成动态分段模板
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（sprint-prd.md L18）

**可观测行为**: POST /api/mashup/templates/from-script 传一段文案，返回 `segments`（动态分段，非写死 4 段）+ `mapped` 标注 + `degraded`/`source`，并在 zenithjoy.mashup_templates 落一条本租户模板行；AI 不可用时静默降级固定模板（degraded=true、非阻断）。

**验证命令**:
```bash
RESP=$(curl -sf -X POST "$BASE_URL/api/mashup/templates/from-script" -H "X-Upload-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"script":"开场：主角清晨厨房。产品展示：保温杯特写。结尾：号召下单。"}')
echo "$RESP" | jq -e '.success==true and (.data.templateId|type=="string") and (.data.segments|length>=1) and (.data.degraded|type=="boolean") and (.data.segments[0]|has("roleTag") and has("suggestedCount") and has("mapped"))'
```
**硬阈值**: HTTP 200；segments≥1；每段含 roleTag/suggestedCount/mapped；空文案返 400。

---

### Step 2: 素材选择器在线播放预览
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（L20-22）

**可观测行为**: GET /api/materials/:id/signed-url 对视频素材返回新签发的 `previewUrl` + `playable=true`（前端渲染 `<video>`，signedUrl 过期时前端自动重签）；他租户素材 404（租户隔离）。

**验证命令**:
```bash
RESP=$(curl -sf "$BASE_URL/api/materials/$MATERIAL_ID/signed-url" -H "X-Upload-Token: $TOKEN")
echo "$RESP" | jq -e '.data.playable==true and (.data.previewUrl|type=="string") and (.data.previewUrl|length>0)'
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/materials/$OTHER_TENANT_MATERIAL_ID/signed-url" -H "X-Upload-Token: $TOKEN")
[ "$CODE" = "404" ] || { echo "FAIL: 跨租户素材未 404 (got $CODE)"; exit 1; }
```
**硬阈值**: 本租户视频 playable=true 且 previewUrl 非空；他租户 404。

---

### Step 3: 生成候选 200+ → 缩略图拼贴虚拟滚动浏览
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（L23-25）

**可观测行为**: POST /runs/:id/candidates（targetCount=200）复用 J10 去重（Jaccard 0.8）+ beamWidth，返回 `generatedCount`（如实数量）+ 每条候选 `thumbnailUrl`（缩略图拼贴，抽帧非真渲染）；此阶段 contents 表无该 run 产物（未真实渲染）。前端虚拟滚动 DOM 节点数与可视区一致。

**验证命令**:
```bash
RESP=$(curl -sf -X POST "$BASE_URL/api/mashup/runs/$RUN_ID/candidates" -H "X-Upload-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"targetCount":200}')
echo "$RESP" | jq -e '(.data.generatedCount|type=="number") and (.data.candidates|length>=1) and (.data.candidates[0]|has("thumbnailUrl"))'
N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.contents WHERE source_candidate_id IN (SELECT id FROM zenithjoy.mashup_candidates WHERE run_id='$RUN_ID')")
[ "$N" = "0" ] || { echo "FAIL: 候选阶段不应有渲染产物, got $N"; exit 1; }
```
**硬阈值**: generatedCount 为数字（≤targetCount 去重后实际值）；每条含 thumbnailUrl 字段；候选阶段 contents 产物数=0。

---

### Step 4: 选中一条 → 此刻才真实渲染 + 并发=1 队列 + 失败态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（L26-28）；队列位/失败态字段为 `[FROM_PRD]`（PRD 边界情况 L38-39）

**可观测行为**: POST /candidates/:id/render 返回 `status`/`queuePosition`；已有 rendering 作业时新请求进 `queued`（queuePosition≥1）；渲染失败落 `render_failed` 态且可再次 POST 重试。渲染真实产出 1080P 成片（接缝，staging 验）。

**验证命令**:
```bash
# 已有在飞作业时新请求进队列（并发=1）——用 psql 造在飞作业，避免测试真起 ffmpeg
psql "$DB_URL" -c "INSERT INTO zenithjoy.mashup_render_jobs (tenant_id, run_id, candidate_id, status) VALUES ('$TENANT_ID','$RUN_ID','$CAND1','rendering')"
RESP=$(curl -sf -X POST "$BASE_URL/api/mashup/candidates/$CAND2/render" -H "X-Upload-Token: $TOKEN")
echo "$RESP" | jq -e '.data.status=="queued" and (.data.queuePosition>=1)'
```
**硬阈值**: 并发>1 时第二请求 status=queued 且 queuePosition≥1；render_failed 可重试（再 POST 不 4xx）。

---

## 真实调用方请求 shape

本 sprint 的服务端调用方是 **Dashboard 浏览器前端**（apps/dashboard/src/api/mashup.api.ts / materials.api.ts），非设备 agent。生产调用方认证与关键字段（逐字段一致，DoD 断言按此构造）：
- 认证：HTTP 请求头 `X-Upload-Token: <license_key>`（**header，不是 body**；`getUploadToken()` 从 account metadata 取 license_key）。禁止 DoD 用 body 传 tenant_id/token。
- Content-Type: `application/json`；POST body 字段名逐字：from-script→`{script}`；runs→`{templateId, materialIds}`；candidates→`{targetCount}`。
- 前端 API client 端点前缀 `/mashup`、`/materials`（挂载于 `/api/mashup`、`/api/materials`）。

---

## 禁 mock 边清单

本单涉及 DB 写路径 + 状态机 + 跨模块数据传递，以下边**禁 mock**（generator 测试中 vi.mock/stub 命中即 CONTRACT-IS-LAW FAIL，evaluator 机械 grep 核查）：

- 代码 ↔ zenithjoy.mashup_templates（Step1 from-script 真 INSERT 模板行，真查归属租户）
- 代码 ↔ zenithjoy.mashup_candidates（Step3 候选真查，thumbnail_url 列真读）
- 代码 ↔ zenithjoy.mashup_render_jobs（Step4 渲染作业状态机 queued/rendering/completed/render_failed 真插真查真迁移）
- 代码 ↔ zenithjoy.materials（Step2 signed-url 真查素材归属，租户隔离 WHERE tenant_id）
- route ↔ service：`/templates/from-script`↔分段服务、`/candidates`↔generateCandidates、`/candidates/:id/render`↔renderCandidate、`/materials/:id/signed-url`↔storage.getSignedUrl —— 全部真调，禁替身顶替
- 鉴权边：X-Upload-Token ↔ validateLicense ↔ 真 zenithjoy.licenses（禁伪造 tenantId 注入）

**唯一允许 mock 的更外层无关依赖**（见 ## 未覆盖真实链路清单）：TOAPIS/Gemini 上游、Xenova 向量模型、ffmpeg 二进制（抽帧/渲染）。被改的边一条不 mock。

---

## 未覆盖真实链路清单（mock 豁免显式登记）

| 被 mock/未覆盖的真实链路点 | 为什么 | 真验证补位计划（谁/何时/什么环境）|
|---|---|---|
| TOAPIS/Gemini 文案分段真调（Step1 source="ai" 路径）| CI（ci-l4-integration ubuntu）无 `~/.credentials/toapis.env`，无 key → 走降级路径 | staging Final-E2E：主理人环境有凭据，真调返回 source="ai"、真分段（与 material-tagging.ts 现有降级语义一致）|
| 缩略图拼贴真实抽帧（Step3 thumbnailUrl 真值）| 需真视频 + ffmpeg 抽帧，CI 无真素材字节 | staging Final-E2E：真素材抽帧拼贴，`<img>` 可见非占位 |
| 真实 ffmpeg 1080P 渲染 + 内容安全自查（Step4 completed 路径）| hk-vps 算力接缝 + TOAPIS 安全 gate，CI 不真渲染 | staging Final-E2E：选中候选真渲染出可播放 1080P 成片（沿用 S4 oracle：ffprobe 音视频流 + safety/watermark=passed）|
| 并发=1 在真实负载下的时序（两个真渲染同时打）| 单测用 psql 造在飞作业断队列决策，非真时序 | staging Final-E2E：两个真渲染请求，第二个实测排队 |

（Step1/2 的 DB 落库、租户隔离、队列决策、字段 schema 均在 API 层真 PG 真验，非 mock。）

---

## 接缝清单（接缝 vs 逻辑，接缝必在真目标验）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 当前态 |
|---|---|---|---|---|
| 1 | 文案 AI 分段 | TOAPIS/Gemini 真返回结构化分段 | staging：source="ai" 真分段落库 | logic-done-pending（CI 走降级，逻辑已真验）|
| 2 | 缩略图拼贴抽帧 | 真视频 ffmpeg 抽帧拼贴 | staging：候选卡缩略图可见 | logic-done-pending |
| 3 | ffmpeg 1080P 真渲染 + 并发=1 真时序 | hk-vps 算力 + 真队列 | staging：真渲染成片 ffprobe + 第二请求实测排队 | logic-done-pending |

逻辑断言（环境无关，CI 真 PG 验绿=真 done）：分段 schema/降级、模板落库、租户隔离、signed-url 重签、generatedCount 计数、候选阶段零渲染、队列位决策、render_failed 可重试。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [mashup.test.ts] → 鉴权 X-Upload-Token 缺失 401；租户从凭据反查不信客户端自报
- [mashup-candidate-generation.test.ts] → J10 Jaccard 去重 0.8；cosineSimilarity 归一化向量点积；DEFAULT_TARGET_COUNT=50 / HARD_MAX_TARGET_COUNT=300 clamp
- [mashup-render.test.ts] → fail-closed：safety/watermark 任一非 passed ⇒ export_url/download_url=NULL
- [mashup-slot-assignment.test.ts] → slot status 三态 assigned/reshoot_skipped/unfilled
- [MashupPage.ResultStep.test.tsx] → ResultStep 读 RenderResult {contentId, safetyCheckStatus, watermarkCheckStatus, downloadUrl}（本单渲染响应新增字段须向后兼容此形）

### 累积 FR（context-manifest）
- context-manifest: unavailable（zenithjoy 无 cecelia Brain 端点；累积 FR 以 PRD L84-85 为准：批量混剪 S1-S4 PR#1878 已上线，本单不得回退）

### Unified Map
- [MAP_NOT_CONFIGURED]（task.payload 无 map_scope/map_repo；不回退领域硬编码，以 PRD + registry 为准）

### Contract Gate
- contract-gate: skipped (file not found, third-party repo)（packages/brain/src/lib/contract-gate.js 不存在于 zenithjoy）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 文案→动态分段模板；素材在线预览重签；候选 generatedCount+缩略图；选中才渲染+并发=1队列+失败态 |
| **NFR（做得多好）** | | 渲染并发上限=1（排队"第N位"）；去重 Jaccard=0.8；targetCount≤300；前端虚拟滚动 DOM≈可视区 |
| **Invariant（永不违反）** | | ①单 slot 串行/渲染并发=1 ②租户隔离（多租户测试）③禁写死环境假设值 ④真环境验证才 done ⑤凭据安全/端点鉴权 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | signedUrl TTL=3600s（DEFAULT_SIGNED_URL_TTL_SECONDS），过期前端自动重签；license 过期即鉴权失败 |
| **死亡告警（停了谁知道）** | | 渲染作业卡 rendering 超时 → render_failed 落态可重试（客户可见）；AI 分段不可用 → degraded 标注可见（非静默丢） |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 模板落库 psql 验行；渲染成片 ffprobe 验音视频流（staging）；候选 thumbnailUrl 非占位（staging）|

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| 文案 AI 分段是否可用 | A. 捕获异常/超时/非法结构归"不可用"; B. 仅超时算失败 | A（统一归 AI 服务不可用） | PRD L19/L35，输入结构化非内容安全，不阻断 | 误判为可用会把空/非法结构当模板；已由 degraded 降级兜底，风险低 |
| roleTag 是否命中 ai_tags 词表 | A. 精确匹配现有 match_tags 词表; B. 模糊语义匹配 | A + 未命中标 mapped=false | 决策 f33415af 复用 S1 优先速度 | 语义对不齐 → mapped=false 手动微调，非静默错映 |
| ⚠️ 渲染是否成功（决定成片是否放出）| A. ffmpeg exit + 产物存在 + gate=passed; B. 仅 exit 0 | A（fail-closed）| S4 既有铁律 A1，误判直接面客错误 | ⚠️ 放出未过安全/水印 gate 的成片（面客）→ 已 fail-closed 拦 |
| 渲染并发是否已满（是否入队）| A. 查 mashup_render_jobs status='rendering' 计数≥1; B. 内存信号量 | A（DB 为准，跨进程可靠）| hk-vps 单机多进程需 DB 权威 | 误判未满 → 并发>1 撑爆 4 核 CPU（决策 d6bedf80）|

（⚠️ 行属"升拍板点"级别；PrepPRD 已就 fail-closed/并发=1 拍板，无新增待确认判定点。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时）| 503 不写库 | 是（幂等键 task_id）| 客户端重试 |
| TOAPIS 分段超时/5xx/欠费/无 key | 归"AI 服务不可用"，degraded=true 返固定模板 | 是（重新 POST 再解析）| 静默降级固定模板，非阻断（区别 S4 阻断式转人工）|
| signedUrl 过期 | 前端拿到过期 URL 播放失败 | 是（GET signed-url 重签）| 前端自动重签重试；素材损坏标"预览不可用"不阻断 |
| 渲染 ffmpeg/gate 失败 | 作业落 render_failed | 是（对同候选再 POST render 重新入队）| 客户"重新渲染"或"换一条候选"，非死路 |
| 并发已满 | 新请求进 queued（非拒绝）| 是（幂等：同候选重复 POST 不重复起渲）| 排队"第 N 位"，前端按钮禁用+去抖防重复提交 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 客户粘贴文案（Step1 script）| 半信任（客户自有内容，非公网匿名）| 文案仅作结构化解析输入，不作为可执行指令；解析结果仅取 segments 结构不回显模型自由文本到特权动作 | 租户隔离：模板/素材/候选/渲染全部 WHERE tenant_id 反查凭据，script 内容不能跨租户读写；targetCount 越界 clamp 到 [默认,300] |

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: POST /api/mashup/templates/from-script 传 `{"script":12345}`（非字符串）/ 超长文案（>50KB）→ 应 400 或降级，不 500 崩
- 重复提交: 对同一 render_failed 候选连点两次「重新渲染」→ 不应产生两个 rendering 作业（幂等/去抖）
- 中途中断: 候选生成进行中刷新页面重进 → 候选列表可重新拉取，不丢 run
- 边界值: targetCount=0 / 负数 / 99999 → 应 400 或 clamp；候选去重后 0 条 → generatedCount=0 如实显示不报错
发现分级: P0/P1（跨租户读到他人素材/模板、放出未过 gate 成片、并发>1 撑爆 CPU）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: user_facing
**target_environment**: windows_cloud

> 说明：Mode B UI 层由 windows_cloud 变体 C（Dashboard Playwright，真实后端）承载（见文末 PowerShell 段与 .github/workflows/e2e-windows.yml），验证 MashupPage 文案粘贴/在线预览/候选虚拟滚动/渲染队列态。以下 **bash 块是 API 层 Golden Path 可执行 oracle**（evaluator 按序拼接执行），在真 PG + 真 API 上跑通四步；真 ffmpeg 渲染/真 TOAPIS 分段属接缝，在 staging 预览闸验（见 ## 接缝清单 / ## staging 预览闸）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
APP_PID=""
cleanup() {
  [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 1. 真实 migration 初始化空库，机检关键表存在
( cd apps/api && npm run migrate )
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.mashup_templates') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.mashup_render_jobs') IS NOT NULL" | grep -qx t

# 2. 启动真实 API 并等待健康
( cd apps/api && npm run build && node -r dotenv/config dist/index.js ) >/tmp/mashup-api.log 2>&1 &
APP_PID=$!
for i in $(seq 1 60); do
  curl -sf "$BASE_URL/health" >/dev/null && break
  [ "$i" = 60 ] && { echo "FAIL: API 未就绪"; cat /tmp/mashup-api.log; exit 1; }
  sleep 1
done

# 3. 空库种子：两家租户 + license（真 signup 通道未开放给 mashup，走 license 自举）
SFX="e2e$(date +%s)$RANDOM"
TENANT_A=$(psql "$DB_URL" -tAc "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('mxA-$SFX','mxlk-a-$SFX','free') RETURNING id" | tr -d ' ')
TENANT_B=$(psql "$DB_URL" -tAc "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('mxB-$SFX','mxlk-b-$SFX','free') RETURNING id" | tr -d ' ')
TOKEN_A="ZJ-MXA-$SFX"
TOKEN_B="ZJ-MXB-$SFX"
psql "$DB_URL" -c "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, expires_at, tenant_id) VALUES ('$TOKEN_A','pro',5,'active',NOW()+INTERVAL '1 year','$TENANT_A')"
psql "$DB_URL" -c "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, expires_at, tenant_id) VALUES ('$TOKEN_B','pro',5,'active',NOW()+INTERVAL '1 year','$TENANT_B')"
MAT_A=$(psql "$DB_URL" -tAc "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, ai_tags, tag_status) VALUES ('$TENANT_A','k/$SFX.mp4','$SFX.mp4','video/mp4',1048576,'$TENANT_A:$SFX','[\"开场\",\"产品特写\"]','tagged') RETURNING id" | tr -d ' ')

# 4. Step1 文案动态分段（CI 无 TOAPIS key → 降级路径，仍产出可用分段并落库）
R1=$(curl -sf -X POST "$BASE_URL/api/mashup/templates/from-script" -H "X-Upload-Token: $TOKEN_A" -H 'Content-Type: application/json' -d '{"script":"开场:清晨厨房。产品展示:保温杯特写。结尾:号召下单。"}')
echo "$R1" | jq -e '.success==true and (.data.templateId|type=="string") and (.data.segments|length>=1) and (.data.segments[0]|has("roleTag") and has("mapped"))'
TPL_A=$(echo "$R1" | jq -r '.data.templateId')
psql "$DB_URL" -tAc "SELECT tenant_id FROM zenithjoy.mashup_templates WHERE id='$TPL_A'" | grep -qx "$TENANT_A"
# 空文案 400
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/mashup/templates/from-script" -H "X-Upload-Token: $TOKEN_A" -H 'Content-Type: application/json' -d '{"script":""}')
[ "$C" = "400" ] || { echo "FAIL: 空文案未 400 (got $C)"; exit 1; }

# 5. Step2 素材在线预览重签 + 租户隔离
R2=$(curl -sf "$BASE_URL/api/materials/$MAT_A/signed-url" -H "X-Upload-Token: $TOKEN_A")
echo "$R2" | jq -e '.data.playable==true and (.data.previewUrl|type=="string") and (.data.previewUrl|length>0)'
C2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/materials/$MAT_A/signed-url" -H "X-Upload-Token: $TOKEN_B")
[ "$C2" = "404" ] || { echo "FAIL: 跨租户素材未 404 (got $C2)"; exit 1; }

# 6. Step3 候选浏览返回 generatedCount + thumbnailUrl，且候选阶段无渲染产物
RUN_A=$(psql "$DB_URL" -tAc "INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ('$TENANT_A','$TPL_A','completed') RETURNING id" | tr -d ' ')
psql "$DB_URL" -c "INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature) VALUES ('$RUN_A','$TENANT_A','{\"seg1\":\"$MAT_A\"}',1.5,'seg1:$MAT_A')"
R3=$(curl -sf "$BASE_URL/api/mashup/runs/$RUN_A/candidates" -H "X-Upload-Token: $TOKEN_A")
echo "$R3" | jq -e '(.data.generatedCount|type=="number") and (.data.candidates[0]|has("thumbnailUrl"))'
NREN=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.contents WHERE source_candidate_id IN (SELECT id FROM zenithjoy.mashup_candidates WHERE run_id='$RUN_A')" | tr -d ' ')
[ "$NREN" = "0" ] || { echo "FAIL: 候选阶段出现渲染产物 $NREN"; exit 1; }

# 7. Step4 并发=1 队列：造在飞作业后第二请求进 queued
CAND1=$(psql "$DB_URL" -tAc "SELECT id FROM zenithjoy.mashup_candidates WHERE run_id='$RUN_A' LIMIT 1" | tr -d ' ')
CAND2=$(psql "$DB_URL" -tAc "INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature) VALUES ('$RUN_A','$TENANT_A','{\"seg2\":\"$MAT_A\"}',1.2,'seg2:$MAT_A') RETURNING id" | tr -d ' ')
psql "$DB_URL" -c "INSERT INTO zenithjoy.mashup_render_jobs (tenant_id, run_id, candidate_id, status) VALUES ('$TENANT_A','$RUN_A','$CAND1','rendering')"
R4=$(curl -sf -X POST "$BASE_URL/api/mashup/candidates/$CAND2/render" -H "X-Upload-Token: $TOKEN_A")
echo "$R4" | jq -e '.data.status=="queued" and (.data.queuePosition>=1)'

echo "OK: 批量混剪加厚 Golden Path 1-4 API 层验证通过"
```

> **windows_cloud 变体 C（Mode B UI 层，dashboard Playwright，真实后端）** —— 由 evaluator 触发
> `gh workflow run e2e-windows.yml --repo perfectuser21/zenithjoy-workspace`；spec 禁 `page.route()`，所有请求打真实 apps/api（port 3000）。验收点：MashupPage 粘贴文案见动态分段、PickStep `<video>` 可播放、CandidatesStep 虚拟滚动（DOM 节点数≈可视区，非 200 全量）、选中候选后见渲染队列/失败态。截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`。

```powershell
# final-e2e (windows-latest 变体C) —— 启真实 apps/api + Vite preview + Playwright，禁 page.route()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$VitePort = 5174; $ApiPort = 3000
$repoRoot = Resolve-Path "$PSScriptRoot\..\.."
$env:DATABASE_URL = $env:E2E_DATABASE_URL
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow | Out-Null
$w=0; do { Start-Sleep 1; $w++; $c=Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue } while (-not $c.TcpTestSucceeded -and $w -lt 40)
if (-not $c.TcpTestSucceeded) { throw "FAIL: API 未就绪 port=$ApiPort" }
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow | Out-Null
$w=0; do { Start-Sleep 1; $w++; $c=Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $c.TcpTestSucceeded -and $w -lt 30)
if (-not $c.TcpTestSucceeded) { throw "FAIL: Vite 未就绪 port=$VitePort" }
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e\mashup.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($p.ExitCode)" }
Write-Host "OK: windows_cloud Dashboard E2E 通过（真实后端）"
```

---

## staging 预览闸（zenithjoy 仓 → 阻塞式）

### 步骤 A：落 staging
ZJ staging 环境（引用现有 `.github/workflows/deploy-dashboard-staging.yml` / `deploy-staging-hk.yml`，不重造部署脚本）。

### 步骤 B：Final E2E 在 staging 跑 + 截图
Final E2E 在 staging 执行（含真 TOAPIS 分段 source="ai"、真缩略图拼贴、真 ffmpeg 1080P 渲染 + ffprobe 音视频流断言、并发=1 真时序）；截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`。

### 步骤 C：Bark 推主理人预览链接（阻塞式）
调用 `$BARK_URL` 通知主理人，附 staging 预览链接 + 截图 URL，**注明需主理人放行**；Brain PATCH 写 `approval_required:true`；prod promote 前核查 decisions/approval 字段，未放行禁 promote。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（GP 1-4 API 层）| `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts` | 空文案返回 400 / 静默降级 / 新模板只对本租户可见 / 返回可播放 previewUrl / 他租户素材重签返回 404 / 返回 generatedCount 与每条候选 thumbnailUrl / 候选浏览阶段不触发渲染 / 已有 rendering 作业时再 POST render 返回 queued / 渲染失败态可重试 | 端点/列/表未实现 → 404 / 字段 undefined / mashup_render_jobs 表缺失 → N failures |
