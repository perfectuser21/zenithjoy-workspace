# Contract DoD — Staff Hub 员工中心第一刀

## [BEHAVIOR] 条目

[BEHAVIOR] B-1 `apps/staff-hub/src/pages/SkillEvalPage.tsx` 存在，且页面包含 `data-testid="skill-eval-upload"`、`skill-eval-submit`、`skill-eval-report-frame` 三个关键节点。

[BEHAVIOR] B-2 `apps/api/src/routes/staff.ts` 暴露 `GET /api/staff/path-health`，返回 Path1/2/4 三项，且每项包含 `features` 数组与 `smoke.conclusion` 字段。

[BEHAVIOR] B-3 Brain 或 GitHub 数据源失败时，`GET /api/staff/path-health` 仍返回 200，并在对应 Path 项目写入 `availability: "degraded"`。

[BEHAVIOR] B-4 `apps/dashboard/src/config/navigation.config.ts`、`apps/dashboard/src/lib/full-bleed-routes.ts` 不再含 `/staff/skill-eval`。

[BEHAVIOR] B-5 `scripts/check-staff-hub-llm-imports.mjs` 运行通过时输出 `OK`；命中 `openai` / `anthropic` import 时退出非 0。

## manual:bash 可执行验收命令

```bash
manual:bash test -f apps/staff-hub/src/pages/SkillEvalPage.tsx && echo "skill-eval page exists"
manual:bash cd /workspace/apps/api && npx vitest run src/routes/__tests__/staff.test.ts
manual:bash node /workspace/scripts/check-staff-hub-llm-imports.mjs
manual:bash node -e "const fs=require('fs');const c=fs.readFileSync('/workspace/apps/dashboard/src/config/navigation.config.ts','utf8');if(c.includes('/staff/skill-eval'))process.exit(1);console.log('dashboard route removed')"
manual:bash cd /workspace/apps/staff-hub && npm run build
```

## [ARTIFACT] 条目

[ARTIFACT] `apps/staff-hub` — 新独立员工前端应用，含登录页、Skill 验收页、Path 健康页。

[ARTIFACT] `apps/api/src/routes/staff.ts` — 新增 Path 健康聚合逻辑，保留 skill-eval 反代。

[ARTIFACT] `apps/api/src/routes/__tests__/staff.test.ts` — 覆盖 path-health 的正常与降级契约。

[ARTIFACT] `scripts/check-staff-hub-llm-imports.mjs` — Staff Hub 不直连 LLM SDK 机械闸。

## DoD 清单

- [ ] B-1 ~ B-5 通过
- [ ] `apps/staff-hub` 构建通过
- [ ] `apps/api` staff 路由测试通过
- [ ] dashboard 旧入口摘除
- [ ] Staff Hub 无 LLM SDK 直连
