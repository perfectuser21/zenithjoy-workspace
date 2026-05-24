---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: CDP article 发布脚本（TDD — commit-1: 测试 RED，commit-2: 实现 GREEN）

**范围**:
- commit-1（RED）: 新建 `__tests__/publish-douyin-article.test.cjs`（cjs 脚本尚不存在 → 4 failures）
- commit-2（GREEN）: 新建 `publish-douyin-article.cjs` + `publish-douyin-article-dryrun.cjs`（CDP 直连 Chrome :19222，封面用 `DOM.setFileInputFiles(backendNodeId)` 上传，发布按钮走 XPath，dryrun 停在发布前）

**大小**: M（三文件合计约 260 行净增）
**依赖**: 无（串行链起点）

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/publishers/douyin-publisher/publish-douyin-article.cjs` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs')"

- [ ] [ARTIFACT] `services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs')"

- [ ] [ARTIFACT] 两个脚本均以 `#!/usr/bin/env node` 开头（可被 node 直接执行）
  Test: node -e "const fs=require('fs');const a=fs.readFileSync('/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs','utf8');const b=fs.readFileSync('/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs','utf8');if(!a.startsWith('#!/usr/bin/env node'))process.exit(1);if(!b.startsWith('#!/usr/bin/env node'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 脚本包含 `DOM.setFileInputFiles` 关键字（CDP 封面上传，非旧式 SCP）
  Test: manual:bash -c 'grep -q "DOM.setFileInputFiles" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs || { echo "FAIL: 未用 DOM.setFileInputFiles"; exit 1; }; grep -q "backendNodeId" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs || { echo "FAIL: backendNodeId 未出现"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 两个脚本均无 `button:has-text`（XPath 规则，禁止 Playwright text selector）
  Test: manual:bash -c '! grep -q "button:has-text" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs || { echo "FAIL: article 含 button:has-text"; exit 1; }; ! grep -q "button:has-text" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs || { echo "FAIL: dryrun 含 button:has-text"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] cover 文件不存在时脚本 fail fast — 包含 fs.existsSync 或等效检查
  Test: manual:bash -c 'grep -qE "existsSync|ENOENT|cover.*not found|cover.*exist" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs || { echo "FAIL: article 无 cover 存在性检查"; exit 1; }; grep -qE "existsSync|ENOENT|cover.*not found|cover.*exist" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs || { echo "FAIL: dryrun 无 cover 存在性检查"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] dryrun 脚本含 `dryRun: true` 输出路径，且不含 `create_v2`/`aweme/create` 发布 API 调用
  Test: manual:bash -c 'grep -qE "\"dryRun\".*true|dryRun: true" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs || { echo "FAIL: dryrun 输出中无 dryRun:true"; exit 1; }; ! grep -q "create_v2\|aweme/create" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs || { echo "FAIL: dryrun 不允许调用发布 API"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] summary 缺省截取逻辑 — 脚本含 `content.substring(0, 30)` 或 `content.slice(0, 30)`
  Test: manual:bash -c 'grep -qE "content\.substring\(0,\s*30\)|content\.slice\(0,\s*30\)" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs || { echo "FAIL: 无 summary 缺省截取逻辑"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] error path — article 脚本传入不存在 cover 路径时输出含 `ok:false` 的 JSON
  Test: manual:bash -c 'grep -qE "ok.*false|\"ok\":.*false" /workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs || { echo "FAIL: 无 ok:false 错误输出路径"; exit 1; }; echo OK'
  期望: OK，exit 0

## TDD 测试文件条目（commit-1 产出 — ws4 并入 ws1，v7.11 修复）

- [ ] [ARTIFACT] `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs` 文件存在（ws1 commit-1 产出）
  Test: node -e "require('fs').accessSync('/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs')"

- [ ] [BEHAVIOR] 测试文件含 ≥3 个 it() 块，覆盖 dryrun/fail-fast/summary 三个核心场景
  Test: manual:bash -c 'COUNT=$(grep -c "it(" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs 2>/dev/null || echo 0); [ "$COUNT" -ge 3 ] || { echo "FAIL: 测试块数量 $COUNT < 3"; exit 1; }; echo "OK: $COUNT it() blocks"'
  期望: OK: N it() blocks（N ≥ 3）

- [ ] [BEHAVIOR] 测试文件 require `publish-douyin-article.cjs`，不 require image/video 脚本
  Test: manual:bash -c 'grep -q "publish-douyin-article" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 测试未 require publish-douyin-article.cjs"; exit 1; }; ! grep -q "publish-douyin-image\|publish-douyin-video" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 错误 require 了 image/video 脚本"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 测试文件覆盖 dryRun:true 场景（含 dryRun 断言）
  Test: manual:bash -c 'grep -q "dryRun" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 无 dryRun 测试场景"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 测试文件覆盖 cover fail fast 场景（含 cover/existsSync/ENOENT/fail fast 相关内容）
  Test: manual:bash -c 'grep -qE "cover|existsSync|fail fast|ENOENT" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 无 cover fail fast 测试"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] TDD RED 状态验证 — 备份移走实现 CJS 后运行 test.cjs 必须输出 Cannot find module（v7.11 Round 3 新增）
  Test: manual:bash -c 'IMPL=/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article.cjs; DRYRUN=/workspace/services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs; TEST=/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs; cp "$IMPL" /tmp/article-cjs.bak && cp "$DRYRUN" /tmp/dryrun-cjs.bak && rm "$IMPL" "$DRYRUN"; OUTPUT=$(node "$TEST" 2>&1 || true); cp /tmp/article-cjs.bak "$IMPL"; cp /tmp/dryrun-cjs.bak "$DRYRUN"; echo "$OUTPUT" | grep -q "Cannot find module\|MODULE_NOT_FOUND" && echo "OK: RED confirmed" || { echo "FAIL: 期望 Cannot find module/MODULE_NOT_FOUND，实际输出: $OUTPUT"; exit 1; }'
  期望: OK: RED confirmed（说明 commit-1 时 test.cjs 在无实现文件时必然报 MODULE_NOT_FOUND，TDD RED 状态成立）
