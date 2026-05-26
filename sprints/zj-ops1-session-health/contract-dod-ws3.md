---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: OperatorPage.tsx 新建 + navigation.config.ts 路由注册

**范围**: 新建 `apps/dashboard/src/pages/OperatorPage.tsx`（is_operator 权限守卫 + 8平台×4账号状态矩阵 + 手动触发按钮）；更新 `apps/dashboard/src/config/navigation.config.ts`（懒加载映射 + /operator 路由）
**大小**: M（~165 行净增，2 文件）
**依赖**: Workstream 2 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/OperatorPage.tsx` 文件存在（新建页面组件）
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/OperatorPage.tsx');console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 含 OperatorPage 懒加载映射条目
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!c.includes('OperatorPage'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] OperatorPage.tsx 存在且包含 is_operator 权限判断（邮件匹配或角色标志）
  Test: manual:bash -c 'node -e "
require(\"fs\").accessSync(\"apps/dashboard/src/pages/OperatorPage.tsx\");
const code = require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");
if (!code.includes(\"xuxiao21xx@icloud.com\") && !code.includes(\"is_operator\") && !code.includes(\"isOperator\")) {
  console.error(\"FAIL: OperatorPage 缺少 operator 权限判断\");
  process.exit(1);
}
console.log(\"OK: 含 operator 权限判断\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] OperatorPage.tsx 包含状态矩阵 UI 结构（🟢🔴⚫ 或等价 CSS 类）
  Test: manual:bash -c 'node -e "
const code = require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");
// 检查含平台状态展示逻辑（状态灯/status/green/red 等关键词）
const hasStatusDisplay = code.includes(\"🟢\") || code.includes(\"🔴\") || code.includes(\"⚫\") ||
  code.includes(\"status\") && (code.includes(\"green\") || code.includes(\"online\") || code.includes(\"offline\"));
if (!hasStatusDisplay) {
  console.error(\"FAIL: OperatorPage 缺少状态矩阵显示逻辑\");
  process.exit(1);
}
// 检查含多平台数据结构（数组/map 遍历）
const hasMultiPlatform = code.includes(\"PLATFORMS\") || code.includes(\"platforms\") || code.includes(\".map(\");
if (!hasMultiPlatform) {
  console.error(\"FAIL: OperatorPage 缺少多平台遍历结构\");
  process.exit(1);
}
console.log(\"OK: 状态矩阵 UI 存在\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] navigation.config.ts 包含 /operator 路由注册
  Test: manual:bash -c 'node -e "
const nav = require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");
if (!nav.includes(\"/operator\")) {
  console.error(\"FAIL: navigation.config 缺 /operator 路由\");
  process.exit(1);
}
if (!nav.includes(\"OperatorPage\")) {
  console.error(\"FAIL: navigation.config 缺 OperatorPage 组件引用\");
  process.exit(1);
}
console.log(\"OK: /operator 路由已注册\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] OperatorPage.tsx 包含手动触发同步按钮（核心交互元素验证）
  Test: manual:bash -c 'node -e "
const code = require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");
const hasButton = code.includes(\"手动触发\") || code.includes(\"触发同步\") || code.includes(\"sync\") && code.includes(\"button\") || code.includes(\"Button\") && (code.includes(\"sync\") || code.includes(\"Sync\") || code.includes(\"同步\"));
if (!hasButton) {
  console.error(\"FAIL: OperatorPage 缺少手动触发同步按钮\");
  process.exit(1);
}
console.log(\"OK: 手动触发按钮存在\");
"'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] error path — 非 operator 用户有访问保护（重定向或 403 提示，不显示敏感数据）
  Test: manual:bash -c 'node -e "
const code = require(\"fs\").readFileSync(\"apps/dashboard/src/pages/OperatorPage.tsx\",\"utf8\");
// 检查含权限拒绝逻辑（navigate/redirect/return null/无权限提示）
const hasAccessDenied = code.includes(\"navigate\") || code.includes(\"redirect\") ||
  code.includes(\"无权限\") || code.includes(\"Access Denied\") || code.includes(\"return null\");
if (!hasAccessDenied) {
  console.error(\"FAIL: OperatorPage 缺少非 operator 用户访问保护\");
  process.exit(1);
}
console.log(\"OK: 含访问保护逻辑\");
"'
  期望: OK（exit 0）

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Operator 面板完整交互流程（windows_cloud 环境文件完整性验证，无法启动真实 UI）
  Screenshots:
    - ws3-01-operator-page-exists.png  期望：OperatorPage.tsx 文件内容截图（含权限判断代码可见）
    - ws3-02-nav-config-route.png      期望：navigation.config.ts 中 /operator 路由条目可见
  期望：所有文件验证通过，e2e-verify.ps1 Step 5/6 PASS
