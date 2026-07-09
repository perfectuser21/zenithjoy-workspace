# Contract DoD：ZenithJoy 员工工具中心 + Skill Evaluator 上传页接入

sprint_dir: sprints/07090821-staff-tools-skill-eval
task_id: 23b96c28-cf91-4657-bd26-46cd33837f16
date: 2026-07-09

---

## ARTIFACT 产物存在性

- [ ] [ARTIFACT] `apps/dashboard/src/pages/SkillEvalPage.tsx` 文件存在

  ```
  manual:bash: test -f /workspace/apps/dashboard/src/pages/SkillEvalPage.tsx && echo PASS || echo FAIL
  ```

- [ ] [ARTIFACT] `apps/api/src/middleware/staff.ts` 文件存在

  ```
  manual:bash: test -f /workspace/apps/api/src/middleware/staff.ts && echo PASS || echo FAIL
  ```

- [ ] [ARTIFACT] `apps/api/src/routes/staff.ts` 文件存在

  ```
  manual:bash: test -f /workspace/apps/api/src/routes/staff.ts && echo PASS || echo FAIL
  ```

- [ ] [ARTIFACT] `apps/dashboard/e2e/staff-skill-eval.spec.ts` 文件存在

  ```
  manual:bash: test -f /workspace/apps/dashboard/e2e/staff-skill-eval.spec.ts && echo PASS || echo FAIL
  ```

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/staff-skill-eval-smoke.sh` 文件存在且可执行

  ```
  manual:bash: test -x /workspace/.github/workflows/scripts/smoke/staff-skill-eval-smoke.sh && echo PASS || echo FAIL
  ```

- [ ] [ARTIFACT] smoke-baseline.txt 包含 staff-skill-eval 棘轮条目

  ```
  manual:bash: grep -q "staff-skill-eval" /workspace/.github/workflows/scripts/smoke-baseline.txt && echo PASS || echo FAIL
  ```

---

## BEHAVIOR 行为验收

### FR1 / FR2：isStaff 权限档位

- [ ] [BEHAVIOR] `isStaff=true` 账号登录后，侧边栏「员工工具」分组可见

  覆盖 FR1、FR2、FR3、FR4、FR5

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "staff 账号登录后侧边栏出现" 2>&1 | tail -5
  ```

- [ ] [BEHAVIOR] `isStaff=false`（非白名单邮箱）账号登录后，侧边栏无「员工工具」分组

  覆盖 FR1、FR3、FR5

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "非 staff 账号" 2>&1 | tail -5
  ```

### FR6 / FR7：路由守卫

- [ ] [BEHAVIOR] `isStaff=true` 账号访问 `/staff/skill-eval` 页面正常加载，有文件上传区域

  覆盖 FR6、FR7、FR8

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "staff 账号能访问" 2>&1 | tail -5
  ```

- [ ] [BEHAVIOR] `isStaff=false` 账号直接访问 `/staff/skill-eval` 被重定向回 `/`（前端守卫）

  覆盖 FR7

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "被重定向回" 2>&1 | tail -5
  ```

### FR9：staffGuard 中间件

- [ ] [BEHAVIOR] `POST /api/staff/skill-eval/upload` 不带认证头返回 403

  覆盖 FR9、FR10、FR12

  ```
  manual:bash: STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE:-http://localhost:3000}/api/staff/skill-eval/upload"); [ "$STATUS" = "403" ] && echo PASS || echo "FAIL: got $STATUS"
  ```

- [ ] [BEHAVIOR] `GET /api/staff/skill-eval/status/:jobId` 不带认证头返回 403

  覆盖 FR9、FR11、FR12

  ```
  manual:bash: STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE:-http://localhost:3000}/api/staff/skill-eval/status/test-job-id"); [ "$STATUS" = "403" ] && echo PASS || echo "FAIL: got $STATUS"
  ```

- [ ] [BEHAVIOR] `STAFF_EMAILS` 环境变量未设置时，staffGuard 对所有 staff 端点返回 403（不放行）

  覆盖 FR9、N4

  ```
  manual:bash: STATUS=$(STAFF_EMAILS="" curl -s -o /dev/null -w "%{http_code}" -H "X-User-Email: anyone@test.com" -X POST "${API_BASE:-http://localhost:3000}/api/staff/skill-eval/upload"); [ "$STATUS" = "403" ] && echo PASS || echo "FAIL: got $STATUS"
  ```

- [ ] [BEHAVIOR] 带有白名单 `X-User-Email` 头的 POST `/api/staff/skill-eval/upload` 请求不返回 403

  覆盖 FR9、FR10

  ```
  manual:bash: STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "X-User-Email: ${STAFF_TEST_EMAIL:-staff@test.com}" -X POST "${API_BASE:-http://localhost:3000}/api/staff/skill-eval/upload"); [ "$STATUS" != "403" ] && echo "PASS: got $STATUS (proxied)" || echo "FAIL: got 403 for staff email"
  ```

### FR8：SkillEvalPage 页面功能

- [ ] [BEHAVIOR] SkillEvalPage 上传 zip 失败时展示错误提示，不永久转圈

  覆盖 FR8、N1

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "上传失败" 2>&1 | tail -5
  ```

- [ ] [BEHAVIOR] 轮询超过 60s 未返回 completed 时展示「评测服务暂不可用」提示

  覆盖 FR8、N2

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "超时" 2>&1 | tail -5
  ```

- [ ] [BEHAVIOR] 后端代理超时（504）时前端展示友好错误信息

  覆盖 FR8、N3

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "504" 2>&1 | tail -5
  ```

### FR13：Playwright E2E 全链路

- [ ] [BEHAVIOR] staff 账号完整 Golden Path：登录 → 侧栏「员工工具」→「Skill 评测上传」→ 上传 zip → 轮询 → 展示报告

  覆盖 FR13

  ```
  manual:bash: cd /workspace && npx playwright test apps/dashboard/e2e/staff-skill-eval.spec.ts --grep "完整 Golden Path" 2>&1 | tail -10
  ```

---

## 代码结构检查

- [ ] [BEHAVIOR] `navigation.config.ts` 中存在 `requireStaff` 字段且「员工工具」分组已配置

  覆盖 FR3、FR5

  ```
  manual:bash: grep -n "requireStaff" /workspace/apps/dashboard/src/config/navigation.config.ts | head -10
  ```

- [ ] [BEHAVIOR] `AuthContext.tsx` 暴露 `isStaff` boolean 字段

  覆盖 FR2

  ```
  manual:bash: grep -n "isStaff" /workspace/apps/dashboard/src/contexts/AuthContext.tsx | head -5
  ```

- [ ] [BEHAVIOR] `DynamicSidebar.tsx` 把 `isStaff` 传入 `filterNavGroups`

  覆盖 FR4

  ```
  manual:bash: grep -n "isStaff" /workspace/apps/dashboard/src/components/DynamicSidebar.tsx | head -5
  ```

- [ ] [BEHAVIOR] `app.ts` 注册了 staff router（`/api/staff`）

  覆盖 FR10、FR11

  ```
  manual:bash: grep -n "staff" /workspace/apps/api/src/app.ts | head -5
  ```

---

## FR 覆盖矩阵

| FR | 覆盖条目 |
|---|---|
| FR1 | BEHAVIOR: isStaff=true 侧边栏可见、isStaff=false 侧边栏不可见、ARTIFACT: AuthContext.tsx |
| FR2 | BEHAVIOR: AuthContext isStaff 字段检查 |
| FR3 | BEHAVIOR: navigation.config.ts requireStaff 字段检查 |
| FR4 | BEHAVIOR: DynamicSidebar 传 isStaff |
| FR5 | BEHAVIOR: 侧边栏「员工工具」分组可见 / 不可见 |
| FR6 | BEHAVIOR: staff 账号访问 /staff/skill-eval 正常加载 |
| FR7 | BEHAVIOR: 非 staff 账号被重定向回 / |
| FR8 | BEHAVIOR: 上传失败错误提示、超时提示、504 友好错误、Golden Path |
| FR9 | BEHAVIOR: 不带认证头 POST/GET 返回 403、STAFF_EMAILS 未设置返回 403 |
| FR10 | BEHAVIOR: POST /api/staff/skill-eval/upload 403 检查、staff 邮件头通过检查 |
| FR11 | BEHAVIOR: GET /api/staff/skill-eval/status/:jobId 403 检查 |
| FR12 | ARTIFACT: smoke.sh 文件存在、BEHAVIOR: curl 403 验证 |
| FR13 | BEHAVIOR: 完整 Golden Path Playwright E2E |
