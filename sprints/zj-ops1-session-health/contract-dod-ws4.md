---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: CI session-health-check.yml 扩展 + smoke 脚本

**范围**: `.github/workflows/session-health-check.yml` env 段注入全部 35 个平台 Secrets（DOUYIN_MAIN ~ WECOM_API_KEY）+ FEISHU_BOT_WEBHOOK；新建 `.github/workflows/scripts/smoke/session-health-smoke.sh`；新建 `sprints/zj-ops1-session-health/e2e-verify.ps1`
**大小**: S（~100 行净增）
**依赖**: Workstream 3 完成后（全链路 smoke 需要 check-health.js + Dashboard 全部就绪）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `session-health-check.yml` 包含 `DOUYIN_MAIN` 新命名（替代旧 DOUYIN_COOKIES）
  Test: node -e "const s=require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8'); if(!s.includes('DOUYIN_MAIN')){console.error('FAIL: 未使用新命名 DOUYIN_MAIN');process.exit(1)}; console.log('OK')"

- [ ] [ARTIFACT] `session-health-check.yml` 含 FEISHU_BOT_WEBHOOK（飞书告警专用）
  Test: node -e "const s=require('fs').readFileSync('.github/workflows/session-health-check.yml','utf8'); if(!s.includes('FEISHU_BOT_WEBHOOK')){console.error('FAIL: 缺 FEISHU_BOT_WEBHOOK');process.exit(1)}; console.log('OK')"

- [ ] [ARTIFACT] `session-health-smoke.sh` 存在且不是 `exit 0` 占位（实质内容 ≥5 行）
  Test: bash -c '[ -f .github/workflows/scripts/smoke/session-health-smoke.sh ] || { echo "FAIL: 文件不存在"; exit 1; }; LINES=$(grep -c "." .github/workflows/scripts/smoke/session-health-smoke.sh); [ "$LINES" -ge 5 ] || { echo "FAIL: 仅 $LINES 行"; exit 1; }; echo "OK: $LINES 行"'

- [ ] [ARTIFACT] `sprints/zj-ops1-session-health/e2e-verify.ps1` 存在
  Test: node -e "require('fs').accessSync('sprints/zj-ops1-session-health/e2e-verify.ps1')" && echo OK

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `session-health-check.yml` 包含 ≥35 个 `${{ secrets.XXX }}` 引用（32 平台账号 + 3 API key）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\".github/workflows/session-health-check.yml\",\"utf8\"); const n=(s.match(/\\\$\{\{\s*secrets\./g)||[]).length; if(n<35){console.error(\"FAIL: Secret 引用数=\"+n+\" 期望≥35\");process.exit(1)}; console.log(\"OK: secrets count=\"+n)"'
  期望: OK: secrets count=36（或更多）

- [ ] [BEHAVIOR] CI yml 不含旧命名 `DOUYIN_COOKIES`（已完全迁移到 DOUYIN_MAIN 命名方案）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\".github/workflows/session-health-check.yml\",\"utf8\"); if(s.includes(\"DOUYIN_COOKIES\")&&!s.includes(\"DOUYIN_MAIN\")){console.error(\"FAIL: 仍使用旧命名 DOUYIN_COOKIES\");process.exit(1)}; console.log(\"OK: 迁移完成\")"'
  期望: OK: 迁移完成

- [ ] [BEHAVIOR] `session-health-smoke.sh` 包含真实 node 调用验证脚本输出（非 `exit 0` 占位）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\".github/workflows/scripts/smoke/session-health-smoke.sh\",\"utf8\"); if(s.trim()===\" \" || s.match(/^\\s*exit\\s+0\\s*$/)){console.error(\"FAIL: 是 exit 0 占位\");process.exit(1)}; if(!s.includes(\"SKIP_HTTP_CHECK\")){console.error(\"FAIL: smoke 未使用 SKIP_HTTP_CHECK 离线模式\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `e2e-verify.ps1` 包含 Playwright 相关调用（非空占位）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"sprints/zj-ops1-session-health/e2e-verify.ps1\",\"utf8\"); if(!s.match(/playwright|Playwright/i)){console.error(\"FAIL: e2e-verify.ps1 无 Playwright 调用\");process.exit(1)}; if(!s.match(/operator/i)){console.error(\"FAIL: e2e-verify.ps1 未指向 /operator 测试\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] yml env 段含视频号 Secret（SHIPINHAO_MAIN）验证 8 平台全覆盖
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\".github/workflows/session-health-check.yml\",\"utf8\"); if(!s.includes(\"SHIPINHAO_MAIN\")){console.error(\"FAIL: 缺视频号 SHIPINHAO_MAIN\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — yml 中每个 Secret 引用格式正确（`${{ secrets.XXX }}`，无语法错误）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\".github/workflows/session-health-check.yml\",\"utf8\"); const badRef=(s.match(/\\\$\{\s*secrets\./g)||[]); if(badRef.length>0){console.error(\"FAIL: 存在格式错误的 secrets 引用（缺双大括号）：\",badRef);process.exit(1)}; console.log(\"OK: 无格式错误\")"'
  期望: OK: 无格式错误
