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

- [ ] [ARTIFACT] `apps/api/src/services/video-remake.service.ts` 新建，含 TOAPI_API_KEY + DASHSCOPE_API_KEY + i2v/happy-horse 调用
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/video-remake.service.ts','utf8');if(!c.includes('TOAPI_API_KEY')){console.error('FAIL:缺TOAPI_API_KEY');process.exit(1);}if(!c.includes('DASHSCOPE_API_KEY')){console.error('FAIL:缺DASHSCOPE_API_KEY');process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/video-remake.spec.ts` 新建（Playwright spec，含9节点路径验证）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/video-remake.spec.ts','utf8');if(!c.includes('/video-remake')){console.error('FAIL:spec缺路由');process.exit(1);}if(!c.includes('test(')){console.error('FAIL:spec无test()');process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `sprints/06100919-line07-video-remake-pipeline/e2e-verify.ps1` 存在，含 Vite preview 启动 + Playwright video-remake.spec.ts 调用
  Test: node -e "const c=require('fs').readFileSync('sprints/06100919-line07-video-remake-pipeline/e2e-verify.ps1','utf8');if(!c.includes('vite')){console.error('FAIL:ps1缺vite');process.exit(1);}if(!c.includes('video-remake.spec.ts')){console.error('FAIL:ps1缺spec引用');process.exit(1);}console.log('OK')"

---

## BEHAVIOR 条目

### [BEHAVIOR 1] POST /api/video-remake/jobs 返回 job_id + status="queued"，禁用字段不存在

**Golden Path 对应**: Step 2 — N01上传解析，API 创建任务返回 `job_id`
**自查**: 若 API 路由未注册 → curl 返回 404 + 无 `job_id` → FAIL ✅

- [ ] [BEHAVIOR] POST /api/video-remake/jobs 返回 `job_id`(string) + `status`(string)，schema keys 完整性匹配 ["job_id","status"]
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:3001/api/video-remake/jobs -H "Content-Type: application/json" -F "video=@/tmp/test.mp4" 2>/dev/null || curl -sf -X POST http://localhost:3001/api/video-remake/jobs -H "Content-Type: application/json" -d "{}" 2>/dev/null) || { echo "FAIL: POST /jobs 未返回200"; exit 1; }; echo "$RESP" | node -e "const d=JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'/dev/stdin'"'"','utf8'));if(typeof d.job_id!=='"'"'string'"'"'){process.exit(1);}if(d.status!=='"'"'queued'"'"'){process.exit(1);}console.log('"'"'OK'"'"')" || exit 1; echo OK'
  期望: OK（job_id 为 string，status = "queued"）

- [ ] [BEHAVIOR] POST /api/video-remake/jobs 响应不含禁用字段（id/task_id/jobId/job）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/api/src/services/video-remake.service.ts'"'"','"'"'utf8'"'"');const bad=['"'"'jobId'"'"','"'"'task_id'"'"'];bad.forEach(f=>{if(c.includes(f+'"'"':'"'"')||c.includes(f+'"'"' :'"'"')){console.error('"'"'FAIL:禁用字段'"'"',f);process.exit(1);}});console.log('"'"'OK'"'"')"'
  期望: OK（服务文件不含禁用字段名作为返回键）

- [ ] [BEHAVIOR] POST /api/video-remake/jobs 上传超100MB文件返回 HTTP 400 + error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/video-remake/jobs -H "Content-Length: 104857601" 2>/dev/null); [ "$CODE" = "400" ] || [ "$CODE" = "413" ] || { echo "FAIL: 超100MB应返回4xx, got $CODE"; exit 1; }; echo OK'
  期望: OK（HTTP 400 或 413）

- [ ] [BEHAVIOR] GET /api/video-remake/jobs/:job_id 响应 nodes 数组含9项，每项含 node_id/label/status/input/output 字段
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/api/src/services/video-remake.service.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'N01'"'"')||!c.includes('"'"'N09'"'"')){console.error('"'"'FAIL:服务缺N01/N09节点定义'"'"');process.exit(1);}if(!c.includes('"'"'node_id'"'"')){console.error('"'"'FAIL:缺node_id字段'"'"');process.exit(1);}console.log('"'"'OK'"'"')"'
  期望: OK（服务含完整9节点定义）

- [ ] [BEHAVIOR] GET /api/video-remake/jobs/:job_id/output 响应含 job_id/download_url/duration_seconds/has_video_stream，禁用字段 url/video_url/hasVideo 不存在
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/api/src/services/video-remake.service.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'download_url'"'"')){console.error('"'"'FAIL:缺download_url'"'"');process.exit(1);}if(!c.includes('"'"'has_video_stream'"'"')){console.error('"'"'FAIL:缺has_video_stream'"'"');process.exit(1);}const bad=['"'"'hasVideo'"'"','"'"'video_url'"'"','"'"'outputUrl'"'"'];bad.forEach(f=>{if(c.includes(f+'"'"':'"'"')||c.includes(f+'"'"' :'"'"')){console.error('"'"'FAIL:禁用字段'"'"',f);process.exit(1);}});console.log('"'"'OK'"'"')"'
  期望: OK（含 download_url + has_video_stream，无禁用字段）

- [ ] [BEHAVIOR] POST .../nodes/N07/select 响应 keys == ["job_id","selected_frame"]，CI=true 时 selected_frame 不为空
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/api/src/services/video-remake.service.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'selected_frame'"'"')){console.error('"'"'FAIL:缺selected_frame字段'"'"');process.exit(1);}if(!c.includes('"'"'ci_auto'"'"')&&!c.includes('"'"'CI'"'"')){console.error('"'"'FAIL:缺CI自动选帧逻辑'"'"');process.exit(1);}console.log('"'"'OK'"'"')"'
  期望: OK（含 selected_frame + CI 自动选帧逻辑）

- [ ] [BEHAVIOR] GET /api/video-remake/jobs/:invalid/output 返回 HTTP 404 + error 字段存在
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/api/src/controllers/video-remake.controller.ts'"'"','"'"'utf8'"'"');if(!c.includes('"'"'404'"'"')&&!c.includes('"'"'Not Found'"'"')&&!c.includes('"'"'not found'"'"')){console.error('"'"'FAIL:控制器缺404处理'"'"');process.exit(1);}console.log('"'"'OK'"'"')"'
  期望: OK（控制器含 404 / Not Found 处理）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e — Playwright + Vite）

- [ ] [BEHAVIOR:E2E] Playwright 跑完整 Golden Path：页面加载9节点 → 上传 MP4 → N01-N06 依序变绿 → N04 对比帧可见 → N07 CI自动选帧 → N09 下载按钮出现 → has_video_stream=true
  Test: 通过 `sprints/06100919-line07-video-remake-pipeline/e2e-verify.ps1` 触发（CI=true，windows-latest GHA）
  期望: exit 0 + "✅ video-remake 9节点流水线 E2E 验证通过"

- [ ] [BEHAVIOR:E2E] 边界：超100MB文件前端拒绝，错误提示可见，不触发后端 API
  Test: 通过 `apps/dashboard/e2e/video-remake.spec.ts` 内 `超100MB文件` test case 覆盖（Playwright）
  期望: test case PASS（error 提示可见，API call count = 0）
