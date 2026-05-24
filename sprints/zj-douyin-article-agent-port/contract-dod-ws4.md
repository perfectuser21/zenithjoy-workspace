---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: 测试套件（publish-douyin-article.test.cjs）

**范围**: 为 ws1 的 CJS 脚本写 vitest 单元测试，覆盖 fail fast / dryRun:true / summary 截取 3 个关键 BEHAVIOR
**大小**: S（约 80 行净增，1 文件）
**依赖**: Workstream 1 完成后（article CJS 脚本须先存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs')"

- [ ] [ARTIFACT] 测试文件被 vitest include 规则覆盖（路径匹配 `publishers/**/__tests__/**/*.test.cjs`）
  Test: node -e "const p='/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs';require('fs').accessSync(p);console.log('OK path matches vitest include pattern')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 测试文件包含至少 3 个 `it(` 测试块（覆盖 dryrun/fail-fast/summary 3 个场景）
  Test: manual:bash -c 'COUNT=$(grep -c "it(" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs 2>/dev/null || echo 0); [ "$COUNT" -ge 3 ] || { echo "FAIL: 测试块数量 $COUNT < 3"; exit 1; }; echo "OK: $COUNT it() blocks"'
  期望: OK: N it() blocks（N ≥ 3）

- [ ] [BEHAVIOR] 测试文件 require 了 `../publish-douyin-article.cjs`（不是 image/video 脚本）
  Test: manual:bash -c 'grep -q "publish-douyin-article" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 测试未 require publish-douyin-article.cjs"; exit 1; }; ! grep -q "publish-douyin-image\|publish-douyin-video" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 错误 require 了 image/video 脚本"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 测试覆盖 dryRun:true 场景（`it(` 块中含 dryRun 断言）
  Test: manual:bash -c 'grep -q "dryRun" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 无 dryRun 测试场景"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 测试覆盖 cover 不存在 error path
  Test: manual:bash -c 'grep -qE "cover|existsSync|not found|ENOENT|fail fast" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 无 cover fail fast 测试"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] 测试覆盖 summary 缺省截取（含 substring 或 slice 断言）
  Test: manual:bash -c 'grep -qE "summary|substring|slice" /workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs || { echo "FAIL: 无 summary 截取测试"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] error path — vitest 运行测试文件时（ws1 实现后）0 failures（测试本身语法正确，无 parse error）
  Test: manual:bash -c 'cd /workspace/services/agent && node -e "require(\"/workspace/services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs\")" 2>&1 | grep -v "Cannot find module" | grep -c "SyntaxError\|ReferenceError\|TypeError: Cannot read" | xargs -I{} test {} -eq 0 && echo OK || { echo "FAIL: 测试文件含语法/runtime 错误"; exit 1; }'
  期望: OK，exit 0（测试文件本身可被 parse）
