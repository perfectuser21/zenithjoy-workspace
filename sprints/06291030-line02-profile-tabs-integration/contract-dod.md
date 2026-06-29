---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line02 公司信息 Tab 布局 + 智能获客集成 + E2E 真实链路

**范围**: CompanyProfilePage.tsx 改 3 Tab 布局 + onBlur 自动保存；AcquisitionConfigPage 推荐关键词 chips + 开场白 placeholder；Playwright spec 去 stub；smoke.sh 加 psql 全字段时间窗验证  
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CompanyProfilePage.tsx` 存在 3 个 Tab（含文字「基础信息」「产品与价值」「目标客群」）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx','utf8');if(!c.includes('基础信息')||!c.includes('产品与价值')||!c.includes('目标客群'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CompanyProfilePage.tsx` 含 onBlur 自动保存逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CompanyProfilePage.tsx','utf8');if(!c.includes('onBlur')&&!c.includes('handleBlur'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/e2e/line02-company-profile-collect.spec.ts` 已删除 company-profile/acquisition API stubs
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/line02-company-profile-collect.spec.ts','utf8');if(c.includes(\"page.route('**/api/company-profile\"))process.exit(1);if(c.includes(\"page.route('**/api/acquisition/collect\"))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh` 含 psql 时间窗验证（`NOW() - interval`）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh','utf8');if(!c.includes('NOW() - interval'))process.exit(1)"

- [ ] [ARTIFACT] `sprints/06291030-line02-profile-tabs-integration/e2e-verify.ps1` 存在且含 Playwright 调用
  Test: node -e "const c=require('fs').readFileSync('sprints/06291030-line02-profile-tabs-integration/e2e-verify.ps1','utf8');if(!c.includes('playwright'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/` 含推荐关键词构建逻辑（`buildRecommendedKeywords` 或同等内联逻辑）
  Test: node -e "const {execSync}=require('child_process');const out=execSync('grep -r \"buildRecommendedKeywords\\|recommended.*keyword\\|keyword.*chip\" apps/dashboard/src/ --include=\"*.tsx\" --include=\"*.ts\" -l').toString().trim();if(!out)process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/e2e-windows.yml` `Run E2E verification` step env 段含 `E2E_DATABASE_URL`
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-windows.yml','utf8');if(!c.includes('E2E_DATABASE_URL'))process.exit(1)"

---

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接执行）

### [BEHAVIOR 1] CompanyProfilePage 渲染 3 个 Tab

- [ ] [BEHAVIOR] CompanyProfilePage.tsx 包含 3 个 Tab 标识文字
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/CompanyProfilePage.tsx\",\"utf8\");const tabs=[\"基础信息\",\"产品与价值\",\"目标客群\"];const miss=tabs.filter(t=>!c.includes(t));if(miss.length){console.error(\"FAIL:\",miss.join(\",\"));process.exit(1);}console.log(\"OK\")"'
  期望: OK

### [BEHAVIOR 2] onBlur 自动保存 — PUT /api/company-profile 返回 success=true, data.updated=true

- [ ] [BEHAVIOR] PUT /api/company-profile 返回 success=true 且 data.updated=true
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; RESP=$(curl -sf -X PUT "$API/api/company-profile" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"company_name\":\"dod-test-$(date +%s)\",\"city\":\"西安\",\"industry\":\"餐饮\",\"description\":\"\",\"products\":[],\"key_advantages\":[],\"customer_problem\":\"\",\"customer_portrait\":\"\",\"qa_list\":[]}") || { echo "FAIL: curl"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }; echo "$RESP" | jq -e ".data.updated == true" || { echo "FAIL: data.updated!=true"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 3] GET /api/company-profile — 全 9 字段 + keys 完整性 + 禁用字段反向

- [ ] [BEHAVIOR] GET /api/company-profile 返回全 9 字段 + keys 完整 + 禁用字段不存在
  Test: manual:bash -c '
API="${API_URL:-http://localhost:3000}"
TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"
CNAME="dod-check-$(date +%s)"
curl -sf -X PUT "$API/api/company-profile" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"company_name\":\"$CNAME\",\"city\":\"\",\"industry\":\"\",\"description\":\"\",\"products\":[],\"key_advantages\":[],\"customer_problem\":\"\",\"customer_portrait\":\"\",\"qa_list\":[]}" > /dev/null || { echo "FAIL: PUT"; exit 1; }
RESP=$(curl -sf "$API/api/company-profile" -H "X-Tenant-Id: $TENANT") || { echo "FAIL: GET"; exit 1; }
echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }
for F in company_name city industry description products key_advantages customer_problem customer_portrait qa_list; do
  echo "$RESP" | jq -e ".data | has(\"$F\")" > /dev/null || { echo "FAIL: 缺字段 $F"; exit 1; }
done
echo "$RESP" | jq -e ".data | keys == [\"city\",\"company_name\",\"customer_portrait\",\"customer_problem\",\"description\",\"industry\",\"key_advantages\",\"products\",\"qa_list\"]" || { echo "FAIL: keys 不匹配"; exit 1; }
echo "$RESP" | jq -e ".data | has(\"result\") | not" || { echo "FAIL: 禁用字段 result 在 data"; exit 1; }
echo "$RESP" | jq -e ".data | has(\"profile\") | not" || { echo "FAIL: 禁用字段 profile 在 data"; exit 1; }
echo "$RESP" | jq -e ".data | has(\"saved\") | not" || { echo "FAIL: 禁用字段 saved 在 data"; exit 1; }
RETURNED=$(echo "$RESP" | jq -r ".data.company_name")
[ "$RETURNED" = "$CNAME" ] || { echo "FAIL: company_name=$RETURNED != $CNAME"; exit 1; }
echo OK'
  期望: OK

### [BEHAVIOR 4] POST /api/acquisition/collect/start — schema 正确 + 禁用字段反向

- [ ] [BEHAVIOR] collect/start 返回 task_id(string) + status=pending，禁用字段不出现
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; RESP=$(curl -sf -X POST "$API/api/acquisition/collect/start" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"keywords\":[\"dod-smoke-$(date +%s)\"]}") || { echo "FAIL: curl"; exit 1; }; echo "$RESP" | jq -e ".success == true" || { echo "FAIL: success!=true"; exit 1; }; echo "$RESP" | jq -e ".data.status == \"pending\"" || { echo "FAIL: status!=pending"; exit 1; }; echo "$RESP" | jq -e ".data.task_id | type == \"string\"" || { echo "FAIL: task_id 非 string"; exit 1; }; echo "$RESP" | jq -e ".data | has(\"id\") | not" || { echo "FAIL: 禁用字段 id"; exit 1; }; echo "$RESP" | jq -e ".data | has(\"taskId\") | not" || { echo "FAIL: 禁用字段 taskId"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 5] PUT error path — 空 company_name → 400 + success=false

- [ ] [BEHAVIOR] PUT /api/company-profile 空 company_name → 400
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; CODE=$(curl -s -o /tmp/dod_err.json -w "%{http_code}" -X PUT "$API/api/company-profile" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"company_name\":\"\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 空 company_name 未返 400，实际=$CODE"; exit 1; }; cat /tmp/dod_err.json | jq -e ".success == false" || { echo "FAIL: success!=false"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 6] collect/start error path — 空 keywords → 400

- [ ] [BEHAVIOR] POST /api/acquisition/collect/start 空 keywords 数组 → 400
  Test: manual:bash -c 'API="${API_URL:-http://localhost:3000}"; TENANT="${TENANT:-2ac0aa4a-99f4-470a-aed7-c3a9fe03149b}"; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/acquisition/collect/start" -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT" -d "{\"keywords\":[]}"); [ "$CODE" = "400" ] || { echo "FAIL: 空 keywords 未返 400，实际=$CODE"; exit 1; }; echo OK'
  期望: OK

### [BEHAVIOR 7] 开场白 placeholder 含公司信息（FROM_PRD Step 7）

- [ ] [BEHAVIOR] AcquisitionConfigPage 的开场白输入框 placeholder 含公司名或产品名（基于公司信息动态生成）
  Test: manual:bash -c '
node -e "
const c = require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AcquisitionConfigPage.tsx\", \"utf8\");
const hasPlaceholder = c.includes(\"company_name\") || c.includes(\"companyName\") || c.includes(\"getCompanyProfile\");
const hasOpeningField = c.includes(\"opening\") || c.includes(\"开场白\") || c.includes(\"话术\");
if (!hasPlaceholder) { console.error(\"FAIL: AcquisitionConfigPage 未接入公司信息字段\"); process.exit(1); }
if (!hasOpeningField) { console.error(\"FAIL: AcquisitionConfigPage 无开场白/话术字段\"); process.exit(1); }
console.log(\"OK\");
"'
  期望: OK

### [BEHAVIOR 8] 保存失败 → 红色 toast（FROM_PRD EP-3）

- [ ] [BEHAVIOR] Playwright spec 含保存失败 EP 断言（page.route 拦截 PUT → 500 + 验证红色 toast）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/line02-company-profile-collect.spec.ts\",\"utf8\");if(!c.includes(\"保存失败\")&&!c.includes(\"请重试\"))process.exit(1);if(!c.includes(\"page.route\")&&!c.includes(\"fulfill\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，windows_cloud Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path（3 Tab + onBlur 保存 + 持久化 + 推荐 chips + 开场白 placeholder），截图可视化验证
  Screenshots:
    - 01-company-profile-tabs.png   期望：公司信息页显示 3 个 Tab 标签，Tab 1「基础信息」处于激活态
    - 02-save-toast.png             期望：Tab 切换后「已保存 ✓」或「已保存」toast 可见
    - 03-after-refresh.png          期望：页面刷新后 Tab 1 公司名仍为「烟雨楼测试公司」
    - 04-acquisition-chips.png      期望：/dashboard/acquisition-config 推荐关键词 chips 至少 1 个可见
    - 05-save-error-toast.png       期望：保存失败场景下「保存失败」或「请重试」红色 toast 可见
  期望：所有截图与期望描述一致，Claude Read 图自验通过

evaluator 完成验收后执行：
```bash
mkdir -p "sprints/06291030-line02-profile-tabs-integration/screenshots/"
cp screenshots/*.png "sprints/06291030-line02-profile-tabs-integration/screenshots/" 2>/dev/null || true
```
