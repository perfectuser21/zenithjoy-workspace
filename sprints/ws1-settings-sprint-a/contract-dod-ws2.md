---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: SettingsPage.tsx 新建

**范围**: 新建统一设置入口页 SettingsPage.tsx，卡片式布局：License 卡片 + 管理员专区卡片（isSuperAdmin 条件渲染）
**大小**: S（净增 ~80 行，1 文件）
**依赖**: Workstream 1 完成（pageComponents 已注册 'SettingsPage'）

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/SettingsPage.tsx` 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/SettingsPage.tsx');console.log('OK')"

- [ ] [ARTIFACT] SettingsPage.tsx 导出 default 函数（export default SettingsPage）
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/pages/SettingsPage.tsx','utf8');if(!s.includes('export default'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SettingsPage.tsx 包含 Link 组件到 /license
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/pages/SettingsPage.tsx','utf8');if(!s.includes('to=\"/license\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] SettingsPage.tsx 使用 useAuth hook 读取 isSuperAdmin
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/pages/SettingsPage.tsx','utf8');if(!s.includes('useAuth'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令 — 模式A: file-level；模式B: Playwright）

- [ ] [BEHAVIOR] SettingsPage License 卡片链接正确指向 /license（字段值验证）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/SettingsPage.tsx\",\"utf8\");if(!s.includes(\"to=\\\"/license\\\"\")){console.error(\"FAIL: License 卡片 link 缺失\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] SettingsPage 含 isSuperAdmin 条件渲染管理员专区（完整性验证）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/SettingsPage.tsx\",\"utf8\");if(!s.includes(\"isSuperAdmin\")){console.error(\"FAIL: isSuperAdmin 条件缺失\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] SettingsPage 无条件区域不包含裸露的 /admin/license 或 /admin/users 链接（禁用字段反向 — 必须在 isSuperAdmin 条件块内）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/SettingsPage.tsx\",\"utf8\");const lines=s.split(\"\\n\");let inAdmin=false;for(const l of lines){if(l.includes(\"isSuperAdmin\"))inAdmin=true;if(!inAdmin&&(l.includes(\"/admin/license\")||l.includes(\"/admin/users\"))){console.error(\"FAIL: admin 链接出现在条件块外\");process.exit(1);}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] Playwright E2E — /settings 页面 License 卡片可见，非 super admin 不见管理员专区卡片（error path 权限边界）；使用 poll 等待取代固定 sleep 防启动超时（R1 缓解）
  Test: manual:bash -c 'cd apps/dashboard && VITE_SKIP_AUTH=true npx vite --port 5173 & DEV_PID=$! && for i in $(seq 1 30); do curl -sf http://localhost:5173/ >/dev/null 2>&1 && break; sleep 1; done && npx playwright test e2e/settings-sidebar.spec.ts --reporter=line; RESULT=$?; kill $DEV_PID 2>/dev/null; exit $RESULT'
  期望: exit 0，4 test 全通过
