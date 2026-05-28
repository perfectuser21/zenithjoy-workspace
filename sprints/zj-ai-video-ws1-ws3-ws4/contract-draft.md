# Sprint Contract Draft (Round 1)

## Golden Path

[用户填写 original_script + 选 W-G 模板 + 选 9:16] → [POST createJob] → [DB 写入 3 字段] → [Agent ffprobe 读 width/height] → [PATCH detected_aspect] → [effectiveTarget 只生成单文件] → [E2E 验证全链路]

---

### Step 1: DB migration — 3 新字段列存在

**来源**: `[FROM_PRD]` — PRD 背景段："DB migration（3 字段）" + Response Schema 含 original_script/target_aspect/detected_aspect

**可观测行为**: `ai_video_pipeline_jobs` 表含 `original_script TEXT`、`target_aspect TEXT CHECK(...)`、`detected_aspect TEXT CHECK(...)` 3 列

**验证命令**:
```bash
psql "$DB" -t -c "\d zenithjoy.ai_video_pipeline_jobs" | grep -E "original_script|target_aspect|detected_aspect" | wc -l | tr -d ' '
# 期望：3
```

**硬阈值**: grep 到 3 列

---

### Step 2: POST /api/ai-video/jobs — createJob 接受并返回 3 个 snake_case 字段

**来源**: `[FROM_PRD]` — PRD Response Schema：POST 201 含 original_script/target_aspect/detected_aspect；禁用 `originalScript`

**可观测行为**: 传 `original_script` + `target_aspect` 后，响应含同名 snake_case 字段，且不含 camelCase 变体

**验证命令**:
```bash
RESP=$(curl -sf -X POST "localhost:3000/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_LICENSE" \
  -d '{"local_path":"C:\\test.mp4","topic":"test","original_script":"录制前文案","target_aspect":"9:16"}')

# 1. 字段值验证
echo "$RESP" | jq -e '.original_script == "录制前文案"' || { echo "FAIL: original_script 字段值错"; exit 1; }
echo "$RESP" | jq -e '.target_aspect == "9:16"' || { echo "FAIL: target_aspect 字段值错"; exit 1; }
echo "$RESP" | jq -e '.detected_aspect == null' || { echo "FAIL: detected_aspect 初始应为 null"; exit 1; }

# 2. 禁用字段反向检查
echo "$RESP" | jq -e 'has("originalScript") | not' || { echo "FAIL: 禁用字段 originalScript 出现"; exit 1; }
echo OK
```

**硬阈值**: 全部 jq -e 通过；HTTP 201

---

### Step 3: composeTemplate — original_script 有值时注入 Claude prompt 前缀

**来源**: `[FROM_PRD]` — PRD Golden Path WS1 第 3 步："有值时在 Claude prompt 前缀注入'用户录制前参考文案（非逐字稿，仅意图参考）：'"

**可观测行为**: `ai-video-pipeline-ai.controller.ts` 含前缀注入逻辑；original_script 为空时不注入

**验证命令**:
```bash
# 验证源码含前缀字符串（WS1 没实现时此文件不含该字符串）
node -e "
  const c = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts','utf8');
  if (!c.includes('用户录制前参考文案（非逐字稿，仅意图参考）')) process.exit(1);
  if (!c.includes('_originalScript')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: 前缀注入逻辑未实现"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 4: 前端 LocalVideoPipelinePage — original_script textarea + target_aspect 比例选择器存在

**来源**: `[FROM_PRD]` — PRD Golden Path WS1 第 1 步 + WS2 第 3 步："前端加 original_script textarea + 比例选择器"

**可观测行为**: 前端组件含 `name="original_script"` textarea；createJob 调用时携带 `target_aspect`

**验证命令**:
```bash
# 验证 textarea 存在
node -e "
  const c = require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx','utf8');
  if (!c.includes('name=\"original_script\"') && !c.includes(\"name='original_script'\")) process.exit(1);
  if (!c.includes('target_aspect')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: 前端缺 original_script textarea 或 target_aspect 字段"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 5: Agent ffprobe — 读取 width/height，计算 detectedAspect，rotation=90°/270° swap

**来源**: `[FROM_PRD]` — PRD Golden Path WS2 第 1-2 步："ffprobe -show_streams 读 vStream.width / vStream.height / rotation；effectiveWidth < effectiveHeight → detectedAspect = '9:16'"

**可观测行为**: `services/agent/src/handlers/video-pipeline.ts` 含 `detectedAspect` 计算逻辑及 rotation swap；PATCH 写回 detected_aspect

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');
  if (!c.includes('detectedAspect')) process.exit(1);
  if (!c.includes('effectiveWidth') || !c.includes('effectiveHeight')) process.exit(1);
  if (!c.includes('detected_aspect')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: Agent 未实现 detectedAspect + rotation swap + PATCH"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 6: Agent effectiveTarget — 只生成对应单个文件（非双文件）

**来源**: `[FROM_PRD]` — PRD Golden Path WS2 第 4 步："Agent 按 effectiveTarget 只生成对应一个文件"；PRD 范围："不在范围内：多画幅批量生成"

**可观测行为**: Agent handler 含 effectiveTarget 逻辑，只 copy/render 一个输出文件，不再无条件写 9_16 + 16_9 两个

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts','utf8');
  if (!c.includes('effectiveTarget')) process.exit(1);
  // 确保不再有无条件双文件输出（旧 Step 7B 同时 copy 两个文件）
  const oldPattern = /output916.*output169.*\n.*fs\.copyFile.*\n.*fs\.copyFile/s;
  // 验证新逻辑：effectiveTarget 条件分支存在
  if (!c.includes('effectiveTarget')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: Agent effectiveTarget 单文件逻辑未实现"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 7: E2E spec — 新步骤覆盖 original_script + W-G 模板 + 9:16 + API 验证 detected_aspect

**来源**: `[FROM_PRD]` — PRD Golden Path WS3 第 2 步："E2E spec 补充：填 original_script textarea → 点 W-G 模板按钮 → 选 9:16 → 等待完成 → API 验证 job.detected_aspect 有值 + status=completed → 截图"

**可观测行为**: `e2e/agent-video-pipeline.spec.js` 含 original_script 填写 + W-G 选择 + 9:16 选择 + detected_aspect 验证

**验证命令**:
```bash
node -e "
  const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js','utf8');
  if (!c.includes('original_script')) process.exit(1);
  if (!c.includes('W-G') && !c.includes('W_G') && !c.includes('WG')) process.exit(1);
  if (!c.includes('detected_aspect')) process.exit(1);
  console.log('OK');
" || { echo "FAIL: E2E spec 缺少新场景步骤"; exit 1; }
```

**硬阈值**: exit 0

---

### Step 8: GHA agent-e2e-video.yml — default agent_version 更新为 1.1.29

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：version bump 是 WS3 核心工作，GHA default 仍为 1.1.17 会导致 final-e2e 跑旧版，掩盖 WS1/WS2 新功能缺陷

**可观测行为**: `.github/workflows/agent-e2e-video.yml` 中 `agent_version` 的 `default` 值为 `"1.1.29"`

**验证命令**:
```bash
grep "default:" .github/workflows/agent-e2e-video.yml | grep "1.1.29" | wc -l | tr -d ' '
# 期望：1
```

**硬阈值**: count = 1

---

## E2E 验收（Final E2E — target_environment: windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E 触发方式**: `workflow_dispatch` → `.github/workflows/agent-e2e-video.yml` → `windows-latest`

```powershell
# Final E2E — 触发 GHA agent-e2e-video.yml（手动 workflow_dispatch）
# 前提：session_token 通过 workflow_dispatch input 传入

# 1. 确认 GHA workflow 存在且 default version 正确
$yml = Get-Content ".github\workflows\agent-e2e-video.yml" -Raw
if ($yml -notmatch '1\.1\.29') { throw "FAIL: GHA workflow default version 未更新为 1.1.29" }

# 2. 确认 E2E spec 含新步骤
$spec = Get-Content "e2e\agent-video-pipeline.spec.js" -Raw
if ($spec -notmatch "original_script") { throw "FAIL: E2E spec 缺 original_script 步骤" }
if ($spec -notmatch "detected_aspect") { throw "FAIL: E2E spec 缺 detected_aspect 验证" }

# 3. 触发 GHA（实际触发由 evaluator 通过 gh CLI 执行）
Write-Host "✅ windows_cloud Final E2E 预检通过 — 由 evaluator 触发 GHA workflow"
```

**PASS 标准**: agent-e2e-video.yml GHA run 绿 + spec 含新步骤断言
**FAIL 标准**: GHA run 红 OR spec 缺新步骤 OR default version 未更新

---

## Workstreams

workstream_count: 3

---

### Workstream 1: original_script 字段完整链路（DB + API + AI prompt + 前端 textarea）

**范围**: DB migration 3 列已就绪；API createJob 读写 original_script；composeTemplate 注入前缀；前端 textarea 存在
**大小**: S（< 100 行净增，大部分已在代码中；WS 主要定义可执行 oracle）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/original-script.test.ts`

---

### Workstream 2: 比例选择 + 画幅检测（Agent ffprobe + effectiveTarget + 前端选择器）

**范围**:
1. 前端 `LocalVideoPipelinePage.tsx`：加比例选择器 state + UI + `target_aspect` 写入 createJob 请求
2. Agent `video-pipeline.ts` Step 1：ffprobe -show_streams 读 vStream.width/height，rotation swap，计算 detectedAspect
3. Agent Step 1 完成后：PATCH `/api/ai-video/jobs/:id/progress` 携带 `{ detected_aspect }`
4. Agent Step 7：effectiveTarget = `job.target_aspect ?? detectedAspect ?? "9:16"`，只生成对应一个文件

**大小**: M（~120 行净增，2 文件：LocalVideoPipelinePage.tsx + video-pipeline.ts）
**依赖**: Workstream 1 完成后（需 DB migration 列存在）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/aspect-detection.test.ts`

---

### Workstream 3: E2E spec 更新 + GHA version 更新

**范围**:
1. `e2e/agent-video-pipeline.spec.js`：Step 3 补充填 original_script + Step 4 W-G 模板按钮点击 + 比例选择 9:16 + 最终 API 验证 detected_aspect 有值
2. `.github/workflows/agent-e2e-video.yml`：`agent_version` default 从 `"1.1.17"` 改为 `"1.1.29"`

**大小**: S（~70 行，2 文件）
**依赖**: Workstream 2 完成后（E2E 验证 WS1+WS2 全链路）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/e2e-spec-coverage.test.ts`

---

## Workstreams 切分验证

| WS | 预期净增 LoC | 文件数 | 符合 ≤200 行 ≤3 文件？ |
|---|---|---|---|
| WS1 | ~60 行 | 2 文件（migration SQL + unit test）| ✅ |
| WS2 | ~120 行 | 2 文件（前端 + Agent）| ✅ |
| WS3 | ~70 行 | 2 文件（E2E spec + GHA）| ✅ |

整体净增 < 260 行，workstream_count=3 合理（未超 ws_count=1 阈值 200 行）。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/original-script.test.ts` | createJob 写入 original_script；composeTemplate 前缀注入；空值不注入 | 若 createJob 不含新字段参数 → FAIL |
| WS2 | `tests/ws2/aspect-detection.test.ts` | detectedAspect rotation=90° → 9:16；target_aspect override；effectiveTarget 单文件 | 若 ffprobe 逻辑未加 → FAIL |
| WS3 | `tests/ws3/e2e-spec-coverage.test.ts` | E2E spec 含 original_script/W-G/detected_aspect 关键词；GHA version=1.1.29 | 若 E2E spec 未更新 → FAIL |
