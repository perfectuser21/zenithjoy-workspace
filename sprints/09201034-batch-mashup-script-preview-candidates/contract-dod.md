---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 批量混剪加厚（文案动态分段 + 素材在线预览 + 候选200+可视化）

**范围**: ①`POST /api/mashup/templates/from-script` 文案→动态分段模板 ②素材在线预览 preview_url + 前端 `<video>` ③候选生成加 `thumbnailUrls` + `generatedCount` 诚实计数 + 前端虚拟滚动 ④渲染改异步作业（并发=1 队列 + `render_failed` 态）。**不含**：方向四候选内剪辑、内容安全逻辑改动、声音克隆。
**大小**: L

> **oracle 说明**：DB-heavy 行为的可执行 oracle 以冻结脚本 `tests/oracles/*.mjs` 承载（避免 Test 单行嵌套引号出错）；evaluator 直接 `node` 跑，脚本内含真 pool 真断言，实现缺失时 RED。轻量行为直接单行 node/psql。深层全链路见 contract-draft.md `## E2E 验收`。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增 migration 建 `mashup_render_jobs` 表 + `materials.thumbnail_key` 列
  Test: node -e "const c=require('fs').readdirSync('apps/api/db/migrations').filter(f=>f.includes('mashup')&&/2026092/.test(f));if(!c.length)process.exit(1)"

- [ ] [ARTIFACT] Step1 文案分段服务文件存在且导出 generateTemplateFromScript
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/mashup-script-template.ts','utf8');if(!c.includes('generateTemplateFromScript'))process.exit(1)"

- [ ] [ARTIFACT] Step4 渲染队列服务文件存在且导出 enqueueRender（并发上限=1）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/mashup-render-queue.ts','utf8');if(!c.includes('enqueueRender'))process.exit(1)"

- [ ] [ARTIFACT] mashup 路由挂上 from-script 与 render-jobs 端点
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/mashup.ts','utf8');if(!c.includes('templates/from-script')||!c.includes('render-jobs'))process.exit(1)"

## BEHAVIOR 条目（五行剧本 — 内嵌 manual: 单行命令，evaluator 真跑）

- [ ] [BEHAVIOR] [L2] B-01: 粘贴文案→生成动态分段模板，AI 不可用时静默降级固定模板且非阻断（INV-4 + INV-2）
  动作: 无 TOAPIS key 时调用 generateTemplateFromScript({tenantId, script})
  预期观察: 返回 200 形态对象含 templateId + segments[≥1] + fallbackUsed=true；mashup_templates 新增 1 行 tenant_id=凭据租户；该租户无 failed_pending_review 记录（不阻断）
  等待预算: 0s
  留证: 命令 stdout（含 templateId + fallbackUsed）+ psql 行数输出
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s1-fallback.mjs'

- [ ] [BEHAVIOR] [L2] B-02: 空 script 被拒绝，不触碰 DB（error path）
  动作: 调用 generateTemplateFromScript 传空字符串 script
  预期观察: 抛出/返回 INVALID_BODY 语义错误（拒绝），不落任何模板行
  等待预算: 0s
  留证: 命令 stdout（reject 信息）
  Test: manual:bash -c 'node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s1-empty.mjs'

- [ ] [BEHAVIOR] [L2] B-03: 素材在线预览 URL 可签出（前端 `<video>` 数据源）
  动作: 对素材 storage_key 调用 storage.getSignedUrl
  预期观察: 返回非空 string URL（materials 列表 preview_url 的数据源）
  等待预算: 0s
  留证: 命令 stdout（URL 前缀）
  Test: manual:bash -c 'node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s2-preview.mjs'

- [ ] [BEHAVIOR] [L2] B-04: 候选生成诚实计数——generatedCount == candidates.length == DB落库数 且 ≤ targetCount，不凑数（INV-1）
  动作: 对 run 调用 generateCandidates(targetCount=200)，核对 generatedCount 字段与三方恒等
  预期观察: 返回含 generatedCount(number)，与 candidates.length、DB 落库数三方一致且 ≤200（不放大/不承诺死数字）
  等待预算: 0s
  留证: 命令 stdout（generatedCount + DB count）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s3-honest.mjs'

- [ ] [BEHAVIOR] [L2] B-05: 候选带 thumbnailUrls + generatedCount == candidates.length == DB落库数（Step3 缩略图 + 诚实计数）
  动作: 从仓库根运行 sprint HTTP 契约集成测试（真 pool，seed tagged 素材 + 生成候选）
  预期观察: 每条候选含 thumbnailUrls[≥1]；generatedCount 三方一致；被用素材 thumbnail_key 已缓存
  等待预算: 0s（测试内含真实执行）
  留证: vitest 输出末 5 行（PASS）
  Test: manual:bash -c 'npx vitest run sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-http-contract.integration.test.ts --no-cache 2>&1 | tail -5'

- [ ] [BEHAVIOR] [L2] B-06: 选中候选→真实渲染并发上限=1，第 2 个并发请求进排队态 queued 第 N 位 [接缝×2]
  动作: 直接 SQL seed run+2 候选，Promise.all 并发两次 enqueueRender
  预期观察: 两个返回里至少 1 个 renderStatus=queued 且 queuePosition≥1（并发=1 生效）
  等待预算: 30s
  留证: 命令 stdout（两作业 renderStatus + queuePosition）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s4-concurrency.mjs'

- [ ] [BEHAVIOR] [L2] B-07: 渲染失败→render_failed 态可重试，且安全未过 fail-closed 无 export_url（PRD Step4 + INV-3）[接缝×2]
  动作: seed 候选，enqueueRender 用不可达素材源触发渲染失败，within 60s 轮询作业终态
  预期观察: 作业落 render_failed（客户可再 POST render 重试）；对应 contents.safety_check_status!=passed 时 export_url 为 NULL
  等待预算: 60s
  留证: 命令 stdout（作业终态 + export_url NULL 断言）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s4-failed.mjs'

- [ ] [BEHAVIOR] [L2] B-08: migration 生效——mashup_render_jobs 表 + materials.thumbnail_key 列就位
  动作: 空库跑 migration 后 psql 查表/列
  预期观察: mashup_render_jobs 表存在且 materials.thumbnail_key 列存在
  等待预算: 0s
  留证: psql 输出（t / 1）
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT (to_regclass('"'"'zenithjoy.mashup_render_jobs'"'"') IS NOT NULL) AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'materials'"'"' AND column_name='"'"'thumbnail_key'"'"')" | grep -qx t'

- [ ] [BEHAVIOR] [L1] B-09: 前端 PickStep 素材卡片渲染 `<video>` + 候选虚拟滚动 DOM 节点数远小于候选总数
  动作: dashboard jsdom 组件测试渲染 PickStep 素材卡片与候选墙
  预期观察: 素材卡片含 `<video src=preview_url>`；候选墙给 200 条时渲染 DOM 节点数 << 200（虚拟滚动）
  等待预算: 0s
  留证: vitest 输出末 5 行（PASS）
  Test: manual:bash -c '(cd apps/dashboard && npx vitest run src/pages/__tests__/MashupPage.thickening.test.tsx --no-cache 2>&1 | tail -5)'

## Invariant 覆盖（铁律映射）

- [ ] [BEHAVIOR] INV-1 [诚实展示] generatedCount == 去重后 candidates.length == DB落库数（决策 3ed368c3）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s3-honest.mjs'
- [ ] [BEHAVIOR] INV-2 [租户隔离无乐观锁] from-script 模板 tenant_id=凭据租户（B-01 覆盖 tenant 断言）；不引入乐观锁列/字段（决策 436b6ad5）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s1-fallback.mjs'
- [ ] [BEHAVIOR] INV-3 [安全Gate不动] 渲染安全未过时 export_url NULL（B-07 覆盖 fail-closed 断言）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s4-failed.mjs'
- [ ] [BEHAVIOR] INV-4 [Step1非阻断] AI 不可用降级 fallbackUsed=true，禁止落 failed_pending_review（B-01 覆盖非阻断断言）
  Test: manual:bash -c 'DATABASE_URL="$DB_URL" node sprints/09201034-batch-mashup-script-preview-candidates/tests/oracles/s1-fallback.mjs'
