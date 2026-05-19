---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: navigation.config.ts 拆3组 + InstanceContext feature 注册

**范围**: autopilotNavGroups 从单组改为3命名分组；/license /admin/* 移出主导航；/settings 加入"系统"组；SettingsPage 注册到 pageComponents；'settings' feature flag 注册
**大小**: S（净变更 < 80 行，2 文件）
**依赖**: 无（TDD Red E2E 先于此 commit 写入）

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 包含字符串"核心功能"
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!s.includes('核心功能'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 包含字符串"账号绑定"
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!s.includes('账号绑定'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 包含字符串"系统"（分组标题）
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!s.includes(\"title: '系统'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 注册了 SettingsPage 组件
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!s.includes(\"'SettingsPage'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/contexts/InstanceContext.tsx` 含 'settings': true
  Test: node -e "const s=require('fs').readFileSync('apps/dashboard/src/contexts/InstanceContext.tsx','utf8');if(!s.includes(\"'settings': true\"))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令 — 模式A API-level，user_facing pure frontend）

- [ ] [BEHAVIOR] autopilotNavGroups 导出恰好 3 个分组（3 个 { title, items } 对象）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");const m=s.match(/title:/g);if(!m||m.length<3){console.error(\"FAIL: 分组数量\",m?.length);process.exit(1);}console.log(\"OK 分组数\",m.length)"'
  期望: OK

- [ ] [BEHAVIOR] 3 个分组标题完整（核心功能 / 账号绑定 / 系统 全部出现在 navGroups 块）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");const navBlock=s.split(\"export const additionalRoutes\")[0];[\"核心功能\",\"账号绑定\",\"系统\"].forEach(t=>{if(!navBlock.includes(t)){console.error(\"FAIL: 缺\",t);process.exit(1);}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] /settings 路径出现在 autopilotNavGroups（主导航块）中
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");const navBlock=s.split(\"export const additionalRoutes\")[0];if(!navBlock.includes(\"/settings\")){console.error(\"FAIL: /settings 未在主导航\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] /license 不在主导航分组 items 中（已移至 additionalRoutes 或完全移除）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");const navBlock=s.split(\"export const additionalRoutes\")[0];if(navBlock.includes(\"path: '"'"'/license'"'"'\")&&!navBlock.includes(\"redirect\")){console.error(\"FAIL: /license 仍在主导航\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] /admin/license 和 /admin/users 不在 autopilotNavGroups items 中
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");const navBlock=s.split(\"export const additionalRoutes\")[0];if(navBlock.includes(\"/admin/license\")||navBlock.includes(\"/admin/users\")){console.error(\"FAIL: admin 路由仍在主导航\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
