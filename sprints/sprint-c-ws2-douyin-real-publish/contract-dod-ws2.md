---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Agent 路由按 type 重写 + 错误回写

**范围**: 修 douyin-publish.ts 硬编码 bug，按 type 路由 + 找不到脚本显式失败 + 4 环节日志
**大小**: M
**依赖**: WS1（需要 publish_tasks.type 字段）

## ARTIFACT 条目

- [ ] [ARTIFACT] resolveDouyinScriptPath 函数签名接 type 参数
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/douyin-publish.ts','utf8');if(!/resolveDouyinScriptPath\s*\(\s*\{[^}]*type/s.test(c)&&!/resolveDouyinScriptPath\s*\([^)]*type/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 旧硬编码 image 行已删除（铁律 6：先减肥）
  Test: ! grep -E "publish-douyin-image\.cjs.*publish-douyin-image-dryrun\.cjs" services/agent/src/handlers/douyin-publish.ts

- [ ] [ARTIFACT] 找不到脚本时显式抛错
  Test: grep -E "(no script for type|unsupported type|throw new Error.*type)" services/agent/src/handlers/douyin-publish.ts | head -1 | grep -q .

- [ ] [ARTIFACT] 4 环节日志：每处含 [type-route] 标签
  Test: grep -rE "\[type-route\]" apps/api/src/services/walking-skeleton.service.ts services/agent/src/handlers/douyin-publish.ts services/agent/src/handlers/heartbeat-loop.ts | wc -l | awk '$1 < 3 {exit 1}'

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/douyin-route.test.ts`，覆盖：
- resolveDouyinScriptPath({type:'video', real:false}) → 路径含 'publish-douyin-video-dryrun.cjs'
- resolveDouyinScriptPath({type:'video', real:true}) → 路径含 'publish-douyin-video.cjs'
- resolveDouyinScriptPath({type:'article'}) → throw Error 含 'no script for type article'
- handleDouyinPublishTask 失败时调 onTaskComplete({status:'failed', reason:...})
