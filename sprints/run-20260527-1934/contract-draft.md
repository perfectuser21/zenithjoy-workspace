# Sprint Contract Draft (Round 1)

## Golden Path

[用户在 LocalVideoPipelinePage 填写原始文案] → [选模板 W-G + 比例 9:16] → [POST 创建 job (original_script + target_aspect 写库)] → [Agent ffprobe 读 width/height 计算 detectedAspect 写回] → [compose-template 调用 _buildWGHtml 生成 1080×1920 竖版 HTML] → [Claude prompt 含原始文案前缀] → [非模板路径只生成 9_16.mp4 单文件] → [GHA Windows E2E Playwright green + 截图验收]

---

### Step 1: 用户填写原始文案 + 选模板 W-G + 选比例 9:16

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 1/2 行明确：用户在 textarea 填写"ZenithJoy E2E 原始文案测试"，点击模板 W-G 按钮，点击比例 9:16 按钮

**可观测行为**: Dashboard LocalVideoPipelinePage 出现 original_script textarea + 模板 W-G 选择按钮 + 9:16 比例选择按钮，三个 UI 元素均可交互

**验证命令**:
```bash
# 验证前端源文件包含 original_script textarea 和 9:16 比例选择器
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx', 'utf8');
if (!c.includes('original_script')) { console.error('FAIL: 缺 original_script textarea'); process.exit(1); }
if (!c.includes('9:16') || !c.includes('target_aspect')) { console.error('FAIL: 缺比例选择器'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 文件包含 `original_script` + `target_aspect` + `9:16` 三处关键词，exit 0

---

### Step 2: POST /api/ai-video-pipeline/ 创建 job，original_script + target_aspect 写入 DB，HTTP 201

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 3 行 + Response Schema 定义：POST body 含 original_script + target_aspect，201 返回含 id / original_script / target_aspect / status

**可观测行为**: POST 请求携带 original_script + target_aspect，返回 HTTP 201 JSON，响应体四字段均存在且与请求值一致

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/e2e-test.mp4","original_script":"ZenithJoy E2E 原始文案测试","target_aspect":"9:16"}') || { echo "FAIL: POST 返回非 2xx"; exit 1; }

echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 字段缺失或非 string"; exit 1; }
echo "$RESP" | jq -e '.status == "pending"' || { echo "FAIL: status 不是 pending"; exit 1; }
echo "$RESP" | jq -e '.original_script == "ZenithJoy E2E 原始文案测试"' || { echo "FAIL: original_script 未写入或返回值不匹配"; exit 1; }
echo "$RESP" | jq -e '.target_aspect == "9:16"' || { echo "FAIL: target_aspect 未写入或返回值不匹配"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e 'has("script") | not' || { echo "FAIL: 禁用字段 script 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("raw_script") | not' || { echo "FAIL: 禁用字段 raw_script 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("source_script") | not' || { echo "FAIL: 禁用字段 source_script 漏网"; exit 1; }

JOB_ID=$(echo "$RESP" | jq -r '.id')
echo "✅ Step 2 通过 job_id=$JOB_ID"
```

**硬阈值**: HTTP 201 + original_script 字段值精确匹配 + target_aspect 精确匹配 + 禁用字段不存在

---

### Step 3: Agent ffprobe 读 width/height（含 rotation swap），写回 detected_aspect

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 4 行：Agent ffprobe 读 width/height（含 rotation swap），计算 detectedAspect，PATCH 写回 detected_aspect

**可观测行为**: video-pipeline.ts 存在 detectAspect 函数，1920×1080 + rotation=90° 返回 "9:16"；GET /api/ai-video-pipeline/{id} 返回 detected_aspect 字段

**验证命令**:
```bash
# 验证 detectAspect 函数存在且含 rotation swap 逻辑
node -e "
const src = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts', 'utf8');
if (!src.includes('detectAspect')) { console.error('FAIL: detectAspect 函数未定义'); process.exit(1); }
if (!src.includes('width') || !src.includes('height')) { console.error('FAIL: 缺 width/height 读取'); process.exit(1); }
console.log('OK: detectAspect + width/height 存在');
"

# 验证 GET 响应包含 detected_aspect 字段（DB 列已建，字段已透传）
JOB_ID=${JOB_ID:-$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/t.mp4"}' | jq -r '.id')}
GET_RESP=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }
# detected_aspect 初始为 null 是允许的，但字段必须在响应 JSON 中存在
echo "$GET_RESP" | jq -e 'has("detected_aspect")' || { echo "FAIL: GET 响应缺 detected_aspect 字段"; exit 1; }
echo "✅ Step 3 通过"
```

**硬阈值**: detectAspect 函数存在 + GET 响应含 detected_aspect 字段（值 null OK，字段缺失 FAIL）

---

### Step 4: compose-template 调用 _buildWGHtml()，返回 1080×1920 竖版 HTML，aspect="9:16"

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 5 行 + Response Schema：compose-template 返回 {html, aspect}，aspect="9:16"，W-G 模板 1080×1920

**可观测行为**: POST /{id}/compose-template → 200 JSON 含 html（字符串）+ aspect="9:16"；HTML 内含 W-G 色板（#ede4d2 底色）和 1080px×1920px 尺寸

**验证命令**:
```bash
# 需要有 template_id=W-G 的 job
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/t.mp4","template_id":"W-G"}' | jq -r '.id')

COMPOSE_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"transcript":"test","segments":[],"duration":10}') || { echo "FAIL: compose-template 非 2xx"; exit 1; }

echo "$COMPOSE_RESP" | jq -e '.aspect == "9:16"' || { echo "FAIL: aspect 不是 9:16"; exit 1; }
echo "$COMPOSE_RESP" | jq -e '.html | type == "string"' || { echo "FAIL: html 非 string"; exit 1; }
echo "$COMPOSE_RESP" | jq -e 'has("ratio") | not' || { echo "FAIL: 禁用字段 ratio 漏网"; exit 1; }
echo "$COMPOSE_RESP" | jq -e 'has("aspectRatio") | not' || { echo "FAIL: 禁用字段 aspectRatio 漏网"; exit 1; }

# 验证 W-G 色板在 HTML 中
echo "$COMPOSE_RESP" | jq -r '.html' | grep -q "ede4d2" || { echo "FAIL: W-G 底色 #ede4d2 不在 HTML"; exit 1; }
echo "✅ Step 4 通过"
```

**硬阈值**: aspect="9:16" + html 含 ede4d2 + 禁用字段缺失 FAIL

---

### Step 5: Claude prompt 前缀含原始文案注入

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 6 行：Claude prompt 前缀含"用户录制前参考文案（非逐字稿，仅意图参考）：…"

**可观测行为**: ai-video-pipeline-ai.controller.ts 中 Claude prompt 构建逻辑含 original_script 注入代码，当 original_script 非 null 时注入，null 时跳过

**验证命令**:
```bash
node -e "
const src = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts', 'utf8');
if (!src.includes('original_script')) { console.error('FAIL: controller 未读取 original_script'); process.exit(1); }
if (!src.includes('用户录制前参考文案') && !src.includes('original script') && !src.includes('参考文案')) {
  console.error('FAIL: Claude prompt 缺原始文案注入文字'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: 源文件含 original_script 读取 + 中文注入前缀文字，exit 0

---

### Step 6: 非模板路径只生成 9_16.mp4 单文件（删除双文件强制逻辑）

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 7 行：effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"，只生成一个文件

**可观测行为**: video-pipeline.ts 不再强制同时生成 9_16.mp4 + 16_9.mp4；改为按 effectiveTarget 单文件输出

**验证命令**:
```bash
node -e "
const src = require('fs').readFileSync('services/agent/src/handlers/video-pipeline.ts', 'utf8');
// 验证 effectiveTarget 逻辑存在
if (!src.includes('effectiveTarget') && !src.includes('effective_target')) {
  console.error('FAIL: effectiveTarget 变量未定义'); process.exit(1);
}
// 验证双文件强制写法已被删除
// 原写法: output916 = path.join(outputDir, '9_16.mp4'); output169 = path.join(outputDir, '16_9.mp4');
// 正确: 按 effectiveTarget 决定单文件
if (src.includes('output916') && src.includes('output169')) {
  // 两个变量都存在可能还残留旧逻辑，检查是否还有强制双写
  const doubleWrite = src.match(/copyFileSync.*9_16.*\n.*copyFileSync.*16_9|copyFileSync.*16_9.*\n.*copyFileSync.*9_16/);
  if (doubleWrite) { console.error('FAIL: 强制双文件写法未删除'); process.exit(1); }
}
console.log('OK: 单文件输出逻辑存在');
"
```

**硬阈值**: `effectiveTarget` 变量存在 + 强制双文件同时复制逻辑已删除

---

### Step 7: GHA Windows E2E Playwright green，截图证明模板选中 + 比例选中 + 完成状态

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 8 行：GHA Windows E2E artifact 上传截图，run green = 验收通过

**可观测行为**: e2e/agent-video-pipeline.spec.js 更新含 original_script + W-G + 9:16 三处关键断言；GHA workflow 更新 agent_version 默认值为 1.1.29；Agent package.json version = 1.1.29

**验证命令**:
```bash
# Agent 版本
node -e "const p=JSON.parse(require('fs').readFileSync('services/agent/package.json','utf8'));if(p.version!=='1.1.29'){process.exit(1)}console.log('OK version='+p.version)"

# E2E spec 含三处关键词
node -e "
const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js', 'utf8');
['original_script','W-G','9:16'].forEach(k => {
  if (!c.includes(k)) { console.error('FAIL: E2E spec 缺关键词', k); process.exit(1); }
});
console.log('OK');
"
```

**硬阈值**: version=1.1.29 + E2E spec 三关键词均存在

---

### Step 8: original_script=null 时 Claude prompt 不含原始文案注入（边界防造假）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 边界情况明确 "original_script = null → Claude prompt 不注入原始文案片段"；若实现是无条件注入，null 时会插入 "undefined" 字符串，E2E 截图可能暴露，但不加此验证 generator 可能跳过空值判断

**可观测行为**: controller 中 original_script 注入代码包含空值条件判断（`if (original_script)` 或 `?? ''` 类型保护）

**验证命令**:
```bash
node -e "
const src = require('fs').readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts', 'utf8');
// 检查 original_script 注入有空值保护（if/ternary/??）
const hasGuard = src.match(/if\s*\(.*original_script|original_script\s*\?\?|original_script\s*&&|original_script\s*\?/);
if (!hasGuard) { console.error('FAIL: original_script 注入缺空值保护，null 时可能注入 undefined 字符串'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: controller 含 original_script 条件注入模式，exit 0

---

## E2E 验收（final-e2e — windows_cloud GHA）

**journey_type**: user_facing
**target_environment**: windows_cloud

### windows_cloud 变体 B：Playwright E2E（ZenithJoy agent-e2e-video.yml）

E2E 验收由更新后的 `e2e/agent-video-pipeline.spec.js` + `.github/workflows/agent-e2e-video.yml` 执行。

WS4 更新的 E2E spec 必须包含以下断言：

```javascript
// e2e/agent-video-pipeline.spec.js 更新段（WS4 实现）

// Step 1: 填写 original_script
await page.fill('[data-testid="original-script-textarea"], textarea[placeholder*="文案"], textarea', 'ZenithJoy E2E 原始文案测试');
await page.screenshot({ path: 'screenshots/02a-original-script-filled.png', fullPage: true });

// Step 2: 选择模板 W-G
await page.click('button:has-text("W-G"), [data-testid="template-wg"]');
await page.screenshot({ path: 'screenshots/02b-template-wg-selected.png', fullPage: true });

// Step 3: 选择比例 9:16
await page.click('button:has-text("9:16"), [data-testid="aspect-916"]');
await page.screenshot({ path: 'screenshots/02c-aspect-916-selected.png', fullPage: true });

// ... 等待 job 完成后
// Step N: 验证 job 含 original_script 字段
const jobResp = await page.request.get(`${BASE}/api/ai-video-pipeline/${jobId}`, {
  headers: { Authorization: `Bearer ${E2E_LICENSE}` }
});
const jobData = await jobResp.json();
expect(jobData.original_script).toBe('ZenithJoy E2E 原始文案测试');
expect(jobData.target_aspect).toBe('9:16');
```

**PASS 标准**: GHA windows-latest run green + artifact 含截图
**FAIL 标准**: run 红 OR 截图缺失 OR jobData.original_script 不匹配

---

## Workstreams

**workstream_count**: 4

### Workstream 1: DB migration(original_script) + createJob API + 前端 textarea + Claude prompt 注入

**范围**: ADD COLUMN original_script 到 ai_video_pipeline_jobs；createJob 接受 originalScript 参数写 DB；controller 读 original_script/target_aspect from request body 并返回；LocalVideoPipelinePage 加 original_script textarea；composeHtml/analyzeTranscript prompt 前缀注入（含空值保护）
**大小**: M（跨 5 个文件，每个小改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/original-script-fields.test.ts`

---

### Workstream 2: _buildWGHtml / _buildCHtml / _buildRHtml + switch 分发

**范围**: 在 ai-video-pipeline-ai.controller.ts 新增 `_buildWGHtml(scenes, gsapJs, duration)` / `_buildCHtml` / `_buildRHtml` 三个专属函数（各自硬编码正确尺寸+色板+布局结构）；`_buildDynamicTemplateHtml` 改为 switch/if-else 分发调用对应函数
**大小**: M（~200 行净增）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/template-html-builders.test.ts`

---

### Workstream 3: ffprobe width/height + detectedAspect + target_aspect 列 + 单文件输出 + 前端比例选择器

**范围**: migration ADD COLUMN target_aspect + detected_aspect；ffprobe step1 新增 width/height 读取 + detectAspect 计算函数（rotation swap）；PATCH 写 detected_aspect 回 DB；非模板路径改为 effectiveTarget 单文件；前端 LocalVideoPipelinePage 加比例选择器（9:16 / 16:9 按钮）
**大小**: M（跨 agent worker + migration + frontend）
**依赖**: Workstream 2 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws3/ffprobe-aspect-detection.test.ts`

---

### Workstream 4: Agent v1.1.29 version bump + E2E spec 更新 + GHA workflow 更新

**范围**: services/agent/package.json version → 1.1.29；e2e/agent-video-pipeline.spec.js 加 original_script + W-G + 9:16 三处填写/点击/断言逻辑；.github/workflows/agent-e2e-video.yml agent_version 默认值 → 1.1.29
**大小**: S
**依赖**: Workstream 3 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws4/agent-version-e2e-spec.test.ts`

---

## Workstreams 切分自查

| WS | 预估净增 LoC | 文件数 | 是否 ≤ 200 行 ≤ 3 文件 |
|---|---|---|---|
| WS1 | ~110 行 (migration 10 + service 20 + controller 30 + frontend 30 + AI controller 20) | 5 文件 | 行 ✅，文件 ❌ (5>3) |
| WS2 | ~190 行 | 1 文件 | ✅ |
| WS3 | ~150 行 | 4 文件 | 行 ✅，文件 ❌ (4>3) |
| WS4 | ~50 行 | 3 文件 | ✅ |

> **WS1/WS3 文件数超 3 说明**：均为向现有文件各自添加少量行（≤30 行/文件），无整文件新建。按 v7.7 规则"单 ws ≤ 200 行净增"判断，实质复杂度在 S/M 范围，维持 4 WS 切分。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/original-script-fields.test.ts` | original_script 写入/返回/prompt注入/migration存在 | 4 failures（字段不存在） |
| WS2 | `tests/ws2/template-html-builders.test.ts` | _buildWGHtml/C/R 函数存在 + 色板 + aspect | 4 failures（函数不存在） |
| WS3 | `tests/ws3/ffprobe-aspect-detection.test.ts` | detectAspect 计算 + detected_aspect 列 + 比例选择器 | 4 failures（函数/列不存在） |
| WS4 | `tests/ws4/agent-version-e2e-spec.test.ts` | version=1.1.29 + E2E spec 三关键词 | 5 failures（版本不匹配，关键词缺失） |
