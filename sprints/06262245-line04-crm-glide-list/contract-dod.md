---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Line 04 CRM 客户列表页 Glide 重做（第一刀·仅列表）

**范围**: 仅前端。`CustomerListPage` 裸 HTML 表 → Glide Data Grid 暗色运营台；接既有 `GET /api/crm/customers` 真数据；加搜索 + A1-A5 意向筛选 + 身份筛选（纯前端过滤）+「N 位客户」计数实时同步。详情页/全屏/后端改动不在范围。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] Glide 依赖入 package.json（@glideapps/glide-data-grid，MIT）
  Test: node -e "const p=require('./apps/dashboard/package.json'); if(!(p.dependencies&&p.dependencies['@glideapps/glide-data-grid'])) process.exit(1)"

- [ ] [ARTIFACT] package-lock 同步含 glide（供 CI npm ci 可装）
  Test: node -e "const l=require('fs').readFileSync('apps/dashboard/package-lock.json','utf8'); if(!l.includes('@glideapps/glide-data-grid')) process.exit(1)"

- [ ] [ARTIFACT] CustomerListPage 必须 import Glide index.css（否则 canvas 空白·踩坑）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CustomerListPage.tsx','utf8'); if(!c.includes('@glideapps/glide-data-grid/dist/index.css')) process.exit(1)"

- [ ] [ARTIFACT] 纯过滤函数抽成独立模块（可单测、DRY）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/crm/customerFilter.ts','utf8'); if(!/export function filterCustomers/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] 本刀专属 windows e2e workflow + smoke 接入 CI
  Test: node -e "const fs=require('fs'); if(!fs.existsSync('.github/workflows/e2e-line04-crm-glide-list.yml')) process.exit(1); if(!fs.existsSync('.github/workflows/scripts/smoke/line04-crm-glide-list-smoke.sh')) process.exit(1); const w=fs.readFileSync('.github/workflows/e2e-line04-crm-glide-list.yml','utf8'); if(!w.includes('windows-latest')||!w.includes('e2e-verify.ps1')) process.exit(1)"

## BEHAVIOR 条目（逻辑断言 — 环境无关，CI/vitest 绿 = done；内嵌 manual:bash）

- [ ] [BEHAVIOR] 搜索过滤：name 或 wechat_id 子串、大小写不敏感（Golden Path Step 2）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/crm/__tests__/customerFilter.test.ts -t "搜索" 2>&1 | tail -5; exit ${PIPESTATUS[0]}'
  期望: exit 0（搜索 "wx_001"/"WX_001" 均命中 1 行；空搜索返回全部）

- [ ] [BEHAVIOR] 意向过滤：A1-A5 集合，空集合=全部（Golden Path Step 3）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/crm/__tests__/customerFilter.test.ts -t "意向" 2>&1 | tail -5; exit ${PIPESTATUS[0]}'
  期望: exit 0（intents=["A4"] → 仅 status==A4 行；intents=[] → 全部）

- [ ] [BEHAVIOR] 身份过滤 + 组合 AND（意向∩身份∩搜索）（Golden Path Step 3）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/crm/__tests__/customerFilter.test.ts -t "身份" 2>&1 | tail -5; exit ${PIPESTATUS[0]}'
  期望: exit 0（identities=["blacklist"] → 仅 blacklist 行；与意向/搜索 AND 交集）

- [ ] [BEHAVIOR] 组件 crm-count 随搜索/意向/身份交互实时同步（jsdom，Golden Path Step 1-3 计数）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/__tests__/CustomerListPage.test.tsx -t "计数" 2>&1 | tail -5; exit ${PIPESTATUS[0]}'
  期望: exit 0（输入搜索/点 chip 后 crm-count 文本数值随过滤变化）

- [ ] [BEHAVIOR] 边界：空数据 → count=0 + crm-empty 容器在，不报错（PRD 边界情况）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/__tests__/CustomerListPage.test.tsx -t "空数据" 2>&1 | tail -5; exit ${PIPESTATUS[0]}'
  期望: exit 0

- [ ] [BEHAVIOR] 边界：GET /customers 401 → crm-auth-expired 可见不白屏（PRD 边界情况，降级保留）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/__tests__/CustomerListPage.test.tsx -t "401" 2>&1 | tail -5; exit ${PIPESTATUS[0]}'
  期望: exit 0

- [ ] [BEHAVIOR] 不回归：per-operator 既有行为保留（无选客服机下拉 / GET /customers 无超管头无 cs_wechat_id / 立即扫好友带后端 cs_wechat_id）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/__tests__/CustomerListPage.test.tsx 2>&1 | tail -8; exit ${PIPESTATUS[0]}'
  期望: exit 0（整份组件测全绿，含既有 per-operator 套件）

## BEHAVIOR:E2E 条目（接缝断言 — 真目标 windows_cloud Playwright 跑，CI 绿 ≠ done；evaluator 模式 B 执行 e2e-verify.ps1）

- [ ] [BEHAVIOR:E2E] 接缝 S1+S2+S3：Glide canvas 渲染真数据 + 计数随真交互三筛同步 + 点首行姓名格跳详情路由，截图视觉自验
  Test: manual:bash -c 'echo "windows_cloud only: evaluator 在 GHA windows-latest 跑 sprints/06262245-line04-crm-glide-list/e2e-verify.ps1（Playwright e2e/crm-glide-list.spec.ts）"; exit 0'
  Screenshots:
    - 01-initial.png   期望：暗色运营台，搜索框 + A1-A5 意向条 + 身份筛选 + Glide canvas 客户表可见，crm-count 显示「2 位客户」
    - 02-action.png    期望：搜索框输入后 grid 只剩匹配行，crm-count 降到匹配数
    - 03-result.png    期望：点意向/身份 chip 后 grid 过滤、crm-count 相应变化（chip 选中态可见）
    - 04-navigate.png  期望：点首行姓名格后 URL 跳到 /wechat/crm/<contact>（详情页路由）
    - 05-empty.png     期望：空数据时 crm-count 显示 0 + 空态容器在，不白屏不报错
  期望：e2e-verify.ps1 exit 0；所有截图与期望描述一致，Claude Read 图自验通过；CSS 未 import → canvas 空白 → boundingBox 校验 FAIL（不会假绿）

> 接缝清单（contract-draft.md ## 接缝清单 S1/S2/S3）未在 windows_cloud 真目标验过 → 该接缝标 logic-done-pending，**不得标 done**。逻辑断言（filterCustomers + 组件计数）CI 绿即 done。
