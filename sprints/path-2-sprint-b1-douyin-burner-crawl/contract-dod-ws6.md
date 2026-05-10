---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 6: smoke 脚本 + CI workflow + fake-feishu-server seen-records 增量

**范围**: 落地合同 E2E 段 + CI 启停 fake servers + Path 1/Sprint A 隔离断言
**大小**: M
**依赖**: WS3 + WS4 + WS5

## ARTIFACT 条目

- [ ] [ARTIFACT] golden-path-2-b1-smoke.sh 存在 + 可执行
  Test: `bash -c "[ -x .github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh ]"`

- [ ] [ARTIFACT] smoke 脚本头部含 4 ENV 自检（API_BASE / DB / FEISHU_API_BASE / SMOKE_TOKEN）
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh','utf8');['API_BASE','DB','FEISHU_API_BASE','SMOKE_TOKEN'].forEach(k=>{if(!new RegExp('\\\\\\\\[\\\\s-z]\\\\\\\\$\\\\{?'+k+'[:-]').test(c)&&!c.includes('-z \"${'+k))process.exit(1)})"`

- [ ] [ARTIFACT] smoke 脚本含 10 个 Step 标识
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh','utf8');for(let i=1;i<=10;i++){if(!c.includes('Step '+i))process.exit(1)}"`

- [ ] [ARTIFACT] smoke 脚本所有 SELECT count 含时间窗口（防造假通过）
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh','utf8');const lines=c.split('\\n');const bad=lines.filter(l=>/SELECT count\\(/.test(l)&&!/interval\\s+'/.test(l));if(bad.length>0){console.error('SELECT count 缺时间窗口:',bad);process.exit(1)}"`

- [ ] [ARTIFACT] smoke 脚本 curl 用 -fsS（HTTP 5xx 才返非 0）
  Test: `node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh','utf8');const lines=c.split('\\n');const naked=lines.filter(l=>/^[^#]*\\bcurl\\b/.test(l)&&!/\\-fsS|\\-s\\b.*\\-w|\\-X.*\\-w/.test(l));if(naked.length>2){console.error('裸 curl >2 行:',naked.length);process.exit(1)}"`

- [ ] [ARTIFACT] CI workflow yaml 启停 fake-feishu-server + export FEISHU_API_BASE / SMOKE_TOKEN / NODE_ENV=test
  Test: `bash -c "ls .github/workflows/path-2-b1*.yml .github/workflows/path-2-smoke.yml 2>/dev/null | head -1 | xargs -I{} grep -lE 'fake-feishu-server.*&|FEISHU_API_BASE.*localhost:3099|SMOKE_TOKEN' {}"`

- [ ] [ARTIFACT] fake-feishu-server.ts 含 seen-records 内存 store + /__test/seen-records 端点
  Test: `node -e "const c=require('fs').readFileSync('apps/api/test-utils/fake-feishu-server.ts','utf8');['__test/seen-records','seenRecords','table_id'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] 禁止文件未修改（git diff 断言 6 个文件）
  Test: `bash -c "git diff origin/main...HEAD --name-only | grep -E '^(services/agent/src/handlers/qr-bind-douyin\\.ts|apps/api/src/services/feishu-bitable-multitenant\\.ts|apps/api/src/services/feishu-token\\.ts|apps/api/src/routes/feishu-oauth\\.ts|apps/dashboard/src/pages/FeishuBindTenant\\.tsx|apps/dashboard/src/pages/DouyinBindPage\\.tsx)$' && exit 1 || exit 0"`

- [ ] [ARTIFACT] test-registry.yaml 注册 9 contract entries（指 sprints/.../tests/wsN/，status=pending-ci，satisfy orphan-test-check）
  Test: `node -e "const y=require('fs').readFileSync('test-registry.yaml','utf8');['p2-sprint-b1-contract-ws1-migration','p2-sprint-b1-contract-ws2-burner-handler','p2-sprint-b1-contract-ws2-comment-crawl','p2-sprint-b1-contract-ws3-routes','p2-sprint-b1-contract-ws3-fake-agent','p2-sprint-b1-contract-ws4-lead-writer','p2-sprint-b1-contract-ws5-burner-bind-page','p2-sprint-b1-contract-ws6-smoke-structure','p2-sprint-b1-contract-ws7-self-test-structure'].forEach(k=>{if(!y.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] test-registry.yaml 注册 9 落点 entries（指 CI 实跑路径 apps/api/tests/p2-sprint-b1-wsN/ 等，status=active，satisfy lint-test-pairing 让 src 文件有配对 test）
  Test: `node -e "const y=require('fs').readFileSync('test-registry.yaml','utf8');['p2-sprint-b1-ws1-migration','p2-sprint-b1-ws2-burner-handler','p2-sprint-b1-ws2-comment-crawl','p2-sprint-b1-ws3-routes','p2-sprint-b1-ws3-fake-agent','p2-sprint-b1-ws4-lead-writer','p2-sprint-b1-ws5-burner-bind-page','p2-sprint-b1-ws6-smoke-structure','p2-sprint-b1-ws7-self-test-structure'].forEach(k=>{if(!y.includes(k))process.exit(1)})"`

## BEHAVIOR 索引（实际测试在 tests/ws6/）

见 `tests/ws6/smoke-script-structure.test.ts`：
- 脚本前 30 行含 4 ENV 自检
- 脚本含 10 个 Step 标识
- 所有 SELECT count 含 interval 时间窗口
- curl 行数 vs -fsS 行数比 >= 80%
- fake-feishu-server seen-records 端点收到 records 后能 GET 出 count
