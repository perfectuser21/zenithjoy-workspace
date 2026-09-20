---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 批量混剪加厚（文案动态分段 + 素材在线预览 + 候选200+可视化浏览）

**范围**: 加厚 line05/batch_mashup 第 1-4 步：新增 POST /api/mashup/templates/from-script（文案动态分段模板，AI 不可用降级）、GET /api/materials/:id/signed-url（在线预览重签）；改造候选接口返回 generatedCount + thumbnailUrl；改造渲染接口为并发=1 队列 + 渲染失败态（新增 mashup_render_jobs 表 + thumbnail_url 列）。
**大小**: L（单 Sprint 单 PR，见 task-plan.json；见 notes 关于体量的疑虑）

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增 mashup_render_jobs 表 + thumbnail_url 列的 migration
  Test: node -e "const fs=require('fs');const g=fs.readdirSync('apps/api/db/migrations');const hit=g.some(f=>{const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');return c.includes('mashup_render_jobs')&&c.includes('thumbnail_url')});process.exit(hit?0:1)"
  期望: exit 0

- [ ] [ARTIFACT] 冻结 Golden Path 测试文件存在且断言新端点/字段
  Test: node -e "const c=require('fs').readFileSync('sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts','utf8');if(!c.includes('from-script')||!c.includes('signed-url')||!c.includes('generatedCount')||!c.includes('queuePosition'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌 manual:bash -c 单行命令，evaluator 真跑冻结用例：真 app + 真 PG）

- [ ] [BEHAVIOR] [L2] B-01: 空文案返回 400（Step1 输入校验）
  动作: POST /api/mashup/templates/from-script 传 {"script":""}
  预期观察: 响应 HTTP 400，error.code=INVALID_BODY
  等待预算: 0s
  留证: vitest 用例输出末 5 行（含 PASS 行）
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "空文案返回 400"'

- [ ] [BEHAVIOR] [L2] B-02: 文案分段静默降级并落库（Step1 主路，AI 不可用非阻断）
  动作: 无 TOAPIS key 环境下 POST /templates/from-script 传一段文案
  预期观察: 200，data.degraded=true、source=fallback、segments≥1（含 roleTag/suggestedCount/mapped），mashup_templates 落一条本租户行
  等待预算: 0s
  留证: vitest 用例输出 + mashup_templates 行归属租户
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "静默降级"'

- [ ] [BEHAVIOR] [L2] B-03: 新模板租户隔离（INV 租户隔离）
  动作: 租户A建模板后，租户A与租户B分别 GET /api/mashup/templates
  预期观察: A 的列表含新模板 id，B 的列表不含
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "新模板只对本租户可见"'

- [ ] [BEHAVIOR] [L2] B-04: 素材在线预览重签返回可播放 previewUrl（Step2）
  动作: GET /api/materials/:id/signed-url（视频素材）
  预期观察: 200，data.playable=true 且 previewUrl 非空字符串
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "返回可播放 previewUrl"'

- [ ] [BEHAVIOR] [L2] B-05: 他租户素材重签返回 404（Step2 INV 租户隔离）
  动作: 用租户B凭据 GET 租户A素材的 /signed-url
  预期观察: HTTP 404
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "他租户素材重签返回 404"'

- [ ] [BEHAVIOR] [L2] B-06: 候选返回 generatedCount 与每条 thumbnailUrl（Step3）
  动作: GET /api/mashup/runs/:id/candidates
  预期观察: 200，data.generatedCount 为数字，每条候选含 thumbnailUrl 字段
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "generatedCount 与每条候选 thumbnailUrl"'

- [ ] [BEHAVIOR] [L2] B-07: 候选浏览阶段不触发渲染（Step3 避免 CPU 过载）
  动作: 浏览候选后查 contents 表
  预期观察: 该 run 候选对应 contents 产物数=0
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "候选浏览阶段不触发渲染"'

- [ ] [BEHAVIOR] [L2] B-08: 并发=1 第二请求进队列（Step4 INV 并发=1）[接缝×2]
  动作: 已有 rendering 作业时 POST /candidates/:id/render
  预期观察: 200，data.status=queued 且 queuePosition≥1
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "返回 queued"'

- [ ] [BEHAVIOR] [L2] B-09: 渲染失败态可重试（Step4 非死路）
  动作: 对 render_failed 候选（并发已满）再次 POST render
  预期观察: 200，status ∈ {queued,rendering,completed}，不 4xx 卡死
  等待预算: 0s
  留证: vitest 用例输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "渲染失败态可重试"'

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [串行/渲染并发=1] DB mashup_render_jobs rendering 计数为并发闸，第二请求入队
  动作: 复跑 B-08 队列用例
  预期观察: 第二 render 请求 status=queued（并发=1 落地）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "返回 queued"'

- [ ] [BEHAVIOR] [L2] INV-2 [租户隔离] 多租户种子真验模板/素材跨租户不可见
  动作: 复跑租户隔离用例（模板 + 素材）
  预期观察: 他租户既看不到新模板，也无法重签他人素材（404）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd /workspace && DATABASE_URL="${DB_URL:?}" npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-thicken.test.ts -t "租户"'

- INV-3 [禁写死环境假设值] N/A-断言：合同 E2E/测试全部从 env 推导（BASE_URL/DB_URL/TOKEN 运行时注入），无屏幕坐标/假版本/假 env 硬编码；接缝值（真渲染/真分段）在 staging 真验
- INV-4 [真环境验证才 done] 接缝项（真 TOAPIS 分段/真 ffmpeg 渲染/真并发时序）标 logic-done-pending，在 ## staging 预览闸 真目标验，未真验不标 done
- INV-5 [凭据安全/端点鉴权] B-01~B-09 全部经 X-Upload-Token→validateLicense 反查承载；缺凭据 401 由回归 mashup.test.ts 已覆盖，本单不回退（不重复造断言）

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 在 staging 跑）

- [ ] [BEHAVIOR:E2E] [L3] 客户完整走完 Golden Path 1-4，截图可视化验证 [接缝×2]
  Screenshots:
    - staging-01-script.png    期望：粘贴文案后见动态分段结构（非固定 4 段）
    - staging-02-preview.png   期望：PickStep 素材卡片 <video> 可播放
    - staging-03-candidates.png 期望：候选缩略图拼贴网格，虚拟滚动（DOM 节点数≈可视区）
    - staging-04-render.png    期望：选中候选后见渲染队列/失败态；成片可在线播放 1080P
  期望：staging 真环境（真 TOAPIS 分段/真抽帧/真 ffmpeg 渲染）截图与期望一致，Claude Read 图自验通过
