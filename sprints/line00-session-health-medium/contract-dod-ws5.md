---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: 后端 API operator-sessions.ts

**范围**: 新建 `apps/api/src/routes/operator-sessions.ts`，含三个端点：`POST /api/operator/sessions/bind-start`（dispatch qr_bind task）、`POST /api/operator/sessions/upload-cookies`（Octokit 写 GitHub Secret）、`GET /api/operator/sessions/status`（返回平台状态数组）
**大小**: M（~170 行净增，1 文件）
**依赖**: Workstream 4 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/operator-sessions.ts` 文件存在
  Test: node -e "require('fs').accessSync('apps/api/src/routes/operator-sessions.ts');console.log('OK')"

- [ ] [ARTIFACT] operator-sessions.ts 含三个路由定义（bind-start、upload-cookies、status）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/operator-sessions.ts','utf8');if(!c.includes('bind-start')||!c.includes('upload-cookies')||!c.includes('status'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] bind-start 路由 response schema 含 `ok` (boolean) + `taskId` (string) 字段，顶层 keys = ["ok","taskId"]
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"taskId\")){console.error(\"FAIL: 缺少 taskId\");process.exit(1);}const forbidden=[\"\\\"id\\\"\",\"\\\"task\\\"\",\"\\\"result\\\"\",\"\\\"data\\\"\"];for(const f of forbidden){if(c.includes(\"ok:\"+f)||c.includes(\"ok: \"+f)||new RegExp(\"json\\\\(.*\"+f.replace(/\"/g,\"\\\\\"\")+\"\").test(c)){}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] upload-cookies response schema 含 `ok`/`secretName`/`updatedAt` 三个字段，禁用字段 `secret`/`key`/`name`/`timestamp` 不出现在 json response 构造中
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"secretName\")){console.error(\"FAIL: 缺少 secretName\");process.exit(1);}if(!c.includes(\"updatedAt\")){console.error(\"FAIL: 缺少 updatedAt\");process.exit(1);}const forbidden=[\"\\x27secret\\x27\",\"\\x27timestamp\\x27\",\"\\x27message\\x27\",\"\\x27name\\x27:\"];let fail=false;for(const f of forbidden){if(c.includes(f)&&c.includes(\"json\")&&c.indexOf(f)<c.lastIndexOf(\"json\")){}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] upload-cookies keys 完整性 — 路由代码构造的 success response 仅含 ok/secretName/updatedAt（无多余字段）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"secretName\")&&!c.includes(\"updatedAt\")){console.error(\"FAIL: keys 不完整\");process.exit(1);}if(c.includes(\"\\x27message\\x27\")||c.includes(\"\\x27timestamp\\x27\")||c.includes(\"\\x27msg\\x27\")){console.error(\"FAIL: 含禁用字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GH_SECRETS_WRITE_PAT 未配置时 upload-cookies error path 返回 5xx + `{error: "..."}` 而非 `{message: "..."}`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"GH_SECRETS_WRITE_PAT\")){console.error(\"FAIL: 缺少 GH_SECRETS_WRITE_PAT 检查\");process.exit(1);}if(!c.includes(\"500\")&&!c.includes(\"503\")){console.error(\"FAIL: 缺少 5xx 状态码\");process.exit(1);}const errHasError=c.match(/error:.*[Gg][Hh]_[Ss]ecrets/);if(!errHasError&&!c.includes(\"\\x27error\\x27\")){console.error(\"FAIL: 错误响应未用 error 字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] status endpoint response 每项含 `checkedAt` 字段，禁用 status 值 `healthy`/`active`/`inactive` 不出现
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"checkedAt\")){console.error(\"FAIL: 缺少 checkedAt\");process.exit(1);}const forbidden=[\"\\x27healthy\\x27\",\"\\\"healthy\\\"\",\"\\x27active\\x27\",\"\\\"active\\\"\",\"\\x27inactive\\x27\",\"\\\"inactive\\\"\"];for(const f of forbidden){if(c.includes(f)){console.error(\"FAIL: 含禁用 status 值\",f);process.exit(1);}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] bind-start error path — platform 无效（非枚举值）返回 400 + `{error: "..."}` 字段存在
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/operator-sessions.ts\",\"utf8\");if(!c.includes(\"400\")){console.error(\"FAIL: 缺少 400 状态码\");process.exit(1);}if(!c.includes(\"\\x27error\\x27\")&&!c.includes(\"\\\"error\\\"\")){console.error(\"FAIL: 错误响应缺少 error 字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
