---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: GET /api/acquisition/leads + LeadsPage.tsx + navigation

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `GET /leads` endpoint（读飞书 Leads 表，支持 grade 筛选）
- `apps/dashboard/src/pages/LeadsPage.tsx`：新建 Leads 列表页（等级标签表格）
- `apps/dashboard/src/config/navigation.config.ts`：注册 `/dashboard/leads` 路由入口

**大小**: M（100-200 行，3 文件）
**依赖**: Workstream 3（GET leads 读取飞书写入的带 grade/keyword 字段数据）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/LeadsPage.tsx` 文件存在且包含 `leads-table` data-testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');if(!c.includes('leads-table'))process.exit(1);if(!c.includes('grade-badge'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `navigation.config.ts` 包含 `/dashboard/leads` 路由入口
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!c.includes('/dashboard/leads'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `acquisition.ts` 包含 `GET` + `leads` 路由定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition.ts','utf8');const lines=c.split('\\n');const hasGet=lines.some(l=>l.includes('.get(')&&l.includes('leads'));if(!hasGet)process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，模式A API-level）

- [ ] [BEHAVIOR] GET /api/acquisition/leads 返回 HTTP 200，顶层 keys 精确等于 `["leads","total"]`
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:3001/api/acquisition/leads); echo "$RESP" | jq -e '"'"'keys == ["leads","total"]'"'"' || { echo "FAIL: schema keys 不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `leads` 为数组，`total` 为数字（schema 字段类型）
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:3001/api/acquisition/leads); echo "$RESP" | jq -e '"'"'.leads | type == "array"'"'"' || { echo "FAIL: leads 非 array"; exit 1; }; echo "$RESP" | jq -e '"'"'.total | type == "number"'"'"' || { echo "FAIL: total 非 number"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段（`data`/`items`/`records`/`rows`/`result`）不存在于 response 顶层
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:3001/api/acquisition/leads); for F in data items records rows result; do echo "$RESP" | jq -e "has(\"$F\") | not" || { echo "FAIL: 禁用字段 $F 存在"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `grade` 查询参数筛选生效（grade=高意向 → 结果全为 `"高意向"`）
  Test: manual:bash -c 'RESP=$(curl -sf "http://localhost:3001/api/acquisition/leads?grade=高意向"); VALID=$(echo "$RESP" | jq -e '"'"'.leads | map(.grade) | all(. == "高意向")'"'"' && echo 1 || echo 0); [ "$VALID" = "1" ] || { echo "FAIL: grade 筛选不正确"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `grade` 非法值返回 HTTP 400 + `{"error": "INVALID_GRADE"}`（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/leads_err.json -w "%{http_code}" "http://localhost:3001/api/acquisition/leads?grade=invalid"); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际=$CODE"; exit 1; }; cat /tmp/leads_err.json | jq -e '"'"'.error == "INVALID_GRADE"'"'"' || { echo "FAIL: error 字段非 INVALID_GRADE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用 query 参数别名 `level` 不被识别为筛选（grade API 不接受 level 参数）
  Test: manual:bash -c 'RESP=$(curl -sf "http://localhost:3001/api/acquisition/leads?level=高意向"); echo "$RESP" | jq -e '"'"'.leads | type == "array"'"'"' || { echo "FAIL: level 参数导致报错，应被忽略"; exit 1; }; echo OK'
  期望: OK（`level` 参数被忽略，返回全量或默认结果）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 在 windows_cloud Playwright 中执行）

- [ ] [BEHAVIOR:E2E] 用户访问 /dashboard/leads 页面，Leads 表格可见，等级标签正常渲染
  Screenshots:
    - 01-initial.png   期望：`/dashboard/leads` 页面正常加载，`[data-testid="leads-table"]` 表格可见，页面标题含「获客 Leads」或「Leads」
    - 02-action.png    期望：grade 筛选下拉可见，选择「高意向」后表格行减少或过滤，`[data-testid="grade-badge"]` 标签显示
    - 03-result.png    期望：筛选结果页面，所有可见行的等级标签均为「高意向」（🔴 样式），无「感兴趣」或「精准」行可见
  期望：所有截图与期望描述一致，Claude Read 图自验通过
