---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: article 路由（douyin-publish.ts）

**范围**: 将 `'article'` 加入 `SUPPORTED_DOUYIN_TYPES`；`resolveDouyinScriptPath({type:'article'})` 按 dryrun 环境变量路由到 ws1 article 脚本
**大小**: S（约 15 行净改）
**依赖**: Workstream 1 完成后（article CJS 脚本须先存在，resolveScriptPath 调用 fs.existsSync）

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/src/handlers/douyin-publish.ts` 中 `SUPPORTED_DOUYIN_TYPES` 包含字面字符串 `'article'`
  Test: node -e "const src=require('fs').readFileSync('/workspace/services/agent/src/handlers/douyin-publish.ts','utf8');if(!src.includes(\"'article'\"))process.exit(1)"

- [ ] [ARTIFACT] `sprints/zj-douyin-article-agent-port/tests/ws2/routing.test.ts` 文件存在（vitest 路由覆盖测试，Round 3 新增，对齐 Test Contract 表格）
  Test: node -e "require('fs').accessSync('/workspace/sprints/zj-douyin-article-agent-port/tests/ws2/routing.test.ts')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `douyin-publish.ts` 源码的 `SUPPORTED_DOUYIN_TYPES` Set 字面包含 `'article'`（不再是注释状态）
  Test: manual:bash -c 'grep -qE "SUPPORTED_DOUYIN_TYPES.*article|article.*SUPPORTED_DOUYIN_TYPES" /workspace/services/agent/src/handlers/douyin-publish.ts || grep -A5 "SUPPORTED_DOUYIN_TYPES" /workspace/services/agent/src/handlers/douyin-publish.ts | grep -q "article" || { echo "FAIL: article 不在 SUPPORTED_DOUYIN_TYPES 中"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 旧"暂未实现"注释行已删除或不再作为路由阻断（article 不走 throw 分支）
  Test: manual:bash -c 'BLOCK=$(grep -A3 "no script for type\|暂未实现" /workspace/services/agent/src/handlers/douyin-publish.ts 2>/dev/null | grep -c "article" || true); [ "$BLOCK" = "0" ] || { echo "FAIL: article 仍在暂未实现 throw 路径中"; exit 1; }; echo OK'
  期望: OK，exit 0（article 不被 throw 拦截）

- [ ] [BEHAVIOR] 未知 type（如 'unsupported'）仍然抛 Error（防止路由过度放开）
  Test: manual:bash -c 'grep -qE "no script for type|不支持|SUPPORTED_DOUYIN_TYPES.has" /workspace/services/agent/src/handlers/douyin-publish.ts || { echo "FAIL: 未知 type 的 throw 保护已删除"; exit 1; }; echo OK'
  期望: OK，exit 0（unknown type 保护依然存在）

- [ ] [BEHAVIOR] error path — type='article' 路由后脚本路径含 `publish-douyin-article` 字符串（不路由到 video/image 脚本）
  Test: manual:bash -c 'grep -qE "publish-douyin-article" /workspace/services/agent/src/handlers/douyin-publish.ts || { echo "FAIL: douyin-publish.ts 无 publish-douyin-article 路径引用"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] dryrun 模式（`ZENITHJOY_AGENT_REAL_PUBLISH` 未设）路由到 `publish-douyin-article-dryrun.cjs`，real 模式路由到 `publish-douyin-article.cjs`
  Test: manual:bash -c 'grep -q "publish-douyin-article-dryrun" /workspace/services/agent/src/handlers/douyin-publish.ts || { echo "FAIL: dryrun 路由字符串未出现"; exit 1; }; echo OK'
  期望: OK，exit 0
