---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard E2E Playwright spec

**范围**: 新建 `apps/dashboard/e2e/operator-sessions.spec.ts`：8 平台行存在断言 + status badge + 登录按钮；API 全部 stub（page.route）；非运营员 redirect 验证；GET sessions response mock 含 active/expired/missing 三态
**大小**: S（~130 行净增，1 文件）
**依赖**: Workstream 3 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/e2e/operator-sessions.spec.ts` 存在
  Test: bash -c '[ -f "apps/dashboard/e2e/operator-sessions.spec.ts" ] && echo OK || { echo "FAIL: spec 文件不存在"; exit 1; }'

- [ ] [ARTIFACT] spec 文件含 `page.route` stub（不依赖真实后端）
  Test: bash -c 'grep -q "page.route\|page\.route" apps/dashboard/e2e/operator-sessions.spec.ts && echo OK || { echo "FAIL: spec 缺 page.route stub"; exit 1; }'

- [ ] [ARTIFACT] spec 文件含 8 个平台名断言（至少断言抖音/快手/小红书/视频号/头条/微博/知乎/公众号）
  Test: bash -c 'for p in 抖音 快手 小红书 视频号 头条 微博 知乎 公众号; do grep -q "$p" apps/dashboard/e2e/operator-sessions.spec.ts || { echo "FAIL: spec 缺平台 $p 断言"; exit 1; }; done; echo OK'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] spec 含至少 3 个 test/it 块（8 平台行 + status badge + 登录按钮 + redirect 各一块）
  Test: manual:bash -c 'COUNT=$(grep -cE "^\s*test\(|^\s*it\(" apps/dashboard/e2e/operator-sessions.spec.ts 2>/dev/null || echo 0); [ "$COUNT" -ge 3 ] || { echo "FAIL: spec 只有 $COUNT 个测试块，期望 ≥3"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] spec 使用 active（非 ok）作为 stub mock 中的成功 status 值（对齐 PRD status 枚举）
  Test: manual:bash -c 'F="apps/dashboard/e2e/operator-sessions.spec.ts"; grep -qE '"'"'"active"|'"'"'active'"'"'" "$F" || { echo "FAIL: spec mock 缺 active 状态值"; exit 1; }; grep -qE '"'"'"status"[[:space:]]*:[[:space:]]*"ok"'"'"' "$F" && { echo "FAIL: spec 仍用 ok 作为 status mock 值"; exit 1; } || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] spec stub 的 GET /api/operator/sessions mock response 含 8 条且每项含 platform/status/secretName 字段
  Test: manual:bash -c 'F="apps/dashboard/e2e/operator-sessions.spec.ts"; node -e "const src=require('"'"'fs'"'"').readFileSync('"'"'$F'"'"','"'"'utf8'"'"'); if(!src.includes('"'"'platform'"'"')||!src.includes('"'"'status'"'"')||!src.includes('"'"'secretName'"'"')){console.error('"'"'FAIL: stub mock 缺 platform/status/secretName 字段'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || { echo "FAIL"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] spec 含非运营员 redirect 断言（非 xuxiao21xx@icloud.com 访问 /operator 被 redirect）
  Test: manual:bash -c 'F="apps/dashboard/e2e/operator-sessions.spec.ts"; grep -qE "redirect|navigate|location|operator" "$F" && grep -qE "非运营员|non-operator|guard|redirect" "$F" || { echo "FAIL: spec 缺 is_operator redirect 断言"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] spec 中 mock response 的 status 枚举不含禁用值（ok/healthy/valid）
  Test: manual:bash -c 'F="apps/dashboard/e2e/operator-sessions.spec.ts"; for banned in '"'"'"status":"ok"'"'"' '"'"'"status":"healthy"'"'"' '"'"'"status":"valid"'"'"'; do grep -q "$banned" "$F" && { echo "FAIL: spec mock 含禁用 status 值 $banned"; exit 1; } || true; done; echo OK'
  期望: OK
