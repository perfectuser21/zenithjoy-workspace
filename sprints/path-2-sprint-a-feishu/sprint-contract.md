# Sprint Contract Draft (Round 1) — Path 2 客户智能获客 · Sprint A 飞书集成

**Sprint**: Path 2 Sprint A 飞书集成
**Branch**: cp-05081646-path2-sprint-a-contract
**Journey Type**: user_facing
**Walking Skeleton Path**: Path 2 客户智能获客 (Notion `35ac40c2-ba63-81ed-8df4-f3fa0b64f5bf`)
**推进**: Path 2 Step 3 + Step 4 thin → thin done

---

## Golden Path

```
[客户在 dashboard 登录]
  → [Step 1: 客户填 app_id/app_secret 入 tenants 表]
  → [Step 2: dashboard 跳飞书 OAuth 授权页]
  → [Step 3: 飞书回调 → 中台拿 tenant_access_token 入库]
  → [Step 4: 中台用 token 在客户 workspace 自动建 1 文档 + 3 张表]
  → [Step 5: 中台返回 Bitable 链接 → dashboard 提示"飞书已绑定 ✓"]
  → [Step 6: 客户在飞书填获客画像 1 行 + 对标视频 1 行 URL]
  → [Step 7: dashboard 点"刷新状态" → 中台拉表数据]
  → [Step 8: dashboard 显示"画像 ✓ 装修/小户型/送方案 PDF"+"对标视频 1 个"]
[出口: dashboard 显示画像已配置 + 对标视频清单非空]
```

---

### Step 1: 客户在 dashboard 提交 app_id / app_secret

**可观测行为**:
- **正常路径**: 客户在 `/dashboard/feishu-bind` 页填入 `app_id` + `app_secret` + 点"开始绑定" → 中台 `tenants` 表对应 tenant_id 行的 `feishu_app_id` / `feishu_app_secret` 字段被写入；返回 200 + OAuth 跳转 URL。
- **错误路径 (R4)**: 若 `tenant_feishu_bindings` 中已有 `tenant_id` 记录（已绑过），中台**不重新生成 authorize_url**，返 400 `{success:false, error:{code:'ALREADY_BOUND'}, data:{rebind_required:true}}`，dashboard 渲染"已绑 X 租户，换绑请先解绑"提示。

**验证命令**:
```bash
# 前置：建测试 tenant
TENANT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-tenant-${RANDOM}', 'smoke-key-${RANDOM}', 'free') RETURNING id" | tr -d ' ')

# 提交飞书 app 配置
RESP=$(curl -fsS -X POST "$API_BASE/api/feishu/oauth/start" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"app_id":"cli_smoke_app","app_secret":"smoke_secret_xxx"}')

# 验证返回的 authorize_url 是飞书域名
AUTHORIZE_URL=$(echo "$RESP" | jq -r '.data.authorize_url')
echo "$AUTHORIZE_URL" | grep -qE '^https://(passport\.|open\.)?feishu\.cn/(open-apis/authen/v1/authorize|suite/passport/oauth/authorize)' \
  || { echo "FAIL: authorize_url 不是飞书域名: $AUTHORIZE_URL"; exit 1; }

# 验证 DB 已写入（带时间窗口防造假，要求最近 60s 内更新）
COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenants WHERE id='$TENANT_ID' AND feishu_app_id='cli_smoke_app' AND updated_at > NOW() - interval '60 seconds'")
[ "$COUNT" = "1" ] || { echo "FAIL: tenants.feishu_app_id 未写入 (count=$COUNT)"; exit 1; }

```

**硬阈值**:
- HTTP 200（首次）
- `authorize_url` 必须以 `https://` 起头 + 含 `feishu.cn` 域名 + 含路径 `authorize`
- `tenants.feishu_app_id = 'cli_smoke_app'` 且 `updated_at` 在最近 60s 内

**R4 ALREADY_BOUND 错误路径**: 因 `tenant_feishu_bindings` 行此时尚未生成（要等 Step 2 callback 完成才会有），ALREADY_BOUND 路径无法在 Step 1 当下触发。R4 由 BEHAVIOR 测试 `tests/ws3/feishu-bitable-mt.test.ts` 覆盖（mock binding 行存在 → POST start 期望 400 ALREADY_BOUND）；smoke 脚本 Step 4 之后追加一次重复 start 调用断言（见下方 smoke 脚本）。

---

### Step 2: 客户在飞书 OAuth 页扫码授权（Lead 客户机自验，CI 用 mock authorize 端点）

**可观测行为**: 客户在飞书授权页扫码同意 → 飞书带 `code` 跳回 `${API_BASE}/api/feishu/oauth/callback?code=xxx&state=tenant_id_signed`。

**验证命令**（CI 用模拟 callback；Lead 客户机用真飞书）:
```bash
# CI 模式：直接打 callback 并断言中台进入"换 token"路径
# 用 nock-style 测试服已注入 fake feishu API（见 BEHAVIOR 测试），这里只验路由存在
RESP_CODE=$(curl -s -o /tmp/cb.json -w '%{http_code}' \
  "$API_BASE/api/feishu/oauth/callback?code=fake_code_smoke&state=$STATE_TOKEN")

# 期望 302（跳回 dashboard）或 200（带 JSON）
[[ "$RESP_CODE" =~ ^(200|302)$ ]] || { echo "FAIL: callback 状态码 $RESP_CODE"; exit 1; }

# 验证 tenant_feishu_bindings 表有记录（time-windowed 防造假）
BIND_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND tenant_access_token IS NOT NULL AND bound_at > NOW() - interval '60 seconds'")
[ "$BIND_COUNT" = "1" ] || { echo "FAIL: tenant_feishu_bindings 未写入 (count=$BIND_COUNT)"; exit 1; }
```

**硬阈值**:
- callback HTTP code ∈ {200, 302}
- `tenant_feishu_bindings` 行数 = 1，`tenant_access_token` 非空，`bound_at` 在最近 60s 内
- `expires_at > NOW()`（token 未过期）
- 整步耗时 < 5s

---

### Step 3: tenant_access_token 自动刷新

**可观测行为**: 当 `expires_at <= NOW() + 5min` 时（即将过期），下一次需要 token 的调用触发后台用 `app_id` + `app_secret` 重新换 token，写回 `tenant_access_token` + `expires_at` + `last_refreshed_at`。客户无感知。

**验证命令**:
```bash
# 把测试 tenant 的 expires_at 改到过去（强制失效）
psql "$DB" -c "UPDATE zenithjoy.tenant_feishu_bindings SET expires_at = NOW() - interval '1 hour', tenant_access_token='expired_token_xxx' WHERE tenant_id='$TENANT_ID'"

# 调用任意需要 token 的端点（这里用 lead-config 拉数据）
curl -fsS "$API_BASE/api/lead-config/$TENANT_ID" -H "X-Tenant-Id: $TENANT_ID" >/dev/null 2>&1 || true

# 验证 last_refreshed_at 在最近 60s 内被更新（time-windowed 防造假）
REFRESHED=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND last_refreshed_at > NOW() - interval '60 seconds' AND tenant_access_token != 'expired_token_xxx'")
[ "$REFRESHED" = "1" ] || { echo "FAIL: token 未刷新 (count=$REFRESHED)"; exit 1; }

# 验证新 expires_at 在未来
EXPIRES_OK=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND expires_at > NOW() + interval '30 minutes'")
[ "$EXPIRES_OK" = "1" ] || { echo "FAIL: 新 expires_at 不在未来"; exit 1; }
```

**硬阈值**:
- `last_refreshed_at` 在最近 60s 内
- `tenant_access_token` 已变化
- 新 `expires_at > NOW() + 30min`
- 整步耗时 < 3s

---

### Step 4: 中台自动建 1 个 Bitable 文档 + 3 张表

**可观测行为**:
- **正常路径**: OAuth 成功后，中台用 `tenant_access_token` 调飞书 Bitable API：(a) 建 1 个 Bitable 文档；(b) 在文档下建 3 张表「获客画像」「对标视频」「Lead 名单」，schema 固定。三张表 ID 写入 `tenant_feishu_bindings.app_token` + `table_id_lead_profile` + `table_id_target_videos` + `table_id_leads`。
- **错误路径 (R2)**: provisionBitable 中途失败（建文档成功但建某张表失败 / 飞书 API 返非 200 / 网络中断）→ 已建资源记录入库 + 标记 `tenant_feishu_bindings.needs_retry = true`，callback 返 502 `{success:false, error:{code:'PROVISION_FAILED'}}`，dashboard 渲染"建表失败，重试"按钮。

**验证命令**:
```bash
# 验证 4 个 ID 字段都已落库（time-windowed）
RES=$(psql "$DB" -t -A -F'|' -c "SELECT app_token, table_id_lead_profile, table_id_target_videos, table_id_leads FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND bound_at > NOW() - interval '5 minutes'")
APP_TOKEN=$(echo "$RES" | cut -d'|' -f1)
T_PROFILE=$(echo "$RES" | cut -d'|' -f2)
T_VIDEO=$(echo "$RES" | cut -d'|' -f3)
T_LEADS=$(echo "$RES" | cut -d'|' -f4)

# 4 个 ID 都非空 + 符合飞书真 ID 格式正则（fake-feishu 也按真格式生成 mock）
echo "$APP_TOKEN" | grep -qE '^bascn[A-Za-z0-9]{10,}$' || { echo "FAIL: app_token 不符合 bascn[A-Za-z0-9]{10,} 格式: '$APP_TOKEN'"; exit 1; }
for tbl in "$T_PROFILE" "$T_VIDEO" "$T_LEADS"; do
  echo "$tbl" | grep -qE '^tbl[A-Za-z0-9]{10,}$' || { echo "FAIL: table_id 不符合 tbl[A-Za-z0-9]{10,} 格式: '$tbl'"; exit 1; }
done

# 验证表 schema：调真飞书 API 取 fields 列表（Lead 自验）/ 调本地 stub（CI）
# CI 模式下，feishu-bitable-multitenant 的 createBitableDocument 单测已断言 3 张表 + 字段
# Smoke 这里只断 ID 落库 + 4 个 ID 互不相同
[ "$T_PROFILE" != "$T_VIDEO" ] && [ "$T_VIDEO" != "$T_LEADS" ] && [ "$T_PROFILE" != "$T_LEADS" ] \
  || { echo "FAIL: 3 张表 ID 应互不相同"; exit 1; }
```

**硬阈值**:
- `app_token` 符合正则 `^bascn[A-Za-z0-9]{10,}$`
- 3 个 `table_id_*` 各自符合正则 `^tbl[A-Za-z0-9]{10,}$`
- 3 个 table_id 互不相同
- `bound_at` 在最近 5 分钟
- (耗时阈值删除：CI 飞书 stub 启停 + 真飞书 API 抖动会脆，不影响功能正确性)

---

### Step 5: dashboard 显示"飞书已绑定 ✓ + Bitable 链接"

**可观测行为**: dashboard `/dashboard/feishu-bind` 在绑定成功后显示绑定状态，含 Bitable 文档跳转链接（`https://*.feishu.cn/base/<app_token>`），并提示"请到飞书填画像和对标视频"。

**验证命令**（Playwright E2E）:
```bash
# Playwright 断言绑定成功页元素可见
cd apps/dashboard
npx playwright test e2e/path-2-sprint-a.spec.ts --reporter=line 2>&1 | tee /tmp/p2-e2e.log

# 必须含 PASS 行 + 不能含 'failed'
grep -q "1 passed" /tmp/p2-e2e.log || { echo "FAIL: Playwright 未通过"; exit 1; }
grep -qE "(failed|timeout)" /tmp/p2-e2e.log && { echo "FAIL: Playwright 报错"; exit 1; } || true
```

**硬阈值**:
- Playwright 1 个 spec PASS
- spec 内含 `await expect(page.getByText('飞书已绑定')).toBeVisible({ timeout: 5000 })`
- spec 内含 `await expect(page.getByRole('link', { name: /Bitable|多维表格/ })).toHaveAttribute('href', /feishu\.cn\/base\//)`

---

### Step 6: 客户在飞书填画像 1 行 + 对标视频 1 行（Lead 客户机操作 + CI mock 写入）

**可观测行为**: 客户在飞书 Bitable 的「获客画像」表填 1 行（行业=装修、关键词=小户型、钩子=送装修方案 PDF），「对标视频」表填 1 行（视频 URL = 任意 douyin URL）。CI 模式下用辅助脚本直接通过中台调飞书 API 注入。

**验证命令**:
```bash
# CI 用 helper 端点（DEV-only，X-Smoke-Token guard）注入 1 行画像 + 1 行视频
curl -fsS -X POST "$API_BASE/api/_smoke/feishu-seed" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"profile\":{\"industry\":\"装修\",\"keyword\":\"小户型\",\"hook\":\"送装修方案 PDF\"},\"target_videos\":[{\"url\":\"https://v.douyin.com/test/\",\"note\":\"smoke\"}]}" \
  >/tmp/seed.json

[ "$(jq -r '.success' /tmp/seed.json)" = "true" ] || { echo "FAIL: smoke seed 端点异常"; cat /tmp/seed.json; exit 1; }
```

**硬阈值**:
- helper 端点返回 `success: true`
- 仅在 `process.env.NODE_ENV !== 'production' && X-Smoke-Token` 匹配时启用（合同强约束 — 见禁止事项）
- 整步耗时 < 5s

---

### Step 7: dashboard 点"刷新状态" → 中台拉飞书 Bitable 数据

**可观测行为**:
- **正常路径**: 客户在 dashboard 点"刷新状态"按钮 → dashboard 调 `GET /api/lead-config/:tenantId` → 后端用 `tenant_access_token` 调飞书 Bitable API `list records` 拉「获客画像」+「对标视频」两表数据 → 返回 JSON。
- **错误路径 (R3)**: 客户在飞书侧删了 Bitable 文档 → 后端调 `list_records` 收到飞书 NotFound（如 `code 91402` / `app_token not exist`） → 返 400 `{success:false, error:{code:'BITABLE_NOT_FOUND'}}`，dashboard 渲染"文档已不存在 + 一键重建"按钮（重建 = 重新跑 provisionBitable）。
- **错误路径 (R5)**: 飞书 token 刷新链路失败（客户在飞书侧重置了 app_secret）→ `getValidToken` 抛 `TOKEN_REFRESH_FAILED` → 路由捕获 → 返 401 `{success:false, error:{code:'TOKEN_REFRESH_FAILED'}}`，dashboard 渲染"飞书授权已失效，请重新授权"。

**验证命令**:
```bash
RESP=$(curl -fsS "$API_BASE/api/lead-config/$TENANT_ID" -H "X-Tenant-Id: $TENANT_ID")

# 结构断言
echo "$RESP" | jq -e '.success == true' >/dev/null || { echo "FAIL: success 非 true"; exit 1; }
echo "$RESP" | jq -e '.data.profile.industry == "装修"' >/dev/null || { echo "FAIL: 行业不匹配"; exit 1; }
echo "$RESP" | jq -e '.data.profile.keyword == "小户型"' >/dev/null || { echo "FAIL: 关键词不匹配"; exit 1; }
echo "$RESP" | jq -e '.data.profile.hook | contains("送装修方案")' >/dev/null || { echo "FAIL: 钩子不匹配"; exit 1; }
echo "$RESP" | jq -e '.data.target_videos | length >= 1' >/dev/null || { echo "FAIL: target_videos 为空"; exit 1; }
echo "$RESP" | jq -e '.data.target_videos[0].url | startswith("https://")' >/dev/null || { echo "FAIL: 视频 URL 格式错"; exit 1; }
```

**硬阈值**:
- HTTP 200
- 返回 JSON 结构含 `data.profile.{industry,keyword,hook}` + `data.target_videos[]`
- 数据值与 Step 6 注入值一致
- 整步耗时 < 5s

---

### Step 8: dashboard 显示"画像 ✓ + 对标视频清单"（出口）

**可观测行为**: dashboard `/dashboard/feishu-bind` 或 `/dashboard/lead-config` 渲染拉到的画像 + 对标视频列表。

**验证命令**（Playwright E2E 续）:
```bash
# Playwright 断言渲染结果（同 spec 后续步骤）
cd apps/dashboard
npx playwright test e2e/path-2-sprint-a.spec.ts --grep "step8" --reporter=line 2>&1 | tee /tmp/p2-e2e-step8.log
grep -q "1 passed" /tmp/p2-e2e-step8.log || { echo "FAIL: step8 Playwright 失败"; exit 1; }
```

**硬阈值**:
- spec 内含 `await expect(page.getByText('装修')).toBeVisible({ timeout: 5000 })`
- spec 内含 `await expect(page.getByText('小户型')).toBeVisible()`
- spec 内含 `await expect(page.getByText(/对标视频.*1\s*个/)).toBeVisible()`

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing
**脚本路径**: `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`
**通过标准**: 跑到 Step 4 PASS（PRD 关键约束 1）；FAIL = 整 sprint FAIL

**完整验证脚本**:
```bash
#!/usr/bin/env bash
# golden-path-2-smoke.sh
# Path 2 Sprint A 全链 smoke（CI 模式 — 用 helper seed + nock 风格 stub）

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
DB="${DB_URL:-postgresql://postgres@localhost:5432/cecelia}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-secret-2026}"

# CI 模式自检：必须指向 fake-feishu-server（CI workflow 负责拉起 localhost:3099）
[ -z "${FEISHU_API_BASE:-}" ] && { echo "❌ 前置失败：未设置 FEISHU_API_BASE，CI 模式必须 export 指向 fake-feishu-server"; exit 99; }

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }

# ── 前置：建测试 tenant + 灌 app_id/app_secret ──
TENANT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants (name, license_key, plan, feishu_app_id, feishu_app_secret) VALUES ('p2-smoke-${RANDOM}', 'p2-key-${RANDOM}', 'free', 'cli_smoke_app', 'smoke_secret_xxx') RETURNING id" | tr -d ' ')
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99

# ── Step 1: OAuth start ──
RESP=$(curl -fsS -X POST "$API_BASE/api/feishu/oauth/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"app_id":"cli_smoke_app","app_secret":"smoke_secret_xxx"}')
echo "$RESP" | jq -er '.data.authorize_url' | grep -qE 'feishu\.cn.*authorize' || fail "Step 1: authorize_url 错" 1
STATE_TOKEN=$(echo "$RESP" | jq -r '.data.state')
ok "Step 1: OAuth start"

# ── Step 2: callback（CI 模式：feishu API 已被 stub 服务接管）──
RESP_CODE=$(curl -s -o /tmp/cb.json -w '%{http_code}' \
  "$API_BASE/api/feishu/oauth/callback?code=fake_code_smoke&state=$STATE_TOKEN")
[[ "$RESP_CODE" =~ ^(200|302)$ ]] || fail "Step 2: callback HTTP $RESP_CODE" 2

BIND_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND tenant_access_token IS NOT NULL AND bound_at > NOW() - interval '60 seconds'")
[ "$BIND_COUNT" = "1" ] || fail "Step 2: tenant_feishu_bindings 未落库" 2
ok "Step 2: OAuth callback + token 入库"

# ── Step 3: token 刷新（强制过期）──
psql "$DB" -c "UPDATE zenithjoy.tenant_feishu_bindings SET expires_at = NOW() - interval '1 hour' WHERE tenant_id='$TENANT_ID'" >/dev/null
curl -fsS "$API_BASE/api/lead-config/$TENANT_ID" -H "X-Tenant-Id: $TENANT_ID" >/dev/null 2>&1 || true
REFRESHED=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND last_refreshed_at > NOW() - interval '60 seconds' AND expires_at > NOW() + interval '30 minutes'")
[ "$REFRESHED" = "1" ] || fail "Step 3: token 未自动刷新" 3
ok "Step 3: tenant_access_token 自动刷新"

# ── Step 4: Bitable 3 张表 + ID 入库（正则验真 ID 格式）──
RES=$(psql "$DB" -t -A -F'|' -c "SELECT app_token, table_id_lead_profile, table_id_target_videos, table_id_leads FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID' AND bound_at > NOW() - interval '5 minutes'")
APP_TOKEN=$(echo "$RES" | cut -d'|' -f1)
T1=$(echo "$RES" | cut -d'|' -f2); T2=$(echo "$RES" | cut -d'|' -f3); T3=$(echo "$RES" | cut -d'|' -f4)

# app_token 必须符合飞书真 ID 格式 bascn[A-Za-z0-9]{10,}
echo "$APP_TOKEN" | grep -qE '^bascn[A-Za-z0-9]{10,}$' || fail "Step 4: app_token 格式错 '$APP_TOKEN'" 4

# 3 个 table_id 必须符合 tbl[A-Za-z0-9]{10,}
for tbl in "$T1" "$T2" "$T3"; do
  echo "$tbl" | grep -qE '^tbl[A-Za-z0-9]{10,}$' || fail "Step 4: table_id 格式错 '$tbl'" 4
done

[ "$T1" != "$T2" ] && [ "$T2" != "$T3" ] && [ "$T1" != "$T3" ] || fail "Step 4: 3 个 table_id 重复" 4
ok "Step 4: Bitable 文档 + 3 表 ID 落库 ✓✓✓ Sprint A 关键阈值过线"

# ── R4 错误路径自验：已绑过的 tenant 再次调 oauth/start 必须 400 ALREADY_BOUND ──
DUP_CODE=$(curl -s -o /tmp/dup.json -w '%{http_code}' -X POST "$API_BASE/api/feishu/oauth/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"app_id":"cli_smoke_app","app_secret":"smoke_secret_xxx"}')
[ "$DUP_CODE" = "400" ] || fail "R4: 重复绑定应返 400，实际 $DUP_CODE" 41
[ "$(jq -r '.error.code' /tmp/dup.json)" = "ALREADY_BOUND" ] || fail "R4: error.code 应 ALREADY_BOUND" 41
ok "R4: ALREADY_BOUND 错误路径"

# ── 关键阈值线（PRD 约束 1）：跑到 Step 4 PASS = sprint A 通过 ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Path 2 Sprint A smoke: Step 1-4 PASS"
echo "  后续 Step 5-8 由 Lead 客户机自验"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
```

---

## Workstreams

**workstream_count**: 5

### Workstream 1: DB migration + tenant_feishu_bindings 表

**范围**: 新建 `apps/api/db/migrations/20260508_xxxxxx_tenant_feishu_bindings.sql`，含 8 列（tenant_id FK、tenant_access_token、expires_at、app_token、table_id_lead_profile、table_id_target_videos、table_id_leads、bound_at、last_refreshed_at）+ 索引 `idx_tfb_tenant`。
**大小**: S（< 100 行）
**依赖**: 无
**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration.test.ts`

### Workstream 2: feishu-token.ts 服务（OAuth flow + token 刷新）

**范围**: `apps/api/src/services/feishu-token.ts`：
- `getAuthorizeUrl(tenantId, appId)` — 生成 OAuth 跳转 URL + state 签名
- `handleCallback(code, state)` — code → token、写 `tenant_feishu_bindings`
- `getValidToken(tenantId)` — 自动续期：若 expires_at < NOW + 5min，用 app_id/app_secret 换新 token
**大小**: M（150-250 行）
**依赖**: WS1
**BEHAVIOR 覆盖测试文件**: `tests/ws2/feishu-token.test.ts`

### Workstream 3: feishu-bitable-multitenant.ts + lead-config 路由 + fake-feishu-server

**范围**:
- `apps/api/src/services/feishu-bitable-multitenant.ts`：`provisionBitable(tenantId)` 自动建文档+3 表，写回 4 个 ID；`fetchLeadConfig(tenantId)` 拉画像 + 视频；含 R2/R3 错误抛出（PROVISION_FAILED / BITABLE_NOT_FOUND）
- `apps/api/src/routes/feishu-oauth.ts`：`POST /api/feishu/oauth/start`（含 R4 ALREADY_BOUND 检测）+ `GET /api/feishu/oauth/callback`（callback 内串行调 token 入库 → provisionBitable，含 R1/R2 错误捕获 → 302 跳回 dashboard 带 ?error=）
- `apps/api/src/routes/lead-config.ts`：`GET /api/lead-config/:tenantId`（含 R3/R5 错误捕获）
- 在 `apps/api/src/app.ts` 挂载新路由
- **新增**: `apps/api/test-utils/fake-feishu-server.ts` — 独立 Node.js fastify 进程监听 `localhost:3099`，模拟飞书 5 个核心端点（auth/v3/tenant_access_token + bitable/v1/apps + tables + records + list_records），按真 ID 正则格式生成 mock ID，支持 `?inject_error=` query 触发 R2/R3 错误注入
- **production 注入点**: `feishu-bitable-multitenant.ts` + `feishu-token.ts` 顶部 `const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn'`
- **ENV 文档**: 更新 `apps/api/.env.example` 加 `FEISHU_API_BASE` 注释项
**大小**: L（300-400 行实现 + 100-150 行 fake server）
**依赖**: WS2
**BEHAVIOR 覆盖测试文件**: `tests/ws3/feishu-bitable-mt.test.ts` + `tests/ws3/lead-config.test.ts`

### Workstream 4: Dashboard FeishuBindTenant 页 + Playwright E2E

**范围**:
- `apps/dashboard/src/pages/FeishuBindTenant.tsx`：app_id/app_secret 表单 + OAuth 跳转 + 绑定状态展示 + 画像/视频清单展示 + 重建按钮
- `apps/dashboard/src/App.tsx` 路由表挂 `/dashboard/feishu-bind`
- `apps/dashboard/e2e/path-2-sprint-a.spec.ts`：8 步全链 E2E（API stub 模式）
**大小**: M（200-300 行）
**依赖**: WS3
**BEHAVIOR 覆盖测试文件**: `tests/ws4/feishu-bind-page.test.ts`（Vitest 组件） + `apps/dashboard/e2e/path-2-sprint-a.spec.ts`（Playwright）

### Workstream 5: golden-path-2-smoke.sh + Lead 自验证据 + Path 1 隔离断言 + CI workflow stub 启动

**范围**:
- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`（合同 E2E 段全文落地，开头自检 `FEISHU_API_BASE` 已 export，未设 → exit 99）
- `.agent-knowledge/path-2/lead-acceptance-sprint-a.md`：Lead 在 xian-pc 真飞书租户 5+ 步链路证据（含截图 + 时间戳）
- `apps/api/src/routes/_smoke-feishu-seed.ts`：DEV-only helper 路由模块（`process.env.NODE_ENV !== 'production'` + `X-Smoke-Token` 双 guard，生产 404；调业务层 `writeRecord` 不绕过飞书层；路由内为 `router.post('/feishu-seed', ...)`）
- `apps/api/src/app.ts` 修改：挂载 `app.use('/api/_smoke', smokeFeishuSeedRouter)`，对外完整路径 `POST /api/_smoke/feishu-seed`
- **CI workflow** 修改：在 smoke 步骤前 `node apps/api/test-utils/fake-feishu-server.js &` 拉起 fake server，`export FEISHU_API_BASE=http://localhost:3099`，smoke 后 `kill $!` 停
- Path 1 隔离断言：脚本内显式 `git diff --name-only origin/main...HEAD` 检查不动 `services/agent/src/handlers/qr-bind-douyin.ts` / `apps/api/src/services/feishu-bitable.ts`（保留）/ 任何含 `agent_platform_sessions` 的 migration
**大小**: M（200 行 shell + 100 行 helper + 50 行 workflow 修改 + Lead 自验文档）
**依赖**: WS3 + WS4
**BEHAVIOR 覆盖测试文件**: `tests/ws5/path1-isolation.test.ts`（pure-bash assertion + lint 检查 + helper 双门禁断言）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 风险覆盖 | 预期红证据 |
|---|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | migration 跑后 `tenant_feishu_bindings` 表存在 + 8 列齐全 + FK 指 tenants + `needs_retry` BOOL 字段（R2 用）+ `provision_error` TEXT | R2 schema | 表不存在/缺列 → vitest fail |
| WS2 | `tests/ws2/feishu-token.test.ts` | `getAuthorizeUrl` 返回飞书 URL + state 签名；`handleCallback` 入库 + `getValidToken` 过期自动续；`getValidToken` 飞书续期非 200 抛 `TokenRefreshError` | R5 | 函数未导出 / 错误未抛 → vitest fail |
| WS3 | `tests/ws3/feishu-bitable-mt.test.ts` | `provisionBitable` 调 3 次飞书 createTable API + 写回 4 个 ID（mock fake-feishu 注入 R2 错误 → 返 PROVISION_FAILED + `needs_retry=true`）；`fetchLeadConfig` 返回正确结构（mock fake-feishu 注入 R3 NotFound → 抛 BitableNotFoundError）；`POST /api/feishu/oauth/start` 在 binding 行已存在时返 400 ALREADY_BOUND | R2 / R3 / R4 | 错码不匹配 / 未抛错 → vitest fail |
| WS3 | `tests/ws3/lead-config.test.ts` | `GET /api/lead-config/:tenantId` 200 + 返回 `data.profile.industry` + `data.target_videos[]`；R3 路径返 400 BITABLE_NOT_FOUND；R5 路径返 401 TOKEN_REFRESH_FAILED；R1 路径 callback 带 ?error= 跳回 dashboard | R1 / R3 / R5 | 错码不匹配 → vitest fail |
| WS4 | `tests/ws4/feishu-bind-page.test.ts` | `<FeishuBindTenant />` 渲染表单 + 提交触发 fetch；URL 含 `?error=` 时渲染错码；URL 含 `?error=ALREADY_BOUND` 时禁用提交按钮 | R1 / R4 (UI) | 渲染错 → vitest fail |
| WS5 | `tests/ws5/path1-isolation.test.ts` | `qr-bind-douyin.ts` 文件未被本 sprint 修改；`feishu-bitable.ts`（单租户原版）字节级未变；DEV helper `NODE_ENV=production` 返 404；DEV helper 缺/错 `X-Smoke-Token` 返 403 | (隔离 + 双门禁) | sprint 改了 / helper 暴露生产 → 断言 fail |

---

## Risks & Mitigations

本 sprint 涉及 OAuth + 多租户飞书 API + 跨进程 stub，对抗下列已识别风险：

| ID | Risk | Mitigation（在哪一层处理 + 用户可见行为） |
|---|---|---|
| **R1** | OAuth 授权失败：客户填错 `app_id` / `app_secret`，或飞书侧应用未给齐 Bitable 权限 | callback 路由 `apps/api/src/routes/feishu-oauth.ts` 解析飞书回调 query 中的 `error` / `error_code` 字段 → 302 跳回 dashboard `?error=<code>` → `FeishuBindTenant.tsx` 渲染原始错码 + 中文文案"飞书授权失败：<code>，请检查 app_secret 与权限"，不进入 token 入库流程 |
| **R2** | provisionBitable 中途失败：建文档成功但建表失败（飞书 API 5xx / 网络中断） | `provisionBitable` 包 try/catch；建文档/建表的部分成功结果落 `tenant_feishu_bindings` 但 `needs_retry=true` + `provision_error=<msg>`；callback 返 502 `{error:{code:'PROVISION_FAILED'}}`；dashboard 渲染"建表失败，重试"按钮，点了重新调 callback's provision phase（不重新 OAuth） |
| **R3** | 客户在飞书侧删了 Bitable 文档 | `fetchLeadConfig` 调 `list_records` 收飞书 `code 91402` 等 NotFound → 抛 `BitableNotFoundError` → `lead-config.ts` 路由捕获 → 返 400 `{error:{code:'BITABLE_NOT_FOUND'}}`；dashboard 显示"文档已不存在 + 一键重建" |
| **R4** | 客户重复点"绑飞书"（已绑过） | `POST /api/feishu/oauth/start` 入口先 `SELECT 1 FROM tenant_feishu_bindings WHERE tenant_id=$1` → 若已存在不重新生成 `authorize_url`，返 400 `{error:{code:'ALREADY_BOUND'}, data:{rebind_required:true}}`；dashboard 显示"已绑 X 租户，换绑请先解绑" |
| **R5** | tenant_access_token 刷新链路 cascade 失败：客户在飞书侧重置了 `app_secret`，后台用旧 secret 续期被飞书拒 | `getValidToken` 包 try/catch，飞书续期接口非 200 → 抛 `TokenRefreshError`（错码 `TOKEN_REFRESH_FAILED`）；任何依赖 token 的路由（`lead-config.ts` / `feishu-oauth/callback` 重建）捕获 → 返 401 `{error:{code:'TOKEN_REFRESH_FAILED'}}`；dashboard 显示"飞书授权已失效，请重新授权"（点击重新走 OAuth start） |

每个 R 都已在对应 Step 的"可观测行为"段写明错误路径，BEHAVIOR 测试覆盖见 Test Contract 表对应 ws2 / ws3 测试文件。

---

## CI Stub 机制（fake-feishu-server）

合同内验证命令隐含"CI 模式飞书 API 已被 stub 接管"，本节明确 stub 的归属与启停：

### 1. Stub 服务定义

- **文件**: `apps/api/test-utils/fake-feishu-server.ts`（独立 Node.js fastify/express 进程，监听 `localhost:3099`）
- **Owner**: WS3（同合同内"feishu-bitable-multitenant" 的实现 owner，本质上是验证它的"测试替身"）
- **Endpoints handled**:
  - `POST /open-apis/auth/v3/tenant_access_token/internal` → 返 `{code:0, tenant_access_token:'fake_t_'+Date.now(), expire:7200}`
  - `POST /open-apis/bitable/v1/apps` → 返 `{code:0, data:{app:{app_token:'bascn'+randomString(16)}}}`
  - `POST /open-apis/bitable/v1/apps/:app_token/tables` → 返 `{code:0, data:{table_id:'tbl'+randomString(16)}}`
  - `POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records` → 返 `{code:0, data:{record:{record_id:'rec'+randomString(8)}}}`
  - `GET /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records` → 返 `{code:0, data:{items:[<seeded rows>]}}`
  - 错误注入：query `?inject_error=R2_PROVISION_FAIL` / `?inject_error=R3_NOT_FOUND` 用于 R2/R3 错误路径测试

### 2. 注入机制

- production 代码（`feishu-bitable-multitenant.ts` / `feishu-token.ts`）使用 `process.env.FEISHU_API_BASE`（默认 `https://open.feishu.cn`），CI 模式启动前 export `FEISHU_API_BASE=http://localhost:3099`
- ENV 文档：`apps/api/.env.example` 必须新增条目 `FEISHU_API_BASE=https://open.feishu.cn` + 注释"CI 改为 http://localhost:3099"
- WS3 owner 在新增 `feishu-bitable-multitenant.ts` 顶部用 `const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn'` 读取

### 3. 启停时机

- **CI workflow**（`.github/workflows/path-2-smoke.yml` 或现有 ci.yml 内）: smoke 步骤 `run:` 段开头 `node apps/api/test-utils/fake-feishu-server.js &` 启动；smoke 脚本结束后用 `kill $!` 停。
- **smoke.sh 内**: 脚本头部含 `[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: 未设置 FEISHU_API_BASE，CI 模式必须指向 fake server"; exit 99; }` 自检
- WS5 owner 写 smoke.sh 时不重复启 stub（CI workflow 负责），但写明前置依赖

### 4. _smoke-feishu-seed 与 stub 的关系（不绕过飞书层）

- helper 端点 `POST /api/_smoke/feishu-seed` 不直接 INSERT 数据库表，而是**调用业务代码**的 `feishu-bitable-multitenant.ts` 中的 `writeRecord(tenantId, tableId, fields)` 函数 → 后者按正常路径调 `${FEISHU_API_BASE}/open-apis/bitable/.../records` → CI 下指向 fake-feishu-server → fake server 把 fields 存内存 → 后续 `list_records` 能读出。
- 这样调用链 `helper → service → fake feishu → service → DB` 与生产 `helper(disabled) → 客户在飞书填 → service → 真飞书 → service → DB` 等价，不绕过飞书层。

---

## SSOT 文件路径（合同内禁止漂移）

为消除 Proposer / Generator / Reviewer 对路径的歧义，本合同声明以下 SSOT 路径，task-plan + DoD + 实现 + smoke 全部对齐：

| 用途 | 路径 (SSOT) |
|---|---|
| WS1 migration | `apps/api/db/migrations/20260508_xxxxxx_tenant_feishu_bindings.sql`（xxxxxx = 8 位随机或递增序号，由 generator 决定但落到此目录） |
| WS2 token 服务 | `apps/api/src/services/feishu-token.ts` |
| WS3 多租户 Bitable | `apps/api/src/services/feishu-bitable-multitenant.ts` |
| WS3 OAuth 路由 | `apps/api/src/routes/feishu-oauth.ts` |
| WS3 lead-config 路由 | `apps/api/src/routes/lead-config.ts` |
| WS3 fake-feishu-server (test util) | `apps/api/test-utils/fake-feishu-server.ts` |
| WS4 dashboard 页 | `apps/dashboard/src/pages/FeishuBindTenant.tsx` |
| WS4 Playwright spec | `apps/dashboard/e2e/path-2-sprint-a.spec.ts` |
| WS5 smoke 脚本 | `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` |
| WS5 helper 路由 文件 | `apps/api/src/routes/_smoke-feishu-seed.ts` |
| WS5 helper 路由 挂载 | `apps/api/src/app.ts` 中 `app.use('/api/_smoke', smokeFeishuSeedRouter)` |
| WS5 helper 路由 path | `router.post('/feishu-seed', ...)` 即对外完整路径 `POST /api/_smoke/feishu-seed` |
| WS5 Lead 自验证据 | `.agent-knowledge/path-2/lead-acceptance-sprint-a.md` |
| ENV 文档 | `apps/api/.env.example` 必须含 `FEISHU_API_BASE` 条目 |

任一文件路径若 generator 想偏离此表 → 必须先回到合同 GAN 层修订，不可偷偷改。

---

## 关键约束（合同强制，不可妥协）

### 约束 A: Feature 0 端到端 smoke 阈值线
`golden-path-2-smoke.sh` 跑到 Step 4 PASS，`exit 0`。任一 step fail = 整 sprint FAIL。CI workflow 必须挂这条 smoke 作为 required check。

### 约束 B: Lead 客户机自验
`.agent-knowledge/path-2/lead-acceptance-sprint-a.md` 必须存在且：
- 含 5+ 步链路证据（dashboard 注册 → 装 Agent → 绑飞书扫码 → 飞书看到 3 张表 → 填画像+对标视频 → dashboard "已配置"）
- 每步含截图（即使存放路径，文件名可读）+ 时间戳 + Lead 自验账号信息
- 文件大小 > 1KB（防空文件造假）+ 含 `lead_acceptance_status: PASS` YAML front-matter
- Evaluator 验证命令：
  ```bash
  test -f .agent-knowledge/path-2/lead-acceptance-sprint-a.md \
    && [ "$(wc -c < .agent-knowledge/path-2/lead-acceptance-sprint-a.md)" -gt 1024 ] \
    && grep -q "lead_acceptance_status: PASS" .agent-knowledge/path-2/lead-acceptance-sprint-a.md \
    && [ "$(grep -cE '^### Step [1-9]' .agent-knowledge/path-2/lead-acceptance-sprint-a.md)" -ge 5 ]
  ```

### 约束 C: Path 1 隔离
本 sprint 的 commit 任何一个改了以下文件 = CI 立即拒：
```bash
FORBIDDEN_FILES=(
  "services/agent/src/handlers/qr-bind-douyin.ts"
  "apps/api/src/services/feishu-bitable.ts"  # 单租户原版保留
  "apps/dashboard/src/pages/DouyinBindPage.tsx"
)
for f in "${FORBIDDEN_FILES[@]}"; do
  if git diff --name-only origin/main...HEAD | grep -qFx "$f"; then
    echo "FAIL: 本 sprint 不得修改 $f（Path 1 隔离）"; exit 1
  fi
done

# agent_platform_sessions schema 不动
git diff origin/main...HEAD -- 'apps/api/db/migrations/*.sql' | grep -qE 'agent_platform_sessions' \
  && { echo "FAIL: 不得改 agent_platform_sessions schema"; exit 1; } || true
```

### 约束 D: 验证命令真实性（GAN 对抗焦点）
- 所有 `SELECT count(*)` 必须含 `created_at|updated_at|bound_at|last_refreshed_at > NOW() - interval 'N seconds'` 时间窗口
- 所有 `curl` 用 `-fsS`（HTTP 5xx 才返回非 0）
- 所有 Playwright 断言用 `await expect(...).toBeVisible({ timeout: 5000 })`，不能只 navigate
- DEV helper 端点 `_smoke-feishu-seed.ts` 必须 hard-guard `NODE_ENV !== 'production'` + `X-Smoke-Token` 双重门禁，否则生产泄漏

### 约束 E: TDD commit 顺序
违反 `lint-tdd-commit-order` = CI 拒。每个 WS：
- commit 1：tests/ws{N}/*.test.ts 红证据（实现文件不存在或空）
- commit 2：实现 + tests 全绿

---

## journey_type
**user_facing** — 涉及 dashboard 客户自助页面 + 客户在飞书 workspace 操作，是终端客户面的 walking skeleton 路径。

journey_type_reason: PRD 末尾已声明 user_facing，本合同对齐。
