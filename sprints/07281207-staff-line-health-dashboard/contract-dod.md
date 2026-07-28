---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Staff Hub 业务线健康看板（GP3 / line_health）

**范围**: `GET /api/staff/line-health` 系列 3 个端点、Staff Hub 总览页、详情页两个 tab（部署/能力）、四类降级路径（not_connected / degraded / product-map fallback / 未知 lineKey 404）、Playwright E2E
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/staff.ts` 新增 3 个路由：`GET /line-health`、`GET /line-health/:lineKey/deployment`、`GET /line-health/:lineKey/abilities`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/staff.ts','utf8');if(!(c.includes(\"'/line-health'\")&&c.includes('/line-health/:lineKey/deployment')&&c.includes('/line-health/:lineKey/abilities')))process.exit(1)"

- [ ] [ARTIFACT] `apps/staff-hub/src/pages/LineHealthPage.tsx` 新建，风格照抄 `PathHealthPage.tsx`
  Test: node -e "const c=require('fs').readFileSync('apps/staff-hub/src/pages/LineHealthPage.tsx','utf8');if(!c.includes('line-health'))process.exit(1)"

- [ ] [ARTIFACT] `apps/staff-hub/src/pages/LineHealthDetailPage.tsx` 新建，含部署/能力两个 tab
  Test: node -e "const c=require('fs').readFileSync('apps/staff-hub/src/pages/LineHealthDetailPage.tsx','utf8');if(!(c.includes('deployment')&&c.includes('abilities')))process.exit(1)"

- [ ] [ARTIFACT] `apps/staff-hub` 路由注册 `/line-health` 与 `/line-health/:lineKey`，接入 staffGuard 保护体系（前端路由本身不需要额外鉴权，但需确认已挂载在 `Shell()` 已登录分支内，与 `path-health` 同级）
  Test: node -e "const c=require('fs').readFileSync('apps/staff-hub/src/App.tsx','utf8');if(!(c.includes('/line-health')&&c.includes('LineHealthPage')&&c.includes('LineHealthDetailPage')))process.exit(1)"

- [ ] [ARTIFACT] `apps/staff-hub/e2e/line-health.spec.ts` 新建，Playwright E2E
  Test: node -e "const c=require('fs').readFileSync('apps/staff-hub/e2e/line-health.spec.ts','utf8');if(c.includes('page.route('))process.exit(1);if(!c.includes('line-health'))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/e2e-staff-line-health-windows.yml` 新建，双 job（ubuntu PR 快反馈 + windows_dispatch 深验）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-staff-line-health-windows.yml','utf8');if(!(c.includes('windows-latest')&&c.includes('line-health')))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/routes/__tests__/staff.test.ts` 新增本 sprint 测试用例，且不破坏既有 `path-health` 测试
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/__tests__/staff.test.ts','utf8');if(!c.includes('line-health'))process.exit(1)"

- [ ] [ARTIFACT] `apps/staff-hub` 补齐 Playwright 可运行环境（Reviewer r1 非阻塞建议5：当前 `apps/staff-hub/package.json` 无 `@playwright/test` devDependency 且无 `playwright.config.ts`，与已具备该环境的 `apps/dashboard` 不同，须先补齐避免留到 final-e2e 才暴雷）：`package.json` 新增 `@playwright/test` devDependency + 新建 `apps/staff-hub/playwright.config.ts`（可参照 `apps/dashboard/playwright.config.ts` 结构，baseURL 改用 5175 端口对齐本 sprint `e2e-verify.ps1`）
  Test: node -e "const pkg=require('fs').readFileSync('apps/staff-hub/package.json','utf8');if(!pkg.includes('@playwright/test'))process.exit(1);require('fs').accessSync('apps/staff-hub/playwright.config.ts')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，假设 `apps/api` 已在 localhost:3000 启动）

- [ ] [BEHAVIOR] GET /api/staff/line-health 返回 line01/line02/line04 三条，line01 标 not_connected 而非 0/0
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e ".data | length == 3" && echo "$RESP" | jq -e ".data[] | select(.line_key==\"line01\") | .availability == \"not_connected\""'
  期望: exit 0

- [ ] [BEHAVIOR] line01/line02 maturity 字面为 not_connected 且 journey_id 为 null（判定点1，非靠0/0反推）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e ".data[] | select(.line_key==\"line02\") | .maturity == \"not_connected\" and .journey_id == null"'
  期望: exit 0

- [ ] [BEHAVIOR] 总览卡片 schema keys 完整性 — 顶层字段集合恒等于约定集合（防字段漂移）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data[0] | keys | sort) == ([\"availability\",\"feature_counts\",\"journey_id\",\"journey_name\",\"label\",\"line_key\",\"maturity\",\"message\",\"smoke\"] | sort)"'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段名反向检查 — 总览卡片不得出现 path_key/health/status 字段
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data[0] | has(\"path_key\") | not) and (.data[0] | has(\"health\") | not) and (.data[0] | has(\"status\") | not)"'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 无认证头访问 GET /api/staff/line-health 返回 403
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health); [ "$CODE" = "403" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 未知 lineKey 访问 deployment/abilities 均返回 404（非静默200空数据）
  Test: manual:bash -c 'C1=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/bogus/deployment -H "X-User-Email: staff@test.com"); C2=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/bogus/abilities -H "X-User-Email: staff@test.com"); [ "$C1" = "404" ] && [ "$C2" = "404" ]'
  期望: exit 0

- [ ] [BEHAVIOR] deployment 端点返回三环境状态 + related_prs 恒为数组类型
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data.environments | length == 3) and (.data.related_prs | type == \"array\")"'
  期望: exit 0

- [ ] [BEHAVIOR] not_connected 线（line01）两个 tab 均返回 200 空态，message 字面等于约定文案（判定点2）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line01/deployment -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e ".data.connected == false and .data.message == \"该业务线尚未接入 Brain 数据，暂无法展示\" and (.data.environments == [])"'
  期望: exit 0

- [ ] [BEHAVIOR] abilities 端点返回数组，每项字段齐全（id/name/status/thickness）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/abilities -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data.abilities | type == \"array\") and (all(.data.abilities[]; has(\"thickness\") and has(\"status\") and has(\"id\") and has(\"name\")))"'
  期望: exit 0

- [ ] [BEHAVIOR] Rule B 第三方真调一次 — GitHub 真实 API 可达，且 production commit_sha 若非空必须匹配真实40位hex格式（非硬编码假值）
  Test: manual:bash -c 'GH=$(curl -sf "https://api.github.com/repos/perfectuser21/zenithjoy-workspace/commits?sha=main&per_page=1"); echo "$GH" | jq -e ".[0].sha | type == \"string\" and (length == 40)"; RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data.environments[] | select(.name==\"production\") | .commit_sha) as \$s | (\$s == null) or (\$s | test(\"^[0-9a-f]{40}\$\"))"'
  期望: exit 0

- [ ] [BEHAVIOR] deployment/abilities 两个新端点均挂 staffGuard（无认证头同样403，不遗漏）
  Test: manual:bash -c 'C1=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/line04/deployment); C2=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/staff/line-health/line04/abilities); [ "$C1" = "403" ] && [ "$C2" = "403" ]'
  期望: exit 0

- [ ] [BEHAVIOR] dev/staging 陈旧分支不得显示为 active（Reviewer r1 必须修复项1）——当前仓库 develop（末次提交2026-03-07）与 release/cs-stable（末次提交2026-06-23）均已超过30天陈旧阈值，是真实存在的真机验证场景
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data.environments[] | select(.name==\"dev\") | .status) != \"active\"" && echo "$RESP" | jq -e "(.data.environments[] | select(.name==\"staging\") | .status) != \"active\""'
  期望: exit 0

- [ ] [BEHAVIOR] recent_commit 字段存在且与 environments 中 production 项一致（Reviewer r1 必须修复项3）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e ".data | has(\"recent_commit\")" && echo "$RESP" | jq -e "((.data.recent_commit == null) and ((.data.environments[] | select(.name==\"production\") | .commit_sha) == null)) or (.data.recent_commit.sha == (.data.environments[] | select(.name==\"production\") | .commit_sha))"'
  期望: exit 0

- [ ] [BEHAVIOR] deployment 端点禁用字段反向检查 — 不得出现 deploy_version/version（Reviewer r1 必须修复项4）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/deployment -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data | has(\"deploy_version\") | not) and (.data | has(\"version\") | not)"'
  期望: exit 0

- [ ] [BEHAVIOR] abilities 端点禁用字段反向检查 — 不得出现 features（Reviewer r1 必须修复项4）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:3000/api/staff/line-health/line04/abilities -H "X-User-Email: staff@test.com"); echo "$RESP" | jq -e "(.data | has(\"features\") | not)"'
  期望: exit 0

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，windows_cloud + Playwright）

- [ ] [BEHAVIOR:E2E] 员工完整走完总览→详情→部署tab→能力tab→返回的 Golden Path，截图可视化验证
  Screenshots:
    - 01-overview.png     期望：`/line-health` 总览页渲染 3 张卡片，line01/line02 显示"未接入"灰色徽章，line04 显示 maturity/done/total
    - 02-detail-deploy.png 期望：点击 line04 卡片后 `/line-health/line04` 详情页默认打开"部署"tab，三环境状态区块可见
    - 03-detail-abilities.png 期望：切换到"能力"tab，能力清单渲染（或 windows_cloud 沙盒 Brain 不可达时的"数据暂不可达"降级文案，二者均可）
    - 04-fallback-banner.png 期望：product-map.json 缺失场景下页面顶部出现降级 banner 提示，而非白屏/控制台报错
  路径格式：`sprints/07281207-staff-line-health-dashboard/screenshots/<step>.png`
  期望：evaluator 完成后截图已复制到 `sprints/07281207-staff-line-health-dashboard/screenshots/` 目录

## 未覆盖真实链路清单（同 contract-draft.md，重复登记以便 evaluator 单独核对本文件时不漏看）

1. vitest 单测（`apps/api/src/routes/__tests__/staff.test.ts`）中 Brain(`axios.get` journey_features) 与 GitHub(`axios.get` REST API) 两个第三方依赖打桩，延续该文件既有 `path-health` 测试模式；真验证补位由本文件 BEHAVIOR 段的真实 curl 命令承担（针对已启动的真实 `apps/api` 进程，未被 mock）。
2. windows_cloud final-e2e 中 `CECELIA_BRAIN_URL` 默认未配置真实可达地址（GHA windows-latest 沙盒无法直连内网 Brain，且不可修改共享 `.github/workflows/e2e-windows.yml` 注入新 secret）；line04 能力 tab 在该场景下允许降级为"数据暂不可达"文案，`logic-done-pending`，真实 Brain 数据的完整验证留给 evaluator 模式A（ubuntu-latest，本机/CI 可达 Brain）与 staging 人工验收。
3. 陈旧阈值判定（30天边界）与 GitHub 数据缓存 TTL 两个 NFR 的内部逻辑（Reviewer r1 必须修复项1/2）：前者靠 vitest `githubMockOverride` 局部覆盖单条 GitHub 请求返回虚拟旧 `commit_date` 验证边界判定，后者靠 `githubRealGetSpy` 计数两次连续请求是否复用同一次真实网络调用，均无法用简单 curl 命令控制"提交日期"或精确观测"是否真的省了一次网络调用"。真验证补位：本文件上方新增的 `dev/staging 陈旧分支不得显示为 active` 一条 [BEHAVIOR] 直接用当前仓库真实 `develop`/`release/cs-stable`（均已陈旧超30天）验证"不误判为 active"这一具体事实，作为陈旧阈值逻辑的真实世界补充验证（不依赖 mock）；缓存 TTL 的通用验证仅在 vitest 层覆盖。
