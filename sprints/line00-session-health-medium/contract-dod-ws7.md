---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 7: e2e-verify.ps1（final-e2e 验收脚本）

**范围**: 新建 `sprints/line00-session-health-medium/e2e-verify.ps1`，按 windows_cloud 变体 C 模板实现：npm ci → playwright install → dashboard build → vite preview → 跑 `operator-sessions.spec.ts`
**大小**: S（~100 行净增，1 文件）
**依赖**: Workstream 6 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/line00-session-health-medium/e2e-verify.ps1` 文件存在
  Test: node -e "require('fs').accessSync('sprints/line00-session-health-medium/e2e-verify.ps1');console.log('OK')"

- [ ] [ARTIFACT] e2e-verify.ps1 含 `operator-sessions.spec.ts` 引用
  Test: node -e "const c=require('fs').readFileSync('sprints/line00-session-health-medium/e2e-verify.ps1','utf8');if(!c.includes('operator-sessions.spec.ts'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] e2e-verify.ps1 含 `npm.cmd ci` 安装步骤（Windows 兼容写法）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/line00-session-health-medium/e2e-verify.ps1\",\"utf8\");if(!c.includes(\"npm.cmd\")){console.error(\"FAIL: 缺少 npm.cmd Windows 兼容写法\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.ps1 含 `playwright install chromium` 步骤
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/line00-session-health-medium/e2e-verify.ps1\",\"utf8\");if(!c.includes(\"playwright install\")){console.error(\"FAIL: 缺少 playwright install\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.ps1 含 `Test-NetConnection` 端口检测（Windows 兼容，非 curl）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/line00-session-health-medium/e2e-verify.ps1\",\"utf8\");if(!c.includes(\"Test-NetConnection\")){console.error(\"FAIL: 缺少 Test-NetConnection（Windows 端口检测）\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.ps1 含 `vite` 启动 + 端口 5174 设定（Dashboard 标准端口）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/line00-session-health-medium/e2e-verify.ps1\",\"utf8\");if(!c.includes(\"vite\")){console.error(\"FAIL: 缺少 vite 启动\");process.exit(1);}if(!c.includes(\"5174\")){console.error(\"FAIL: 缺少端口 5174\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.ps1 含 `Set-StrictMode` 和 `ErrorActionPreference = "Stop"`（Windows PS1 强制规则，确保错误传播）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/line00-session-health-medium/e2e-verify.ps1\",\"utf8\");if(!c.includes(\"Set-StrictMode\")){console.error(\"FAIL: 缺少 Set-StrictMode\");process.exit(1);}if(!c.includes(\"ErrorActionPreference\")){console.error(\"FAIL: 缺少 ErrorActionPreference\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
