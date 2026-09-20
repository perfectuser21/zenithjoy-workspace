---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 批量混剪加厚（文案动态分段 + 素材在线预览 + 候选200+可视化浏览 + 按需渲染）

**范围**: line05/批量混剪 thin→medium 加厚。①文案→动态分段模板落库（Step1）②素材在线预览重签端点（Step2）③候选200+缩略图拼贴+如实数量（Step3）④渲染并发=1排队+失败态（Step4）。Step5（成片/内容安全）沿用现有不动。
**大小**: L
**target_environment**: windows_cloud（UI 端到端）+ 服务端接缝真库真验（fleet-worker 真 Postgres）
**说明**: 下列 [BEHAVIOR] 的 `manual:` 命令用 `node node_modules/vitest/vitest.mjs`（app 自己的 pool 读 DATABASE_*，真 Postgres 须已跑完 zenithjoy migration）真实执行合同集成测试；vitest 输出仅供 generator TDD，evaluator 以此处 manual 命令 exit code 为准。

## ARTIFACT 条目

- [ ] [ARTIFACT] ai_tags 枚举单一来源模块存在（INV-2 枚举单源载体）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ai-tags.ts','utf8');if(!/AI_TAG_VOCAB/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 渲染并发队列模块存在（Step4 并发接缝载体）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/mashup-render-queue.ts','utf8');if(!/RENDER_MAX_CONCURRENCY/.test(c)||!/enqueueRender/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] windows_cloud UI E2E 脚本 + workflow 存在
  Test: node -e "const fs=require('fs');fs.accessSync('sprints/09201034-batch-mashup-script-preview-candidates/e2e-verify.ps1');fs.accessSync('.github/workflows/e2e-windows-mashup.yml')"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌 manual: 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: 客户粘贴文案 → 解析出动态分段并落成新 mashup_templates 行
  动作: 调 segmentScriptToTemplate（真 Postgres）传一段带钩子/产品/CTA 的文案
  预期观察: 返回 segments（命中 ai_tags 枚举段 fallbackMapped=false）且 mashup_templates 真表新增一行
  等待预算: 0s
  留证: mashup-script-segment.test.ts 运行输出末 5 行（含真表 SELECT 校验）
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-segment.test.ts'

- [ ] [BEHAVIOR] [L2] B-02: AI 服务不可用统一静默降级固定模板，非阻断（INV-4 null契约显式else）
  动作: 注入 callAi 抛错（模拟 timeout/5xx/鉴权/欠费/网络）调 segmentScriptToTemplate
  预期观察: 不抛异常，返回 degraded=true 固定模板，且仍落一行模板（显式 else 处理失败分支）
  等待预算: 0s
  留证: 用例「AI 服务不可用（超时/5xx/鉴权/欠费/网络）统一静默降级固定模板，非阻断」绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-segment.test.ts'

- [ ] [BEHAVIOR] [L2] B-03: targetCount=200 → generatedCount 如实反映实际生成数（≤200），每条候选含 thumbnailUrl
  动作: 真库 seed 一个 run + 多个已打标签素材，调 generateCandidates({targetCount:200})
  预期观察: generatedCount==candidates.length≤200 且>0；每条候选含非空 thumbnailUrl；真表 5min 时间窗行数吻合
  等待预算: 0s
  留证: mashup-candidates-thumbnail.test.ts 运行输出末 5 行
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-candidates-thumbnail.test.ts'

- [ ] [BEHAVIOR] [L2] B-04: 渲染并发上限=1，第二个并发请求进入 queued 且带 queuePosition=1 [接缝×2]
  动作: 第一个渲染占用唯一并发位（卡住不结束），第二个并发提交 enqueueRender
  预期观察: 第一个 status=running，第二个 status=queued 且 queuePosition=1；放行后两者 FIFO 自排空 completed
  等待预算: 5s
  留证: mashup-render-queue.test.ts 用例「第一个渲染 running、第二个并发请求进入 queued 且带 queuePosition=1」绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts'

- [ ] [BEHAVIOR] [L2] B-05: 渲染函数失败 → render_failed 态（非死路，可重试）
  动作: enqueueRender 注入抛错的渲染函数（模拟 ffmpeg exit 1）
  预期观察: done 结果 status=render_failed 且带 reason 字符串（客户可重新渲染/换候选）
  等待预算: 5s
  留证: 用例「渲染函数失败 → done 结果为 render_failed 态（非死路，可重试）」绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts'

- [ ] [BEHAVIOR] [L2] B-06: 素材在线预览重签端点返回可播放 preview_url，跨租户 404、无凭据 401
  动作: 带 X-Upload-Token GET /api/materials/:id/preview-url（本租户 / 非本租户 / 无凭据 三种）
  预期观察: 本租户 200 且 data.preview_url 非空；非本租户 404；无凭据 401（不泄露他人素材）
  等待预算: 0s
  留证: mashup-materials-preview.test.ts 三用例绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-materials-preview.test.ts'

- [ ] [BEHAVIOR] [L2] B-07: 文案解析第三方真调一次（规则B：真 TOAPIS key 真请求真响应）[接缝×2]
  动作: 用真 TOAPIS key 真调 /chat/completions 解析测试文案
  预期观察: 真响应解析出结构化分段数组（含 roleLabel），无 key 时非 0 退出不兜过
  等待预算: 65s
  留证: scripts/real-toapis-segment.mjs stdout（OK: 真 TOAPIS 返回 N 个结构化分段…）
  Test: manual:bash -c 'node sprints/09201034-batch-mashup-script-preview-candidates/scripts/real-toapis-segment.mjs'

- [ ] [BEHAVIOR] [L2] B-08: 空文案 → 抛 INVALID_BODY（error path）
  动作: 调 segmentScriptToTemplate 传 script=''
  预期观察: rejects INVALID_BODY（不落库、不真调 AI）
  等待预算: 0s
  留证: 用例「空文案 → 抛 INVALID_BODY（error path）」绿
  Test: manual:bash -c 'node node_modules/vitest/vitest.mjs run --no-cache sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-script-segment.test.ts'

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e windows_cloud 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path（粘贴文案→在线预览→候选虚拟滚动→选中渲染），截图可视化验证
  Screenshots:
    - staging-01-paste-script.png   期望：粘贴文案后出现动态分段 segments 列表（非固定4段）
    - staging-02-video-preview.png  期望：素材卡片 `<video>` 元素可见并真实播放（真实发出 signedUrl 请求）
    - staging-03-candidate-scroll.png 期望：候选缩略图拼贴虚拟滚动，DOM 节点数与可视区域一致（非200全量）
    - staging-04-render-result.png   期望：选中一条候选后触发真实 ffmpeg 渲染，结果页出现可播放 1080P 成片
  期望：所有截图与期望描述一致，Claude Read 图自验通过；真实 ffmpeg 成片经 ffprobe 验含视频流

## Invariant 覆盖（历史约束三源 · 铁律逐条映射）

- INV-1 [dashboard三件套]: N/A — 本 sprint 修改既有已注册页 MashupPage（navigation/菜单/InstanceContext features 三件套已存在），未新增常驻桌面 UI 页，不触及三件套注册。
- INV-2 [枚举单源]: 覆盖于 B-01（用例断言 aiTag ∈ AI_TAG_VOCAB，AI_TAG_VOCAB 为 apps/api/src/services/ai-tags.ts 单一来源，segment/slot-assignment 共同 import，禁手抄副本）+ ARTIFACT ai-tags.ts。
- INV-3 [付费调用去重]: 覆盖于 B-01（用例「INV-3 付费调用去重：同一文案重复提交只真调一次 AI」——同 script_hash 前置检查）。
- INV-4 [null契约显式else]: 覆盖于 B-02（AI 失败显式 else 走 degraded 固定模板）+ B-05（ffmpeg 失败显式映射 render_failed）。
- INV-5 [字段长度截断]: 覆盖于 B-01（用例「INV-5 字段长度截断：超长文案派生的模板 name 截断到列约束内」，name.length ≤ TEMPLATE_NAME_MAX）。
