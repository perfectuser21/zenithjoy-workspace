# Sprint Contract Draft (Round 1)

Sprint: 批量混剪加厚 — 文案动态分段 + 素材在线预览 + 候选 200+ 可视化浏览 + 按需渲染

**journey_type**: user_facing
**target_environment**: linux_server（hk-vps 真机 ffmpeg；Dashboard UI 用 Playwright 对已部署 staging）
**BASE_REPO**: zenithjoy-workspace
**Unified Map**: `[MAP_NOT_CONFIGURED]`（task.payload.map_scope/map_repo 均为空；不回退领域硬编码，`must_run_assertions` 空集）
**contract-gate**: skipped (file not found, third-party repo)
**gp-anchor**: 见 `## GP-Anchor` 段

---

## 锚定父路声明

覆盖父路 line05/batch_mashup（批量混剪）第 3 步为机器锚点（`## GP-Anchor` 单步声明），业务上本 sprint 加厚推进第 1-4 步（文案动态分段 / 素材在线预览 / 候选 200+ 缩略图浏览 / 按需渲染队列），第 5 步（结果页在线播放 + S4 内容安全）沿用不动。

---

## Response Schema（推导来源: PRD 字面 + api_registry 推导 apps/api/src/routes/mashup.ts 现有端点）

所有端点复用现有响应信封（`apps/api/src/routes/mashup.ts` 的 `ok()/fail()`）：
成功 `{"success":true,"data":<payload>,"error":null,"timestamp":<iso>}`；
失败 `{"success":false,"data":null,"error":{"code":<string>,"message":<string>},"timestamp":<iso>}`。
鉴权口径不变：`X-Upload-Token: <license_key>`，租户从凭据反查，**绝不信客户端自报 tenant_id**。

### Endpoint 1（新）: `POST /api/mashup/templates/from-script`  — Step 1 文案动态分段

**Success (HTTP 200)** `data`:
```json
{
  "templateId": "<uuid string>",
  "name": "<string>",
  "slots": [
    {"key": "<string>", "required": true, "match_tags": ["<string>"], "suggestedCount": 3, "tagMapping": "matched"}
  ],
  "degraded": false,
  "source": "ai"
}
```
- `templateId` (string, 必填): 新落库 `zenithjoy.mashup_templates` 行 id — 来源 PRD Step1「落成新 mashup_templates 行」
- `slots` (array, 必填): 动态分段结构；每段 `key/required/match_tags` 沿用现有 `SlotDef` 形状（api_registry: mashup-slot-assignment.ts），**新增** `suggestedCount`(int, 每段建议素材数) 与 `tagMapping`("matched"=角色标签命中现有 ai_tags 枚举 / "fallback"=兜底映射) — 来源 PRD Step1
- `degraded` (bool, 必填): AI 服务不可用 → `true`（静默降级固定 4 槽位模板）；正常 AI 分段 → `false` — 来源 PRD Step1 降级分支
- `source` (string, 必填): `"ai"`(AI 动态分段) | `"fallback"`(固定模板降级)；与 `degraded` 一致（`fallback`↔`degraded:true`）
**禁用字段名**: `segments`（不得替代 `slots`）、`isDegraded`/`fallback`（不得替代 `degraded`）、`template_id`(下划线，本响应用小驼峰 `templateId`)
**Error (HTTP 400)**: `script` 缺失/空串/非字符串 → `{"success":false,"error":{"code":"INVALID_BODY","message":<string>},...}`

### Endpoint 2（新）: `GET /api/materials/:id/preview` — Step 2 素材在线预览（重签）

**Success (HTTP 200)** `data`:
```json
{"materialId": "<uuid string>", "previewUrl": "<https signed url|null>", "previewAvailable": true, "expiresAt": "<iso string>"}
```
- `previewUrl` (string|null, 必填): 复用 `storage.getSignedUrl(storage_key)` 重新签发；签不出（storage_key 失效/损坏）→ `null`
- `previewAvailable` (bool, 必填): `previewUrl!==null` 且 mime 为可播放视频类型时 `true`；否则 `false`（前端标「预览不可用」，不阻断选择）— 来源 PRD Step2
- `expiresAt` (string, 必填): 该签名 URL 过期时刻（ISO）；前端据此过期后重新调本端点重签重试
**禁用字段名**: `preview_url`(下划线)、`url`、`signedUrl`（本响应字面用 `previewUrl`）
**Error (HTTP 404)**: 素材不存在或不属于当前租户 → `{"error":{"code":"MATERIAL_NOT_FOUND",...}}`（租户隔离）

### Endpoint 3（改）: `POST /api/mashup/runs/:id/candidates` + `GET /api/mashup/runs/:id/candidates` — Step 3 候选 200+ + 缩略图 + 懒渲染

`POST` 请求 body 不变 `{"targetCount": 200}`（`HARD_MAX_TARGET_COUNT` 现为 300，容纳 200；不改阈值）。
`POST`/`GET` **Success (HTTP 200)** `data`（在现有 `candidates` 基础上**新增**字段，不改字面名）:
```json
{
  "runId": "<uuid string>",
  "generatedCount": 187,
  "selectedCandidateId": null,
  "candidates": [
    {"id": "<uuid string>", "score": 4.2, "slotFill": {"hook": "<uuid>"}, "thumbnailUrl": "<data-url|https|null>", "renderStatus": "pending"}
  ]
}
```
- `generatedCount` (int, 必填): 去重后实际生成候选数（「共生成 N 条候选」，不承诺死数字 200）— 来源 PRD Step3 + 决策 `3ed368c3`
- `candidates[].thumbnailUrl` (string|null, 必填): 缩略图拼贴 URL，抽帧自 `video-frame-extract.ts`（各槽位素材帧拼贴）；抽帧失败 → `null` — 来源 PRD Step3
- `candidates[].renderStatus` (string, 必填): 生成期**恒为** `"pending"`（此刻绝不真实渲染，懒渲染）— 来源 PRD Step3/Step4「此前候选全部未真实渲染」
- `candidates` 长度 ≤ `targetCount`（去重后实际值）
**禁用字段名**: `count`(替代 `generatedCount`)、`thumbnail`/`thumb_url`（替代 `thumbnailUrl`）、`status`(替代 `renderStatus`，避免与 run.status 混淆)
**Error (HTTP 404)**: run 不存在/不属于租户 → `{"error":{"code":"RUN_NOT_FOUND",...}}`

### Endpoint 4（改）: `POST /api/mashup/candidates/:id/render` — Step 4 按需渲染 + 并发=1 队列 + 失败态

**Success (HTTP 200)** `data`:
```json
{"candidateId": "<uuid string>", "renderStatus": "queued", "queuePosition": 1, "contentId": null}
```
- `renderStatus` (string, 必填): `"queued"|"rendering"|"rendered"|"render_failed"`；渲染并发上限=1，已有渲染在跑时第 2 个请求返回 `"queued"` — 来源 PRD Step4 + 决策 `d6bedf80`（hk-vps 4 核硬约束）
- `queuePosition` (int, 必填): 排队位次，`1`=下一个，`0`=正在渲染/已完成 — 来源 PRD Step4「排队显示第 N 位」
- `contentId` (string|null, 必填): 渲染成功后为 `zenithjoy.contents` 行 id；`queued`/`rendering`/`render_failed` 时为 `null`
- 渲染失败 → `renderStatus:"render_failed"`；再次 `POST` 同 candidate 即「重新渲染」（可从 `render_failed` 重新入队），非死路 — 来源 PRD Step4
**禁用字段名**: `queuePos`、`position`（替代 `queuePosition`）；`jobId`（本响应不引入 job 概念，用 candidate 承载态）
**Error (HTTP 404)**: candidate 不存在/不属于租户 → `{"error":{"code":"CANDIDATE_NOT_FOUND",...}}`

---

## 已知约束（来自回归测试 + 累积 FR）

### 回归测试约束（Step 1.2）
- [apps/api/src/routes/__tests__/mashup.test.ts] → 没有凭据 → 401 / 缺 templateId → 400 不触碰 DB / 模板不存在 → 404（不是 500） / 租户从凭据反查绝不信客户端自报 tenant_id
- [apps/api/src/services/__tests__/mashup-candidate-generation.test.ts] → J10 候选级 Jaccard 0.8 去重 / beamWidth 放大池 / reshoot_skipped|unfilled 槽位透传留空
- [apps/api/src/services/__tests__/mashup-render.test.ts] → fail-closed：safety/watermark 非 passed 时 export_url/download_url 恒 NULL / 素材下载失败优雅降级不裸崩 / gate 解析失败落 failed_pending_review
- [apps/api/src/services/__tests__/mashup-render-ffmpeg.test.ts] → concatAndScale 输出 1920x1080、`-an` 无音轨（**领域断言：本 pipeline 成片无音轨，ffprobe 只验 video 流 + duration，禁验 audio 流**）
- [apps/dashboard/src/api/__tests__/mashup.api.test.ts] / [MashupPage.ResultStep.test.tsx] → dashboard api 形状与后端一一对应

### 累积 FR（本 line 已验收行为，不得回退）[累积FR]
- 批量混剪 S1-S4：Step1 素材打标签（ai_tags 抽帧）→ Step2 槽位分配（贪心 match_tags 重叠）→ Step3 候选生成（J10 Jaccard 0.8 去重 + beamWidth）→ Step4 ffmpeg 渲染 + S4 内容安全自查 + 内联视频预览（PR#1878）
- context-manifest: unavailable（本 repo 为 zenithjoy，Brain line context-manifest 端点未对该 line 登记，取 PrepPRD 累积 FR 为准）

### Invariant 铁律映射（DoD 覆盖，见 contract-dod.md INV-* 条目）
- INV-1 [租户隔离] 模板/素材/候选按租户隔离，跨租户不可见
- INV-2 [真环境验证] 只有 hk-vps 真机 ffmpeg 渲染跑通才算 done，禁写死环境假设值
- INV-3 [单slot串行/渲染并发=1] 真实渲染并发上限=1，第 2 个进排队
- INV-4 [凭据安全] TOAPIS/Gemini 凭据走 env 不硬编码、日志脱敏、端点鉴权
- INV-5 [内容安全自查] 成片必须经 S4 内容安全自查后才呈现（沿用不动）
- INV-6 [防假成功] 渲染须确认真实产出成片才判成功，失败落「渲染失败」态而非假绿

---

## Golden Path

[客户粘贴文案] → [Step1 动态分段落模板] → [Step2 素材在线预览挑选] → [Step3 生成候选 200+ 缩略图浏览] → [Step4 选中一条按需渲染出成片]

### Step 1: 客户粘贴文案 → 动态分段模板
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条（调 TOAPIS/Gemini 解析动态分段 + 每段建议素材数 → 落新 mashup_templates 行；AI 不可用静默降级固定模板）

**可观测行为**: `POST /api/mashup/templates/from-script` 传入一段文案，返回结构化 `slots`（动态段数，非固定 4），角色标签命中 ai_tags 枚举标 `tagMapping:"matched"` 否则 `"fallback"`，并新增一行 `zenithjoy.mashup_templates`。AI 不可用时 `degraded:true, source:"fallback"` 且返回固定四槽位（非阻断，HTTP 仍 200）。

**验证命令**:
```bash
# AI 可用（真调 TOAPIS，hk-vps 有 ~/.credentials/toapis.env）：
RESP=$(curl -sf -X POST "$API_BASE/api/mashup/templates/from-script" \
  -H "X-Upload-Token: $UPLOAD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"script":"开场三秒抛出痛点，中段展示产品卖点与真实使用效果，结尾强行动号召引导下单"}')
echo "$RESP" | jq -e '.data.templateId | type=="string"'
echo "$RESP" | jq -e '(.data.slots|type=="array") and (.data.slots|length>=1)'
echo "$RESP" | jq -e '.data.slots[0].suggestedCount|type=="number"'
echo "$RESP" | jq -e '(.data.degraded|type=="boolean") and (.data.source|test("^(ai|fallback)$"))'
TID=$(echo "$RESP" | jq -r '.data.templateId')
psql "$DB_URL" -tAc "SELECT 1 FROM zenithjoy.mashup_templates WHERE id='$TID' AND created_at > NOW() - interval '5 minutes'" | grep -qx 1
```
**硬阈值**: HTTP 200；`slots` 非空数组；模板 5 分钟内落库。对应命令：上方 `jq -e` + `psql` 时间窗断言。

---

### Step 2: 素材在线预览
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条（素材卡片在线播放预览，复用 signedUrl，渲染 `<video>`；过期重签，损坏标预览不可用不阻断）

**可观测行为**: `GET /api/materials/:id/preview` 返回可播放的 `previewUrl` + `expiresAt`；跨租户素材返回 404（租户隔离）；损坏/不支持返回 `previewAvailable:false`。Dashboard PickStep 用该 URL 渲染 `<video>` 元素（staging 预览闸 Playwright 断言 `<video>` 可见并发出请求）。

**验证命令**:
```bash
RESP=$(curl -sf "$API_BASE/api/materials/$MATERIAL_ID/preview" -H "X-Upload-Token: $UPLOAD_TOKEN")
echo "$RESP" | jq -e '.data.materialId=="'"$MATERIAL_ID"'"'
echo "$RESP" | jq -e '(.data.previewAvailable|type=="boolean") and (has("expiresAt")|not|not)'
echo "$RESP" | jq -e '.data.previewUrl|(type=="string" or .==null)'
# 跨租户隔离：别的租户 token 查同一素材 → 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/materials/$MATERIAL_ID/preview" -H "X-Upload-Token: $OTHER_TENANT_TOKEN")
[ "$CODE" = "404" ] || { echo "FAIL: 跨租户未 404 (=$CODE)"; exit 1; }
```
**硬阈值**: 本租户 200 且带 `previewUrl`/`previewAvailable`/`expiresAt`；跨租户 404。对应命令：上方 `jq -e` + 状态码断言。

---

### Step 3: 生成候选 200+ + 缩略图拼贴 + 懒渲染
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条（复用 J10 去重 + beamWidth 生成候选 200+，缩略图拼贴虚拟滚动浏览，如实显示实际数量；候选生成期不渲染）

**可观测行为**: `POST /api/mashup/runs/:id/candidates {"targetCount":200}` 生成候选，`GET` 返回每条含 `thumbnailUrl` 与 `renderStatus:"pending"`（生成期零真实渲染），`generatedCount` 为去重后实际数（≤200）。DB `zenithjoy.mashup_candidates` 落库带 `render_status='pending'` 且 `thumbnail_url` 非空占比合理。

**验证命令**:
```bash
GEN=$(curl -sf -X POST "$API_BASE/api/mashup/runs/$RUN_ID/candidates" \
  -H "X-Upload-Token: $UPLOAD_TOKEN" -H 'Content-Type: application/json' -d '{"targetCount":200}')
echo "$GEN" | jq -e '.data.generatedCount|type=="number"'
echo "$GEN" | jq -e '(.data.candidates|length) <= 200'
echo "$GEN" | jq -e 'all(.data.candidates[]; .renderStatus=="pending")'   # 懒渲染：生成期全 pending
echo "$GEN" | jq -e 'any(.data.candidates[]; .thumbnailUrl!=null)'         # 至少部分有缩略图拼贴
# DB 侧：生成期没有任何 contents 成片产出（未真实渲染）
CNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_candidates WHERE run_id='$RUN_ID' AND render_status='pending'" | tr -d ' ')
[ "$CNT" -ge 1 ] || { echo "FAIL: 无 pending 候选落库"; exit 1; }
```
**硬阈值**: `candidates.length ≤ 200`；生成期全部 `renderStatus="pending"`；`generatedCount` 为数字。对应命令：上方 `jq -e all(...pending)` + `psql`。

---

### Step 4: 选中候选 → 按需真实渲染（并发=1 队列 + 失败态）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条（选中才真实调 ffmpeg 渲染；并发上限=1 排队显示第 N 位；渲染失败落「渲染失败」态可重试/换一条）

**可观测行为**: `POST /api/mashup/candidates/:id/render` 触发真实 ffmpeg 渲染（hk-vps）；已有渲染在跑时第 2 个请求返回 `renderStatus:"queued", queuePosition>=1`（并发实测=1）。渲染成功产出真实 1080P mp4（`contents.export_url` 非空、ffprobe 有 video 流 + duration>0）；渲染失败落 `render_status='render_failed'`，再次 POST 可重新入队。

**验证命令**:
```bash
# 并发=1：并行发两个渲染，恰有一个进入 queued
R1=$(curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN") &
R2=$(curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_B/render" -H "X-Upload-Token: $UPLOAD_TOKEN")
wait
# 轮询直到有一条 rendered，且并发期确有 queued 态出现（见 E2E 脚本精确断言）
# 渲染成功后成片真实性（-an 无音轨：只验 video 流 + duration，禁验 audio）
psql "$DB_URL" -tAc "SELECT export_url FROM zenithjoy.contents WHERE source_candidate_id='$CAND_A' AND export_url IS NOT NULL AND created_at > NOW() - interval '10 minutes'" | grep -q .
```
**硬阈值**: 并发两请求恰一进 `queued`（并发=1）；成功候选 5-10 分钟内产出 `export_url` 非空的 contents 行且 ffprobe 有 video 流。对应命令：见 `## E2E 验收` 精确脚本。

---

## 真实调用方请求 shape

本 sprint 的调用方是 **Dashboard 前端（apps/dashboard）**，非设备/Android agent，认证走 HTTP header（与现有 mashup 端点逐字段一致）：

| 项 | 生产调用方（apps/dashboard/src/api/mashup.api.ts）实情 | 本合同 DoD 请求构造 |
|---|---|---|
| 认证 | `headers: { 'X-Upload-Token': <license_key> }`（`getUploadToken()` 从 `/account/me` 换取） | `-H "X-Upload-Token: $UPLOAD_TOKEN"` 逐字段一致 |
| 租户 | **不由 body 传**，服务端 `validateLicense(token)` 反查 `tenant_id` | 禁 body 传 tenant_id；跨租户断言用另一 token |
| Content-Type | `application/json` | `-H 'Content-Type: application/json'` |
| from-script body | `{ script: string }` | 一致 |
| candidates body | `{ targetCount?: number }` | 一致 |

无 body 传 tenant_id 的双路径分叉。

---

## 禁 mock 边清单

本单涉及 **DB 写路径**（新增 mashup_candidates.render_status/thumbnail_url/queue 字段、mashup_templates 动态段写入）、**状态机**（render_status: pending→queued→rendering→rendered/render_failed）、**跨模块数据传递**（文案→分段→模板→候选→渲染）、**并发/生命周期**（渲染队列单 slot 串行）。以下边禁 mock，冻结测试真跑：

- 代码 ↔ `zenithjoy.mashup_templates`（Step1 from-script 落库）：真 Postgres 真 INSERT 真 SELECT，禁 stub DB 层
- 代码 ↔ `zenithjoy.mashup_candidates`（Step3 候选落库带 render_status/thumbnail_url；Step4 状态迁移）：真 Postgres 真读写
- 渲染队列 ↔ DB 状态迁移（Step4 pending→queued→rendering→rendered/render_failed）：真 Postgres + 真队列并发原语，禁 mock 被改的这条边
- candidate-generation ↔ mashup_candidates 去重落库（J10）：真 Postgres

**允许 mock 的外层叶子（登记进「未覆盖真实链路清单」）**：
- ffmpeg 子进程真实渲染 → L2 冻结测试注入可控 renderFn 探测队列并发/状态机；**真实 ffmpeg 由 L3 hk-vps E2E 覆盖**（invariant INV-2）
- TOAPIS/Gemini 文案分段第三方调用 → L2 冻结测试走「AI 不可用降级」分支（不设 `TOAPIS_API_KEY` → degraded）；**真实 AI 分段由 L3 hk-vps E2E 真 key 真调覆盖**（规则 B）
- material storage `getSignedUrl`/`putObject`（S3/COS 叶子）→ Step2 预览重签测试注入 storage 桩

---

## 未覆盖真实链路清单

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划（谁/何时/什么环境）|
|---|---|---|---|
| 真实 ffmpeg 渲染出 1080P 成片 | L2 冻结测试注入可控 renderFn | CI Sprint Tests 无 ffmpeg/真素材；渲染队列并发/状态机才是 L2 要卡的接缝 | evaluator / final-e2e / hk-vps 真机（`## E2E 验收` Step D，ffprobe 验 video 流+duration，invariant INV-2） |
| TOAPIS/Gemini 文案动态分段真调 | L2 走 degraded 降级分支（不设 key） | 降级分支本身是 Golden Path 必测支路；happy path 需真 key | evaluator / final-e2e / hk-vps（`~/.credentials/toapis.env` 真 key，`## E2E 验收` Step A 真调断言 `source=="ai"`） |
| storage signedUrl 真签发/真下载 | Step2 L2 注入 storage 桩 | COS 凭据不进 CI；预览端点逻辑（重签/租户隔离/不可用态）可桩验 | staging 预览闸 Playwright 对已部署 staging 真发 signedUrl 请求 + 渲染 `<video>` |
| E2E fixture 租户与已上传可播放素材 | hk-vps 预置 fixture 租户 `MASHUP_E2E_*` | 真机渲染需真实可拼接视频；E2E 用 ffmpeg testsrc 现造 2 段并经真实 storage 上传 | `## E2E 验收` Step 0 现造 fixture（自包含，非历史遗留） |

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 文案→动态分段模板；素材在线预览重签；候选 200+ 缩略图懒渲染浏览；选中按需 ffmpeg 渲染 + 并发=1 队列 + 失败态可重试 |
| **NFR（做得多好）** | 性能/并发 | 渲染真实并发上限=1（hk-vps 4 核）；前端 200+ 候选虚拟滚动 DOM 节点数=可视区；候选去重 Jaccard=0.8（复用不改）|
| **Invariant（永不违反）** | 不变量 | INV-1 租户隔离；INV-2 hk-vps 真机 ffmpeg 才 done；INV-3 渲染并发=1；INV-4 凭据 env 不硬编码；INV-5 S4 内容安全自查；INV-6 防假成功（真产出成片才判成功）|
| **判定点（怎么知道）** | 模糊现实判断 | 见下方判定点登记表 |
| **保质期（何时过期）** | 失效 | signedUrl 预览 URL 到 `expiresAt` 过期 → 前端重签重试；embedding 缓存长期有效；模板/候选无过期 |
| **死亡告警（停了谁知道）** | 告警 | 渲染失败落 `render_status='render_failed'` 并在前端呈现「渲染失败」态（客户即时可见）；AI 不可用降级由 `degraded:true` 前端可见提示 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 渲染成功以 `contents.export_url` 非空 + ffprobe 真实 mp4 为准（非 HTTP 200）；模板生成以 mashup_templates 落库为准 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| 文案 AI 分段是否可用（走 AI 还是降级） | A. 捕获超时/5xx/鉴权/欠费异常统一归不可用; B. 只判超时 | A. 统一异常归「AI 服务不可用」→ degraded 固定模板 | PRD Step1 明确「超时/超长/鉴权/欠费/5xx/网络」统一降级非阻断 | 误判可用会把坏结构塞给客户；本设计降级非阻断，误判偏保守无面客错误 |
| ⚠️ 渲染是否真实成功 | A. HTTP 200 即成功; B. ffmpeg exit 0 且产物存在; C. contents.export_url 非空 + ffprobe 有 video 流 | C（+B 前置）| invariant INV-6 防假成功、INV-2 真机验证 | ⚠️ 误判成功 = 客户拿到坏片/空片直接面客（升拍板点，已由决策 d6bedf80 真机踩坑锚定，判成功前必 ffprobe）|
| 角色标签是否命中 ai_tags 枚举 | A. 精确枚举匹配标 matched/fallback; B. 语义近似 | A. 精确匹配，未命中标 `tagMapping:"fallback"` 兜底映射 | 决策 f33415af 复用 S1 标签、优先实现速度 | 个别语义对不齐，客户可手动微调，无严重后果 |
| 渲染并发是否达上限 | A. 内存信号量计数; B. DB 行锁/态查询 | A. 单进程内存信号量（渲染 worker 单例）+ B DB render_status 落态供前端 | hk-vps 单机单进程；跨请求态以 DB 为准 | 误判空闲会并发>1 撑爆 4 核 CPU（decisions d6bedf80 实证）|

> 无更多接缝判定点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| TOAPIS/Gemini 文案分段不可用（超时/5xx/鉴权/欠费/网络）| 返回 200 + `degraded:true,source:"fallback"` 固定四槽位 | 是（再调可重试 AI）| 静默降级固定模板，非阻断 |
| ffmpeg 渲染失败 | 落 `render_status='render_failed'`，`export_url` 恒 NULL（fail-closed）| 是（再次 POST 同 candidate 重新入队；幂等键=candidate_id）| 客户「重新渲染」或「换一条候选」|
| storage signedUrl 签发失败 | 该素材 `previewUrl:null, previewAvailable:false` | 是（`expiresAt` 后重签）| 卡片标「预览不可用」，不阻断选择 |
| 渲染并发已满 | 返回 `renderStatus:"queued", queuePosition>=1` | 是 | 排队，前端显示「第 N 位」|
| S4 内容安全非 passed | `export_url/download_url` 恒 NULL（fail-closed，沿用不动）| — | 不呈现成片（INV-5）|

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 客户粘贴文案（from-script）| 半可信（登录租户）| 文案仅作结构化分段输入喂给 Gemini，结果只取分段结构落库，不执行文案内任何指令；解析失败/非法结构 → 降级固定模板 | 分段结果的 `match_tags` 必须 ⊆ 现有 ai_tags 枚举，越界标 fallback 不落任意标签 |
| targetCount / material_id / candidate_id | 半可信 | 数值/UUID 校验；`targetCount` 非正数 → 400；id 非本租户 → 404 | 租户隔离从凭据反查，绝不信客户端自报 tenant_id |

---

## GP-Anchor

GP-Anchor: line05/batch_mashup#step3

> 已用 jq 核实 `line05/batch_mashup` 存在于 `product-map/generated/product-map.json`（steps 含 step1-step4）。
> 推进类锚点要求 PR diff 触碰该 GP 的 smoke_files 之一 —— 本 sprint 生成物触碰
> `.github/workflows/scripts/smoke/mashup-candidate-generation-smoke.sh` 与
> `.github/workflows/scripts/smoke/mashup-render-smoke.sh`（回流新断言：候选 200+/缩略图/懒渲染/渲染队列并发=1），满足触碰校验与 CLAUDE.md 铁律 #5（真机 bug/加厚回流 smoke）。

---

## E2E 验收（final-e2e 由 evaluator 跑 — target_environment=linux_server / hk-vps）

**journey_type**: user_facing
**target_environment**: linux_server（hk-vps self-hosted，真实 ffmpeg + 真实 Postgres + `~/.credentials/toapis.env` 真 key）

> evaluator SSH 到 hk-vps 执行本段脚本；Kernel 身份 late-bound（`$HARNESS_*` / `$CAPABILITY_SNAPSHOT_ID` 由 Runner 注入，脚本内不写 UUID 字面值）。
> 前置资源（Fleet/hk-vps 注入，非脚本硬编码）：`API_BASE`（已部署 zenithjoy api）、`DB_URL`（真 Postgres）、`UPLOAD_TOKEN`（fixture 租户 license）、`OTHER_TENANT_TOKEN`（另一租户，跨租户隔离用）、`TENANT_ID`（fixture 租户，psql 播种用）。
> 成片无音轨（render-ffmpeg.ts `-an`）：ffprobe **只验 video 流 + duration>0，禁验 audio 流**。

```bash
#!/bin/bash
set -euo pipefail
: "${API_BASE:?}"; : "${DB_URL:?}"; : "${UPLOAD_TOKEN:?}"; : "${TENANT_ID:?}"
OTHER_TENANT_TOKEN="${OTHER_TENANT_TOKEN:-}"
export PGCONNECT_TIMEOUT=10
WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "== Step 0: 现造 fixture 素材（ffmpeg testsrc，自包含，非历史遗留）=="
ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=30:duration=2 -pix_fmt yuv420p "$WORK/clip1.mp4" >/dev/null 2>&1
ffmpeg -y -f lavfi -i testsrc=size=480x640:rate=30:duration=2 -pix_fmt yuv420p "$WORK/clip2.mp4" >/dev/null 2>&1
ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=2 -pix_fmt yuv420p "$WORK/clip3.mp4" >/dev/null 2>&1
[ -s "$WORK/clip1.mp4" ] || { echo "FAIL: ffmpeg 未生成 fixture 素材"; exit 1; }

echo "== Step A: 文案动态分段（真调 TOAPIS，验 source=ai 或诚实 degraded）=="
SCRIPT_TXT='开场三秒抛出用户痛点，中段展示产品核心卖点与真实使用效果对比，结尾强行动号召引导立即下单购买'
RA=$(curl -sf -X POST "$API_BASE/api/mashup/templates/from-script" \
  -H "X-Upload-Token: $UPLOAD_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"script\":\"$SCRIPT_TXT\"}")
echo "$RA" | jq -e '.data.templateId|type=="string"' >/dev/null || { echo "FAIL: from-script 无 templateId"; exit 1; }
echo "$RA" | jq -e '(.data.slots|type=="array") and (.data.slots|length>=1)' >/dev/null || { echo "FAIL: slots 非数组或空"; exit 1; }
echo "$RA" | jq -e '.data.slots[0].suggestedCount|type=="number"' >/dev/null || { echo "FAIL: slot 缺 suggestedCount"; exit 1; }
echo "$RA" | jq -e '(.data.degraded|type=="boolean") and (.data.source|test("^(ai|fallback)$"))' >/dev/null || { echo "FAIL: degraded/source 缺失"; exit 1; }
TID=$(echo "$RA" | jq -r '.data.templateId')
psql "$DB_URL" -tAc "SELECT 1 FROM zenithjoy.mashup_templates WHERE id='$TID' AND created_at > NOW() - interval '5 minutes'" | grep -qx 1 || { echo "FAIL: 模板未落库(时间窗)"; exit 1; }
echo "A OK source=$(echo "$RA" | jq -r '.data.source')"

echo "== Step 0b: 播种 fixture 素材落库并经真实 storage 上传（真实链路，不预注入业务态）=="
# 用现有素材上传链路把 clip 落成 tagged materials（storage 真实写；tag 直接置 ai_tags 命中模板 match_tags）
SEED_JSON=$(bash "$WORK/../seed-materials.sh" 2>/dev/null || true)   # 若无独立 seeder，则回退 psql+storage put（见下）
# 回退：直接用 API materials 上传端点 + psql 置 tag（避免依赖不存在脚本）
MAT_IDS=()
for f in clip1 clip2 clip3; do
  UP=$(curl -sf -X POST "$API_BASE/api/materials/upload" -H "X-Upload-Token: $UPLOAD_TOKEN" -F "files=@$WORK/$f.mp4;type=video/mp4")
  MID=$(echo "$UP" | jq -r '.data[0].id // .data.id // empty')
  [ -n "$MID" ] || { echo "FAIL: 素材上传未返回 id ($f)"; exit 1; }
  MAT_IDS+=("$MID")
done
# 置为 tagged 并给命中模板段的 ai_tags（真库真写，供候选生成语义检索）
psql "$DB_URL" -c "UPDATE zenithjoy.materials SET tag_status='tagged', ai_tags=ARRAY['开场','特写','产品特写','使用场景','行动号召','下单'] WHERE id = ANY('{$(IFS=,; echo "${MAT_IDS[*]}")}'::uuid[]) AND tenant_id='$TENANT_ID'" >/dev/null

echo "== Step B: 素材在线预览重签 + 跨租户隔离 =="
MID0="${MAT_IDS[0]}"
RB=$(curl -sf "$API_BASE/api/materials/$MID0/preview" -H "X-Upload-Token: $UPLOAD_TOKEN")
echo "$RB" | jq -e '.data.materialId=="'"$MID0"'"' >/dev/null || { echo "FAIL: preview materialId 不匹配"; exit 1; }
echo "$RB" | jq -e '(.data.previewAvailable|type=="boolean") and (.data.previewUrl|(type=="string" or .==null)) and (.data.expiresAt|type=="string")' >/dev/null || { echo "FAIL: preview schema"; exit 1; }
if [ -n "$OTHER_TENANT_TOKEN" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/materials/$MID0/preview" -H "X-Upload-Token: $OTHER_TENANT_TOKEN")
  [ "$CODE" = "404" ] || { echo "FAIL: 跨租户预览未 404 (=$CODE)"; exit 1; }
fi
echo "B OK previewAvailable=$(echo "$RB" | jq -r '.data.previewAvailable')"

echo "== Step C: 生成候选 targetCount=200（懒渲染，全 pending + 缩略图）=="
RUN=$(curl -sf -X POST "$API_BASE/api/mashup/runs" -H "X-Upload-Token: $UPLOAD_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"templateId\":\"$TID\",\"materialIds\":[\"${MAT_IDS[0]}\",\"${MAT_IDS[1]}\",\"${MAT_IDS[2]}\"]}")
RUN_ID=$(echo "$RUN" | jq -r '.data.runId')
[ -n "$RUN_ID" ] && [ "$RUN_ID" != null ] || { echo "FAIL: run 创建失败"; exit 1; }
GEN=$(curl -sf -X POST "$API_BASE/api/mashup/runs/$RUN_ID/candidates" -H "X-Upload-Token: $UPLOAD_TOKEN" -H 'Content-Type: application/json' -d '{"targetCount":200}')
echo "$GEN" | jq -e '.data.generatedCount|type=="number"' >/dev/null || { echo "FAIL: 缺 generatedCount"; exit 1; }
echo "$GEN" | jq -e '(.data.candidates|length) <= 200' >/dev/null || { echo "FAIL: 候选超过 200"; exit 1; }
echo "$GEN" | jq -e 'all(.data.candidates[]; .renderStatus=="pending")' >/dev/null || { echo "FAIL: 生成期存在非 pending 候选(未懒渲染)"; exit 1; }
echo "$GEN" | jq -e 'any(.data.candidates[]; .thumbnailUrl!=null)' >/dev/null || { echo "FAIL: 无任何缩略图拼贴"; exit 1; }
# 懒渲染硬证据：生成期该 run 没有任何成片 contents 产出
PRECNT=$(psql "$DB_URL" -tAc "SELECT count(*) FROM zenithjoy.contents c JOIN zenithjoy.mashup_candidates mc ON mc.id=c.source_candidate_id WHERE mc.run_id='$RUN_ID'" | tr -d ' ')
[ "$PRECNT" = "0" ] || { echo "FAIL: 生成期已产出成片=$PRECNT(未懒渲染)"; exit 1; }
CAND_A=$(echo "$GEN" | jq -r '.data.candidates[0].id')
CAND_B=$(echo "$GEN" | jq -r '.data.candidates[1].id // .data.candidates[0].id')
echo "C OK generatedCount=$(echo "$GEN" | jq -r '.data.generatedCount')"

echo "== Step D: 按需真实渲染 + 并发=1 队列 + 真实成片 =="
# 并行触发两条渲染，断言恰有一条进 queued（并发=1）
OUT_A=$(mktemp); OUT_B=$(mktemp)
curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN" > "$OUT_A" &
PA=$!
curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_B/render" -H "X-Upload-Token: $UPLOAD_TOKEN" > "$OUT_B" &
PB=$!
wait "$PA" "$PB" || true
QUEUED=$(cat "$OUT_A" "$OUT_B" | jq -rs '[.[]|.data.renderStatus] | map(select(.=="queued")) | length')
[ "${QUEUED:-0}" -ge 1 ] || { echo "FAIL: 并发两请求无一 queued，并发>1 违反 INV-3"; cat "$OUT_A" "$OUT_B"; exit 1; }
# 轮询 CAND_A 直到 rendered 或 render_failed（渲染并发=1，最长 8 分钟）
DEADLINE=$((SECONDS+480))
FINAL=""
until [ -n "$FINAL" ]; do
  ST=$(curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN" | jq -r '.data.renderStatus')
  case "$ST" in rendered|render_failed) FINAL="$ST";; esac
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: 渲染 8 分钟未终态 last=$ST"; exit 1; }
  [ -n "$FINAL" ] || sleep 5
done
if [ "$FINAL" = "render_failed" ]; then
  # 失败态可重试（非死路）：再次 POST 应重新入队而非报错
  RETRY=$(curl -sf -X POST "$API_BASE/api/mashup/candidates/$CAND_A/render" -H "X-Upload-Token: $UPLOAD_TOKEN" | jq -r '.data.renderStatus')
  echo "$RETRY" | grep -Eq '^(queued|rendering|rendered)$' || { echo "FAIL: render_failed 后不可重试(=$RETRY)"; exit 1; }
  echo "D OK 渲染失败态可重试 (render_failed→$RETRY)"
else
  # 成功：真实成片 export_url 非空 + ffprobe 有 video 流 + duration>0（-an 无音轨，不验 audio）
  EXPORT=$(psql "$DB_URL" -tAc "SELECT export_url FROM zenithjoy.contents WHERE source_candidate_id='$CAND_A' AND export_url IS NOT NULL AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
  [ -n "$EXPORT" ] || { echo "FAIL: rendered 但 contents.export_url 为空(假成功)"; exit 1; }
  curl -sf "$EXPORT" -o "$WORK/out.mp4" || { echo "FAIL: 成片下载失败"; exit 1; }
  ffprobe -v error -show_entries stream=codec_type -show_entries format=duration -of json "$WORK/out.mp4" > "$WORK/probe.json"
  jq -e '[.streams[].codec_type] | index("video")' "$WORK/probe.json" >/dev/null || { echo "FAIL: 成片无 video 流"; exit 1; }
  jq -e '(.format.duration|tonumber) > 0' "$WORK/probe.json" >/dev/null || { echo "FAIL: 成片 duration<=0"; exit 1; }
  echo "D OK 真实成片 duration=$(jq -r '.format.duration' "$WORK/probe.json")"
fi

echo "✅ 批量混剪加厚 Golden Path E2E 全过（hk-vps 真机）"
```

**通过标准**: 脚本 exit 0（A 分段落库 / B 预览重签+隔离 / C 候选懒渲染+缩略图 / D 并发=1+真实成片或失败可重试）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 12 分钟 / 18 动作（渲染耗时占用大，较默认略放大）
高风险面:
- 错输入: `POST /api/mashup/templates/from-script` 传 `{"script":""}`、`{"script":12345}`、超长 100KB 文案 → 应 400 或 degraded，不得 500 裸崩
- 重复提交: 对同一 `run` 连点两次「生成候选」；对同一 `candidate` 在 rendering 中再点「渲染」→ 不得产出重复成片、不得并发>1
- 中途中断: 渲染 rendering 态时并发发起第 3 个渲染请求 → 队列位次单调、不越过并发=1
- 边界值: `targetCount=0`（→400）、`targetCount=1`、`targetCount=99999`（应被 HARD_MAX 300 截断，返回 ≤300）；素材全为 reshoot_skipped 时候选留空槽位不崩
发现分级: P0/P1（并发>1 撑爆 CPU / 假成功给坏片 / 跨租户可见）→ 阻塞 merge；P2/P3（缩略图偶失/文案分段语义偏差）→ 记 findings 不阻塞

---

## staging 预览闸（user_facing 专属 — zenithjoy 仓 = 阻塞式）

### 步骤 A：落 staging
- ZenithJoy staging 环境（只引用现有部署脚本，不在合同内重造部署逻辑）；Dashboard + apps/api 部署到 ZJ staging。

### 步骤 B：Final E2E 在 staging 跑 + 截图
- Dashboard UI（PickStep 素材在线预览 `<video>`、候选虚拟滚动、渲染队列/失败态）用 Playwright 对已部署 ZJ staging 执行；截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`：
  - `staging-preview.png` 期望：PickStep 素材卡片渲染出 `<video>` 元素且实际发出 signedUrl 请求
  - `staging-candidates.png` 期望：候选缩略图拼贴虚拟滚动，DOM 节点数与可视区一致（非 200+ 全量渲染）
  - `staging-render.png` 期望：选中候选后出现「排队第 N 位 / 渲染中 / 渲染失败可重试」态

### 步骤 C：Bark 推主理人预览链接（阻塞式）
- 调用 `$BARK_URL` 通知主理人，附 staging 预览链接 + 截图 URL，**注明需主理人放行**。
- Brain PATCH 写 `approval_required:true`；prod promote 前核查 decisions/approval 字段，**未放行禁 promote**：
  ```bash
  curl -sf -X PATCH "localhost:5221/api/brain/tasks/$TASK_ID" -H 'Content-Type: application/json' \
    -d '{"metadata":{"staging_deployed":true,"approval_required":true,"staging_url":"<zj-staging-url>"}}'
  ```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Step1 文案动态分段 + 降级 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-segment.test.ts` | `from-script 返回动态 slots 并落库 mashup_templates` / `AI 不可用降级 degraded fallback` | 服务/端点未实现 → import/查询失败 N failures |
| Step3 候选 200+ 懒渲染 + 缩略图 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-candidates-lazy.test.ts` | `候选生成期 render_status 恒 pending` / `候选带 thumbnailUrl 与 generatedCount` | render_status/thumbnail_url 列不存在 → N failures |
| Step4 渲染队列并发=1 + 失败态 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts` | `渲染并发上限为 1 第二个入队 queued` / `render_failed 可重新入队` | 队列模块未实现 → import 失败 N failures |
| Step2 素材预览重签 + 隔离 | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-material-preview.test.ts` | `preview 返回重签 previewUrl 与 previewAvailable` / `跨租户 preview 返回 404` | 预览端点未注册 → 404/N failures |

补充行（repo 既有测试，非冻结产物）: `apps/api/src/routes/__tests__/mashup.test.ts`、`apps/api/src/services/__tests__/mashup-candidate-generation.test.ts`、`apps/api/src/services/__tests__/mashup-render.test.ts`（回归保护，generator 需同步更新）。
