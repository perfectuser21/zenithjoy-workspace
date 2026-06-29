---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line02 公司信息 Tab 布局 + 智能获客集成 + E2E 真实链路

**范围**: CompanyProfilePage.tsx 改 3 Tab 布局 + onBlur 自动保存；AcquisitionConfigPage 推荐关键词 chips；Playwright spec 去 stub；smoke.sh 加 psql 时间窗验证
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CompanyProfilePage.tsx` 存在 3 个 Tab（role=tab 元素）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx','utf8');if(!c.includes('基础信息')||!c.includes('产品与价值')||!c.includes('目标客群'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CompanyProfilePage.tsx` 含 onBlur 自动保存逻辑（blur 触发 updateCompanyProfile）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx','utf8');if(!c.includes('onBlur')&&!c.includes('on_blur'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/e2e/line02-company-profile-collect.spec.ts` 已删除 company-profile/acquisition API stubs（无 `page.route('**/api/company-profile'` 或 `page.route('**/api/acquisition/collect'` 行）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/line02-company-profile-collect.spec.ts','utf8');if(c.includes(\"page.route('**/api/company-profile\"))process.exit(1);if(c.includes(\"page.route('**/api/acquisition/collect\"))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh` 含 psql 时间窗验证（`NOW() - interval`）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh','utf8');if(!c.includes(\"NOW() - interval\"))process.exit(1)"

- [ ] [ARTIFACT] `sprints/06291030-line02-profile-tabs-integration/e2e-verify.ps1` 存在且含 Playwright 调用
  Test: node -e "const c=require('fs').readFileSync('sprints/06291030-line02-profile-tabs-integration/e2e-verify.ps1','utf8');if(!c.includes('playwright'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/` 含推荐关键词构建逻辑（`buildRecommendedKeywords` 或类似函数，或内联 filter+slice 逻辑）
  Test: node -e "const {execSync}=require('child_process');const out=execSync('grep -r \"buildRecommendedKeywords\\|recommended.*keyword\\|keyword.*chip\" apps/dashboard/src/ --include=\"*.tsx\" --include=\"*.ts\" -l').toString().trim();if(!out)process.exit(1)"

---

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接执行）

### [BEHAVIOR 1] CompanyProfilePage 渲染 3 个 Tab（Tab 布局替代旧平铺 section）

- [ ] [BEHAVIOR] CompanyProfilePage.tsx 包含 3 个 Tab 标识文字（基础信息 / 产品与价值 / 目标客群）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/CompanyProfilePage.tsx\",\"utf8\");const tabs=[\"基础信息\",\"产品与价值\",\"目标客群\"];const missing=tabs.filter(t=>!c.includes(t));if(missing.length){console.error(\"FAIL: 缺 Tab 文字:\",missing.join(\",\"));process.exit(1);}console.log(\"OK: 3 Tab 文字均存在\")"'
  期望: OK: 3 Tab 文字均存在

### [BEHAVIOR 2] onBlur 自动保存 — PUT /api/company-profile 被触发（smoke API 层验证）

- [ ] [BEHAVIOR] smoke.sh 执行 PUT /api/company-profile 后，API 返回 `success=true, data.updated=true`
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; RESP=$(curl -sf -X PUT "$API/api/company-profile" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"company_name\":\"dod-test-$(date +%s)\",\"city\":\"西安\",\"industry\":\"餐饮\",\"description\":\"\",\"products\":[],\"key_advantages\":[],\"customer_problem\":\"\",\"customer_portrait\":\"\",\"qa_list\":[]}") || { echo "FAIL: curl 失败"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true resp=$RESP"; exit 1; }; echo "$RESP" | jq -e ".data.updated == true" || { echo "FAIL: data.updated!=true resp=$RESP"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 3] GET /api/company-profile 返回刚写入的 company_name（持久化验证）

- [ ] [BEHAVIOR] PUT 写入后 GET 返回匹配的 company_name（schema 字段 + 持久化确认）
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; CNAME="dod-check-$(date +%s)"; curl -sf -X PUT "$API/api/company-profile" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"company_name\":\"$CNAME\",\"city\":\"\",\"industry\":\"\",\"description\":\"\",\"products\":[],\"key_advantages\":[],\"customer_problem\":\"\",\"customer_portrait\":\"\",\"qa_list\":[]}" > /dev/null || { echo "FAIL: PUT 失败"; exit 1; }; RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT") || { echo "FAIL: GET 失败"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }; echo "$RESP" | jq -e ".data.company_name | type == \"string\"" || { echo "FAIL: company_name 非 string"; exit 1; }; RETURNED=$(echo "$RESP" | jq -r ".data.company_name"); [ "$RETURNED" = "$CNAME" ] || { echo "FAIL: GET company_name=$RETURNED != $CNAME"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 4] POST /api/acquisition/collect/start 返回 task_id + status=pending

- [ ] [BEHAVIOR] collect/start 响应 schema 正确（task_id string + status=pending），禁用字段不出现
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"keywords\":[\"dod-smoke-$(date +%s)\"]}") || { echo "FAIL: collect/start curl 失败"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }; echo "$RESP" | jq -e ".data.status == \"pending\"" || { echo "FAIL: status!=\"pending\""; exit 1; }; echo "$RESP" | jq -e ".data.task_id | type == \"string\"" || { echo "FAIL: task_id 非 string"; exit 1; }; echo "$RESP" | jq -e "has(\"id\") | not" || { echo "FAIL: 禁用字段 id 存在"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 5] error path — PUT 缺 company_name → 400 + error 字段

- [ ] [BEHAVIOR] PUT /api/company-profile 空 company_name → 400 + success=false
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; CODE=$(curl -s -o /tmp/dod_err.json -w "%{http_code}" -X PUT "$API/api/company-profile" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"company_name\":\"\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 空 company_name 未返 400, 实际=$CODE"; exit 1; }; cat /tmp/dod_err.json | jq -e ".success == false" || { echo "FAIL: success!=false body=$(cat /tmp/dod_err.json)"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 6] collect/start error path — 空 keywords → 400

- [ ] [BEHAVIOR] POST /api/acquisition/collect/start 空 keywords 数组 → 400
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/acquisition/collect/start" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"keywords\":[]}"); [ "$CODE" = "400" ] || { echo "FAIL: 空 keywords 未返 400, 实际=$CODE"; exit 1; }; echo OK'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，windows_cloud Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path（3 Tab + onBlur 保存 + 持久化 + 推荐 chips），截图可视化验证
  Screenshots:
    - 01-company-profile-tabs.png   期望：公司信息页显示 3 个 Tab 标签可见，Tab 1「基础信息」处于激活态
    - 02-save-toast.png             期望：Tab 切换后出现「已保存 ✓」或「已保存」toast，右上角可见
    - 03-after-refresh.png          期望：页面刷新后 Tab 1 公司名仍为「烟雨楼测试公司」，输入框值保持
    - 04-acquisition-chips.png      期望：/dashboard/acquisition-config 页面推荐关键词 chips 区域至少 1 个 chip 可见
  期望：所有截图与期望描述一致，Claude Read 图自验通过

evaluator 完成验收后执行：
```bash
mkdir -p "sprints/06291030-line02-profile-tabs-integration/screenshots/"
cp screenshots/*.png "sprints/06291030-line02-profile-tabs-integration/screenshots/" 2>/dev/null || true
```
