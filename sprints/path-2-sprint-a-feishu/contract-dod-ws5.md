---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: golden-path-2-smoke.sh + Lead 自验证据 + Path 1 隔离

**范围**:
- 写 `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`（合同 E2E 段全文落地）
- 写 DEV-only helper `apps/api/src/routes/_smoke-feishu-seed.ts`（NODE_ENV + token 双门禁）
- 写 `.agent-knowledge/path-2/lead-acceptance-sprint-a.md`（Lead 真飞书自验证据）
- Path 1 隔离断言（git diff 拒禁文件）
**大小**: M
**依赖**: WS3 + WS4

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` 文件存在 + 可执行 (chmod +x)
  Test: `bash -c "test -x .github/workflows/scripts/smoke/golden-path-2-smoke.sh"`

- [ ] [ARTIFACT] smoke 脚本含 8 步标记 + Step 1-4 PRD 阈值线
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-smoke.sh','utf8');['Step 1','Step 2','Step 3','Step 4','tenant_feishu_bindings','tenant_access_token','app_token','authorize_url'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] smoke 脚本所有 SELECT count 含时间窗口（防造假）
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-smoke.sh','utf8');const counts=(c.match(/SELECT\\s+count/gi)||[]).length;const windowed=(c.match(/NOW\\(\\)\\s*-\\s*interval/gi)||[]).length;if(counts>0&&windowed<counts)process.exit(1)"`

- [ ] [ARTIFACT] smoke 脚本所有 curl 用 -fsS（HTTP 5xx 才 exit 非 0）
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-smoke.sh','utf8');const lines=c.split('\\n').filter(l=>/^\\s*(RESP|RESP_CODE|BIND_COUNT|REFRESHED).*=.*curl/.test(l)||/^\\s*curl /.test(l));const bad=lines.filter(l=>!/-fsS|-s\\s+-o|-f /.test(l));if(bad.length>0){console.error(bad);process.exit(1)}"`

- [ ] [ARTIFACT] DEV helper `apps/api/src/routes/_smoke-feishu-seed.ts` 存在 + 含 NODE_ENV 守卫 + X-Smoke-Token 守卫
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/_smoke-feishu-seed.ts','utf8');['NODE_ENV','X-Smoke-Token','production'].forEach(k=>{if(!c.includes(k))process.exit(1)});if(!/NODE_ENV.*production|production.*NODE_ENV/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] DEV helper 路由内含 `router.post('/feishu-seed'` 子路径
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/_smoke-feishu-seed.ts','utf8');if(!/router\\.post\\(['\"]\\/feishu-seed['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] app.ts 挂载 `/api/_smoke` 前缀 + 引入 smokeFeishuSeedRouter
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8');if(!c.includes('/api/_smoke')||!/smoke.*[Ss]eed.*[Rr]outer|_smoke.*feishu/s.test(c))process.exit(1)"`

- [ ] [ARTIFACT] DEV helper 调业务层（不直接 INSERT DB），保留飞书层调用链
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/_smoke-feishu-seed.ts','utf8');if(/INSERT INTO|psql -c/.test(c))process.exit(1);if(!/feishu-bitable-multitenant|writeRecord|provisionBitable|fetchLeadConfig/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `.agent-knowledge/path-2/lead-acceptance-sprint-a.md` 存在 + size > 1KB + 含 PASS YAML + 5+ Step
  Test: `bash -c "test -f .agent-knowledge/path-2/lead-acceptance-sprint-a.md && [ \"\$(wc -c < .agent-knowledge/path-2/lead-acceptance-sprint-a.md)\" -gt 1024 ] && grep -q 'lead_acceptance_status: PASS' .agent-knowledge/path-2/lead-acceptance-sprint-a.md && [ \"\$(grep -cE '^### Step [1-9]' .agent-knowledge/path-2/lead-acceptance-sprint-a.md)\" -ge 5 ]"`

- [ ] [ARTIFACT] Path 1 隔离：本 sprint 不修改 `services/agent/src/handlers/qr-bind-douyin.ts`
  Test: `bash -c "[ \"\$(git diff --name-only origin/main...HEAD -- services/agent/src/handlers/qr-bind-douyin.ts | wc -l | tr -d ' ')\" = \"0\" ]"`

- [ ] [ARTIFACT] Path 1 隔离：本 sprint 不修改 `apps/api/src/services/feishu-bitable.ts`（单租户原版保留）
  Test: `bash -c "[ \"\$(git diff --name-only origin/main...HEAD -- apps/api/src/services/feishu-bitable.ts | wc -l | tr -d ' ')\" = \"0\" ]"`

- [ ] [ARTIFACT] Path 1 隔离：本 sprint 不动 `agent_platform_sessions` schema
  Test: `bash -c "! git diff origin/main...HEAD -- 'apps/api/db/migrations/*.sql' | grep -qE 'agent_platform_sessions'"`

- [ ] [ARTIFACT] Path 1 隔离：本 sprint 不修改 `apps/dashboard/src/pages/DouyinBindPage.tsx`
  Test: `bash -c "[ \"\$(git diff --name-only origin/main...HEAD -- apps/dashboard/src/pages/DouyinBindPage.tsx | wc -l | tr -d ' ')\" = \"0\" ]"`

## BEHAVIOR 索引（实际测试在 tests/ws5/）

见 `tests/ws5/path1-isolation.test.ts`，覆盖：
- DEV helper 端点在 `NODE_ENV=production` 下返回 404
- DEV helper 端点缺 `X-Smoke-Token` 头返回 403
- DEV helper 端点 token 错误返回 403
- DEV helper 端点 token + dev env 双满足返回 200 + 写入飞书
- smoke 脚本 dry-run（API_BASE=http://localhost:1，DB=空 DB）下任一步 fail 即 exit 非 0
