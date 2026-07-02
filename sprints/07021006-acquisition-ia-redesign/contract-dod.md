---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 获客工作台 IA 重构（Hub 4卡片 + AccountsPage + TasksPage两级）

**范围**: Hub 4模块卡片改版 + AccountsPage(新建) + TasksPage两级(改接 acquisition_collect_tasks + 新建 TaskDetailPage) + acquisition_collect_videos 表 + 两个新 GET API + LeadsPage 移除采集面板 + agent 视频元数据选择器 + DouyinBurnerBindPage UI 废弃
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

- [ ] [ARTIFACT] DB migration 文件存在（含 `acquisition_collect_videos` 建表）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const m=files.filter(f=>f.includes('acquisition_collect_videos'));if(m.length===0)process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/routes/acquisition.ts` 包含新端点 `/burner-accounts` 和 `/collect-tasks/:taskId/videos`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');if(!c.includes('burner-accounts')||!c.includes('collect-tasks/:taskId/videos'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/LeadsPage.tsx` 不含采集面板代码
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');const forbidden=['setAcqPhase','handleCollect','manualInput','acqPhase'];const found=forbidden.filter(s=>c.includes(s));if(found.length>0){console.error('FAIL: 仍含采集面板代码',found);process.exit(1)}"

- [ ] [ARTIFACT] `apps/dashboard/e2e/acquisition-ia-redesign.spec.ts` 存在且不含 `page.route(`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/acquisition-ia-redesign.spec.ts','utf8');if(c.includes('page.route('))process.exit(1)"

- [ ] [ARTIFACT] DouyinBurnerBindPage 文件已删除（PRD 废弃范围）
  Test: node -e "const fs=require('fs');const p=['apps/dashboard/src/pages/acquisition/DouyinBurnerBindPage.tsx','apps/dashboard/src/pages/DouyinBurnerBindPage.tsx'];const ex=p.filter(f=>{try{fs.accessSync(f);return true;}catch{return false;}});if(ex.length>0){console.error('FAIL: 仍存在',ex);process.exit(1)}"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] GET /api/acquisition/burner-accounts 返回正确顶层 schema（success/data.accounts/data.total/顶层keys）
  Test: manual:bash -c '
    RESP=$(curl -sf -H "X-Tenant-Id: test-tenant-e2e" http://localhost:3000/api/acquisition/burner-accounts 2>/dev/null) || { echo "FAIL: 端点不可达（路由未注册则返 404，属于实现缺失）"; exit 1; }
    echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success 非 true"; exit 1; }
    echo "$RESP" | jq -e ".data.accounts | type == \"array\"" || { echo "FAIL: data.accounts 非 array"; exit 1; }
    echo "$RESP" | jq -e "keys == [\"data\",\"success\",\"timestamp\"]" || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/burner-accounts data 内层 keys 完整性（只含 accounts+total）
  Test: manual:bash -c '
    RESP=$(curl -sf -H "X-Tenant-Id: test-tenant-e2e" http://localhost:3000/api/acquisition/burner-accounts 2>/dev/null) || { echo "FAIL: 端点不可达"; exit 1; }
    echo "$RESP" | jq -e ".data | keys == [\"accounts\",\"total\"]" || { echo "FAIL: data 内层 keys 不匹配（只允许 accounts+total）"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/burner-accounts 所有4个禁用字段均不存在（sessions/burners/items/count）
  Test: manual:bash -c '
    RESP=$(curl -sf -H "X-Tenant-Id: test-tenant-e2e" http://localhost:3000/api/acquisition/burner-accounts 2>/dev/null) || { echo "FAIL: 端点不可达"; exit 1; }
    echo "$RESP" | jq -e "has(\"sessions\") | not" || { echo "FAIL: 禁用字段 sessions 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"burners\") | not" || { echo "FAIL: 禁用字段 burners 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"items\") | not" || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"count\") | not" || { echo "FAIL: 禁用字段 count 出现"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 返回正确 schema（顶层keys + data内层keys）
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://localhost/zenithjoy_test}"
    TASK_ID=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.acquisition_collect_tasks LIMIT 1" 2>/dev/null | tr -d " ") || TASK_ID=""
    if [ -z "$TASK_ID" ]; then echo "SKIP: 无 collect_task seed"; exit 0; fi
    TID=$(psql "$DB" -t -c "SELECT tenant_id FROM zenithjoy.acquisition_collect_tasks WHERE id='"'"'$TASK_ID'"'"'" 2>/dev/null | tr -d " ")
    RESP=$(curl -sf -H "X-Tenant-Id: $TID" "http://localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos") || { echo "FAIL: 端点不可达"; exit 1; }
    echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success 非 true"; exit 1; }
    echo "$RESP" | jq -e ".data.videos | type == \"array\"" || { echo "FAIL: data.videos 非 array"; exit 1; }
    echo "$RESP" | jq -e "keys == [\"data\",\"success\",\"timestamp\"]" || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
    echo "$RESP" | jq -e ".data | keys == [\"total\",\"videos\"]" || { echo "FAIL: data 内层 keys 不匹配（只允许 total+videos）"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 所有3个禁用字段均不存在（items/results/count）
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://localhost/zenithjoy_test}"
    TASK_ID=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.acquisition_collect_tasks LIMIT 1" 2>/dev/null | tr -d " ") || TASK_ID=""
    if [ -z "$TASK_ID" ]; then echo "SKIP: 无 collect_task seed"; exit 0; fi
    TID=$(psql "$DB" -t -c "SELECT tenant_id FROM zenithjoy.acquisition_collect_tasks WHERE id='"'"'$TASK_ID'"'"'" 2>/dev/null | tr -d " ")
    RESP=$(curl -sf -H "X-Tenant-Id: $TID" "http://localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos") || { echo "FAIL: 端点不可达"; exit 1; }
    echo "$RESP" | jq -e "has(\"items\") | not" || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"results\") | not" || { echo "FAIL: 禁用字段 results 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"count\") | not" || { echo "FAIL: 禁用字段 count 出现"; exit 1; }
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
    TID_A=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.tenants ORDER BY created_at ASC LIMIT 1" 2>/dev/null | tr -d " ")
    TID_B=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.tenants ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d " ")
    if [ -z "$TID_A" ] || [ -z "$TID_B" ] || [ "$TID_A" = "$TID_B" ]; then
      echo "SKIP: 无法构造两个不同 tenant"; exit 0
    fi
    TASK_ID_A=$(psql "$DB" -t -c "SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='"'"'$TID_A'"'"' LIMIT 1" 2>/dev/null | tr -d " ")
    if [ -z "$TASK_ID_A" ]; then echo "SKIP: TID_A 无 task"; exit 0; fi
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: $TID_B" "http://localhost:3000/api/acquisition/collect-tasks/$TASK_ID_A/videos")
    [ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { echo "FAIL: 跨 tenant 应返 401/403，实际=$CODE"; exit 1; }
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

- [ ] [BEHAVIOR] LeadsPage.tsx 不含采集面板残留代码
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

- [ ] [BEHAVIOR] DouyinBurnerBindPage 文件已删除（PRD 废弃范围）
  Test: manual:bash -c '
    node -e "
    const fs = require(\"fs\");
    const candidates = [
      \"apps/dashboard/src/pages/acquisition/DouyinBurnerBindPage.tsx\",
      \"apps/dashboard/src/pages/DouyinBurnerBindPage.tsx\"
    ];
    const existing = candidates.filter(p => { try { fs.accessSync(p); return true; } catch { return false; } });
    if (existing.length > 0) { console.error(\"FAIL: DouyinBurnerBindPage 仍存在:\", existing); process.exit(1); }
    console.log(\"OK\");
    "'
  期望: OK

- [ ] [BEHAVIOR] error path — GET /burner-accounts 无 tenant 上下文 → 401/403
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/acquisition/burner-accounts)
    [ "$CODE" = "401" ] || [ "$CODE" = "403" ] || { echo "FAIL: 无 tenant 应返 401/403，实际=$CODE"; exit 1; }
    echo OK'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing Mode B — evaluator 跑 e2e-verify.ps1）

- [ ] [BEHAVIOR:E2E] 完整 Golden Path UI 验证（Hub→账号管理→N=10 disabled→采集任务→视频卡片+降级→leads/空态→废弃页→LeadsPage无采集面板）
  Screenshots:
    - 01-hub-cards.png              期望：Hub 页面 4 张卡片（账号管理/采集任务/客户分析/触达中心）可见
    - 02-accounts-page.png          期望：AccountsPage 加载，显示列表或空态+「绑定新小号」按钮
    - 03-tasks-page.png             期望：TasksPage 关键词输入框 + 「开始采集」按钮可见
    - 04-tasks-input-filled.png     期望：输入框已填「E2E测试关键词」
    - 05-tasks-after-start.png      期望：点击「开始采集」后页面响应（新任务行 OR 错误 toast）
    - 06-bind-disabled-n10.png      期望：10条账号 seed 后「绑定新小号」按钮呈 disabled 状态（灰色）
    - 07-task-detail-videos.png     期望：TaskDetailPage 显示视频卡片列表，至少一张可见
    - 08-video-degraded-fallback.png 期望：cover_url=null 视频渲染为文字链接（video-url-fallback 可见）
    - 09-video-leads-expanded.png   期望：展开卡片后显示 leads 列表或「暂无评论」空态（二者必显其一）
    - 10-bind-page-deprecated.png   期望：旧 DouyinBurnerBindPage 路由重定向或 404，旧 UI 不渲染
    - 11-leads-page.png             期望：LeadsPage 无「开始采集」/关键词输入等采集面板元素
  期望：所有截图与描述一致，Claude Read 图自验通过
