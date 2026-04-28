# Contract DoD — Workstream 4: Logo 资源 + smoke 脚本

**范围**: services/agent/build/ 添加 logo PNG + .github/workflows/scripts/smoke/dashboard-license-smoke.sh 新建
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] services/agent/build/icon.png 存在且大小 ≥ 1000 字节
  Test: node -e "const s=require('fs').statSync('services/agent/build/icon.png');if(s.size<1000)process.exit(1)"

- [ ] [ARTIFACT] services/agent/build/tray-icon.png 存在且大小 ≥ 1000 字节
  Test: node -e "const s=require('fs').statSync('services/agent/build/tray-icon.png');if(s.size<1000)process.exit(1)"

- [ ] [ARTIFACT] dashboard-license-smoke.sh 存在
  Test: test -f .github/workflows/scripts/smoke/dashboard-license-smoke.sh

- [ ] [ARTIFACT] smoke.sh 含 shebang #!/usr/bin/env bash
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/dashboard-license-smoke.sh','utf8');if(!/^#!\/usr\/bin\/env bash/.test(c))process.exit(1)"

- [ ] [ARTIFACT] smoke.sh 含 set -euo pipefail
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/dashboard-license-smoke.sh','utf8');if(!/set\s+-euo?\s+pipefail/.test(c))process.exit(1)"

- [ ] [ARTIFACT] smoke.sh 含至少 5 个 curl 调用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/dashboard-license-smoke.sh','utf8');const n=(c.match(/curl\s/g)||[]).length;if(n<5)process.exit(1)"

- [ ] [ARTIFACT] smoke.sh 测试 GET /api/admin/license/me（含路径字面量）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/dashboard-license-smoke.sh','utf8');if(!/\/api\/admin\/license\/me/.test(c))process.exit(1)"

- [ ] [ARTIFACT] smoke.sh 测试 POST /api/admin/license（含 -X POST 或 -d 数据）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/dashboard-license-smoke.sh','utf8');if(!/-X\s+POST.*admin\/license|admin\/license[^\\n]*-d/s.test(c))process.exit(1)"

- [ ] [ARTIFACT] smoke.sh 测试 401 缺少 X-Feishu-User-Id 路径
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/dashboard-license-smoke.sh','utf8');if(!/401/.test(c))process.exit(1)"

- [ ] [ARTIFACT] DynamicSidebar.tsx 引用 logo PNG（不退化）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/components/DynamicSidebar.tsx','utf8');if(!/logo-(white|color)\.png/.test(c))process.exit(1)"

## BEHAVIOR 索引

WS4 的 BEHAVIOR 由 smoke 脚本自身担保（CI 中 lint-feature-has-smoke 会确认 script 存在 + 退出码）。Logo 资源属于纯静态产出物，无需运行时验证。
