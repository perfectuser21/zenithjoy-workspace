---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Agent qr-bind batch B（头条/微博/知乎）

**范围**: 新建 `qr-bind-toutiao.ts`、`qr-bind-weibo.ts`、`qr-bind-zhihu.ts`，各自平台 creator loginUrl
**大小**: M（~180 行净增，3 文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-toutiao.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-toutiao.ts');console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-weibo.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-weibo.ts');console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-zhihu.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-zhihu.ts');console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] qr-bind-toutiao.ts loginUrl 包含 `mp.toutiao.com`（头条创作者后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-toutiao.ts\",\"utf8\");if(!c.includes(\"mp.toutiao.com\")){console.error(\"FAIL: 缺少头条域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] qr-bind-weibo.ts loginUrl 包含 `weibo.com`（微博后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-weibo.ts\",\"utf8\");if(!c.includes(\"weibo.com\")){console.error(\"FAIL: 缺少微博域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] qr-bind-zhihu.ts loginUrl 包含 `zhihu.com`（知乎后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-zhihu.ts\",\"utf8\");if(!c.includes(\"zhihu.com\")){console.error(\"FAIL: 缺少知乎域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 3 个 handler 各自都有调用 upload-cookies 的代码（含 `upload-cookies` 或 `uploadCookies` 字符串）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const files=[\"services/agent/src/handlers/qr-bind-toutiao.ts\",\"services/agent/src/handlers/qr-bind-weibo.ts\",\"services/agent/src/handlers/qr-bind-zhihu.ts\"];let fail=false;for(const f of files){const c=fs.readFileSync(f,\"utf8\");if(!c.includes(\"upload-cookies\")&&!c.includes(\"uploadCookies\")){console.error(\"FAIL: \"+f+\" 缺少 upload-cookies 调用\");fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 3 个 handler 中 platform 字段值匹配正确平台代号（toutiao/weibo/zhihu）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const pairs=[[\"services/agent/src/handlers/qr-bind-toutiao.ts\",\"toutiao\"],[\"services/agent/src/handlers/qr-bind-weibo.ts\",\"weibo\"],[\"services/agent/src/handlers/qr-bind-zhihu.ts\",\"zhihu\"]];let fail=false;for(const [f,p] of pairs){const c=fs.readFileSync(f,\"utf8\");if(!c.includes(\"\\x27\"+p+\"\\x27\")&&!c.includes(\"\\\"\"+p+\"\\\"\")){console.error(\"FAIL: \"+f+\" 缺少 platform \"+p);fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK
