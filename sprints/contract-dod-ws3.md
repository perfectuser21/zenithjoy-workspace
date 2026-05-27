---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 3: publish-kuaishou-video-dryrun.cjs 新建

**范围**: 新建视频 dryrun 脚本，三模式（KUAISHOU_COOKIES cookie injection / profile dir / CDP 19223 兜底），导航 `https://cp.kuaishou.com/article/publish/video`，拦截 `/rest/cp/works/` POST/PUT（命中即抛 dryrun-失守 Error），截图命名 `kuaishou-video-{timestamp}.png`，stdout 末行 JSON `{ok:true,dryRun:true}`
**大小**: M（~140 行，新文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs` 新建，文件存在
  Test: node -e "require('fs').accessSync('/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs');console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] 文件含视频发布 URL `https://cp.kuaishou.com/article/publish/video`（不是图文 URL）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'article/publish/video'"'"')){console.error('"'"'FAIL: 缺视频 URL'"'"');process.exit(1);}if(c.includes('"'"'article/publish/photo'"'"')&&!c.includes('"'"'article/publish/video'"'"')){console.error('"'"'FAIL: 用了图文 URL'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 文件含 `/rest/cp/works/` API 拦截逻辑（命中即 dryrun 失守）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'/rest/cp/works/'"'"')){console.error('"'"'FAIL: 缺 API 拦截'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 文件含 KUAISHOU_COOKIES env 读取和 addCookies cookie 注入（三模式首选）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'KUAISHOU_COOKIES'"'"')){console.error('"'"'FAIL: 缺 KUAISHOU_COOKIES'"'"');process.exit(1);}if(!c.includes('"'"'addCookies'"'"')){console.error('"'"'FAIL: 缺 addCookies'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 文件 CDP 端口为 19223，且不含抖音端口 19222（端口隔离）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'19223'"'"')){console.error('"'"'FAIL: 缺 CDP 19223'"'"');process.exit(1);}if(c.includes('"'"'19222'"'"')){console.error('"'"'FAIL: 混用抖音端口 19222'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 文件截图命名含 kuaishou-video- 前缀（与图文截图命名隔离）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs'"'"','"'"'utf8'"'"');if(!c.includes('"'"'kuaishou-video-'"'"')){console.error('"'"'FAIL: 截图命名未含 kuaishou-video-'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

> **假绿自查**：`publish-kuaishou-video-dryrun.cjs` 在 WS3 实现前根本不存在 → 所有 BEHAVIOR 命令 `readFileSync` 抛 ENOENT → exit 1 → 全部真红 ✅。ARTIFACT 条目 `accessSync` 同样 ENOENT ✅。
