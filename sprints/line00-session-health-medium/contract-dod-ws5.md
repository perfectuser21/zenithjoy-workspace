---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: 后端 API operator-sessions.ts

**范围**: 新建 `apps/api/src/routes/operator-sessions.ts`，含三个端点：`POST /api/operator/sessions/bind-start`（dispatch qr_bind task）、`POST /api/operator/sessions/upload-cookies`（Octokit 写 GitHub Secret）、`GET /api/operator/sessions/status`（返回平台状态数组）；并在 `apps/api/src/index.ts`（或 server 入口）中注册路由。
**大小**: M（~170 行净增，2 文件）
**依赖**: Workstream 4 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/operator-sessions.ts` 文件存在
  Test: node -e "require('fs').accessSync('apps/api/src/routes/operator-sessions.ts');console.log('OK')"

- [ ] [ARTIFACT] operator-sessions.ts 含三个路由定义（bind-start、upload-cookies、status）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');if(!c.includes('bind-start')||!c.includes('upload-cookies')||!c.includes('status'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] API server 入口含 operator-sessions 路由注册（Risk 3 mitigation）
  Test: node -e "const f=['apps/api/src/index.ts','apps/api/src/app.ts','apps/api/src/server.ts'];const fs=require('fs');let found=false;for(const p of f){if(!fs.existsSync(p))continue;if(fs.readFileSync(p,'utf8').includes('operator-sessions')){found=true;break;}}if(!found){console.error('FAIL: 路由未注册到 API server');process.exit(1);}console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] bind-start 路由 response schema 含 `ok`/`taskId` 字段（PRD 字面 key）；禁用字段 id/task/result/data 不出现
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"taskId\")){console.error(\"FAIL: 缺少 taskId\");process.exit(1);}const bad=[\"id\",\"task\",\"result\",\"data\"];let fail=false;for(const b of bad){if(new RegExp(\"[\\x27\\\"]\"+b+\"[\\x27\\\"]\\\\s*:\").test(c)){console.error(\"FAIL: 禁用字段 \"+b+\" 出现作为 response key\");fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] upload-cookies response schema 含 `ok`/`secretName`/`updatedAt`（PRD 字面 key）；禁用字段全量（msg/result/updated/at/message/timestamp/time/secret/key/name）不出现
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"secretName\")){console.error(\"FAIL: 缺少 secretName\");process.exit(1);}if(!c.includes(\"updatedAt\")){console.error(\"FAIL: 缺少 updatedAt\");process.exit(1);}const bad=[\"msg\",\"result\",\"updated\",\"at\",\"message\",\"timestamp\",\"time\",\"secret\",\"name\"];let fail=false;for(const b of bad){if(new RegExp(\"[\\x27\\\"]\"+b+\"[\\x27\\\"]\\\\s*:\").test(c)){console.error(\"FAIL: 禁用字段 \"+b+\" 出现作为 response key\");fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] upload-cookies keys 完整性 — success response 构造仅含 ok/secretName/updatedAt（无多余字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");const required=[\"ok\",\"secretName\",\"updatedAt\"];for(const r of required){if(!c.includes(r)){console.error(\"FAIL: keys 缺失 \"+r);process.exit(1);}}const extra=[\"timestamp\",\"message\",\"msg\",\"result\",\"updated\",\"at\"];let fail=false;for(const e of extra){if(new RegExp(\"[\\x27\\\"]\"+e+\"[\\x27\\\"]\\\\s*:\").test(c)){console.error(\"FAIL: 多余 key \"+e+\" 出现，keys 不完整\");fail=true;}}if(fail)process.exit(1);console.log(\"OK: upload-cookies keys == [ok, secretName, updatedAt]\")"'
  期望: OK: upload-cookies keys == [ok, secretName, updatedAt]

- [ ] [BEHAVIOR] GH_SECRETS_WRITE_PAT 未配置时 upload-cookies 返回 5xx + `{error: "..."}` error path（非 message/msg 字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"GH_SECRETS_WRITE_PAT\")){console.error(\"FAIL: 缺少 GH_SECRETS_WRITE_PAT 检查\");process.exit(1);}if(!/50[03]/.test(c)){console.error(\"FAIL: 缺少 5xx 状态码（500 或 503）\");process.exit(1);}if(!c.includes(\"\\x27error\\x27\")&&!c.includes(\"\\\"error\\\"\")){console.error(\"FAIL: 错误响应未用 error 字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] status endpoint response 每项含 `platform`/`secretName`/`checkedAt` 字段（PRD 字面 key）；禁用 status 枚举值 healthy/active/inactive/good 不出现
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"platform\")){console.error(\"FAIL: status 端点缺少 platform\");process.exit(1);}if(!c.includes(\"secretName\")){console.error(\"FAIL: status 端点缺少 secretName\");process.exit(1);}if(!c.includes(\"checkedAt\")){console.error(\"FAIL: status 端点缺少 checkedAt\");process.exit(1);}const bad=[\"healthy\",\"active\",\"inactive\",\"good\"];let fail=false;for(const b of bad){if(new RegExp(\"[\\x27\\\"]\"+b+\"[\\x27\\\"]\").test(c)){console.error(\"FAIL: 禁用 status 值 \"+b+\" 出现\");fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] bind-start error path — platform 无效（非枚举值）返回 400 + `{error: "..."}` 字段存在
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"400\")){console.error(\"FAIL: 缺少 400 状态码（platform 验证）\");process.exit(1);}if(!c.includes(\"\\x27error\\x27\")&&!c.includes(\"\\\"error\\\"\")){console.error(\"FAIL: 错误响应缺少 error 字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] secretName 格式验证 — 含 `COOKIES` 命名逻辑（`{PLATFORM_UPPER}_COOKIES` 格式，非 _MAIN）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"COOKIES\")){console.error(\"FAIL: 缺少 _COOKIES Secret 命名逻辑\");process.exit(1);}if(c.includes(\"_MAIN\")){console.error(\"FAIL: 仍含 _MAIN 命名（应为 _COOKIES）\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing Mode B — Playwright windows_cloud final-e2e）

- [ ] [BEHAVIOR:E2E] 用户打开 /operator 页面，点击"登录"按钮，后端 bind-start API 被调用
  期望：Playwright E2E spec `operator-sessions.spec.ts` 断言：
  - `/operator` 页面加载 → `data-testid="login-btn-douyin"` 可见
  - 点击后按钮变 disabled
  - API mock 验证 POST bind-start 被调用且 body = `{platform: "douyin"}`
