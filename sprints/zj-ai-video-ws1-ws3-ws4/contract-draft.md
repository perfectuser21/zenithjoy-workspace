# Sprint Contract Draft (Round 2)

## Golden Path

[用户填写 original_script textarea + 选 W-G 模板 + 选 9:16 比例] → [POST /api/ai-video-pipeline/ createJob] → [DB 写入 3 字段] → [Agent ffprobe 读 width/height + rotation swap] → [PATCH /api/ai-video-pipeline/:jobId/progress 写回 detected_aspect] → [effectiveTarget 只生成单文件] → [Agent version 1.1.29 + E2E 全链路验证]

---

### Step 1: DB migration — 3 新字段列存在

**来源**: `[FROM_PRD]` — PRD 背景段："DB migration（3 字段）" + Response Schema 含 original_script/target_aspect/detected_aspect

**可观测行为**: `zenithjoy.ai_video_pipeline_jobs` 表含 `original_script TEXT`、`target_aspect TEXT CHECK('9:16','16:9')`、`detected_aspect TEXT CHECK('9:16','16:9')` 3 列

**验证命令**:
```bash
COUNT=$(psql "$DB" -t -c "\d zenithjoy.ai_video_pipeline_jobs" | grep -E "original_script|target_aspect|detected_aspect" | wc -l | tr -d ' ')
[ "$COUNT" -eq 3 ] || { echo "FAIL: 期望 3 列，实际 $COUNT"; exit 1; }
echo OK
```

**硬阈值**: grep 到 3 列

---

### Step 2: POST /api/ai-video-pipeline/ — createJob 接受 3 字段并返回嵌套 .job 对象

**来源**: `[FROM_PRD]` — PRD Response Schema：POST 201 响应 `{"job":{"id":...,"original_script":...,"target_aspect":...,"detected_aspect":null}}`；禁用 `originalScript`

**可观测行为**: POST 后响应嵌套在 `.job`，含 snake_case 字段，不含 camelCase 变体；HTTP 201

**验证命令**:
```bash
RESP=$(curl -sf -w "\n%{http_code}" -X POST "localhost:3000/api/ai-video-pipeline/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"C:\\test.mp4","topic":"test","original_script":"录制前文案","target_aspect":"9:16"}')

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)

[ "$HTTP_CODE" = "201" ] || { echo "FAIL: HTTP $HTTP_CODE != 201"; exit 1; }

# 1. 嵌套结构存在
echo "$BODY" | jq -e '.job | type == "object"' || { echo "FAIL: 响应缺 .job 对象"; exit 1; }

# 2. 字段值校验
echo "$BODY" | jq -e '.job.original_script == "录制前文案"' || { echo "FAIL: job.original_script 值错"; exit 1; }
echo "$BODY" | jq -e '.job.target_aspect == "9:16"' || { echo "FAIL: job.target_aspect 值错"; exit 1; }
echo "$BODY" | jq -e '.job.detected_aspect == null' || { echo "FAIL: job.detected_aspect 初始应为 null"; exit 1; }

# 3. id 类型校验
echo "$BODY" | jq -e '.job.id | type == "string"' || { echo "FAIL: job.id 应为 string"; exit 1; }

# 4. schema 完整性 — 必填字段全部存在
echo "$BODY" | jq -e '(.job | has("id")) and (.job | has("original_script")) and (.job | has("target_aspect")) and (.job | has("detected_aspect"))' \
  || { echo "FAIL: .job 缺少必填字段"; exit 1; }

# 5. 禁用字段反向检查
echo "$BODY" | jq -e '.job | has("originalScript") | not' || { echo "FAIL: 禁用字段 originalScript 出现"; exit 1; }

echo OK
```

**硬阈值**: HTTP 201，全部 jq -e 通过

---

### Step 3: composeTemplate — original_script 有值时注入 Claude prompt 前缀

**来源**: `[FROM_PRD]` — PRD Golden Path WS1 第 3 步："有值时在 Claude prompt 前缀注入'用户录制前参考文案（非逐字稿，仅意图参考）：'"

**可观测行为**: AI controller 含前缀注入逻辑；original_script 为空/null 时不注入

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');
  if (!c.includes('用户录制前参考文案（非逐字稿，仅意图参考）')) process.exit(1);
  if (!c.includes('_originalScript') && !c.includes('originalScript')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: 前缀注入逻辑未实现"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 4: 前端 — original_script textarea + target_aspect 比例选择器存在

**来源**: `[FROM_PRD]` — PRD Golden Path WS1 第 1 步 + WS2 第 3 步

**可观测行为**: `LocalVideoPipelinePage.tsx` 含 `name="original_script"` textarea；createJob 调用时携带 `target_aspect`

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');
  if (!c.includes('original_script')) process.exit(1);
  if (!c.includes('target_aspect')) process.exit(1);
  if (!c.includes('9:16') && !c.includes('16:9')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: 前端缺 original_script textarea 或 target_aspect 选择器"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 5: Agent ffprobe — detectedAspect 计算 + rotation=90°/270° swap

**来源**: `[FROM_PRD]` — PRD Golden Path WS2 第 1-2 步

**可观测行为**: `services/agent/src/handlers/video-pipeline.ts` 含 `detectedAspect` + `effectiveWidth/effectiveHeight` + rotation swap 逻辑

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');
  if (!c.includes('detectedAspect')) process.exit(1);
  if (!c.includes('effectiveWidth') || !c.includes('effectiveHeight')) process.exit(1);
  if (!c.includes('detected_aspect')) process.exit(1);
  const hasRotation = c.includes('rotation') && (c.includes('90') || c.includes('270'));
  if (!hasRotation) process.exit(1);
  console.log('OK');
" || { echo "FAIL: Agent 未实现 detectedAspect + rotation swap + PATCH 写回"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 6: PATCH /api/ai-video-pipeline/:jobId/progress — 写回 detected_aspect，禁用字段不出现

**来源**: `[FROM_PRD]` — PRD Response Schema PATCH 段；禁用字段：`aspectRatio`/`aspect`/`ratio`/`orientation`

**可观测行为**: PATCH 携带 `detected_aspect` 写库成功；响应不含 4 个禁用字段

**验证命令**:
```bash
TEST_JOB_ID=$(psql "$DB" -t -c "
  INSERT INTO zenithjoy.ai_video_pipeline_jobs (src_video, topic, status, progress)
  VALUES ('C:\\test.mp4', 'test', 'processing', 20)
  RETURNING id
" | tr -d ' ')

RESP=$(curl -sf -X PATCH "localhost:3000/api/ai-video-pipeline/$TEST_JOB_ID/progress" \
  -H "Content-Type: application/json" \
  -d '{"progress":35,"status":"processing","detected_aspect":"9:16"}') \
  || { echo "FAIL: PATCH 请求失败"; exit 1; }

# DB 写回验证（带时间窗口防历史数据）
RESULT=$(psql "$DB" -t -c "SELECT detected_aspect FROM zenithjoy.ai_video_pipeline_jobs WHERE id='$TEST_JOB_ID' AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$RESULT" = "9:16" ] || { echo "FAIL: detected_aspect 写回失败 got=$RESULT"; exit 1; }

# 禁用字段反向检查（4 个）
echo "$RESP" | jq -e 'has("aspectRatio") | not' || { echo "FAIL: 禁用字段 aspectRatio"; exit 1; }
echo "$RESP" | jq -e 'has("aspect") | not' || { echo "FAIL: 禁用字段 aspect"; exit 1; }
echo "$RESP" | jq -e 'has("ratio") | not' || { echo "FAIL: 禁用字段 ratio"; exit 1; }
echo "$RESP" | jq -e 'has("orientation") | not' || { echo "FAIL: 禁用字段 orientation"; exit 1; }

psql "$DB" -c "DELETE FROM zenithjoy.ai_video_pipeline_jobs WHERE id='$TEST_JOB_ID'"
echo OK
```

**硬阈值**: DB 写回 "9:16"；4 个禁用字段均不出现

---

### Step 7: Agent effectiveTarget — 只生成对应单个文件

**来源**: `[FROM_PRD]` — PRD Golden Path WS2 第 4 步："Agent 按 effectiveTarget 只生成对应一个文件"；PRD 范围限定："不在范围内：多画幅批量生成"

**可观测行为**: Agent handler 含 `effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"` 逻辑，只生成单一输出文件

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');
  if (!c.includes('effectiveTarget')) process.exit(1);
  const hasCoalesce = c.includes('target_aspect') && c.includes('detectedAspect') && c.includes('effectiveTarget');
  if (!hasCoalesce) process.exit(1);
  console.log('OK');
" || { echo "FAIL: effectiveTarget 单文件逻辑未实现"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 8: E2E spec — original_script + W-G + 9:16 + detected_aspect API 验证覆盖

**来源**: `[FROM_PRD]` — PRD Golden Path WS3 第 2 步

**可观测行为**: `e2e/agent-video-pipeline.spec.js` 含 original_script 填写 + W-G 选择 + 9:16 选择 + detected_aspect 有值断言 + screenshot 调用

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');
  if (!c.includes('original_script')) process.exit(1);
  if (!c.includes('W-G') && !c.includes('WG') && !c.includes('W_G')) process.exit(1);
  if (!c.includes('detected_aspect')) process.exit(1);
  const hasAssert = c.includes('expect') || c.includes('toBe') || c.includes('!= null') || c.includes('!== null');
  if (!hasAssert) process.exit(1);
  if (!c.includes('screenshot')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: E2E spec 缺少新场景步骤"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 9: services/agent/package.json version = "1.1.29"

**来源**: `[FROM_PRD]` — PRD Golden Path WS3 第 1 步："services/agent package.json version 升至 1.1.29"；PRD 受影响文件列表含 `services/agent/package.json`

**可观测行为**: `services/agent/package.json` 顶层 `"version"` 字段值为 `"1.1.29"`

**验证命令**:
```bash
VERSION=$(node -e "const p=require('./services/agent/package.json');console.log(p.version)")
[ "$VERSION" = "1.1.29" ] || { echo "FAIL: version=$VERSION 期望 1.1.29"; exit 1; }
echo OK
```

**硬阈值**: version = "1.1.29"

---

### Step 10: GHA agent-e2e-video.yml — agent_version default 更新为 "1.1.29"

**来源**: `[AI_ADDED]` — GAN Round 1 加入，理由：GHA workflow default 仍为 1.1.17 会让 final-e2e 跑旧版 Agent，掩盖 WS1/WS2 新功能实现缺陷

**可观测行为**: `.github/workflows/agent-e2e-video.yml` 中 `agent_version` 的 `default` 值为 `"1.1.29"`，不含旧值 `"1.1.17"`

**验证命令**:
```bash
COUNT=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.29" | wc -l | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: GHA default version 未更新为 1.1.29"; exit 1; }
OLD=$(grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.17" | wc -l | tr -d ' ')
[ "$OLD" -eq 0 ] || { echo "FAIL: 旧版本 1.1.17 仍存在"; exit 1; }
echo OK
```

**硬阈值**: default=1.1.29，不含 1.1.17

---

### Step 11: agent-installpack.yml — 已配置按 services/agent/** push 自动触发

**来源**: `[FROM_PRD]` — PRD Golden Path WS3 第 3 步："触发 agent-installpack.yml（GHA build → COS 上传 → manifest 更新）"；PRD 受影响文件含 `.github/workflows/agent-installpack.yml`

**可观测行为**: `agent-installpack.yml` 的 `on.push.paths` 包含 `'services/agent/**'`，确保 version bump merge 后自动触发 build

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('.github/workflows/agent-installpack.yml','utf8');
  if (!c.includes('services/agent/**')) process.exit(1);
  if (!c.includes('push') && !c.includes('workflow_dispatch')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: agent-installpack.yml 未配置 services/agent/** 自动触发"; exit 1; }
```

**硬阈值**: exit 0

---

## Risks

| Risk | 影响 | Mitigation |
|---|---|---|
| **ffprobe 未安装** — Agent 宿主机未安装 ffprobe（仅有 ffmpeg）| ffprobe 调用失败 → detectedAspect=null → effectiveTarget 回落 "9:16" → 竖版视频按竖版处理不出错，横版视频误判 | Agent 启动时探测 `ffprobe -version`，失败时 log WARN 并回落 "9:16"；E2E spec 中验证 detectedAspect 有值（间接验证 ffprobe 工作） |
| **session_token 空传** — Final E2E `agent-e2e-video.yml` 的 `workflow_dispatch input` 未提供 session_token | Agent 无法认证 → createJob 401 → E2E 全程 FAIL | PRD 已标注 [ASSUMPTION: session_token 在 Final E2E 前通过 workflow_dispatch input 手动传入]；evaluator 在触发 GHA 前验证 secret/input 非空 |
| **PATCH 失败未定义 fallback** — Agent PATCH progress 失败（网络超时/API 500）时无重试逻辑 | detected_aspect 写回失败 → DB 无记录 → evaluator Step 6 FAIL | Agent PATCH 失败时 log ERROR + 继续后续步骤（不中断视频处理）；evaluator 容忍 PATCH 失败但要求至少 log 含 "detected_aspect"；DoD BEHAVIOR 直接向 DB 写入验证，不依赖 Agent 成功 |

---

## E2E 验收（Final E2E — target_environment: windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E 触发方式**: `workflow_dispatch` → `.github/workflows/agent-e2e-video.yml` → `windows-latest`

```powershell
# Final E2E — 触发 GHA agent-e2e-video.yml（手动 workflow_dispatch）

# 1. 确认 GHA workflow default version 正确
$yml = Get-Content ".github\workflows\agent-e2e-video.yml" -Raw
if ($yml -notmatch '1\.1\.29') { throw "FAIL: GHA workflow default version 未更新为 1.1.29" }
if ($yml -match '1\.1\.17') { throw "FAIL: 旧版本 1.1.17 仍存在" }

# 2. 确认 agent-installpack.yml 含 services/agent/** 触发路径
$pack = Get-Content ".github\workflows\agent-installpack.yml" -Raw
if ($pack -notmatch 'services/agent/\*\*') { throw "FAIL: agent-installpack.yml 未配置 services/agent/** 自动触发" }

# 3. 确认 services/agent/package.json version 为 1.1.29
$pkg = Get-Content "services\agent\package.json" -Raw | ConvertFrom-Json
if ($pkg.version -ne "1.1.29") { throw "FAIL: package.json version=$($pkg.version) 期望 1.1.29" }

# 4. 确认 E2E spec 含新步骤
$spec = Get-Content "e2e\agent-video-pipeline.spec.js" -Raw
if ($spec -notmatch "original_script") { throw "FAIL: E2E spec 缺 original_script 步骤" }
if ($spec -notmatch "detected_aspect") { throw "FAIL: E2E spec 缺 detected_aspect 验证" }
if ($spec -notmatch "screenshot") { throw "FAIL: E2E spec 缺截图步骤" }

Write-Host "✅ windows_cloud Final E2E 预检通过 — 由 evaluator 触发 GHA workflow"
```

**PASS 标准**: agent-e2e-video.yml GHA run 绿 + spec 含新步骤断言 + package.json version=1.1.29
**FAIL 标准**: GHA run 红 OR spec 缺新步骤 OR default version 未更新 OR agent-installpack.yml 触发路径缺失

---

## Workstreams

workstream_count: 3

---

### Workstream 1: original_script 字段完整链路（DB + API .job 嵌套 + AI prompt + 前端 textarea）

**范围**: DB migration 3 列；createJob API 读写 original_script + target_aspect + detected_aspect（响应嵌套在 .job 对象）；composeTemplate 注入前缀；前端 textarea
**大小**: S（< 100 行净增）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/original-script.test.ts`

---

### Workstream 2: 比例选择 + 画幅检测（Agent ffprobe + effectiveTarget + PATCH + 前端选择器）

**范围**: 前端比例选择器 + createJob 携带 target_aspect；Agent ffprobe width/height + rotation swap + detectedAspect + PATCH /api/ai-video-pipeline/:id/progress 写回；effectiveTarget 单文件
**大小**: M（~120 行净增，2 文件）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/aspect-detection.test.ts`

---

### Workstream 3: E2E spec 更新 + Agent version 1.1.29 + GHA 更新

**范围**: `e2e/agent-video-pipeline.spec.js` 补充新步骤；`services/agent/package.json` version=1.1.29；`.github/workflows/agent-e2e-video.yml` default 版本更新；`agent-installpack.yml` 自动触发路径确认
**大小**: S（~70 行，4 文件）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/e2e-spec-coverage.test.ts`

---

## Workstreams 切分验证

| WS | 预期净增 LoC | 文件数 | 符合 ≤200 行 ≤3 文件？ |
|---|---|---|---|
| WS1 | ~80 行 | 3 文件（migration SQL + controller + 前端）| ✅ |
| WS2 | ~120 行 | 2 文件（Agent handler + 前端）| ✅ |
| WS3 | ~70 行 | 4 文件（E2E spec + 2 GHA + package.json）| ✅（config 文件不计 LoC）|

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/original-script.test.ts` | createJob 返回 .job 嵌套；original_script 写入；composeTemplate 前缀；禁用字段不出现 | 若 createJob 响应未嵌套 .job → FAIL |
| WS2 | `tests/ws2/aspect-detection.test.ts` | detectedAspect rotation=90° → 9:16；effectiveTarget 单文件；PATCH 写库 | 若 ffprobe 逻辑未加 → FAIL |
| WS3 | `tests/ws3/e2e-spec-coverage.test.ts` | E2E spec 含新关键词；GHA version=1.1.29；agent-installpack 触发路径 | 若 E2E spec 未更新 → FAIL |
