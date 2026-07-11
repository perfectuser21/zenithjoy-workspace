# Contract DoD：对话式创建 Skill — 后台长跑生成改造

sprint_dir: sprints/07101942-skill-create-longrun
task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
created_at: 2026-07-10

---

## [BEHAVIOR] 条目清单

### [BEHAVIOR] B-01：chatting→running 合法触发

**描述**：`status=chatting` 的草稿调用 `POST /:id/generate` 必须立即返回 running，且后台 spawn detached 子进程

**manual:bash**：
```bash
# 前置：有一个 status=chatting 的 skill_draft，DRAFT_ID 已设
DRAFT_ID="<your-draft-id>"
API_BASE="http://localhost:3001/api/skill-drafts"
# 调用 generate
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/$DRAFT_ID/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STAFF_TOKEN")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
echo "HTTP: $HTTP_CODE"
echo "Body: $BODY"
# 断言
[ "$HTTP_CODE" = "200" ] && echo "OK: HTTP 200" || echo "FAIL: expected 200, got $HTTP_CODE"
echo "$BODY" | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(b.status==='running'?0:1)" \
  && echo "OK: status=running" || echo "FAIL: status not running"
```

---

### [BEHAVIOR] B-03：running 状态互斥拒绝重复 generate

**描述**：`status=running` 的草稿调用 `POST /:id/generate` 必须返回 409，不产生第二个子进程

**manual:bash**：
```bash
DRAFT_ID="<draft-already-in-running-state>"
API_BASE="http://localhost:3001/api/skill-drafts"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/$DRAFT_ID/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STAFF_TOKEN")
echo "HTTP: $HTTP_CODE"
[ "$HTTP_CODE" = "409" ] && echo "OK: 409 互斥" || echo "FAIL: expected 409, got $HTTP_CODE"
```

---

### [BEHAVIOR] B-05：callback event=done 写入终态

**描述**：token 匹配 + event=done 时，callback 端点将 draft 状态改为 done，写入 result_json.zip_path

**manual:bash**：
```bash
DRAFT_ID="<draft-id-in-running>"
TOKEN="<callback_token-from-db>"
API_BASE="http://localhost:3001/internal/skill-drafts"
# 发送 done callback
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/$DRAFT_ID/callback" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"event\":\"done\",\"zip_path\":\"/tmp/skill-test.zip\"}")
echo "HTTP: $HTTP_CODE"
[ "$HTTP_CODE" = "200" ] && echo "OK: callback accepted" || echo "FAIL: expected 200, got $HTTP_CODE"
# 查 DB 确认状态
psql "$DATABASE_URL" -c "SELECT status, result_json FROM zenithjoy.skill_drafts WHERE id='$DRAFT_ID';"
```

---

### [BEHAVIOR] B-08：callback token 不匹配返回 400，状态不变

**描述**：错误 token 的 callback 返回 400，draft 状态不改变

**manual:bash**：
```bash
DRAFT_ID="<draft-id>"
WRONG_TOKEN="00000000-0000-0000-0000-000000000000"
API_BASE="http://localhost:3001/internal/skill-drafts"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/$DRAFT_ID/callback" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$WRONG_TOKEN\",\"event\":\"done\",\"zip_path\":\"/tmp/x.zip\"}")
echo "HTTP: $HTTP_CODE"
[ "$HTTP_CODE" = "400" ] && echo "OK: 400 token 拒绝" || echo "FAIL: expected 400, got $HTTP_CODE"
# 状态应未变
psql "$DATABASE_URL" -c "SELECT status FROM zenithjoy.skill_drafts WHERE id='$DRAFT_ID';"
```

---

### [BEHAVIOR] B-10：needs_input 状态下 answer 合法，状态→running

**描述**：`status=needs_input` 时提交答案，状态回到 running，重新 spawn 子进程

**manual:bash**：
```bash
DRAFT_ID="<draft-id-in-needs_input>"
API_BASE="http://localhost:3001/api/skill-drafts"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/$DRAFT_ID/answer" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -d '{"answer":"我要做一个帮助用户记账的 Skill"}')
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
echo "HTTP: $HTTP_CODE"
[ "$HTTP_CODE" = "200" ] && echo "OK: answer accepted" || echo "FAIL: expected 200, got $HTTP_CODE"
echo "$BODY" | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(b.status==='running'?0:1)" \
  && echo "OK: status=running" || echo "FAIL: status not running"
```

---

### [BEHAVIOR] B-12：软超时兜底 — GET 返回 error

**描述**：`status=running` 且 `updated_at` 超过 2 小时，GET `/:id` 响应 `status=error` 含超时信息

**manual:bash**：
```bash
DRAFT_ID="<draft-id>"
# 手动将 updated_at 设为 3 小时前
psql "$DATABASE_URL" -c "UPDATE zenithjoy.skill_drafts SET updated_at = NOW() - INTERVAL '3 hours' WHERE id='$DRAFT_ID';"
# 验证 GET 响应
RESP=$(curl -s "$API_BASE/$DRAFT_ID" -H "Authorization: Bearer $STAFF_TOKEN")
echo "$RESP" | node -e "
  const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:', b.status);
  console.log('error_message:', b.result_json && b.result_json.error_message);
  const ok = b.status==='error' && b.result_json && b.result_json.error_message && b.result_json.error_message.includes('超时');
  process.exit(ok?0:1);
" && echo "OK: 软超时返回 error" || echo "FAIL: 软超时未生效"
```

---

### [BEHAVIOR] B-16：DB migration 字段存在

**描述**：migration 执行后 `skill_drafts` 表含三个新字段

**manual:bash**：
```bash
psql "$DATABASE_URL" -c "\d zenithjoy.skill_drafts" | grep -E "pending_question|result_json|callback_token"
# 期望输出 3 行
COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='skill_drafts' AND column_name IN ('pending_question','result_json','callback_token');")
echo "新字段数量: $COUNT"
[ "$(echo $COUNT | tr -d ' ')" = "3" ] && echo "OK: 3 个新字段均存在" || echo "FAIL: 字段缺失，实际数量=$COUNT"
```

---

### [BEHAVIOR] B-14：done 终态封闭，任何 action 不改变状态

**描述**：`status=done` 时，generate/answer/callback 均被拒绝，状态不变

**manual:bash**：
```bash
DRAFT_ID="<draft-id-in-done>"
API_BASE="http://localhost:3001/api/skill-drafts"
# 尝试 generate
GEN_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/$DRAFT_ID/generate" \
  -H "Authorization: Bearer $STAFF_TOKEN")
# 尝试 answer
ANS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/$DRAFT_ID/answer" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -d '{"answer":"test"}')
echo "generate on done: $GEN_CODE (expect 409)"
echo "answer on done: $ANS_CODE (expect 409)"
[ "$GEN_CODE" = "409" ] && echo "OK: generate 被拒绝" || echo "FAIL: generate 未拒绝"
[ "$ANS_CODE" = "409" ] && echo "OK: answer 被拒绝" || echo "FAIL: answer 未拒绝"
# 确认状态未变
psql "$DATABASE_URL" -c "SELECT status FROM zenithjoy.skill_drafts WHERE id='$DRAFT_ID';"
```

---

## DoD 总体核查清单

- [ ] B-01 chatting→running：`POST /generate` HTTP 200，spawn+unref 断言
- [ ] B-02 error→running 重试：HTTP 200，新 callback_token 生成
- [ ] B-03 running 互斥：HTTP 409，spawn 调用次数 = 0
- [ ] B-04 needs_input 拒绝 generate：HTTP 409
- [ ] B-05 callback done：状态→done，result_json.zip_path 写入，DB 确认
- [ ] B-06 callback needs_input：状态→needs_input，pending_question 写入
- [ ] B-07 callback error：状态→error，result_json.error_message 写入
- [ ] B-08 callback token 不匹配：HTTP 400，状态不变（DB 确认）
- [ ] B-09 callback token 单次绑定：同 token 二次调用 HTTP 400
- [ ] B-10 answer on needs_input：HTTP 200，状态→running，消息追加
- [ ] B-11 answer 非 needs_input：HTTP 409
- [ ] B-12 软超时：GET 返回 error，error_message 含"超时"
- [ ] B-13 GET 新字段：响应含 pending_question、result_json
- [ ] B-14 done 终态封闭：所有 action 被拒绝（generate/answer HTTP 409，callback HTTP 400）
- [ ] B-15 子进程 detached：spawn 调用含 detached:true，unref() 调用
- [ ] B-16 DB migration：三字段均存在
- [ ] B-17 前端轮询 8s：Network 面板确认，running 状态下 8s 间隔 GET
- [ ] B-18 前端 done 下载链接：页面含 zip 下载 anchor
- [ ] B-19 前端 needs_input UI：问题文本 + 输入框 + 提交按钮均渲染
- [ ] B-20 前端 error 重试按钮："重新开始"按钮存在且可点

---

## CI 验收门槛

```bash
# 单测（API 路由合同测试）
cd /workspace && npx jest apps/api/src/routes/__tests__/skill-drafts-longrun.test.ts --passWithNoTests
# Playwright E2E（windows_cloud CI runner 上执行）
npx playwright test apps/dashboard/e2e/skill-create-longrun.spec.ts
```

所有测试绿色 = sprint 通过。任一红色 = sprint 不通过，禁止合并到 main。
