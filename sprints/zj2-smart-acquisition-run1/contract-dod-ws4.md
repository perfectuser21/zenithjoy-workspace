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

> **鉴权说明**: GET leads 为用户侧调用，所有 BEHAVIOR curl 命令携带 `Authorization: Bearer $TEST_TOKEN`

- [ ] [BEHAVIOR] GET /api/acquisition/leads 返回 HTTP 200，顶层 keys 精确等于 `["leads","total"]`
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:3001/api/acquisition/leads -H "Authorization: Bearer $TEST_TOKEN"); echo "$RESP" | jq -e '"'"'keys == ["leads","total"]'"'"' || { echo "FAIL: schema keys 不匹配"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `leads` 为数组，`total` 为数字（schema 字段类型）
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:3001/api/acquisition/leads -H "Authorization: Bearer $TEST_TOKEN"); echo "$RESP" | jq -e '"'"'.leads | type == "array"'"'"' || { echo "FAIL: leads 非 array"; exit 1; }; echo "$RESP" | jq -e '"'"'.total | type == "number"'"'"' || { echo "FAIL: total 非 number"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] lead item 6 必填字段完整性：commenter_id / comment_text / source_video_url / crawled_at / grade / keyword 全部存在且类型正确（PRD Response Schema 原文字段，防 schema drift）
  Test: manual:bash -c '
    # 先通过完整链路创建一条测试 lead，确保有数据
    TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search -H "Content-Type: application/json" -H "Authorization: Bearer $TEST_TOKEN" -d '"'"'{"keyword":"ws4_field_test"}'"'"' | jq -r '"'"'.task_id'"'"');
    curl -sf -X POST http://localhost:3001/api/acquisition/video-search-result -H "Content-Type: application/json" -d "{\"keyword_task_id\":\"$TASK_ID\",\"keyword\":\"ws4_field_test\",\"videos\":[{\"video_url\":\"https://www.douyin.com/video/ws4field\"}]}" > /dev/null;
    curl -sf -X POST http://localhost:3001/api/acquisition/comment-score-result -H "Content-Type: application/json" -d "{\"keyword_task_id\":\"$TASK_ID\",\"video_url\":\"https://www.douyin.com/video/ws4field\",\"comments\":[{\"commenter_id\":\"@ws4_test\",\"text\":\"需要你的服务，怎么联系\",\"publish_time\":\"2026-05-24T10:00:00Z\"}]}" > /dev/null;
    sleep 2;
    RESP=$(curl -sf "http://localhost:3001/api/acquisition/leads" -H "Authorization: Bearer $TEST_TOKEN");
    CNT=$(echo "$RESP" | jq '"'"'.leads | length'"'"');
    if [ "$CNT" -gt 0 ]; then
      for F in commenter_id comment_text source_video_url crawled_at grade keyword; do
        echo "$RESP" | jq -e ".leads[0] | has(\"$F\")" || { echo "FAIL: lead item 缺字段 $F"; exit 1; };
      done;
      echo "$RESP" | jq -e '"'"'.leads[0].commenter_id | type == "string"'"'"' || { echo "FAIL: commenter_id 非 string"; exit 1; };
      echo "$RESP" | jq -e '"'"'.leads[0].comment_text | type == "string"'"'"' || { echo "FAIL: comment_text 非 string"; exit 1; };
      echo "$RESP" | jq -e '"'"'.leads[0].source_video_url | type == "string"'"'"' || { echo "FAIL: source_video_url 非 string"; exit 1; };
      echo "$RESP" | jq -e '"'"'.leads[0].grade | test("^(感兴趣|精准|高意向)$")'"'"' || { echo "FAIL: grade 枚举值非法"; exit 1; };
      echo "$RESP" | jq -e '"'"'.leads[0].keyword | type == "string"'"'"' || { echo "FAIL: keyword 非 string"; exit 1; };
    fi;
    echo OK'
  期望: OK（有记录时验证6字段存在且类型正确；无记录跳过）

- [ ] [BEHAVIOR] 禁用字段（`data`/`items`/`records`/`rows`/`result`）不存在于 response 顶层
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:3001/api/acquisition/leads -H "Authorization: Bearer $TEST_TOKEN"); for F in data items records rows result; do echo "$RESP" | jq -e "has(\"$F\") | not" || { echo "FAIL: 禁用字段 $F 存在"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `grade` 查询参数筛选生效（grade=高意向 → 结果全为 `"高意向"`）
  Test: manual:bash -c 'RESP=$(curl -sf "http://localhost:3001/api/acquisition/leads?grade=高意向" -H "Authorization: Bearer $TEST_TOKEN"); VALID=$(echo "$RESP" | jq -e '"'"'.leads | map(.grade) | all(. == "高意向")'"'"' && echo 1 || echo 0); [ "$VALID" = "1" ] || { echo "FAIL: grade 筛选不正确"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `grade` 非法值返回 HTTP 400 + `{"error": "INVALID_GRADE"}`（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/leads_err.json -w "%{http_code}" "http://localhost:3001/api/acquisition/leads?grade=invalid" -H "Authorization: Bearer $TEST_TOKEN"); [ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际=$CODE"; exit 1; }; cat /tmp/leads_err.json | jq -e '"'"'.error == "INVALID_GRADE"'"'"' || { echo "FAIL: error 字段非 INVALID_GRADE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用 query 参数别名 `level` 不被识别为筛选（grade API 不接受 level 参数）
  Test: manual:bash -c 'RESP=$(curl -sf "http://localhost:3001/api/acquisition/leads?level=高意向" -H "Authorization: Bearer $TEST_TOKEN"); echo "$RESP" | jq -e '"'"'.leads | type == "array"'"'"' || { echo "FAIL: level 参数导致报错，应被忽略"; exit 1; }; echo OK'
  期望: OK（`level` 参数被忽略，返回全量或默认结果）

- [ ] [BEHAVIOR] 飞书 token 过期时 GET /api/acquisition/leads 返回 HTTP 503 + `{"error":"FEISHU_TOKEN_EXPIRED"}`（PRD 边界情况）
  Test: manual:bash -c '
    # 保存当前 token，注入过期 mock token
    ORIG_TOKEN=$(psql $DB -t -c "SELECT tenant_access_token FROM zenithjoy.tenant_feishu_bindings LIMIT 1" 2>/dev/null | tr -d " " || echo "");
    if [ -n "$ORIG_TOKEN" ]; then
      psql $DB -c "UPDATE zenithjoy.tenant_feishu_bindings SET tenant_access_token='"'"'EXPIRED_MOCK_TOKEN_EVALUATOR'"'"'" > /dev/null;
      CODE=$(curl -s -o /tmp/feishu_err.json -w "%{http_code}" http://localhost:3001/api/acquisition/leads -H "Authorization: Bearer $TEST_TOKEN");
      psql $DB -c "UPDATE zenithjoy.tenant_feishu_bindings SET tenant_access_token='"'"'$ORIG_TOKEN'"'"'" > /dev/null;
      [ "$CODE" = "503" ] || { echo "FAIL: 期望 503 FEISHU_TOKEN_EXPIRED，实际=$CODE"; exit 1; };
      cat /tmp/feishu_err.json | jq -e '"'"'.error == "FEISHU_TOKEN_EXPIRED"'"'"' || { echo "FAIL: error 字段非 FEISHU_TOKEN_EXPIRED"; exit 1; };
    else
      echo "SKIP: 无飞书绑定记录，跳过 token 过期测试（本环境无需飞书绑定）";
    fi;
    echo OK'
  期望: OK（有飞书绑定时验证 503；无绑定时 SKIP）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 在 windows_cloud Playwright 中执行）

- [ ] [BEHAVIOR:E2E] 用户访问 /dashboard/leads 页面，Leads 表格可见，等级标签正常渲染
  Screenshots:
    - 01-initial.png   期望：`/dashboard/leads` 页面正常加载，`[data-testid="leads-table"]` 表格可见，页面标题含「获客 Leads」或「Leads」
    - 02-action.png    期望：grade 筛选下拉可见，选择「高意向」后表格行减少或过滤，`[data-testid="grade-badge"]` 标签显示
    - 03-result.png    期望：筛选结果页面，所有可见行的等级标签均为「高意向」（🔴 样式），无「感兴趣」或「精准」行可见
  期望：所有截图与期望描述一致，Claude Read 图自验通过
