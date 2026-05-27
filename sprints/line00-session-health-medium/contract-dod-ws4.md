---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: qr-bind-gongzhonghao.ts + agent index.ts 注册 7 个 handler

**范围**: 新建 `qr-bind-gongzhonghao.ts`；更新 `services/agent/src/index.ts` 添加 7 个新 handler 的 import 和 task dispatch 注册
**大小**: S（~90 行净增，2 文件）
**依赖**: Workstream 3 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/handlers/qr-bind-gongzhonghao.ts` 文件存在
  Test: node -e "require('fs').accessSync('services/agent/src/handlers/qr-bind-gongzhonghao.ts');console.log('OK')"

- [ ] [ARTIFACT] `services/agent/src/index.ts` 含对 qr-bind-kuaishou 的 import 语句
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/index.ts','utf8');if(!c.includes('qr-bind-kuaishou'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] qr-bind-gongzhonghao.ts loginUrl 包含 `mp.weixin.qq.com`（公众号后台域名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-gongzhonghao.ts\",\"utf8\");if(!c.includes(\"mp.weixin.qq.com\")){console.error(\"FAIL: 缺少公众号域名\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] agent index.ts 含 `qr_bind/kuaishou` 或 `qr-bind/kuaishou` dispatch 注册（7 个新 handler 已注册）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/index.ts\",\"utf8\");const handlers=[\"kuaishou\",\"xiaohongshu\",\"shipinhao\",\"toutiao\",\"weibo\",\"zhihu\",\"gongzhonghao\"];let fail=false;for(const h of handlers){if(!c.includes(h)){console.error(\"FAIL: index.ts 缺少\",h);fail=true;}}if(fail)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] agent index.ts import 了 7 个新 qr-bind handler（或通过 require/dynamic import 加载）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/index.ts\",\"utf8\");const count=(c.match(/qr-bind-(kuaishou|xiaohongshu|shipinhao|toutiao|weibo|zhihu|gongzhonghao)/g)||[]).length;if(count<7){console.error(\"FAIL: 只找到\",count,\"个 qr-bind handler 引用，需要 7 个\");process.exit(1);}console.log(\"OK count=\"+count)"'
  期望: OK count=7 或更多

- [ ] [BEHAVIOR] qr-bind-gongzhonghao.ts platform 字段值包含 `gongzhonghao`（公众号平台代号）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/qr-bind-gongzhonghao.ts\",\"utf8\");if(!c.includes(\"gongzhonghao\")){console.error(\"FAIL: 缺少 platform gongzhonghao\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
