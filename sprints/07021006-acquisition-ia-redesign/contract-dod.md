---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 获客工作台 IA 重构（Hub 4卡片 + AccountsPage + TasksPage两级）

**范围**: Hub 4模块卡片改版 + AccountsPage(新建) + TasksPage两级(改接 acquisition_collect_tasks + 新建 TaskDetailPage) + acquisition_collect_videos 表 + 两个新 GET API + LeadsPage 移除采集面板 + agent 视频元数据选择器
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx` 存在且含 4 模块卡片
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx','utf8');if(!c.includes('hub-module-card'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/AccountsPage.tsx` 新建存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/acquisition/AccountsPage.tsx')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/TasksPage.tsx` 存在且接 acquisition_collect_tasks
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/acquisition/TasksPage.tsx','utf8');if(!c.includes('collect-tasks'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx` 新建存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx')"

- [ ] [ARTIFACT] DB migration 文件存在（含 `acquisition_collect_videos` 建表 + `line02_account_sessions.health` 加 'banned'）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const m=files.filter(f=>f.includes('acquisition_collect_videos'));if(m.length===0)process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/routes/acquisition.ts` 包含新端点 `/burner-accounts` 和 `/collect-tasks/:taskId/videos`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('burner-accounts')||!c.includes('collect-tasks/:taskId/videos'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/LeadsPage.tsx` 不含采集面板代码
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');const forbidden=['setAcqPhase','handleCollect','manualInput','acqPhase'];const found=forbidden.filter(s=>c.includes(s));if(found.length>0){console.error('FAIL: 仍含采集面板代码',found);process.exit(1)}"

- [ ] [ARTIFACT] `apps/dashboard/e2e/acquisition-ia-redesign.spec.ts` 存在且不含 `page.route(`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/acquisition-ia-redesign.spec.ts','utf8');if(c.includes('page.route('))process.exit(1)"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

### Mode A BEHAVIOR（API-level — evaluator 逐 ws 验）

- [ ] [BEHAVIOR] GET /api/acquisition/burner-accounts 返回正确 schema（success + data.accounts array + data.total + keys 匹配）
  Test: manual:bash -c '
    RESP=$(curl -sf -H "X-Tenant-Id: test-tenant-e2e" http://localhost:3000/api/acquisition/burner-accounts 2>/dev/null) || { echo "FAIL: 端点返回非 200 或不可达"; exit 1; }
    echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success 非 true"; exit 1; }
    echo "$RESP" | jq -e ".data.accounts | type == \"array\"" || { echo "FAIL: data.accounts 非 array"; exit 1; }
    echo "$RESP" | jq -e ".data | has(\"total\")" || { echo "FAIL: data.total 缺失"; exit 1; }
    echo "$RESP" | jq -e "keys == [\"data\",\"success\",\"timestamp\"]" || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
    echo "$RESP" | jq -e "has(\"sessions\") | not" || { echo "FAIL: 禁用字段 sessions 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"burners\") | not" || { echo "FAIL: 禁用字段 burners 出现"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos（seeded taskId）返回正确 schema
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://localhost/zenithjoy_test}"
    TID=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.tenants LIMIT 1" 2>/dev/null | tr -d " ") || TID=""
    if [ -z "$TID" ]; then echo "SKIP: 无 tenant，跳过视频端点 schema 检查"; exit 0; fi
    TASK_ID=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='"'"'$TID'"'"' LIMIT 1" 2>/dev/null | tr -d " ") || TASK_ID=""
    if [ -z "$TASK_ID" ]; then echo "SKIP: 无 collect_task，跳过"; exit 0; fi
    RESP=$(curl -sf -H "X-Tenant-Id: $TID" "http://localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos") || { echo "FAIL: 端点不可达"; exit 1; }
    echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success 非 true"; exit 1; }
    echo "$RESP" | jq -e ".data.videos | type == \"array\"" || { echo "FAIL: data.videos 非 array"; exit 1; }
    echo "$RESP" | jq -e ".data | has(\"total\")" || { echo "FAIL: data.total 缺失"; exit 1; }
    echo "$RESP" | jq -e "keys == [\"data\",\"success\",\"timestamp\"]" || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
    echo "$RESP" | jq -e "has(\"results\") | not" || { echo "FAIL: 禁用字段 results 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"items\") | not" || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 非法 taskId → HTTP 404 + error.code TASK_NOT_FOUND
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: test-tenant-e2e" "http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos")
    [ "$CODE" = "404" ] || { echo "FAIL: 非法 taskId 应返 404，实际=$CODE"; exit 1; }
    BODY=$(curl -sf -H "X-Tenant-Id: test-tenant-e2e" "http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos" 2>/dev/null || echo "{}")
    echo "$BODY" | jq -e ".error.code == \"TASK_NOT_FOUND\"" || { echo "FAIL: error.code 非 TASK_NOT_FOUND"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] 跨 tenant 访问 collect-tasks/:taskId/videos → HTTP 403 或 401（IDOR 安全保证）
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://localhost/zenithjoy_test}"
    # 取两个不同的 tenant
    TID_A=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.tenants ORDER BY created_at ASC LIMIT 1" 2>/dev/null | tr -d " ")
    TID_B=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.tenants ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d " ")
    if [ -z "$TID_A" ] || [ -z "$TID_B" ] || [ "$TID_A" = "$TID_B" ]; then
      echo "SKIP: 无法构造两个不同 tenant，跳过 IDOR 检查"
      exit 0
    fi
    TASK_ID_A=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='"'"'$TID_A'"'"' LIMIT 1" 2>/dev/null | tr -d " ")
    if [ -z "$TASK_ID_A" ]; then echo "SKIP: TID_A 无 task，跳过"; exit 0; fi
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: $TID_B" "http://localhost:3000/api/acquisition/collect-tasks/$TASK_ID_A/videos")
    [ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { echo "FAIL: 跨 tenant 访问应返 401/403，实际=$CODE"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] acquisition_collect_videos 表 schema 正确（含必要列）
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://localhost/zenithjoy_test}"
    COLS=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'acquisition_collect_videos'"'"'" 2>/dev/null | tr -d " " | sort)
    echo "acquisition_collect_videos 列: $COLS"
    echo "$COLS" | grep -q "video_id" || { echo "FAIL: 缺 video_id 列"; exit 1; }
    echo "$COLS" | grep -q "task_id" || { echo "FAIL: 缺 task_id 列"; exit 1; }
    echo "$COLS" | grep -q "video_url" || { echo "FAIL: 缺 video_url 列"; exit 1; }
    echo "$COLS" | grep -q "title" || { echo "FAIL: 缺 title 列"; exit 1; }
    echo "$COLS" | grep -q "cover_url" || { echo "FAIL: 缺 cover_url 列"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] LeadsPage.tsx 不含采集面板残留代码（静态文件检查）
  Test: manual:bash -c '
    node -e "
    const fs = require(\"fs\");
    const c = fs.readFileSync(\"apps/dashboard/src/pages/LeadsPage.tsx\", \"utf8\");
    const forbidden = [\"setAcqPhase\", \"handleCollect\", \"manualInput\", \"collect/expand\", \"collect/start\"];
    const found = forbidden.filter(s => c.includes(s));
    if (found.length > 0) { console.error(\"FAIL: 仍含采集面板代码:\", found); process.exit(1); }
    console.log(\"OK\");
    "'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing Mode B — evaluator 跑 e2e-verify.ps1）

- [ ] [BEHAVIOR:E2E] 完整 Golden Path UI 验证（Hub 4卡片→账号管理→采集任务→触达验证）
  Screenshots:
    - 01-hub-cards.png        期望：Hub 页面显示4张模块卡片，账号管理/采集任务/客户分析/触达中心标题清晰可见
    - 02-accounts-page.png    期望：AccountsPage 加载，显示小号列表或空态+「绑定新小号」按钮
    - 03-tasks-page.png       期望：TasksPage 显示关键词输入框 + 「开始采集」按钮 + 历史任务列表（或空态）
    - 04-tasks-input-filled.png 期望：关键词输入框已填「E2E测试关键词」
    - 05-tasks-after-start.png  期望：点击「开始采集」后页面响应（新任务行 OR 错误 toast 均可）
    - 06-leads-page.png         期望：LeadsPage 正常加载，页面无「开始采集」/关键词输入等采集面板元素
  期望：所有截图与描述一致，Claude Read 图自验通过
