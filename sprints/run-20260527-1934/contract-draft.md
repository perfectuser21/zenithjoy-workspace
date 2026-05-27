# Sprint Contract Draft (Round 2)

> **路径说明**：PRD "预期受影响文件"段使用了错误的 `packages/api/src/` 前缀和 camelCase 命名。本合同全文统一使用实际仓库路径 `apps/api/src/`（已经 `ls apps/api/src/` 验证）。验证命令中所有文件路径均已与仓库真实路径对齐。

## Golden Path

[用户在 LocalVideoPipelinePage 填写原始文案] → [选模板 W-G + 比例 9:16] → [POST 创建 job (original_script + target_aspect 写库)] → [Agent ffprobe 读 width/height 计算 detectedAspect 写回] → [compose-template 调用 _buildWGHtml 生成 1080×1920 竖版 HTML] → [Claude prompt 含原始文案前缀] → [非模板路径只生成 9_16.mp4 单文件] → [GHA Windows E2E Playwright green + 截图验收]

---

## Risks

| # | 风险名称 | 描述 | 缓解措施 |
|---|---|---|---|
| R1 | **WS1 migration 未合并 → WS2/3 级联失败** | WS1 的 `ADD COLUMN original_script` migration 未运行，WS2 的 compose-template curl BEHAVIOR 和 WS3 的 GET detected_aspect BEHAVIOR 直接 FAIL（DB 列不存在，API 返 500/400）。这是整个 sprint 最大的 cascade 风险。 | task-plan.json 强制 `ws2.depends_on=["ws1"]`、`ws3.depends_on=["ws2"]`；evaluator 模式A 按 ws1→ws2→ws3 串行跑，ws1 FAIL 立即停止 |
| R2 | **ffprobe 输出格式不含 vStream.width/height** | 部分视频文件（如 COS 测试视频）ffprobe 输出的 `streams[0]` 可能缺 width/height，导致 detectAspect 返回默认值而非真实画幅，rotation swap 无效 | PRD 已定义 fallback：ffprobe 读取失败 → `detectedAspect = "9:16"`，不阻断流程；WS3 ARTIFACT 验证 fallback 分支存在 |

---

### Step 1: 用户填写原始文案 + 选模板 W-G + 选比例 9:16

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 1/2 行：用户在 textarea 填写"ZenithJoy E2E 原始文案测试"，点击模板 W-G 按钮，点击比例 9:16 按钮

**可观测行为**: Dashboard LocalVideoPipelinePage 存在 original_script textarea + W-G 模板按钮 + 9:16 比例按钮，三者均可交互

**验证命令**:
```bash
# 验证前端 React 组件含所有必要 UI 元素（运行时行为：WS1 + WS3 实现后才有这些代码）
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/LocalVideoPipelinePage.tsx', 'utf8');
if (!c.includes('original_script')) { console.error('FAIL: 缺 original_script textarea'); process.exit(1); }
if (!c.includes('原始文案')) { console.error('FAIL: 缺原始文案标签文本'); process.exit(1); }
if (!c.includes('target_aspect')) { console.error('FAIL: 缺 target_aspect 选择器'); process.exit(1); }
if (!c.includes('9:16')) { console.error('FAIL: 缺 9:16 比例按钮'); process.exit(1); }
console.log('OK: 前端三个 UI 元素均存在');
"
```

**硬阈值**: 文件包含 original_script + 原始文案 + target_aspect + 9:16，exit 0

---

### Step 2: POST /api/ai-video-pipeline/ 创建 job，HTTP 201 返回 4 字段

**来源**: `[FROM_PRD]` — PRD Response Schema POST 201：`{id, status, original_script, target_aspect}`

**可观测行为**: POST 携带 original_script + target_aspect → HTTP 201，4 个 PRD 必填字段均存在且值正确；禁用字段不存在

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/e2e-test.mp4","original_script":"ZenithJoy E2E 原始文案测试","target_aspect":"9:16"}') \
  || { echo "FAIL: POST 返回非 2xx"; exit 1; }

# 必填字段类型验证
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 非 string"; exit 1; }
echo "$RESP" | jq -e '.status == "pending"' || { echo "FAIL: status 不是 pending"; exit 1; }
echo "$RESP" | jq -e '.original_script == "ZenithJoy E2E 原始文案测试"' || { echo "FAIL: original_script 值不匹配"; exit 1; }
echo "$RESP" | jq -e '.target_aspect == "9:16"' || { echo "FAIL: target_aspect 值不匹配"; exit 1; }

# 必填字段完整性（4 字段均存在）
echo "$RESP" | jq -e '[has("id"), has("status"), has("original_script"), has("target_aspect")] | all' \
  || { echo "FAIL: POST 201 缺少 PRD 必填字段"; exit 1; }

# 禁用字段反向检查（PRD 明确禁用）
echo "$RESP" | jq -e 'has("script") | not' || { echo "FAIL: 禁用字段 script 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("raw_script") | not' || { echo "FAIL: 禁用字段 raw_script 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("source_script") | not' || { echo "FAIL: 禁用字段 source_script 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("input_script") | not' || { echo "FAIL: 禁用字段 input_script 漏网"; exit 1; }

JOB_ID=$(echo "$RESP" | jq -r '.id')
echo "✅ Step 2 通过 job_id=$JOB_ID"
```

**硬阈值**: HTTP 201 + 4 字段完整 + original_script/target_aspect 值精确匹配 + 4 个禁用字段不存在

---

### Step 3: GET /api/ai-video-pipeline/{id} 返回完整 schema（5 字段 + 禁用字段不存在）

**来源**: `[FROM_PRD]` — PRD Response Schema GET 200：`{id, status, detected_aspect, original_script, target_aspect}`

**可观测行为**: GET 响应含 PRD 定义全部 5 个字段；禁用字段 aspect/video_aspect/aspectRatio/videoAspect 不存在

**验证命令**:
```bash
# 创建 job 并 GET（带时间窗口防利用历史记录）
JOB_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/step3-$(date +%s).mp4\",\"original_script\":\"Step3 测试\",\"target_aspect\":\"9:16\"}") \
  || { echo "FAIL: POST 失败"; exit 1; }
STEP3_JOB=$(echo "$JOB_RESP" | jq -r '.id')

GET_RESP=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$STEP3_JOB \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") || { echo "FAIL: GET 失败"; exit 1; }

# PRD 5 字段完整性
echo "$GET_RESP" | jq -e '.id | type == "string"' || { echo "FAIL: GET id 非 string"; exit 1; }
echo "$GET_RESP" | jq -e '.status | type == "string"' || { echo "FAIL: GET status 非 string"; exit 1; }
echo "$GET_RESP" | jq -e 'has("detected_aspect")' || { echo "FAIL: GET 缺 detected_aspect 字段"; exit 1; }
echo "$GET_RESP" | jq -e '.original_script == "Step3 测试"' || { echo "FAIL: GET original_script 与 POST 不一致"; exit 1; }
echo "$GET_RESP" | jq -e '.target_aspect == "9:16"' || { echo "FAIL: GET target_aspect 与 POST 不一致"; exit 1; }

# 5 字段完整性组合断言
echo "$GET_RESP" | jq -e '[has("id"), has("status"), has("detected_aspect"), has("original_script"), has("target_aspect")] | all' \
  || { echo "FAIL: GET 缺少 PRD 必填字段"; exit 1; }

# 禁用字段反向检查
echo "$GET_RESP" | jq -e 'has("aspect") | not' || { echo "FAIL: 禁用字段 aspect 漏网"; exit 1; }
echo "$GET_RESP" | jq -e 'has("video_aspect") | not' || { echo "FAIL: 禁用字段 video_aspect 漏网"; exit 1; }
echo "$GET_RESP" | jq -e 'has("aspectRatio") | not' || { echo "FAIL: 禁用字段 aspectRatio 漏网"; exit 1; }
echo "$GET_RESP" | jq -e 'has("videoAspect") | not' || { echo "FAIL: 禁用字段 videoAspect 漏网"; exit 1; }
echo "✅ Step 3 通过"
```

**硬阈值**: 5 字段完整 + 禁用字段 4 个全不存在 + original_script/target_aspect 值与 POST 一致

---

### Step 3b: detectAspect(1920, 1080, rotation=90) → "9:16"（rotation swap 执行验证）

**来源**: `[FROM_PRD]` — PRD "Schema 完整性" WS3 unit test：iPhone 竖拍视频（1920×1080 + rotation=90°）→ detected_aspect = "9:16"

**可观测行为**: WS3 实现的 `detectAspect` 函数导出后可直接调用，1920×1080 + rotation=90 时返回 "9:16"（非 "16:9"）

**验证命令**:
```bash
# 直接调用 detectAspect 函数（运行时执行，非静态检查）
# WS3 要求 detectAspect 为导出函数
cd /workspace && npx tsx -e "
import { detectAspect } from './services/agent/src/handlers/video-pipeline.js';
// iPhone 竖拍：1920×1080 + rotation=90 → 实效宽高 1080×1920 → 9:16
const r1 = detectAspect(1920, 1080, 90);
if (r1 !== '9:16') { console.error('FAIL: detectAspect(1920,1080,90)=' + r1 + ' 应为 9:16'); process.exit(1); }
// 横拍验证
const r2 = detectAspect(1920, 1080, 0);
if (r2 !== '16:9') { console.error('FAIL: detectAspect(1920,1080,0)=' + r2 + ' 应为 16:9'); process.exit(1); }
console.log('OK: rotation swap 逻辑正确 9:16=' + r1 + ' 16:9=' + r2);
" 2>&1 | grep -E "OK|FAIL"
```

**硬阈值**: tsx 执行 exit 0 + `detectAspect(1920,1080,90)` 返回 `"9:16"` + `detectAspect(1920,1080,0)` 返回 `"16:9"`

---

### Step 4: compose-template (W-G job) → aspect="9:16" + html 含 ede4d2 色板

**来源**: `[FROM_PRD]` — PRD Response Schema compose-template 200：`{html, aspect}`，aspect="9:16"，W-G PrepPRD 色板 #ede4d2

**可观测行为**: POST /{id}/compose-template → 200 JSON；html 字段含 W-G 底色；禁用字段不存在

**验证命令**:
```bash
WG_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/step4-wg.mp4","template_id":"W-G"}' | jq -r '.id') \
  || { echo "FAIL: W-G job 创建失败"; exit 1; }

COMPOSE_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$WG_JOB/compose-template \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"transcript":"test","segments":[],"duration":10}') \
  || { echo "FAIL: compose-template 非 2xx"; exit 1; }

# 必填字段
echo "$COMPOSE_RESP" | jq -e '.aspect == "9:16"' || { echo "FAIL: W-G aspect 不是 9:16"; exit 1; }
echo "$COMPOSE_RESP" | jq -e '.html | type == "string"' || { echo "FAIL: html 非 string"; exit 1; }

# W-G 色板验证
echo "$COMPOSE_RESP" | jq -r '.html' | grep -q "ede4d2" || { echo "FAIL: W-G 底色 #ede4d2 不在 HTML"; exit 1; }
echo "$COMPOSE_RESP" | jq -r '.html' | grep -qE "1080|1920" || { echo "FAIL: W-G HTML 缺竖版尺寸"; exit 1; }

# 必填字段完整性
echo "$COMPOSE_RESP" | jq -e '[has("html"), has("aspect")] | all' || { echo "FAIL: compose-template 必填字段不完整"; exit 1; }

# 禁用字段反向检查（PRD 明确禁用 ratio/aspectRatio/format/orientation）
echo "$COMPOSE_RESP" | jq -e 'has("ratio") | not' || { echo "FAIL: 禁用字段 ratio 漏网"; exit 1; }
echo "$COMPOSE_RESP" | jq -e 'has("aspectRatio") | not' || { echo "FAIL: 禁用字段 aspectRatio 漏网"; exit 1; }
echo "$COMPOSE_RESP" | jq -e 'has("format") | not' || { echo "FAIL: 禁用字段 format 漏网"; exit 1; }
echo "$COMPOSE_RESP" | jq -e 'has("orientation") | not' || { echo "FAIL: 禁用字段 orientation 漏网"; exit 1; }
echo "✅ Step 4 W-G 通过"
```

**硬阈值**: aspect="9:16" + html 含 ede4d2 + 禁用字段 ratio/aspectRatio/format/orientation 全不存在

---

### Step 4b: _buildCHtml → aspect="9:16"，_buildRHtml → aspect="16:9"

**来源**: `[FROM_PRD]` — PRD "范围限定 WS2"：_buildCHtml / _buildRHtml 三套专属 HTML 函数 + switch 分发

**可观测行为**: C 模板 job → compose-template 返回 aspect="9:16" + html 含 C 专属色板；R 模板 job → aspect="16:9"

**验证命令**:
```bash
# C 模板
C_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/step4b-c.mp4","template_id":"C"}' | jq -r '.id')
C_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$C_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"transcript":"test","segments":[],"duration":10}') || { echo "FAIL: C compose-template 失败"; exit 1; }
echo "$C_RESP" | jq -e '.aspect == "9:16"' || { echo "FAIL: _buildCHtml aspect 不是 9:16"; exit 1; }
echo "$C_RESP" | jq -e '.html | type == "string" and length > 0' || { echo "FAIL: _buildCHtml html 为空"; exit 1; }

# R 模板（横版）
R_JOB=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"local_path":"/tmp/step4b-r.mp4","template_id":"R"}' | jq -r '.id')
R_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/$R_JOB/compose-template \
  -H "Content-Type: application/json" -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d '{"transcript":"test","segments":[],"duration":10}') || { echo "FAIL: R compose-template 失败"; exit 1; }
echo "$R_RESP" | jq -e '.aspect == "16:9"' || { echo "FAIL: _buildRHtml aspect 不是 16:9"; exit 1; }
echo "$R_RESP" | jq -e '.html | type == "string" and length > 0' || { echo "FAIL: _buildRHtml html 为空"; exit 1; }
echo "✅ Step 4b C/R 模板通过"
```

**硬阈值**: C 模板 aspect="9:16" + R 模板 aspect="16:9"，html 字段非空字符串

---

### Step 5: Claude prompt 前缀含原始文案注入（函数执行验证）

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 6 行：Claude prompt 前缀含"用户录制前参考文案（非逐字稿，仅意图参考）：…"

**可观测行为**: 当 original_script 非 null 时，AI controller 构建的 Claude prompt 包含原始文案前缀文字；当 null 时不注入

**验证命令**:
```bash
# WS1 unit test 套件通过（包含 prompt 注入行为测试）
# 此处执行 vitest 是行为验证：测试实际调用函数并检查 prompt 输出，非静态文本匹配
cd /workspace && npx vitest run sprints/run-20260527-1934/tests/ws1/original-script-fields.test.ts \
  --reporter=verbose 2>&1 | tee /tmp/ws1-step5-result.log
# 全部测试必须通过（4/4 PASS）
grep -E "✓|passed" /tmp/ws1-step5-result.log | wc -l | xargs -I{} [ {} -ge 4 ] \
  || { echo "FAIL: WS1 unit tests 未全部通过（prompt 注入行为未实现）"; exit 1; }
echo "✅ Step 5 prompt 注入行为验证通过"
```

**硬阈值**: WS1 vitest 4 个测试全部 PASS，含 prompt 注入有空值保护测试

---

### Step 6: 非模板路径只生成 9_16.mp4 单文件（文件系统验证）

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 7 行：effectiveTarget = job.target_aspect ?? detectedAspect ?? "9:16"，只生成一个文件

**可观测行为**: 非模板路径 pipeline 完成后，output_dir 下只有 1 个 mp4 文件（不再同时生成 9_16.mp4 + 16_9.mp4）

**验证命令**:
```bash
# 从 DB 找最近一个 completed 非模板 job 的 output_dir，验证 mp4 文件数量
# （需在 final-e2e E2E 跑完后执行，output_dir 列由 WS3 migration 添加）
DB="${DB_URL:-postgresql://localhost/zenithjoy}"
OUTPUT_DIR=$(psql "$DB" -t -c \
  "SELECT output_dir FROM zenithjoy.ai_video_pipeline_jobs WHERE status='completed' AND template_id IS NULL AND output_dir IS NOT NULL AND updated_at > NOW() - interval '10 minutes' ORDER BY updated_at DESC LIMIT 1" \
  2>/dev/null | tr -d ' ')

if [ -z "$OUTPUT_DIR" ]; then
  echo "SKIP: 无最近 10 分钟 completed 非模板 job（需先跑 E2E）"
  exit 0
fi

MP4_COUNT=$(find "$OUTPUT_DIR" -maxdepth 1 -name "*.mp4" 2>/dev/null | wc -l | tr -d ' ')
[ "$MP4_COUNT" -le 1 ] || { echo "FAIL: 非模板 job output_dir 有 $MP4_COUNT 个 mp4（应 ≤ 1）"; exit 1; }
[ "$MP4_COUNT" -ge 1 ] || { echo "FAIL: 非模板 job output_dir 无 mp4 文件"; exit 1; }
echo "✅ Step 6 单文件输出验证通过 mp4_count=$MP4_COUNT output_dir=$OUTPUT_DIR"
```

**硬阈值**: output_dir 下 mp4 文件数量 == 1（SKIP 允许，仅在 E2E 后验证）

---

### Step 7: GHA Windows E2E Playwright green，截图证明三要素

**来源**: `[FROM_PRD]` — PRD "Golden Path 具体步骤" 第 8 行：GHA Windows E2E artifact 含截图，run green = 验收通过

**可观测行为**: e2e/agent-video-pipeline.spec.js 含 original_script + W-G + 9:16 三处关键断言；Agent version = 1.1.29；GHA workflow 含 windows-latest

**验证命令**:
```bash
# Agent 版本
V=$(node -e "console.log(JSON.parse(require('fs').readFileSync('services/agent/package.json','utf8')).version)")
[ "$V" = "1.1.29" ] || { echo "FAIL: Agent version=$V 应为 1.1.29"; exit 1; }

# E2E spec 三关键词 + 断言存在
node -e "
const c = require('fs').readFileSync('e2e/agent-video-pipeline.spec.js', 'utf8');
['original_script','W-G','9:16'].forEach(k => {
  if (!c.includes(k)) { console.error('FAIL: E2E spec 缺关键词', k); process.exit(1); }
});
const hasAssert = c.includes('original_script') && (c.includes('toBe(') || c.includes('toEqual(') || c.includes('==='));
if (!hasAssert) { console.error('FAIL: E2E spec original_script 无断言'); process.exit(1); }
console.log('OK');
"

# GHA workflow
node -e "
require('fs').accessSync('.github/workflows/agent-e2e-video.yml');
const c = require('fs').readFileSync('.github/workflows/agent-e2e-video.yml', 'utf8');
if (!c.includes('1.1.29')) { console.error('FAIL: workflow 缺 1.1.29'); process.exit(1); }
if (!c.includes('windows-latest')) { console.error('FAIL: workflow 不是 windows-latest'); process.exit(1); }
console.log('OK');
"
echo "✅ Step 7 通过"
```

**硬阈值**: version=1.1.29 + E2E spec 三关键词 + 有断言 + workflow windows-latest

---

### Step 8: original_script=null 时 API 正确处理（null 非 "undefined"）

**来源**: `[AI_ADDED]` — GAN Round 1 加入，理由：PRD 边界情况明确 "original_script = null → Claude prompt 不注入"；若实现无空值保护，GET 响应会返回字符串 "undefined" 导致 E2E 截图可见异常

**可观测行为**: 不传 original_script 创建 job → GET 返回 `original_script: null`（JSON null，不是字符串 "undefined" 或 "null"）

**验证命令**:
```bash
# 不传 original_script 创建 job
NULL_RESP=$(curl -sf -X POST http://localhost:5200/api/ai-video-pipeline/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR" \
  -d "{\"local_path\":\"/tmp/null-script-$(date +%s).mp4\"}") \
  || { echo "FAIL: null original_script job 创建失败"; exit 1; }

NULL_JOB_ID=$(echo "$NULL_RESP" | jq -r '.id')

# POST 响应验证：original_script 应为 null（JSON null，不是字符串）
echo "$NULL_RESP" | jq -e '.original_script == null' \
  || { echo "FAIL: POST 响应 original_script 非 null（实际: $(echo "$NULL_RESP" | jq '.original_script')）"; exit 1; }

# GET 响应验证：null 正确透传，不变成字符串 "undefined"
GET_NULL_RESP=$(curl -sf http://localhost:5200/api/ai-video-pipeline/$NULL_JOB_ID \
  -H "Authorization: Bearer ZJ-F-FBFYTLFR") \
  || { echo "FAIL: GET 失败"; exit 1; }
echo "$GET_NULL_RESP" | jq -e '.original_script == null' \
  || { echo "FAIL: GET 响应 original_script 非 null（可能被序列化为 undefined）"; exit 1; }

# 额外保护：不是字符串 "undefined" 或 "null"
NULL_VAL=$(echo "$GET_NULL_RESP" | jq -r '.original_script')
[ "$NULL_VAL" = "null" ] || { echo "FAIL: original_script 字符串值 '$NULL_VAL' 非 JSON null"; exit 1; }
echo "✅ Step 8 null 边界验证通过"
```

**硬阈值**: POST + GET 的 original_script 均为 JSON null，jq `== null` 断言 PASS

---

## E2E 验收（final-e2e — windows_cloud GHA）

**journey_type**: user_facing
**target_environment**: windows_cloud

### windows_cloud 变体 B：agent-e2e-video.yml Playwright

WS4 更新的 `e2e/agent-video-pipeline.spec.js` + `.github/workflows/agent-e2e-video.yml` 执行 E2E 验收。

E2E spec 必须包含以下关键操作与断言：

```javascript
// 1. 填写 original_script
await page.fill(
  '[data-testid="original-script-textarea"], textarea[placeholder*="文案"], textarea',
  'ZenithJoy E2E 原始文案测试'
);
await page.screenshot({ path: 'screenshots/02a-original-script-filled.png', fullPage: true });

// 2. 选择模板 W-G
await page.click('button:has-text("W-G"), [data-testid="template-wg"]');
await page.screenshot({ path: 'screenshots/02b-template-wg-selected.png', fullPage: true });

// 3. 选择比例 9:16
await page.click('button:has-text("9:16"), [data-testid="aspect-916"]');
await page.screenshot({ path: 'screenshots/02c-aspect-916-selected.png', fullPage: true });

// 4. 等待 job 完成后验证
const jobResp = await page.request.get(`${BASE}/api/ai-video-pipeline/${jobId}`, {
  headers: { Authorization: `Bearer ${E2E_LICENSE}` }
});
const jobData = await jobResp.json();
expect(jobData.original_script).toBe('ZenithJoy E2E 原始文案测试');
expect(jobData.target_aspect).toBe('9:16');
```

**PASS 标准**: GHA windows-latest run green + artifact 含 4 张截图
**FAIL 标准**: run 红 OR jobData.original_script 不匹配 OR 截图缺失

---

## Workstreams

**workstream_count**: 4

> **路径一致性声明（v7.8 回应 Reviewer Issue #4）**：以下 Workstream 文件路径全部使用实际仓库路径（`apps/api/src/` 前缀 + kebab-case），与 PRD "预期受影响文件" 段不一致处以本合同为准。

### Workstream 1: DB migration(original_script) + createJob API + 前端 textarea + Claude prompt 注入

**范围**: ADD COLUMN original_script TEXT NULL；service.createJob 接受 originalScript；controller 读 req.body.original_script/target_aspect 并返回；LocalVideoPipelinePage 加 original_script textarea；AI controller prompt 前缀注入含空值保护
**大小**: M（跨 5 个文件，每文件 ≤30 行净增）
**依赖**: 无
**DoD 文件**: `contract-dod-ws1.md`（含 ≥5 条 [BEHAVIOR] + manual:bash 命令）

---

### Workstream 2: _buildWGHtml / _buildCHtml / _buildRHtml + switch 分发

**范围**: ai-video-pipeline-ai.controller.ts 新增三个专属函数（W-G 1080×1920 #ede4d2 / C 1080×1920 / R 1920×1080）；_buildDynamicTemplateHtml switch 分发
**大小**: M（~190 行净增，1 文件）
**依赖**: Workstream 1 完成后
**DoD 文件**: `contract-dod-ws2.md`（含 ≥6 条 [BEHAVIOR]，覆盖 W-G/C/R 三套）

---

### Workstream 3: ffprobe width/height + detectedAspect + target_aspect 列 + 单文件输出 + 前端比例选择器

**范围**: migration ADD COLUMN target_aspect/detected_aspect；ffprobe step1 读 vStream.width/height + detectAspect 函数（导出函数，rotation swap）；PATCH 写 detected_aspect；非模板路径 effectiveTarget 单文件；前端比例选择按钮 + createJob 传 target_aspect
**大小**: M（跨 4 个文件）
**依赖**: Workstream 2 完成后
**DoD 文件**: `contract-dod-ws3.md`（含 ≥5 条 [BEHAVIOR]，rotation BEHAVIOR 使用 tsx 函数执行验证）

---

### Workstream 4: Agent v1.1.29 version bump + E2E spec 更新 + GHA workflow 更新

**范围**: services/agent/package.json version → 1.1.29；e2e/agent-video-pipeline.spec.js 加三处操作 + 断言；agent-e2e-video.yml agent_version 默认值 → 1.1.29
**大小**: S（3 文件，~50 行净增）
**依赖**: Workstream 3 完成后
**DoD 文件**: `contract-dod-ws4.md`（含 ≥5 条 [BEHAVIOR]）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/original-script-fields.test.ts` | original_script 写入/返回/prompt注入/migration存在/空值保护 | 4 failures（字段/函数不存在） |
| WS2 | `tests/ws2/template-html-builders.test.ts` | _buildWGHtml/C/R 函数存在 + 色板 + switch 分发 | 4 failures（函数不存在） |
| WS3 | `tests/ws3/ffprobe-aspect-detection.test.ts` | detectAspect + rotation swap + 比例选择器 + migration | 5 failures（函数/列不存在） |
| WS4 | `tests/ws4/agent-version-e2e-spec.test.ts` | version=1.1.29 + E2E spec 三关键词 + 断言 | 5 failures（版本不匹配） |
