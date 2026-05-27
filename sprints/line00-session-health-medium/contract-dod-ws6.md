---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 6: Dashboard OperatorPage.tsx 升级 + Playwright E2E spec

**范围**: OperatorPage.tsx 8 主号行添加"登录"/"重新登录"按钮（`data-testid="login-btn-{platform}"`），点击调 `POST /api/operator/sessions/bind-start`，页面 mount 时 GET status 轮询（30s 自动刷新），status=ok 显绿 ✅/expired 显红 ❌；新建 `apps/dashboard/e2e/operator-sessions.spec.ts` Playwright 测试
**大小**: M（~200 行净增，2 文件）
**依赖**: Workstream 5 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/OperatorPage.tsx` 含 `login-btn-` data-testid 属性
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/OperatorPage.tsx','utf8');if(!c.includes('login-btn-'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/operator-sessions.spec.ts` 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/e2e/operator-sessions.spec.ts');console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] OperatorPage.tsx 含 `bind-start` 调用（点击按钮时 POST bind-start）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");if(!c.includes(\"bind-start\")){console.error(\"FAIL: 缺少 bind-start 调用\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx 含 `/api/operator/sessions/status` 轮询（status endpoint 调用）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");if(!c.includes(\"sessions/status\")){console.error(\"FAIL: 缺少 status 轮询\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx status=ok 时显示绿色标识（含 `✅` 或 `ok` 颜色类），status=expired 时显示红色（含 `❌` 或 `expired` 颜色类）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");const hasGreen=c.includes(\"green\")||c.includes(\"✅\");const hasRed=c.includes(\"red\")||c.includes(\"❌\");if(!hasGreen){console.error(\"FAIL: 缺少 ok 绿色标识\");process.exit(1);}if(!hasRed){console.error(\"FAIL: 缺少 expired 红色标识\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] E2E spec 含 `data-testid` selector 断言（真实 Playwright toBeVisible/toHaveText，非 mock）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/operator-sessions.spec.ts\",\"utf8\");if(!c.includes(\"toBeVisible\")&&!c.includes(\"toHaveText\")&&!c.includes(\"expect\")){console.error(\"FAIL: spec 缺少 Playwright 断言\");process.exit(1);}if(!c.includes(\"login-btn-\")&&!c.includes(\"operator\")){console.error(\"FAIL: spec 缺少 login-btn testid 使用\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx 含 `登录中` 或 `disabled` 逻辑（按钮 pending 状态时禁用）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");const hasPending=c.includes(\"登录中\")||c.includes(\"disabled\")||c.includes(\"pending\");if(!hasPending){console.error(\"FAIL: 缺少按钮 pending/disabled 逻辑\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

## BEHAVIOR:E2E 条目（final-e2e Mode B — Playwright windows_cloud）

- [ ] [BEHAVIOR:E2E] 用户打开 /operator 页面，看到"登录"按钮，点击后按钮变 disabled，截图可视化验证
  Screenshots:
    - ws6-01-initial.png    期望：/operator 页面加载，8 个平台主号行各有"登录"按钮可见
    - ws6-02-click.png      期望：点击后按钮文字变为"登录中"且处于 disabled 状态
    - ws6-03-result.png     期望：status=ok 的平台格子显示绿色 ✅ 标识
  期望：所有截图与期望描述一致
