---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Line 07 AI爆款视频翻拍 9节点可视化流水线（thin）

**范围**: Dashboard 新页面 `/video-remake`（9节点n8n风格流水线图）+ API路由 `/api/video-remake/*`（jobs/nodes/output）+ gpt-image-2 + DashScope happy-horse i2v 服务调用 + N07 CI自动选帧
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/VideoRemakePipelinePage.tsx` 新建，含9节点定义（N01–N09 标签均出现）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/VideoRemakePipelinePage.tsx','utf8');['N01','N02','N03','N04','N05','N06','N07','N08','N09'].forEach(id=>{if(!c.includes(id)){console.error('FAIL:缺节点',id);process.exit(1);}});console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 含 `/video-remake` 路由项及 `VideoRemakePipelinePage` 懒加载
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!c.includes('video-remake')){console.error('FAIL:nav缺video-remake路由');process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/routes/video-remake.ts` 新建，含 POST /jobs + GET /jobs/:id + POST /jobs/:id/nodes/N07/select + GET /jobs/:id/output 路由定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/video-remake.ts','utf8');if(!c.includes('N07')){console.error('FAIL:缺N07路由');process.exit(1);}if(!c.includes('output')){console.error('FAIL:缺output路由');process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/video-remake.service.ts` 新建，含 TOAPI_API_KEY + DASHSCOPE_API_KEY + i2v/happy-horse 调用 + analyzeSceneFrame/evaluateFrameScores/redrawFrameWithToAPI/generateVideoWithDashScope 导出
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/video-remake.service.ts','utf8');if(!c.includes('TOAPI_API_KEY')){console.error('FAIL:缺TOAPI_API_KEY');process.exit(1);}if(!c.includes('DASHSCOPE_API_KEY')){console.error('FAIL:缺DASHSCOPE_API_KEY');process.exit(1);}if(!c.includes('analyzeSceneFrame')){console.error('FAIL:缺analyzeSceneFrame导出');process.exit(1);}if(!c.includes('evaluateFrameScores')){console.error('FAIL:缺evaluateFrameScores导出');process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/video-remake.spec.ts` **commit-1 创建（RED）**，含9节点路径 + N03/N05/N04/N09/100MB 完整 Playwright 测试
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts','utf8');if(!c.includes('/video-remake')){console.error('FAIL:spec缺路由');process.exit(1);}['N03','N05','N04','N09'].forEach(n=>{if(!c.includes(n)){console.error('FAIL:spec缺',n,'断言');process.exit(1);}});console.log('OK')"

- [ ] [ARTIFACT] `sprints/06100919-line07-video-remake-pipeline/e2e-verify.ps1` 存在，含 Vite preview 启动 + Playwright video-remake.spec.ts 调用
  Test: node -e "const c=require('fs').readFileSync('sprints/06100919-line07-video-remake-pipeline/e2e-verify.ps1','utf8');if(!c.includes('vite')){console.error('FAIL:ps1缺vite');process.exit(1);}if(!c.includes('video-remake.spec.ts')){console.error('FAIL:ps1缺spec引用');process.exit(1);}console.log('OK')"

---

## BEHAVIOR 条目

### [BEHAVIOR 1] POST /api/video-remake/jobs — createJob schema + 禁用字段验证

**Golden Path 对应**: Step 2 — N01 上传解析，API 创建任务返回 `job_id`
**自查**: 若 createVideoRemakeJob 未实现 → import 失败 → FAIL ✅

- [ ] [BEHAVIOR] createVideoRemakeJob 返回 `job_id`(string) + `status="queued"`，keys 精确匹配，禁用字段不存在
  Test: manual:bash -c 'node --input-type=module << '"'"'EOF'"'"'
import { createVideoRemakeJob } from "./apps/api/src/services/video-remake.service.js";
const r = await createVideoRemakeJob({ filename: "test.mp4", fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
if (typeof r.job_id !== "string" || r.job_id.length === 0) { console.error("FAIL: job_id非string或空"); process.exit(1); }
if (r.status !== "queued") { console.error("FAIL: status!=queued, got", r.status); process.exit(1); }
if ("id" in r || "jobId" in r || "task_id" in r) { console.error("FAIL: 禁用字段出现"); process.exit(1); }
console.log("OK job_id=" + r.job_id);
EOF'
  期望: OK（job_id 为非空 string，status="queued"，无禁用字段）

### [BEHAVIOR 2] POST /api/video-remake/jobs — 超100MB文件返回错误

**Golden Path 对应**: Step 8 — 边界：超100MB文件被服务层拒绝
**自查**: 若 createVideoRemakeJob 未实现大小验证 → 不抛出错误 → FAIL ✅

- [ ] [BEHAVIOR] fileSizeBytes > 100MB 时 createVideoRemakeJob 抛出错误（不接受大文件）
  Test: manual:bash -c 'node --input-type=module << '"'"'EOF'"'"'
import { createVideoRemakeJob } from "./apps/api/src/services/video-remake.service.js";
try {
  await createVideoRemakeJob({ filename: "large.mp4", fileSizeBytes: 104857601, buffer: Buffer.from([]) });
  console.error("FAIL: 超100MB应抛出错误"); process.exit(1);
} catch (e) {
  console.log("OK 超100MB正确拒绝:", e.message || e.code);
}
EOF'
  期望: OK（service 层抛出错误）

### [BEHAVIOR 3] GET /api/video-remake/jobs/:id — nodes 数组真实结构验证

**Golden Path 对应**: Step 1-2 — 9节点流水线初始化，每节点含完整字段
**自查**: 若 getVideoRemakeJob 未实现 → import 失败 → FAIL；若 nodes 少于9项 → 断言失败 → FAIL ✅

- [ ] [BEHAVIOR] getVideoRemakeJob 返回 nodes 数组含9项（N01–N09），每项含 node_id/label/status/input/output 字段
  Test: manual:bash -c 'node --input-type=module << '"'"'EOF'"'"'
import { createVideoRemakeJob, getVideoRemakeJob } from "./apps/api/src/services/video-remake.service.js";
const created = await createVideoRemakeJob({ filename: "test.mp4", fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const job = await getVideoRemakeJob(created.job_id);
if (!Array.isArray(job.nodes) || job.nodes.length !== 9) { console.error("FAIL: nodes长度非9, got", job.nodes?.length); process.exit(1); }
const n = job.nodes[0];
if (!n.node_id || !n.label || !n.status || !("input" in n) || !("output" in n)) {
  console.error("FAIL: N01缺字段", Object.keys(n)); process.exit(1);
}
const ids = job.nodes.map(x => x.node_id);
if (!ids.includes("N01") || !ids.includes("N09")) { console.error("FAIL: 缺N01或N09"); process.exit(1); }
console.log("OK nodes.length=9 ids=" + ids.join(","));
EOF'
  期望: OK（nodes 数组9项，每项含完整字段，N01/N09 存在）

### [BEHAVIOR 4] N03 场景分析 — 节点输出含 original_frame_url + prompt_text

**Golden Path 对应**: Step 3 — N03 执行完成，输出原帧URL + AI生成Prompt文本
**自查**: 若 analyzeSceneFrame 未实现 → import 失败 → FAIL；若 output 缺字段 → FAIL ✅

- [ ] [BEHAVIOR] analyzeSceneFrame 返回 { original_frame_url: string, prompt_text: string(非空) }
  Test: manual:bash -c 'TEST_MODE=1 node --input-type=module << '"'"'EOF'"'"'
import { analyzeSceneFrame } from "./apps/api/src/services/video-remake.service.js";
const r = await analyzeSceneFrame({ frameUrl: "fixture://test-frame-0.jpg", frameIndex: 0 });
if (typeof r.original_frame_url !== "string" || r.original_frame_url.length === 0) {
  console.error("FAIL: N03 output 缺 original_frame_url"); process.exit(1);
}
if (typeof r.prompt_text !== "string" || r.prompt_text.length === 0) {
  console.error("FAIL: N03 output 缺 prompt_text 或为空"); process.exit(1);
}
console.log("OK N03 original_frame_url=" + r.original_frame_url.slice(0,30) + "... prompt_text.len=" + r.prompt_text.length);
EOF'
  期望: OK（original_frame_url 非空 string，prompt_text 非空 string）

### [BEHAVIOR 5] N05 帧评选 — 输出含 frames 评分列表

**Golden Path 对应**: Step 4 — N05 评选完成，节点展开见帧评分列表
**自查**: 若 evaluateFrameScores 未实现 → import 失败 → FAIL；若 frames 缺字段 → FAIL ✅

- [ ] [BEHAVIOR] evaluateFrameScores 返回 { frames: [{ redrawn_frame_url: string, score: number }] }
  Test: manual:bash -c 'TEST_MODE=1 node --input-type=module << '"'"'EOF'"'"'
import { evaluateFrameScores } from "./apps/api/src/services/video-remake.service.js";
const r = await evaluateFrameScores({ redrawnFrames: [{ original_frame_url: "fixture://orig-0.jpg", redrawn_frame_url: "fixture://redrawn-0.jpg" }] });
if (!Array.isArray(r.frames) || r.frames.length === 0) { console.error("FAIL: frames非数组或为空"); process.exit(1); }
const f = r.frames[0];
if (typeof f.redrawn_frame_url !== "string") { console.error("FAIL: frames[0]缺redrawn_frame_url"); process.exit(1); }
if (typeof f.score !== "number") { console.error("FAIL: frames[0]缺score(number)"); process.exit(1); }
console.log("OK N05 frames.length=" + r.frames.length + " score=" + f.score);
EOF'
  期望: OK（frames 非空数组，每项含 redrawn_frame_url(string) + score(number)）

### [BEHAVIOR 6] POST .../nodes/N07/select — schema + CI 自动选帧

**Golden Path 对应**: Step 6 — N07 CI=true 自动选第一帧
**自查**: 若 selectN07Frame 未实现 → import 失败 → FAIL；若 keys 不精确 → FAIL ✅

- [ ] [BEHAVIOR] selectN07Frame(ciAuto=true) 返回 keys == ["job_id","selected_frame"]，selected_frame 非空，无禁用字段
  Test: manual:bash -c 'TEST_MODE=1 node --input-type=module << '"'"'EOF'"'"'
import { createVideoRemakeJob, selectN07Frame } from "./apps/api/src/services/video-remake.service.js";
const c = await createVideoRemakeJob({ filename: "test.mp4", fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const r = await selectN07Frame({ jobId: c.job_id, ciAuto: true });
if (Object.keys(r).sort().join(",") !== "job_id,selected_frame") {
  console.error("FAIL: keys非精确匹配, got", Object.keys(r).sort()); process.exit(1);
}
if (typeof r.selected_frame !== "string" || r.selected_frame.length === 0) {
  console.error("FAIL: selected_frame为空"); process.exit(1);
}
if ("frame_id" in r || "chosen_frame" in r || "frameIndex" in r) {
  console.error("FAIL: 禁用字段出现"); process.exit(1);
}
console.log("OK selected_frame=" + r.selected_frame);
EOF'
  期望: OK（keys 精确等于 ["job_id","selected_frame"]，selected_frame 非空，无禁用字段）

### [BEHAVIOR 7] GET .../output — 真实结构验证（duration_seconds > 0，has_video_stream = true）

**Golden Path 对应**: Step 7 — N09 合成完成，输出 MP4 可下载
**自查**: 若 getVideoRemakeOutput 未实现 → import 失败 → FAIL；若 duration_seconds ≤ 0 → FAIL ✅

- [ ] [BEHAVIOR] getVideoRemakeOutput 返回 { job_id, download_url, duration_seconds > 0, has_video_stream: true }，禁用字段不存在
  Test: manual:bash -c 'TEST_MODE=1 node --input-type=module << '"'"'EOF'"'"'
import { createVideoRemakeJob, getVideoRemakeOutput } from "./apps/api/src/services/video-remake.service.js";
const c = await createVideoRemakeJob({ filename: "test.mp4", fileSizeBytes: 1024, buffer: Buffer.from([0,0,0]) });
const o = await getVideoRemakeOutput(c.job_id);
if (typeof o.download_url !== "string" || o.download_url.length === 0) { console.error("FAIL: download_url缺失"); process.exit(1); }
if (typeof o.duration_seconds !== "number" || o.duration_seconds <= 0) {
  console.error("FAIL: duration_seconds非正数, got", o.duration_seconds); process.exit(1);
}
if (o.has_video_stream !== true) { console.error("FAIL: has_video_stream != true"); process.exit(1); }
if ("url" in o || "video_url" in o || "hasVideo" in o) { console.error("FAIL: 禁用字段出现"); process.exit(1); }
console.log("OK duration_seconds=" + o.duration_seconds + " has_video_stream=" + o.has_video_stream);
EOF'
  期望: OK（download_url 非空，duration_seconds > 0，has_video_stream = true，无禁用字段）

### [BEHAVIOR 8] error path — 无效 job_id 返回 404 错误

**Golden Path 对应**: Step 7 error branch — job_id 不存在时正确返回 404
**自查**: 若 getVideoRemakeJob 未实现 404 检测 → 不抛出/返回错误 → FAIL ✅

- [ ] [BEHAVIOR] getVideoRemakeJob("non-existent-id") 抛出包含 404/Not Found 信息的错误
  Test: manual:bash -c 'node --input-type=module << '"'"'EOF'"'"'
import { getVideoRemakeJob } from "./apps/api/src/services/video-remake.service.js";
try {
  await getVideoRemakeJob("non-existent-id-12345");
  console.error("FAIL: 应抛出错误但未抛出"); process.exit(1);
} catch (e) {
  const msg = (e.message || "") + (e.code || "") + (e.status || "");
  if (!msg.includes("404") && !msg.toLowerCase().includes("not found")) {
    console.error("FAIL: 错误不含404/Not Found, got:", msg); process.exit(1);
  }
  console.log("OK 404错误正确:", msg.slice(0,50));
}
EOF'
  期望: OK（抛出含 "404" 或 "not found" 信息的错误）

### [BEHAVIOR 9] N04 error path — gpt-image-2 单帧失败，节点标红

**Golden Path 对应**: Step 9 — N04 边界：单帧 API 调用失败时错误结构正确
**自查**: 若 redrawFrameWithToAPI 未实现错误码 → e.code 不是 N04_API_FAILURE → FAIL ✅

- [ ] [BEHAVIOR] FORCE_TOAPI_FAIL=1 时 redrawFrameWithToAPI 抛出 { code: "N04_API_FAILURE" }
  Test: manual:bash -c 'FORCE_TOAPI_FAIL=1 node --input-type=module << '"'"'EOF'"'"'
import { redrawFrameWithToAPI } from "./apps/api/src/services/video-remake.service.js";
try {
  await redrawFrameWithToAPI({ frameUrl: "test.jpg", frameIndex: 0 });
  console.error("FAIL: FORCE_TOAPI_FAIL=1时应抛出错误"); process.exit(1);
} catch (e) {
  if (e.code !== "N04_API_FAILURE") {
    console.error("FAIL: code!=N04_API_FAILURE, got", e.code); process.exit(1);
  }
  console.log("OK N04失败路径正确 code=N04_API_FAILURE");
}
EOF'
  期望: OK（FORCE_TOAPI_FAIL=1 时抛出 code="N04_API_FAILURE" 错误）

### [BEHAVIOR 10] N08 timeout path — i2v 超时，节点标红

**Golden Path 对应**: Step 10 — N08 边界：DashScope 超时时错误结构正确
**自查**: 若 generateVideoWithDashScope 未实现超时检测 → N08_TIMEOUT_MS=1 时不抛出 → FAIL ✅

- [ ] [BEHAVIOR] N08_TIMEOUT_MS=1 时 generateVideoWithDashScope 抛出 { code: "N08_TIMEOUT" }
  Test: manual:bash -c 'N08_TIMEOUT_MS=1 node --input-type=module << '"'"'EOF'"'"'
import { generateVideoWithDashScope } from "./apps/api/src/services/video-remake.service.js";
try {
  await generateVideoWithDashScope({ frameUrl: "test.jpg", apiKey: "test-key" });
  console.error("FAIL: N08_TIMEOUT_MS=1时应抛出超时错误"); process.exit(1);
} catch (e) {
  if (e.code !== "N08_TIMEOUT") {
    console.error("FAIL: code!=N08_TIMEOUT, got", e.code); process.exit(1);
  }
  console.log("OK N08超时路径正确 code=N08_TIMEOUT");
}
EOF'
  期望: OK（N08_TIMEOUT_MS=1 时抛出 code="N08_TIMEOUT" 错误）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e — Playwright + Vite）

- [ ] [BEHAVIOR:E2E] Playwright 跑完整 Golden Path：页面加载9节点 → 上传 MP4 → N01-N06 依序变绿 → N03 展开见原帧+Prompt → N04 展开见对比帧 → N05 展开见评分列表 → N07 CI自动选帧 → N09 下载按钮出现 → has_video_stream=true + duration_seconds>0
  Test: 通过 `sprints/06100919-line07-video-remake-pipeline/e2e-verify.ps1` 触发（CI=true，windows-latest GHA）
  期望: exit 0 + "✅ video-remake 9节点流水线 E2E 验证通过"

- [ ] [BEHAVIOR:E2E] 边界：超100MB文件前端拒绝，错误提示可见，不触发后端 API
  Test: 通过 `apps/dashboard/e2e/video-remake.spec.ts` 内 `超100MB文件` test case 覆盖（Playwright）
  期望: test case PASS（error 提示可见，API call count = 0）
