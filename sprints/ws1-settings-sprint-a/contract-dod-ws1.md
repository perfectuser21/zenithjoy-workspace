---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: navigation.config.ts 分组重构 + AdminSettingsPage 接入

**范围**: 修改 `apps/dashboard/src/config/navigation.config.ts`，拆分 autopilotNavGroups 为 3 个有标题分组，加入 AdminSettingsPage 映射和系统设置 NavItem
**大小**: S（< 80 行净变更）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] navigation.config.ts 的 autopilotNavGroups 含 3 个 NavGroup 对象（每个有非空 title）
  Test: node -e "const fs=require('fs');const src=fs.readFileSync('/workspace/apps/dashboard/src/config/navigation.config.ts','utf8');const m=src.match(/title:\s*'[^']+'/g)||[];if(m.length<3){console.error('FAIL: 非空title分组数='+m.length);process.exit(1)}console.log('OK 分组数:'+m.length)"

- [ ] [ARTIFACT] autopilotPageComponents 对象含 key 'AdminSettingsPage' 的懒加载函数
  Test: node -e "const fs=require('fs');const src=fs.readFileSync('/workspace/apps/dashboard/src/config/navigation.config.ts','utf8');if(!src.includes(\"'AdminSettingsPage'\")){console.error('FAIL: AdminSettingsPage 未在 pageComponents 映射');process.exit(1)}console.log('OK: AdminSettingsPage 映射存在')"

- [ ] [ARTIFACT] Settings 图标已从 lucide-react 导入（系统设置 NavItem 所需）
  Test: node -e "const fs=require('fs');const src=fs.readFileSync('/workspace/apps/dashboard/src/config/navigation.config.ts','utf8');if(!src.match(/Settings[,\s]/)){console.error('FAIL: Settings icon 未导入');process.exit(1)}console.log('OK: Settings icon 已导入')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

模式A — evaluator 逐 ws 跑（user_facing 静态配置断言，无需运行服务器）：

- [ ] [BEHAVIOR] navigation.config.ts 有 3 个非空 title 分组（分组拆分已完成）
  Test: manual:bash -c 'COUNT=$(grep -E "title: '\''[^'\'']+'\''" /workspace/apps/dashboard/src/config/navigation.config.ts | wc -l | tr -d " "); [ "$COUNT" -ge 3 ] || { echo "FAIL: 非空title分组数=$COUNT，期望>=3"; exit 1; }; echo "OK: $COUNT 个有标题分组"'
  期望: OK: 3 个有标题分组

- [ ] [BEHAVIOR] 旧空 title 扁平分组不再存在（历史格式已清除）
  Test: manual:bash -c 'EMPTY=$(grep -c "title: '\'\''" /workspace/apps/dashboard/src/config/navigation.config.ts || echo 0); [ "$EMPTY" -eq 0 ] || { echo "FAIL: 仍有 $EMPTY 处 title='\'''\'' 空分组，旧格式未清除"; exit 1; }; echo "OK: 空title分组已清除"'
  期望: OK: 空title分组已清除

- [ ] [BEHAVIOR] 系统设置 NavItem 存在（featureKey=admin-settings，path=/settings）
  Test: manual:bash -c 'FEAT=$(grep -c "admin-settings" /workspace/apps/dashboard/src/config/navigation.config.ts || echo 0); PATH_COUNT=$(grep -c "path: '\''/settings'\''" /workspace/apps/dashboard/src/config/navigation.config.ts || echo 0); [ "$FEAT" -ge 1 ] || { echo "FAIL: featureKey admin-settings 未找到"; exit 1; }; [ "$PATH_COUNT" -ge 1 ] || { echo "FAIL: path /settings 未找到"; exit 1; }; echo "OK: 系统设置 NavItem 存在 feat=$FEAT path=$PATH_COUNT"'
  期望: OK: 系统设置 NavItem 存在

- [ ] [BEHAVIOR] requireSuperAdmin 权限条目（License管理/会员管理）保留未丢失
  Test: manual:bash -c 'ADMIN=$(grep -c "requireSuperAdmin: true" /workspace/apps/dashboard/src/config/navigation.config.ts || echo 0); [ "$ADMIN" -ge 2 ] || { echo "FAIL: requireSuperAdmin 条目丢失，当前仅 $ADMIN 个，期望>=2"; exit 1; }; echo "OK: $ADMIN 个 requireSuperAdmin 条目保留"'
  期望: OK: 2 个 requireSuperAdmin 条目保留

- [ ] [BEHAVIOR] AdminSettingsPage 已加入 pageComponents 映射（路由 /settings 可渲染）
  Test: manual:bash -c 'MAPPING=$(grep -c "AdminSettingsPage" /workspace/apps/dashboard/src/config/navigation.config.ts || echo 0); [ "$MAPPING" -ge 2 ] || { echo "FAIL: AdminSettingsPage 出现次数=$MAPPING，期望>=2（key定义+import两处）"; exit 1; }; echo "OK: AdminSettingsPage 在 pageComponents 中映射，出现 $MAPPING 次"'
  期望: OK: AdminSettingsPage 在 pageComponents 中映射

模式B — final-e2e（Playwright 真实浏览器，写在 contract-draft.md ## E2E 验收区块）
