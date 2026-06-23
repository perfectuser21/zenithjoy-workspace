---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 客服配置写接口安全闸（管理员 + 租户隔离）+ 管理员前台补全

**范围**: `/cs/config` `/cs/setup` `/cs/auto-agent` 三个写接口挂 tenantContext + 管理员角色闸 + 租户隔离（越权 403/404 不写库，deny by default）；前台 `PerCsConfigPage`/`CsOneClickSetupPage` 补营业时间 start/end + daily_limit 输入，非管理员只读；新增 `GET /cs/my-role` 供前台渲染只读态。不新增表、不改 `wechat_cs_account_config` 结构、不动中台全局 NFR。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 写接口挂上 tenantContext + 管理员角色闸（wechat-config.ts 三个 PUT 路由前置中间件）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/wechat-config.ts','utf8');if(!/tenantContext/.test(c)||!/NOT_ADMIN/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 永久 regression 测试落 apps/api/tests/regression/（CLAUDE.md：修 bug 的 test 必须 commit 进 repo 永久留 CI）
  Test: node -e "const c=require('fs').readFileSync('apps/api/tests/regression/line04-cs-config-permission.test.ts','utf8');if(!/CROSS_TENANT|NOT_ADMIN/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 前台补营业时间 + 每日上限输入框（PerCsConfigPage 新 testid）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/PerCsConfigPage.tsx','utf8');if(!/cs-business-hours-start/.test(c)||!/cs-daily-limit/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 前台非管理员只读提示（cs-readonly-notice + my-role 消费）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/PerCsConfigPage.tsx','utf8');if(!/cs-readonly-notice/.test(c)||!/my-role/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 2-job E2E workflow（ubuntu 后端 + windows Playwright）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-line04-cs-config-permission.yml','utf8');if(!/ubuntu-latest/.test(c)||!/windows-latest/.test(c)||!/e2e-backend-verify\.sh/.test(c)||!/e2e-ui-verify\.ps1/.test(c))process.exit(1)"

## BEHAVIOR 条目（模式A — evaluator 直接跑；oracle = vitest 退出码，supertest 断言真实 HTTP 状态码 + 写库 store 0 调用）

- [ ] [BEHAVIOR] member（非管理员）PUT /cs/config/:wechatId → 403 NOT_ADMIN 且绝不写库（核心安全断言，钉死 Issue 96db53be）
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "member PUT /cs/config/:wechatId → 403 NOT_ADMIN 且绝不调 saveCSConfig" --reporter=basic'
  期望: exit 0（403 + error.code==NOT_ADMIN + saveCSConfig 0 调用）

- [ ] [BEHAVIOR] 本租户 admin PUT /cs/config/:wechatId → 200 且写该行（happy path）
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "admin 同租户 PUT /cs/config/:wechatId → 200 且调 saveCSConfig 写该行" --reporter=basic'
  期望: exit 0（200 + saveCSConfig 被调 1 次且首参==wechatId）

- [ ] [BEHAVIOR] 跨租户 admin（A 改 B 的客服）→ 403/404 且绝不写库（租户隔离）
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "跨租户 admin PUT /cs/config/:wechatId（A 改 B 的客服）→ 403 CROSS_TENANT 且绝不写库" --reporter=basic'
  期望: exit 0（403/404 + saveCSConfig 0 调用）

- [ ] [BEHAVIOR] 无 session → 401 且绝不写库
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "无身份 PUT /cs/config/:wechatId → 401 且绝不写库" --reporter=basic'
  期望: exit 0（401 + saveCSConfig 0 调用）

- [ ] [BEHAVIOR] deny by default — 目标客服解析不到租户 → 404 TARGET_NOT_FOUND 且不写库；当前用户无租户 → 403 NO_TENANT 且不写库
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "目标客服解析不到所属租户" -t "当前用户无租户关联" --reporter=basic'
  期望: exit 0（404 TARGET_NOT_FOUND + 403 NO_TENANT，两者 0 写库）

- [ ] [BEHAVIOR] 第二、三个写接口同样挂闸 — member PUT /cs/setup/:machineId 与 /cs/auto-agent → 403 且 0 写库
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "member PUT /cs/setup/:machineId" -t "member PUT /cs/auto-agent" --reporter=basic'
  期望: exit 0（两接口 member 403，setupCSByMachine / saveAutoAgentConfig 0 调用）

- [ ] [BEHAVIOR] error path — 既有 zod body 校验保持不变：admin 合法身份传空 persona → 400 INVALID_BODY（不被新闸吞掉，也不误判 403）
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts -t "INVALID_BODY" --reporter=basic'
  期望: exit 0（generator 补「admin 合法身份 + 空 persona → 400 error==INVALID_BODY」用例；无此用例时 vitest 默认 passWithNoTests=false → 非0退出 = 真红）

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — windows Playwright，截图存 SPRINT_DIR/screenshots/）

- [ ] [BEHAVIOR:E2E] 管理员/非管理员走完客服配置 Golden Path，截图可视化验证
  Screenshots:
    - 01-admin-initial.png   期望：管理员态打开 /wechat/per-cs-config，营业时间 start/end + 每日上限输入框可见且可编辑
    - 02-admin-saved.png     期望：填营业时间 09:00 + 每日上限 50 点保存后，cs-save-success 成功提示可见
    - 03-member-readonly.png 期望：member 态打开同页，cs-readonly-notice 显示「仅管理员可配置」，保存按钮 + 输入框 disabled
  路径格式：sprints/06232248-line04-cs-config-permission/screenshots/<step>.png
  期望：所有截图与期望描述一致，Claude Read 图自验通过；PUT body 含 business_hours_start=09:00 + daily_limit=50
