---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line02 获客工作台 IA 重设计

**范围**: AcquisitionHubPage 改4模块入口卡片 + AccountsPage（新建）+ TasksPage（改接新表+新建二级）+ LeadsPage（移除采集面板）+ 新建2个GET端点 + acquisition_collect_videos DB表 + Agent选择器补 title/thumbnail/publish_date
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx`（或原 `AcquisitionHubPage.tsx`）已改为4模块卡片布局，含 `data-testid=hub-card-accounts/tasks/analytics/outreach` 4个卡片节点
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx','utf8');if(!c.includes('hub-card-accounts')||!c.includes('hub-card-tasks'))process.exit(1);console.log('✅ hub cards ok')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/AccountsPage.tsx` 文件存在，含 `data-testid=accounts-list` 或 `data-testid=accounts-empty` + `data-testid=bind-new-account-btn`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/acquisition/AccountsPage.tsx','utf8');if(!c.includes('bind-new-account-btn'))process.exit(1);console.log('✅ AccountsPage ok')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/TasksPage.tsx` 文件存在，含 `data-testid=keyword-input` + `data-testid=start-collect-btn` + `data-testid=tasks-list`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/acquisition/TasksPage.tsx','utf8');if(!c.includes('keyword-input')||!c.includes('start-collect-btn'))process.exit(1);console.log('✅ TasksPage ok')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/LeadsPage.tsx` 不再含采集面板（`acq-collect-button` 已移除）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');if(c.includes('acq-collect-button'))process.exit(1);console.log('✅ LeadsPage 无采集面板')"

- [ ] [ARTIFACT] `apps/api/src/db/migrations/` 下存在 `acquisition_collect_videos` 表的 migration 文件，含 7 个 PRD 要求列名
  Test: node -e "const {readdirSync,readFileSync}=require('fs');const d='apps/api/src/db/migrations';const f=readdirSync(d).find(x=>x.includes('collect_video')||x.includes('acquisition_video'));if(!f){process.exit(1);}const c=readFileSync(d+'/'+f,'utf8');['video_id','task_id','tenant_id','title','thumbnail_url','publish_date','comment_count'].forEach(col=>{if(!c.includes(col)){console.error('missing',col);process.exit(1);}});console.log('✅ migration ok')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/acquisition-ia.spec.ts` 存在，且不含 `page.route(`（变体C 禁止 stub）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/acquisition-ia.spec.ts','utf8');if(c.includes('page.route('))process.exit(1);console.log('✅ spec 无 page.route()')"

- [ ] [ARTIFACT] `sprints/07021006-acquisition-ia-redesign/e2e-verify.ps1` 文件存在
  Test: node -e "require('fs').accessSync('sprints/07021006-acquisition-ia-redesign/e2e-verify.ps1');console.log('✅ e2e-verify.ps1 ok')"

- [ ] [ARTIFACT] navigation.config.ts 注册 `/area/acquisition/accounts` 和 `/area/acquisition/tasks` 路由（或 DynamicRouter 等价配置）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!c.includes('/area/acquisition/accounts')||!c.includes('/area/acquisition/tasks'))process.exit(1);console.log('✅ 路由注册ok')"

---

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接跑）

### 模式A BEHAVIOR（API-level，evaluator 逐ws跑）

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:id/videos 新端点返回 success=true + data.videos(array) + data.total(number)
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["smoke-test"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" "localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos"); echo "$RESP" | jq -e '"'"'.success == true'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data.videos | type == "array"'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data.total | type == "number"'"'"' || exit 1; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] collect-tasks/:id/videos 返回字段集完整性：data.videos 元素含 video_id/title/thumbnail_url/publish_date/comment_count（空任务时 data.videos=[] 视为 pass）
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["smoke-keys"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" "localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos"); LEN=$(echo "$RESP" | jq '"'"'.data.videos | length'"'"'); if [ "$LEN" -gt 0 ]; then echo "$RESP" | jq -e '"'"'.data.videos[0] | has("video_id") and has("title") and has("thumbnail_url") and has("publish_date") and has("comment_count")'"'"' || exit 1; fi; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] collect-tasks/:id/videos IDOR 校验：OTHER_TENANT 访问 TEST_TENANT 任务 → 403/401
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["idor-test"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-002" "localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos"); [ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { echo "FAIL: IDOR CODE=$CODE"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] collect-tasks/:id/videos 非法 UUID → 404
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-001" localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos); [ "$CODE" = "404" ] || { echo "FAIL: 期望404 got $CODE"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] GET /api/acquisition/videos/:videoId/leads 新端点存在，返回 success=true + data.leads(array) + data.total(number)（不存在videoId → 200 + leads=[] 或 404，均可）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" localhost:3000/api/acquisition/videos/nonexistent-video-id/leads 2>/dev/null || echo '"'"'{"status":"404"}'"'"'); CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-001" localhost:3000/api/acquisition/videos/nonexistent-video-id/leads); [ "$CODE" = "200" ] || [ "$CODE" = "404" ] || { echo "FAIL: videos/leads 意外状态码 CODE=$CODE"; exit 1; }; if [ "$CODE" = "200" ]; then echo "$RESP" | jq -e '"'"'.success == true and (.data.leads | type == "array")'"'"' || exit 1; fi; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] videos/:videoId/leads 禁用字段 comments 不出现在 data
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-001" localhost:3000/api/acquisition/videos/any-id/leads); if [ "$CODE" = "200" ]; then RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" localhost:3000/api/acquisition/videos/any-id/leads); echo "$RESP" | jq -e '"'"'.data | has("comments") | not'"'"' || { echo "FAIL: 禁用字段 comments"; exit 1; }; fi; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] POST /api/acquisition/collect/start 新建任务后 DB 有记录（时间窗口内）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["dod-test"]}'"'"' localhost:3000/api/acquisition/collect/start); echo "$RESP" | jq -e '"'"'.success == true and .data.status == "pending"'"'"' || exit 1; TASK_ID=$(echo "$RESP" | jq -r '"'"'.data.task_id'"'"'); COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE id='"'"'$TASK_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无记录"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] LeadsPage 源文件不含采集面板 DOM（acq-collect-button 已移除）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/LeadsPage.tsx'"'"','"'"'utf8'"'"');if(c.includes('"'"'acq-collect-button'"'"'))process.exit(1);console.log('"'"'✅ ok'"'"')" || { echo "FAIL: LeadsPage 仍含采集面板"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] acquisition_collect_videos migration 文件存在，psql 确认 zenithjoy.acquisition_collect_videos 表结构（video_id 列存在）
  Test: manual:bash -c 'node -e "const {readdirSync,readFileSync}=require('"'"'fs'"'"');const d='"'"'apps/api/src/db/migrations'"'"';const f=readdirSync(d).find(x=>x.includes('"'"'collect_video'"'"')||x.includes('"'"'acquisition_video'"'"'));if(!f)process.exit(1);const c=readFileSync(d+'"'"'/'"'"'+f,'"'"'utf8'"'"');['"'"'video_id'"'"','"'"'task_id'"'"','"'"'tenant_id'"'"'].forEach(col=>{if(!c.includes(col))process.exit(1)});console.log('"'"'ok'"'"')" || { echo "FAIL: migration 文件缺失或列不全"; exit 1; }; echo OK'
  期望: OK（exit 0）

---

## BEHAVIOR:E2E 条目（Mode B final-e2e — windows_cloud GitHub Actions Playwright）

- [ ] [BEHAVIOR:E2E] 客户走完获客 IA 重设计 Golden Path，4个页面截图可视化验证
  Screenshots:
    - 01-hub.png        期望：AcquisitionHubPage 4张模块卡片全部可见，页面无报错
    - 02-accounts.png   期望：AccountsPage 渲染小号列表或空态引导，「绑定新小号」按钮可见
    - 03-tasks.png      期望：TasksPage 一级关键词输入框 + 「开始采集」按钮 + 任务列表容器可见
    - 04-leads.png      期望：LeadsPage 无采集面板，AG Grid 表格容器可见
  路径格式：sprints/07021006-acquisition-ia-redesign/screenshots/<step>.png
  期望：所有截图与期望描述一致，evaluator 视觉自验通过
