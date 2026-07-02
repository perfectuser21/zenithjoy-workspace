---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line02 获客工作台 IA 重设计（Round 2）

**范围**: AcquisitionHubPage 改4模块入口卡片 + AccountsPage（新建）+ TasksPage（改接新表+新建二级+失败态）+ LeadsPage（移除采集面板）+ DouyinBurnerBindPage废弃redirect + 新建2个GET端点 + acquisition_collect_videos DB表 + Agent选择器补 title/thumbnail/publish_date + e2e-windows.yml补2个secrets
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx`（或原 `AcquisitionHubPage.tsx`）已改为4模块卡片布局，含 `data-testid=hub-card-accounts/tasks/analytics/outreach` 4个卡片节点
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx','utf8');if(!c.includes('hub-card-accounts')||!c.includes('hub-card-tasks'))process.exit(1);console.log('✅ hub cards ok')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/AccountsPage.tsx` 文件存在，含 `data-testid=accounts-list` 或 `data-testid=accounts-empty` + `data-testid=bind-new-account-btn`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/acquisition/AccountsPage.tsx','utf8');if(!c.includes('bind-new-account-btn'))process.exit(1);console.log('✅ AccountsPage ok')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/acquisition/TasksPage.tsx` 文件存在，含 `data-testid=keyword-input` + `data-testid=start-collect-btn` + `data-testid=tasks-list` + `data-testid=task-row` + `data-testid=video-cards-container` + `data-testid=task-status-failed` + `data-testid=task-retry-btn`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/acquisition/TasksPage.tsx','utf8');['keyword-input','start-collect-btn','tasks-list','task-row','video-cards-container','task-status-failed','task-retry-btn'].forEach(id=>{if(!c.includes(id)){console.error('FAIL: missing testid',id);process.exit(1);}});console.log('✅ TasksPage ok')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/LeadsPage.tsx` 不再含采集面板（`acq-collect-button` 已移除）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');if(c.includes('acq-collect-button'))process.exit(1);console.log('✅ LeadsPage 无采集面板')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx` 已废弃（文件不存在 OR 仅含 `<Navigate>` redirect 到 `/area/acquisition/accounts`）
  Test: node -e "const {existsSync,readFileSync}=require('fs');const p='apps/dashboard/src/pages/DouyinBurnerBindPage.tsx';if(!existsSync(p)){console.log('✅ 文件已删除');process.exit(0);}const c=readFileSync(p,'utf8');if(!c.includes('Navigate')&&!c.includes('redirect')&&!c.includes('accounts')){console.error('FAIL: DouyinBurnerBindPage 未废弃');process.exit(1);}console.log('✅ DouyinBurnerBindPage redirect ok')"

- [ ] [ARTIFACT] `apps/api/src/db/migrations/` 下存在 `acquisition_collect_videos` 表的 migration 文件，含 7 个 PRD 要求列名
  Test: node -e "const {readdirSync,readFileSync}=require('fs');const d='apps/api/src/db/migrations';const f=readdirSync(d).find(x=>x.includes('collect_video')||x.includes('acquisition_video'));if(!f){process.exit(1);}const c=readFileSync(d+'/'+f,'utf8');['video_id','task_id','tenant_id','title','thumbnail_url','publish_date','comment_count'].forEach(col=>{if(!c.includes(col)){console.error('missing',col);process.exit(1);}});console.log('✅ migration ok')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/acquisition-ia.spec.ts` 存在，且不含 `page.route(`；含8个 test（含4个 R2 新增）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/acquisition-ia.spec.ts','utf8');if(c.includes('page.route('))process.exit(1);const cnt=(c.match(/^test\(/mg)||[]).length;if(cnt<8){console.error('FAIL: spec 只含',cnt,'个test，需>=8');process.exit(1);}console.log('✅ spec ok count='+cnt)"

- [ ] [ARTIFACT] `sprints/07021006-acquisition-ia-redesign/e2e-verify.ps1` 文件存在
  Test: node -e "require('fs').accessSync('sprints/07021006-acquisition-ia-redesign/e2e-verify.ps1');console.log('✅ e2e-verify.ps1 ok')"

- [ ] [ARTIFACT] navigation.config.ts 或路由文件注册 `/area/acquisition/accounts` 和 `/area/acquisition/tasks` 路由
  Test: node -e "const {existsSync,readFileSync}=require('fs');const files=['apps/dashboard/src/config/navigation.config.ts','apps/dashboard/src/router/index.tsx','apps/dashboard/src/router/routes.tsx'].filter(f=>existsSync(f));const all=files.map(f=>readFileSync(f,'utf8')).join('\n');if(!all.includes('/area/acquisition/accounts')||!all.includes('/area/acquisition/tasks')){process.exit(1);}console.log('✅ 路由注册ok')"

- [ ] [ARTIFACT] `.github/workflows/e2e-windows.yml` 的 env block 包含 `E2E_TEST_TENANT_ID` 和 `E2E_OTHER_TENANT_ID` secrets 注入
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-windows.yml','utf8');if(!c.includes('E2E_TEST_TENANT_ID')||!c.includes('E2E_OTHER_TENANT_ID')){console.error('FAIL: e2e-windows.yml 缺少 tenant secrets');process.exit(1);}console.log('✅ workflow secrets ok')"

---

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接跑）

### 模式A BEHAVIOR（API-level，evaluator 逐ws跑）

- [ ] [BEHAVIOR] GET /api/acquisition/collect-tasks/:id/videos 新端点返回 success=true + data.videos(array) + data.total(number)
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["smoke-test"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" "localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos"); echo "$RESP" | jq -e '"'"'.success == true'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data.videos | type == "array"'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data.total | type == "number"'"'"' || exit 1; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] collect-tasks/:id/videos 字段集完整性：data.videos 元素含 video_id/title/thumbnail_url/publish_date/comment_count（空 videos=[] 时跳过字段检查）；禁用字段 videoList/items/results 不出现
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["field-check"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" "localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos"); LEN=$(echo "$RESP" | jq '"'"'.data.videos | length'"'"'); if [ "$LEN" -gt 0 ]; then echo "$RESP" | jq -e '"'"'.data.videos[0] | has("video_id") and has("title") and has("thumbnail_url") and has("publish_date") and has("comment_count")'"'"' || exit 1; fi; echo "$RESP" | jq -e '"'"'.data | (has("videoList") | not) and (has("items") | not) and (has("results") | not)'"'"' || { echo "FAIL: 禁用字段"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] collect-tasks/:id/videos IDOR 校验：OTHER_TENANT 访问 TEST_TENANT 任务 → 403/401
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["idor-test"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-002" "localhost:3000/api/acquisition/collect-tasks/$TASK_ID/videos"); [ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { echo "FAIL: IDOR CODE=$CODE"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] collect-tasks/:id/videos 非法 UUID → 404
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-001" localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos); [ "$CODE" = "404" ] || { echo "FAIL: 期望404 got $CODE"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] GET /api/acquisition/videos/:videoId/leads 新端点 — seed 已知 video_id，验 200 路径 schema（leads:array, total:number）+ 禁用字段 comments/items/results 均不出现
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["leads-schema-test"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); VID="e2e-video-dod-schema"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.acquisition_collect_videos (video_id,task_id,tenant_id,title,thumbnail_url,publish_date,comment_count) VALUES ('"'"'$VID'"'"','"'"'$TASK_ID'"'"','"'"'e2e-tenant-test-001'"'"','"'"'DOD Test'"'"',NULL,NULL,0) ON CONFLICT (video_id) DO UPDATE SET task_id='"'"'$TASK_ID'"'"',tenant_id='"'"'e2e-tenant-test-001'"'"'"; RESP=$(curl -sf -H "X-Tenant-Id: e2e-tenant-test-001" "localhost:3000/api/acquisition/videos/$VID/leads"); echo "$RESP" | jq -e '"'"'.success == true'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data.leads | type == "array"'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data.total | type == "number"'"'"' || exit 1; echo "$RESP" | jq -e '"'"'.data | (has("comments") | not) and (has("items") | not) and (has("results") | not)'"'"' || { echo "FAIL: 禁用字段"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] videos/:videoId/leads IDOR 校验 — seed 已知 video_id（tenant=TEST），OTHER_TENANT 访问 → 403/401
  Test: manual:bash -c 'TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["leads-idor"]}'"'"' localhost:3000/api/acquisition/collect/start | jq -r '"'"'.data.task_id'"'"'); VID="e2e-video-dod-idor"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.acquisition_collect_videos (video_id,task_id,tenant_id,title,thumbnail_url,publish_date,comment_count) VALUES ('"'"'$VID'"'"','"'"'$TASK_ID'"'"','"'"'e2e-tenant-test-001'"'"','"'"'IDOR Test'"'"',NULL,NULL,0) ON CONFLICT (video_id) DO UPDATE SET task_id='"'"'$TASK_ID'"'"',tenant_id='"'"'e2e-tenant-test-001'"'"'"; CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: e2e-tenant-test-002" "localhost:3000/api/acquisition/videos/$VID/leads"); [ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { echo "FAIL: leads IDOR CODE=$CODE"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] POST /api/acquisition/collect/start 新建任务后 DB 有记录（时间窗口内，status=pending）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"keywords":["dod-test"]}'"'"' localhost:3000/api/acquisition/collect/start); echo "$RESP" | jq -e '"'"'.success == true and .data.status == "pending"'"'"' || exit 1; TASK_ID=$(echo "$RESP" | jq -r '"'"'.data.task_id'"'"'); COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE id='"'"'$TASK_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无记录"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] POST /api/agent/burner/qr-bind 端点已注册，返回 200（含 data.qr_url:string）或 503（无 agent）；400/404/500 = FAIL
  Test: manual:bash -c 'BODY=$(curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -H "X-Tenant-Id: e2e-tenant-test-001" -d '"'"'{"account_label":"dod-bind-test"}'"'"' localhost:3000/api/agent/burner/qr-bind); CODE=$(echo "$BODY" | tail -1); JSON=$(echo "$BODY" | head -n -1); [ "$CODE" = "200" ] || [ "$CODE" = "503" ] || { echo "FAIL: qr-bind CODE=$CODE"; exit 1; }; if [ "$CODE" = "200" ]; then echo "$JSON" | jq -e '"'"'.success == true and (.data.qr_url | type == "string")'"'"' || { echo "FAIL: qr-bind schema"; exit 1; }; fi; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] LeadsPage 源文件不含采集面板 DOM（acq-collect-button 已移除）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/LeadsPage.tsx'"'"','"'"'utf8'"'"');if(c.includes('"'"'acq-collect-button'"'"'))process.exit(1);console.log('"'"'✅ ok'"'"')" || { echo "FAIL: LeadsPage 仍含采集面板"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] acquisition_collect_videos migration 文件存在，含 7 列（video_id/task_id/tenant_id/title/thumbnail_url/publish_date/comment_count）
  Test: manual:bash -c 'node -e "const {readdirSync,readFileSync}=require('"'"'fs'"'"');const d='"'"'apps/api/src/db/migrations'"'"';const f=readdirSync(d).find(x=>x.includes('"'"'collect_video'"'"')||x.includes('"'"'acquisition_video'"'"'));if(!f)process.exit(1);const c=readFileSync(d+'"'"'/'"'"'+f,'"'"'utf8'"'"');['"'"'video_id'"'"','"'"'task_id'"'"','"'"'tenant_id'"'"','"'"'title'"'"','"'"'thumbnail_url'"'"','"'"'publish_date'"'"','"'"'comment_count'"'"'].forEach(col=>{if(!c.includes(col))process.exit(1)});console.log('"'"'ok'"'"')" || { echo "FAIL: migration 文件缺失或列不全"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] POST /api/acquisition/collect/sweep-timeouts 端点已注册，返回 200/401/403（非 404/5xx）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer smoke" localhost:3000/api/acquisition/collect/sweep-timeouts); [ "$CODE" = "200" ] || [ "$CODE" = "401" ] || [ "$CODE" = "403" ] || { echo "FAIL: sweep-timeouts CODE=$CODE（404=路由未注册）"; exit 1; }; echo OK'
  期望: OK（exit 0）

---

## BEHAVIOR:E2E 条目（Mode B final-e2e — windows_cloud GitHub Actions Playwright）

- [ ] [BEHAVIOR:E2E] 客户走完获客 IA 重设计 Golden Path（8个测试），截图可视化验证
  Screenshots:
    - 01-hub.png                  期望：AcquisitionHubPage 4张模块卡片全部可见
    - 02-accounts.png             期望：AccountsPage 渲染小号列表或空态引导，「绑定新小号」按钮可见
    - 03-tasks.png                期望：TasksPage 一级关键词输入框 + 「开始采集」按钮 + 任务列表容器可见
    - 04-leads.png                期望：LeadsPage 无采集面板，AG Grid 表格容器可见
    - 05-tasks-detail.png         期望：TasksPage 二级视频卡片容器渲染（有任务时）或 not-found（无任务时）
    - 06-video-leads.png          期望：视频卡片展开后 leads 列表或「暂无评论」占位可见
    - 07-accounts-n10-limit.png   期望：OTHER_TENANT 视角，「绑定新小号」按钮 disabled
    - 08-tasks-failed.png         期望：TEST_TENANT 视角，失败态任务行 task-status-failed 可见 + task-retry-btn 可见
  路径格式：sprints/07021006-acquisition-ia-redesign/screenshots/<step>.png
  期望：所有截图与期望描述一致，evaluator 视觉自验通过
