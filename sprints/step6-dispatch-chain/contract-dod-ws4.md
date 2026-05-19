---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: Smoke 扩展 + e2e-verify.ps1

**范围**:
- `.github/workflows/scripts/smoke/golden-path-1-smoke.sh`: Step 6 扩展，覆盖完整 dispatch chain（publish → heartbeat → task-ack → verify success）
- `sprints/step6-dispatch-chain/e2e-verify.ps1`: Windows final-E2E 脚本，由 e2e-windows.yml 执行

**大小**: S
**依赖**: Workstream 3（API 端点已存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] `golden-path-1-smoke.sh` 含 `/api/works/` + `publish` 调用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-1-smoke.sh','utf8');if(!c.includes('/api/works/'))process.exit(1)"

- [ ] [ARTIFACT] `golden-path-1-smoke.sh` 含 `task-ack` 调用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-1-smoke.sh','utf8');if(!c.includes('task-ack'))process.exit(1)"

- [ ] [ARTIFACT] `sprints/step6-dispatch-chain/e2e-verify.ps1` 存在
  Test: node -e "require('fs').accessSync('sprints/step6-dispatch-chain/e2e-verify.ps1')"

- [ ] [ARTIFACT] `e2e-verify.ps1` 含 `publish_status` 断言
  Test: node -e "const c=require('fs').readFileSync('sprints/step6-dispatch-chain/e2e-verify.ps1','utf8');if(!c.includes('publish_status'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] smoke.sh Step 6 部分含 `publish_status` 关键字（验最终状态字段名与 PRD 一致）
  Test: manual:bash -c 'grep -q "publish_status" .github/workflows/scripts/smoke/golden-path-1-smoke.sh && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] smoke.sh Step 6 不含已废弃的旧 `/api/publish/task` 作为 dispatch 入口（新逻辑必须走 `/api/works/:id/publish`）
  Test: manual:bash -c 'SECTION=$(awk "/Step 6/,/Step 7|^exit/" .github/workflows/scripts/smoke/golden-path-1-smoke.sh); if echo "$SECTION" | grep -q "api/works.*publish"; then echo OK; else echo "FAIL: Step 6 未含 /api/works/:id/publish"; exit 1; fi'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.ps1 含 task-ack 调用（模拟 Windows Agent 确认执行）
  Test: manual:bash -c 'grep -q "task-ack" sprints/step6-dispatch-chain/e2e-verify.ps1 && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.ps1 含 ZENITHJOY_API_BASE 环境变量读取（不硬编码生产域名）
  Test: manual:bash -c 'grep -q "ZENITHJOY_API_BASE" sprints/step6-dispatch-chain/e2e-verify.ps1 && echo OK || exit 1'
  期望: OK

---

## Risks

### Risk 1: smoke.sh Step 6 扩展引入回归

扩展 `golden-path-1-smoke.sh` 若改动现有 Step 1-5 逻辑，会破坏已通过的 golden path。**缓解**: 仅在 Step 6 区块追加新 curl 调用，不修改 Step 1-5 内容；WS4 BEHAVIOR 2 验证新路由路径正确。

### Risk 2: e2e-verify.ps1 硬编码 API 端点

若 `$ApiBase` 未设置且无默认，GitHub Actions 执行时 $ApiBase 为空字符串导致 curl 调用本地 `undefined/api/...`。**缓解**: 脚本开头含 `if (-not $ApiBase)` 检查 + `exit 1`；WS4 BEHAVIOR 4 验证 ZENITHJOY_API_BASE 引用存在。
