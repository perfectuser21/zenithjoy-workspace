---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard OperatorPage 重构（thin → medium）

**范围**: 重写 `apps/dashboard/src/pages/OperatorPage.tsx`：8 平台主号单列展示（非 4×4 矩阵）；status 枚举修正 ok→active；每行含「登录」按钮触发 POST trigger-bind；GET sessions 30s 轮询；lastCheckedAt/lastValidAt 时间显示；is_operator 守卫保留
**大小**: M（~190 行净变化，1 文件）
**依赖**: Workstream 2 完成后

---

## ARTIFACT 条目

- [ ] [ARTIFACT] OperatorPage.tsx 存在且 export default
  Test: bash -c 'grep -q "export default function OperatorPage\|export default OperatorPage" apps/dashboard/src/pages/OperatorPage.tsx && echo OK || { echo "FAIL: 缺 export default"; exit 1; }'

- [ ] [ARTIFACT] OperatorPage.tsx 含 8 个平台名（抖音/快手/小红书/视频号/头条/微博/知乎/公众号）
  Test: bash -c 'for p in 抖音 快手 小红书 视频号 头条 微博 知乎 公众号; do grep -q "$p" apps/dashboard/src/pages/OperatorPage.tsx || { echo "FAIL: 缺平台 $p"; exit 1; }; done; echo OK'

- [ ] [ARTIFACT] OperatorPage.tsx 含 is_operator 守卫（OPERATOR_EMAIL = xuxiao21xx@icloud.com）
  Test: bash -c 'grep -q "xuxiao21xx@icloud.com" apps/dashboard/src/pages/OperatorPage.tsx && echo OK || { echo "FAIL: 缺 operator email 守卫"; exit 1; }'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] OperatorPage.tsx 调用 GET /api/operator/sessions（使用 PRD 定义的端点，非旧的 /sync）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/OperatorPage.tsx"; grep -qE "operator/sessions" "$F" || { echo "FAIL: 缺 GET /api/operator/sessions 调用"; exit 1; }; grep -q "sync" "$F" && grep -qE "sessions/sync" "$F" && { echo "FAIL: 仍调用旧的 /sync 端点"; exit 1; } || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx status 枚举已修正为 active（禁用 ok 作为有效状态标识）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/OperatorPage.tsx"; grep -qE "\"active\"|'"'"'active'"'"'" "$F" || { echo "FAIL: 缺 active 枚举值"; exit 1; }; grep -qE "status.*[=:=].*[\"'"'"']ok[\"'"'"']|[\"'"'"']ok[\"'"'"'].*status\b" "$F" && { echo "FAIL: 仍使用 ok 作为有效 status 值"; exit 1; } || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx 含「登录」按钮并调用 POST /api/operator/sessions/trigger-bind
  Test: manual:bash -c 'F="apps/dashboard/src/pages/OperatorPage.tsx"; grep -q "登录\|trigger-bind" "$F" || { echo "FAIL: 缺登录按钮或 trigger-bind 调用"; exit 1; }; grep -q "trigger-bind" "$F" || { echo "FAIL: 缺 trigger-bind API 调用"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx 含轮询逻辑（setInterval 或 useEffect 定时刷新，间隔 ≤30000ms）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/OperatorPage.tsx"; grep -qE "setInterval|polling|interval|30000|30 \* 1000" "$F" || { echo "FAIL: 缺轮询逻辑"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx 不含 status='ok' 作为 badge 成功指示（status 枚举对齐 PRD active/expired/missing）
  Test: manual:bash -c 'F="apps/dashboard/src/pages/OperatorPage.tsx"; node -e "const src=require('"'"'fs'"'"').readFileSync('"'"'$F'"'"','"'"'utf8'"'"'); const bad = src.match(/status.*===.*[\"'"'"']ok[\"'"'"']|[\"'"'"']ok[\"'"'"'].*badge|badge.*[\"'"'"']ok[\"'"'"']/g); if(bad&&bad.length){console.error('"'"'FAIL: status ok 仍作为 badge 枚举:'"'"',bad);process.exit(1);} console.log('"'"'OK'"'"')" || { echo "FAIL: OperatorPage 仍用 ok 作 badge"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] OperatorPage.tsx 含 lastCheckedAt 或 lastValidAt 字段显示
  Test: manual:bash -c 'F="apps/dashboard/src/pages/OperatorPage.tsx"; grep -qE "lastCheckedAt|lastValidAt" "$F" || { echo "FAIL: 缺 lastCheckedAt/lastValidAt 显示"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 运营员访问 /operator 页，8 平台行可见，截图自验通过
  Screenshots:
    - ws3-01-initial.png   期望：/operator 页加载，含 8 行平台名（抖音/快手/...），每行含「登录」按钮和 status badge
    - ws3-02-badges.png    期望：8 个 status badge 可见（active🟢/expired🔴/missing⚫ 三态之一）
    - ws3-03-guard.png     期望：非运营员账户访问 /operator 后被 redirect，/operator 页不可访问
  期望：所有截图与期望描述一致，Claude Read 图自验通过
