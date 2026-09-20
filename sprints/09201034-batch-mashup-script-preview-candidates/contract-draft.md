# Sprint Contract Draft (Round 1) — 批量混剪加厚：文案动态分段 + 素材在线预览 + 候选200+可视化浏览

- 仓库: perfectuser21/zenithjoy-workspace（第三方 repo，非 cecelia worktree）
- contract-gate: skipped (file not found, third-party repo)
- journey_type: user_facing
- target_environment: linux_server（evaluator SSH hk-vps：真 ffmpeg/ffprobe/psql/node + TOAPIS 凭据；GHA/windows_cloud 无这些资源会全部假绿，见 PRD target_environment_reason）
- 锚定父路声明: **覆盖父路 line05/batch_mashup（批量混剪）第 1-4 步**（thin→medium 加厚，不新增独立小路）

---

## GP-Anchor

GP-Anchor: line05/batch_mashup#step3

> 说明：本加厚 sprint 的核心是 step3「客户刷到一屏候选方案任选」（候选 200+ 缩略图拼贴虚拟滚动 + 选定后才渲染），同时增强 step2（文案动态分段模板、素材在线预览）与 step4（渲染并发=1 队列 + 失败态）。按 lint-gp-anchor.sh 进度形态要求，本 PR 必须触碰该 GP 的 smoke_files 之一（本合同 DoD 要求 generator 回流 `mashup-candidate-generation-smoke.sh` / `mashup-render-smoke.sh`，满足 diff 触碰校验与铁律 1/5）。
> 写前已用 jq 核实 `line05/batch_mashup` 存在于 `product-map/generated/product-map.json`（返回 1）。

---

## Response Schema（推导来源：[NEW_PATTERN]，Brain api_registry 为 cecelia 侧、无 zenithjoy 端点；字段命名沿用现有 `apps/api/src/routes/mashup.ts` 的 camelCase 响应形状与统一信封 `{success,data,error,timestamp}`）

统一信封（现有 `mashup.ts` `ok()`/`fail()` 口径，不改）：
- 成功: `{"success": true, "data": <obj>, "error": null, "timestamp": "<iso>"}`
- 失败: `{"success": false, "data": null, "error": {"code": "<CODE>", "message": "<string>"}, "timestamp": "<iso>"}`

### Endpoint 1（新增）: `POST /api/mashup/templates/from-script`
鉴权: `X-Upload-Token: <license_key>` header（与 `mashup.ts`/`materials.ts` 同口径，租户从凭据反查）
Body: `{"script": "<客户粘贴的文案，string，非空>"}`
**Success (HTTP 200) `data`**:
```json
{
  "templateId": "<uuid>",
  "name": "<string>",
  "source": "ai",
  "segments": [
    {"key": "<string>", "role": "<string>", "roleMatched": true, "suggestedMaterialCount": 2, "match_tags": ["开场","悬念"]}
  ]
}
```
- `templateId` (string uuid, 必填): 新落库的 `zenithjoy.mashup_templates` 行 id（来源: [NEW_PATTERN]，沿用现有 `templateId` 命名）
- `name` (string, 必填): 模板名（AI 生成或降级默认名）
- `source` (string enum, 必填): `"ai"`（AI 分段成功）或 `"fallback"`（AI 不可用，静默降级固定四槽位模板）——PRD Golden Path 1 失败分支
- `segments` (array, 必填, length≥1): 分段数组
  - `key` (string): 槽位键（映射进 `mashup_templates.slots[].key`）
  - `role` (string): 该段角色/语义标签
  - `roleMatched` (boolean): 角色是否命中现有 `materials.ai_tags` 体系；`false` = 「兜底映射」（决策 f33415af，复用 S1 ai_tags）
  - `suggestedMaterialCount` (int, ≥1): 该段建议素材数量
  - `match_tags` (string[]): 该槽位关键词（命中则取 ai_tags 同义词，未命中取兜底关键词）
**禁用字段名**（禁止漂移，只允许上面字面 key）: `template_id`、`slots`（顶层不得直接叫 slots，段结构叫 `segments`）、`negation`、`fallback`（作为顶层 key）
**Error (HTTP 4xx) `error.code`**: `INVALID_BODY`（script 缺失/空/非字符串 → 400）、`UNAUTHORIZED`（无 token → 401）

### Endpoint 2（新增）: `GET /api/materials/:id/preview-url`
鉴权: `X-Upload-Token: <license_key>`
**Success (HTTP 200) `data`**:
```json
{"materialId": "<uuid>", "previewUrl": "<signed url string>"}
```
- `previewUrl` (string, 必填): 复用现有 `MaterialStorage.getSignedUrl` 签发的临时 URL，供 PickStep 前端渲染 `<video>` 并在过期时重签（PRD Golden Path 2）
**Error**: `BAD_ID`（非 UUID → 400）、`NOT_FOUND`（不属于当前租户 → 404，与 materials DELETE 同口径，不回 403 以免变探测接口）、`UNAUTHORIZED`（401）

### Endpoint 3（扩展现有）: `POST /api/mashup/runs/:id/candidates` + `GET /api/mashup/runs/:id/candidates`
Body（POST）: `{"targetCount": 200}`（现有已支持，`HARD_MAX_TARGET_COUNT=300`，200 合法）
**Success (HTTP 200) `data`**:
```json
{
  "runId": "<uuid>",
  "candidates": [
    {"id": "<uuid>", "score": 1.23, "slotFill": {"hook": "<mid>"}, "thumbnailCollageUrl": "<string|null>"}
  ]
}
```
- `candidates` (array, length ≤ targetCount): 去重后实际候选（PRD 决策 3ed368c3：如实显示 N 条，不承诺死数字 200）
- `thumbnailCollageUrl` (string|null, **新增字段，必须存在此 key**): 缩略图拼贴 URL（抽帧自 `video-frame-extract.ts`）；抽帧失败该条为 `null`，但 key 必须存在（PRD Golden Path 3 可视化浏览）
**禁用字段名**: `thumbnail`（单数无 collage 语义）、`thumbnails`
**Error**: `RUN_NOT_FOUND`（404）、`INVALID_BODY`（targetCount≤0 → 400）

### Endpoint 4（扩展现有）: `POST /api/mashup/candidates/:id/render`（渲染并发=1 队列 + 失败态）
鉴权: `X-Upload-Token: <license_key>`
**Success (HTTP 200) `data`**:
```json
{"jobId": "<uuid>", "status": "rendering", "queuePosition": 0}
```
- `status` (string enum, 必填): `"rendering"`（已获得唯一渲染槽，正在渲染）/ `"queued"`（并发上限=1 已占，排队）/ `"done"`（同步完成，含 `contentId`）/ `"failed"`（渲染失败，PRD Golden Path 4「渲染失败」态，可重渲/换候选）
- `queuePosition` (int, 必填): 排队位次，`0`=当前正在渲染，`≥1`=队列中第 N 位（PRD「第 N 位」）
- `jobId` (string uuid, 必填): `zenithjoy.mashup_render_jobs` 行 id，供轮询状态
- 完成态附加 `contentId`/`safetyCheckStatus`/`watermarkCheckStatus`/`exportUrl`（沿用现有 `RenderCandidateResult`，S4 内容安全逻辑不动）
**失败语义**: ffmpeg 合成失败或素材全部下载失败 → job `status="failed"`，非死路，客户可再次 POST render（重渲）或 select 另一候选后 render（换候选）

---

## 真实调用方请求 shape（规则 A）

本 sprint 服务端的真实调用方是 **Dashboard 浏览器前端**（`apps/dashboard/src/api/mashup.api.ts` / `materials.api.ts`），非设备/agent。逐字段一致口径（DoD 断言构造请求必须与此一致）：

| 维度 | 生产调用方实情（摘自 `apps/dashboard/src/api/mashup.api.ts:77` `authHeaders()`） | DoD/E2E 必须一致 |
|---|---|---|
| 认证 | HTTP header `X-Upload-Token: <license_key>`（前端先用登录态从 `/account/me` 换出 `license.license_key` 再带上）| E2E 用 `X-Upload-Token: <seeded license_key>`，**不走 body 传 tenant_id** |
| 租户 | 服务端 `validateLicense(token)` 反查 `licenses.tenant_id`，**绝不信客户端自报**（`mashup.ts:34` `authenticate`）| 断言租户隔离：跨租户 token 拿不到别人 run/candidate |
| Content-Type | `application/json` | 一致 |

> 无「设备/agent 调服务端」双路径分叉风险：所有端点单一走 `X-Upload-Token`。

---

## 禁 mock 边清单（规则 v9.12 — 本单涉 DB 写路径 + 渲染状态机 + 跨模块调度）

- 代码 ↔ `zenithjoy.mashup_templates` 表（Endpoint1 from-script 新增 INSERT 一行模板）：合同 integration 测试必须真 Postgres 验行落库，禁 mock `pool`
- 代码 ↔ `zenithjoy.mashup_candidates` 表（Endpoint3 候选行读写 + `thumbnailCollageUrl` 产出）：真 Postgres 验字段，禁 mock `pool`
- 代码 ↔ `zenithjoy.mashup_render_jobs` 表（Endpoint4 渲染状态机 queued→rendering→done/failed 迁移，本单新建表）：真 Postgres 验状态迁移，禁 mock `pool`
- 渲染并发闸 ↔ 真 ffmpeg 进程（concurrency=1 队列）：E2E 必须真 ffmpeg，禁用假计时器/假进程；观测「任一时刻 rendering 态 job ≤ 1」
- 允许 mock 的更外层边界：TOAPIS/Gemini HTTP 传输（在纯逻辑单测中可替身，但 DoD 至少一条 [BEHAVIOR] 真调 TOAPIS 一次——见规则 B / B-01）

> 纯逻辑模块（`mashup-script-segment.ts` 的角色→标签映射、`mashup-thumbnail.ts` 的拼贴 URL 构造、`render-concurrency.ts` 的并发闸计数）不触 DB，允许纯单测——这些不是「被改的 DB 边」，是被改边的上游纯函数。

---

## 未覆盖真实链路清单（规则 C）

| 被 mock/替身顶替的真实链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| Final 渲染的「真实 COS 素材下载 → ffmpeg 合成 1080P 成片 → 内容安全 Gate 通过 → 真上传」全链 | 本 sprint 只改渲染**排队/失败态编排**（Endpoint4），S4 渲染 + 内容安全逻辑属 PRD「已有，不动」范围（范围限定第 40 行）；E2E 播种素材指向不存在的 storage_key，真实成片不可达 | 由现有 `mashup-render-smoke.sh`（真 ffmpeg concatAndScale + fail-closed）+ golden-path smoke 覆盖，本合同不重复背该不确定性；本合同 E2E 用 lavfi 合成替身单独验 ffmpeg 层产出 video+audio 流（B-06） |
| from-script 的 TOAPIS 调用在**纯逻辑单测**里替身（解析函数不打网络） | 控成本 + 确定性 | DoD B-01 有一条真 key 真请求真响应校验（规则 B），非全 mock |

---

## Golden Path

[客户粘贴文案] → [确认动态分段模板] → [在线预览挑素材] → [刷 200+ 缩略图选候选] → [选中后真实渲染出成片]

### Step 1: 客户粘贴文案 → 系统解析动态分段模板（AI 失败静默降级）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（第 18-19 行）：调 TOAPIS/Gemini 解析分段结构 + 每段建议素材数，角色映射 ai_tags，落新 mashup_templates 行；失败静默降级固定模板

**可观测行为**: `POST /api/mashup/templates/from-script` 返回 `segments[]` + `source`，`zenithjoy.mashup_templates` 新增一行

**验证命令**:
```bash
FS=$(curl -fs -H "X-Upload-Token: $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/mashup/templates/from-script" \
  -d '{"script":"开场用悬念钩子，然后产品特写细节，接着使用效果对比证据，最后行动号召引导下单"}')
echo "$FS" | jq -e '.success==true and (.data.templateId|type=="string") and (.data.segments|length>=1) and (.data.source=="ai" or .data.source=="fallback")'
TID=$(echo "$FS" | jq -r '.data.templateId')
psql "$E2E_DATABASE_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_templates WHERE id='$TID' AND created_at > NOW() - INTERVAL '5 minutes'" | grep -qx 1
```
**硬阈值**: HTTP 200；segments≥1；source∈{ai,fallback}；模板 5 分钟内落库 count=1

---

### Step 2: 客户在素材选择步骤在线预览视频
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（第 20-21 行）：素材卡片在线播放预览（复用 signedUrl），渲染 `<video>`；过期自动重签

**可观测行为**: `GET /api/materials/:id/preview-url` 返回可用 signedUrl；PickStep 渲染 `<video src=previewUrl>`

**验证命令**:
```bash
PV=$(curl -fs -H "X-Upload-Token: $TOKEN" "$BASE_URL/api/materials/$M1/preview-url")
echo "$PV" | jq -e '.success==true and (.data.previewUrl|type=="string") and (.data.previewUrl|length>0)'
```
**硬阈值**: HTTP 200；previewUrl 为非空字符串

---

### Step 3: 客户生成候选 → 200+ 缩略图拼贴虚拟滚动浏览
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（第 22 行）：targetCount 放大到 200，J10 去重（Jaccard 0.8）+ beamWidth，缩略图拼贴卡片可视化，如实显示 N 条

**可观测行为**: `POST /runs/:id/candidates {targetCount:200}` 返回候选（≤200），每条含 `thumbnailCollageUrl` key；前端虚拟滚动 DOM 节点数 ≈ 可视区（非全量 200）

**验证命令**:
```bash
CANDS=$(curl -fs -H "X-Upload-Token: $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/mashup/runs/$RID/candidates" -d '{"targetCount":200}')
echo "$CANDS" | jq -e '(.data.candidates|length>=1) and (.data.candidates|length<=200)'
echo "$CANDS" | jq -e '[.data.candidates[]|has("thumbnailCollageUrl")]|all'
```
**硬阈值**: 1 ≤ candidates.length ≤ 200；每条候选都含 `thumbnailCollageUrl` key（可为 null）

---

### Step 4: 选中候选 → 此刻才真实 ffmpeg 渲染（并发=1，排队/失败态）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（第 23-24 行）：选中才渲染（此前候选未渲染），渲染并发上限=1 排队显示「第 N 位」，渲染失败态可重渲/换候选
**来源**: `[AI_ADDED]` — 新建 `zenithjoy.mashup_render_jobs` 表承载状态机（理由：PRD 要求可观测的「排队位次 / 失败态」，需持久化状态才能被 evaluator 真机观测「任一时刻 rendering ≤ 1」，防止用假计时器/内存态骗过并发验证）

**可观测行为**: 第一个 render → `status=rendering`；并发第二个 render → `status=queued, queuePosition≥1`；任一时刻 `mashup_render_jobs` 中 `status='rendering'` 的行 ≤ 1

**验证命令**:
```bash
curl -fs -H "X-Upload-Token: $TOKEN" -X POST "$BASE_URL/api/mashup/candidates/$CID_A/render" -d '{}' -H 'content-type: application/json' >/tmp/rA.json &
curl -fs -H "X-Upload-Token: $TOKEN" -X POST "$BASE_URL/api/mashup/candidates/$CID_B/render" -d '{}' -H 'content-type: application/json' >/tmp/rB.json &
MAXC=0; SAWQ=0
for i in $(seq 1 40); do
  C=$(psql "$E2E_DATABASE_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id='$TENANT_ID' AND status='rendering'")
  [ "${C:-0}" -gt "$MAXC" ] && MAXC="$C"
  Q=$(psql "$E2E_DATABASE_URL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id='$TENANT_ID' AND status='queued'")
  [ "${Q:-0}" -ge 1 ] && SAWQ=1
  sleep 1
done
wait
[ "$MAXC" -le 1 ] || { echo "FAIL: 并发渲染超过1 max=$MAXC"; exit 1; }
[ "$SAWQ" = 1 ] || { echo "FAIL: 未观察到 queued 排队态"; exit 1; }
```
**硬阈值**: `MAXC ≤ 1`（并发实测=1）；`SAWQ=1`（观察到 queued）

---

## E2E 验收（final-e2e 跑 — target_environment=linux_server，由 evaluator SSH hk-vps 执行）

**journey_type**: user_facing
**target_environment**: linux_server（hk-vps：真 ffmpeg/ffprobe/psql/node + `~/.credentials/toapis.env`）

> evaluator 把本段全部 bash 块按序拼接执行。单块。Fleet/evaluator 注入 `E2E_DATABASE_URL`（hk-vps 隔离测试库，非生产库）；TOAPIS 真凭据从 hk-vps `~/.credentials/toapis.env` 加载（规则 B 真调一次）。鉴权由 E2E 自举播种 tenant+license（不预注入业务凭据）。角色/能力身份 late-bound：脚本内如需运行角色身份用 Runner 注入的 `$HARNESS_ATTEMPT_ID` 等运行时变量，不写 UUID 字面值。

```bash
#!/bin/bash
set -euo pipefail
: "${E2E_DATABASE_URL:?evaluator/Fleet 必须注入 hk-vps 测试库 E2E_DATABASE_URL}"
export PGURL="$E2E_DATABASE_URL"
# apps/api 的 pg Pool 读 DATABASE_HOST/PORT/NAME/USER/PASSWORD（connection.ts），不读 DATABASE_URL；
# 从 E2E_DATABASE_URL 解析出这些，保证启动的 API 与 psql 打同一个隔离测试库
eval "$(node -e '
const u = new URL(process.env.E2E_DATABASE_URL);
const out = {
  DATABASE_HOST: u.hostname,
  DATABASE_PORT: u.port || "5432",
  DATABASE_NAME: decodeURIComponent(u.pathname.replace(/^\//, "")),
  DATABASE_USER: decodeURIComponent(u.username),
  DATABASE_PASSWORD: decodeURIComponent(u.password),
};
for (const k of Object.keys(out)) process.stdout.write("export " + k + "=" + JSON.stringify(String(out[k])) + "\n");
')"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
# TOAPIS 真凭据（规则 B）：存在才加载；缺失时 from-script 走 fallback 分支（PRD 允许静默降级）
if [ -f "$HOME/.credentials/toapis.env" ]; then set -a; . "$HOME/.credentials/toapis.env"; set +a; fi

for bin in psql node ffmpeg ffprobe curl jq npm; do
  command -v "$bin" >/dev/null 2>&1 || { echo "FAIL: 缺必需命令 $bin"; exit 1; }
done
psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "SELECT 1" >/dev/null || { echo "FAIL: 测试库连不上"; exit 1; }

SFX="e2e-$(date +%s)-${RANDOM}"
APP_PID=""
cleanup() {
  [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.licenses WHERE license_key='ZJ-$SFX'" >/dev/null 2>&1 || true
  psql "$PGURL" -q -c "DELETE FROM zenithjoy.tenants WHERE license_key='ZJ-$SFX'" >/dev/null 2>&1 || true
  rm -f /tmp/rA.json /tmp/rB.json /tmp/e2e-a.mp4 /tmp/e2e-b.mp4 /tmp/e2e-out.mp4
}
trap cleanup EXIT

# 1. build + migrate（幂等；空库/存量库都保证 schema 就绪）
( cd apps/api && npm run build >/dev/null 2>&1 && npm run migrate >/dev/null 2>&1 ) || { echo "FAIL: apps/api build/migrate"; exit 1; }
psql "$PGURL" -tAc "SELECT to_regclass('zenithjoy.mashup_templates') IS NOT NULL" | grep -qx t || { echo "FAIL: mashup schema 未就绪"; exit 1; }
psql "$PGURL" -tAc "SELECT to_regclass('zenithjoy.mashup_render_jobs') IS NOT NULL" | grep -qx t || { echo "FAIL: mashup_render_jobs 表未建（Endpoint4 迁移缺失）"; exit 1; }

# 2. 启动真实 apps/api，等待就绪（无 token 打 templates 应回 401 = 服务在线且路由已挂）
( cd apps/api && PORT=3000 npm start ) >/tmp/e2e-api.log 2>&1 &
APP_PID=$!
READY=0
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/mashup/templates" || echo 000)
  [ "$CODE" = "401" ] && { READY=1; break; }
  sleep 1
done
[ "$READY" = 1 ] || { echo "FAIL: API 未在 60s 内就绪"; tail -30 /tmp/e2e-api.log; exit 1; }

# 3. 自举播种 tenant + license（真实鉴权链，不预注入业务凭据）
TENANT_ID=$(psql "$PGURL" -tAc "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('e2e-$SFX','ZJ-$SFX','free') RETURNING id" | tr -d '[:space:]')
[ -n "$TENANT_ID" ] || { echo "FAIL: 播种 tenant 失败"; exit 1; }
psql "$PGURL" -tAc "INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, tenant_id, status, expires_at) VALUES ('ZJ-$SFX','studio',5,'$TENANT_ID','active', NOW()+INTERVAL '1 day') RETURNING id" >/dev/null || { echo "FAIL: 播种 license 失败"; exit 1; }
TOKEN="ZJ-$SFX"
# 自举鉴权可用性硬核：带 token 打 templates 必须 200（若 validateLicense 因 key 规范化拒绝，这里 loud-fail 而非静默）
curl -fs -H "X-Upload-Token: $TOKEN" "$BASE_URL/api/mashup/templates" | jq -e '.success==true' >/dev/null || { echo "FAIL: 自举 license 鉴权不通过（token 校验/规范化问题）"; exit 1; }

# 播种 3 条已打标签素材（S1 产物，供槽位分配/候选生成）
seed_mat() { psql "$PGURL" -tAc "INSERT INTO zenithjoy.materials (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, tag_status, ai_tags) VALUES ('$TENANT_ID','$TENANT_ID/k-$1-$SFX','$1.mp4','video/mp4',1024,'d-$1-$SFX','tagged','$2'::jsonb) RETURNING id" | tr -d '[:space:]'; }
M1=$(seed_mat hook '["开场","悬念","特写"]')
M2=$(seed_mat product '["产品特写","细节","主体"]')
M3=$(seed_mat cta '["行动号召","下单","结尾"]')
[ -n "$M1" ] && [ -n "$M2" ] && [ -n "$M3" ] || { echo "FAIL: 播种素材失败"; exit 1; }

AUTH=(-H "X-Upload-Token: $TOKEN" -H 'content-type: application/json')

# ── GP Step1: 文案 → 动态分段模板（真 TOAPIS 或 fallback；均须落库）──
FS=$(curl -fs "${AUTH[@]}" -X POST "$BASE_URL/api/mashup/templates/from-script" \
  -d '{"script":"开场用一个悬念钩子抓住注意力，然后展示产品特写和细节，接着放使用效果对比作为证据，最后行动号召引导下单购买"}')
echo "$FS" | jq -e '.success==true and (.data.templateId|type=="string") and (.data.segments|length>=1) and (.data.source=="ai" or .data.source=="fallback") and ([.data.segments[]|has("roleMatched") and (.suggestedMaterialCount>=1)]|all)' || { echo "FAIL: from-script schema 不符 resp=$FS"; exit 1; }
TID=$(echo "$FS" | jq -r '.data.templateId')
psql "$PGURL" -tAc "SELECT count(*) FROM zenithjoy.mashup_templates WHERE id='$TID' AND tenant_id='$TENANT_ID' AND created_at > NOW() - INTERVAL '5 minutes'" | grep -qx 1 || { echo "FAIL: mashup_templates 未落库"; exit 1; }
echo "✅ GP1 文案动态分段模板落库 source=$(echo "$FS" | jq -r '.data.source')"

# ── GP Step2: 素材在线预览 signedUrl ──
PV=$(curl -fs "${AUTH[@]}" "$BASE_URL/api/materials/$M1/preview-url")
echo "$PV" | jq -e '.success==true and (.data.previewUrl|type=="string") and (.data.previewUrl|length>0)' || { echo "FAIL: preview-url schema resp=$PV"; exit 1; }
echo "✅ GP2 素材在线预览 previewUrl OK"

# ── GP Step3: run → 候选 targetCount=200 + thumbnailCollageUrl ──
RUN=$(curl -fs "${AUTH[@]}" -X POST "$BASE_URL/api/mashup/runs" -d "{\"templateId\":\"$TID\",\"materialIds\":[\"$M1\",\"$M2\",\"$M3\"]}")
RID=$(echo "$RUN" | jq -r '.data.runId'); [ -n "$RID" ] && [ "$RID" != null ] || { echo "FAIL: run 创建失败 resp=$RUN"; exit 1; }
CANDS=$(curl -fs "${AUTH[@]}" -X POST "$BASE_URL/api/mashup/runs/$RID/candidates" -d '{"targetCount":200}')
echo "$CANDS" | jq -e '(.data.candidates|length>=1) and (.data.candidates|length<=200)' || { echo "FAIL: 候选数越界 resp=$CANDS"; exit 1; }
echo "$CANDS" | jq -e '[.data.candidates[]|has("thumbnailCollageUrl")]|all' || { echo "FAIL: 候选缺 thumbnailCollageUrl"; exit 1; }
NCAND=$(echo "$CANDS" | jq -r '.data.candidates|length')
echo "✅ GP3 候选生成 $NCAND 条（≤200），每条含 thumbnailCollageUrl"

# ── GP Step4: 选中 → 渲染并发=1 观测（接缝×2）──
CID_A=$(echo "$CANDS" | jq -r '.data.candidates[0].id')
CID_B=$(echo "$CANDS" | jq -r '.data.candidates[1].id // .data.candidates[0].id')
curl -fs "${AUTH[@]}" -X POST "$BASE_URL/api/mashup/candidates/$CID_A/select" -d '{}' | jq -e '.data.selectedCandidateId' >/dev/null || { echo "FAIL: select 候选失败"; exit 1; }
curl -fs "${AUTH[@]}" -X POST "$BASE_URL/api/mashup/candidates/$CID_A/render" -d '{}' >/tmp/rA.json &
curl -fs "${AUTH[@]}" -X POST "$BASE_URL/api/mashup/candidates/$CID_B/render" -d '{}' >/tmp/rB.json &
MAXC=0; SAWQ=0
for i in $(seq 1 40); do
  C=$(psql "$PGURL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id='$TENANT_ID' AND status='rendering'" | tr -d '[:space:]')
  [ "${C:-0}" -gt "$MAXC" ] && MAXC="${C:-0}"
  Q=$(psql "$PGURL" -tAc "SELECT count(*) FROM zenithjoy.mashup_render_jobs WHERE tenant_id='$TENANT_ID' AND status='queued'" | tr -d '[:space:]')
  [ "${Q:-0}" -ge 1 ] && SAWQ=1
  sleep 1
done
wait || true
[ "$MAXC" -le 1 ] || { echo "FAIL: 渲染并发超过1 max=$MAXC"; exit 1; }
[ "$SAWQ" = 1 ] || { echo "FAIL: 未观察到 queued 排队态（并发第二请求应排队）"; exit 1; }
echo "✅ GP4 渲染并发=1 实测（max rendering=$MAXC），观察到 queued 排队态"

# ── 视频领域 oracle：真 ffmpeg 渲染管线产出 video+audio 流（decouple 于 TOAPIS/真素材）──
ffmpeg -f lavfi -i "testsrc2=duration=1:size=640x480:rate=15" -f lavfi -i "sine=frequency=440:duration=1" -shortest -y /tmp/e2e-a.mp4 >/dev/null 2>&1 || { echo "FAIL: 造测试素材a失败"; exit 1; }
ffmpeg -f lavfi -i "testsrc=duration=1:size=320x240:rate=15" -f lavfi -i "sine=frequency=880:duration=1" -shortest -y /tmp/e2e-b.mp4 >/dev/null 2>&1 || { echo "FAIL: 造测试素材b失败"; exit 1; }
RENDER_OK=$(node -e "const {concatAndScale}=require('./apps/api/dist/services/mashup-render-ffmpeg.js'); process.stdout.write(concatAndScale(['/tmp/e2e-a.mp4','/tmp/e2e-b.mp4'],'/tmp/e2e-out.mp4')?'yes':'no')")
[ "$RENDER_OK" = "yes" ] || { echo "FAIL: concatAndScale 渲染失败"; exit 1; }
ffprobe -v error -show_entries stream=codec_type -of json /tmp/e2e-out.mp4 | jq -e '[.streams[].codec_type]|(index("video") and index("audio"))' || { echo "FAIL: 渲染产物缺 video/audio 流"; exit 1; }
echo "✅ 视频领域 oracle：ffmpeg 渲染产物含 video+audio 流"

echo "✅ Golden Path 全程验证通过（批量混剪加厚 line05/batch_mashup step1-4）"
```

---

## staging 预览闸（user_facing 专属，cecelia 仓 → 通知式）

> BASE_REPO 判定：本仓库为 `zenithjoy-workspace`。按 skill v9.16 「按 BASE_REPO 定模式」，zenithjoy 仓 → **阻塞式**预览闸（需主理人放行）。

### 步骤 A：落 staging
- ZenithJoy staging 环境（只引用现有部署脚本，不在本合同重造 staging 部署逻辑）；地址与部署脚本沿用仓库现有 CI/staging 工作流。

### 步骤 B：Final E2E 在 staging 跑 + 截图
- 上面 `## E2E 验收` 脚本在 staging 环境（hk-vps 测试库 + 真 ffmpeg）执行；关键 UI（PickStep 在线预览 `<video>`、候选缩略图虚拟滚动、渲染排队/失败态）截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`。

### 步骤 C：Bark 推主理人预览链接（阻塞式）
- 调 `$BARK_URL` 通知主理人，附 staging 预览链接 + 截图 URL，**注明需主理人放行**；Brain PATCH 写 `approval_required:true`；prod promote 前核查 decisions/approval 字段，未放行禁 promote。
```bash
# PATCH localhost:5221/api/brain/tasks/$TASK_ID metadata: {staging_deployed:true, approval_required:true, staging_url:"..."}
```

---

## 已知约束（来自回归测试 + 累积 FR）

回归测试约束（Step 1.2）：
- [apps/api/src/routes/__tests__/mashup.test.ts] → 没有凭据 → 401；缺 templateId → 400 不触碰 DB；租户从凭据反查
- [apps/api/src/services/__tests__/mashup-candidate-generation.test.ts] → J10 去重、beamWidth、reshoot_skipped/unfilled 槽位在候选里透传为空
- [apps/api/src/services/__tests__/mashup-render.test.ts] → fail-closed（安全/水印非通过 → export_url NULL）；候选不存在 loud-fail
- [.github/workflows/scripts/smoke/mashup-candidate-generation-smoke.sh] → 语义判别力（相关>不相关）、候选落库数一致、evidence unfilled 透传空、run 不存在 loud-fail
- [.github/workflows/scripts/smoke/mashup-render-smoke.sh] → 真 ffmpeg concatAndScale 统一 1920x1080、无 TOAPIS key → failed_pending_review 且不给 export_url

累积 FR（`[累积FR]` 来源 product-map line05/batch_mashup active + PR#1878；context-manifest 端点为 cecelia Brain，zenithjoy 无对应 journey 结构化行，记 `context-manifest: unavailable`）：
- 批量混剪 S1-S4 已验收：打标签→槽位分配→候选生成(J10 去重 Jaccard0.8/beamWidth)→ffmpeg 渲染+内容安全 Gate+内联预览；本 sprint 不得回退这些行为
- `must_run_assertions`: `[MAP_NOT_CONFIGURED]`（task.payload 无 map_scope/map_repo，Brain map 未对本 repo 配置；不回退到领域硬编码，仅以上述回归测试/smoke 为已知约束源）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①文案→动态分段模板（新端点，落库）②素材在线预览 signedUrl（新端点 + 前端 `<video>`）③候选 targetCount=200 + thumbnailCollageUrl 可视化虚拟滚动 ④选中才渲染 + 并发=1 队列 + 失败态 |
| **NFR（做得多好）** | 性能/可靠 | 渲染并发上限=1（hk-vps 4 核硬约束）；候选去重 Jaccard=0.8（复用现有）；前端候选虚拟滚动 DOM 节点数≈可视区（非全量 200）；AI 分段失败静默降级不阻断 |
| **Invariant（永不违反）** | 不变量 | 租户隔离（素材/模板/候选/render job 按租户；跨租户不可见）；所有端点鉴权（X-Upload-Token）；TOAPIS 凭据不硬编码（从 ~/.credentials 读）；日志脱敏（candidateId 不拼进 console.error 格式串，沿用现有）；不写死候选数 200（如实显示实际值） |
| **判定点（怎么知道）** | 见下方登记表 | 见判定点登记表 |
| **保质期（何时过期）** | 失效/退役 | signedUrl 临时有效（过期前端自动重签）；mashup_render_jobs 渲染任务为一次性态机，done/failed 后不复用 |
| **死亡告警（停了谁知道）** | 告警 | 渲染失败 → job status=failed 客户可见（PRD 可观测约束）；AI 分段不可用 → source=fallback 客户可见（降级非静默丢失，日志记 reason） |
| **失败语义（挂了怎么办）** | 见下方失败语义声明 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | from-script 落库 count 校验；候选真落 mashup_candidates；渲染 job 状态机真机观测 rendering≤1 + queued 出现 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ AI 分段解析是否成功（决定 source=ai 还是 fallback） | A. AI 返回可解析 segments 即 ai; B. 任何异常/超时/空解析归 fallback | B. 异常/超时/超长/鉴权失效/欠费/5xx/网络错误统一归「AI 不可用」→ fallback | PRD Golden Path 1 失败分支明确要求静默降级不阻断 | 误判为 ai 但 segments 错乱 → 客户拿到烂模板；故解析不出结构一律归 fallback |
| 角色标签是否命中 ai_tags 体系（roleMatched） | A. 精确匹配 ai_tags 枚举; B. 语义近似 | A. 命中现有 ai_tags 同义集则 roleMatched=true，否则「兜底映射」roleMatched=false | 决策 f33415af 复用 S1 ai_tags，优先实现速度 | 个别语义对不齐 → 标兜底映射，客户可手动调整，不静默 |
| 渲染是否达并发上限（决定 rendering 还是 queued） | A. 内存计数器; B. DB render_jobs 表 status='rendering' 计数 | B. DB `mashup_render_jobs` status 计数 | 内存态多进程/重启后丢失且不可被 evaluator 真机观测；DB 态可持久化可观测 | 误判会并发 >1 拖垮 4 核 hk-vps（PRD 要规避的正是这个） |
| 候选缩略图抽帧失败如何呈现 | A. 整条候选作废; B. thumbnailCollageUrl=null 但候选保留 | B. null 占位，候选仍可选 | 与素材损坏「预览不可用不阻断选择」同精神 | 抽帧失败不该让候选消失 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| TOAPIS/Gemini 分段调用超时/5xx/鉴权失效/欠费 | 不抛给客户，返回 source=fallback + 固定四槽位模板 | 是（重试再调 AI，失败仍 fallback） | 静默降级固定模板，不阻断（PRD 第 19 行） |
| ffmpeg 渲染失败 / 素材全下载失败 | render job status=failed，返回 status=failed | 是（可再次 POST render 重渲，或换候选） | 新增「渲染失败」态，非死路 |
| 并发第二个渲染请求 | 不拒绝、不并发执行 | 是 | 进 queued 队列，返回 queuePosition |
| signedUrl 过期 | 前端拿到 403/过期 | 是 | 前端自动重签重试（调 preview-url） |
| 提交/保存重复点击 | 按钮禁用 + 去抖 | 是 | 防重复提交（决策 436b6ad5，单租户单人不上乐观锁） |

### 输入对抗面（对外暴露 agent — from-script 客户文案进 LLM prompt，必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| `POST /templates/from-script` body `script`（客户粘贴任意文案，拼进 Gemini 分段 prompt） | 不可信（客户可控自由文本） | script 作为「待结构化的素材文本」输入，prompt 明确指令模型只输出分段结构（沿用 material-tagging.ts 严格输出格式约束）；模型输出**只取结构化 segments 字段**，忽略任何自然语言指令；解析不出结构 → fallback，不执行文案中的任何「指令」 | 分段结果只写本租户 mashup_templates（租户从凭据反查），文案无法越权访问其他租户/改系统行为；输出经服务端 schema 校验，非法结构丢弃走 fallback |

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `POST /templates/from-script` 传 `script:""`（空）/ `script:12345`（非字符串）/ 超长 10 万字文案 → 应 400 或 fallback，不 500、不挂起
- 重复提交: 对同一候选连点两次 render → 第二次应 queued，不启动两个 ffmpeg
- 中途中断: render job 处于 rendering 时杀 API 进程再重启 → 重启后不应残留「幽灵 rendering」永久占满并发闸（状态应可恢复/超时释放）
- 边界值: `targetCount=0` → 400；`targetCount=100000` → 服务端夹到 HARD_MAX_TARGET_COUNT=300，不越界；候选为 0 条时前端如实显示「共生成 0 条候选」不崩
- 越权: 用租户 A 的 token 请求租户 B 的 material preview-url / candidate render → 404，不泄露存在性
发现分级: P0/P1（丢数据/跨租户泄露/并发>1 拖垮机器/直接面客错误）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文案角色→标签映射 + 分段解析 + 缩略图拼贴 URL + 渲染并发闸（纯逻辑） | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thickening.test.ts` | `命中角色 roleMatched 为 true`、`未命中角色 兜底映射 roleMatched 为 false`、`解析文案得到至少一段 每段建议素材数至少1`、`拼贴 URL 是确定性非空字符串`、`并发上限1 第二次进入排队 queuePosition 至少1`、`释放后队首晋级为 rendering` | 模块 `mashup-script-segment.ts`/`mashup-thumbnail.ts`/`render-concurrency.ts` 不存在 → import 失败 → 全部 FAIL |
| DB 边真验（禁 mock 边 — 真 Postgres） | `sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thickening.integration.test.ts` | `from-script 真的往 mashup_templates 落一行`、`渲染并发上限1 render_jobs 任一时刻 rendering 至多一行` | 服务 `segmentScriptToTemplate`/`mashup_render_jobs` 表未实现 → CI brain-integration 真 PG 下 FAIL |

> Test File 列为完整真实路径（无省略号）。两文件均落 `sprints/<本sprint目录>/tests/` 并进 commit（满足 v9.27 冻结测试死规则 + runner finalizer HEAD 树校验）。integration 文件需真 PG，按 root `vitest.config.cjs`（include `sprints/**/tests/**` + `fileParallelism:false` + 真 Postgres）在 CI/evaluator 真库执行；纯逻辑文件无需 PG，proposer 侧已确认 RED。

---

## 合同格式自查

见随附 contract-dod.md；Step 2b-check 确定性自查脚本已在本轮执行通过（✅ 合同格式自查通过）。
