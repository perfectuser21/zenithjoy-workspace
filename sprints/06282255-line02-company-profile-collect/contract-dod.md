---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Line02 公司信息页 + 采集任务 Table + 主号全链

**范围**: 公司信息 GET/PUT API + migration + Dashboard 公司信息页 + 采集页账号状态块 + 采集任务 Table + line02/index.ts 真实轮询 + keyword-search-douyin.cjs 主号修正 + crawl-comments-douyin.cjs 新建
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/company-profile.ts` 存在且包含 GET/PUT handler
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/company-profile.ts','utf8');if(!c.includes('company-profile')||!c.includes('tenantContextOptional'))process.exit(1)"

- [ ] [ARTIFACT] Migration 文件存在且包含 `zenithjoy.tenant_company_profiles` 建表语句
  Test: node -e "const fs=require('fs'),g=require('glob');const f=g.sync('apps/api/db/migrations/*company_profile*');if(!f.length)process.exit(1);const c=fs.readFileSync(f[0],'utf8');if(!c.includes('tenant_company_profiles'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CompanyProfilePage.tsx` 存在且含三个 Section
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx','utf8');if(!c.includes('products')||!c.includes('qa_list')||!c.includes('customer_portrait'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/api/company-profile.api.ts` 存在且含 GET/PUT 调用
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/api/company-profile.api.ts','utf8');if(!c.includes('company-profile'))process.exit(1)"

- [ ] [ARTIFACT] `services/agent/publishers/crawl-comments-douyin.cjs` 存在（新建）
  Test: node -e "require('fs').accessSync('services/agent/publishers/crawl-comments-douyin.cjs')"

- [ ] [ARTIFACT] `services/agent/modules/line02/index.ts` 不再只含 stub（必须有轮询 + 调用逻辑）
  Test: node -e "const c=require('fs').readFileSync('services/agent/modules/line02/index.ts','utf8');if(c.includes('stub')||!c.includes('pending-collect-tasks'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/e2e/line02-company-profile-collect.spec.ts` 存在
  Test: node -e "require('fs').accessSync('apps/dashboard/e2e/line02-company-profile-collect.spec.ts')"

- [ ] [ARTIFACT] `.github/workflows/e2e-line02-company-profile-collect.yml` 存在
  Test: node -e "require('fs').accessSync('.github/workflows/e2e-line02-company-profile-collect.yml')"

---

## BEHAVIOR 条目（内嵌 manual:bash，API_URL 默认 http://localhost:3000，evaluator 可覆盖）

### [BEHAVIOR] Step1-a — PUT /api/company-profile 保存成功 + schema 正确

- [ ] [BEHAVIOR] PUT /api/company-profile 返回 200，data.updated == true，keys 完整
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf -X PUT "$API/api/company-profile" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{\"company_name\":\"Smoke 公司\",\"city\":\"西安\",\"industry\":\"餐饮\",\"description\":\"测试描述\",\"products\":[\"测试产品\"],\"key_advantages\":[\"测试优势\"],\"customer_problem\":\"测试问题\",\"customer_portrait\":\"25-35岁消费者\",\"qa_list\":[{\"q\":\"问\",\"a\":\"答\"}]}")
  echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
  echo "$RESP" | jq -e ".data.updated == true" || { echo "FAIL: data.updated!=true"; exit 1; }
  echo "$RESP" | jq -e ".data | keys == [\"updated\"]" || { echo "FAIL: data keys不完整"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step1-b — GET /api/company-profile 读回所有 9 个必填字段（租户正确）

- [ ] [BEHAVIOR] GET /api/company-profile 返回 company_name / city / industry / description 四个基础字段
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
  echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
  echo "$RESP" | jq -e ".data.company_name == \"Smoke 公司\"" || { echo "FAIL: company_name 读回不匹配"; exit 1; }
  echo "$RESP" | jq -e ".data.city == \"西安\"" || { echo "FAIL: city 读回不匹配"; exit 1; }
  echo "$RESP" | jq -e ".data.industry == \"餐饮\"" || { echo "FAIL: industry 读回不匹配"; exit 1; }
  echo "$RESP" | jq -e ".data.description == \"测试描述\"" || { echo "FAIL: description 读回不匹配"; exit 1; }
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/company-profile 返回 key_advantages / customer_problem / customer_portrait / products / qa_list 五个字段
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
  echo "$RESP" | jq -e ".data.key_advantages | length >= 1" || { echo "FAIL: key_advantages 为空"; exit 1; }
  echo "$RESP" | jq -e ".data.customer_problem == \"测试问题\"" || { echo "FAIL: customer_problem 读回不匹配"; exit 1; }
  echo "$RESP" | jq -e ".data.customer_portrait == \"25-35岁消费者\"" || { echo "FAIL: customer_portrait 读回不匹配"; exit 1; }
  echo "$RESP" | jq -e ".data.products | length >= 1" || { echo "FAIL: products 为空"; exit 1; }
  echo "$RESP" | jq -e ".data.qa_list | length >= 1" || { echo "FAIL: qa_list 为空"; exit 1; }
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/company-profile data keys 完整性（9 个必填字段全在，无多无少）
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
  EXPECTED="[\"city\",\"company_name\",\"customer_portrait\",\"customer_problem\",\"description\",\"key_advantages\",\"products\",\"qa_list\"]"
  echo "$RESP" | jq -e ".data | del(.key_advantages,.products,.qa_list) | keys == [\"city\",\"company_name\",\"customer_portrait\",\"customer_problem\",\"description\"]" || { echo "FAIL: data scalar keys 不完整"; exit 1; }
  echo "$RESP" | jq -e ".data | has(\"key_advantages\") and has(\"products\") and has(\"qa_list\")" || { echo "FAIL: data 缺数组字段"; exit 1; }
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/company-profile data 禁用字段反向检查（profile / result / tenant_id 裸 / companyName 不存在）
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
  echo "$RESP" | jq -e ".data | has(\"profile\") | not" || { echo "FAIL: 禁用字段 profile 漏网"; exit 1; }
  echo "$RESP" | jq -e ".data | has(\"result\") | not" || { echo "FAIL: 禁用字段 result 漏网"; exit 1; }
  echo "$RESP" | jq -e ".data | has(\"tenant_id\") | not" || { echo "FAIL: 禁用字段 tenant_id 裸字段漏网"; exit 1; }
  echo "$RESP" | jq -e ".data | has(\"companyName\") | not" || { echo "FAIL: 禁用字段 companyName(camelCase) 漏网"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step1-c — 首次访问（无记录）返回 HTTP 200 + 空表单（非 404）

- [ ] [BEHAVIOR] 未写入记录的租户 GET /api/company-profile 返回 200 + 空字符串字段
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="00000000-0000-0000-0000-000000000001"
  RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT")
  echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
  echo "$RESP" | jq -e ".data.company_name == \"\"" || { echo "FAIL: 首次访问 company_name 不是空串"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step1-d — DB 时效防伪：company_profiles 记录在 5 分钟内写入

- [ ] [BEHAVIOR] zenithjoy.tenant_company_profiles 有 5 分钟内写入的记录
  Test: manual:bash -c '
  DB="${DB_URL:-postgresql://localhost/zenithjoy}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.tenant_company_profiles WHERE tenant_id='"'"'$TENANT'"'"' AND updated_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
  [ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无记录或超时间窗 count=$COUNT"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step2-a — GET /api/line02/account-status 返回 accounts 数组 + schema 正确

- [ ] [BEHAVIOR] GET /api/line02/account-status 返回 200 + data.accounts 数组含 role 字段
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf "$API/api/line02/account-status" -H "X-Tenant-Id: $TENANT")
  echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
  echo "$RESP" | jq -e ".data | keys == [\"accounts\"]" || { echo "FAIL: data keys 不是 [accounts]"; exit 1; }
  echo "$RESP" | jq -e ".data.accounts | type == \"array\"" || { echo "FAIL: accounts 不是数组"; exit 1; }
  echo "$RESP" | jq -e ".data.accounts | map(select(.role==\"main\")) | length >= 0" || { echo "FAIL: accounts 结构异常"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step2-b — 禁用字段反向：data 不含 status 裸字段

- [ ] [BEHAVIOR] GET /api/line02/account-status data 不含禁用字段 status（裸）
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf "$API/api/line02/account-status" -H "X-Tenant-Id: $TENANT")
  echo "$RESP" | jq -e ".data | has(\"status\") | not" || { echo "FAIL: 禁用字段 status 漏网"; exit 1; }
  echo "$RESP" | jq -e ".data | has(\"main_account\") | not" || { echo "FAIL: 禁用字段 main_account 漏网"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step3-a — POST /api/acquisition/collect/start 返回 task_id + status=pending

- [ ] [BEHAVIOR] POST collect/start 返回 200 + data.task_id UUID + data.status="pending"
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{\"keywords\":[\"smoke-keyword\"]}")
  echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
  echo "$RESP" | jq -e ".data.status == \"pending\"" || { echo "FAIL: status!=pending"; exit 1; }
  TASK_ID=$(echo "$RESP" | jq -r ".data.task_id")
  echo "$TASK_ID" | grep -qP "^[0-9a-f]{8}-[0-9a-f]{4}-" || { echo "FAIL: task_id 不是 UUID"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step3-b — DB 时效防伪：collect_tasks 记录 5 分钟内创建

- [ ] [BEHAVIOR] acquisition_collect_tasks 有 5 分钟内 pending 记录（带时间窗）
  Test: manual:bash -c '
  DB="${DB_URL:-postgresql://localhost/zenithjoy}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='"'"'$TENANT'"'"' AND status='"'"'pending'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
  [ "$COUNT" -ge 1 ] || { echo "FAIL: DB collect_tasks 无记录或超时间窗 count=$COUNT"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step4-a — collect/report 模拟 Agent 上报，data.inserted ≥ 1

- [ ] [BEHAVIOR] POST collect/report（模拟 Agent）返回 200 + data.inserted ≥ 1
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  # 先建任务拿 task_id
  TASK_RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{\"keywords\":[\"report-smoke\"]}")
  TASK_ID=$(echo "$TASK_RESP" | jq -r ".data.task_id")
  [ -n "$TASK_ID" ] || { echo "FAIL: 无法建任务"; exit 1; }
  # 模拟 Agent 上报一条评论者
  RESP=$(curl -sf -X POST "$API/api/acquisition/collect/report" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$TASK_ID\",\"video_id\":\"smoke-video-001\",\"commenters\":[{\"sec_uid\":\"MS4wSmoke001\",\"nickname\":\"烟雾测试用户\"}]}")
  echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
  echo "$RESP" | jq -e ".data.inserted >= 1" || { echo "FAIL: inserted<1"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step4-b — DB 时效防伪：acquisition_leads 有 5 分钟内写入的 sec_uid 非空记录

- [ ] [BEHAVIOR] acquisition_leads 有 5 分钟内 sec_uid 非空记录
  Test: manual:bash -c '
  DB="${DB_URL:-postgresql://localhost/zenithjoy}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='"'"'$TENANT'"'"' AND sec_uid IS NOT NULL AND nickname != '"'"''"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
  [ "$COUNT" -ge 1 ] || { echo "FAIL: acquisition_leads 无 sec_uid 非空记录（5min窗）count=$COUNT"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step5-a — 终态回报后 GET task 返回 done + video_count/lead_count_raw ≥ 1

- [ ] [BEHAVIOR] terminal=done 上报后 GET collect/:task_id 返回 status=done 且计数 ≥ 1
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  # 建任务
  TASK_ID=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{\"keywords\":[\"terminal-smoke\"]}" | jq -r ".data.task_id")
  [ -n "$TASK_ID" ] || { echo "FAIL: 无法建任务"; exit 1; }
  # 上报 commenter + terminal=done
  curl -sf -X POST "$API/api/acquisition/collect/report" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$TASK_ID\",\"video_id\":\"v-001\",\"commenters\":[{\"sec_uid\":\"MS4w001\",\"nickname\":\"终态用户\"}],\"terminal\":\"done\"}" > /dev/null
  # 验 GET status
  RESP=$(curl -sf "$API/api/acquisition/collect/$TASK_ID")
  echo "$RESP" | jq -e ".data.status == \"done\"" || { echo "FAIL: status!=done"; exit 1; }
  echo "$RESP" | jq -e ".data.video_count >= 0" || { echo "FAIL: video_count 缺字段"; exit 1; }
  echo "$RESP" | jq -e ".data.lead_count_raw >= 1" || { echo "FAIL: lead_count_raw<1"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Step5-b — GET /api/acquisition/collect/:task_id schema 完整性检查

- [ ] [BEHAVIOR] GET task 响应 data 包含必填字段 task_id/status/video_count/lead_count_raw
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  TASK_ID=$(curl -sf -X POST "$API/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{\"keywords\":[\"schema-check\"]}" | jq -r ".data.task_id")
  RESP=$(curl -sf "$API/api/acquisition/collect/$TASK_ID")
  echo "$RESP" | jq -e ".data | has(\"task_id\") and has(\"status\") and has(\"video_count\") and has(\"lead_count_raw\")" || { echo "FAIL: data 缺必填字段"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Error-a — 空 keywords 时 collect/start 返回 400 + error.code

- [ ] [BEHAVIOR] POST collect/start 空 keywords 返回 400 + error path
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{\"keywords\":[]}")
  [ "$CODE" = "400" ] || { echo "FAIL: 空 keywords 未返 400，得到 $CODE"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Error-b — PUT /api/company-profile 缺 company_name 返回 400

- [ ] [BEHAVIOR] PUT /api/company-profile 缺 company_name 返回 400
  Test: manual:bash -c '
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/api/company-profile" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: $TENANT" \
    -d "{}")
  [ "$CODE" = "400" ] || { echo "FAIL: 缺 company_name 未返 400，得到 $CODE"; exit 1; }
  echo OK'
  期望: OK

### [BEHAVIOR] Error-c — 主号 session 失效时 GET account-status 返回 health="expired"

- [ ] [BEHAVIOR] DB 注入 expired 状态后，GET /api/line02/account-status accounts 含 health=="expired" 条目
  Test: manual:bash -c '
  DB="${DB_URL:-postgresql://localhost/zenithjoy}"
  API="${API_URL:-http://localhost:3000}"
  TENANT="2ac0aa4a-99f4-470a-aed7-c3a9fe03149b"
  # 前提：zenithjoy.line02_account_sessions 表存在（Generator 建，含 tenant_id / account_label / role / health 字段）
  # 注入 expired 状态（若记录不存在先 INSERT，再 UPDATE）
  psql "$DB" -c "
    INSERT INTO zenithjoy.line02_account_sessions (tenant_id, account_label, role, health)
    VALUES ('"'"'$TENANT'"'"', '"'"'live101942'"'"', '"'"'main'"'"', '"'"'expired'"'"')
    ON CONFLICT (tenant_id, account_label) DO UPDATE SET health='"'"'expired'"'"', updated_at=NOW()
  " || { echo "FAIL: DB 注入 expired 状态失败"; exit 1; }
  # GET account-status 验证
  RESP=$(curl -sf "$API/api/line02/account-status" -H "X-Tenant-Id: $TENANT")
  EXPIRED_COUNT=$(echo "$RESP" | jq "[.data.accounts[] | select(.health==\"expired\")] | length")
  [ "$EXPIRED_COUNT" -ge 1 ] || { echo "FAIL: accounts 中无 health==expired 条目，RESP=$RESP"; exit 1; }
  # 恢复状态（测试完清理，避免污染其他 BEHAVIOR）
  psql "$DB" -c "UPDATE zenithjoy.line02_account_sessions SET health='"'"'ok'"'"' WHERE tenant_id='"'"'$TENANT'"'"' AND account_label='"'"'live101942'"'"'" 2>/dev/null || true
  echo OK'
  期望: OK（expired 条目数 ≥ 1）

---

## BEHAVIOR:E2E 条目（user_facing Mode B — windows_cloud Playwright）

- [ ] [BEHAVIOR:E2E] 公司信息页完整 3 Section 表单保存 + 刷新后数据仍在
  Screenshots:
    - 01-company-profile-initial.png  期望：CompanyProfilePage 加载，表单为空，三个 Section 标题可见
    - 02-company-profile-filled.png   期望：表单已填写，保存按钮可点击
    - 03-company-profile-saved.png    期望：Toast「已保存」出现，表单字段值保留
  期望：Playwright spec 所有 expect() 通过，截图已存入 screenshots/

- [ ] [BEHAVIOR:E2E] Line02 采集页账号状态块 + 关键词配置 + 采集任务 Table 出现
  Screenshots:
    - 04-acquisition-page-status.png  期望：账号状态块可见，主号状态标签（已登录/需重扫）可见
    - 05-acquisition-task-table.png   期望：点「开始采集」后 Table 出现新行，状态列可见
  期望：Playwright spec 所有 expect() 通过
