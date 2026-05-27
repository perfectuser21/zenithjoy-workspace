---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Agent qr-bind batch A（快手/小红书/视频号）

**范围**: 新建 `qr-bind-kuaishou.ts`、`qr-bind-xiaohongshu.ts`、`qr-bind-shipinhao.ts`，仿 qr-bind-douyin.ts 模式，各自平台 creator loginUrl，URL 离开 /login 判登录成功，抓 storageState
**大小**: M（~180 行净增，3 文件）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-kuaishou.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-kuaishou.ts');console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-xiaohongshu.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-xiaohongshu.ts');console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-shipinhao.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-shipinhao.ts');console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] qr-bind-kuaishou.ts loginUrl 包含 `cp.kuaishou.com`（快手创作者后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-kuaishou.ts\",\"utf8\");if(!c.includes(\"cp.kuaishou.com\")){console.error(\"FAIL: 缺少快手域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] qr-bind-xiaohongshu.ts loginUrl 包含 `xiaohongshu.com`（小红书创作者后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-xiaohongshu.ts\",\"utf8\");if(!c.includes(\"xiaohongshu.com\")){console.error(\"FAIL: 缺少小红书域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] qr-bind-shipinhao.ts loginUrl 包含 `channels.weixin.qq.com`（视频号后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-shipinhao.ts\",\"utf8\");if(!c.includes(\"channels.weixin.qq.com\")){console.error(\"FAIL: 缺少视频号域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 3 个 handler 各自都有调用 upload-cookies 的代码（含 `upload-cookies` 或 `uploadCookies` 字符串）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const files=[\"services/agent/src/handlers/qr-bind-kuaishou.ts\",\"services/agent/src/handlers/qr-bind-xiaohongshu.ts\",\"services/agent/src/handlers/qr-bind-shipinhao.ts\"];let fail=false;for(const f of files){const c=fs.readFileSync(f,\"utf8\");if(!c.includes(\"upload-cookies\")&&!c.includes(\"uploadCookies\")){console.error(\"FAIL: \"+f+\" 缺少 upload-cookies 调用\");fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 3 个 handler 都 export 一个 handle 函数（export 关键字存在）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const files=[\"services/agent/src/handlers/qr-bind-kuaishou.ts\",\"services/agent/src/handlers/qr-bind-xiaohongshu.ts\",\"services/agent/src/handlers/qr-bind-shipinhao.ts\"];let fail=false;for(const f of files){const c=fs.readFileSync(f,\"utf8\");if(!c.includes(\"export\")){console.error(\"FAIL: \"+f+\" 缺少 export\");fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK
