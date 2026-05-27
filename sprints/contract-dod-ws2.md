---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 2: publish-kuaishou-image-dryrun.cjs 三模式升级

**范围**: 现有 CDP-only 脚本加 KUAISHOU_COOKIES cookie injection 首选模式（Playwright `addCookies` API），profile dir 第二选（`userDataDir`），保留 CDP 19223 兜底；截图命名改为 `kuaishou-image-{timestamp}.png`；stdout 末行 JSON `{ok:true,dryRun:true}`
**大小**: M（~120 行改动）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs` 改造完成，含三模式启动逻辑
  Test: node -e "const c=require('fs').readFileSync('/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs','utf8');if(!c.includes('addCookies'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] 脚本含 KUAISHOU_COOKIES env 读取和 addCookies cookie 注入调用
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'KUAISHOU_COOKIES'"'"')){console.error('"'"'FAIL: 缺 KUAISHOU_COOKIES'"'"');process.exit(1);}if(!c.includes('"'"'addCookies'"'"')){console.error('"'"'FAIL: 缺 addCookies'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 脚本 CDP 端口为 19223，且不含抖音端口 19222（端口隔离）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'19223'"'"')){console.error('"'"'FAIL: 缺 CDP 19223'"'"');process.exit(1);}if(c.includes('"'"'19222'"'"')){console.error('"'"'FAIL: 混用抖音端口 19222'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 脚本含 profile dir 降级模式（userDataDir 关键字，KUAISHOU_COOKIES 缺失时兜底）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'userDataDir'"'"')&&!c.includes('"'"'profile'"'"')){console.error('"'"'FAIL: 缺 profile dir 降级'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 脚本截图命名含 kuaishou-image- 前缀（与视频截图命名隔离）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'kuaishou-image-'"'"')){console.error('"'"'FAIL: 截图命名未含 kuaishou-image-'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 脚本含 dryRun:true 输出（stdout 末行 JSON 有 dryRun 字段）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'dryRun: true'"'"')&&!c.includes('"'"'dryRun:true'"'"')){console.error('"'"'FAIL: 缺 dryRun:true 输出'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

> **假绿自查**：旧文件不含 `addCookies` 和 `KUAISHOU_COOKIES` → BEHAVIOR 1/2/3/4/5 中只有 3(CDP 19223 已有) 可能通过，1/2/4/5 均 FAIL → 真红 ✅。`kuaishou-image-` 截图命名旧文件也没有 → BEHAVIOR 4 也 FAIL ✅。
