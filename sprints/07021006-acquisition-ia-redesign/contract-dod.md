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
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');const forbidden=['setAcqPhase','handleCollect','manualInput','acqPhase','collect/expand','collect/start'];const found=forbidden.filter(s=>c.includes(s));if(found.length>0){console.error('FAIL: 仍含采集面板代码',found);process.exit(1)}"

- [ ] [ARTIFACT] `apps/dashboard/e2e/acquisition-ia-redesign.spec.ts` 存在且不含 `page.route(`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/acquisition-ia-redesign.spec.ts','utf8');if(c.includes('page.route('))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/e2e-acquisition-ia-redesign.yml` 存在且符合规约
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('.github/workflows/e2e-acquisition-ia-redesign.yml','utf8');if(!c.includes('windows-latest')){console.error('FAIL: 缺 windows-latest');process.exit(1)}if(!c.includes('apps/dashboard/src/pages/acquisition')){console.error('FAIL: on.paths 缺 acquisition/**');process.exit(1)}if(!c.includes('apps/api/src/routes/acquisition.ts')){console.error('FAIL: on.paths 缺 acquisition.ts');process.exit(1)}if(!c.includes('e2e-verify.ps1')){console.error('FAIL: steps 未调用 e2e-verify.ps1');process.exit(1)}if(c.includes('page.route(')){console.error('FAIL: 含禁用 page.route(');process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] DouyinBurnerBindPage 文件已删除（PRD 废弃范围）
  Test: node -e "const fs=require('fs');const p=['apps/dashboard/src/pages/acquisition/DouyinBurnerBindPage.tsx','apps/dashboard/src/pages/DouyinBurnerBindPage.tsx'];const ex=p.filter(f=>{try{fs.accessSync(f);return true;}catch{return false;}});if(ex.length>0){console.error('FAIL: 仍存在',ex);process.exit(1)}"

- [ ] [ARTIFACT] `services/agent/src/handlers/keyword-search-douyin.ts`（或 .cjs）含视频元数据 CSS 选择器
  Test: node -e "const fs=require('fs');const candidates=['services/agent/src/handlers/keyword-search-douyin.ts','services/agent/src/handlers/keyword-search-douyin.cjs'];const found=candidates.find(p=>{try{const c=fs.readFileSync(p,'utf8');return c.includes('title')||c.includes('cover')||c.includes('published');} catch{return false;}});if(!found){console.error('FAIL: keyword-search-douyin 无视频元数据选择器（title/cover/published）');process.exit(1)};console.log('OK: 选择器存在 in',found)"

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

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 返回正确 schema — 使用固定 E2E seed UUID（不动态查询，消除 SKIP guard）
  Test: manual:bash -c '
    SEED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000001"
    E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"
    RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" "http://localhost:3000/api/acquisition/collect-tasks/$SEED_TASK_ID/videos") || { echo "FAIL: 端点不可达（路由未注册返 404 = FAIL，seed 未执行则需先跑 e2e-verify.ps1 Step 2.6）"; exit 1; }
    echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success 非 true"; exit 1; }
    echo "$RESP" | jq -e ".data.videos | type == \"array\"" || { echo "FAIL: data.videos 非 array"; exit 1; }
    echo "$RESP" | jq -e "keys == [\"data\",\"success\",\"timestamp\"]" || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
    echo "$RESP" | jq -e ".data | keys == [\"total\",\"videos\"]" || { echo "FAIL: data 内层 keys 不匹配（只允许 total+videos）"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 所有3个禁用字段均不存在（items/results/count）— 固定 E2E seed UUID
  Test: manual:bash -c '
    SEED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000001"
    E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"
    RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" "http://localhost:3000/api/acquisition/collect-tasks/$SEED_TASK_ID/videos") || { echo "FAIL: 端点不可达"; exit 1; }
    echo "$RESP" | jq -e "has(\"items\") | not" || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"results\") | not" || { echo "FAIL: 禁用字段 results 出现"; exit 1; }
    echo "$RESP" | jq -e "has(\"count\") | not" || { echo "FAIL: 禁用字段 count 出现"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 非法 taskId → HTTP 404 + error.code TASK_NOT_FOUND
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: test-tenant-e2e" "http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos")
    [ "$CODE" = "404" ] || { echo "FAIL: 非法 taskId 应返 404，实际=$CODE"; exit 1; }
    BODY=$(curl -s -H "X-Tenant-Id: test-tenant-e2e" "http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos")
    echo "$BODY" | jq -e ".error.code == \"TASK_NOT_FOUND\"" || { echo "FAIL: error.code 非 TASK_NOT_FOUND"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] 跨 tenant 访问 collect-tasks/:taskId/videos → HTTP 403（IDOR 安全保证）— 使用固定 E2E seed UUID（TID_A 拥有 task，TID_B 越权访问）
  Test: manual:bash -c '
    SEED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000001"
    E2E_TENANT_A="e2e-tenant-00000000-0000-0000-0000-000000000001"
    E2E_TENANT_B="e2e-tenant-00000000-0000-0000-0000-000000000099"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: $E2E_TENANT_B" "http://localhost:3000/api/acquisition/collect-tasks/$SEED_TASK_ID/videos")
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
    const forbidden = [\"setAcqPhase\", \"handleCollect\", \"manualInput\", \"acqPhase\", \"collect/expand\", \"collect/start\"];
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

- [ ] [BEHAVIOR] account item health 枚举值 oracle — 所有 health 值 ∈ {ok, expired, banned, unknown}（PRD 明确 health: ok|expired|banned）
  Test: manual:bash -c '
    RESP=$(curl -sf -H "X-Tenant-Id: test-tenant-e2e" http://localhost:3000/api/acquisition/burner-accounts 2>/dev/null) || { echo "FAIL: 端点不可达"; exit 1; }
    COUNT=$(echo "$RESP" | jq ".data.accounts | length")
    if [ "$COUNT" -gt 0 ]; then
      INVALID=$(echo "$RESP" | jq "[.data.accounts[].health] | map(select(. != \"ok\" and . != \"expired\" and . != \"banned\" and . != \"unknown\")) | length")
      [ "$INVALID" = "0" ] || { echo "FAIL: 非法 health 枚举值数量=$INVALID（允许: ok/expired/banned/unknown）"; exit 1; }
    fi
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] video item 必填字段 oracle — 每个 video 含 video_id(string) + video_url(string)（PRD schema）— 使用固定 E2E seed UUID
  Test: manual:bash -c '
    SEED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000001"
    E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"
    RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" "http://localhost:3000/api/acquisition/collect-tasks/$SEED_TASK_ID/videos") || { echo "FAIL: 端点不可达"; exit 1; }
    VID_COUNT=$(echo "$RESP" | jq ".data.videos | length")
    if [ "$VID_COUNT" -gt 0 ]; then
      echo "$RESP" | jq -e "[.data.videos[] | has(\"video_id\") and has(\"video_url\")] | all" || { echo "FAIL: video item 缺必填字段 video_id/video_url"; exit 1; }
      echo "$RESP" | jq -e "[.data.videos[].video_id | type == \"string\"] | all" || { echo "FAIL: video_id 非 string"; exit 1; }
      echo "$RESP" | jq -e "[.data.videos[].video_url | type == \"string\"] | all" || { echo "FAIL: video_url 非 string"; exit 1; }
    fi
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/acquisition/collect/start 响应含 task_id + status='pending'（PRD Step 5）
  Test: manual:bash -c '
    RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/collect/start \
      -H "X-Tenant-Id: test-tenant-e2e" \
      -H "Content-Type: application/json" \
      -d '"'"'{"keywords":["behavior-oracle-test"]}'"'"' 2>/dev/null) || { echo "FAIL: collect/start 端点不可达"; exit 1; }
    echo "$RESP" | jq -e ".data.task_id | type == \"string\"" || { echo "FAIL: data.task_id 非 string"; exit 1; }
    echo "$RESP" | jq -e ".data.status == \"pending\"" || { echo "FAIL: data.status 非 pending"; exit 1; }
    echo OK'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing Mode B — evaluator 跑 e2e-verify.ps1）

- [ ] [BEHAVIOR:E2E] 完整 Golden Path UI 验证（Hub实时数字→账号管理→N=10 disabled→采集任务→视频卡片+降级→leads/空态→废弃页→LeadsPage无采集面板→失败任务UI）
  Screenshots:
    - 01-hub-cards.png              期望：Hub 页面 4 张卡片（账号管理/采集任务/客户分析/触达中心）可见，前两张卡片有 hub-account-count / hub-task-count 数字元素
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
    - 12-tasks-failed-row.png       期望：TasksPage 失败任务行可见（status=failed 标记）
    - 13-tasks-retry-btn.png        期望：失败任务行含 error_code 文本 + 「重新采集」按钮（非禁用）
  期望：所有截图与描述一致，Claude Read 图自验通过
